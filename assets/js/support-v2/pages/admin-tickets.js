/**
 * Parla BT Ticket V2 — Admin Talep Listesi
 *
 * WP-13/PER-20/21/44: arama debounce + önceden hesaplanmış arama metni/tarih, "Uygula" tutarlılığı (firma seçimi yalnız
 * Uygula'da etkinleşir, yazı silinince gizli kimlik temizlenir), aktif filtre rozetleri + "Filtreleri temizle",
 * `?filter=unassigned` pano tablosuyla aynı tanım (açık + atanmamış/sahipsiz), sütun başlığı sıralaması, sayfa boyutu,
 * sayfa değişiminde yalnız tablo yeniden çizilir, EFOR 2 ondalık.
 * WP-16: çoklu seçim + toplu ata / toplu durum (yalnız super/service/PM).
 * D-11 A: PRJ talebi oluştururken proje seçimi.
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderDataTable,
  renderFilterBar,
  renderModal,
  openModal,
  closeModal,
  renderConfirmDialog,
  renderStatusBadge,
  renderSlaBadge,
  renderAutocomplete,
  toast,
  showLoading,
  handleError,
  handleLoadError,
  withInflight,
  linkTicket,
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
  TICKET_TYPES,
  PRIORITIES,
  PRIORITY_LABELS,
  SAP_MODULES,
  SAP_MODULE_LABELS,
  formatStatusLabel,
  formatPriorityLabel,
  getTicketKey,
  normalizeSearch,
} from "../ticket-utils.js";
import { validateTicketForm } from "../validators.js";
import ParlaEmailService from "../email-service.js";
import { reportEmailResult, reportEmailResults } from "../email-report.js";
import { downloadExcel, downloadCsv } from "../export-utils.js";
import {
  needsAssignee,
  ticketAssigneeIds as assigneeIdsOf,
  canBulkOperate,
  planBulkStatus,
  planBulkAssign,
  describeSkipped,
  personnelFullName,
  selectableCompanies,
  BULK_NOTIFY_STATUSES,
  BULK_NOTIFY_LIMIT,
  BULK_MAX_TICKETS,
} from "../entity-utils.js";
import { sortRows, paginateRows, debounce, nextSort, makeHeadersSortable } from "../table-utils.js";

const ADMIN_ROLES = ["super_admin", "service_admin", "project_manager", "consultant"];
const PAGE_SIZES = [25, 50, 100];

let session = null;
let allTickets = [];
let deletedTickets = [];
let assignmentsByTicket = {};
let allCompanies = [];
let allPersonnel = [];
let allUsers = [];
let allProjects = [];
let selectedCompany = null;
const selected = new Set(); // toplu işlem için seçili talep kimlikleri (sayfalar ve süzmeler arasında korunur)

const state = {
  search: "",
  statusFilters: [],
  typeFilters: [],
  sapModule: "",
  priority: "",
  consultantId: "",
  companyId: "",
  companyLabel: "",
  dateFrom: "",
  dateTo: "",
  unassignedOnly: false,
  showDeleted: false,
  sort: "created_desc", // hazır sıralama seçeneği
  colSort: null, // sütun başlığı sıralaması { key, dir } (varsa hazır sıralamayı ezer)
  page: 1,
  pageSize: 25,
};

/* ------------------------------------------------------------------ *
 * Yardımcılar
 * ------------------------------------------------------------------ */

function actorPayload() {
  return {
    uid: session.uid,
    name: [session.first_name, session.last_name].filter(Boolean).join(" ") || session.email,
    email: session.email,
  };
}

function canBulk() {
  return canBulkOperate(session?.role);
}

function suggestNextCode(type) {
  const prefix = String(type || "CUS").toUpperCase();
  const nums = allCompanies
    .filter((c) => String(c.customer_code || "").startsWith(prefix))
    .map((c) => parseInt(String(c.customer_code).slice(3), 10) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function activePersonnelIds() {
  return new Set(allPersonnel.filter((p) => p.is_active !== false).map((p) => p.personnel_id || p.id));
}

/** Talebin tüm atananları (atama kayıtları; yoksa birincil danışman). */
function ticketAssigneeIds(t) {
  return assigneeIdsOf(t, assignmentsByTicket);
}

/** Her talep için bir kez hesaplanan arama metni ve oluşturma zamanı (her tuşta yeniden üretilmez; OLC-13). */
const metaCache = new WeakMap();
function meta(t) {
  let m = metaCache.get(t);
  if (!m) {
    m = {
      s: normalizeSearch([t.ticket_number, t.title, t.company_name, t.user_name, t.user_email, t.assigned_to_name, t.customer_code].filter(Boolean).join(" ")),
      c: Date.parse(t.created_at) || 0,
    };
    metaCache.set(t, m);
  }
  return m;
}

function searchTokens(query) {
  return normalizeSearch(query).split(/\s+/).filter(Boolean);
}

function ticketMatchesTokens(t, tokens) {
  if (!tokens.length) return true;
  const hay = meta(t).s;
  return tokens.every((tok) => hay.includes(tok));
}

const PRIORITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const SORT_ACCESSORS = {
  ticket_number: (t) => t.ticket_number,
  title: (t) => t.title,
  customer_code: (t) => t.customer_code,
  company_name: (t) => t.company_name,
  assigned_to_name: (t) => t.assigned_to_name,
  total_work_hours: (t) => parseFloat(t.total_work_hours) || 0,
  created_at: (t) => meta(t).c,
  status: (t) => formatStatusLabel(t.status),
  priority: (t) => PRIORITY_RANK[String(t.priority || "").toLowerCase()] || 0,
};
const SORT_PRESETS = {
  created_desc: { key: "created_at", dir: "desc" },
  created_asc: { key: "created_at", dir: "asc" },
  priority_desc: { key: "priority", dir: "desc" },
  status_asc: { key: "status", dir: "asc" },
  number_asc: { key: "ticket_number", dir: "asc" },
};

function currentSort() {
  return state.colSort || SORT_PRESETS[state.sort] || SORT_PRESETS.created_desc;
}

function filterTickets(tickets) {
  let list = tickets;
  const tokens = searchTokens(state.search);
  const activeIds = state.unassignedOnly ? activePersonnelIds() : null;
  const from = state.dateFrom ? new Date(`${state.dateFrom}T00:00:00`).getTime() : null;
  const to = state.dateTo ? new Date(`${state.dateTo}T23:59:59.999`).getTime() : null;

  list = list.filter((t) => {
    if (tokens.length && !ticketMatchesTokens(t, tokens)) return false;
    if (state.statusFilters.length && !state.statusFilters.includes(String(t.status).toLowerCase())) return false;
    if (state.typeFilters.length && !state.typeFilters.includes(String(t.ticket_type || "").toUpperCase())) return false;
    if (state.sapModule && t.sap_module !== state.sapModule) return false;
    if (state.priority && String(t.priority).toLowerCase() !== state.priority) return false;
    if (state.consultantId && !ticketAssigneeIds(t).includes(state.consultantId)) return false;
    if (state.companyId && t.company_id !== state.companyId) return false;
    // Pano ile AYNI tanım: açık talep + (atanmamış ya da atandığı danışmanların hepsi pasif)
    if (state.unassignedOnly && !needsAssignee(t, assignmentsByTicket, activeIds)) return false;
    if (from !== null && meta(t).c < from) return false;
    if (to !== null && meta(t).c > to) return false;
    return true;
  });

  return sortRows(list, currentSort(), SORT_ACCESSORS);
}

function paginate(list) {
  return paginateRows(list, state.page, state.pageSize);
}

function statusChips() {
  return Object.values(STATUSES).map((s) => ({
    value: s,
    label: STATUS_LABELS[s] || s,
    active: state.statusFilters.includes(s),
  }));
}

function typeChips() {
  return Object.values(TICKET_TYPES).map((t) => ({
    value: t,
    label: t,
    active: state.typeFilters.includes(t),
  }));
}

function advancedFiltersHtml() {
  const consultantOpts = allPersonnel
    .filter((p) => p.is_active !== false)
    .map((p) => {
      const id = p.personnel_id || p.id;
      const name = personnelFullName(p);
      const sel = state.consultantId === id ? " selected" : "";
      return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(name)}</option>`;
    })
    .join("");

  const sapOpts = SAP_MODULES.map((m) => {
    const sel = state.sapModule === m ? " selected" : "";
    const label = SAP_MODULE_LABELS[m] || m;
    return `<option value="${escapeHtml(m)}"${sel}>${escapeHtml(label)}</option>`;
  }).join("");

  const priOpts = Object.values(PRIORITIES)
    .map((p) => {
      const sel = state.priority === p ? " selected" : "";
      return `<option value="${escapeHtml(p)}"${sel}>${escapeHtml(PRIORITY_LABELS[p])}</option>`;
    })
    .join("");

  return `
    <div class="sv2-filters">
      <div class="sv2-form-group">
        <label for="sv2-filter-sap">SAP Modülü</label>
        <select id="sv2-filter-sap"><option value="">Tümü</option>${sapOpts}</select>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-filter-priority">Öncelik</label>
        <select id="sv2-filter-priority"><option value="">Tümü</option>${priOpts}</select>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-filter-consultant">Danışman</label>
        <select id="sv2-filter-consultant"><option value="">Tümü</option>${consultantOpts}</select>
      </div>
      <div class="sv2-form-group sv2-autocomplete-wrap">
        <label for="sv2-filter-company">Firma</label>
        <input type="text" id="sv2-filter-company" placeholder="Firma ara..." value="${escapeHtml(state.companyLabel)}" autocomplete="off">
        <input type="hidden" id="sv2-filter-company-id" value="${escapeHtml(state.companyId)}">
      </div>
      <div class="sv2-form-group">
        <label for="sv2-filter-date-from">Başlangıç</label>
        <input type="date" id="sv2-filter-date-from" value="${escapeHtml(state.dateFrom)}">
      </div>
      <div class="sv2-form-group">
        <label for="sv2-filter-date-to">Bitiş</label>
        <input type="date" id="sv2-filter-date-to" value="${escapeHtml(state.dateTo)}">
      </div>
      <div class="sv2-form-group">
        <label>&nbsp;</label>
        <label style="display:flex;align-items:center;gap:0.5rem;font-weight:500;cursor:pointer">
          <input type="checkbox" id="sv2-filter-unassigned" ${state.unassignedOnly ? "checked" : ""}>
          Atanmamış / sahipsiz (açık)
        </label>
      </div>
      <div class="sv2-form-group">
        <label>&nbsp;</label>
        <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-apply-advanced">Uygula</button>
      </div>
    </div>`;
}

/** Silme yetkisi veritabanı kurallarıyla uyumlu: yalnızca süper admin ve destek atayıcı. */
function canDeleteTickets() {
  return ["super_admin", "service_admin"].includes(String(session?.role || "").toLowerCase());
}

function fmtHours(v) {
  return (parseFloat(v) || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function buildTableRows(tickets) {
  return tickets.map((t) => {
    const id = getTicketKey(t);
    return {
      id,
      ticket_number: t.ticket_number,
      title: t.title,
      customer_code: t.customer_code || "—",
      company_name: t.company_name,
      company_id: t.company_id,
      assigned_to_name: t.assigned_to_name,
      assigned_to_id: t.assigned_to_id,
      extra_assignees: Math.max(0, ticketAssigneeIds(t).length - 1),
      total_work_hours: parseFloat(t.total_work_hours) || 0,
      is_approved: !!t.is_approved,
      created_at: t.created_at,
      status: t.status,
      _raw: t,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Aktif filtre rozetleri
 * ------------------------------------------------------------------ */

function activeFilterBadges() {
  const out = [];
  if (state.sapModule) out.push({ key: "sapModule", label: `Modül: ${SAP_MODULE_LABELS[state.sapModule] || state.sapModule}` });
  if (state.priority) out.push({ key: "priority", label: `Öncelik: ${formatPriorityLabel(state.priority)}` });
  if (state.consultantId) {
    const p = allPersonnel.find((x) => (x.personnel_id || x.id) === state.consultantId);
    out.push({ key: "consultantId", label: `Danışman: ${p ? personnelFullName(p) : state.consultantId}` });
  }
  if (state.companyId) out.push({ key: "companyId", label: `Firma: ${state.companyLabel || state.companyId}` });
  if (state.dateFrom) out.push({ key: "dateFrom", label: `Başlangıç: ${formatDate(state.dateFrom)}` });
  if (state.dateTo) out.push({ key: "dateTo", label: `Bitiş: ${formatDate(state.dateTo)}` });
  if (state.unassignedOnly) out.push({ key: "unassignedOnly", label: "Atanmamış / sahipsiz (açık)" });
  return out;
}

function hasAnyFilter() {
  return !!(state.search.trim() || state.statusFilters.length || state.typeFilters.length || activeFilterBadges().length);
}

function renderActiveFilters() {
  const badges = activeFilterBadges();
  if (!badges.length && !hasAnyFilter()) return "";
  return `<div class="sv2-active-filters" id="sv2-active-filters" role="group" aria-label="Aktif filtreler" style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;margin-bottom:0.75rem">
    <span class="sv2-text-muted" style="font-size:0.8125rem;font-weight:600">AKTİF FİLTRELER:</span>
    ${badges
      .map(
        (b) =>
          `<button type="button" class="sv2-chip is-active sv2-clear-filter" data-clear="${escapeHtml(b.key)}" title="Bu filtreyi kaldır">${escapeHtml(b.label)} <span aria-hidden="true">×</span></button>`
      )
      .join("")}
    ${hasAnyFilter() ? '<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-outline" id="sv2-clear-all-filters">Filtreleri temizle</button>' : ""}
  </div>`;
}

/* ------------------------------------------------------------------ *
 * Tablo
 * ------------------------------------------------------------------ */

/** Arşiv (yumuşak silinmiş) talepler: geri yükleme (yönetici) ve kalıcı silme (yalnız süper admin). */
function renderArchiveSection(paged) {
  const isSuper = String(session?.role || "").toLowerCase() === "super_admin";
  const columns = [
    { key: "ticket_number", label: "NO", render: (v, row) => linkTicket(row.id, v) },
    { key: "title", label: "KONU" },
    { key: "company_name", label: "MÜŞTERİ UNVAN" },
    { key: "status", label: "DURUM", render: (v) => renderStatusBadge(v) },
    { key: "deleted_at", label: "SİLİNME", render: (v) => escapeHtml(formatDateTime(v)) },
    {
      key: "actions",
      label: "İŞLEMLER",
      render: (_, row) => `
        <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-outline sv2-restore-ticket" data-id="${escapeHtml(row.id)}">Geri Yükle</button>
        ${isSuper ? `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-danger sv2-permanent-delete" data-id="${escapeHtml(row.id)}" data-number="${escapeHtml(row.ticket_number)}">Kalıcı Sil</button>` : ""}`,
    },
  ];
  return renderDataTable({
    columns,
    rows: paged.rows.map((t) => ({
      id: getTicketKey(t),
      ticket_number: t.ticket_number,
      title: t.title,
      company_name: t.company_name || "—",
      status: t.status,
      deleted_at: t.deleted_at,
    })),
    emptyMessage: "Arşivde (silinmiş) talep yok.",
    pagination: {
      page: paged.page,
      totalPages: paged.totalPages,
      total: paged.total,
      onPageChange: (p) => {
        state.page = p;
        renderTableOnly();
      },
    },
  });
}

function tableColumns() {
  const columns = [];
  if (canBulk()) {
    columns.push({
      key: "select",
      label: "Seç",
      render: (_, row) =>
        `<input type="checkbox" class="sv2-bulk-cb" data-id="${escapeHtml(row.id)}" aria-label="${escapeHtml(row.ticket_number || "Talep")} talebini seç"${selected.has(row.id) ? " checked" : ""}>`,
    });
  }
  columns.push(
    { key: "ticket_number", label: "NO", sortable: true, render: (v, row) => linkTicket(row.id, v) },
    { key: "title", label: "KONU", sortable: true, wide: true },
    { key: "customer_code", label: "MÜŞTERİ NO", sortable: true, lowPriority: true },
    {
      key: "company_name",
      label: "MÜŞTERİ UNVAN",
      sortable: true,
      render: (v, row) => (row.company_id ? linkCompany(row.company_id, v) : escapeHtml(v || "—")),
    },
    {
      key: "assigned_to_name",
      label: "DANIŞMAN",
      sortable: true,
      render: (v, row) =>
        row.assigned_to_id
          ? linkPersonnel(row.assigned_to_id, v || "—") +
            (row.extra_assignees ? ` <span class="sv2-text-muted" title="İkincil danışman(lar)">+${row.extra_assignees}</span>` : "")
          : '<span class="sv2-text-muted">Atanmadı</span>',
    },
    { key: "total_work_hours", label: "EFOR", sortable: true, lowPriority: true, render: (v) => escapeHtml(fmtHours(v)) },
    {
      key: "is_approved",
      label: "ONAY",
      render: (v, row) =>
        `<input type="checkbox" class="sv2-approval-cb" data-id="${escapeHtml(row.id)}" ${v ? "checked" : ""} title="Onay" aria-label="Onay">`,
    },
    {
      key: "created_at",
      label: "TARİH",
      sortable: true,
      render: (v) => escapeHtml(formatDate(v)),
    },
    { key: "status", label: "DURUM", sortable: true, render: (v) => renderStatusBadge(v) },
    { key: "sla", label: "SLA", render: (_, row) => renderSlaBadge(row._raw) },
    {
      key: "actions",
      label: "İŞLEMLER",
      render: (_, row) => `
        <a href="${PATHS.adminTicketDetail}?id=${encodeURIComponent(row.id)}" class="sv2-btn sv2-btn-sm sv2-btn-outline">Düzenle</a>
        ${
          canDeleteTickets()
            ? `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-danger sv2-delete-ticket" data-id="${escapeHtml(row.id)}" data-number="${escapeHtml(row.ticket_number)}">Sil</button>`
            : ""
        }`,
    }
  );
  return columns;
}

function renderBulkBar(filteredIds, pageRowIds) {
  if (!canBulk() || state.showDeleted || !selected.size) return "";
  const filteredTotal = filteredIds.length;
  const allVisibleSelected = pageRowIds.length > 0 && pageRowIds.every((id) => selected.has(id));
  const filteredSet = new Set(filteredIds);
  const outside = [...selected].filter((id) => !filteredSet.has(id)).length;
  const offerAll = allVisibleSelected && filteredTotal > pageRowIds.length && filteredIds.some((id) => !selected.has(id));
  return `<div class="sv2-bulk-bar" id="sv2-bulk-bar" role="region" aria-label="Toplu işlemler" style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;padding:0.6rem 0.8rem;margin-bottom:0.75rem;background:var(--sv2-accent-soft);border-radius:var(--sv2-radius-sm)">
    <strong id="sv2-bulk-count">${selected.size} talep seçili</strong>${outside ? ` <span class="sv2-text-muted" id="sv2-bulk-outside">(${outside} tanesi mevcut filtrenin dışında)</span>` : ""}
    ${offerAll ? `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-outline" id="sv2-bulk-select-filtered">Filtrelenen tüm ${filteredTotal} talebi seç</button>` : ""}
    <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-secondary" id="sv2-bulk-clear">Seçimi temizle</button>
    <span style="flex:1"></span>
    <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-primary" id="sv2-bulk-assign"><i class="fas fa-user-tie" aria-hidden="true"></i> Toplu Ata</button>
    <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-primary" id="sv2-bulk-status"><i class="fas fa-check-square" aria-hidden="true"></i> Toplu Durum</button>
  </div>`;
}

function renderToolbar(paged) {
  const sizeOpts = PAGE_SIZES.map((n) => `<option value="${n}"${state.pageSize === n ? " selected" : ""}>${n}</option>`).join("");
  return `<div class="sv2-list-toolbar" style="display:flex;gap:1rem;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
    <span class="sv2-text-muted" id="sv2-result-count" style="font-size:0.8125rem">${paged.total} kayıt</span>
    <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.8125rem">Sayfa boyutu
      <select id="sv2-page-size" aria-label="Sayfa boyutu">${sizeOpts}</select>
    </label>
  </div>`;
}

function renderTableSection(paged, filteredIds) {
  if (state.showDeleted) return renderArchiveSection(paged);
  const columns = tableColumns();
  const rows = buildTableRows(paged.rows);
  const html = renderDataTable({
    columns,
    rows,
    emptyMessage: "Filtrelere uygun talep bulunamadı.",
    pagination: {
      page: paged.page,
      totalPages: paged.totalPages,
      total: paged.total,
      onPageChange: (p) => {
        state.page = p;
        renderTableOnly();
      },
    },
  });
  return (
    renderActiveFilters() +
    renderToolbar(paged) +
    renderBulkBar(filteredIds, rows.map((r) => r.id)) +
    `<div id="sv2-table-holder">${html}</div>`
  );
}

function buildPageContent(paged, filteredIds) {
  return `
    <div class="sv2-section-header" style="border:none;padding:0 0 1rem;background:transparent">
      <div></div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-new-ticket"><i class="fas fa-plus"></i> Yeni Talep</button>
        ${canDeleteTickets() ? `<button type="button" class="sv2-btn sv2-btn-outline" id="sv2-toggle-deleted" aria-pressed="${state.showDeleted ? "true" : "false"}"><i class="fas fa-archive"></i> ${state.showDeleted ? "Aktif Taleplere Dön" : "Arşiv (Silinenler)"}</button>` : ""}
        <button type="button" class="sv2-btn sv2-btn-secondary" id="sv2-export-csv"><i class="fas fa-file-csv"></i> CSV Dışa Aktar</button>
        <button type="button" class="sv2-btn sv2-btn-secondary" id="sv2-export-excel"><i class="fas fa-file-excel"></i> Excel Dışa Aktar</button>
      </div>
    </div>
    <div class="sv2-mb-1">
      <span class="sv2-text-muted" style="font-size:0.8125rem;font-weight:600">DURUM:</span>
      <div class="sv2-filter-chips" id="sv2-filter-chips" data-multi="true" style="display:inline-flex;margin-left:0.5rem;flex-wrap:wrap">
        ${statusChips()
          .map(
            (c) =>
              `<button type="button" class="sv2-chip${c.active ? " active is-active" : ""}" data-value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</button>`
          )
          .join("")}
      </div>
    </div>
    ${renderFilterBar({
      search: {
        id: "sv2-ticket-search",
        placeholder: "Talep no, konu, firma, muhatap, danışman...",
        value: state.search,
      },
      chips: [],
      sortOptions: [
        { value: "created_desc", label: "En Yeni", selected: !state.colSort && state.sort === "created_desc" },
        { value: "created_asc", label: "En Eski", selected: !state.colSort && state.sort === "created_asc" },
        { value: "priority_desc", label: "Öncelik (Yüksek)", selected: !state.colSort && state.sort === "priority_desc" },
        { value: "status_asc", label: "Durum", selected: !state.colSort && state.sort === "status_asc" },
        { value: "number_asc", label: "Talep No", selected: !state.colSort && state.sort === "number_asc" },
      ],
      advancedFilters: advancedFiltersHtml(),
    })}
    <div class="sv2-mb-1">
      <span class="sv2-text-muted" style="font-size:0.8125rem;font-weight:600">TİP:</span>
      <div class="sv2-filter-chips" id="sv2-type-chips" data-multi="true" style="display:inline-flex;margin-left:0.5rem;flex-wrap:wrap">
        ${typeChips()
          .map(
            (c) =>
              `<button type="button" class="sv2-chip${c.active ? " active is-active" : ""}" data-value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</button>`
          )
          .join("")}
      </div>
    </div>
    <div class="sv2-section">
      <div class="sv2-section-body" id="sv2-tickets-table">${renderTableSection(paged, filteredIds)}</div>
    </div>
    <div id="sv2-search-ac-root"></div>`;
}

function bindChipGroup(rootId, multi, onUpdate) {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.querySelectorAll(".sv2-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (multi) {
        chip.classList.toggle("active");
        chip.classList.toggle("is-active");
        const active = [...root.querySelectorAll(".sv2-chip.active")].map((c) => c.dataset.value);
        onUpdate(active);
      } else {
        root.querySelectorAll(".sv2-chip").forEach((c) => {
          c.classList.remove("active", "is-active");
        });
        chip.classList.add("active", "is-active");
        onUpdate([chip.dataset.value]);
      }
    });
  });
}

/** Arama kutusu: yazmayı bıraktıktan 200 ms sonra süzer; ticket no öneri listesi aynı önbellekli metinden üretilir. */
function bindSearchAutocomplete() {
  const input = document.getElementById("sv2-ticket-search");
  if (!input) return;

  let listEl = document.getElementById("sv2-ticket-search-ac");
  if (!listEl) {
    listEl = document.createElement("div");
    listEl.id = "sv2-ticket-search-ac";
    listEl.className = "sv2-autocomplete-list";
    listEl.hidden = true;
    input.parentNode.classList.add("sv2-autocomplete-wrap");
    input.parentNode.appendChild(listEl);
  }

  const run = debounce(() => {
    const q = input.value.trim();
    state.page = 1;
    if (q.length < 2) {
      listEl.hidden = true;
      renderTableOnly();
      return;
    }
    const tokens = searchTokens(q);
    const matches = allTickets.filter((t) => ticketMatchesTokens(t, tokens)).slice(0, 8);

    if (!matches.length) {
      listEl.hidden = true;
      renderTableOnly();
      return;
    }

    listEl.innerHTML = matches
      .map(
        (t) => `
      <button type="button" class="sv2-ac-item" data-value="${escapeHtml(getTicketKey(t))}">
        <strong>${escapeHtml(t.ticket_number)}</strong> — ${escapeHtml(t.title || "")}
        <div class="sv2-autocomplete-meta">${escapeHtml(t.company_name || "")}</div>
      </button>`
      )
      .join("");
    listEl.hidden = false;

    listEl.querySelectorAll(".sv2-ac-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ticket = allTickets.find((t) => getTicketKey(t) === btn.dataset.value);
        if (ticket) {
          input.value = ticket.ticket_number;
          state.search = ticket.ticket_number;
        }
        listEl.hidden = true;
        state.page = 1;
        renderTableOnly();
      });
    });
    renderTableOnly();
  }, 200);

  input.addEventListener("input", () => {
    state.search = input.value;
    run();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      run.cancel();
      listEl.hidden = true;
      state.search = input.value;
      state.page = 1;
      renderTableOnly();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      listEl.hidden = true;
    }, 200);
  });
}

function clearFilter(key) {
  if (key === "sapModule") state.sapModule = "";
  else if (key === "priority") state.priority = "";
  else if (key === "consultantId") state.consultantId = "";
  else if (key === "companyId") {
    state.companyId = "";
    state.companyLabel = "";
  } else if (key === "dateFrom") state.dateFrom = "";
  else if (key === "dateTo") state.dateTo = "";
  else if (key === "unassignedOnly") state.unassignedOnly = false;
}

function clearAllFilters() {
  state.search = "";
  state.statusFilters = [];
  state.typeFilters = [];
  ["sapModule", "priority", "consultantId", "companyId", "dateFrom", "dateTo", "unassignedOnly"].forEach(clearFilter);
  state.page = 1;
}

function applyAdvanced() {
  const from = document.getElementById("sv2-filter-date-from")?.value || "";
  const to = document.getElementById("sv2-filter-date-to")?.value || "";
  if (from && to && to < from) {
    toast("Bitiş tarihi başlangıç tarihinden önce olamaz.", "error");
    return;
  }
  state.sapModule = document.getElementById("sv2-filter-sap")?.value || "";
  state.priority = document.getElementById("sv2-filter-priority")?.value || "";
  state.consultantId = document.getElementById("sv2-filter-consultant")?.value || "";
  // Firma yalnız LİSTEDEN seçildiyse (gizli kimlik doluysa) uygulanır; yazı silinince kimlik de silinir.
  const companyId = document.getElementById("sv2-filter-company-id")?.value || "";
  const companyText = (document.getElementById("sv2-filter-company")?.value || "").trim();
  if (companyText && !companyId) toast("Firma listeden seçilmedi; firma filtresi uygulanmadı.", "info");
  state.companyId = companyId && companyText ? companyId : "";
  state.companyLabel = state.companyId ? companyText : "";
  state.dateFrom = from;
  state.dateTo = to;
  state.unassignedOnly = !!document.getElementById("sv2-filter-unassigned")?.checked;
  state.page = 1;
  renderTableOnly();
}

function bindEvents() {
  bindChipGroup("sv2-filter-chips", true, (values) => {
    state.statusFilters = values;
    state.page = 1;
    renderTableOnly();
  });

  bindChipGroup("sv2-type-chips", true, (values) => {
    state.typeFilters = values;
    state.page = 1;
    renderTableOnly();
  });

  document.getElementById("sv2-sort-select")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    state.colSort = null;
    state.page = 1;
    renderTableOnly();
  });

  document.getElementById("sv2-advanced-toggle")?.addEventListener("click", () => {
    const panel = document.getElementById("sv2-advanced-panel");
    if (panel) panel.hidden = !panel.hidden;
  });

  document.getElementById("sv2-apply-advanced")?.addEventListener("click", applyAdvanced);

  bindSearchAutocomplete();

  // Firma filtresi: seçim yalnız gizli alana yazılır (state'e değil); yazı değişince kimlik silinir. "Uygula" ile etkinleşir.
  renderAutocomplete(
    "sv2-filter-company",
    allCompanies.map((c) => ({
      id: c.company_id || c.id,
      label: `${c.name} (${c.customer_code || ""})${c.is_active === false ? " — pasif" : ""}`,
      name: c.name,
    })),
    (picked) => {
      if (picked?.id) document.getElementById("sv2-filter-company-id").value = picked.id;
    },
    {
      minChars: 1,
      labelKey: "label",
      valueKey: "id",
      onTyping: () => {
        const hidden = document.getElementById("sv2-filter-company-id");
        if (hidden) hidden.value = "";
      },
    }
  );

  document.getElementById("sv2-new-ticket")?.addEventListener("click", openCreateModal);
  document.getElementById("sv2-toggle-deleted")?.addEventListener("click", toggleArchive);
  document.getElementById("sv2-export-csv")?.addEventListener("click", exportCsv);
  document.getElementById("sv2-export-excel")?.addEventListener("click", exportExcel);
  bindTableActions();
}

function bindTableActions() {
  bindArchiveActions();
  const wrap = document.getElementById("sv2-tickets-table");
  if (!wrap) return;

  // Sütun başlığı sıralaması
  const holder = document.getElementById("sv2-table-holder");
  if (holder && !state.showDeleted) {
    const cols = tableColumns();
    makeHeadersSortable(holder, cols, currentSort(), (key) => {
      state.colSort = nextSort(state.colSort || currentSort(), key, key === "created_at" ? "desc" : "asc");
      state.page = 1;
      renderTableOnly();
    });
    // Toplu seçim: başlıktaki onay kutusu görünen satırların tümünü seçer
    const headerSelect = holder.querySelector("table.sv2-table thead th");
    if (headerSelect && canBulk()) {
      const ids = [...holder.querySelectorAll(".sv2-bulk-cb")].map((cb) => cb.dataset.id);
      headerSelect.innerHTML = `<input type="checkbox" id="sv2-bulk-all" aria-label="Görünen satırların tümünü seç"${ids.length && ids.every((id) => selected.has(id)) ? " checked" : ""}>`;
      headerSelect.querySelector("#sv2-bulk-all")?.addEventListener("change", (e) => {
        ids.forEach((id) => (e.target.checked ? selected.add(id) : selected.delete(id)));
        renderTableOnly();
      });
    }
  }

  document.getElementById("sv2-page-size")?.addEventListener("change", (e) => {
    state.pageSize = Number(e.target.value) || 25;
    state.page = 1;
    renderTableOnly();
  });

  wrap.querySelectorAll(".sv2-clear-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      clearFilter(btn.dataset.clear);
      state.page = 1;
      renderPage();
    });
  });
  document.getElementById("sv2-clear-all-filters")?.addEventListener("click", () => {
    clearAllFilters();
    renderPage();
  });

  wrap.querySelectorAll(".sv2-bulk-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(cb.dataset.id);
      else selected.delete(cb.dataset.id);
      renderTableOnly();
    });
  });
  document.getElementById("sv2-bulk-clear")?.addEventListener("click", () => {
    selected.clear();
    renderTableOnly();
  });
  document.getElementById("sv2-bulk-select-filtered")?.addEventListener("click", () => {
    const filtered = filterTickets(allTickets);
    const take = filtered.slice(0, BULK_MAX_TICKETS);
    take.forEach((t) => selected.add(getTicketKey(t)));
    if (filtered.length > BULK_MAX_TICKETS) toast(`Bir seferde en çok ${BULK_MAX_TICKETS} talep seçilebilir; ilk ${BULK_MAX_TICKETS} talep seçildi.`, "warning");
    renderTableOnly();
  });
  document.getElementById("sv2-bulk-assign")?.addEventListener("click", openBulkAssignModal);
  document.getElementById("sv2-bulk-status")?.addEventListener("click", openBulkStatusModal);

  document.querySelectorAll(".sv2-approval-cb").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const id = cb.dataset.id;
      showLoading(true);
      try {
        await ParlaDb.updateTicket(id, { is_approved: cb.checked }, session, { silent: true });
        const t = allTickets.find((x) => getTicketKey(x) === id);
        if (t) t.is_approved = cb.checked;
        toast(cb.checked ? "Talep onaylandı." : "Onay kaldırıldı.", "success");
      } catch (err) {
        cb.checked = !cb.checked;
        handleError(err, "Onay");
      } finally {
        showLoading(false);
      }
    });
  });

  document.querySelectorAll(".sv2-delete-ticket").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const number = btn.dataset.number;
      renderConfirmDialog(
        `"${number}" numaralı talep arşive alınacak (silinmiş sayılır): listelerden, panodan, raporlardan ve müşteri sayfalarından kalkar; veriler korunur. Yönetici daha sonra geri yükleyebilir. Devam etmek istiyor musunuz?`,
        async () => {
          showLoading(true);
          try {
            const archived = await ParlaDb.deleteTicket(id, session, { reason: "Admin listesinden silindi (arşive alındı)" });
            deletedTickets = [archived, ...deletedTickets.filter((t) => getTicketKey(t) !== id)];
            allTickets = allTickets.filter((t) => getTicketKey(t) !== id);
            selected.delete(id);
            toast("Talep arşive alındı.", "success");
            renderTableOnly();
          } catch (err) {
            handleError(err, "Silme");
          } finally {
            showLoading(false);
          }
        }
      );
    });
  });
}

function bindArchiveActions() {
  document.querySelectorAll(".sv2-restore-ticket").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      showLoading(true);
      try {
        const restored = await ParlaDb.restoreTicket(id, session);
        deletedTickets = deletedTickets.filter((t) => getTicketKey(t) !== id);
        allTickets = [restored, ...allTickets.filter((t) => getTicketKey(t) !== id)];
        toast("Talep arşivden geri yüklendi.", "success");
        renderTableOnly();
      } catch (err) {
        handleError(err, "Geri yükleme");
      } finally {
        showLoading(false);
      }
    });
  });
  document.querySelectorAll(".sv2-permanent-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      renderConfirmDialog(
        `"${btn.dataset.number}" numaralı talep; mesajları, iç notları, ekleri, geçmişi, atamaları ve eforlarıyla birlikte KALICI olarak silinecek. Bu işlem geri alınamaz. Devam etmek istiyor musunuz?`,
        async () => {
          showLoading(true);
          try {
            await ParlaDb.permanentlyDeleteTicket(id, session);
            deletedTickets = deletedTickets.filter((t) => getTicketKey(t) !== id);
            toast("Talep kalıcı olarak silindi.", "success");
            renderTableOnly();
          } catch (err) {
            handleError(err, "Kalıcı silme");
          } finally {
            showLoading(false);
          }
        }
      );
    });
  });
}

async function toggleArchive() {
  showLoading(true);
  try {
    state.showDeleted = !state.showDeleted;
    state.page = 1;
    if (state.showDeleted) deletedTickets = await ParlaDb.getAllTickets({ onlyDeleted: true });
    renderPage();
  } catch (err) {
    state.showDeleted = false;
    handleError(err, "Arşiv yüklenemedi");
  } finally {
    showLoading(false);
  }
}

function currentSource() {
  return state.showDeleted ? deletedTickets : allTickets;
}

function renderTableOnly() {
  const filtered = filterTickets(currentSource());
  const paged = paginate(filtered);
  state.page = paged.page;
  const wrap = document.getElementById("sv2-tickets-table");
  if (wrap) {
    wrap.innerHTML = renderTableSection(paged, state.showDeleted ? [] : filtered.map(getTicketKey));
    bindTableActions();
  }
}

function renderPage() {
  const filtered = filterTickets(currentSource());
  const paged = paginate(filtered);
  state.page = paged.page;

  renderShell("#sv2-app", {
    title: "Talepler",
    activePage: "tickets",
    profile: session,
    isAdmin: true,
    content: buildPageContent(paged, state.showDeleted ? [] : filtered.map(getTicketKey)),
  });

  bindEvents();
}

/* ------------------------------------------------------------------ *
 * Dışa aktarma
 * ------------------------------------------------------------------ */

const EXPORT_HEADERS = ["NO", "KONU", "MÜŞTERİ NO", "MÜŞTERİ UNVAN", "DANIŞMAN", "EFOR", "ONAY", "TARİH", "DURUM", "ÖNCELİK", "TİP", "SAP MODÜL"];

function exportRow(t) {
  return [
    t.ticket_number,
    t.title,
    t.customer_code,
    t.company_name,
    t.assigned_to_name,
    t.total_work_hours,
    t.is_approved ? "Evet" : "Hayır",
    formatDate(t.created_at),
    formatStatusLabel(t.status),
    formatPriorityLabel(t.priority),
    t.ticket_type,
    t.sap_module,
  ];
}

function exportCsv() {
  const filtered = filterTickets(allTickets);
  if (!filtered.length) {
    toast("Dışa aktarılacak kayıt yok.", "error");
    return;
  }
  // Tek yardımcı: `;` ayraç + formül nötrleme (SEN-20, PER-06, PER-24, ALT-08).
  downloadCsv(`parla-tickets-${new Date().toISOString().slice(0, 10)}.csv`, EXPORT_HEADERS, filtered.map(exportRow));
  toast(`${filtered.length} kayıt CSV olarak indirildi.`, "success");
}

async function exportExcel() {
  const filtered = filterTickets(allTickets);
  if (!filtered.length) {
    toast("Dışa aktarılacak kayıt yok.", "error");
    return;
  }

  showLoading(true);
  try {
    await downloadExcel(`parla-tickets-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: "Talepler", headers: EXPORT_HEADERS, rows: filtered.map(exportRow) },
    ]);
    toast(`${filtered.length} kayıt Excel olarak indirildi.`, "success");
  } catch (err) {
    handleError(err, "Excel dışa aktarma");
  } finally {
    showLoading(false);
  }
}

/* ------------------------------------------------------------------ *
 * Toplu işlemler (WP-16)
 * ------------------------------------------------------------------ */

function selectedTickets() {
  return allTickets.filter((t) => selected.has(getTicketKey(t)));
}

function activePersonnelOptions() {
  return allPersonnel
    .filter((p) => p.is_active !== false)
    .sort((a, b) => personnelFullName(a).localeCompare(personnelFullName(b), "tr"));
}

function listHtml(lines) {
  if (!lines.length) return "";
  return `<ul style="margin:0.25rem 0 0;padding-left:1.25rem;font-size:0.8125rem">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
}

function previewBulkAssign() {
  const pid = document.getElementById("bulk-assign-person")?.value;
  const mode = document.querySelector('input[name="bulk-assign-mode"]:checked')?.value || "primary";
  const person = allPersonnel.find((p) => (p.personnel_id || p.id) === pid);
  const el = document.getElementById("bulk-assign-preview");
  const okBtn = document.getElementById("bulk-assign-confirm");
  if (!el) return null;
  if (!person) {
    el.textContent = "Danışman seçin.";
    if (okBtn) okBtn.disabled = true;
    return null;
  }
  const plan = planBulkAssign(selectedTickets(), person, mode, assignmentsByTicket, allPersonnel);
  el.innerHTML = `<strong>${plan.eligible.length}</strong> talep atanacak, <strong>${plan.skipped.length}</strong> talep atlanacak.${listHtml(describeSkipped(plan.skipped, 8))}${
    person.uid ? "" : '<div class="sv2-text-warning" style="margin-top:0.35rem">Bu danışmanın kullanıcı hesabı eşleşmemiş: talepte işlem yapamaz ("Personel ↔ Kullanıcı Eşleştir" aracını çalıştırın).</div>'
  }`;
  if (okBtn) {
    okBtn.disabled = plan.eligible.length === 0;
    okBtn.textContent = `Ata (${plan.eligible.length} talep)`;
  }
  return { plan, person, mode };
}

function openBulkAssignModal() {
  if (!canBulk() || !selected.size) return;
  const options = activePersonnelOptions()
    .map((p) => `<option value="${escapeHtml(p.personnel_id || p.id)}">${escapeHtml(personnelFullName(p))}</option>`)
    .join("");
  renderModal("sv2-bulk-assign-modal", {
    title: `Toplu Ata (${selected.size} talep)`,
    body: `
      <div class="sv2-form-group">
        <label for="bulk-assign-person">Danışman *</label>
        <select id="bulk-assign-person"><option value="">— Seçiniz —</option>${options}</select>
      </div>
      <fieldset class="sv2-form-group" style="border:0;padding:0;margin:0 0 1rem">
        <legend style="font-weight:600;font-size:0.875rem">Atama şekli</legend>
        <label style="display:block"><input type="radio" name="bulk-assign-mode" value="primary" checked> Birincil danışman olarak ata (mevcut danışmanlar ikincil kalır)</label>
        <label style="display:block"><input type="radio" name="bulk-assign-mode" value="replace"> Yerine ata (diğer danışmanlar kaldırılır)</label>
      </fieldset>
      <div id="bulk-assign-preview" class="sv2-text-muted" aria-live="polite"></div>
      <p class="sv2-text-muted" style="font-size:0.8125rem;margin-top:0.75rem" id="bulk-assign-policy">Bildirim: toplu atamada e-posta gönderilmez; talepler atanan danışmanın bildirim zilinde görünür. İşlem tek bir özet aktivite kaydı olarak yazılır. Kapalı/çözülmüş talepler atlanır.</p>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="sv2-bulk-assign-modal">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="bulk-assign-confirm" disabled>Ata</button>`,
  });
  openModal("sv2-bulk-assign-modal");
  document.getElementById("bulk-assign-person")?.addEventListener("change", previewBulkAssign);
  document.querySelectorAll('input[name="bulk-assign-mode"]').forEach((r) => r.addEventListener("change", previewBulkAssign));
  const confirmBtn = document.getElementById("bulk-assign-confirm");
  confirmBtn?.addEventListener("click", () =>
    withInflight(confirmBtn, async () => {
      const preview = previewBulkAssign();
      if (!preview || !preview.plan.eligible.length) return;
      await runBulkAssign(preview);
    })
  );
}

async function runBulkAssign({ plan, person, mode }) {
  closeModal("sv2-bulk-assign-modal");
  showLoading(true);
  try {
    const items = plan.eligible.map(({ ticket, assignments }) => ({
      id: getTicketKey(ticket),
      updates: {},
      options: { assignments, expectedStatus: ticket.status },
    }));
    const results = await ParlaDb.bulkUpdateTickets(items, session, { personnel: allPersonnel });
    const failed = results.filter((r) => !r.ok);
    const ok = results.filter((r) => r.ok);
    applyBulkResults(ok);
    assignmentsByTicket = await ParlaDb.getAllAssignments().catch(() => assignmentsByTicket);
    keepOnlyFailedSelected(failed);

    const name = personnelFullName(person);
    const failedLines = failed.map((r) => {
      const t = allTickets.find((x) => getTicketKey(x) === r.id);
      return `${t?.ticket_number || r.id}: ${r.error?.message || "yazılamadı"}`;
    });
    await ParlaDb.logActivity(
      "ticket_bulk_assigned",
      "bulk",
      "",
      `Toplu atama: ${name}`,
      `${ok.length} talep ${name} adlı danışmana atandı (${mode === "replace" ? "yerine" : "birincil"}); ${plan.skipped.length} atlandı, ${failed.length} başarısız. ${ok
        .map((r) => r.ticket?.ticket_number)
        .filter(Boolean)
        .join(", ")}`.slice(0, 1000),
      session
    ).catch(() => {});
    toast(`Toplu atama: ${ok.length} talep atandı, ${plan.skipped.length} atlandı, ${failed.length} başarısız.`, failed.length ? "warning" : "success");
    renderTableOnly();
    showBulkResult({
      title: "Toplu Atama Özeti",
      summary: `${ok.length} talep ${name} adlı danışmana atandı.`,
      skipped: describeSkipped(plan.skipped, 15),
      failed: failedLines,
      note: "Atama bildirimi e-posta ile gönderilmedi; danışman talepleri bildirim zilinde görür.",
    });
  } catch (err) {
    handleError(err, "Toplu atama");
  } finally {
    showLoading(false);
  }
}

function previewBulkStatus() {
  const target = document.getElementById("bulk-status-target")?.value;
  const el = document.getElementById("bulk-status-preview");
  const okBtn = document.getElementById("bulk-status-confirm");
  if (!el) return null;
  if (!target) {
    el.textContent = "Hedef durumu seçin.";
    if (okBtn) okBtn.disabled = true;
    return null;
  }
  const plan = planBulkStatus(selectedTickets(), target, { role: session.role });
  const notifies = BULK_NOTIFY_STATUSES.includes(target);
  el.innerHTML = `<strong>${plan.eligible.length}</strong> talep «${escapeHtml(STATUS_LABELS[target] || target)}» durumuna alınacak, <strong>${plan.skipped.length}</strong> talep atlanacak (izinli geçiş matrisi dışı).${listHtml(describeSkipped(plan.skipped, 8))}
    <div style="margin-top:0.35rem">${
      notifies
        ? `Müşteriye e-posta gönderilecek (en çok ${BULK_NOTIFY_LIMIT} talep; fazlası bildirimsiz uygulanır).`
        : "Bu durum için müşteriye e-posta gönderilmez (yalnız Çözüldü / Kapandı bildirilir)."
    }</div>`;
  if (okBtn) {
    okBtn.disabled = plan.eligible.length === 0;
    okBtn.textContent = `Uygula (${plan.eligible.length} talep)`;
  }
  return { plan, target };
}

function openBulkStatusModal() {
  if (!canBulk() || !selected.size) return;
  const options = Object.values(STATUSES)
    .map((s) => `<option value="${s}">${escapeHtml(STATUS_LABELS[s] || s)}</option>`)
    .join("");
  renderModal("sv2-bulk-status-modal", {
    title: `Toplu Durum Değişikliği (${selected.size} talep)`,
    body: `
      <div class="sv2-form-group">
        <label for="bulk-status-target">Yeni durum *</label>
        <select id="bulk-status-target"><option value="">— Seçiniz —</option>${options}</select>
      </div>
      <div class="sv2-form-group">
        <label for="bulk-status-note">Durum değişiklik notu * <span class="sv2-text-muted">(her talebin geçmişine yazılır; en az 10 karakter)</span></label>
        <textarea id="bulk-status-note" rows="3" maxlength="1000" placeholder="Toplu durum değişikliği gerekçesi"></textarea>
        <div class="sv2-field-error" id="bulk-status-note-error" hidden></div>
      </div>
      <div id="bulk-status-preview" class="sv2-text-muted" aria-live="polite"></div>
      <p class="sv2-text-muted" style="font-size:0.8125rem;margin-top:0.75rem" id="bulk-status-policy">Bildirim politikası (e-posta kotasını korumak için): toplu durum değişikliğinde yalnızca <strong>Çözüldü</strong> ve <strong>Kapandı</strong> olayları müşteriye bildirilir; diğer durumlar bildirimsiz uygulanır. İşlem tek bir özet aktivite kaydı olarak yazılır. Geçersiz geçişler atlanır ve özette listelenir.</p>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="sv2-bulk-status-modal">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="bulk-status-confirm" disabled>Uygula</button>`,
  });
  openModal("sv2-bulk-status-modal");
  document.getElementById("bulk-status-target")?.addEventListener("change", previewBulkStatus);
  const confirmBtn = document.getElementById("bulk-status-confirm");
  confirmBtn?.addEventListener("click", () =>
    withInflight(confirmBtn, async () => {
      const preview = previewBulkStatus();
      if (!preview || !preview.plan.eligible.length) return;
      const note = (document.getElementById("bulk-status-note")?.value || "").trim();
      const errEl = document.getElementById("bulk-status-note-error");
      if (note.length < 10) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = "Durum değişikliği için en az 10 karakterlik not zorunludur.";
        }
        return;
      }
      await runBulkStatus(preview, note);
    })
  );
}

/** Durum -> bildirim tipi (yalnız bildirilen durumlar). */
function bulkEventFor(status) {
  return status === STATUSES.RESOLVED ? "ticket_resolved" : status === STATUSES.CLOSED ? "ticket_closed" : "";
}

async function runBulkStatus({ plan, target }, note) {
  closeModal("sv2-bulk-status-modal");
  showLoading(true);
  try {
    const items = plan.eligible.map((ticket) => ({
      id: getTicketKey(ticket),
      updates: { status: target },
      options: { expectedStatus: ticket.status, note },
    }));
    const results = await ParlaDb.bulkUpdateTickets(items, session, { personnel: allPersonnel });
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    applyBulkResults(ok);
    keepOnlyFailedSelected(failed);

    // Müşteri bildirimi: yalnız çözüldü/kapandı; kota dostu üst sınır
    let notified = 0;
    let notifySkipped = 0;
    const eventType = bulkEventFor(target);
    if (eventType) {
      const mailResults = [];
      for (const r of ok) {
        const to = String(r.ticket?.user_email || "").trim();
        if (!to || to.toLowerCase() === String(session.email || "").toLowerCase()) continue;
        if (notified >= BULK_NOTIFY_LIMIT) {
          notifySkipped += 1;
          continue;
        }
        notified += 1;
        mailResults.push(await ParlaEmailService.notifyTicketEvent(eventType, [to], r.ticket, { history_id: r.report?.statusHistoryId }));
      }
      await reportEmailResults(mailResults, { eventType, label: "Toplu işlem bildirimi", ticket: null, actor: session });
    }

    const failedLines = failed.map((r) => {
      const t = allTickets.find((x) => getTicketKey(x) === r.id);
      return `${t?.ticket_number || r.id}: ${r.error?.message || "yazılamadı"}`;
    });
    await ParlaDb.logActivity(
      "ticket_bulk_status",
      "bulk",
      "",
      `Toplu durum: ${STATUS_LABELS[target] || target}`,
      `${ok.length} talep «${STATUS_LABELS[target] || target}» durumuna alındı; ${plan.skipped.length} atlandı, ${failed.length} başarısız; ${notified} müşteri bildirimi. ${ok
        .map((r) => r.ticket?.ticket_number)
        .filter(Boolean)
        .join(", ")}`.slice(0, 1000),
      session
    ).catch(() => {});
    toast(`Toplu durum: ${ok.length} talep güncellendi, ${plan.skipped.length} atlandı, ${failed.length} başarısız.`, failed.length ? "warning" : "success");
    renderTableOnly();
    showBulkResult({
      title: "Toplu Durum Değişikliği Özeti",
      summary: `${ok.length} talep «${STATUS_LABELS[target] || target}» durumuna alındı.`,
      skipped: describeSkipped(plan.skipped, 15),
      failed: failedLines,
      note: eventType
        ? `${notified} müşteriye bildirim e-postası gönderildi${notifySkipped ? `; ${notifySkipped} talep için kota sınırı nedeniyle gönderilmedi` : ""}.`
        : "Bu durum için müşteriye e-posta gönderilmedi (yalnız Çözüldü / Kapandı bildirilir).",
    });
  } catch (err) {
    handleError(err, "Toplu durum değişikliği");
  } finally {
    showLoading(false);
  }
}

/** İşlemden sonra seçim temizlenir; yalnız yazılamayanlar (yeniden denemek için) seçili kalır. */
function keepOnlyFailedSelected(failed) {
  selected.clear();
  failed.forEach((r) => selected.add(r.id));
}

/** Başarılı sonuçları yerel listeye yansıtır (tüm koleksiyon yeniden indirilmez). */
function applyBulkResults(okResults) {
  const byId = new Map(okResults.map((r) => [r.id, r.ticket]));
  allTickets = allTickets.map((t) => byId.get(getTicketKey(t)) || t);
}

function showBulkResult({ title, summary, skipped, failed, note }) {
  renderModal("sv2-bulk-result-modal", {
    title,
    body: `
      <p id="bulk-result-summary"><strong>${escapeHtml(summary)}</strong></p>
      ${skipped.length ? `<h4 style="margin:0.75rem 0 0.25rem">Atlananlar</h4><div id="bulk-result-skipped">${listHtml(skipped)}</div>` : ""}
      ${failed.length ? `<h4 style="margin:0.75rem 0 0.25rem">Başarısız olanlar</h4><div id="bulk-result-failed">${listHtml(failed)}</div>` : ""}
      <p class="sv2-text-muted" style="margin-top:0.75rem;font-size:0.8125rem" id="bulk-result-note">${escapeHtml(note)}</p>`,
    footer: `<button type="button" class="sv2-btn sv2-btn-primary" data-close="sv2-bulk-result-modal">Tamam</button>`,
  });
  openModal("sv2-bulk-result-modal");
}

/* ------------------------------------------------------------------ *
 * Yeni talep oluşturma (PRJ: proje seçimi — D-11 A)
 * ------------------------------------------------------------------ */

/** Seçili firmanın (iptal olmayan) projeleri; PRJ talebinde proje seçimi için. */
function createProjectOptions(companyId) {
  return allProjects
    .filter((p) => p.company_id === companyId && p.status !== "cancelled")
    .sort((a, b) => String(a.project_code || "").localeCompare(String(b.project_code || ""), "tr"))
    .map((p) => `<option value="${escapeHtml(p.id || p.project_id)}">${escapeHtml(p.project_code || "")} — ${escapeHtml(p.name || "")}</option>`)
    .join("");
}

function refreshCreateProjects() {
  const select = document.getElementById("sv2-create-project");
  if (!select) return;
  const companyId = document.getElementById("sv2-create-company-id")?.value || "";
  select.innerHTML = `<option value="">— Proje seçin —</option>${createProjectOptions(companyId)}`;
  const hint = document.getElementById("sv2-create-project-hint");
  if (hint) {
    hint.textContent = !companyId
      ? "Önce firmayı seçin."
      : select.options.length <= 1
        ? "Bu firmanın aktif projesi yok; önce Projeler sayfasından proje ekleyin."
        : "";
  }
}

function openCreateModal() {
  selectedCompany = null;
  const typeOpts = Object.values(TICKET_TYPES)
    .map(
      (t) =>
        `<option value="${t}">${escapeHtml(formatTicketTypeLabel(t))}</option>`
    )
    .join("");

  const priOpts = Object.values(PRIORITIES)
    .map((p) => `<option value="${p}">${escapeHtml(PRIORITY_LABELS[p])}</option>`)
    .join("");

  const sapOpts = SAP_MODULES.map(
    (m) => `<option value="${escapeHtml(m)}">${escapeHtml(SAP_MODULE_LABELS[m] || m)}</option>`
  ).join("");

  const userOpts = allUsers
    .filter((u) => u.is_active !== false)
    .map((u) => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
      return `<option value="${escapeHtml(u.uid)}" data-company="${escapeHtml(u.company_id || "")}" data-code="${escapeHtml(u.customer_code || "")}" data-company-name="${escapeHtml(u.company_name || "")}">${escapeHtml(name)} (${escapeHtml(u.email || "")})</option>`;
    })
    .join("");

  renderModal("sv2-create-ticket-modal", {
    title: "Yeni Talep Oluştur",
    body: `
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="sv2-create-type">Talep Tipi *</label>
          <select id="sv2-create-type">${typeOpts}</select>
        </div>
        <div class="sv2-form-group">
          <label for="sv2-create-priority">Öncelik *</label>
          <select id="sv2-create-priority">${priOpts}</select>
        </div>
      </div>
      <div class="sv2-form-row">
        <div class="sv2-form-group sv2-autocomplete-wrap">
          <label for="sv2-create-company">Firma *</label>
          <input type="text" id="sv2-create-company" placeholder="Firma ara..." autocomplete="off">
          <input type="hidden" id="sv2-create-company-id">
          <input type="hidden" id="sv2-create-customer-code">
        </div>
        <div class="sv2-form-group">
          <label for="sv2-create-user">Muhatap</label>
          <select id="sv2-create-user"><option value="">— Seçiniz —</option>${userOpts}</select>
        </div>
      </div>
      <div id="sv2-create-new-company-fields" hidden>
        <div class="sv2-form-row">
          <div class="sv2-form-group">
            <label for="sv2-create-company-type">Müşteri Tipi</label>
            <select id="sv2-create-company-type">
              <option value="CUS">CUS — Destek Anlaşmalı</option>
              <option value="ARC">ARC — Arızi Müşteri</option>
            </select>
          </div>
          <div class="sv2-form-group">
            <label for="sv2-create-company-code">Müşteri Kodu</label>
            <input type="text" id="sv2-create-company-code" placeholder="CUS0001">
          </div>
        </div>
      </div>
      <div class="sv2-form-group" id="sv2-create-project-group" hidden>
        <label for="sv2-create-project">Proje *</label>
        <select id="sv2-create-project"><option value="">— Proje seçin —</option></select>
        <span class="sv2-text-muted" id="sv2-create-project-hint" style="font-size:0.8125rem"></span>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-create-sap">SAP Modülü *</label>
        <select id="sv2-create-sap">${sapOpts}</select>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-create-title">Konu *</label>
        <input type="text" id="sv2-create-title" maxlength="100" placeholder="Talep başlığı">
      </div>
      <div class="sv2-form-group">
        <label for="sv2-create-desc">Açıklama *</label>
        <textarea id="sv2-create-desc" rows="4" placeholder="Detaylı açıklama (en az 20 karakter)"></textarea>
      </div>
      <div id="sv2-create-errors" class="sv2-form-error" style="display:none"></div>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="sv2-create-ticket-modal">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-create-save">Oluştur</button>`,
  });

  openModal("sv2-create-ticket-modal");

  document.getElementById("sv2-create-type")?.addEventListener("change", (e) => {
    const group = document.getElementById("sv2-create-project-group");
    if (group) group.hidden = e.target.value !== "PRJ";
    if (e.target.value === "PRJ") refreshCreateProjects();
  });

  // Pasif firma yeni talep için seçilemez (talep açma kuralı); yalnız aktif firmalar önerilir.
  renderAutocomplete(
    "sv2-create-company",
    selectableCompanies(allCompanies, "").map((o) => ({
      id: o.id,
      label: `${o.name} (${o.company.customer_code || ""})`,
      name: o.name,
      customer_code: o.company.customer_code,
    })),
    (item) => {
      const newFields = document.getElementById("sv2-create-new-company-fields");
      if (item?.create) {
        selectedCompany = { create: true, name: item.term };
        document.getElementById("sv2-create-company-id").value = "";
        document.getElementById("sv2-create-customer-code").value = "";
        newFields.hidden = false;
        const type = document.getElementById("sv2-create-company-type").value;
        document.getElementById("sv2-create-company-code").value = suggestNextCode(type);
        refreshCreateProjects();
        return;
      }
      selectedCompany = item;
      document.getElementById("sv2-create-company-id").value = item?.id || "";
      document.getElementById("sv2-create-customer-code").value = item?.customer_code || "";
      document.getElementById("sv2-create-company").value = item?.name || item?.label || "";
      newFields.hidden = true;
      refreshCreateProjects();

      const userSelect = document.getElementById("sv2-create-user");
      if (userSelect) {
        [...userSelect.options].forEach((opt) => {
          if (!opt.value) return;
          opt.hidden = opt.dataset.company && opt.dataset.company !== item.id;
        });
      }
    },
    {
      minChars: 1,
      labelKey: "label",
      valueKey: "id",
      nameKey: "name",
      createLabel: '"{term}" — Yeni firma kaydet',
      onTyping: () => {
        selectedCompany = null;
        document.getElementById("sv2-create-company-id").value = "";
        document.getElementById("sv2-create-customer-code").value = "";
        document.getElementById("sv2-create-new-company-fields").hidden = true;
        refreshCreateProjects();
      },
    }
  );

  document.getElementById("sv2-create-company-type")?.addEventListener("change", (e) => {
    document.getElementById("sv2-create-company-code").value = suggestNextCode(e.target.value);
  });

  document.getElementById("sv2-create-user")?.addEventListener("change", (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt?.dataset.company) {
      document.getElementById("sv2-create-company-id").value = opt.dataset.company;
      document.getElementById("sv2-create-customer-code").value = opt.dataset.code || "";
      document.getElementById("sv2-create-company").value = opt.dataset.companyName || "";
      refreshCreateProjects();
    }
  });

  const createSaveBtn = document.getElementById("sv2-create-save");
  createSaveBtn?.addEventListener("click", () => withInflight(createSaveBtn, saveNewTicket));
}

async function saveNewTicket() {
  let companyId = document.getElementById("sv2-create-company-id")?.value;
  let companyName = document.getElementById("sv2-create-company")?.value?.trim();
  let customerCode = document.getElementById("sv2-create-customer-code")?.value;
  const userId = document.getElementById("sv2-create-user")?.value;
  const user = allUsers.find((u) => u.uid === userId);

  const formData = {
    ticket_type: document.getElementById("sv2-create-type")?.value,
    priority: document.getElementById("sv2-create-priority")?.value,
    sap_module: document.getElementById("sv2-create-sap")?.value,
    title: document.getElementById("sv2-create-title")?.value,
    description: document.getElementById("sv2-create-desc")?.value,
  };
  const projectId = formData.ticket_type === "PRJ" ? document.getElementById("sv2-create-project")?.value || "" : "";

  const validation = validateTicketForm(formData);
  const errEl = document.getElementById("sv2-create-errors");

  if (!companyId && !selectedCompany?.create) {
    validation.valid = false;
    validation.errors.company_id = "Firma seçimi zorunludur. Listeden seçin veya yeni firma kaydedin.";
  }
  if (formData.ticket_type === "PRJ" && !projectId) {
    validation.valid = false;
    validation.errors.project_id = "PRJ talebi için proje seçimi zorunludur.";
  }

  if (!validation.valid) {
    if (errEl) {
      errEl.style.display = "block";
      errEl.innerHTML = Object.values(validation.errors)
        .map((m) => `<div>${escapeHtml(m)}</div>`)
        .join("");
    }
    return;
  }

  showLoading(true);
  try {
    if (!companyId && selectedCompany?.create) {
      const type = document.getElementById("sv2-create-company-type")?.value || "CUS";
      const code =
        document.getElementById("sv2-create-company-code")?.value.trim() || suggestNextCode(type);
      const company = await ParlaDb.createCompany({
        name: companyName,
        customer_code: code,
        customer_type: type,
        created_by: session.uid,
        updated_by: session.uid,
      });
      companyId = company.id;
      companyName = company.name;
      customerCode = company.customer_code;
      allCompanies.push(company);
      await ParlaDb.logActivity(
        "company_created",
        "company",
        company.id,
        company.name,
        "Talep oluşturma sırasında yeni firma eklendi",
        session
      );
    }

    const ticket = await ParlaDb.createTicket(
      {
        ...formData,
        company_id: companyId,
        company_name: companyName,
        customer_code: customerCode,
        project_id: projectId,
        user_id: userId || session.uid,
        user_name: user
          ? [user.first_name, user.last_name].filter(Boolean).join(" ")
          : actorPayload().name,
        user_email: user?.email || session.email,
        status: "open",
      },
      session
    );

    await ParlaDb.logActivity(
      "ticket_created",
      "ticket",
      ticket.id,
      ticket.ticket_number,
      companyName,
      session
    );

    // Talep sahibine kayıt onayı (talebi açan yönetici kendisi ise tekrar mail gönderilmez).
    const notifyEmail = user?.email || session.email;
    if (notifyEmail && notifyEmail.toLowerCase() !== String(session.email || "").toLowerCase()) {
      const mailResult = await ParlaEmailService.notifyTicketEvent("ticket_created", notifyEmail, ticket, {
        note: "Destek ekibimiz sizin adınıza yeni bir destek talebi oluşturdu.",
      });
      await reportEmailResult(mailResult, {
        eventType: "ticket_created",
        label: "Talep onay e-postası",
        ticket,
        actor: session,
      });
    }

    allTickets.unshift(ticket);
    toast("Talep oluşturuldu.", "success");
    closeModal("sv2-create-ticket-modal");
    state.page = 1;
    renderPage();
  } catch (err) {
    handleError(err, "Oluşturma");
  } finally {
    showLoading(false);
  }
}

async function loadData() {
  showLoading(true);
  try {
    const [tickets, companies, personnel, users, assignMap, projects] = await Promise.all([
      ParlaDb.getAllTickets(),
      ParlaDb.getAllCompanies(),
      ParlaDb.getAllPersonnel(),
      ParlaDb.getAllUsers().catch(() => []), // kullanıcı listesi yalnızca admin rollerine açık
      ParlaDb.getAllAssignments().catch(() => ({})),
      ParlaDb.getAllProjects().catch(() => []),
    ]);
    assignmentsByTicket = assignMap;
    allTickets = tickets;
    allCompanies = companies;
    allPersonnel = personnel;
    allUsers = users;
    allProjects = projects;

    const params = new URLSearchParams(window.location.search);
    if (params.get("filter") === "unassigned") {
      state.unassignedOnly = true;
    }

    renderPage();
  } catch (err) {
    handleLoadError(err, "Talepler yüklenemedi", { retry: loadData, activePage: "tickets", pageTitle: "Talepler", isAdmin: true });
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
    await loadData();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin" && err.message !== "role_denied") {
      handleError(err, "Oturum");
    }
  }
}

init();
