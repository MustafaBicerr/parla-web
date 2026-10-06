/**
 * Parla BT Ticket V2 — dosya ekleri.
 *
 * Ek verisi (base64) Realtime Database'de, mesajlardan ayrı düğümlerde tutulur:
 *   v2/ticket_attachments/{ticketId}/{attId}           (ticket tarafları + personel)
 *   v2/ticket_internal_attachments/{ticketId}/{attId}  (yalnızca personel; dahili notların ekleri)
 * Mesaj yalnızca küçük bir referans (id, ad, tür, boyut) taşır; ek, tıklanınca istenir.
 * Yetki tamamen database.rules.json ile uygulanır. Görseller yüklemeden önce istemcide sıkıştırılır.
 */
import ParlaDb from "./firebase-client.js";
import { escapeHtml, nowIso } from "./ticket-utils.js";

export const ATTACH_LIMITS = { maxFiles: 3, maxBytes: 2 * 1024 * 1024, imageMaxEdge: 1800, recompressAbove: 300 * 1024 };

const EXT_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", txt: "text/plain", log: "text/plain", csv: "text/csv", zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const TYPE_ALLOWED = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/(plain|csv)|application\/zip|application\/msword|application\/vnd\.[a-z0-9.+-]+)$/;
export const ACCEPT_ATTR = Object.keys(EXT_TYPES).map((e) => `.${e}`).join(",");

export function resolveType(file) {
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  const byExt = EXT_TYPES[ext];
  const declared = String(file.type || "").toLowerCase();
  // Tarayıcılar .csv/.log için çoğu zaman yanlış/boş tür bildirir: uzantı esas alınır.
  if (byExt && (!declared || declared === "application/octet-stream" || ext === "csv" || ext === "log")) return byExt;
  return declared || byExt || "";
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Dosya okunamadı."));
    reader.readAsDataURL(blob);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Görsel açılamadı."));
    img.src = url;
  });
}

/** Büyük görselleri yeniden boyutlandırıp JPEG olarak sıkıştırır; küçükleri olduğu gibi bırakır. */
async function maybeCompressImage(file, type) {
  if (!/^image\/(png|jpeg|webp)$/.test(type) || file.size <= ATTACH_LIMITS.recompressAbove) return { blob: file, type, name: file.name };
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, ATTACH_LIMITS.imageMaxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // saydam PNG'ler JPEG'de siyah olmasın
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (blob && blob.size < file.size) {
      return { blob, type: "image/jpeg", name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
    }
  } catch {
    /* sıkıştırılamazsa orijinal kullanılır */
  } finally {
    URL.revokeObjectURL(url);
  }
  return { blob: file, type, name: file.name };
}

/**
 * Seçilen dosyaları doğrular ve yüklemeye hazırlar.
 * @returns {Promise<{files: Array<{name,type,size,data}>, errors: string[]}>}
 */
export async function prepareFiles(fileList) {
  const input = Array.from(fileList || []);
  const errors = [];
  const files = [];
  if (input.length > ATTACH_LIMITS.maxFiles) {
    errors.push(`En fazla ${ATTACH_LIMITS.maxFiles} dosya ekleyebilirsiniz.`);
  }
  for (const file of input.slice(0, ATTACH_LIMITS.maxFiles)) {
    const type = resolveType(file);
    if (!TYPE_ALLOWED.test(type)) {
      errors.push(`"${file.name}" desteklenmeyen bir dosya türü. İzin verilenler: görsel, PDF, Office belgeleri, metin/CSV, ZIP.`);
      continue;
    }
    const processed = await maybeCompressImage(file, type);
    if (processed.blob.size > ATTACH_LIMITS.maxBytes) {
      errors.push(`"${file.name}" ${formatBytes(ATTACH_LIMITS.maxBytes)} sınırını aşıyor (${formatBytes(processed.blob.size)}).`);
      continue;
    }
    const dataUrl = await readAsDataUrl(processed.blob);
    files.push({ name: processed.name.slice(0, 200), type: processed.type, size: processed.blob.size, data: dataUrl.slice(dataUrl.indexOf(",") + 1) });
  }
  return { files, errors };
}

/** Hazırlanan dosyaları veritabanına yazar ve mesaja konacak referansları döner. */
export async function uploadAttachments(ticketId, prepared, options) {
  options = options || {};
  const fb = window.__PARLA_FIREBASE;
  const node = options.internal ? "ticket_internal_attachments" : "ticket_attachments";
  const session = options.session || {};
  const refs = [];
  for (const file of prepared) {
    const ref = fb.db.push(ParlaDb.v2Ref(`${node}/${ticketId}`));
    await fb.db.set(ref, {
      att_id: ref.key,
      name: file.name,
      type: file.type,
      size: file.size,
      data: file.data,
      uploader_uid: session.uid || "",
      uploader_name: [session.first_name, session.last_name].filter(Boolean).join(" ") || session.email || "",
      created_at: nowIso(),
    });
    refs.push({ id: ref.key, name: file.name, type: file.type, size: file.size });
  }
  return refs;
}

/** E-posta bildirimine eklenecek özet ("Ekler: a.png, b.pdf"). */
export function attachmentsNote(refs) {
  return refs && refs.length ? `\n\nEkler: ${refs.map((r) => r.name).join(", ")}` : "";
}

export async function openAttachment(ticketId, attId, internal) {
  const node = internal ? "ticket_internal_attachments" : "ticket_attachments";
  const snap = await window.__PARLA_FIREBASE.db.get(ParlaDb.v2Ref(`${node}/${ticketId}/${attId}`));
  if (!snap.exists()) throw new Error("Ek bulunamadı.");
  const att = snap.val();
  const bytes = Uint8Array.from(atob(att.data), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: att.type });
  const url = URL.createObjectURL(blob);
  const inline = /^(image\/|application\/pdf)/.test(att.type);
  if (inline) {
    window.open(url, "_blank", "noopener");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Mesajın ekleri için tıklanabilir çipler. */
export function renderAttachmentChips(attachments, ticketId, internal) {
  if (!Array.isArray(attachments) || !attachments.length) return "";
  const chips = attachments
    .map(
      (a) => `<button type="button" class="sv2-attachment" data-ticket="${escapeHtml(ticketId)}" data-att="${escapeHtml(a.id)}"${internal ? ' data-internal="1"' : ""} title="Aç / indir">
        <i class="fas ${/^image\//.test(a.type) ? "fa-image" : /pdf/.test(a.type) ? "fa-file-pdf" : "fa-paperclip"}"></i>
        <span>${escapeHtml(a.name)}</span><small>${escapeHtml(formatBytes(Number(a.size) || 0))}</small>
      </button>`
    )
    .join("");
  return `<div class="sv2-attachments">${chips}</div>`;
}

let delegated = false;
export function bindAttachmentClicks() {
  if (delegated || typeof document === "undefined") return;
  delegated = true;
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest && e.target.closest(".sv2-attachment");
    if (!btn) return;
    e.preventDefault();
    btn.disabled = true;
    try {
      await openAttachment(btn.dataset.ticket, btn.dataset.att, btn.dataset.internal === "1");
    } catch (err) {
      const { toast } = await import("./ui-shell.js");
      toast(err.message || "Ek açılamadı.", "error");
    } finally {
      btn.disabled = false;
    }
  });
}

/** Dosya seçici arayüzü (etiket + liste). */
export function renderFilePicker(id) {
  return `
    <div class="sv2-file-picker" id="${id}-picker">
      <label class="sv2-btn sv2-btn-outline sv2-btn-sm sv2-file-btn" for="${id}-input"><i class="fas fa-paperclip"></i> Dosya Ekle</label>
      <input type="file" id="${id}-input" multiple accept="${ACCEPT_ATTR}" hidden>
      <span class="sv2-text-muted sv2-file-hint">En fazla ${ATTACH_LIMITS.maxFiles} dosya · her biri ${formatBytes(ATTACH_LIMITS.maxBytes)} (görseller otomatik küçültülür)</span>
      <ul class="sv2-file-list" id="${id}-list"></ul>
      <span class="sv2-field-error" id="${id}-error" hidden></span>
    </div>`;
}

/**
 * Seçici davranışını bağlar. getPrepared() seçili dosyaları doğrular/hazırlar; hata varsa mesajı gösterip null döner.
 */
export function bindFilePicker(id) {
  const input = document.getElementById(`${id}-input`);
  const list = document.getElementById(`${id}-list`);
  const errEl = document.getElementById(`${id}-error`);
  let selected = [];
  const showError = (msg) => {
    if (!errEl) return;
    errEl.textContent = msg || "";
    errEl.hidden = !msg;
  };
  const paint = () => {
    if (!list) return;
    list.innerHTML = selected
      .map((f, i) => `<li>${escapeHtml(f.name)} <small>${escapeHtml(formatBytes(f.size))}</small> <button type="button" class="sv2-file-remove" data-i="${i}" aria-label="Kaldır">&times;</button></li>`)
      .join("");
    list.querySelectorAll(".sv2-file-remove").forEach((b) =>
      b.addEventListener("click", () => {
        selected.splice(Number(b.dataset.i), 1);
        showError("");
        paint();
      })
    );
  };
  input?.addEventListener("change", () => {
    selected = selected.concat(Array.from(input.files || [])).slice(0, ATTACH_LIMITS.maxFiles + 5);
    input.value = "";
    showError(selected.length > ATTACH_LIMITS.maxFiles ? `En fazla ${ATTACH_LIMITS.maxFiles} dosya ekleyebilirsiniz.` : "");
    paint();
  });
  return {
    count: () => selected.length,
    clear: () => {
      selected = [];
      showError("");
      paint();
    },
    async getPrepared() {
      if (!selected.length) return [];
      const { files, errors } = await prepareFiles(selected);
      if (errors.length) {
        showError(errors.join(" "));
        return null;
      }
      return files;
    },
  };
}
