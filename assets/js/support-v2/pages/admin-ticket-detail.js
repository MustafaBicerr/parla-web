/**
 * Parla BT Ticket V2 — Admin Talep Detayı
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderBreadcrumb,
  renderTabs,
  renderTimeline,
  renderStatusBadge,
  renderPriorityBadge,
  renderSlaBadge,
  renderTypeBadge,
  renderEmptyState,
  renderDataTable,
  toast,
  showLoading,
  handleError,
  handleLoadError,
  withInflight,
  linkUser,
  linkCompany,
  linkPersonnel,
  linkProject,
  renderModal,
  openModal,
  closeModal,
  renderConfirmDialog,
  formatDate,
  formatDateTime,
  escapeHtml,
} from "../ui-shell.js";
import {
  STATUSES,
  STATUS_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  ROLES,
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
  formatStatusLabel,
  formatPriorityLabel,
  formatSapModuleLabel,
  getTicketKey,
  allowedTransitions,
  statusSelectOptions,
  normalizeStatusCode,
  findPersonnelForSession,
  istanbulDateISO,
  isDeletedTicket,
  validateEffortInput,
  validateReplyHours,
  EFFORT_LIMITS,
} from "../ticket-utils.js";
import { minLength } from "../validators.js";
import { sortTemplates, renderReplyTemplate } from "../entity-utils.js";
import { safeHttpUrl, safeNumber, safeText } from "../safe-utils.js";
import ParlaEmailService from "../email-service.js";
import { markTicketSeen } from "../notifications.js";
import {
  attachmentsNote,
  bindAttachmentClicks,
  bindFilePicker,
  renderAttachmentChips,
  renderFilePicker,
  uploadAttachments,
} from "../attachments.js";
import { reportEmailResults } from "../email-report.js";

const ADMIN_ROLES = ["super_admin", "service_admin", "project_manager", "consultant"];

let session = null;
let ticket = null;
let messages = [];
let history = [];
let allPersonnel = [];
let assignments = [];
let efforts = [];
let activeTab = "messages";
let replyPicker = null;
let replyTemplates = []; // hazır yanıt şablonları (WP-16)
let allProjects = []; // PRJ talebinde proje seçimi (D-11 A)

function getTicketId() {
  return new URLSearchParams(window.location.search).get("id");
}

function actorName() {
  return [session.first_name, session.last_name].filter(Boolean).join(" ") || session.email;
}

function getMyPersonnel() {
  // Önce açık kimlik bağı (personel.uid), yoksa e-posta (yedek).
  return findPersonnelForSession(allPersonnel, session);
}

function canManageTicket() {
  return [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN, ROLES.PROJECT_MANAGER].includes(session?.role);
}

function isAdminOnly() {
  return [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN].includes(session?.role);
}

/** Danışmanın bu talepte atanmışlığı: kayıtlı atama (personel eşleşmesiyle) ya da talepteki assigned_uids haritası. */
function consultantAssignmentState() {
  const me = getMyPersonnel();
  const pid = me ? me.personnel_id || me.id : "";
  const byPersonnel = !!pid && assignments.some((a) => (a.personnel_id || a.id) === pid);
  const byUid = ticket?.assigned_uids?.[session?.uid] === true;
  // Yazma yetkisi kurallarda assigned_uids haritasına bağlıdır (D-08): atama var ama harita yoksa danışman yazamaz.
  return { assigned: byPersonnel || byUid, writable: byUid, unlinked: byPersonnel && !byUid };
}

function isAssignedConsultant() {
  return consultantAssignmentState().assigned;
}

/** Bu kullanıcı bu talepte yazabilir mi (durum/yanıt/iç not/efor)? Yöneticiler her zaman, danışman yalnız atandığı talepte. */
function canWriteTicket() {
  if (isDeletedTicket(ticket)) return false;
  if (canManageTicket()) return true;
  return session?.role === ROLES.CONSULTANT && consultantAssignmentState().writable;
}

function isTicketClosed() {
  return String(ticket?.status || "").toLowerCase() === STATUSES.CLOSED;
}

/** Durum açılırı yalnız izinli geçişleri listeler; süper admin için matris dışı seçenekler ayrı gruptadır. */
function statusOptions(selected) {
  const { current, allowed, override } = statusSelectOptions(selected, {
    role: session?.role,
    hasAssignee: !!ticket?.assigned_to_id || assignments.length > 0,
  });
  const opt = (s, suffix) => `<option value="${s}"${s === current ? " selected" : ""}>${escapeHtml(STATUS_LABELS[s])}${suffix || ""}</option>`;
  let html = opt(current, " (mevcut)");
  html += allowed.map((s) => opt(s)).join("");
  if (override.length) {
    html += `<optgroup label="Matris dışı (yalnız Süper Admin — gerekçe zorunlu)">${override.map((s) => opt(s)).join("")}</optgroup>`;
  }
  return html;
}

function typeOptions(selected) {
  return Object.values(TICKET_TYPES)
    .map((t) => `<option value="${t}"${t === String(selected || "").toUpperCase() ? " selected" : ""}>${escapeHtml(t)} — ${escapeHtml(TICKET_TYPE_LABELS[t] || t)}</option>`)
    .join("");
}

/** PRJ talebinde seçilebilir projeler: talebin firmasının projeleri + (varsa) mevcut proje. */
function projectOptions(selectedId) {
  const list = allProjects
    .filter((p) => (p.id || p.project_id) === selectedId || (p.company_id === ticket.company_id && p.status !== "cancelled"))
    .sort((a, b) => String(a.project_code || "").localeCompare(String(b.project_code || ""), "tr"));
  return list
    .map((p) => {
      const id = p.id || p.project_id;
      return `<option value="${escapeHtml(id)}"${id === selectedId ? " selected" : ""}>${escapeHtml(p.project_code || "")} — ${escapeHtml(p.name || "")}</option>`;
    })
    .join("");
}

function projectNameFor(id) {
  const p = allProjects.find((x) => (x.id || x.project_id) === id);
  return p ? `${p.project_code || ""} — ${p.name || ""}`.trim() : id || "";
}

function priorityOptions(selected) {
  return Object.values(PRIORITIES)
    .map((p) => {
      const sel = p === selected ? " selected" : "";
      return `<option value="${p}"${sel}>${escapeHtml(PRIORITY_LABELS[p])}</option>`;
    })
    .join("");
}

function personnelAssignmentCheckboxes() {
  const assignedIds = new Set(assignments.map((a) => a.personnel_id || a.id));
  const primaryId =
    assignments.find((a) => a.is_primary)?.personnel_id ||
    assignments.find((a) => a.is_primary)?.id ||
    ticket.assigned_to_id ||
    "";

  // Pasif danışman atanmışsa listede (işaretli, "pasif" etiketiyle) kalır: ilgisiz bir güncelleme onu sessizce çıkarmaz.
  const listed = allPersonnel.filter((p) => p.is_active !== false || assignedIds.has(p.personnel_id || p.id));
  // Kişi kaydı bulunamayan eski atamalar da (silinmiş personel) görünür kalsın.
  const known = new Set(allPersonnel.map((p) => p.personnel_id || p.id));
  const orphans = assignments
    .filter((a) => !known.has(a.personnel_id || a.id))
    .map((a) => ({ personnel_id: a.personnel_id || a.id, first_name: a.personnel_name || "", last_name: "", is_active: false }));
  return [...listed, ...orphans]
    .sort((a, b) =>
      `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "tr")
    )
    .map((p) => {
      const id = p.personnel_id || p.id;
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ") + (p.is_active === false ? " (pasif)" : "");
      const checked = assignedIds.has(id);
      const isPrimary = id === primaryId;
      return `<div class="sv2-assign-row${checked ? " is-assigned" : ""}" data-id="${escapeHtml(id)}">
        <div class="sv2-assign-col sv2-assign-col-check">
          <input type="checkbox" class="sv2-assign-check" id="sv2-assign-${escapeHtml(id)}" value="${escapeHtml(id)}" data-name="${escapeHtml(name)}"${checked ? " checked" : ""} aria-label="${escapeHtml(name)} — talebe ata">
        </div>
        <label class="sv2-assign-col sv2-assign-col-name" for="sv2-assign-${escapeHtml(id)}">${escapeHtml(name)}</label>
        <div class="sv2-assign-col sv2-assign-col-primary">
          <input type="radio" name="sv2-primary-consultant" class="sv2-assign-primary" id="sv2-primary-${escapeHtml(id)}" value="${escapeHtml(id)}"${isPrimary ? " checked" : ""}${checked ? "" : " disabled"} aria-label="${escapeHtml(name)} — birincil danışman">
          <label class="sv2-assign-primary-label" for="sv2-primary-${escapeHtml(id)}" title="Birincil danışman">Birincil</label>
        </div>
      </div>`;
    })
    .join("");
}

function effortByPersonnel() {
  const map = {};
  for (const e of efforts) {
    const pid = e.personnel_id || "unknown";
    map[pid] = (map[pid] || 0) + (parseFloat(e.hours) || 0);
  }
  return map;
}

function renderAssignmentsTable() {
  const totals = effortByPersonnel();
  const rows = assignments.map((a) => {
    const pid = a.personnel_id || a.id;
    return {
      id: pid,
      name: a.personnel_name || "—",
      assigned_at: a.assigned_at,
      hours: totals[pid] || 0,
      is_primary: a.is_primary,
    };
  });

  if (!rows.length) {
    return renderEmptyState("Henüz danışman atanmadı.", "fa-user-tie");
  }

  return renderDataTable({
    columns: [
      {
        key: "name",
        label: "DANIŞMAN",
        render: (v, row) =>
          `${row.is_primary ? '<span class="sv2-badge sv2-badge-assigned" style="margin-right:0.35rem">Birincil</span>' : ""}${escapeHtml(v)}`,
      },
      {
        key: "assigned_at",
        label: "ATAMA TARİHİ",
        render: (v) => escapeHtml(formatDateTime(v)),
      },
      {
        key: "hours",
        label: "EFOR (SAAT)",
        render: (v) => escapeHtml(String(Math.round(v * 100) / 100)),
      },
    ],
    rows,
  });
}

function renderEffortsTable() {
  // Silme: yönetici roller her kaydı, danışman yalnız kendi girdiği kaydı silebilir (K-PER-9).
  const writable = canWriteTicket();
  const rows = efforts.map((e) => ({
    id: e.effort_id || e.id,
    personnel_name: e.personnel_name || "—",
    work_date: e.work_date,
    hours: e.hours,
    note: e.note || "—",
    created_by_name: e.created_by_name || "—",
    can_delete: writable && (canManageTicket() || e.created_by_uid === session?.uid),
  }));
  const canDelete = rows.some((r) => r.can_delete);

  if (!rows.length) {
    return renderEmptyState("Henüz efor kaydı yok.", "fa-clock");
  }

  return renderDataTable({
    columns: [
      { key: "personnel_name", label: "DANIŞMAN" },
      { key: "work_date", label: "TARİH", render: (v) => escapeHtml(formatDate(v)) },
      { key: "hours", label: "SAAT" },
      { key: "note", label: "NOT" },
      { key: "created_by_name", label: "GİREN" },
      ...(canDelete
        ? [
            {
              key: "id",
              label: "İŞLEM",
              render: (_, row) =>
                row.can_delete
                  ? `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-outline sv2-effort-del" data-id="${escapeHtml(row.id)}">Sil</button>`
                  : "",
            },
          ]
        : []),
    ],
    rows,
  });
}

/** Durum -> bildirim tipi. Müşteri adına yapılan geçişler kendi şablonlarını kullanır. */
function eventForStatus(status) {
  switch (status) {
    case STATUSES.RESOLVED:
      return "ticket_resolved";
    case STATUSES.CLOSED:
      return "ticket_closed";
    case STATUSES.WAITING_CUSTOMER:
      return "send_to_customer";
    case STATUSES.PENDING_CLOSE:
      return "ticket_close_approval";
    default:
      return "ticket_status_changed";
  }
}

/** Yaşam döngüsü hızlı işlemleri: durum makinesinin izinli geçişlerinden, role uygun olanlar. */
function quickActionList() {
  const s = String(ticket.status || "").toLowerCase() || STATUSES.OPEN;
  const manager = canManageTicket();
  const allowed = allowedTransitions(s, { role: session?.role, hasAssignee: !!ticket.assigned_to_id || assignments.length > 0 });
  const has = (target) => allowed.includes(target);
  const list = [];
  if (has(STATUSES.IN_PROGRESS) && [STATUSES.OPEN, STATUSES.ASSIGNED, STATUSES.REOPENED].includes(s)) {
    list.push({ id: "sv2-start-work", label: "İşleme Al", icon: "fa-play", primary: true });
  }
  if (has(STATUSES.WAITING_CUSTOMER) && [STATUSES.IN_PROGRESS, STATUSES.REOPENED].includes(s)) {
    list.push({ status: STATUSES.WAITING_CUSTOMER, label: "Müşteri Testine Gönder", icon: "fa-user-clock" });
  }
  if (has(STATUSES.PENDING_CLOSE) && [STATUSES.IN_PROGRESS, STATUSES.REOPENED, STATUSES.WAITING_CUSTOMER].includes(s)) {
    list.push({ status: STATUSES.PENDING_CLOSE, label: "Kapanış Onayı İste", icon: "fa-clipboard-check", primary: true });
  }
  if ((s === STATUSES.WAITING_CUSTOMER || s === STATUSES.PENDING_CLOSE) && has(STATUSES.IN_PROGRESS)) {
    list.push({ status: STATUSES.IN_PROGRESS, label: "İşleme Geri Al", icon: "fa-undo" });
  }
  if (manager && s === STATUSES.PENDING_CLOSE && has(STATUSES.CLOSED)) {
    list.push({ status: STATUSES.CLOSED, label: "Müşteri Adına Kapat", icon: "fa-lock" });
  }
  if (manager && s === STATUSES.RESOLVED) {
    if (has(STATUSES.CLOSED)) list.push({ status: STATUSES.CLOSED, label: "Kapat", icon: "fa-lock", primary: true });
    if (has(STATUSES.IN_PROGRESS)) list.push({ status: STATUSES.IN_PROGRESS, label: "Çözümü Geri Al", icon: "fa-undo" });
  }
  if (manager && s === STATUSES.CLOSED && has(STATUSES.REOPENED)) {
    list.push({ status: STATUSES.REOPENED, label: "Yeniden Aç", icon: "fa-undo" });
  }
  return list;
}

function renderQuickActions() {
  const actions = quickActionList();
  const hint =
    String(ticket.status || "").toLowerCase() === STATUSES.PENDING_CLOSE
      ? `<p class="sv2-text-muted" style="font-size:0.8125rem;margin:0.5rem 0 0"><i class="fas fa-hourglass-half"></i> Müşterinin kapanış onayı bekleniyor; onaylarsa talep otomatik kapanır, reddederse "Tekrar Açıldı" durumuna geçer.</p>`
      : "";
  if (!actions.length && !hint) return "";
  const buttons = actions
    .map((a) =>
      a.id
        ? `<button type="button" class="sv2-btn sv2-btn-primary sv2-btn-sm" id="${a.id}"><i class="fas ${a.icon}"></i> ${escapeHtml(a.label)}</button>`
        : `<button type="button" class="sv2-btn ${a.primary ? "sv2-btn-primary" : "sv2-btn-outline"} sv2-btn-sm sv2-quick-status" data-status="${a.status}"><i class="fas ${a.icon}"></i> ${escapeHtml(a.label)}</button>`
    )
    .join("");
  return `
    <div class="sv2-quick-actions sv2-mb-1" id="sv2-quick-actions">
      <label style="display:block;font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--sv2-gray-500);font-weight:600;margin-bottom:0.5rem">Hızlı İşlemler</label>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">${buttons}</div>
      ${hint}
    </div>`;
}

function openQuickStatusModal(status) {
  const label = STATUS_LABELS[status] || status;
  const help = {
    [STATUSES.WAITING_CUSTOMER]: "Müşteriye test/bilgi isteği olarak iletilecek. Ne kontrol etmesi gerektiğini yazın.",
    [STATUSES.PENDING_CLOSE]: "Müşteriye kapanış onayı e-postası gidecek. Yapılan çözümü kısaca özetleyin.",
    [STATUSES.CLOSED]: "Talep müşteri adına kapatılacak. Kapanış gerekçesini yazın.",
    [STATUSES.REOPENED]: "Talep yeniden açılacak. Gerekçeyi yazın.",
    [STATUSES.IN_PROGRESS]: "Talep yeniden işleme alınacak. Gerekçeyi yazın.",
  }[status] || "Değişiklik notunu yazın.";
  renderModal("sv2-quick-status-modal", {
    title: `Durum: ${label}`,
    body: `
      <p class="sv2-subtitle">${escapeHtml(help)}</p>
      <div class="sv2-form-group">
        <label for="sv2-quick-note">Not * <span class="sv2-text-muted">(en az 10 karakter; müşteriye de iletilir)</span></label>
        <textarea id="sv2-quick-note" rows="4" maxlength="1000"></textarea>
        <span class="sv2-field-error" id="sv2-quick-error" hidden></span>
      </div>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="sv2-quick-status-modal">Vazgeç</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-quick-confirm">Durumu Kaydet</button>`,
  });
  openModal("sv2-quick-status-modal");
  const quickConfirmBtn = document.getElementById("sv2-quick-confirm");
  quickConfirmBtn?.addEventListener("click", () => withInflight(quickConfirmBtn, async () => {
    const note = document.getElementById("sv2-quick-note").value.trim();
    if (!minLength(note, 10)) {
      const err = document.getElementById("sv2-quick-error");
      err.textContent = "Lütfen en az 10 karakterlik bir not yazın.";
      err.hidden = false;
      return;
    }
    closeModal("sv2-quick-status-modal");
    await applyQuickStatus(status, note);
  }));
}

/** Yazma hatası: çakışma/geçersiz geçiş iletisini göster ve ekranı gerçek duruma yenile (yarım kayıt yok). */
async function handleWriteError(err, context) {
  if (["status_conflict", "invalid_transition", "ticket_deleted", "note_required", "invalid_effort"].includes(err?.code)) {
    toast(err.message, "error");
    if (err.code !== "invalid_effort" && err.code !== "note_required") {
      try {
        await reloadTicketData();
        renderPage();
      } catch {
        /* yenileme başarısız: ileti yeterli */
      }
    }
    return;
  }
  handleError(err, context);
}

async function reloadTicketData() {
  const id = getTicketKey(ticket);
  const [t, msgs, hist, assign, eff] = await Promise.all([
    ParlaDb.getTicket(id),
    ParlaDb.getTicketMessages(id, { includeInternal: true }),
    ParlaDb.getTicketHistory(id),
    ParlaDb.getTicketAssignments(id),
    ParlaDb.getTicketEfforts(id),
  ]);
  if (t) ticket = t;
  messages = msgs;
  history = hist;
  assignments = assign;
  efforts = eff;
}

async function applyQuickStatus(status, note) {
  showLoading(true);
  try {
    const id = getTicketKey(ticket);
    const report = {};
    const updated = await ParlaDb.updateTicket(id, { status }, session, {
      expectedStatus: ticket.status,
      note,
      report,
      activity: { action: "ticket_updated" },
    });
    ticket = updated;
    history = await ParlaDb.getTicketHistory(id);
    toast("Durum güncellendi.", "success");
    renderPage();
    // E-posta metnini sunucu geçmiş kaydından (history_id) türetir; istemci not göndermez.
    sendNotifications(eventForStatus(status), updated, { history_id: report.statusHistoryId }).catch(() => {});
  } catch (err) {
    await handleWriteError(err, "Durum güncelleme");
  } finally {
    showLoading(false);
  }
}

function renderAdminPanel() {
  if (isDeletedTicket(ticket)) {
    return `<div class="sv2-warning-card">
      <i class="fas fa-archive"></i>
      <div><p class="sv2-warning-text">Bu talep silinmiş (arşivde). Düzenlemek için önce geri yüklenmelidir.</p></div>
    </div>`;
  }
  if (session.role === ROLES.CONSULTANT && !canManageTicket()) {
    const state = consultantAssignmentState();
    if (!state.assigned) {
      return `<div class="sv2-warning-card">
        <i class="fas fa-info-circle"></i>
        <div><p class="sv2-warning-text">Bu talep size atanmadığı için yalnızca görüntüleyebilirsiniz. Yanıt, iç not, durum ve efor işlemleri yalnızca atanmış danışmanlara açıktır.</p></div>
      </div>`;
    }
    if (!state.writable) {
      return `<div class="sv2-warning-card">
        <i class="fas fa-exclamation-triangle"></i>
        <div><p class="sv2-warning-text">Bu talep size atanmış görünüyor ancak kullanıcı hesabınızla eşleşmesi tamamlanmamış; işlem yapabilmeniz için yöneticinizden "Personel ↔ kullanıcı eşleştir" aracını çalıştırmasını isteyin.</p></div>
      </div>`;
    }
    return `
      <div class="sv2-section-body">
        ${renderQuickActions()}
        <p class="sv2-text-muted" style="font-size:0.875rem;margin:0 0 1rem">
          Atama: ${escapeHtml(formatDateTime(ticket.assigned_at))} · Durum: ${renderStatusBadge(ticket.status)}
        </p>
      </div>`;
  }

  return `
    <div class="sv2-section-body">
      ${renderQuickActions()}
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="sv2-admin-status">Durum</label>
          <select id="sv2-admin-status">${statusOptions(ticket.status)}</select>
        </div>
        <div class="sv2-form-group">
          <label for="sv2-admin-priority">Öncelik</label>
          <select id="sv2-admin-priority">${priorityOptions(ticket.priority)}</select>
        </div>
        <div class="sv2-form-group">
          <label for="sv2-admin-type">Talep Tipi</label>
          <select id="sv2-admin-type">${typeOptions(ticket.ticket_type)}</select>
        </div>
      </div>
      <div class="sv2-form-group" id="sv2-admin-project-group"${String(ticket.ticket_type || "").toUpperCase() === "PRJ" ? "" : " hidden"}>
        <label for="sv2-admin-project">Proje <span class="sv2-text-muted">(PRJ talepleri için)</span></label>
        <select id="sv2-admin-project"><option value="">— Proje seçilmedi —</option>${projectOptions(ticket.project_id || "")}</select>
      </div>
      <div class="sv2-form-group sv2-assign-group">
        <label>Danışman Ataması</label>
        <div class="sv2-assign-help">
          <div class="sv2-assign-help-item">
            <span class="sv2-assign-help-icon" aria-hidden="true"><i class="fas fa-check-square"></i></span>
            <div>
              <strong>Sol — Talebe ata</strong>
              <p>Bu talep üzerinde çalışacak danışmanları işaretleyin. Birden fazla seçebilirsiniz.</p>
            </div>
          </div>
          <div class="sv2-assign-help-item">
            <span class="sv2-assign-help-icon sv2-assign-help-icon-primary" aria-hidden="true"><i class="fas fa-star"></i></span>
            <div>
              <strong>Sağ — Birincil danışman</strong>
              <p>Sorumlu danışmanı belirleyin. Yalnızca atanmış danışmanlar arasından tek bir birincil seçilir.</p>
            </div>
          </div>
        </div>
        <div class="sv2-assign-panel">
          <div class="sv2-assign-header" aria-hidden="true">
            <span class="sv2-assign-col sv2-assign-col-check">Ata</span>
            <span class="sv2-assign-col sv2-assign-col-name">Danışman</span>
            <span class="sv2-assign-col sv2-assign-col-primary">Birincil</span>
          </div>
          <div class="sv2-assign-list">
            ${personnelAssignmentCheckboxes() || '<p class="sv2-assign-empty">Aktif danışman yok</p>'}
          </div>
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-admin-status-note">Durum Değişiklik Notu <span class="sv2-text-muted">(müşteriye iletilir)</span></label>
        <textarea id="sv2-admin-status-note" rows="2" maxlength="1000" placeholder="Durum değiştirirken en az 10 karakter not girin"></textarea>
      </div>
      <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-admin-update">Güncelle</button>
    </div>`;
}

function renderEffortForm() {
  if (!canWriteTicket()) return "";

  const today = istanbulDateISO();
  const min = new Date(Date.now() - EFFORT_LIMITS.maxBackfillDays * 86400000);
  return `
    <div class="sv2-form-row sv2-mt-1" style="align-items:end">
      <div class="sv2-form-group">
        <label for="sv2-effort-hours">Saat *</label>
        <input type="number" id="sv2-effort-hours" min="${EFFORT_LIMITS.minHours}" max="${EFFORT_LIMITS.maxHours}" step="${EFFORT_LIMITS.stepHours}" value="1">
      </div>
      <div class="sv2-form-group">
        <label for="sv2-effort-date">Tarih *</label>
        <input type="date" id="sv2-effort-date" value="${today}" max="${today}" min="${istanbulDateISO(min)}">
      </div>
      <div class="sv2-form-group" style="flex:2">
        <label for="sv2-effort-note">Not</label>
        <input type="text" id="sv2-effort-note" maxlength="${EFFORT_LIMITS.maxNoteLength}" placeholder="Yapılan işlem...">
      </div>
      <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-effort-add">Efor Ekle</button>
    </div>`;
}

const HISTORY_FIELD_LABELS = {
  status: "Durum",
  priority: "Öncelik",
  ticket_type: "Talep Tipi",
  project_id: "Proje",
  assigned_to_id: "Danışman",
  assigned_to_name: "Danışman",
  assignment: "Danışman Ataması",
  effort: "Efor",
  is_deleted: "Arşiv",
  ticket: "Talep",
  created: "Oluşturma",
};

function historyActionLabel(entry) {
  // Zehirli kayıt dayanıklılığı (SEC-02): alanlar dize değilse boş dizeye çevrilir.
  const field = safeText(entry.field_changed) || safeText(entry.action);
  let oldV = safeText(entry.old_value) || "—";
  let newV = safeText(entry.new_value) || "—";
  if (field === "status") {
    oldV = formatStatusLabel(normalizeStatusCode(oldV));
    newV = formatStatusLabel(normalizeStatusCode(newV));
  } else if (field === "priority") {
    oldV = formatPriorityLabel(oldV);
    newV = formatPriorityLabel(newV);
  } else if (entry.action === "assignment_added") {
    oldV = "—";
  } else if (entry.action === "assignment_removed") {
    newV = "—";
  }
  const label = entry.action === "ticket_restored" ? "Arşiv (geri yükleme)" : HISTORY_FIELD_LABELS[field] || field.replace(/_/g, " ");
  return { label, oldV, newV };
}

/**
 * Geçmiş tablosu: değişiklik başına tek satır. Eski kayıtlardaki çift satırlar (durum için `status_changed` + `status_note`,
 * danışman için ham kimlikli `assigned_to_id_changed` + adlı satır) birleştirilir/gizlenir.
 */
function visibleHistory() {
  const noted = history.filter((h) => h.action === "status_note");
  return history.filter((h) => {
    if (h.field_changed === "assigned_to_id") return false; // ham personel kimliği gösterilmez
    if (
      h.action === "status_changed" &&
      noted.some(
        (n) =>
          normalizeStatusCode(n.new_value) === normalizeStatusCode(h.new_value) &&
          Math.abs(new Date(n.changed_at) - new Date(h.changed_at)) < 60000
      )
    ) {
      return false;
    }
    return true;
  });
}

function renderHistoryTable() {
  const shown = visibleHistory();
  if (!shown.length) return renderEmptyState("Geçmiş kaydı bulunamadı.", "fa-history");
  const rows = shown
    .map((h) => {
      try {
        const { label, oldV, newV } = historyActionLabel(h);
        return `<tr>
        <td>${escapeHtml(formatDateTime(safeText(h.changed_at)))}</td>
        <td>${escapeHtml(safeText(h.changed_by_name) || "Sistem")}</td>
        <td>${escapeHtml(label)}</td>
        <td>${escapeHtml(oldV)}</td>
        <td>${escapeHtml(newV)}</td>
        <td>${escapeHtml(safeText(h.note) || "—")}</td>
      </tr>`;
      } catch (err) {
        console.warn("[Parla V2] geçmiş kaydı atlandı", err); // tek bozuk kayıt sekmeyi kilitlemesin
        return "";
      }
    })
    .join("");
  return `<div class="sv2-table-wrap"><table class="sv2-table">
    <thead><tr><th>TARİH</th><th>KULLANICI</th><th>ALAN</th><th>ESKİ</th><th>YENİ</th><th>NOT</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function renderMessagesTimeline(includeInternal) {
  const filtered = includeInternal ? messages : messages.filter((m) => !m.is_internal);
  if (!filtered.length) {
    return renderEmptyState(includeInternal ? "Henüz mesaj yok." : "Görünür mesaj yok.", "fa-comments");
  }
  return renderTimeline(
    filtered.map((m) => ({
      author: safeText(m.author_name),
      author_role: m.is_internal ? "internal" : safeText(m.author_role),
      created_at: m.created_at,
      message: (m.is_internal ? "[İç Not] " : "") + safeText(m.message) + (safeNumber(m.work_hours) ? ` (${safeNumber(m.work_hours)} saat)` : ""),
      attachments_html: renderAttachmentChips(m.attachments, getTicketKey(ticket), m.is_internal),
    }))
  );
}

function renderInternalNotes() {
  const internal = messages.filter((m) => m.is_internal);
  if (!internal.length) return renderEmptyState("İç not bulunmuyor.", "fa-lock");
  return internal
    .map(
      (m) => `<div class="sv2-section" style="margin-bottom:0.75rem;padding:0.875rem 1rem;border-left:3px solid var(--sv2-warning)">
        <div style="display:flex;justify-content:space-between;font-size:0.8125rem;margin-bottom:0.5rem">
          <strong>${escapeHtml(safeText(m.author_name) || "—")}</strong>
          <span class="sv2-text-muted">${escapeHtml(formatDateTime(safeText(m.created_at)))}${safeNumber(m.work_hours) ? ` · ${escapeHtml(String(safeNumber(m.work_hours)))} saat` : ""}</span>
        </div>
        <div>${escapeHtml(safeText(m.message))}</div>
        ${renderAttachmentChips(m.attachments, getTicketKey(ticket), true)}
      </div>`
    )
    .join("");
}

function buildContent() {
  const id = getTicketKey(ticket);
  const consultantNames = assignments.map((a) => a.personnel_name).filter(Boolean).join(", ") || ticket.assigned_to_name || "—";

  return `
    ${renderBreadcrumb([
      { label: "Talepler", href: PATHS.adminTickets },
      { label: ticket.ticket_number || id },
    ])}

    ${renderDeletedBanner()}
    <div class="sv2-section sv2-mb-1">
      <div class="sv2-section-header">
        <div>
          <h3 style="margin:0 0 0.25rem">${escapeHtml(ticket.title || "")}</h3>
          <span class="sv2-text-muted">${escapeHtml(ticket.ticket_number || "")}</span>
          ${renderTypeBadge(ticket.ticket_type)}
          ${renderStatusBadge(ticket.status)}
          ${renderPriorityBadge(ticket.priority)}
        </div>
      </div>
      <div class="sv2-section-body">
        <p style="margin:0 0 1rem;line-height:1.6">${escapeHtml(ticket.description || "—")}</p>
        <div class="sv2-meta-grid">
          <div class="sv2-meta-item"><label>SAP Modülü</label><span>${escapeHtml(formatSapModuleLabel(ticket.sap_module))}</span></div>
          ${ticket.project_id ? `<div class="sv2-meta-item"><label>Proje</label><div id="sv2-ticket-project">${linkProject(ticket.project_id, projectNameFor(ticket.project_id))}</div></div>` : ""}
          <div class="sv2-meta-item"><label>Oluşturma</label><span>${escapeHtml(formatDateTime(ticket.created_at))}</span></div>
          <div class="sv2-meta-item"><label>Atama Tarihi</label><span>${escapeHtml(formatDateTime(ticket.assigned_at))}</span></div>
          <div class="sv2-meta-item"><label>Güncelleme</label><span>${escapeHtml(formatDateTime(ticket.updated_at))}</span></div>
          <div class="sv2-meta-item"><label>SLA</label><div>${renderSlaBadge(ticket)}</div></div>
          <div class="sv2-meta-item"><label>İlk Yanıt</label><span>${escapeHtml(ticket.first_response_at ? formatDateTime(ticket.first_response_at) : "Henüz yanıtlanmadı")}</span></div>
          ${ticket.started_at ? `<div class="sv2-meta-item"><label>İşleme Alınma</label><span>${escapeHtml(formatDateTime(ticket.started_at))}</span></div>` : ""}
          ${ticket.resolved_at ? `<div class="sv2-meta-item"><label>Çözüm (Kapanış Onayına Geçiş)</label><span>${escapeHtml(formatDateTime(ticket.resolved_at))}</span></div>` : ""}
          ${ticket.closed_at ? `<div class="sv2-meta-item"><label>Kapanış</label><span>${escapeHtml(formatDateTime(ticket.closed_at))}</span></div>` : ""}
          ${ticket.reopened_at ? `<div class="sv2-meta-item"><label>Son Yeniden Açılma</label><span>${escapeHtml(formatDateTime(ticket.reopened_at))}</span></div>` : ""}
          <div class="sv2-meta-item"><label>Toplam Efor</label><span><strong>${escapeHtml(String(parseFloat(ticket.total_work_hours) || 0))} saat</strong></span></div>
        </div>
      </div>
    </div>

    <div class="sv2-form-row sv2-mb-1">
      <div class="sv2-section">
        <div class="sv2-section-header"><h3>${canManageTicket() ? "Admin Paneli" : "Danışman Paneli"}</h3></div>
        ${renderAdminPanel()}
      </div>
      <div class="sv2-section">
        <div class="sv2-section-header"><h3>Müşteri Bilgileri</h3></div>
        <div class="sv2-section-body">
          <div class="sv2-meta-grid">
            <div class="sv2-meta-item"><label>Muhatap</label><div>${ticket.user_id ? linkUser(ticket.user_id, ticket.user_name) : escapeHtml(ticket.user_name || "—")}</div></div>
            <div class="sv2-meta-item"><label>E-posta</label><span>${escapeHtml(ticket.user_email || "—")}</span></div>
            <div class="sv2-meta-item"><label>Firma</label><div>${ticket.company_id ? linkCompany(ticket.company_id, ticket.company_name) : escapeHtml(ticket.company_name || "—")}</div></div>
            <div class="sv2-meta-item"><label>Müşteri No</label><span>${escapeHtml(ticket.customer_code || "—")}</span></div>
            <div class="sv2-meta-item"><label>Danışman(lar)</label><span>${escapeHtml(consultantNames)}</span></div>
            ${renderAttachmentUrlItem()}
          </div>
        </div>
      </div>
    </div>

    <div class="sv2-section sv2-mb-1">
      <div class="sv2-section-header"><h3>Atanan Danışmanlar</h3></div>
      <div class="sv2-section-body">${renderAssignmentsTable()}</div>
    </div>

    <div class="sv2-section sv2-mb-1">
      <div class="sv2-section-header"><h3>Efor Kayıtları</h3></div>
      <div class="sv2-section-body">
        ${renderEffortsTable()}
        ${renderEffortForm()}
      </div>
    </div>

    <div class="sv2-section sv2-mb-1">
      <div class="sv2-section-header"><h3>İç Notlar</h3></div>
      <div class="sv2-section-body" id="sv2-internal-notes">${renderInternalNotes()}</div>
    </div>

    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Mesajlar & Geçmiş</h3></div>
      <div class="sv2-section-body">
        <div id="sv2-detail-tabs">${renderTabs(
          [
            { id: "messages", label: "Mesajlar" },
            { id: "history", label: "Geçmiş" },
          ],
          activeTab,
          (tab) => {
            activeTab = tab;
            renderTabContent();
          }
        )}</div>
        <div id="sv2-tab-content">${activeTab === "history" ? renderHistoryTable() : renderMessagesTimeline(false)}</div>
        ${renderReplyBox()}
      </div>
    </div>`;
}

/** SEN-12/SEC-29: müşterinin "Ek Bağlantı"sı personele görünür; yalnız http(s) bağlantı olarak çizilir. */
function renderAttachmentUrlItem() {
  const raw = safeText(ticket.attachment_url).trim();
  if (!raw) return "";
  const href = safeHttpUrl(raw);
  const body = href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="sv2-link" id="sv2-attachment-url"><i class="fas fa-paperclip"></i> ${escapeHtml(href.length > 60 ? `${href.slice(0, 57)}…` : href)}</a>`
    : `<span class="sv2-text-muted" title="Yalnızca http/https adresleri açılır">Geçersiz bağlantı: ${escapeHtml(raw.slice(0, 80))}</span>`;
  return `<div class="sv2-meta-item"><label>Ek Bağlantı</label><div>${body}</div></div>`;
}

function renderDeletedBanner() {
  if (!isDeletedTicket(ticket)) return "";
  const when = ticket.deleted_at ? formatDateTime(ticket.deleted_at) : "";
  return `<div class="sv2-warning-card sv2-mb-1" id="sv2-deleted-banner">
    <i class="fas fa-archive"></i>
    <div style="flex:1">
      <p class="sv2-warning-text">Bu talep silinmiş (arşivde)${when ? ` — ${escapeHtml(when)}` : ""}. Listelerde, panoda ve raporlarda görünmez; veriler korunur.</p>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem">
        ${isAdminOnly() ? '<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-primary" id="sv2-restore-ticket">Geri Yükle</button>' : ""}
        ${session.role === ROLES.SUPER_ADMIN ? '<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-danger" id="sv2-permanent-delete">Kalıcı Sil</button>' : ""}
      </div>
    </div>
  </div>`;
}

/** "Şablon ekle" seçici (WP-16): yalnız aktif şablonlar; hepsi kaçışlı. Şablon yoksa görünmez. */
function renderTemplatePicker() {
  const list = sortTemplates(replyTemplates, { onlyActive: true });
  if (!list.length) return "";
  const options = list
    .map((t) => {
      const id = t.id || t.template_id;
      const label = t.category ? `${t.category} — ${t.title}` : t.title;
      return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  return `<div class="sv2-form-group" style="margin-bottom:0.5rem">
            <label for="sv2-reply-template">Şablon ekle</label>
            <select id="sv2-reply-template"><option value="">— Hazır yanıt seçin —</option>${options}</select>
          </div>`;
}

/** Seçilen şablonu değişkenleri doldurarak yanıt kutusuna ekler (imleç konumuna; yoksa sona). */
function insertReplyTemplate(templateId) {
  const tpl = replyTemplates.find((t) => (t.id || t.template_id) === templateId);
  const box = document.getElementById("sv2-reply-message");
  if (!tpl || !box) return;
  const text = renderReplyTemplate(tpl.body, {
    musteri_adi: ticket.user_name || "",
    talep_no: ticket.ticket_number || "",
    danisman: actorName(),
  });
  const current = box.value;
  if (!current.trim()) {
    box.value = text;
  } else if (document.activeElement === box && typeof box.selectionStart === "number") {
    const start = box.selectionStart;
    const end = box.selectionEnd;
    box.value = current.slice(0, start) + text + current.slice(end);
    box.selectionStart = box.selectionEnd = start + text.length;
  } else {
    box.value = `${current}${current.endsWith("\n") ? "" : "\n\n"}${text}`;
  }
  box.focus();
  box.dispatchEvent(new Event("input", { bubbles: true })); // taslak saklama vb. dinleyiciler çalışsın
}

/** Yanıt kutusu: yalnız yazma yetkisi olan kişiye ve kapalı olmayan talepte açıktır. */
function renderReplyBox() {
  if (isDeletedTicket(ticket)) return "";
  if (!canWriteTicket()) {
    return `<p class="sv2-text-muted" id="sv2-reply-blocked" style="margin:0.75rem 0 0">Bu talepte yanıt veya iç not yazma yetkiniz yok; yalnızca atanmış danışmanlar ve yönetici roller yazabilir.</p>`;
  }
  if (isTicketClosed()) {
    return `<p class="sv2-text-muted" id="sv2-reply-blocked" style="margin:0.75rem 0 0">Bu talep kapalı; yanıt veya iç not yazmak için önce ${canManageTicket() ? '"Yeniden Aç" işlemini uygulayın' : "yöneticiden yeniden açmasını isteyin"}.</p>`;
  }
  return `
        <div class="sv2-reply-box">
          ${renderTemplatePicker()}
          <label for="sv2-reply-message"><strong>Yanıt Yaz</strong></label>
          <textarea id="sv2-reply-message" data-keep-draft maxlength="10000" placeholder="Müşteriye veya iç ekibe yanıt yazın..."></textarea>
          ${renderFilePicker("sv2-reply")}
          <div class="sv2-reply-actions">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
              <input type="checkbox" id="sv2-reply-internal"> İç not olarak kaydet
            </label>
            <div style="display:flex;align-items:center;gap:0.75rem">
              <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.875rem">
                Efor (saat)
                <input type="number" id="sv2-reply-hours" min="0" max="${EFFORT_LIMITS.maxHours}" step="${EFFORT_LIMITS.stepHours}" value="0" style="width:80px">
              </label>
              <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-reply-send">Gönder</button>
            </div>
          </div>
        </div>`;
}

function renderTabContent() {
  const el = document.getElementById("sv2-tab-content");
  if (!el) return;
  el.innerHTML = activeTab === "history" ? renderHistoryTable() : renderMessagesTimeline(false);
}

function collectAssignmentSelection() {
  const selected = [];
  document.querySelectorAll(".sv2-assign-check:checked").forEach((cb) => {
    const person = allPersonnel.find((p) => (p.personnel_id || p.id) === cb.value);
    selected.push({
      personnel_id: cb.value,
      personnel_name: cb.dataset.name || "",
      personnel_email: person?.email || "",
      is_primary: false,
    });
  });
  const primary = document.querySelector(".sv2-assign-primary:checked")?.value;
  if (primary) {
    const item = selected.find((s) => s.personnel_id === primary);
    if (item) item.is_primary = true;
    else if (selected.length) selected[0].is_primary = true;
  } else if (selected.length) {
    selected[0].is_primary = true;
  }
  return selected;
}

function personnelEmails(ids) {
  const wanted = new Set(ids);
  return allPersonnel
    .filter((p) => wanted.has(p.personnel_id || p.id) && p.is_active !== false)
    .map((p) => p.email);
}

/**
 * Bildirimleri doğru muhataplara gönderir ve başarısızlıkları raporlar.
 *  - assigned: yalnızca yeni atanan danışmanlar (müşteriye "size atandı" gitmez)
 *  - durum olayları: talep sahibi + atanmış danışmanlar (işlemi yapan hariç)
 */
async function sendNotifications(eventType, updatedTicket, extra, newlyAssignedIds) {
  const me = session.email;
  let recipients;
  if (eventType === "ticket_assignment_changed" || eventType === "ticket_priority_critical") {
    // WP-05: alıcılar SUNUCUDA türetilir (yeni/çıkarılan danışmanlar, müşteri, atanmış danışmanlar); "@assigned" yalnızca tetikleyicidir.
    recipients = ["@assigned"];
  } else if (eventType === "ticket_assigned") {
    recipients = personnelEmails(newlyAssignedIds || []);
  } else if (eventType === "send_to_customer" || eventType === "ticket_close_approval") {
    recipients = [updatedTicket.user_email];
  } else {
    recipients = [
      updatedTicket.user_email,
      ...personnelEmails(assignments.map((a) => a.personnel_id || a.id)),
    ];
  }

  const emails = ParlaEmailService.uniqueEmails(recipients, me);
  if (!emails.length) return true;

  const result = await ParlaEmailService.notifyTicketEvent(eventType, emails, updatedTicket, extra || {});
  return reportEmailResults([result], {
    eventType,
    label: "Bildirim e-postası",
    ticket: updatedTicket,
    actor: session,
  });
}

/** Atama değişti mi: üye kümesi VEYA birincil danışman (yalnız birincili değiştirmek de değişikliktir). */
function assignmentDiff(selected) {
  const prevIds = assignments.map((a) => a.personnel_id || a.id);
  const prevPrimary = assignments.find((a) => a.is_primary)?.personnel_id || assignments.find((a) => a.is_primary)?.id || ticket.assigned_to_id || "";
  const nextIds = selected.map((a) => a.personnel_id);
  const nextPrimary = selected.find((a) => a.is_primary)?.personnel_id || "";
  const membersChanged = JSON.stringify([...nextIds].sort()) !== JSON.stringify([...prevIds].sort());
  const primaryChanged = (nextPrimary || "") !== (prevPrimary || "") && (nextIds.length > 0 || prevIds.length > 0);
  return { changed: membersChanged || primaryChanged, membersChanged, primaryChanged, prevIds, nextIds, nextPrimary };
}

function warnUnmatched(report) {
  if (report?.unmatched?.length) {
    toast(
      `${report.unmatched.join(", ")} için kullanıcı hesabı eşleşmesi yok; bu danışman talepte işlem yapamaz. Danışmanlar sayfasındaki "Personel ↔ kullanıcı eşleştir" aracını çalıştırın.`,
      "warning"
    );
  }
}

async function handleAdminUpdate() {
  const newStatus = document.getElementById("sv2-admin-status")?.value;
  const newPriority = document.getElementById("sv2-admin-priority")?.value;
  const newType = document.getElementById("sv2-admin-type")?.value;
  const statusNote = document.getElementById("sv2-admin-status-note")?.value?.trim() || "";
  const selectedAssignments = collectAssignmentSelection();

  const statusChanged = newStatus !== ticket.status;
  const priorityChanged = newPriority !== ticket.priority;
  const typeChanged = !!newType && newType !== String(ticket.ticket_type || "").toUpperCase();
  // Proje yalnız PRJ taleplerinde anlamlıdır (D-11 A): PRJ dışına geçişte bağ temizlenir.
  const currentProject = ticket.project_id || "";
  const effectiveType = (newType || String(ticket.ticket_type || "")).toUpperCase();
  const nextProject = effectiveType === "PRJ" ? document.getElementById("sv2-admin-project")?.value ?? currentProject : "";
  const projectChanged = nextProject !== currentProject;
  const diff = assignmentDiff(selectedAssignments);
  const assignmentChanged = diff.changed;
  const outOfMatrix =
    statusChanged && !allowedTransitions(ticket.status, { role: session.role, hasAssignee: !!ticket.assigned_to_id }).includes(newStatus);

  if (statusChanged && !minLength(statusNote, 10)) {
    toast(
      outOfMatrix
        ? "Matris dışı durum geçişi için en az 10 karakterlik gerekçe zorunludur."
        : "Durum değişikliği için en az 10 karakterlik not zorunludur.",
      "error"
    );
    return;
  }

  if (!statusChanged && !priorityChanged && !typeChanged && !assignmentChanged && !projectChanged) {
    toast("Değişiklik yapılmadı.", "info");
    return;
  }

  const run = async () => {
    showLoading(true);
    try {
      const id = getTicketKey(ticket);
      const updates = {};
      if (priorityChanged) updates.priority = newPriority;
      if (typeChanged) updates.ticket_type = newType;
      if (statusChanged) updates.status = newStatus;
      if (projectChanged) updates.project_id = nextProject;

      // Durum + öncelik + tip + atama + geçmiş + aktivite TEK atomik yazım; durum ekrandaki durumla karşılaştırılır.
      const report = {};
      const updated = await ParlaDb.updateTicket(id, updates, session, {
        expectedStatus: ticket.status,
        note: statusChanged ? statusNote : "",
        force: outOfMatrix,
        assignments: assignmentChanged ? selectedAssignments : undefined,
        report,
        extraHistory: projectChanged
          ? [{ action: "project_changed", field_changed: "project_id", old_value: projectNameFor(currentProject), new_value: projectNameFor(nextProject) }]
          : undefined,
        activity: { action: assignmentChanged && !statusChanged && !priorityChanged && !typeChanged && !projectChanged ? "ticket_assigned" : "ticket_updated" },
      });

      ticket = updated;
      [assignments, history] = await Promise.all([ParlaDb.getTicketAssignments(id), ParlaDb.getTicketHistory(id)]);

      // Atama ve durum değişikliği birlikte olduysa ikisi de bildirilir.
      // Atama bildirimi ÖNCE tamamlanır: sunucu "size atandı" alan danışmana aynı anda ikinci (durum) e-postası göndermez (EML-28).
      const notifyResults = [];
      const assignDone = assignmentChanged ? sendNotifications("ticket_assignment_changed", updated, {}) : Promise.resolve(true);
      notifyResults.push(assignDone);
      if (statusChanged) {
        notifyResults.push(assignDone.then(() => sendNotifications(eventForStatus(newStatus), updated, { history_id: report.statusHistoryId })));
      }
      // Kritik önceliğe yükselme: atanmış danışmanlara yüksek öncelikli bildirim (WP-05)
      if (priorityChanged && String(newPriority).toLowerCase() === "critical") {
        notifyResults.push(sendNotifications("ticket_priority_critical", updated, {}));
      }
      await Promise.all(notifyResults);

      toast("Talep güncellendi.", "success");
      warnUnmatched(report);
      const noteEl = document.getElementById("sv2-admin-status-note");
      if (noteEl) noteEl.value = "";
      renderPage();
    } catch (err) {
      await handleWriteError(err, "Güncelleme");
    } finally {
      showLoading(false);
    }
  };

  // Tüm danışmanlar kaldırılıyorsa bilinçli onay iste (talep atanmamış kalır).
  if (assignmentChanged && selectedAssignments.length === 0 && diff.prevIds.length > 0) {
    renderConfirmDialog("Tüm danışman atamaları kaldırılacak ve talep atanmamış duruma dönecek. Devam edilsin mi?", run);
    return;
  }
  await run();
}

async function handleStartWork() {
  showLoading(true);
  try {
    const id = getTicketKey(ticket);
    const note = "Talebiniz danışmanımız tarafından işleme alındı.";
    const report = {};
    ticket = await ParlaDb.updateTicket(id, { status: STATUSES.IN_PROGRESS }, session, {
      expectedStatus: ticket.status,
      note,
      report,
      activity: { action: "ticket_updated" },
    });
    history = await ParlaDb.getTicketHistory(id);
    toast("Talep işleme alındı.", "success");
    renderPage();
    sendNotifications("ticket_status_changed", ticket, { history_id: report.statusHistoryId }).catch(() => {});
  } catch (err) {
    await handleWriteError(err, "Durum güncelleme");
  } finally {
    showLoading(false);
  }
}

async function handleAddEffort() {
  const check = validateEffortInput({
    hours: document.getElementById("sv2-effort-hours")?.value,
    workDate: document.getElementById("sv2-effort-date")?.value,
    note: document.getElementById("sv2-effort-note")?.value,
  });
  if (!check.valid) {
    toast(Object.values(check.errors)[0], "error");
    return;
  }

  const me = getMyPersonnel();
  // Personel kaydı olmayan yönetici (ör. PM) efor girerse efor kendi adına yazılır; birincil danışmanın adına DEĞİL.
  const personnelId = me?.personnel_id || me?.id || "";
  const personnelName = me ? [me.first_name, me.last_name].filter(Boolean).join(" ") : actorName();

  if (!personnelId && !canManageTicket()) {
    toast("Personel kaydınız bulunamadı. E-posta eşleşmesini kontrol edin.", "error");
    return;
  }

  showLoading(true);
  try {
    const id = getTicketKey(ticket);
    await ParlaDb.addTicketEffort(
      id,
      { personnel_id: personnelId, personnel_name: personnelName, hours: check.hours, work_date: check.workDate, note: check.note },
      session
    );
    [ticket, efforts] = await Promise.all([ParlaDb.getTicket(id), ParlaDb.getTicketEfforts(id)]);
    toast("Efor kaydedildi.", "success");
    renderPage();
  } catch (err) {
    await handleWriteError(err, "Efor kaydı");
  } finally {
    showLoading(false);
  }
}

function handleDeleteEffort(effortId) {
  const target = efforts.find((e) => (e.effort_id || e.id) === effortId);
  if (!target || !canWriteTicket()) return;
  if (!canManageTicket() && target.created_by_uid !== session.uid) return;
  renderConfirmDialog(
    `${target.hours} saatlik efor kaydı (${target.personnel_name || "—"}) silinecek. Silme işlemi geçmişe kaydedilir. Devam edilsin mi?`,
    async () => {
      showLoading(true);
      try {
        const id = getTicketKey(ticket);
        await ParlaDb.deleteTicketEffort(id, effortId, session);
        [ticket, efforts, history] = await Promise.all([ParlaDb.getTicket(id), ParlaDb.getTicketEfforts(id), ParlaDb.getTicketHistory(id)]);
        toast("Efor silindi.", "success");
        renderPage();
      } catch (err) {
        handleError(err, "Efor silme");
      } finally {
        showLoading(false);
      }
    }
  );
}

async function handleRestore() {
  showLoading(true);
  try {
    const id = getTicketKey(ticket);
    ticket = await ParlaDb.restoreTicket(id, session);
    history = await ParlaDb.getTicketHistory(id);
    toast("Talep arşivden geri yüklendi.", "success");
    renderPage();
  } catch (err) {
    handleError(err, "Geri yükleme");
  } finally {
    showLoading(false);
  }
}

function handlePermanentDelete() {
  const number = ticket.ticket_number || getTicketKey(ticket);
  renderConfirmDialog(
    `"${number}" numaralı talep, mesajları, iç notları, ekleri, geçmişi, atamaları ve eforlarıyla birlikte KALICI olarak silinecek. Bu işlem geri alınamaz. Devam edilsin mi?`,
    async () => {
      showLoading(true);
      try {
        await ParlaDb.permanentlyDeleteTicket(getTicketKey(ticket), session);
        toast("Talep kalıcı olarak silindi.", "success");
        window.location.href = PATHS.adminTickets;
      } catch (err) {
        handleError(err, "Kalıcı silme");
      } finally {
        showLoading(false);
      }
    }
  );
}

async function handleReply() {
  const message = document.getElementById("sv2-reply-message")?.value?.trim();
  const isInternal = !!document.getElementById("sv2-reply-internal")?.checked;
  const hoursCheck = validateReplyHours(document.getElementById("sv2-reply-hours")?.value);

  if (!message || message.length < 3) {
    toast("Lütfen bir mesaj yazın.", "error");
    return;
  }
  if (message.length > 10000) {
    toast("Mesaj en fazla 10.000 karakter olabilir.", "error");
    return;
  }
  if (!hoursCheck.valid) {
    toast(hoursCheck.error, "error");
    return;
  }
  const workHours = hoursCheck.hours;

  showLoading(true);
  let uploadedRefs = [];
  try {
    const id = getTicketKey(ticket);
    const me = getMyPersonnel();
    const prepared = replyPicker ? await replyPicker.getPrepared() : [];
    if (prepared === null) return; // dosya hatası seçicide gösterildi
    const refs = prepared.length ? await uploadAttachments(id, prepared, { internal: isInternal, session }) : [];
    uploadedRefs = refs;
    const savedMessage = await ParlaDb.addTicketMessage(id, {
      user_id: session.uid,
      author_name: actorName(),
      author_email: session.email,
      author_role: session.role || "admin",
      message,
      is_internal: isInternal,
      attachments: refs,
      work_hours: workHours,
      personnel_id: me?.personnel_id || me?.id || "",
      personnel_name: me ? [me.first_name, me.last_name].filter(Boolean).join(" ") : actorName(),
    });

    messages = await ParlaDb.getTicketMessages(id, { includeInternal: true });
    ticket = await ParlaDb.getTicket(id);
    efforts = await ParlaDb.getTicketEfforts(id);

    if (!isInternal && ticket.user_email && ticket.user_email !== session.email) {
      // Metin sunucuda mesaj kaydından (message_id) okunur.
      const result = await ParlaEmailService.notifyTicketEvent("ticket_message", ticket.user_email, ticket, {
        message_id: savedMessage.id,
      });
      await reportEmailResults([result], {
        eventType: "ticket_message",
        label: "Yanıt bildirimi",
        ticket,
        actor: session,
      });
    }

    document.getElementById("sv2-reply-message").value = "";
    document.getElementById("sv2-reply-hours").value = "0";
    document.getElementById("sv2-reply-internal").checked = false;

    toast(isInternal ? "İç not kaydedildi." : "Yanıt gönderildi.", "success");
    renderPage();
  } catch (err) {
    // Mesaj yazılamadıysa yüklenen ekler yetim kalmasın (SEN-38; yalnız süper admin silebilir, diğerlerinde atlanır).
    if (uploadedRefs.length) await ParlaDb.removeUploadedAttachments(getTicketKey(ticket), uploadedRefs, isInternal).catch(() => 0);
    await handleWriteError(err, "Yanıt");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  // Tek tip "işlem sürüyor" koruması: Enter/Boşluk tekrarı ve hızlı çift tık tek işlem sayılır (SEN-28, PER-36, UX-04).
  const guarded = (id, handler) => {
    const el = document.getElementById(id);
    el?.addEventListener("click", () => withInflight(el, () => handler()));
  };
  guarded("sv2-admin-update", handleAdminUpdate);
  replyPicker = bindFilePicker("sv2-reply");
  guarded("sv2-reply-send", handleReply);
  document.getElementById("sv2-reply-template")?.addEventListener("change", (e) => {
    if (e.target.value) insertReplyTemplate(e.target.value);
    e.target.value = "";
  });
  document.getElementById("sv2-admin-type")?.addEventListener("change", (e) => {
    const group = document.getElementById("sv2-admin-project-group");
    if (group) group.hidden = e.target.value !== "PRJ";
  });
  guarded("sv2-start-work", handleStartWork);
  document.querySelectorAll(".sv2-quick-status").forEach((btn) => {
    btn.addEventListener("click", () => openQuickStatusModal(btn.dataset.status));
  });
  guarded("sv2-effort-add", handleAddEffort);
  guarded("sv2-restore-ticket", handleRestore);
  guarded("sv2-permanent-delete", handlePermanentDelete);
  document.querySelectorAll(".sv2-effort-del").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteEffort(btn.dataset.id));
  });
  document.querySelectorAll(".sv2-assign-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      const row = cb.closest(".sv2-assign-row");
      const radio = row?.querySelector(".sv2-assign-primary");
      if (!radio) return;

      if (cb.checked) {
        row?.classList.add("is-assigned");
        radio.disabled = false;
        if (!document.querySelector(".sv2-assign-primary:checked")) {
          radio.checked = true;
        }
      } else {
        row?.classList.remove("is-assigned");
        if (radio.checked) {
          radio.checked = false;
          const nextPrimary = document.querySelector(".sv2-assign-check:checked");
          if (nextPrimary) {
            const nextRadio = nextPrimary
              .closest(".sv2-assign-row")
              ?.querySelector(".sv2-assign-primary");
            if (nextRadio) nextRadio.checked = true;
          }
        }
        radio.disabled = true;
      }
    });
  });

  document.querySelectorAll(".sv2-assign-primary").forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      const row = radio.closest(".sv2-assign-row");
      const checkbox = row?.querySelector(".sv2-assign-check");
      if (checkbox && !checkbox.checked) {
        checkbox.checked = true;
        row?.classList.add("is-assigned");
        radio.disabled = false;
      }
    });
  });
}

function renderPage() {
  renderShell("#sv2-app", {
    title: ticket.ticket_number || "Talep Detayı",
    activePage: "tickets",
    profile: session,
    isAdmin: true,
    content: buildContent(),
  });
  bindEvents();
}

async function loadTicket() {
  const id = getTicketId();
  if (!id) {
    window.location.href = PATHS.adminTickets;
    return;
  }

  showLoading(true);
  try {
    const [t, msgs, hist, personnel, assign, eff, templates, projects] = await Promise.all([
      ParlaDb.getTicket(id),
      ParlaDb.getTicketMessages(id, { includeInternal: true }),
      ParlaDb.getTicketHistory(id),
      ParlaDb.getAllPersonnel(),
      ParlaDb.getTicketAssignments(id),
      ParlaDb.getTicketEfforts(id),
      ParlaDb.getAllReplyTemplates().catch(() => []),
      ParlaDb.getAllProjects().catch(() => []),
    ]);

    if (!t) {
      toast("Talep bulunamadı.", "error");
      window.location.href = PATHS.adminTickets;
      return;
    }

    ticket = t;
    messages = msgs;
    history = hist;
    allPersonnel = personnel;
    assignments = assign;
    efforts = eff;
    replyTemplates = templates;
    allProjects = projects;
    markTicketSeen(session.uid, ticket);
    renderPage();

    // Eski atama kayıtlarında personel e-postası yoktur; müşteri yanıt bildirimleri için tamamla.
    ParlaDb.backfillAssignmentEmails(id, assign, personnel).catch(() => {});
  } catch (err) {
    // Kabuk + kalıcı "Yeniden dene" kartı (UX-02, PER-35): boş beyaz ekran yok.
    handleLoadError(err, "Talep yüklenemedi", { retry: loadTicket, activePage: "tickets", pageTitle: "Talep Detayı", isAdmin: true });
  } finally {
    showLoading(false);
  }
}

async function init() {
  bindAttachmentClicks();
  try {
    session = await requireAuth({ adminOnly: true, roles: ADMIN_ROLES });
    await loadTicket();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin" && err.message !== "role_denied") {
      handleError(err, "Oturum");
    }
  }
}

init();
