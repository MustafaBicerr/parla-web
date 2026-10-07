/**
 * Parla BT Ticket V2 — talep detayı (müşteri + admin)
 */
import ParlaDb from "../firebase-client.js";
import ParlaEmailService from "../email-service.js";
import { markTicketSeen } from "../notifications.js";
import {
  bindAttachmentClicks,
  bindFilePicker,
  renderAttachmentChips,
  renderFilePicker,
  uploadAttachments,
} from "../attachments.js";
import { reportEmailResult, reportEmailResults } from "../email-report.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderTimeline,
  renderBreadcrumb,
  renderStatusBadge,
  renderPriorityBadge,
  renderTypeBadge,
  showLoading,
  handleError,
  handleLoadError,
  loadingStateHtml,
  errorStateHtml,
  withInflight,
  withTimeout,
  toast,
  formatDateTime,
  escapeHtml,
  renderModal,
  openModal,
  closeModal,
} from "../ui-shell.js";
import { isPermissionError } from "../ui-states.js";
import { isSafeId, safeHttpUrl, safeText } from "../safe-utils.js";
import { TICKET_LIMITS } from "../validators.js";
import {
  computeSla,
  customerLifecycle,
  REOPEN_WINDOW_DAYS,
  STATUS_LABELS,
  PRIORITY_LABELS,
  STATUSES,
  isAdminRole,
  formatStatusLabel,
  formatPriorityLabel,
  formatSapModuleLabel,
  getTicketKey,
  normalizeStatusCode,
  isDeletedTicket,
} from "../ticket-utils.js";

const app = document.getElementById("sv2-app");
let session = null;
let ticket = null;
let messages = [];
let history = [];
let personnel = [];
let assignments = [];

function getTicketId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

/** Yanıt/yazma işlemleri bağlantı kopukken süresiz asılı kalmasın (MUS-21, SEN-24). */
const WRITE_TIMEOUT_MSG =
  "Bağlantı yok ya da çok yavaş: işlem tamamlanamadı. Bağlantı gelince talebi yenileyip kontrol edin; gönderilmediyse yeniden deneyin.";

async function getTicketHistory(ticketId) {
  const snap = await window.__PARLA_FIREBASE.db.get(
    ParlaDb.v2Ref(`ticket_history/${ticketId}`)
  );
  const items = ParlaDb.snapshotToArray(snap);
  return items.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));
}

function formatHistoryMessage(entry) {
  const field = safeText(entry.field_changed);
  const action = safeText(entry.action);

  if (action === "created") {
    return `Talep oluşturuldu: ${safeText(entry.new_value)}`;
  }
  if (field === "status") {
    const base = `Durum değişti: ${formatStatusLabel(entry.old_value)} → ${formatStatusLabel(entry.new_value)}`;
    // Personelin/müşterinin durum değişikliği notu (ör. çözüm özeti) aynı satırda görünür (tek satır).
    return entry.note ? `${base} — ${safeText(entry.note)}` : base;
  }
  if (field === "priority") {
    return `Öncelik değişti: ${formatPriorityLabel(entry.old_value)} → ${formatPriorityLabel(entry.new_value)}`;
  }
  if (field === "assigned_to_name") {
    return `Danışman atandı: ${safeText(entry.new_value) || "—"}`;
  }
  if (entry.note) return safeText(entry.note);
  return safeText(entry.new_value) || action || "Güncelleme yapıldı";
}

function historyToTimeline(items) {
  // Aynı geçişin hem otomatik (status_changed) hem de notlu (status_note) kaydı varsa yalnızca notlu olanı göster.
  const noted = items.filter((h) => h.action === "status_note");
  // Müşteriye iç bilgi gösterilmez: ham personel kimliği (eski kayıtlar), ikincil danışman, efor, arşiv işlemleri (SEN-32).
  const INTERNAL_ONLY = ["assignment", "effort", "is_deleted", "ticket_type", "assigned_to_id"];
  items = items.filter((h) => !INTERNAL_ONLY.includes(safeText(h.field_changed)));
  const visible = items.filter(
    (h) =>
      !(
        h.action === "status_changed" &&
        noted.some(
          (n) =>
            normalizeStatusCode(n.new_value) === normalizeStatusCode(h.new_value) &&
            Math.abs(new Date(n.changed_at) - new Date(h.changed_at)) < 60000
        )
      )
  );
  const out = [];
  for (const h of visible) {
    try {
      out.push({
        author: safeText(h.changed_by_name) || "Sistem",
        created_at: h.changed_at,
        message: formatHistoryMessage(h),
        variant: "admin",
      });
    } catch (err) {
      console.warn("[Parla V2] geçmiş kaydı atlandı", err); // zehirli kayıt sayfayı düşürmez (SEC-02)
    }
  }
  return out;
}

function messagesToTimeline(items, isAdmin) {
  const visible = isAdmin ? items : items.filter((m) => !m.is_internal);
  const out = [];
  for (const m of visible) {
    try {
      out.push({
        author: safeText(m.author_name) || "Kullanıcı",
        created_at: m.created_at,
        message: safeText(m.message),
        attachments_html: renderAttachmentChips(m.attachments, getTicketKey(ticket), m.is_internal),
        author_role: m.author_role,
        variant: m.is_internal ? "internal" : m.author_role === "customer" ? "customer" : "admin",
      });
    } catch (err) {
      console.warn("[Parla V2] mesaj kaydı atlandı", err);
    }
  }
  return out;
}

function renderAdminPanel() {
  const statusOptions = Object.entries(STATUS_LABELS)
    .map(
      ([value, label]) =>
        `<option value="${value}"${ticket.status === value ? " selected" : ""}>${label}</option>`
    )
    .join("");

  const priorityOptions = Object.entries(PRIORITY_LABELS)
    .map(
      ([value, label]) =>
        `<option value="${value}"${ticket.priority === value ? " selected" : ""}>${label}</option>`
    )
    .join("");

  const personnelOptions =
    `<option value="">— Atanmadı —</option>` +
    personnel
      .filter((p) => p.is_active !== false)
      .map((p) => {
        const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
        const id = p.personnel_id || p.id;
        const selected = ticket.assigned_to_id === id ? " selected" : "";
        return `<option value="${escapeHtml(id)}" data-name="${escapeHtml(name)}"${selected}>${escapeHtml(name)}</option>`;
      })
      .join("");

  return `
    <div class="sv2-section" id="sv2-admin-panel">
      <div class="sv2-section-header">
        <h3><i class="fas fa-user-shield"></i> Yönetici Paneli</h3>
      </div>
      <div class="sv2-section-body">
        <form id="sv2-admin-form">
          <div class="sv2-form-row">
            <div class="sv2-form-group">
              <label for="sv2-admin-status">Durum</label>
              <select id="sv2-admin-status" name="status">${statusOptions}</select>
            </div>
            <div class="sv2-form-group">
              <label for="sv2-admin-priority">Öncelik</label>
              <select id="sv2-admin-priority" name="priority">${priorityOptions}</select>
            </div>
          </div>
          <div class="sv2-form-group">
            <label for="sv2-admin-assign">Danışman</label>
            <select id="sv2-admin-assign" name="assigned_to_id">${personnelOptions}</select>
          </div>
          <button type="submit" class="sv2-btn sv2-btn-primary sv2-btn-sm">
            <i class="fas fa-save"></i> Değişiklikleri Kaydet
          </button>
        </form>
      </div>
    </div>`;
}

function renderReplyBox(isAdmin) {
  if (isAdmin) {
    return `
      <div class="sv2-reply-box" id="sv2-reply-box">
        <h3 class="sv2-reply-title">Yanıt Yaz</h3>
        <textarea id="sv2-reply-message" data-keep-draft maxlength="${TICKET_LIMITS.message}" placeholder="Müşteriye veya ekibe yanıt yazın..." rows="4"></textarea>
        ${renderFilePicker("sv2-reply")}
        <div class="sv2-reply-actions">
          <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;cursor:pointer">
            <input type="checkbox" id="sv2-reply-internal"> Dahili not (müşteri görmez)
          </label>
          <div style="display:flex;align-items:center;gap:0.75rem">
            <label style="font-size:0.875rem;display:flex;align-items:center;gap:0.35rem">
              Çalışma saati:
              <input type="number" id="sv2-reply-hours" min="0" step="0.25" value="0">
            </label>
            <button type="button" class="sv2-btn sv2-btn-primary sv2-btn-sm" id="sv2-send-reply">
              <i class="fas fa-paper-plane"></i> Gönder
            </button>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="sv2-reply-box" id="sv2-reply-box">
      <h3 class="sv2-reply-title">Yanıt Yaz</h3>
      <textarea id="sv2-reply-message" data-keep-draft maxlength="${TICKET_LIMITS.message}" placeholder="Danışmanınıza yanıt yazın..." rows="4"></textarea>
      ${renderFilePicker("sv2-reply")}
      <div class="sv2-reply-actions">
        <span style="font-size:0.8125rem;color:var(--sv2-gray-500)">Yanıtınız danışman ekibimize iletilecektir.</span>
        <button type="button" class="sv2-btn sv2-btn-primary sv2-btn-sm" id="sv2-send-reply">
          <i class="fas fa-paper-plane"></i> Yanıt Gönder
        </button>
      </div>
    </div>`;
}

/** Müşteri tarafı yaşam döngüsü bandı: kapanış onayı, yeniden açma ve bilgilendirme. */
function renderLifecycleBanner() {
  const lc = customerLifecycle(ticket);
  const actions = (approve, reopen) => `
    <div class="sv2-lifecycle-actions">
      ${approve ? `<button type="button" class="sv2-btn sv2-btn-primary" id="sv2-approve-close"><i class="fas fa-check"></i> Onayla ve Kapat</button>` : ""}
      ${reopen ? `<button type="button" class="sv2-btn sv2-btn-outline" id="sv2-reopen-ticket"><i class="fas fa-undo"></i> Yeniden Aç</button>` : ""}
    </div>`;
  const banner = (kind, icon, title, text, extra) => `
    <div class="sv2-lifecycle sv2-lifecycle--${kind}" id="sv2-lifecycle-banner">
      <div class="sv2-lifecycle-icon"><i class="fas ${icon}" aria-hidden="true"></i></div>
      <div class="sv2-lifecycle-body"><h2 class="sv2-lifecycle-title">${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p></div>
      ${extra || ""}
    </div>`;

  switch (lc.status) {
    case STATUSES.PENDING_CLOSE:
      return banner(
        "pending_close",
        "fa-clipboard-check",
        "Kapanış onayınız bekleniyor",
        "Danışmanımız çözümü tamamladığını bildirdi. Sorun giderildiyse talebi kapatın; devam ediyorsa nedenini yazarak yeniden açın.",
        actions(true, true)
      );
    case STATUSES.RESOLVED:
      return banner(
        "resolved",
        "fa-check-circle",
        "Talebiniz çözüldü",
        "Çözümü kontrol edin. Memnunsanız talebi kapatabilir, sorun sürüyorsa yeniden açabilirsiniz.",
        actions(lc.canApprove, lc.canReopen)
      );
    case STATUSES.WAITING_CUSTOMER:
      return banner(
        "waiting",
        "fa-user-clock",
        "Yanıtınız bekleniyor",
        "Danışmanımız çözümü test etmenizi veya ek bilgi vermenizi bekliyor. Aşağıdaki Mesajlar bölümünden yanıt yazın."
      );
    case STATUSES.REOPENED:
      return banner("reopened", "fa-undo", "Talebiniz yeniden açıldı", "Danışmanımız kaydı yeniden inceliyor; gelişmeleri e-posta ile bildireceğiz.");
    case STATUSES.CLOSED:
      return lc.canReopen
        ? banner(
            "closed",
            "fa-lock",
            "Talep kapatıldı",
            `Sorun tekrar ederse kapanıştan sonraki ${REOPEN_WINDOW_DAYS} gün içinde talebi yeniden açabilirsiniz.`,
            actions(false, true)
          )
        : banner("closed", "fa-lock", "Talep kapatıldı", `Yeniden açma süresi (${REOPEN_WINDOW_DAYS} gün) doldu; yeni bir talep oluşturabilirsiniz.`);
    default:
      return "";
  }
}

function openLifecycleModal(kind) {
  const isReopen = kind === "reopen";
  renderModal("sv2-lifecycle-modal", {
    title: isReopen ? "Talebi Yeniden Aç" : "Talebi Kapat",
    body: `
      <p class="sv2-subtitle">${
        isReopen
          ? "Sorunun neden devam ettiğini kısaca yazın; danışmanımız talebi yeniden ele alacak."
          : "Talep kapatılacak. İsterseniz danışmanımıza bir not bırakabilirsiniz."
      }</p>
      <div class="sv2-form-group">
        <label for="sv2-lifecycle-note">${isReopen ? "Yeniden açma gerekçesi *" : "Not (isteğe bağlı)"}</label>
        <textarea id="sv2-lifecycle-note" rows="4" maxlength="1000" placeholder="${isReopen ? "En az 10 karakter" : "Örn. Çözüm için teşekkürler."}"></textarea>
        <span class="sv2-field-error" id="sv2-lifecycle-error" hidden></span>
      </div>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="sv2-lifecycle-modal">Vazgeç</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-lifecycle-confirm">${isReopen ? "Yeniden Aç" : "Onayla ve Kapat"}</button>`,
  });
  openModal("sv2-lifecycle-modal");

  const confirmBtn = document.getElementById("sv2-lifecycle-confirm");
  confirmBtn?.addEventListener("click", () => {
    // Enter/Boşluk tekrarı ikinci "yeniden açma gerekçesi"/onay yazmasın (MUS-11).
    withInflight(confirmBtn, async () => {
      const note = document.getElementById("sv2-lifecycle-note").value.trim();
      const errEl = document.getElementById("sv2-lifecycle-error");
      if (isReopen && note.length < 10) {
        errEl.textContent = "Lütfen en az 10 karakterlik bir gerekçe yazın.";
        errEl.hidden = false;
        return;
      }
      closeModal("sv2-lifecycle-modal");
      await (isReopen ? reopenTicket(note) : approveClosure(note));
    });
  });
}

/** `refs`: { history_id } / { message_id } — e-posta metnini sunucu bu kayıtlardan okur (istemci metin göndermez). */
async function notifyStaff(eventType, updated, refs, actor) {
  const recipients = ParlaEmailService.uniqueEmails(staffRecipients(), session.email);
  const res = await ParlaEmailService.notifyTicketEvent(eventType, recipients, updated, refs || {});
  await reportEmailResult(res, { eventType, label: "Bildirim e-postası", ticket: updated, actor });
}

/** Durum çakışması: ekran bayatsa anlaşılır ileti + gerçek durumu yenile (yarım kayıt/e-posta yok; SEN-04, MUS-12). */
async function handleLifecycleError(err, context) {
  if (["status_conflict", "invalid_transition", "ticket_deleted"].includes(err?.code)) {
    toast(err.message, "error");
    try {
      await reloadTicket();
    } catch {
      /* yenileme başarısız: ileti yeterli */
    }
    return;
  }
  handleError(err, context);
}

async function approveClosure(note) {
  showLoading(true);
  try {
    const actor = getActor();
    const id = getTicketKey(ticket);
    const report = {};
    const updated = await ParlaDb.updateTicket(id, { status: STATUSES.CLOSED }, actor, {
      expectedStatus: ticket.status,
      note: note ? `Müşteri kapanışı onayladı: ${note}` : "Müşteri kapanışı onayladı.",
      report,
      activity: { action: "ticket_closed", details: "Müşteri kapanışı onayladı" },
    });
    toast("Talebiniz kapatıldı. Teşekkür ederiz.", "success");
    await reloadTicket();
    notifyStaff("ticket_closed", updated, { history_id: report.statusHistoryId }, actor).catch(() => {});
  } catch (err) {
    await handleLifecycleError(err, "Talep kapatma");
  } finally {
    showLoading(false);
  }
}

async function reopenTicket(reason) {
  showLoading(true);
  try {
    const actor = getActor();
    const id = getTicketKey(ticket);
    // Önce durum (koşullu + atomik: geçmiş/aktivite aynı yazımda), başarılıysa gerekçe konuşmaya mesaj olarak eklenir.
    const report = {};
    const updated = await ParlaDb.updateTicket(id, { status: STATUSES.REOPENED }, actor, {
      expectedStatus: ticket.status,
      note: `Müşteri talebi yeniden açtı: ${reason}`,
      report,
      activity: { action: "ticket_reopened", details: "Müşteri talebi yeniden açtı" },
    });
    await ParlaDb.addTicketMessage(id, {
      user_id: session.uid,
      author_name: actor.name,
      author_email: session.email,
      author_role: "customer",
      message: `Yeniden açma gerekçesi: ${reason}`,
      is_internal: false,
    });
    toast("Talebiniz yeniden açıldı.", "success");
    await reloadTicket();
    notifyStaff("ticket_reopened", updated, { history_id: report.statusHistoryId }, actor).catch(() => {});
  } catch (err) {
    await handleLifecycleError(err, "Talebi yeniden açma");
  } finally {
    showLoading(false);
  }
}

function bindLifecycle() {
  document.getElementById("sv2-approve-close")?.addEventListener("click", () => openLifecycleModal("approve"));
  document.getElementById("sv2-reopen-ticket")?.addEventListener("click", () => openLifecycleModal("reopen"));
}

function renderPage() {
  const isAdmin = isAdminRole(session.role);
  const ticketsPath = isAdmin ? PATHS.adminTickets : PATHS.customerTickets;
  const canReply =
    !isAdmin ||
    String(ticket.status).toLowerCase() !== STATUSES.CLOSED;

  // Kapanış onayı bekleyen/çözülmüş talebe yazılan müşteri yanıtı talebi otomatik yeniden açar (karar 28); yalnız kapalı talebe yazılamaz.
  const customerCanReply = !isAdmin && String(ticket.status).toLowerCase() !== STATUSES.CLOSED;

  const showReply = isAdmin ? canReply : customerCanReply;

  const content = `
    ${renderBreadcrumb([
      { label: isAdmin ? "Talepler" : "Taleplerim", href: ticketsPath },
      { label: ticket.ticket_number || "Detay" },
    ])}
    ${isAdmin ? "" : renderLifecycleBanner()}
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>${escapeHtml(ticket.title || "Talep Detayı")}</h3>
        <span style="font-family:var(--sv2-font-mono);font-size:0.875rem;color:var(--sv2-gray-500)">${escapeHtml(ticket.ticket_number || "")}</span>
      </div>
      <div class="sv2-section-body">
        <div class="sv2-meta-grid">
          <div class="sv2-meta-item">
            <label>Durum</label>
            <div>${renderStatusBadge(ticket.status)}</div>
          </div>
          <div class="sv2-meta-item">
            <label>Öncelik</label>
            <div>${renderPriorityBadge(ticket.priority)}</div>
          </div>
          <div class="sv2-meta-item">
            <label>Tip</label>
            <div>${renderTypeBadge(ticket.ticket_type)}</div>
          </div>
          <div class="sv2-meta-item">
            <label>SAP Modülü</label>
            <span>${escapeHtml(formatSapModuleLabel(ticket.sap_module))}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Danışman</label>
            <span>${escapeHtml(ticket.assigned_to_name || "—")}</span>
          </div>
          ${
            computeSla(ticket)
              ? `<div class="sv2-meta-item">
            <label>Hedef Süreler</label>
            <span>İlk yanıt: ${computeSla(ticket).target.response} sa · Çözüm: ${computeSla(ticket).target.resolution} sa</span>
          </div>`
              : ""
          }
          <div class="sv2-meta-item">
            <label>Oluşturulma</label>
            <span>${escapeHtml(formatDateTime(ticket.created_at))}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Firma</label>
            <span>${escapeHtml(ticket.company_name || "—")}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Talep Sahibi</label>
            <span>${escapeHtml(ticket.user_name || "—")}</span>
          </div>
        </div>
        <div class="sv2-ticket-description">
          <h3 class="sv2-meta-label">Açıklama</h3>
          <p>${escapeHtml(ticket.description || "—")}</p>
        </div>
        ${
          // SEC-29/SEN-39: yalnız http(s) bağlantısı tıklanabilir; diğer şemalar (javascript: vb.) düz metin.
          safeHttpUrl(ticket.attachment_url)
            ? `<p style="margin-top:1rem"><a href="${escapeHtml(safeHttpUrl(ticket.attachment_url))}" target="_blank" rel="noopener noreferrer" class="sv2-link"><i class="fas fa-paperclip"></i> Ek dosyayı görüntüle</a></p>`
            : ticket.attachment_url
              ? `<p style="margin-top:1rem" class="sv2-text-muted"><i class="fas fa-paperclip"></i> Ek bağlantı geçersiz (yalnızca http/https adresleri açılır).</p>`
              : ""
        }
      </div>
    </div>
    ${isAdmin ? renderAdminPanel() : ""}
    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Geçmiş</h3></div>
      <div class="sv2-section-body">${renderTimeline(historyToTimeline(history))}</div>
    </div>
    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Mesajlar</h3></div>
      <div class="sv2-section-body">
        ${renderTimeline(messagesToTimeline(messages, isAdmin))}
        ${showReply ? renderReplyBox(isAdmin) : `<p style="color:var(--sv2-gray-500);font-size:0.875rem;margin:0">Bu talep kapatıldığı için yanıt yazılamaz. Gerekirse yukarıdaki düğmeyle yeniden açabilirsiniz.</p>`}
      </div>
    </div>`;

  renderShell(app, {
    title: ticket.ticket_number || "Talep Detayı",
    activePage: "tickets",
    profile: session,
    isAdmin,
    content,
  });

  if (showReply) bindReply(isAdmin);
  if (isAdmin) bindAdminForm();
  else bindLifecycle();
}

function getActor() {
  const name = [session.first_name, session.last_name].filter(Boolean).join(" ");
  // role: durum geçişi damgaları ve yazma yetkisi rol bilgisine göre belirlenir (müşteri yalnız kendi damgalarını yazar).
  return { uid: session.uid, name: name || session.email, email: session.email, role: session.role };
}

/** Müşteri yanıtının bildirileceği ekip: destek kutusu + atanmış tüm danışmanlar. */
function staffRecipients() {
  const cfg = window.__PARLA_SITE_CONFIG || {};
  const emails = [cfg.CONTACT_EMAIL];
  // Atama kayıtları personel e-postasını taşır (müşteri personel listesini okuyamaz).
  assignments.forEach((a) => emails.push(a.personnel_email));
  return emails;
}

function bindReply(isAdmin) {
  const picker = bindFilePicker("sv2-reply");
  const sendBtn = document.getElementById("sv2-send-reply");
  sendBtn?.addEventListener("click", () => {
    // Tek tip "işlem sürüyor" koruması: Enter/Boşluk tekrarı ve hızlı çift tık tek yanıt üretir (MUS-11, UX-04).
    withInflight(sendBtn, () => sendReply(isAdmin, picker));
  });
}

async function sendReply(isAdmin, picker) {
  const textarea = document.getElementById("sv2-reply-message");
  const text = textarea?.value?.trim();
  if (!text || text.length < 3) {
    toast("Lütfen en az 3 karakterlik bir yanıt yazın.", "error");
    return;
  }
  if (text.length > TICKET_LIMITS.message) {
    toast(`Yanıt en fazla ${TICKET_LIMITS.message.toLocaleString("tr-TR")} karakter olabilir.`, "error");
    return;
  }

  showLoading(true);
  try {
    const actor = getActor();
    const isInternal = isAdmin && document.getElementById("sv2-reply-internal")?.checked;
    const workHours = isAdmin ? parseFloat(document.getElementById("sv2-reply-hours")?.value) || 0 : 0;

    const prepared = await picker.getPrepared();
    if (prepared === null) return; // dosya hatası seçicide gösterildi

    await withTimeout(
      (async () => {
        const refs = prepared.length
          ? await uploadAttachments(getTicketKey(ticket), prepared, { internal: !!isInternal, session })
          : [];

        const savedMessage = await ParlaDb.addTicketMessage(getTicketKey(ticket), {
          user_id: session.uid,
          author_name: actor.name,
          author_email: session.email,
          author_role: isAdmin ? session.role : "customer",
          message: text,
          is_internal: !!isInternal,
          work_hours: workHours,
          attachments: refs,
        });

        // Müşteri yanıtı durum geçişi: müşteri bekleniyor → işlemde; kapanış onayı bekliyor/çözüldü → yeniden açıldı (karar 28).
        // Mesaj zaten kaydedildi: ekran bayatsa durum çakışır; yanıt, aktivite ve e-posta yine de tamamlanır (SEN-04).
        let autoReopened = false;
        const reopenReport = {};
        if (!isAdmin) {
          const prev = String(ticket.status || "").toLowerCase();
          const next =
            prev === STATUSES.WAITING_CUSTOMER
              ? STATUSES.IN_PROGRESS
              : prev === STATUSES.PENDING_CLOSE || prev === STATUSES.RESOLVED
                ? STATUSES.REOPENED
                : "";
          if (next) {
            try {
              await ParlaDb.updateTicket(getTicketKey(ticket), { status: next }, actor, {
                expectedStatus: ticket.status,
                note: next === STATUSES.REOPENED ? `Müşteri yanıtı üzerine talep yeniden açıldı: "${text.slice(0, 300)}"` : "",
                report: reopenReport,
                activity: next === STATUSES.REOPENED ? { action: "ticket_reopened", details: "Müşteri yanıtı üzerine otomatik yeniden açıldı" } : undefined,
              });
              autoReopened = next === STATUSES.REOPENED;
            } catch (statusErr) {
              if (!["status_conflict", "invalid_transition", "ticket_deleted"].includes(statusErr?.code) && !isPermissionError(statusErr)) throw statusErr;
            }
          }
        }

        await ParlaDb.logActivity(
          "ticket_message",
          "ticket",
          getTicketKey(ticket),
          ticket.ticket_number,
          isInternal ? "Dahili not eklendi" : "Yeni yanıt",
          actor
        );

        if (!isInternal) {
          const recipients = isAdmin ? [ticket.user_email] : staffRecipients();
          // Yanıt talebi yeniden açtıysa tek e-posta ("tekrar açıldı", yanıt metniyle) gider: kota tasarrufu.
          ParlaEmailService.notifyTicketEvent(
            autoReopened ? "ticket_reopened" : "ticket_message",
            ParlaEmailService.uniqueEmails(recipients, session.email),
            ticket,
            // Metni sunucu kayıttan okur: yeniden açma → durum geçmişi kaydı, normal yanıt → mesaj kaydı.
            autoReopened ? { history_id: reopenReport.statusHistoryId } : { message_id: savedMessage.id }
          )
            .then((res) => reportEmailResult(res, { eventType: "ticket_message", label: "Yanıt bildirimi", ticket, actor }))
            .catch(() => {});
        }
      })(),
      0,
      WRITE_TIMEOUT_MSG
    );

    // Gönderildi: taslak temizlenir (yeniden çizimde geri yazılmasın), sonra liste yenilenir.
    if (textarea) textarea.value = "";
    picker.clear();
    toast("Yanıtınız gönderildi.", "success");
    await reloadTicket();
  } catch (err) {
    handleError(err, "Yanıt gönderme");
  } finally {
    showLoading(false);
  }
}

function bindAdminForm() {
  const adminForm = document.getElementById("sv2-admin-form");
  adminForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    withInflight(adminForm.querySelector('button[type="submit"]') || "admin-form", () => saveAdminForm());
  });
}

async function saveAdminForm() {
  {
    showLoading(true);

    try {
      const actor = getActor();
      const status = document.getElementById("sv2-admin-status").value;
      const priority = document.getElementById("sv2-admin-priority").value;
      const assignSelect = document.getElementById("sv2-admin-assign");
      const assignedId = assignSelect.value;
      const assignedName =
        assignSelect.selectedOptions[0]?.dataset?.name ||
        assignSelect.selectedOptions[0]?.textContent ||
        "";

      const updates = { status, priority, assigned_to_id: assignedId, assigned_to_name: assignedName };
      const updated = await ParlaDb.updateTicket(getTicketKey(ticket), updates, actor);

      await ParlaDb.logActivity(
        "ticket_updated",
        "ticket",
        getTicketKey(ticket),
        ticket.ticket_number,
        "Yönetici güncellemesi",
        actor
      );

      const notifications = [];
      if (assignedId && assignedId !== ticket.assigned_to_id) {
        const assignedPerson = personnel.find((p) => (p.personnel_id || p.id) === assignedId);
        if (assignedPerson?.email && assignedPerson.email !== session.email) {
          notifications.push(
            ParlaEmailService.notifyTicketEvent("ticket_assigned", assignedPerson.email, updated, {
              note: "Size yeni bir talep atandı.",
            })
          );
        }
      }

      if (status !== ticket.status && ticket.user_email) {
        const eventType =
          status === STATUSES.RESOLVED
            ? "ticket_resolved"
            : status === STATUSES.CLOSED
              ? "ticket_closed"
              : status === STATUSES.WAITING_CUSTOMER
                ? "send_to_customer"
                : "ticket_status_changed";
        notifications.push(ParlaEmailService.notifyTicketEvent(eventType, ticket.user_email, updated));
      }

      if (notifications.length) {
        Promise.all(notifications)
          .then((results) =>
            reportEmailResults(results, { eventType: "ticket_updated", label: "Güncelleme bildirimi", ticket, actor })
          )
          .catch(() => {});
      }

      toast("Talep güncellendi.", "success");
      await reloadTicket();
    } catch (err) {
      handleError(err, "Güncelleme");
    } finally {
      showLoading(false);
    }
  }
}

async function reloadTicket() {
  const id = getTicketKey(ticket);
  const [t, msgs, hist] = await Promise.all([
    ParlaDb.getTicket(id),
    ParlaDb.getTicketMessages(id, { includeInternal: isAdminRole(session.role) }),
    getTicketHistory(id),
  ]);
  ticket = t;
  messages = msgs;
  history = hist;
  renderPage();
}

function shellOptions(extra) {
  const isAdmin = isAdminRole(session.role);
  return { title: "Talep Detayı", activePage: "tickets", profile: session, isAdmin, ...(extra || {}) };
}

/** Olmayan / yetkisiz / başkasına ait talep: kabuk + anlaşılır mesaj (MUS-07, SEN-06, UX-02). */
function renderUnavailable(message) {
  const isAdmin = isAdminRole(session.role);
  renderShell(
    app,
    shellOptions({
      title: "Talep bulunamadı",
      content: errorStateHtml({
        icon: "fa-lock",
        title: "Bu talebe ulaşılamıyor",
        message: message || "Talep bulunamadı ya da bu talebi görüntüleme yetkiniz yok. Bağlantı başka bir kullanıcıya ait ya da silinmiş olabilir.",
        retry: false,
        actions: [{ label: isAdmin ? "Taleplere dön" : "Taleplerime dön", href: isAdmin ? PATHS.adminTickets : PATHS.customerTickets }],
      }),
    })
  );
}

async function loadTicket(ticketId) {
  showLoading(true);
  let ticketLoaded = false;
  try {
    ticket = await ParlaDb.getTicket(ticketId);
    ticketLoaded = !!ticket;
    if (!ticket) {
      renderUnavailable();
      return;
    }

    const isAdmin = isAdminRole(session.role);
    const isCompanyColleague =
      session.role === "company_admin" && !!session.company_id && ticket.company_id === session.company_id;
    if (!isAdmin && ticket.user_id !== session.uid && !isCompanyColleague) {
      renderUnavailable();
      return;
    }
    // Yumuşak silinmiş (arşivdeki) talep müşteriye görünmez (D-05 B).
    if (!isAdmin && isDeletedTicket(ticket)) {
      renderUnavailable();
      return;
    }

    // Atamalar müşteri için de gerekli: yanıt bildirimi atanan danışmanlara gider.
    [messages, history, personnel, assignments] = await Promise.all([
      ParlaDb.getTicketMessages(ticketId, { includeInternal: isAdmin }),
      getTicketHistory(ticketId),
      isAdmin ? ParlaDb.getAllPersonnel() : Promise.resolve([]),
      ParlaDb.getTicketAssignments(ticketId).catch(() => []),
    ]);

    markTicketSeen(session.uid, ticket);
    renderPage();
  } catch (err) {
    // İlk okuma reddedilirse talep yok ya da başkasına ait demektir (kurallar ikisini ayırt ettirmez).
    if (!ticketLoaded && isPermissionError(err)) {
      renderUnavailable();
    } else {
      handleLoadError(err, "Talep yüklenemedi", {
        retry: () => loadTicket(ticketId),
        activePage: "tickets",
        pageTitle: "Talep Detayı",
        isAdmin: isAdminRole(session.role),
      });
    }
  } finally {
    showLoading(false);
  }
}

async function init() {
  bindAttachmentClicks();
  const ticketId = getTicketId();
  showLoading(true);
  try {
    session = await requireAuth();
    if (isAdminRole(session.role)) {
      // EML-15 / SEN-07: bu sayfa MÜŞTERİ görünümüdür. Eski "Yönetici Paneli" personele kapatıldı (yanlış şablon, atama kaydı
      // yazılmaması, not zorunluluğu yokluğu); personel aynı talebin yönetim sayfasına yönlendirilir.
      const target = ticketId && isSafeId(ticketId) ? `${PATHS.adminTicketDetail}?id=${encodeURIComponent(ticketId)}` : PATHS.adminTickets;
      window.location.replace(target);
      return;
    }
    if (!ticketId || !isSafeId(ticketId)) {
      renderUnavailable(ticketId ? "Bağlantıdaki talep kimliği geçersiz." : "Talep kimliği belirtilmedi.");
      return;
    }
    renderShell(app, shellOptions({ content: loadingStateHtml("Talep yükleniyor…") }));
    await loadTicket(ticketId);
  } catch {
    /* requireAuth yönlendirir ya da hata kartını kendisi çizer */
  } finally {
    showLoading(false);
  }
}

init();
