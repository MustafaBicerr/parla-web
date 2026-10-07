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
  handleLoadError,
  loadingStateHtml,
  withInflight,
  linkUser,
  escapeHtml,
  formatDateTime,
} from "../ui-shell.js";
import { ENTITY_LABELS, formatActivityAction, formatActivityEntity, isDeleteAction } from "../activity-labels.js";
import { isSafeId, safeText } from "../safe-utils.js";

/** Sayfa başına yüklenen en son kayıt sayısı; "Daha eski yükle" bu kadar artırır (PER-30, OLC). */
const PAGE_SIZE = 200;

let session = null;
let allActivities = [];
let allUsers = [];
let limit = PAGE_SIZE;
let viewMode = "table";
let filters = {
  action: "",
  userUid: "",
  entityType: "",
  dateFrom: "",
  dateTo: "",
};

document.addEventListener("DOMContentLoaded", init);

function pageContent(inner) {
  return `
        <div class="sv2-section">
          <div class="sv2-section-header">
            <h3>Denetim Günlüğü</h3>
            <div class="sv2-view-toggle" id="view-toggle">
              <button type="button" class="${viewMode === "table" ? "active" : ""}" data-view="table"><i class="fas fa-table"></i> Tablo</button>
              <button type="button" class="${viewMode === "timeline" ? "active" : ""}" data-view="timeline"><i class="fas fa-stream"></i> Zaman Çizelgesi</button>
            </div>
          </div>
          <div class="sv2-section-body">
            <div class="sv2-filters" id="activity-filters"></div>
            <div id="activities-content">${inner || ""}</div>
            <div id="activities-more" class="sv2-load-more"></div>
          </div>
        </div>`;
}

async function init() {
  try {
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Aktiviteler",
      activePage: "activities",
      profile: session,
      isAdmin: true,
      content: pageContent(loadingStateHtml("Aktiviteler yükleniyor…")),
    });
    bindEvents();
    await loadData();
  } catch {
    /* requireAuth yönlendirir ya da hata kartını kendisi çizer */
  }
}

async function loadData() {
  showLoading(true);
  try {
    [allActivities, allUsers] = await Promise.all([
      ParlaDb.getActivities(limit),
      ParlaDb.getAllUsers().catch(() => []), // kullanıcı listesi yalnızca admin rollerine açık
    ]);
    renderFilters();
    renderContent();
    renderMore();
  } catch (err) {
    handleLoadError(err, "Aktiviteler yüklenemedi", { retry: loadData, activePage: "activities", pageTitle: "Aktiviteler", isAdmin: true });
  } finally {
    showLoading(false);
  }
}

/** "Daha eski yükle": limit artırılıp en son N kayıt yeniden okunur (sunucu tarafı limitToLast). */
function renderMore() {
  const el = document.getElementById("activities-more");
  if (!el) return;
  const mayHaveMore = allActivities.length >= limit;
  el.innerHTML = `
    <p class="sv2-text-muted" id="activities-count">En son ${allActivities.length.toLocaleString("tr-TR")} kayıt yüklendi${mayHaveMore ? "; daha eski kayıtlar olabilir." : "."}</p>
    ${mayHaveMore ? '<button type="button" class="sv2-btn sv2-btn-outline" id="activities-load-more"><i class="fas fa-history"></i> Daha eski yükle</button>' : ""}`;
  const btn = document.getElementById("activities-load-more");
  btn?.addEventListener("click", () => {
    withInflight(btn, async () => {
      limit += PAGE_SIZE;
      await loadData();
    });
  });
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

/** Olay tipleri Türkçe etikete göre sıralanır (ham kod sırasına göre değil). */
function uniqueActions() {
  const set = new Set(allActivities.map((a) => safeText(a.action)).filter(Boolean));
  return [...set].sort((x, y) => formatActivityAction(x).localeCompare(formatActivityAction(y), "tr"));
}

function entityLink(activity) {
  const type = safeText(activity.entity_type);
  const id = safeText(activity.entity_id);
  const label = safeText(activity.entity_label) || id || "—";
  // Silinen varlığın sayfası yok: bağlantısız göster. Geçersiz kimlikli bağlantı da çizilmez.
  if (isDeleteAction(activity.action) || !isSafeId(id)) return escapeHtml(label);
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
  const href = Object.prototype.hasOwnProperty.call(map, type) ? map[type] : "";
  if (href) {
    return `<a href="${escapeHtml(href)}" class="sv2-link">${escapeHtml(label)}</a>`;
  }
  return escapeHtml(label);
}

function formatAction(action) {
  return formatActivityAction(action);
}

function formatEntityType(type) {
  return formatActivityEntity(type);
}

function filterActivities() {
  return allActivities.filter((a) => {
    if (filters.action && safeText(a.action) !== filters.action) return false;
    if (filters.userUid && safeText(a.user_uid) !== filters.userUid) return false;
    if (filters.entityType && safeText(a.entity_type) !== filters.entityType) return false;
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
  // Kullanıcı listesini okuyamayan roller (PM/danışman) için süzgeç aktivitelerin kendisinden türetilir (PER-29).
  let users = allUsers
    .filter((u) => u.is_active !== false)
    .map((u) => ({ uid: u.uid, name: `${safeText(u.first_name)} ${safeText(u.last_name)}`.trim() || safeText(u.email) }));
  if (!users.length) {
    const seen = new Map();
    allActivities.forEach((a) => {
      const uid = safeText(a.user_uid);
      if (uid && !seen.has(uid)) seen.set(uid, safeText(a.user_name) || uid);
    });
    users = [...seen].map(([uid, name]) => ({ uid, name }));
  }
  users.sort((a, b) => a.name.localeCompare(b.name, "tr"));

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
          .map((u) => `<option value="${escapeHtml(u.uid)}"${filters.userUid === u.uid ? " selected" : ""}>${escapeHtml(u.name)}</option>`)
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
              `<option value="${escapeHtml(k)}"${filters.entityType === k ? " selected" : ""}>${escapeHtml(v)}</option>`
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
      author: safeText(a.user_name) || "Sistem",
      created_at: safeText(a.created_at),
      message: `${formatAction(a.action)} — ${formatEntityType(a.entity_type)}: ${safeText(a.entity_label) || safeText(a.entity_id)}${a.details ? " · " + safeText(a.details) : ""}`,
      variant: isDeleteAction(a.action) ? "danger" : "",
    }));
    el.innerHTML = renderTimeline(items);
    return;
  }

  el.innerHTML = renderDataTable({
    columns: [
      {
        key: "created_at",
        label: "TARİH",
        render: (v) => escapeHtml(formatDateTime(safeText(v))),
      },
      {
        key: "user_name",
        label: "KULLANICI",
        render: (_, row) =>
          row.user_uid && isSafeId(safeText(row.user_uid))
            ? linkUser(safeText(row.user_uid), safeText(row.user_name) || safeText(row.user_uid))
            : escapeHtml(safeText(row.user_name) || "Sistem"),
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
        render: (v) => escapeHtml(safeText(v) || "—"),
      },
    ],
    rows: filtered.map((a) => ({ ...a, id: a.id })),
    emptyMessage: "Aktivite kaydı bulunamadı.",
  });
}
