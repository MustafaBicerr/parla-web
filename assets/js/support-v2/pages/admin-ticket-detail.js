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
  renderDataTable,
  toast,
  showLoading,
  handleError,
  linkUser,
  linkCompany,
  linkPersonnel,
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
let assignments = [];
let efforts = [];
let activeTab = "messages";

function getTicketId() {
  return new URLSearchParams(window.location.search).get("id");
}

function actorName() {
  return [session.first_name, session.last_name].filter(Boolean).join(" ") || session.email;
}

function getMyPersonnel() {
  const email = String(session?.email || "").trim().toLowerCase();
  return allPersonnel.find((p) => String(p.email || "").trim().toLowerCase() === email) || null;
}

function canManageTicket() {
  return [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN, ROLES.PROJECT_MANAGER].includes(session?.role);
}

function isAssignedConsultant() {
  const me = getMyPersonnel();
  if (!me) return false;
  const pid = me.personnel_id || me.id;
  return assignments.some((a) => (a.personnel_id || a.id) === pid);
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

function personnelAssignmentCheckboxes() {
  const assignedIds = new Set(assignments.map((a) => a.personnel_id || a.id));
  const primaryId =
    assignments.find((a) => a.is_primary)?.personnel_id ||
    assignments.find((a) => a.is_primary)?.id ||
    ticket.assigned_to_id ||
    "";

  return allPersonnel
    .filter((p) => p.is_active !== false)
    .sort((a, b) =>
      `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "tr")
    )
    .map((p) => {
      const id = p.personnel_id || p.id;
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
      const checked = assignedIds.has(id) ? " checked" : "";
      const primary = id === primaryId ? " checked" : "";
      return `<label style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.375rem">
        <input type="checkbox" class="sv2-assign-check" value="${escapeHtml(id)}" data-name="${escapeHtml(name)}"${checked}>
        <span style="flex:1">${escapeHtml(name)}</span>
        <input type="radio" name="sv2-primary-consultant" class="sv2-assign-primary" value="${escapeHtml(id)}"${primary} title="Birincil danışman">
      </label>`;
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
  const canDelete = canManageTicket();
  const rows = efforts.map((e) => ({
    id: e.effort_id || e.id,
    personnel_name: e.personnel_name || "—",
    work_date: e.work_date,
    hours: e.hours,
    note: e.note || "—",
    created_by_name: e.created_by_name || "—",
  }));

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
                `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-outline sv2-effort-del" data-id="${escapeHtml(row.id)}">Sil</button>`,
            },
          ]
        : []),
    ],
    rows,
  });
}

function renderAdminPanel() {
  if (session.role === ROLES.CONSULTANT && !canManageTicket()) {
    if (!isAssignedConsultant()) {
      return `<div class="sv2-warning-card">
        <i class="fas fa-info-circle"></i>
        <div><p class="sv2-warning-text">Bu ticket size atanmadığı için yalnızca görüntüleyebilirsiniz.</p></div>
      </div>`;
    }
    const showStart =
      String(ticket.status || "").toLowerCase() === STATUSES.ASSIGNED;
    return `
      <div class="sv2-section-body">
        ${
          showStart
            ? `<button type="button" class="sv2-btn sv2-btn-primary sv2-mb-1" id="sv2-start-work">
                <i class="fas fa-play"></i> İşleme Al
              </button>`
            : ""
        }
        <p class="sv2-text-muted" style="font-size:0.875rem;margin:0 0 1rem">
          Atama: ${escapeHtml(formatDateTime(ticket.assigned_at))} · Durum: ${renderStatusBadge(ticket.status)}
        </p>
      </div>`;
  }

  return `
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
        <label>Danışmanlar</label>
        <div class="sv2-checkbox-list" style="max-height:180px;overflow-y:auto;border:1px solid var(--sv2-gray-200);border-radius:var(--sv2-radius-sm);padding:0.75rem">
          ${personnelAssignmentCheckboxes() || '<span class="sv2-text-muted">Aktif danışman yok</span>'}
        </div>
        <p class="sv2-text-muted" style="font-size:0.75rem;margin-top:0.35rem">Birincil danışman için sağdaki radio butonunu seçin.</p>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-admin-status-note">Durum Değişiklik Notu</label>
        <textarea id="sv2-admin-status-note" rows="2" placeholder="Durum değiştirirken en az 10 karakter not giriniz"></textarea>
      </div>
      <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-admin-update">Güncelle</button>
    </div>`;
}

function renderEffortForm() {
  const canAdd = canManageTicket() || isAssignedConsultant();
  if (!canAdd) return "";

  const today = new Date().toISOString().slice(0, 10);
  return `
    <div class="sv2-form-row sv2-mt-1" style="align-items:end">
      <div class="sv2-form-group">
        <label for="sv2-effort-hours">Saat *</label>
        <input type="number" id="sv2-effort-hours" min="0.25" step="0.25" value="1">
      </div>
      <div class="sv2-form-group">
        <label for="sv2-effort-date">Tarih *</label>
        <input type="date" id="sv2-effort-date" value="${today}">
      </div>
      <div class="sv2-form-group" style="flex:2">
        <label for="sv2-effort-note">Not</label>
        <input type="text" id="sv2-effort-note" placeholder="Yapılan işlem...">
      </div>
      <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-effort-add">Efor Ekle</button>
    </div>`;
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
  let oldV = entry.old_value || "—";
  let newV = entry.new_value || "—";
  if (field === "status") {
    oldV = formatStatusLabel(oldV);
    newV = formatStatusLabel(newV);
  } else if (field === "priority") {
    oldV = formatPriorityLabel(oldV);
    newV = formatPriorityLabel(newV);
  }
  return { label: map[field] || field.replace(/_/g, " "), oldV, newV };
}

function renderHistoryTable() {
  if (!history.length) return renderEmptyState("Geçmiş kaydı bulunamadı.", "fa-history");
  const rows = history
    .map((h) => {
      const { label, oldV, newV } = historyActionLabel(h);
      return `<tr>
        <td>${escapeHtml(formatDateTime(h.changed_at))}</td>
        <td>${escapeHtml(h.changed_by_name || "Sistem")}</td>
        <td>${escapeHtml(label)}</td>
        <td>${escapeHtml(oldV)}</td>
        <td>${escapeHtml(newV)}</td>
        <td>${escapeHtml(h.note || "—")}</td>
      </tr>`;
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
      author: m.author_name,
      author_role: m.is_internal ? "internal" : m.author_role,
      created_at: m.created_at,
      message: (m.is_internal ? "[İç Not] " : "") + (m.message || "") + (m.work_hours ? ` (${m.work_hours} saat)` : ""),
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
  const consultantNames = assignments.map((a) => a.personnel_name).filter(Boolean).join(", ") || ticket.assigned_to_name || "—";

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
          <div class="sv2-meta-item"><label>Atama Tarihi</label><span>${escapeHtml(formatDateTime(ticket.assigned_at))}</span></div>
          <div class="sv2-meta-item"><label>Güncelleme</label><span>${escapeHtml(formatDateTime(ticket.updated_at))}</span></div>
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
  el.innerHTML = activeTab === "history" ? renderHistoryTable() : renderMessagesTimeline(false);
}

function collectAssignmentSelection() {
  const selected = [];
  document.querySelectorAll(".sv2-assign-check:checked").forEach((cb) => {
    selected.push({
      personnel_id: cb.value,
      personnel_name: cb.dataset.name || "",
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

async function sendNotifications(eventType, updatedTicket, extra) {
  const recipients = new Set();
  if (updatedTicket.user_email) recipients.add(updatedTicket.user_email);
  for (const a of assignments) {
    const person = allPersonnel.find((p) => (p.personnel_id || p.id) === (a.personnel_id || a.id));
    if (person?.email) recipients.add(person.email);
  }
  for (const email of recipients) {
    await ParlaEmailService.notifyTicketEvent(eventType, email, updatedTicket, extra || {});
  }
}

async function handleAdminUpdate() {
  const newStatus = document.getElementById("sv2-admin-status")?.value;
  const newPriority = document.getElementById("sv2-admin-priority")?.value;
  const statusNote = document.getElementById("sv2-admin-status-note")?.value?.trim() || "";
  const selectedAssignments = collectAssignmentSelection();

  const statusChanged = newStatus !== ticket.status;
  const priorityChanged = newPriority !== ticket.priority;
  const assignmentChanged =
    JSON.stringify(selectedAssignments.map((a) => a.personnel_id).sort()) !==
    JSON.stringify(assignments.map((a) => a.personnel_id || a.id).sort());

  if (statusChanged && !minLength(statusNote, 10)) {
    toast("Durum değişikliği için en az 10 karakterlik not zorunludur.", "error");
    return;
  }

  if (!statusChanged && !priorityChanged && !assignmentChanged) {
    toast("Değişiklik yapılmadı.", "info");
    return;
  }

  showLoading(true);
  try {
    const id = ticket.ticket_id || ticket.id;

    if (assignmentChanged && selectedAssignments.length) {
      ticket = await ParlaDb.assignConsultants(id, selectedAssignments, session);
      assignments = await ParlaDb.getTicketAssignments(id);
    }

    const updates = {};
    if (priorityChanged) updates.priority = newPriority;
    if (statusChanged) updates.status = newStatus;

    let updated = ticket;
    if (Object.keys(updates).length) {
      updated = await ParlaDb.updateTicket(id, updates, session);
    }

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

    await ParlaDb.logActivity("ticket_updated", "ticket", id, updated.ticket_number, "Ticket güncellendi", session);

    ticket = updated;
    history = await ParlaDb.getTicketHistory(id);

    if (assignmentChanged) {
      await sendNotifications("ticket_assigned", updated, { note: statusNote || `${updated.ticket_number} atandı.` });
    } else if (statusChanged) {
      const eventType =
        newStatus === "resolved" ? "ticket_resolved" : newStatus === "closed" ? "ticket_closed" : "ticket_status_changed";
      await sendNotifications(eventType, updated, { note: statusNote });
    }

    toast("Ticket güncellendi.", "success");
    document.getElementById("sv2-admin-status-note").value = "";
    renderPage();
  } catch (err) {
    handleError(err, "Güncelleme");
  } finally {
    showLoading(false);
  }
}

async function handleStartWork() {
  showLoading(true);
  try {
    const id = ticket.ticket_id || ticket.id;
    ticket = await ParlaDb.updateTicket(
      id,
      { status: STATUSES.IN_PROGRESS, started_at: new Date().toISOString() },
      session
    );
    toast("Ticket işleme alındı.", "success");
    renderPage();
  } catch (err) {
    handleError(err, "Durum güncelleme");
  } finally {
    showLoading(false);
  }
}

async function handleAddEffort() {
  const hours = parseFloat(document.getElementById("sv2-effort-hours")?.value) || 0;
  const workDate = document.getElementById("sv2-effort-date")?.value;
  const note = document.getElementById("sv2-effort-note")?.value?.trim() || "";

  if (hours <= 0) {
    toast("Geçerli bir saat değeri girin.", "error");
    return;
  }

  const me = getMyPersonnel();
  let personnelId = me?.personnel_id || me?.id || "";
  let personnelName = me ? [me.first_name, me.last_name].filter(Boolean).join(" ") : actorName();

  if (canManageTicket() && !personnelId) {
    personnelId = ticket.assigned_to_id || "";
    personnelName = ticket.assigned_to_name || personnelName;
  }

  if (!personnelId && !canManageTicket()) {
    toast("Personel kaydınız bulunamadı. E-posta eşleşmesini kontrol edin.", "error");
    return;
  }

  showLoading(true);
  try {
    const id = ticket.ticket_id || ticket.id;
    await ParlaDb.addTicketEffort(
      id,
      { personnel_id: personnelId, personnel_name: personnelName, hours, work_date: workDate, note },
      session
    );
    [ticket, efforts] = await Promise.all([ParlaDb.getTicket(id), ParlaDb.getTicketEfforts(id)]);
    toast("Efor kaydedildi.", "success");
    renderPage();
  } catch (err) {
    handleError(err, "Efor kaydı");
  } finally {
    showLoading(false);
  }
}

async function handleDeleteEffort(effortId) {
  if (!canManageTicket()) return;
  showLoading(true);
  try {
    const id = ticket.ticket_id || ticket.id;
    await ParlaDb.deleteTicketEffort(id, effortId);
    [ticket, efforts] = await Promise.all([ParlaDb.getTicket(id), ParlaDb.getTicketEfforts(id)]);
    toast("Efor silindi.", "success");
    renderPage();
  } catch (err) {
    handleError(err, "Efor silme");
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
    const me = getMyPersonnel();
    await ParlaDb.addTicketMessage(id, {
      user_id: session.uid,
      author_name: actorName(),
      author_email: session.email,
      author_role: session.role || "admin",
      message,
      is_internal: isInternal,
      work_hours: workHours,
      personnel_id: me?.personnel_id || me?.id || "",
      personnel_name: me ? [me.first_name, me.last_name].filter(Boolean).join(" ") : actorName(),
    });

    messages = await ParlaDb.getTicketMessages(id);
    ticket = await ParlaDb.getTicket(id);
    efforts = await ParlaDb.getTicketEfforts(id);

    if (!isInternal && ticket.user_email) {
      await ParlaEmailService.notifyTicketEvent("ticket_message", ticket.user_email, ticket, { note: message });
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
  document.getElementById("sv2-start-work")?.addEventListener("click", handleStartWork);
  document.getElementById("sv2-effort-add")?.addEventListener("click", handleAddEffort);
  document.querySelectorAll(".sv2-effort-del").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteEffort(btn.dataset.id));
  });
  document.querySelectorAll(".sv2-assign-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked && !document.querySelector(".sv2-assign-primary:checked")) {
        document.querySelector(`.sv2-assign-primary[value="${cb.value}"]`)?.click();
      }
    });
  });
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
    const [t, msgs, hist, personnel, assign, eff] = await Promise.all([
      ParlaDb.getTicket(id),
      ParlaDb.getTicketMessages(id),
      ParlaDb.getTicketHistory(id),
      ParlaDb.getAllPersonnel(),
      ParlaDb.getTicketAssignments(id),
      ParlaDb.getTicketEfforts(id),
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
    assignments = assign;
    efforts = eff;
    renderPage();
  } catch (err) {
    handleError(err, "Ticket");
  } finally {
    showLoading(false);
  }
}

async function init() {
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
