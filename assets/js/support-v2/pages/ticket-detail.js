/**
 * Parla BT Ticket V2 — talep detayı (müşteri + admin)
 */
import ParlaDb from "../firebase-client.js";
import ParlaEmailService from "../email-service.js";
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
  toast,
  formatDateTime,
  escapeHtml,
} from "../ui-shell.js";
import {
  STATUS_LABELS,
  PRIORITY_LABELS,
  STATUSES,
  isAdminRole,
  formatStatusLabel,
  formatPriorityLabel,
  formatSapModuleLabel,
  getTicketKey,
} from "../ticket-utils.js";

const app = document.getElementById("sv2-app");
let session = null;
let ticket = null;
let messages = [];
let history = [];
let personnel = [];

function getTicketId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

async function getTicketHistory(ticketId) {
  const snap = await window.__PARLA_FIREBASE.db.get(
    ParlaDb.v2Ref(`ticket_history/${ticketId}`)
  );
  const items = ParlaDb.snapshotToArray(snap);
  return items.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));
}

function formatHistoryMessage(entry) {
  const field = entry.field_changed;
  const action = entry.action || "";

  if (action === "created") {
    return `Talep oluşturuldu: ${entry.new_value}`;
  }
  if (field === "status") {
    return `Durum değişti: ${formatStatusLabel(entry.old_value)} → ${formatStatusLabel(entry.new_value)}`;
  }
  if (field === "priority") {
    return `Öncelik değişti: ${formatPriorityLabel(entry.old_value)} → ${formatPriorityLabel(entry.new_value)}`;
  }
  if (field === "assigned_to_name") {
    return `Danışman atandı: ${entry.new_value || "—"}`;
  }
  if (entry.note) return entry.note;
  return entry.new_value || action || "Güncelleme yapıldı";
}

function historyToTimeline(items) {
  return items.map((h) => ({
    author: h.changed_by_name || "Sistem",
    created_at: h.changed_at,
    message: formatHistoryMessage(h),
    variant: "admin",
  }));
}

function messagesToTimeline(items, isAdmin) {
  const visible = isAdmin ? items : items.filter((m) => !m.is_internal);
  return visible.map((m) => ({
    author: m.author_name || "Kullanıcı",
    created_at: m.created_at,
    message: m.message,
    variant: m.is_internal ? "internal" : m.author_role === "customer" ? "customer" : "admin",
  }));
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
        <h4 style="margin:0 0 0.75rem;font-size:0.9375rem">Yanıt Yaz</h4>
        <textarea id="sv2-reply-message" placeholder="Müşteriye veya ekibe yanıt yazın..." rows="4"></textarea>
        <div class="sv2-reply-actions">
          <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.875rem;cursor:pointer">
            <input type="checkbox" id="sv2-reply-internal"> Dahili not (müşteri görmez)
          </label>
          <div style="display:flex;align-items:center;gap:0.75rem">
            <label style="font-size:0.875rem;display:flex;align-items:center;gap:0.35rem">
              Çalışma saati:
              <input type="number" id="sv2-reply-hours" min="0" step="0.25" value="0" style="width:72px;padding:0.35rem 0.5rem;border:1px solid var(--sv2-gray-200);border-radius:var(--sv2-radius-sm)">
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
      <h4 style="margin:0 0 0.75rem;font-size:0.9375rem">Yanıt Yaz</h4>
      <textarea id="sv2-reply-message" placeholder="Danışmanınıza yanıt yazın..." rows="4"></textarea>
      <div class="sv2-reply-actions">
        <span style="font-size:0.8125rem;color:var(--sv2-gray-500)">Yanıtınız danışman ekibimize iletilecektir.</span>
        <button type="button" class="sv2-btn sv2-btn-primary sv2-btn-sm" id="sv2-send-reply">
          <i class="fas fa-paper-plane"></i> Yanıt Gönder
        </button>
      </div>
    </div>`;
}

function renderPage() {
  const isAdmin = isAdminRole(session.role);
  const ticketsPath = isAdmin ? PATHS.adminTickets : PATHS.customerTickets;
  const canReply =
    !isAdmin ||
    String(ticket.status).toLowerCase() !== STATUSES.CLOSED;

  const customerCanReply =
    !isAdmin &&
    String(ticket.status).toLowerCase() !== STATUSES.CLOSED &&
    String(ticket.status).toLowerCase() !== STATUSES.RESOLVED;

  const showReply = isAdmin ? canReply : customerCanReply;

  const content = `
    ${renderBreadcrumb([
      { label: isAdmin ? "Ticketlar" : "Taleplerim", href: ticketsPath },
      { label: ticket.ticket_number || "Detay" },
    ])}
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
        <div style="margin-top:1rem">
          <label style="font-size:0.6875rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--sv2-gray-500);font-weight:600">Açıklama</label>
          <p style="margin:0.5rem 0 0;line-height:1.6;white-space:pre-wrap">${escapeHtml(ticket.description || "—")}</p>
        </div>
        ${
          ticket.attachment_url
            ? `<p style="margin-top:1rem"><a href="${escapeHtml(ticket.attachment_url)}" target="_blank" rel="noopener noreferrer" class="sv2-link"><i class="fas fa-paperclip"></i> Ek dosyayı görüntüle</a></p>`
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
        ${showReply ? renderReplyBox(isAdmin) : `<p style="color:var(--sv2-gray-500);font-size:0.875rem;margin:0">Bu talep kapatıldığı için yanıt yazılamaz.</p>`}
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
}

function getActor() {
  const name = [session.first_name, session.last_name].filter(Boolean).join(" ");
  return { uid: session.uid, name: name || session.email, email: session.email };
}

function bindReply(isAdmin) {
  document.getElementById("sv2-send-reply")?.addEventListener("click", async () => {
    const text = document.getElementById("sv2-reply-message")?.value?.trim();
    if (!text || text.length < 3) {
      toast("Lütfen en az 3 karakterlik bir yanıt yazın.", "error");
      return;
    }

    showLoading(true);
    try {
      const actor = getActor();
      const isInternal = isAdmin && document.getElementById("sv2-reply-internal")?.checked;
      const workHours = isAdmin
        ? parseFloat(document.getElementById("sv2-reply-hours")?.value) || 0
        : 0;

      await ParlaDb.addTicketMessage(getTicketKey(ticket), {
        user_id: session.uid,
        author_name: actor.name,
        author_email: session.email,
        author_role: isAdmin ? session.role : "customer",
        message: text,
        is_internal: !!isInternal,
        work_hours: workHours,
      });

      if (!isAdmin && ticket.status === STATUSES.WAITING_CUSTOMER) {
        await ParlaDb.updateTicket(
          getTicketKey(ticket),
          { status: STATUSES.IN_PROGRESS },
          actor
        );
      }

      await ParlaDb.logActivity(
        "ticket_message",
        "ticket",
        getTicketKey(ticket),
        ticket.ticket_number,
        isInternal ? "Dahili not eklendi" : "Yeni yanıt",
        actor
      );

      const cfg = window.__PARLA_SITE_CONFIG || {};
      const notifyEmail = isAdmin
        ? ticket.user_email
        : ticket.assigned_to_id
          ? personnel.find((p) => (p.personnel_id || p.id) === ticket.assigned_to_id)?.email
          : cfg.CONTACT_EMAIL;

      if (notifyEmail && !isInternal) {
        ParlaEmailService.notifyTicketEvent("ticket_message", notifyEmail, ticket, {
          note: text.slice(0, 200),
        }).catch(() => {});
      }

      toast("Yanıtınız gönderildi.", "success");
      await reloadTicket();
    } catch (err) {
      handleError(err, "Yanıt gönderme");
    } finally {
      showLoading(false);
    }
  });
}

function bindAdminForm() {
  document.getElementById("sv2-admin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
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

      if (assignedId && assignedId !== ticket.assigned_to_id) {
        const assignedPerson = personnel.find((p) => (p.personnel_id || p.id) === assignedId);
        if (assignedPerson?.email) {
          ParlaEmailService.notifyTicketEvent(
            "ticket_assigned",
            assignedPerson.email,
            updated,
            { note: "Size yeni bir talep atandı." }
          ).catch(() => {});
        }
      }

      if (status !== ticket.status && ticket.user_email) {
        const eventType =
          status === STATUSES.RESOLVED
            ? "ticket_resolved"
            : status === STATUSES.CLOSED
              ? "ticket_closed"
              : "ticket_status_changed";
        ParlaEmailService.notifyTicketEvent(eventType, ticket.user_email, updated).catch(() => {});
      }

      toast("Talep güncellendi.", "success");
      await reloadTicket();
    } catch (err) {
      handleError(err, "Güncelleme");
    } finally {
      showLoading(false);
    }
  });
}

async function reloadTicket() {
  const id = getTicketKey(ticket);
  const [t, msgs, hist] = await Promise.all([
    ParlaDb.getTicket(id),
    ParlaDb.getTicketMessages(id),
    getTicketHistory(id),
  ]);
  ticket = t;
  messages = msgs;
  history = hist;
  renderPage();
}

async function loadTicket(ticketId) {
  showLoading(true);
  try {
    ticket = await ParlaDb.getTicket(ticketId);
    if (!ticket) {
      app.innerHTML = `<div class="sv2-content" style="padding:2rem"><div class="sv2-empty"><i class="fas fa-exclamation-circle"></i><h4>Talep bulunamadı.</h4></div></div>`;
      return;
    }

    const isAdmin = isAdminRole(session.role);
    if (!isAdmin && ticket.user_id !== session.uid) {
      toast("Bu talebe erişim yetkiniz yok.", "error");
      window.location.href = PATHS.customerTickets;
      return;
    }

    [messages, history, personnel] = await Promise.all([
      ParlaDb.getTicketMessages(ticketId),
      getTicketHistory(ticketId),
      isAdmin ? ParlaDb.getAllPersonnel() : Promise.resolve([]),
    ]);

    renderPage();
  } catch (err) {
    handleError(err, "Talep yükleme");
  } finally {
    showLoading(false);
  }
}

async function init() {
  const ticketId = getTicketId();
  if (!ticketId) {
    app.innerHTML = `<div class="sv2-content" style="padding:2rem"><div class="sv2-empty"><i class="fas fa-exclamation-circle"></i><h4>Talep kimliği belirtilmedi.</h4><p><a href="${PATHS.customerTickets}" class="sv2-link">Taleplere dön</a></p></div></div>`;
    return;
  }

  showLoading(true);
  try {
    session = await requireAuth();
    await loadTicket(ticketId);
  } catch {
    /* requireAuth yönlendirir */
  } finally {
    showLoading(false);
  }
}

init();
