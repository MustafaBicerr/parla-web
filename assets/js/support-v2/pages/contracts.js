/**
 * Parla BT Ticket V2 — Sözleşmeler (admin)
 *
 * WP-09: etkin durum TEK yardımcıdan (entity-utils), kendi etiket/rozetleri, değer/not görünür, bedel `contract_values`
 * düğümünde (yalnız super/service okur-yazar; PM/danışman görmez), pasif firmanın sözleşmesi düzenlenebilir,
 * form doğrulaması (benzersiz no, değer ≥ 0, tarih aralığı), firmanın "sözleşmeli" bayrağı sözleşmelerden türetilir.
 */
import ParlaDb from "../firebase-client.js";
import { canWrite } from "../access-control.js";
import { requireAuth } from "../auth-guard.js";
import {
  renderShell,
  renderFilterBar,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  bindFilterChips,
  toast,
  showLoading,
  handleError,
  handleLoadError,
  linkCompany,
  escapeHtml,
  formatDate,
} from "../ui-shell.js";
import { matchesSearch } from "../ticket-utils.js";
import {
  CONTRACT_TYPES,
  CONTRACT_STATUS,
  contractDaysRemaining,
  effectiveContractStatus,
  contractBadgeClass,
  contractStatusLabel,
  contractTypeLabel,
  selectableCompanies,
  validateContractInput,
} from "../entity-utils.js";
import { sortRows, paginateRows, debounce, nextSort, makeHeadersSortable } from "../table-utils.js";

const PAGE_SIZE = 25;

let session = null;
let allContracts = [];
let allCompanies = [];
let contractValues = {};
let activeFilter = "all";
let searchTerm = "";
let sort = { key: "created_at", dir: "desc" };
let page = 1;

document.addEventListener("DOMContentLoaded", init);

/** Bedel `contract_values` düğümünde ve yalnız super/service tarafından okunur/yazılır. */
function canSeeValue() {
  return canWrite(session, "admin");
}

async function init() {
  try {
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Sözleşmeler",
      activePage: "contracts",
      profile: session,
      isAdmin: true,
      content: `
        <div class="sv2-section">
          <div class="sv2-section-header">
            <h3>Sözleşme Listesi</h3>
            ${canWrite(session, "admin") ? `<button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-contract">
              <i class="fas fa-plus"></i> Yeni Sözleşme
            </button>` : ""}
          </div>
          <div class="sv2-section-body">
            <div id="contracts-filters"></div>
            <div id="contracts-table"></div>
          </div>
        </div>`,
    });
    await loadData();
    bindEvents();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin") {
      handleLoadError(err, "Sayfa yüklenemedi");
    }
  }
}

async function loadData() {
  showLoading(true);
  try {
    [allContracts, allCompanies, contractValues] = await Promise.all([
      ParlaDb.getAllContracts(),
      ParlaDb.getAllCompanies(),
      canSeeValue() ? ParlaDb.getContractValues().catch(() => ({})) : Promise.resolve({}),
    ]);
    renderFilters();
    renderTable();
  } catch (err) {
    handleLoadError(err, "Veriler yüklenemedi");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-contract")?.addEventListener("click", () => openFormModal(null));
}

function contractId(c) {
  return c.id || c.contract_id;
}

function filterContracts() {
  return allContracts.filter((c) => {
    const status = effectiveContractStatus(c);
    const days = contractDaysRemaining(c.end_date);

    if (activeFilter === "active" && status !== "active") return false;
    if (activeFilter === "expired" && status !== "expired") return false;
    if (activeFilter === "renewal" && !(status === "active" && days !== null && days <= 30 && days >= 0)) return false;
    if (activeFilter === "pending" && status !== "pending") return false;

    return matchesSearch(searchTerm, [c.contract_number, c.company_name, contractTypeLabel(c.type), contractStatusLabel(status)]);
  });
}

function renderFilters() {
  const el = document.getElementById("contracts-filters");
  if (!el) return;
  el.innerHTML = renderFilterBar({
    search: { id: "contract-search", placeholder: "Sözleşme no, firma...", value: searchTerm },
    chips: [
      { value: "all", label: "Tümü", active: activeFilter === "all" },
      { value: "active", label: "Aktif", active: activeFilter === "active" },
      { value: "expired", label: "Sona Ermiş", active: activeFilter === "expired" },
      { value: "renewal", label: "Yenileme Gerekiyor (30 gün)", active: activeFilter === "renewal" },
      { value: "pending", label: "Beklemede", active: activeFilter === "pending" },
    ],
  });

  const applySearch = debounce(() => {
    page = 1;
    renderTable();
  }, 200);
  document.getElementById("contract-search")?.addEventListener("input", (e) => {
    searchTerm = e.target.value.trim();
    applySearch();
  });

  bindFilterChips("#sv2-filter-chips", (value) => {
    activeFilter = value;
    page = 1;
    renderFilters();
    renderTable();
  });
}

function statusBadge(status) {
  return `<span class="sv2-badge ${contractBadgeClass(status)}">${escapeHtml(contractStatusLabel(status))}</span>`;
}

const SORT_ACCESSORS = {
  contract_number: (r) => r.contract_number,
  company_name: (r) => r.company_name,
  type: (r) => contractTypeLabel(r.type),
  start_date: (r) => r.start_date,
  end_date: (r) => r.end_date,
  days: (r) => contractDaysRemaining(r.end_date),
  status: (r) => contractStatusLabel(effectiveContractStatus(r)),
  value: (r) => (r.value === undefined || r.value === null ? null : Number(r.value)),
  created_at: (r) => (r.created_at ? Date.parse(r.created_at) || 0 : 0),
};

function renderTable() {
  const el = document.getElementById("contracts-table");
  if (!el) return;

  const rows = filterContracts().map((c) => ({
    ...c,
    id: contractId(c),
    // Bedel contract_values'tan; henüz taşınmamış eski kayıtlarda contracts/<id>/value yedeği (yalnız bedeli görebilen roller)
    value: canSeeValue() ? (contractValues[contractId(c)] ? contractValues[contractId(c)].value : c.value) : undefined,
  }));
  const sorted = sortRows(rows, sort, SORT_ACCESSORS);
  const paged = paginateRows(sorted, page, PAGE_SIZE);
  page = paged.page;

  const columns = [
    { key: "contract_number", label: "SÖZLEŞME NO", sortable: true },
    {
      key: "company_name",
      label: "FİRMA",
      sortable: true,
      render: (_, row) =>
        row.company_id
          ? linkCompany(row.company_id, row.company_name || "—")
          : escapeHtml(row.company_name || "—"),
    },
    { key: "type", label: "TİP", sortable: true, render: (v) => escapeHtml(contractTypeLabel(v)) },
    { key: "start_date", label: "BAŞLANGIÇ", sortable: true, render: (v) => escapeHtml(formatDate(v)) },
    { key: "end_date", label: "BİTİŞ", sortable: true, render: (v) => escapeHtml(formatDate(v)) },
    {
      key: "days",
      label: "KALAN GÜN",
      sortable: true,
      render: (_, row) => {
        const days = contractDaysRemaining(row.end_date);
        if (days === null) return "—";
        const cls = days <= 30 ? "sv2-text-danger" : "";
        const label = days < 0 ? `${Math.abs(days)} gün geçti` : `${days} gün`;
        return `<span class="${cls}">${escapeHtml(label)}</span>`;
      },
    },
    { key: "status", label: "DURUM", sortable: true, render: (_, row) => statusBadge(effectiveContractStatus(row)) },
  ];
  if (canSeeValue()) {
    columns.push({
      key: "value",
      label: "DEĞER (₺)",
      sortable: true,
      render: (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? "—" : escapeHtml(Number(v).toLocaleString("tr-TR"))),
    });
  }
  columns.push(
    {
      key: "notes",
      label: "NOT",
      render: (v) => {
        const text = String(v || "");
        return text ? `<span title="${escapeHtml(text)}">${escapeHtml(text.length > 50 ? `${text.slice(0, 47)}…` : text)}</span>` : "—";
      },
    },
    {
      key: "actions",
      label: "İŞLEMLER",
      render: (_, row) =>
        `<div class="sv2-actions">
            ${canWrite(session, "admin") ? `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-secondary btn-edit" data-id="${escapeHtml(row.id)}">
              <i class="fas fa-edit"></i> Düzenle
            </button>` : ""}
          </div>`,
    }
  );

  el.innerHTML = renderDataTable({
    columns,
    rows: paged.rows,
    emptyMessage: "Sözleşme bulunamadı.",
    pagination: {
      page: paged.page,
      totalPages: paged.totalPages,
      total: paged.total,
      onPageChange: (p) => {
        page = p;
        renderTable();
      },
    },
  });
  makeHeadersSortable(el, columns, sort, (key) => {
    sort = nextSort(sort, key);
    page = 1;
    renderTable();
  });

  el.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const contract = allContracts.find((c) => contractId(c) === btn.dataset.id);
      if (contract) openFormModal(contract);
    });
  });
}

/** Pasif firmanın kaydı düzenlenirken mevcut firma "(pasif)" etiketiyle seçenekte kalır (YON-11). */
function companyOptions(selectedId) {
  return selectableCompanies(allCompanies, selectedId)
    .map((o) => `<option value="${escapeHtml(o.id)}"${o.id === selectedId ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
    .join("");
}

function contractFormBody(data) {
  const d = data || {};
  const currentValue = d.id || d.contract_id ? (contractValues[contractId(d)] ? contractValues[contractId(d)].value : d.value ?? "") : "";
  return `
    <form id="contract-form">
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="cf-number">Sözleşme No *</label>
          <input type="text" id="cf-number" value="${escapeHtml(d.contract_number || "")}" maxlength="60" required>
          <div class="sv2-field-error" id="err-number" hidden></div>
        </div>
        <div class="sv2-form-group">
          <label for="cf-type">Tip *</label>
          <select id="cf-type" required>
            ${Object.entries(CONTRACT_TYPES)
              .map(
                ([k, v]) =>
                  `<option value="${k}"${d.type === k ? " selected" : ""}>${escapeHtml(v)}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="cf-company">Firma *</label>
        <select id="cf-company" required>
          <option value="">Firma seçin</option>
          ${companyOptions(d.company_id)}
        </select>
        <div class="sv2-field-error" id="err-company" hidden></div>
      </div>
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="cf-start">Başlangıç *</label>
          <input type="date" id="cf-start" min="2000-01-01" max="2100-12-31" value="${escapeHtml(d.start_date || "")}" required>
          <div class="sv2-field-error" id="err-start" hidden></div>
        </div>
        <div class="sv2-form-group">
          <label for="cf-end">Bitiş *</label>
          <input type="date" id="cf-end" min="2000-01-01" max="2100-12-31" value="${escapeHtml(d.end_date || "")}" required>
          <div class="sv2-field-error" id="err-end" hidden></div>
        </div>
      </div>
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="cf-status">Durum</label>
          <select id="cf-status">
            ${Object.entries(CONTRACT_STATUS)
              .map(
                ([k, v]) =>
                  `<option value="${k}"${(d.status || "active") === k ? " selected" : ""}>${escapeHtml(v)}</option>`
              )
              .join("")}
          </select>
        </div>
        ${
          canSeeValue()
            ? `<div class="sv2-form-group">
          <label for="cf-value">Değer (₺)</label>
          <input type="number" id="cf-value" min="0" step="0.01" value="${escapeHtml(String(currentValue ?? ""))}">
          <div class="sv2-field-error" id="err-value" hidden></div>
        </div>`
            : ""
        }
      </div>
      <div class="sv2-form-group">
        <label for="cf-notes">Notlar</label>
        <textarea id="cf-notes" rows="3" maxlength="2000">${escapeHtml(d.notes || "")}</textarea>
      </div>
      <div id="cf-warnings" class="sv2-text-muted" style="font-size:0.8125rem"></div>
    </form>`;
}

function openFormModal(contract) {
  const isEdit = !!contract;
  const modalId = "contract-modal";

  renderModal(modalId, {
    title: isEdit ? "Sözleşme Düzenle" : "Yeni Sözleşme",
    body: contractFormBody(contract),
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="${modalId}">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="contract-save">${isEdit ? "Güncelle" : "Kaydet"}</button>`,
  });

  openModal(modalId);

  document.getElementById("contract-save")?.addEventListener("click", () =>
    saveContract(contract ? contractId(contract) : "")
  );
}

function clearFormErrors() {
  ["number", "company", "start", "end", "value"].forEach((f) => {
    const el = document.getElementById(`err-${f}`);
    if (el) {
      el.hidden = true;
      el.textContent = "";
    }
  });
  const warn = document.getElementById("cf-warnings");
  if (warn) warn.textContent = "";
}

function showFormError(field, msg) {
  const el = document.getElementById(`err-${field}`);
  if (el) {
    el.hidden = false;
    el.textContent = msg;
  }
}

async function saveContract(editId) {
  clearFormErrors();

  const companyId = document.getElementById("cf-company")?.value || "";
  const company = allCompanies.find((c) => (c.id || c.company_id) === companyId);
  const payload = {
    contract_number: document.getElementById("cf-number")?.value.trim(),
    company_id: companyId,
    company_name: company?.name || "",
    type: document.getElementById("cf-type")?.value,
    start_date: document.getElementById("cf-start")?.value,
    end_date: document.getElementById("cf-end")?.value,
    status: document.getElementById("cf-status")?.value || "active",
    notes: document.getElementById("cf-notes")?.value.trim() || "",
  };
  const valueEl = document.getElementById("cf-value");

  const check = validateContractInput(
    { ...payload, value: valueEl ? valueEl.value : "" },
    allContracts,
    editId
  );
  for (const [field, message] of Object.entries(check.errors)) showFormError(field, message);
  if (!check.valid) return;
  const warn = document.getElementById("cf-warnings");
  if (warn && check.warnings.length) warn.textContent = check.warnings.join(" ");

  showLoading(true);
  try {
    const actor = { uid: session.uid, first_name: session.first_name, last_name: session.last_name };
    // Sözleşme + bedel (contract_values) + firma bayrağı tek atomik yazım.
    const saved = await ParlaDb.saveContract({
      id: editId || "",
      data: payload,
      value: check.value,
      canWriteValue: !!valueEl,
      actor,
    });
    await ParlaDb.logActivity(
      editId ? "updated" : "created",
      "contract",
      saved.id,
      payload.contract_number,
      editId ? `Sözleşme güncellendi: ${payload.contract_number}` : `Yeni sözleşme: ${payload.contract_number}`,
      actor
    );
    toast(editId ? "Sözleşme güncellendi." : "Sözleşme oluşturuldu.", "success");
    closeModal("contract-modal");
    await loadData();
  } catch (err) {
    handleError(err, "Kayıt başarısız");
  } finally {
    showLoading(false);
  }
}
