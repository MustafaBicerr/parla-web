/**
 * Parla BT Ticket V2 — Admin Firma Yönetimi
 *
 * WP-09/13: sözleşme rozeti sözleşmelerden türetilir (tek yardımcı), pasif firma göstergesi, sütun sıralama + sayfalama,
 * arama debounce'u, talep sayıları yalnız görünen satırlar için indeksli sorgularla (tüm talepler indirilmez),
 * kullanıcı sayıları yalnız kullanıcı listesini okuyabilen rollerde (danışman/PM: sütun gizli).
 */
import ParlaDb from "../firebase-client.js";
import { canWrite } from "../access-control.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  toast,
  showLoading,
  renderFilterBar,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  bindFilterChips,
  handleError,
  handleLoadError,
  linkCompany,
  escapeHtml,
  formatDate,
} from "../ui-shell.js";
import { CUSTOMER_TYPES, matchesSearch } from "../ticket-utils.js";
import { validateCompanyForm } from "../validators.js";
import { initPhoneInput, normalizePhone } from "../phone-utils.js";
import { companiesWithActiveContract } from "../entity-utils.js";
import { sortRows, paginateRows, debounce, nextSort, makeHeadersSortable } from "../table-utils.js";

const PAGE_SIZE = 25;

let session = null;
let companies = [];
let allUsers = [];
let allContracts = [];
let usersVisible = false;
let activeContractSet = new Set();
let userCountByCompany = new Map();
const ticketCounts = new Map(); // firma kimliği -> { total, open } (yalnız görüntülenen sayfalar için yüklenir)
let filters = { search: "", type: "all", contract: "all", status: "all" };
let sort = { key: "name", dir: "asc" };
let page = 1;

function companyId(c) {
  return c.id || c.company_id;
}

function suggestNextCode(type) {
  const prefix = String(type || "CUS").toUpperCase();
  const nums = companies
    .filter((c) => String(c.customer_code || "").startsWith(prefix))
    .map((c) => parseInt(String(c.customer_code).slice(3), 10) || 0);
  return `${prefix}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0")}`;
}

function hasContract(c) {
  return activeContractSet.has(companyId(c));
}

function filterCompanies() {
  return companies.filter((c) => {
    if (filters.type !== "all" && c.customer_type !== filters.type) return false;
    if (filters.contract === "yes" && !hasContract(c)) return false;
    if (filters.contract === "no" && hasContract(c)) return false;
    if (filters.status === "active" && c.is_active === false) return false;
    if (filters.status === "inactive" && c.is_active !== false) return false;
    return matchesSearch(filters.search, [c.name, c.customer_code, c.primary_contact_email]);
  });
}

function contractBadge(c) {
  return hasContract(c)
    ? `<span class="sv2-badge sv2-badge-resolved">Aktif Sözleşme</span>`
    : `<span class="sv2-badge sv2-badge-closed">Sözleşme Yok</span>`;
}

function statusBadge(c) {
  return c.is_active === false
    ? `<span class="sv2-badge sv2-badge-closed" title="Pasif firmanın kullanıcıları yeni talep açamaz">Pasif</span>`
    : `<span class="sv2-badge sv2-badge-resolved">Aktif</span>`;
}

function ticketCountCell(id) {
  const c = ticketCounts.get(id);
  return `<span class="sv2-ticket-count" data-company="${escapeHtml(id)}">${c ? escapeHtml(String(c.total)) : "…"}</span>`;
}

function tableColumns() {
  const cols = [
    { key: "name", label: "FİRMA ADI", sortable: true, render: (_, r) => linkCompany(r.id, r.name) + (r.is_active === false ? ' <span class="sv2-text-muted">(pasif)</span>' : "") },
    { key: "customer_code", label: "KOD", sortable: true },
    { key: "customer_type", label: "TİP", sortable: true, render: (v) => escapeHtml(CUSTOMER_TYPES[v] || v || "—") },
    { key: "contract", label: "SÖZLEŞME DURUMU", sortable: true, render: (_, r) => contractBadge(r) },
    { key: "is_active", label: "DURUM", sortable: true, render: (_, r) => statusBadge(r) },
  ];
  if (usersVisible) cols.push({ key: "user_count", label: "KAYITLI KULLANICI", sortable: true });
  cols.push(
    { key: "ticket_count", label: "Toplam Talep", render: (_, r) => ticketCountCell(r.id) },
    { key: "created_at", label: "OLUŞTURMA", sortable: true, render: (v) => escapeHtml(formatDate(v)) },
    {
      key: "id",
      label: "İŞLEMLER",
      render: (_, r) =>
        `<a href="${PATHS.adminCompanyDetail}?id=${encodeURIComponent(r.id)}" class="sv2-btn sv2-btn-sm sv2-btn-outline">Detay</a>`,
    }
  );
  return cols;
}

const SORT_ACCESSORS = {
  name: (r) => r.name,
  customer_code: (r) => r.customer_code,
  customer_type: (r) => r.customer_type,
  contract: (r) => (r.has_contract ? 1 : 0),
  is_active: (r) => (r.is_active === false ? 0 : 1),
  user_count: (r) => r.user_count,
  created_at: (r) => (r.created_at ? Date.parse(r.created_at) || 0 : 0),
};

function buildRows() {
  return filterCompanies().map((c) => {
    const id = companyId(c);
    return {
      id,
      name: c.name,
      customer_code: c.customer_code,
      customer_type: c.customer_type,
      has_contract: hasContract(c),
      user_count: userCountByCompany.get(id) || 0,
      created_at: c.created_at,
      is_active: c.is_active,
    };
  });
}

function renderCompaniesTable() {
  const container = document.getElementById("companies-table");
  if (!container) return;
  const sorted = sortRows(buildRows(), sort, SORT_ACCESSORS);
  const paged = paginateRows(sorted, page, PAGE_SIZE);
  page = paged.page;
  const columns = tableColumns();
  container.innerHTML = renderDataTable({
    emptyMessage: "Firma bulunamadı.",
    columns,
    rows: paged.rows,
    pagination: {
      page: paged.page,
      totalPages: paged.totalPages,
      total: paged.total,
      onPageChange: (p) => {
        page = p;
        renderCompaniesTable();
      },
    },
  });
  makeHeadersSortable(container, columns, sort, (key) => {
    sort = nextSort(sort, key);
    page = 1;
    renderCompaniesTable();
  });
  loadVisibleCounts(paged.rows.map((r) => r.id));
}

/** Görünen satırların talep sayıları: yalnız bu firmalar için indeksli sorgu (tüm talepler indirilmez). */
async function loadVisibleCounts(ids) {
  const missing = ids.filter((id) => !ticketCounts.has(id));
  if (missing.length) {
    try {
      const counts = await ParlaDb.getTicketCountsForCompanies(missing);
      for (const [id, c] of Object.entries(counts)) ticketCounts.set(id, c);
    } catch {
      return;
    }
  }
  document.querySelectorAll(".sv2-ticket-count").forEach((el) => {
    const c = ticketCounts.get(el.dataset.company);
    if (c) el.textContent = String(c.total);
  });
}

function buildContent() {
  return `
    <nav class="sv2-breadcrumb" aria-label="Breadcrumb">
      <a href="${PATHS.adminDashboard}" class="sv2-breadcrumb-link">Genel Bakış</a>
      <span class="sv2-breadcrumb-sep">›</span>
      <span class="sv2-breadcrumb-current">Müşteriler</span>
    </nav>
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Müşteriler</h3>
        ${canWrite(session, "admin") ? `<button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-company">
          <i class="fas fa-plus"></i> Yeni Firma
        </button>` : ""}
      </div>
      <div class="sv2-section-body">
        ${renderFilterBar({
          search: { id: "companies-search", placeholder: "Firma adı veya kod ara...", value: filters.search },
          chips: [
            { value: "all", label: "Tüm Tipler", active: filters.type === "all" },
            { value: "CUS", label: "CUS", active: filters.type === "CUS" },
            { value: "ARC", label: "ARC", active: filters.type === "ARC" },
          ],
        })}
        <div class="sv2-filter-chips sv2-mt-1" id="contract-chips">
          <button type="button" class="sv2-chip${filters.contract === "all" ? " is-active" : ""}" data-value="all">Tüm Sözleşmeler</button>
          <button type="button" class="sv2-chip${filters.contract === "yes" ? " is-active" : ""}" data-value="yes">Sözleşmeli</button>
          <button type="button" class="sv2-chip${filters.contract === "no" ? " is-active" : ""}" data-value="no">Sözleşmesiz</button>
        </div>
        <div class="sv2-filter-chips sv2-mt-1" id="status-chips">
          <button type="button" class="sv2-chip${filters.status === "all" ? " is-active" : ""}" data-value="all">Tüm Durumlar</button>
          <button type="button" class="sv2-chip${filters.status === "active" ? " is-active" : ""}" data-value="active">Aktif</button>
          <button type="button" class="sv2-chip${filters.status === "inactive" ? " is-active" : ""}" data-value="inactive">Pasif</button>
        </div>
        <p class="sv2-text-muted sv2-mt-1" style="font-size:0.8125rem;margin-bottom:0">"Sözleşme Durumu" firmanın sözleşmelerinden hesaplanır (bitiş tarihi geçmiş ya da iptal sözleşmeler sayılmaz). Pasif firmanın kullanıcıları yeni talep açamaz.</p>
        <div id="companies-table" class="sv2-mt-1"></div>
      </div>
    </div>`;
}

function openNewCompanyModal() {
  renderModal("modal-new-company", {
    title: "Yeni Firma",
    body: `
      <form id="new-company-form">
        <div class="sv2-form-group">
          <label for="nc-name">Firma Adı *</label>
          <input type="text" id="nc-name" name="name" required>
        </div>
        <div class="sv2-form-row">
          <div class="sv2-form-group">
            <label for="nc-type">Müşteri Tipi *</label>
            <select id="nc-type" name="customer_type">
              <option value="CUS">CUS — Destek Anlaşmalı Müşteri</option>
              <option value="ARC">ARC — Arızi Müşteri</option>
            </select>
          </div>
          <div class="sv2-form-group">
            <label for="nc-code">Müşteri Kodu *</label>
            <input type="text" id="nc-code" name="customer_code" value="${suggestNextCode("CUS")}">
          </div>
        </div>
        <div class="sv2-form-group">
          <label for="nc-email">Ana İletişim E-postası</label>
          <input type="email" id="nc-email" name="primary_contact_email">
        </div>
        <div class="sv2-form-row">
          <div class="sv2-form-group">
            <label for="nc-phone">Telefon</label>
            <input type="tel" id="nc-phone" name="phone">
          </div>
        </div>
        <div class="sv2-form-group">
          <label for="nc-address">Adres</label>
          <textarea id="nc-address" name="address" rows="2"></textarea>
        </div>
      </form>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="modal-new-company">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="nc-submit">Kaydet</button>`,
  });
  openModal("modal-new-company");
  initPhoneInput(document.getElementById("nc-phone"));

  document.getElementById("nc-type")?.addEventListener("change", (e) => {
    document.getElementById("nc-code").value = suggestNextCode(e.target.value);
  });

  document.getElementById("nc-submit")?.addEventListener("click", submitNewCompany);
}

function showFormErrors(form, errors) {
  form.querySelectorAll(".sv2-form-group").forEach((g) => {
    g.classList.remove("has-error");
    g.querySelector(".sv2-field-error")?.remove();
  });
  Object.entries(errors).forEach(([field, message]) => {
    const el = form.querySelector(`[name="${field}"]`);
    const group = el?.closest(".sv2-form-group");
    if (!group) return;
    group.classList.add("has-error");
    const err = document.createElement("div");
    err.className = "sv2-field-error";
    err.textContent = message;
    group.appendChild(err);
  });
}

async function submitNewCompany() {
  const form = document.getElementById("new-company-form");
  const data = {
    name: form.name.value.trim(),
    customer_type: form.customer_type.value,
    customer_code: form.customer_code.value.trim().toUpperCase(),
    primary_contact_email: form.primary_contact_email.value.trim(),
    phone: normalizePhone(form.phone) || form.phone.value.trim(),
    address: form.address.value.trim(),
  };

  const { valid, errors } = validateCompanyForm(data);
  if (!valid) {
    showFormErrors(form, errors);
    return;
  }

  const dup = companies.find(
    (c) => String(c.customer_code).toUpperCase() === data.customer_code
  );
  if (dup) {
    showFormErrors(form, { customer_code: "Bu müşteri kodu zaten kullanımda." });
    return;
  }

  showLoading(true);
  try {
    const company = await ParlaDb.createCompany({
      ...data,
      created_by: session.uid,
      updated_by: session.uid,
    });
    await ParlaDb.logActivity("company_created", "company", company.id, company.name, data.customer_code, session);
    closeModal("modal-new-company");
    toast("Firma oluşturuldu.", "success");
    await loadData();
    refreshView();
  } catch (err) {
    handleError(err, "Firma oluşturulamadı");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-company")?.addEventListener("click", openNewCompanyModal);
  // Arama: her tuşta değil, yazmayı bıraktıktan 200 ms sonra süzülür (OLC-10).
  const applySearch = debounce(() => {
    page = 1;
    renderCompaniesTable();
  }, 200);
  document.getElementById("companies-search")?.addEventListener("input", (e) => {
    filters.search = e.target.value;
    applySearch();
  });

  bindFilterChips("#sv2-filter-chips", (v) => {
    filters.type = v;
    page = 1;
    refreshView();
  });
  bindFilterChips("#contract-chips", (v) => {
    filters.contract = v;
    page = 1;
    refreshView();
  });
  bindFilterChips("#status-chips", (v) => {
    filters.status = v;
    page = 1;
    refreshView();
  });
}

function refreshView() {
  renderShell("#sv2-app", {
    title: "Müşteriler",
    activePage: "companies",
    profile: session,
    isAdmin: true,
    content: buildContent(),
  });
  renderCompaniesTable();
  bindEvents();
}

async function loadData() {
  usersVisible = canWrite(session, "admin"); // kullanıcı listesi (v2/users) yalnız super/service okuyabilir
  [companies, allContracts, allUsers] = await Promise.all([
    ParlaDb.getAllCompanies(),
    ParlaDb.getAllContracts().catch(() => []),
    usersVisible ? ParlaDb.getAllUsers().catch(() => []) : Promise.resolve([]),
  ]);
  activeContractSet = companiesWithActiveContract(allContracts);
  userCountByCompany = new Map();
  for (const u of allUsers) {
    if (u.company_id) userCountByCompany.set(u.company_id, (userCountByCompany.get(u.company_id) || 0) + 1);
  }
  ticketCounts.clear();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    showLoading(true);
    session = await requireAuth({ adminOnly: true });
    await ParlaDb.waitForFirebase();
    await loadData();
    refreshView();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin") {
      handleLoadError(err, "Sayfa yüklenemedi");
    }
  } finally {
    showLoading(false);
  }
});
