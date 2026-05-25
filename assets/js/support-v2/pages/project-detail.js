/**
 * Parla BT Ticket V2 — Proje Detayı (admin)
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderBreadcrumb,
  renderDataTable,
  renderEmptyState,
  showLoading,
  handleError,
  linkCompany,
  linkPersonnel,
  linkTicket,
  escapeHtml,
  formatDate,
  renderStatusBadge,
  renderPriorityBadge,
} from "../ui-shell.js";

const PROJECT_STATUS = {
  planning: "Planlama",
  active: "Aktif",
  on_hold: "Beklemede",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

let session = null;
let project = null;
let projectTickets = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const projectId = new URLSearchParams(window.location.search).get("id");
  if (!projectId) {
    window.location.href = PATHS.adminProjects;
    return;
  }

  try {
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Proje Detayı",
      activePage: "projects",
      profile: session,
      isAdmin: true,
      content: `<div id="project-detail-root"><div class="sv2-empty"><i class="fas fa-spinner fa-spin"></i><h4>Yükleniyor...</h4></div></div>`,
    });
    await loadProject(projectId);
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin") {
      handleError(err, "Sayfa yüklenemedi");
    }
  }
}

async function loadProject(projectId) {
  showLoading(true);
  try {
    project = await ParlaDb.getProject(projectId);
    if (!project) {
      document.getElementById("project-detail-root").innerHTML = renderEmptyState(
        "Proje bulunamadı.",
        "fa-folder-open"
      );
      return;
    }

    const allTickets = await ParlaDb.getAllTickets();
    projectTickets = allTickets
      .filter((t) => t.project_id === projectId && t.ticket_type === "PRJ")
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    renderDetail();
  } catch (err) {
    handleError(err, "Proje yüklenemedi");
  } finally {
    showLoading(false);
  }
}

function personnelList() {
  const assigned = project.assigned_personnel || {};
  const items = Object.values(assigned).filter(Boolean);
  if (!items.length) return "<span>Atanan personel yok.</span>";
  return items
    .map((p) => linkPersonnel(p.id || p.personnel_id, p.name || "—"))
    .join(", ");
}

function renderDetail() {
  const root = document.getElementById("project-detail-root");
  if (!root) return;

  const statusLabel = PROJECT_STATUS[project.status] || project.status || "—";
  const activeTasks = projectTickets.filter(
    (t) => !["closed", "resolved"].includes(String(t.status || "").toLowerCase())
  ).length;

  root.innerHTML = `
    ${renderBreadcrumb([
      { label: "Projeler", href: PATHS.adminProjects },
      { label: project.project_code || project.name },
    ])}

    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>${escapeHtml(project.name || "Proje")}</h3>
        <span class="sv2-badge sv2-badge-open">${escapeHtml(project.project_code || "")}</span>
      </div>
      <div class="sv2-section-body">
        <div class="sv2-meta-grid">
          <div class="sv2-meta-item">
            <label>Durum</label>
            <span>${escapeHtml(statusLabel)}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Firma</label>
            <span>${project.company_id ? linkCompany(project.company_id, project.company_name) : escapeHtml(project.company_name || "—")}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Yönetici</label>
            <span>${escapeHtml(project.manager_name || "—")}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Başlangıç</label>
            <span>${escapeHtml(formatDate(project.start_date))}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Bitiş</label>
            <span>${escapeHtml(formatDate(project.end_date))}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Aktif Task</label>
            <span>${activeTasks}</span>
          </div>
        </div>
        ${
          project.description
            ? `<div style="margin-top:1.25rem"><label style="font-size:0.75rem;font-weight:600;color:var(--sv2-gray-500);text-transform:uppercase">Açıklama</label><p style="margin:0.375rem 0 0">${escapeHtml(project.description)}</p></div>`
            : ""
        }
        <div style="margin-top:1.25rem">
          <label style="font-size:0.75rem;font-weight:600;color:var(--sv2-gray-500);text-transform:uppercase">Atanan Personel</label>
          <p style="margin:0.375rem 0 0">${personnelList()}</p>
        </div>
      </div>
    </div>

    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Proje Taskları (PRJ)</h3>
        <span class="sv2-badge sv2-badge-in_progress">${projectTickets.length} kayıt</span>
      </div>
      <div class="sv2-section-body" id="project-tickets-table"></div>
    </div>`;

  const tableEl = document.getElementById("project-tickets-table");
  if (!tableEl) return;

  tableEl.innerHTML = renderDataTable({
    columns: [
      {
        key: "ticket_number",
        label: "TİCKET NO",
        render: (v, row) => linkTicket(row.id || row.ticket_id, v),
      },
      { key: "title", label: "BAŞLIK" },
      {
        key: "priority",
        label: "ÖNCELİK",
        render: (v) => renderPriorityBadge(v),
      },
      {
        key: "status",
        label: "DURUM",
        render: (v) => renderStatusBadge(v),
      },
      {
        key: "assigned_to_name",
        label: "ATANAN",
        render: (v) => escapeHtml(v || "—"),
      },
      {
        key: "created_at",
        label: "OLUŞTURULMA",
        render: (v) => escapeHtml(formatDate(v)),
      },
    ],
    rows: projectTickets.map((t) => ({ ...t, id: t.id || t.ticket_id })),
    emptyMessage: "Bu projeye bağlı PRJ taskı bulunamadı.",
  });
}
