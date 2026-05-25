/**
 * Parla BT Ticket V2 — Admin Ticket Detayı
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
  renderTypeBadge,
  renderEmptyState,
  toast,
  showLoading,
  handleError,
  linkUser,
  linkCompany,
  linkPersonnel,
  formatDate,
  formatDateTime,
  formatTicketTypeLabel,
  escapeHtml,
} from "../ui-shell.js";
import {
  STATUSES,
  STATUS_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  formatStatusLabel,
  formatPriorityLabel,
  formatSapModuleLabel,
} from "../ticket-utils.js";
import { minLength } from "../validators.js";
import ParlaEmailService from "../email-service.js";

const ADMIN_ROLES = ["super_admin", "service_admin", "project_manager", "consultant"];

let session = null;
let ticket = null;
let messages = [];
let history = [];
let allPersonnel = [];
let activeTab = "messages";

function getTicketId() {
  return new URLSearchParams(window.location.search).get("id");
}

function actorName() {
  return [session.first_name, session.last_name].filter(Boolean).join(" ") || session.email;
}

function statusOptions(selected) {
  return Object.values(STATUSES)
    .map((s) => {
      const sel = s === selected ? " selected" : "";
      return `<option value="${s}"${sel}>${escapeHtml(STATUS_LABELS[s])}</option>`;
    })
    .join("");
}

function priorityOptions(selected) {
  return Object.values(PRIORITIES)
    .map((p) => {
      const sel = p === selected ? " selected" : "";
      return `<option value="${p}"${sel}>${escapeHtml(PRIORITY_LABELS[p])}</option>`;
    })
    .join("");
}

function personnelOptions(selectedId) {
  return allPersonnel
    .filter((p) => p.is_active !== false)
    .map((p) => {
      const id = p.personnel_id || p.id;
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
      const sel = id === selectedId ? " selected" : "";
      return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(name)}</option>`;
    })
    .join("");
}

function historyActionLabel(entry) {
  const field = entry.field_changed || entry.action || "";
  const map = {
    status: "Durum",
    priority: "Öncelik",
    assigned_to_id: "Danışman",
    assigned_to_name: "Danışman",
    ticket: "Ticket",
    created: "Oluşturma",
  };
  const label = map[field] || field.replace(/_/g, " ");
  let oldV = entry.old_value || "—";
  let newV = entry.new_value || "—";

  if (field === "status") {
    oldV = formatStatusLabel(oldV);
    newV = formatStatusLabel(newV);
  } else if (field === "priority") {
    oldV = formatPriorityLabel(oldV);
    newV = formatPriorityLabel(newV);
  }

  return { label, oldV, newV };
}

function renderHistoryTable() {
  if (!history.length) {
    return renderEmptyState("Geçmiş kaydı bulunamadı.", "fa-history");
  }

  const rows = history
    .map((h) => {
      const { label, oldV, newV } = historyActionLabel(h);
      return `
      <tr>
        <td>${escapeHtml(formatDateTime(h.changed_at))}</td>
        <td>${escapeHtml(h.changed_by_name || "Sistem")}</td>
        <td>${escapeHtml(label)}</td>
        <td>${escapeHtml(oldV)}</td>
        <td>${escapeHtml(newV)}</td>
        <td>${escapeHtml(h.note || "—")}</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="sv2-table-wrap">
      <table class="sv2-table">
        <thead><tr>
          <th>TARİH</th><th>KULLANICI</th><th>ALAN</th><th>ESKİ</th><th>YENİ</th><th>NOT</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderMessagesTimeline(includeInternal) {
  const filtered = includeInternal
    ? messages
    : messages.filter((m) => !m.is_internal);

  if (!filtered.length) {
    return renderEmptyState(includeInternal ? "Henüz mesaj yok." : "Görünür mesaj yok.", "fa-comments");
  }

  return renderTimeline(
    filtered.map((m) => ({
      author: m.author_name,
      author_role: m.is_internal ? "internal" : m.author_role,
      created_at: m.created_at,
      message:
        (m.is_internal ? "[İç Not] " : "") +
        (m.message || "") +
        (m.work_hours ? ` (${m.work_hours} saat)` : ""),
    }))
  );
}

function renderInternalNotes() {
  const internal = messages.filter((m) => m.is_internal);
  if (!internal.length) {
    return renderEmptyState("İç not bulunmuyor.", "fa-lock");
  }
  return internal
    .map(
      (m) => `
    <div class="sv2-section" style="margin-bottom:0.75rem;padding:0.875rem 1rem;border-left:3px solid var(--sv2-warning)">
      <div style="display:flex;justify-content:space-between;font-size:0.8125rem;margin-bottom:0.5rem">
        <strong>${escapeHtml(m.author_name || "—")}</strong>
        <span class="sv2-text-muted">${escapeHtml(formatDateTime(m.created_at))}${m.work_hours ? ` · ${m.work_hours} saat` : ""}</span>
      </div>
      <div>${escapeHtml(m.message || "")}</div>
    </div>`
    )
    .join("");
}

function buildContent() {
  const id = ticket.ticket_id || ticket.id;

  return `
    ${renderBreadcrumb([
      { label: "Ticketlar", href: PATHS.adminTickets },
      { label: ticket.ticket_number || id },
    ])}

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
          <div class="sv2-meta-item"><label>Oluşturma</label><span>${escapeHtml(formatDateTime(ticket.created_at))}</span></div>
          <div class="sv2-meta-item"><label>Güncelleme</label><span>${escapeHtml(formatDateTime(ticket.updated_at))}</span></div>
          <div class="sv2-meta-item"><label>Toplam Efor</label><span>${escapeHtml(String(parseFloat(ticket.total_work_hours) || 0))} saat</span></div>
        </div>
      </div>
    </div>

    <div class="sv2-form-row sv2-mb-1">
      <div class="sv2-section">
        <div class="sv2-section-header"><h3>Admin Paneli</h3></div>
        <div class="sv2-section-body">
          <div class="sv2-form-row">
            <div class="sv2-form-group">
              <label for="sv2-admin-status">Durum</label>
              <select id="sv2-admin-status">${statusOptions(ticket.status)}</select>
            </div>
            <div class="sv2-form-group">
              <label for="sv2-admin-priority">Öncelik</label>
              <select id="sv2-admin-priority">${priorityOptions(ticket.priority)}</select>
            </div>
          </div>
          <div class="sv2-form-group">
            <label for="sv2-admin-consultant">Danışman</label>
            <select id="sv2-admin-consultant">
              <option value="">— Atanmadı —</option>
              ${personnelOptions(ticket.assigned_to_id)}
            </select>
          </div>
          <div class="sv2-form-group">
            <label for="sv2-admin-status-note">Durum Değişiklik Notu</label>
            <textarea id="sv2-admin-status-note" rows="2" placeholder="Durum değiştirirken en az 10 karakter not giriniz"></textarea>
          </div>
          <div class="sv2-form-group">
            <label for="sv2-admin-work-hours">Efor (saat)</label>
            <input type="number" id="sv2-admin-work-hours" min="0" step="0.25" value="${escapeHtml(String(parseFloat(ticket.total_work_hours) || 0))}">
          </div>
          <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-admin-update">Güncelle</button>
        </div>
      </div>

      <div class="sv2-section">
        <div class="sv2-section-header"><h3>Müşteri Bilgileri</h3></div>
        <div class="sv2-section-body">
          <div class="sv2-meta-grid">
            <div class="sv2-meta-item">
              <label>Muhatap</label>
              <div>${ticket.user_id ? linkUser(ticket.user_id, ticket.user_name) : escapeHtml(ticket.user_name || "—")}</div>
            </div>
            <div class="sv2-meta-item">
              <label>E-posta</label>
              <span>${escapeHtml(ticket.user_email || "—")}</span>
            </div>
            <div class="sv2-meta-item">
              <label>Firma</label>
              <div>${ticket.company_id ? linkCompany(ticket.company_id, ticket.company_name) : escapeHtml(ticket.company_name || "—")}</div>
            </div>
            <div class="sv2-meta-item">
              <label>Müşteri No</label>
              <span>${escapeHtml(ticket.customer_code || "—")}</span>
            </div>
            <div class="sv2-meta-item">
              <label>Danışman</label>
              <div>${
                ticket.assigned_to_id
                  ? linkPersonnel(ticket.assigned_to_id, ticket.assigned_to_name)
                  : '<span class="sv2-text-muted">Atanmadı</span>'
              }</div>
            </div>
          </div>
        </div>
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

        <div class="sv2-reply-box">
          <label for="sv2-reply-message"><strong>Yanıt Yaz</strong></label>
          <textarea id="sv2-reply-message" placeholder="Müşteriye veya iç ekibe yanıt yazın..."></textarea>
          <div class="sv2-reply-actions">
            <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
              <input type="checkbox" id="sv2-reply-internal"> İç not olarak kaydet
            </label>
            <div style="display:flex;align-items:center;gap:0.75rem">
              <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.875rem">
                Efor (saat)
                <input type="number" id="sv2-reply-hours" min="0" step="0.25" value="0" style="width:80px">
              </label>
              <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-reply-send">Gönder</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderTabContent() {
  const el = document.getElementById("sv2-tab-content");
  if (!el) return;
  el.innerHTML =
    activeTab === "history" ? renderHistoryTable() : renderMessagesTimeline(false);
}

async function sendNotifications(eventType, updatedTicket, extra) {
  const recipients = new Set();
  if (updatedTicket.user_email) recipients.add(updatedTicket.user_email);

  if (updatedTicket.assigned_to_id) {
    const person = allPersonnel.find(
      (p) => (p.personnel_id || p.id) === updatedTicket.assigned_to_id
    );
    if (person?.email) recipients.add(person.email);
  }

  for (const email of recipients) {
    await ParlaEmailService.notifyTicketEvent(eventType, email, updatedTicket, extra || {});
  }
}

async function handleAdminUpdate() {
  const newStatus = document.getElementById("sv2-admin-status")?.value;
  const newPriority = document.getElementById("sv2-admin-priority")?.value;
  const consultantId = document.getElementById("sv2-admin-consultant")?.value || "";
  const statusNote = document.getElementById("sv2-admin-status-note")?.value?.trim() || "";
  const workHours = parseFloat(document.getElementById("sv2-admin-work-hours")?.value) || 0;

  const statusChanged = newStatus !== ticket.status;
  const priorityChanged = newPriority !== ticket.priority;
  const consultantChanged = consultantId !== (ticket.assigned_to_id || "");
  const hoursChanged = workHours !== (parseFloat(ticket.total_work_hours) || 0);

  if (statusChanged && !minLength(statusNote, 10)) {
    toast("Durum değişikliği için en az 10 karakterlik not zorunludur.", "error");
    return;
  }

  if (!statusChanged && !priorityChanged && !consultantChanged && !hoursChanged) {
    toast("Değişiklik yapılmadı.", "info");
    return;
  }

  const person = allPersonnel.find((p) => (p.personnel_id || p.id) === consultantId);
  const consultantName = person
    ? [person.first_name, person.last_name].filter(Boolean).join(" ")
    : "";

  const updates = {};
  if (priorityChanged) updates.priority = newPriority;
  if (consultantChanged) {
    updates.assigned_to_id = consultantId;
    updates.assigned_to_name = consultantName;
  }
  if (hoursChanged) updates.total_work_hours = workHours;
  if (statusChanged) updates.status = newStatus;

  showLoading(true);
  try {
    const id = ticket.ticket_id || ticket.id;

    const updated = await ParlaDb.updateTicket(id, updates, session);

    if (statusChanged && statusNote) {
      await ParlaDb.addTicketHistory(id, {
        action: "status_note",
        field_changed: "status",
        old_value: formatStatusLabel(ticket.status),
        new_value: formatStatusLabel(newStatus),
        changed_by_uid: session.uid,
        changed_by_name: actorName(),
        note: statusNote,
      });
    }

    await ParlaDb.logActivity(
      "ticket_updated",
      "ticket",
      id,
      updated.ticket_number,
      statusChanged ? `Durum: ${formatStatusLabel(newStatus)}` : "Alan güncellendi",
      session
    );

    ticket = updated;

    if (consultantChanged && consultantId && person?.email) {
      await sendNotifications("ticket_assigned", updated, {
        note: statusNote || `${updated.ticket_number} size atandı.`,
      });
    } else if (statusChanged) {
      const eventType =
        newStatus === "resolved"
          ? "ticket_resolved"
          : newStatus === "closed"
            ? "ticket_closed"
            : "ticket_status_changed";
      await sendNotifications(eventType, updated, { note: statusNote });
    }

    toast("Ticket güncellendi.", "success");
    document.getElementById("sv2-admin-status-note").value = "";
    history = await ParlaDb.getTicketHistory(id);
    renderPage();
  } catch (err) {
    handleError(err, "Güncelleme");
  } finally {
    showLoading(false);
  }
}

async function handleReply() {
  const message = document.getElementById("sv2-reply-message")?.value?.trim();
  const isInternal = !!document.getElementById("sv2-reply-internal")?.checked;
  const workHours = parseFloat(document.getElementById("sv2-reply-hours")?.value) || 0;

  if (!message || message.length < 3) {
    toast("Lütfen bir mesaj yazın.", "error");
    return;
  }

  showLoading(true);
  try {
    const id = ticket.ticket_id || ticket.id;
    const msg = await ParlaDb.addTicketMessage(id, {
      user_id: session.uid,
      author_name: actorName(),
      author_email: session.email,
      author_role: session.role || "admin",
      message,
      is_internal: isInternal,
      work_hours: workHours,
    });

    messages.push(msg);
    ticket = await ParlaDb.getTicket(id);

    if (!isInternal && ticket.user_email) {
      await ParlaEmailService.notifyTicketEvent("ticket_message", ticket.user_email, ticket, {
        note: message,
      });
    }

    document.getElementById("sv2-reply-message").value = "";
    document.getElementById("sv2-reply-hours").value = "0";
    document.getElementById("sv2-reply-internal").checked = false;

    toast(isInternal ? "İç not kaydedildi." : "Yanıt gönderildi.", "success");
    renderPage();
  } catch (err) {
    handleError(err, "Yanıt");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("sv2-admin-update")?.addEventListener("click", handleAdminUpdate);
  document.getElementById("sv2-reply-send")?.addEventListener("click", handleReply);
}

function renderPage() {
  renderShell("#sv2-app", {
    title: ticket.ticket_number || "Ticket Detayı",
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
    const [t, msgs, hist, personnel] = await Promise.all([
      ParlaDb.getTicket(id),
      ParlaDb.getTicketMessages(id),
      ParlaDb.getTicketHistory(id),
      ParlaDb.getAllPersonnel(),
    ]);

    if (!t) {
      toast("Ticket bulunamadı.", "error");
      window.location.href = PATHS.adminTickets;
      return;
    }

    ticket = t;
    messages = msgs;
    history = hist;
    allPersonnel = personnel;
    renderPage();
  } catch (err) {
    handleError(err, "Ticket");
  } finally {
    showLoading(false);
  }
}

async function init() {
  try {
    session = await requireAuth({
      adminOnly: true,
      roles: ADMIN_ROLES,
    });
    await loadTicket();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin" && err.message !== "role_denied") {
      handleError(err, "Oturum");
    }
  }
}

init();
