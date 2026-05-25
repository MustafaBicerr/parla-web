/**
 * Parla BT Ticket V2 — Destek Türleri (admin)
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth } from "../auth-guard.js";
import {
  renderShell,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  toast,
  showLoading,
  handleError,
  escapeHtml,
} from "../ui-shell.js";
import { required } from "../validators.js";

let session = null;
let supportTypes = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Destek Türleri",
      activePage: "support-types",
      profile: session,
      isAdmin: true,
      content: `
        <div class="sv2-section">
          <div class="sv2-section-header">
            <h3>Destek Türleri</h3>
            <button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-type">
              <i class="fas fa-plus"></i> Yeni Tür
            </button>
          </div>
          <div class="sv2-section-body" id="types-table"></div>
        </div>`,
    });
    await loadData();
    bindEvents();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin") {
      handleError(err, "Sayfa yüklenemedi");
    }
  }
}

async function loadData() {
  showLoading(true);
  try {
    await ParlaDb.seedSupportTypesIfEmpty();
    supportTypes = await ParlaDb.getAllSupportTypes();
    renderTable();
  } catch (err) {
    handleError(err, "Veriler yüklenemedi");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-type")?.addEventListener("click", () => openFormModal(null));
}

function activeToggle(code, isActive) {
  const checked = isActive !== false ? " checked" : "";
  return `<label class="sv2-switch">
    <input type="checkbox" class="type-toggle" data-code="${escapeHtml(code)}"${checked}>
    <span class="sv2-switch-slider"></span>
  </label>`;
}

function renderTable() {
  const el = document.getElementById("types-table");
  if (!el) return;

  const sorted = [...supportTypes].sort((a, b) =>
    String(a.code || a.type_code).localeCompare(String(b.code || b.type_code), "tr")
  );

  el.innerHTML = renderDataTable({
    columns: [
      {
        key: "code",
        label: "KOD",
        render: (_, row) => escapeHtml(row.code || row.type_code || "—"),
      },
      { key: "name", label: "ADI" },
      {
        key: "description",
        label: "AÇIKLAMA",
        render: (v) => escapeHtml(v || "—"),
      },
      {
        key: "color",
        label: "RENK",
        render: (v) =>
          `<span class="sv2-color-swatch" style="background:${escapeHtml(v || "#0070f2")}"></span> ${escapeHtml(v || "—")}`,
      },
      {
        key: "is_active",
        label: "AKTİF",
        render: (_, row) => activeToggle(row.code || row.type_code, row.is_active),
      },
      {
        key: "actions",
        label: "İŞLEMLER",
        render: (_, row) =>
          `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-secondary btn-edit" data-code="${escapeHtml(row.code || row.type_code)}">
            <i class="fas fa-edit"></i> Düzenle
          </button>`,
      },
    ],
    rows: sorted.map((t) => ({ ...t, id: t.id || t.type_code || t.code })),
    emptyMessage: "Destek türü bulunamadı.",
  });

  el.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = supportTypes.find(
        (t) => String(t.code || t.type_code).toUpperCase() === btn.dataset.code.toUpperCase()
      );
      if (item) openFormModal(item);
    });
  });

  el.querySelectorAll(".type-toggle").forEach((input) => {
    input.addEventListener("change", () => toggleActive(input.dataset.code, input.checked));
  });
}

function typeFormBody(data) {
  const d = data || {};
  const code = d.code || d.type_code || "";
  const isEdit = !!code;
  return `
    <form id="type-form">
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="tf-code">Kod *</label>
          <input type="text" id="tf-code" value="${escapeHtml(code)}" ${isEdit ? "readonly" : ""} maxlength="10" style="text-transform:uppercase" required>
          <div class="sv2-field-error" id="err-code" hidden></div>
        </div>
        <div class="sv2-form-group">
          <label for="tf-color">Renk</label>
          <input type="color" id="tf-color" value="${escapeHtml(d.color || "#0070f2")}">
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="tf-name">Ad *</label>
        <input type="text" id="tf-name" value="${escapeHtml(d.name || "")}" required>
        <div class="sv2-field-error" id="err-name" hidden></div>
      </div>
      <div class="sv2-form-group">
        <label for="tf-desc">Açıklama</label>
        <textarea id="tf-desc" rows="3">${escapeHtml(d.description || "")}</textarea>
      </div>
    </form>`;
}

function openFormModal(item) {
  const isEdit = !!item;
  const modalId = "type-modal";

  renderModal(modalId, {
    title: isEdit ? "Destek Türü Düzenle" : "Yeni Destek Türü",
    body: typeFormBody(item),
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="${modalId}">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="type-save">${isEdit ? "Güncelle" : "Kaydet"}</button>`,
  });

  openModal(modalId);
  document.getElementById("type-save")?.addEventListener("click", () =>
    saveType(isEdit ? item.code || item.type_code : null)
  );
}

async function saveType(editCode) {
  const codeEl = document.getElementById("tf-code");
  const nameEl = document.getElementById("tf-name");
  const errCode = document.getElementById("err-code");
  const errName = document.getElementById("err-name");
  errCode.hidden = true;
  errName.hidden = true;

  const code = String(codeEl?.value || "").trim().toUpperCase();
  const name = nameEl?.value.trim();
  const color = document.getElementById("tf-color")?.value || "#0070f2";
  const description = document.getElementById("tf-desc")?.value.trim() || "";

  if (!required(code)) {
    errCode.hidden = false;
    errCode.textContent = "Kod zorunludur.";
    return;
  }
  if (!required(name)) {
    errName.hidden = false;
    errName.textContent = "Ad zorunludur.";
    return;
  }

  if (!editCode) {
    const exists = supportTypes.some(
      (t) => String(t.code || t.type_code).toUpperCase() === code
    );
    if (exists) {
      errCode.hidden = false;
      errCode.textContent = "Bu kod zaten kullanılıyor.";
      return;
    }
  }

  showLoading(true);
  try {
    const actor = { uid: session.uid, first_name: session.first_name, last_name: session.last_name };
    if (editCode) {
      await ParlaDb.updateSupportType(editCode, { name, description, color });
      await ParlaDb.logActivity(
        "updated",
        "support_type",
        editCode,
        code,
        `Destek türü güncellendi: ${code}`,
        actor
      );
      toast("Destek türü güncellendi.", "info");
    } else {
      await ParlaDb.createSupportType({ code, name, description, color, is_active: true });
      await ParlaDb.logActivity(
        "created",
        "support_type",
        code,
        name,
        `Yeni destek türü: ${code}`,
        actor
      );
      toast("Destek türü oluşturuldu.", "info");
    }
    closeModal("type-modal");
    await loadData();
  } catch (err) {
    handleError(err, "Kayıt başarısız");
  } finally {
    showLoading(false);
  }
}

async function toggleActive(code, isActive) {
  showLoading(true);
  try {
    await ParlaDb.updateSupportType(code, { is_active: isActive });
    await ParlaDb.logActivity(
      "updated",
      "support_type",
      code,
      code,
      `Destek türü ${isActive ? "aktifleştirildi" : "pasifleştirildi"}`,
      { uid: session.uid, first_name: session.first_name, last_name: session.last_name }
    );
    toast(isActive ? "Tür aktif." : "Tür pasif.", "info");
    await loadData();
  } catch (err) {
    handleError(err, "Durum güncellenemedi");
  } finally {
    showLoading(false);
  }
}
