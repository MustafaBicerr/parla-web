/**
 * Parla BT Ticket V2 — Aktivite Günlüğü (admin)
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderDataTable,
  renderTimeline,
  showLoading,
  handleError,
  linkUser,
  escapeHtml,
  formatDateTime,
} from "../ui-shell.js";

const ACTION_LABELS = {
  created: "Oluşturuldu",
  updated: "Güncellendi",
  deleted: "Silindi",
  status_changed: "Durum Değişti",
  assigned: "Atandı",
  login: "Giriş",
};

const ENTITY_LABELS = {
  ticket: "Ticket",
  user: "Kullanıcı",
  company: "Firma",
  contract: "Sözleşme",
  project: "Proje",
  personnel: "Danışman",
  department: "Departman",
  sap_module: "Modül",
  support_type: "Destek Türü",
};

let session = null;
let allActivities = [];
let allUsers = [];
let viewMode = "table";
let filters = {
  action: "",
  userUid: "",
  entityType: "",
  dateFrom: "",
  dateTo: "",
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Aktiviteler",
      activePage: "activities",
      profile: session,
      isAdmin: true,
      content: `
        <div class="sv2-section">
          <div class="sv2-section-header">
            <h3>Denetim Günlüğü</h3>
            <div class="sv2-view-toggle" id="view-toggle">
              <button type="button" class="active" data-view="table"><i class="fas fa-table"></i> Tablo</button>
              <button type="button" data-view="timeline"><i class="fas fa-stream"></i> Zaman Çizelgesi</button>
            </div>
          </div>
          <div class="sv2-section-body">
            <div class="sv2-filters" id="activity-filters"></div>
            <div id="activities-content"></div>
          </div>
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
    [allActivities, allUsers] = await Promise.all([
      ParlaDb.getActivities(),
      ParlaDb.getAllUsers(),
    ]);
    renderFilters();
    renderContent();
  } catch (err) {
    handleError(err, "Veriler yüklenemedi");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("view-toggle")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn) return;
    viewMode = btn.dataset.view;
    document.querySelectorAll("#view-toggle button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderContent();
  });
}

function uniqueActions() {
  const set = new Set(allActivities.map((a) => a.action).filter(Boolean));
  return [...set].sort();
}

function entityLink(activity) {
  const type = activity.entity_type;
  const id = activity.entity_id;
  const label = activity.entity_label || id || "—";
  const map = {
    ticket: `${PATHS.adminTicketDetail}?id=${encodeURIComponent(id)}`,
    user: `${PATHS.adminUserDetail}?uid=${encodeURIComponent(id)}`,
    company: `${PATHS.adminCompanyDetail}?id=${encodeURIComponent(id)}`,
    contract: PATHS.adminContracts,
    project: `${PATHS.adminProjectDetail}?id=${encodeURIComponent(id)}`,
    personnel: `${PATHS.adminPersonnelDetail}?id=${encodeURIComponent(id)}`,
    department: PATHS.adminDepartments,
    sap_module: PATHS.adminModules,
    support_type: PATHS.adminSupportTypes,
  };
  const href = map[type];
  if (href && id) {
    return `<a href="${href}" class="sv2-link">${escapeHtml(label)}</a>`;
  }
  return escapeHtml(label);
}

function formatAction(action) {
  return ACTION_LABELS[action] || action || "—";
}

function formatEntityType(type) {
  return ENTITY_LABELS[type] || type || "—";
}

function filterActivities() {
  return allActivities.filter((a) => {
    if (filters.action && a.action !== filters.action) return false;
    if (filters.userUid && a.user_uid !== filters.userUid) return false;
    if (filters.entityType && a.entity_type !== filters.entityType) return false;
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom);
      from.setHours(0, 0, 0, 0);
      if (new Date(a.created_at) < from) return false;
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(a.created_at) > to) return false;
    }
    return true;
  });
}

function renderFilters() {
  const el = document.getElementById("activity-filters");
  if (!el) return;

  const actions = uniqueActions();
  const users = allUsers
    .filter((u) => u.is_active !== false)
    .sort((a, b) =>
      `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "tr")
    );

  el.innerHTML = `
    <div class="sv2-form-group">
      <label for="f-action">Olay Tipi</label>
      <select id="f-action">
        <option value="">Tümü</option>
        ${actions.map((a) => `<option value="${escapeHtml(a)}"${filters.action === a ? " selected" : ""}>${escapeHtml(formatAction(a))}</option>`).join("")}
      </select>
    </div>
    <div class="sv2-form-group">
      <label for="f-user">Kullanıcı</label>
      <select id="f-user">
        <option value="">Tümü</option>
        ${users
          .map((u) => {
            const name = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email;
            return `<option value="${escapeHtml(u.uid)}"${filters.userUid === u.uid ? " selected" : ""}>${escapeHtml(name)}</option>`;
          })
          .join("")}
      </select>
    </div>
    <div class="sv2-form-group">
      <label for="f-entity">Varlık Tipi</label>
      <select id="f-entity">
        <option value="">Tümü</option>
        ${Object.entries(ENTITY_LABELS)
          .map(
            ([k, v]) =>
              `<option value="${k}"${filters.entityType === k ? " selected" : ""}>${escapeHtml(v)}</option>`
          )
          .join("")}
      </select>
    </div>
    <div class="sv2-form-group">
      <label for="f-from">Başlangıç</label>
      <input type="date" id="f-from" value="${escapeHtml(filters.dateFrom)}">
    </div>
    <div class="sv2-form-group">
      <label for="f-to">Bitiş</label>
      <input type="date" id="f-to" value="${escapeHtml(filters.dateTo)}">
    </div>
    <button type="button" class="sv2-btn sv2-btn-secondary" id="f-clear">Temizle</button>`;

  ["f-action", "f-user", "f-entity", "f-from", "f-to"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", applyFilters);
  });
  document.getElementById("f-clear")?.addEventListener("click", () => {
    filters = { action: "", userUid: "", entityType: "", dateFrom: "", dateTo: "" };
    renderFilters();
    renderContent();
  });
}

function applyFilters() {
  filters = {
    action: document.getElementById("f-action")?.value || "",
    userUid: document.getElementById("f-user")?.value || "",
    entityType: document.getElementById("f-entity")?.value || "",
    dateFrom: document.getElementById("f-from")?.value || "",
    dateTo: document.getElementById("f-to")?.value || "",
  };
  renderContent();
}

function renderContent() {
  const el = document.getElementById("activities-content");
  if (!el) return;

  const filtered = filterActivities();

  if (viewMode === "timeline") {
    const items = filtered.map((a) => ({
      author: a.user_name || "Sistem",
      created_at: a.created_at,
      message: `${formatAction(a.action)} — ${formatEntityType(a.entity_type)}: ${a.entity_label || a.entity_id || ""}${a.details ? " · " + a.details : ""}`,
      variant: a.action === "deleted" ? "danger" : "",
    }));
    el.innerHTML = renderTimeline(items);
    return;
  }

  el.innerHTML = renderDataTable({
    columns: [
      {
        key: "created_at",
        label: "TARİH",
        render: (v) => escapeHtml(formatDateTime(v)),
      },
      {
        key: "user_name",
        label: "KULLANICI",
        render: (_, row) =>
          row.user_uid
            ? linkUser(row.user_uid, row.user_name || row.user_uid)
            : escapeHtml(row.user_name || "Sistem"),
      },
      {
        key: "action",
        label: "OLAY",
        render: (v) => escapeHtml(formatAction(v)),
      },
      {
        key: "entity",
        label: "VARLIK",
        render: (_, row) =>
          `<span>${escapeHtml(formatEntityType(row.entity_type))}: ${entityLink(row)}</span>`,
      },
      {
        key: "details",
        label: "DETAYLAR",
        render: (v) => escapeHtml(v || "—"),
      },
    ],
    rows: filtered.map((a) => ({ ...a, id: a.id || a.activity_id })),
    emptyMessage: "Aktivite kaydı bulunamadı.",
  });
}
