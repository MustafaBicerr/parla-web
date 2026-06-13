/**
 * Parla BT Ticket V2 — Admin Dashboard
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderStatsGrid,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  renderEmptyState,
  renderStatusBadge,
  renderPriorityBadge,
  toast,
  showLoading,
  handleError,
  linkTicket,
  formatDateTime,
  formatTicketTypeLabel,
  escapeHtml,
} from "../ui-shell.js";
import { TICKET_TYPE_LABELS } from "../ticket-utils.js";
import ParlaEmailService from "../email-service.js";

const ADMIN_ROLES = ["super_admin", "service_admin", "project_manager", "consultant"];

let session = null;
let allTickets = [];
let allPersonnel = [];

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getDate() === n.getDate() &&
    d.getMonth() === n.getMonth() &&
    d.getFullYear() === n.getFullYear()
  );
}

function isThisMonth(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function isOpenStatus(status) {
  const s = String(status || "").toLowerCase();
  return s !== "closed" && s !== "resolved";
}

function avgResolutionLabel(tickets) {
  const resolved = tickets.filter((t) => t.resolved_at || t.closed_at);
  if (!resolved.length) return "—";
  const totalMs = resolved.reduce((sum, t) => {
    const end = new Date(t.resolved_at || t.closed_at);
    const start = new Date(t.created_at);
    return sum + (end - start);
  }, 0);
  const avgHours = totalMs / resolved.length / (1000 * 60 * 60);
  if (avgHours < 24) return `${avgHours.toFixed(1)} saat`;
  return `${(avgHours / 24).toFixed(1)} gün`;
}

function computeStats(tickets) {
  const open = tickets.filter((t) => isOpenStatus(t.status));
  const critical = open.filter((t) => String(t.priority).toLowerCase() === "critical");
  const todayOpened = tickets.filter((t) => isToday(t.created_at));
  const todayClosed = tickets.filter(
    (t) => isToday(t.closed_at) || (t.status === "closed" && isToday(t.updated_at))
  );
  const unassigned = open.filter((t) => !t.assigned_to_id);
  const monthResolved = tickets.filter(
    (t) =>
      (t.status === "resolved" || t.status === "closed") &&
      (isThisMonth(t.resolved_at) || isThisMonth(t.closed_at))
  );

  return {
    totalOpen: open.length,
    critical: critical.length,
    todayOpened: todayOpened.length,
    todayClosed: todayClosed.length,
    unassigned: unassigned.length,
    monthResolved: monthResolved.length,
    avgResolution: avgResolutionLabel(tickets),
  };
}

function computeTypeDistribution(tickets) {
  const counts = {};
  for (const t of tickets) {
    const type = String(t.ticket_type || "SUP").toUpperCase();
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function renderBarChart(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    return renderEmptyState("Henüz ticket verisi yok.", "fa-chart-bar");
  }
  const max = Math.max(...entries.map((e) => e[1]), 1);
  const bars = entries
    .map(([type, count]) => {
      const pct = Math.max(4, Math.round((count / max) * 100));
      const label = TICKET_TYPE_LABELS[type] ? type : type;
      return `
        <div class="sv2-bar">
          <span class="sv2-bar-value">${count}</span>
          <div class="sv2-bar-fill" style="height:${pct}%"></div>
          <span class="sv2-bar-label" title="${escapeHtml(formatTicketTypeLabel(type))}">${escapeHtml(label)}</span>
        </div>`;
    })
    .join("");
  return `<div class="sv2-bar-chart">${bars}</div>`;
}

function computeConsultantWorkload(tickets, personnel) {
  const open = tickets.filter((t) => isOpenStatus(t.status));
  const map = {};
  for (const p of personnel) {
    if (p.is_active === false) continue;
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    map[p.personnel_id || p.id] = {
      id: p.personnel_id || p.id,
      name,
      open: 0,
      critical: 0,
      totalHours: 0,
    };
  }
  for (const t of open) {
    const pid = t.assigned_to_id;
    if (!pid || !map[pid]) continue;
    map[pid].open++;
    if (String(t.priority).toLowerCase() === "critical") map[pid].critical++;
    map[pid].totalHours += parseFloat(t.total_work_hours) || 0;
  }
  return Object.values(map)
    .filter((r) => r.open > 0 || personnel.some((p) => (p.personnel_id || p.id) === r.id))
    .sort((a, b) => b.open - a.open);
}

function formatActivityText(activity) {
  const action = activity.action || "";
  const label = activity.entity_label || activity.entity_id || "";
  const details = activity.details || "";
  const map = {
    ticket_created: "Ticket oluşturuldu",
    ticket_updated: "Ticket güncellendi",
    ticket_deleted: "Ticket silindi",
    ticket_assigned: "Ticket atandı",
    user_created: "Kullanıcı oluşturuldu",
    company_created: "Firma oluşturuldu",
  };
  const prefix = map[action] || action.replace(/_/g, " ");
  return details ? `${prefix}: ${label} — ${details}` : `${prefix}: ${label}`;
}

function activityIcon(action) {
  if (String(action).includes("ticket")) return "fa-ticket-alt";
  if (String(action).includes("user")) return "fa-user";
  if (String(action).includes("company")) return "fa-building";
  return "fa-circle";
}

function renderActivityFeed(activities) {
  if (!activities.length) {
    return renderEmptyState("Henüz aktivite kaydı yok.", "fa-history");
  }
  return activities
    .map(
      (a) => `
    <div class="sv2-notif-item">
      <div class="sv2-notif-icon"><i class="fas ${activityIcon(a.action)}"></i></div>
      <div>
        <div class="sv2-notif-text">${escapeHtml(formatActivityText(a))}</div>
        <div class="sv2-notif-time">${escapeHtml(a.user_name || "Sistem")} · ${escapeHtml(formatDateTime(a.created_at))}</div>
      </div>
    </div>`
    )
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

function openAssignModal(ticket) {
  renderModal("sv2-assign-modal", {
    title: "Danışman Ata",
    body: `
      <p><strong>${escapeHtml(ticket.ticket_number)}</strong> — ${escapeHtml(ticket.title || "")}</p>
      <div class="sv2-form-group">
        <label for="sv2-assign-personnel">Danışman</label>
        <select id="sv2-assign-personnel">
          <option value="">— Seçiniz —</option>
          ${personnelOptions(ticket.assigned_to_id)}
        </select>
      </div>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="sv2-assign-modal">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-assign-save">Ata</button>`,
  });
  openModal("sv2-assign-modal");

  document.getElementById("sv2-assign-save")?.addEventListener("click", async () => {
    const select = document.getElementById("sv2-assign-personnel");
    const pid = select?.value;
    if (!pid) {
      toast("Lütfen bir danışman seçin.", "error");
      return;
    }
    const person = allPersonnel.find((p) => (p.personnel_id || p.id) === pid);
    const name = person
      ? [person.first_name, person.last_name].filter(Boolean).join(" ")
      : "";

    showLoading(true);
    try {
      const updated = await ParlaDb.assignConsultants(
        ticket.ticket_id || ticket.id,
        [
          {
            personnel_id: pid,
            personnel_name: name,
            is_primary: true,
          },
        ],
        session
      );
      await ParlaDb.logActivity(
        "ticket_assigned",
        "ticket",
        ticket.ticket_id || ticket.id,
        ticket.ticket_number,
        `${name} atandı`,
        session
      );
      if (person?.email) {
        await ParlaEmailService.notifyTicketEvent("ticket_assigned", person.email, updated, {
          note: `${ticket.ticket_number} numaralı ticket size atandı.`,
        });
      }
      toast("Danışman ataması kaydedildi.", "success");
      closeModal("sv2-assign-modal");
      await loadAndRender();
    } catch (err) {
      handleError(err, "Atama");
    } finally {
      showLoading(false);
    }
  });
}

function buildContent(stats, typeCounts, workload, unassigned, activities) {
  const statCards = [
    { label: "Toplam Açık", value: stats.totalOpen, variant: "open" },
    { label: "Kritik", value: stats.critical, variant: "critical" },
    { label: "Bugün Açılan", value: stats.todayOpened, variant: "" },
    { label: "Bugün Kapanan", value: stats.todayClosed, variant: "success" },
    { label: "Atanmamış", value: stats.unassigned, variant: "waiting" },
    { label: "Bu Ay Çözülen", value: stats.monthResolved, variant: "resolved" },
    { label: "Ort. Çözüm Süresi", value: stats.avgResolution, variant: "" },
  ];

  const workloadRows = workload.map((w) => ({
    id: w.id,
    name: w.name,
    open: w.open,
    critical: w.critical,
    hours: w.totalHours.toFixed(1),
  }));

  const unassignedRows = unassigned.slice(0, 10).map((t) => ({
    id: t.ticket_id || t.id,
    number: t.ticket_number,
    title: t.title,
    priority: t.priority,
    status: t.status,
    created: t.created_at,
    _ticket: t,
  }));

  return `
    ${renderStatsGrid(statCards)}
    <div class="sv2-form-row sv2-mb-1">
      <div class="sv2-section">
        <div class="sv2-section-header"><h3>Ticket Tipi Dağılımı</h3></div>
        <div class="sv2-section-body">${renderBarChart(typeCounts)}</div>
      </div>
      <div class="sv2-section">
        <div class="sv2-section-header"><h3>Son Aktiviteler</h3></div>
        <div class="sv2-section-body sv2-notif-panel-body" style="max-height:280px;overflow-y:auto">
          ${renderActivityFeed(activities)}
        </div>
      </div>
    </div>
    <div class="sv2-section sv2-mb-1">
      <div class="sv2-section-header"><h3>Danışman İş Yükü</h3></div>
      <div class="sv2-section-body">
        ${
          workloadRows.length
            ? renderDataTable({
                columns: [
                  { key: "name", label: "Danışman" },
                  { key: "open", label: "Açık Ticket" },
                  { key: "critical", label: "Kritik" },
                  { key: "hours", label: "Toplam Efor (saat)" },
                ],
                rows: workloadRows,
              })
            : renderEmptyState("Aktif danışman bulunamadı.", "fa-user-tie")
        }
      </div>
    </div>
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Atanmamış Ticketlar</h3>
        <a href="${PATHS.adminTickets}?filter=unassigned" class="sv2-btn sv2-btn-sm sv2-btn-outline">Tümünü Gör</a>
      </div>
      <div class="sv2-section-body" id="sv2-unassigned-wrap">
        ${
          unassignedRows.length
            ? `<div class="sv2-table-wrap"><table class="sv2-table">
              <thead><tr>
                <th>NO</th><th>KONU</th><th>ÖNCELİK</th><th>DURUM</th><th>TARİH</th><th>İŞLEM</th>
              </tr></thead>
              <tbody id="sv2-unassigned-tbody">
                ${unassignedRows
                  .map(
                    (r) => `
                  <tr data-id="${escapeHtml(r.id)}">
                    <td>${linkTicket(r.id, r.number)}</td>
                    <td>${escapeHtml(r.title || "—")}</td>
                    <td>${renderPriorityBadge(r.priority)}</td>
                    <td>${renderStatusBadge(r.status)}</td>
                    <td>${escapeHtml(formatDateTime(r.created))}</td>
                    <td><button type="button" class="sv2-btn sv2-btn-sm sv2-btn-primary sv2-quick-assign" data-id="${escapeHtml(r.id)}">Ata</button></td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table></div>`
            : renderEmptyState("Atanmamış açık ticket yok.", "fa-check-circle")
        }
      </div>
    </div>`;
}

async function loadAndRender() {
  showLoading(true);
  try {
    const [tickets, personnel, activities] = await Promise.all([
      ParlaDb.getAllTickets(),
      ParlaDb.getAllPersonnel(),
      ParlaDb.getActivities(20),
    ]);
    allTickets = tickets;
    allPersonnel = personnel;

    const stats = computeStats(tickets);
    const typeCounts = computeTypeDistribution(tickets);
    const workload = computeConsultantWorkload(tickets, personnel);
    const unassigned = tickets
      .filter((t) => isOpenStatus(t.status) && !t.assigned_to_id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const content = buildContent(stats, typeCounts, workload, unassigned, activities);

    renderShell("#sv2-app", {
      title: "Genel Bakış",
      activePage: "dashboard",
      profile: session,
      isAdmin: true,
      content,
    });

    document.querySelectorAll(".sv2-quick-assign").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const ticket = allTickets.find((t) => (t.ticket_id || t.id) === id);
        if (ticket) openAssignModal(ticket);
      });
    });
  } catch (err) {
    handleError(err, "Dashboard");
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
    await loadAndRender();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin" && err.message !== "role_denied") {
      handleError(err, "Oturum");
    }
  }
}

init();
