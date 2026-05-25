/**
 * Parla BT Ticket V2 — Admin Firma Yönetimi
 */
import ParlaDb from "../firebase-client.js";
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
  linkCompany,
  escapeHtml,
  formatDate,
} from "../ui-shell.js";
import { CUSTOMER_TYPES } from "../ticket-utils.js";
import { validateCompanyForm } from "../validators.js";

let session = null;
let companies = [];
let allUsers = [];
let allTickets = [];
let filters = { search: "", type: "all", contract: "all", status: "all" };

function suggestNextCode(type) {
  const prefix = String(type || "CUS").toUpperCase();
  const nums = companies
    .filter((c) => String(c.customer_code || "").startsWith(prefix))
    .map((c) => parseInt(String(c.customer_code).slice(3), 10) || 0);
  return `${prefix}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, "0")}`;
}

function countUsers(companyId) {
  return allUsers.filter((u) => u.company_id === companyId).length;
}

function countTickets(companyId) {
  return allTickets.filter((t) => t.company_id === companyId).length;
}

function filterCompanies() {
  const q = filters.search.trim().toLowerCase();
  return companies.filter((c) => {
    if (filters.type !== "all" && c.customer_type !== filters.type) return false;
    if (filters.contract === "yes" && !c.has_contract) return false;
    if (filters.contract === "no" && c.has_contract) return false;
    if (filters.status === "active" && c.is_active === false) return false;
    if (filters.status === "inactive" && c.is_active !== false) return false;
    if (!q) return true;
    const hay = [c.name, c.customer_code, c.primary_contact_email].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function contractBadge(c) {
  if (c.has_contract) {
    return `<span class="sv2-badge sv2-badge-resolved">Aktif Sözleşme</span>`;
  }
  return `<span class="sv2-badge sv2-badge-closed">Sözleşme Yok</span>`;
}

function buildContent() {
  const rows = filterCompanies().map((c) => ({
    id: c.id || c.company_id,
    name: c.name,
    customer_code: c.customer_code,
    customer_type: c.customer_type,
    has_contract: c.has_contract,
    user_count: countUsers(c.id || c.company_id),
    ticket_count: countTickets(c.id || c.company_id),
    created_at: c.created_at,
    is_active: c.is_active,
  }));

  return `
    <nav class="sv2-breadcrumb" aria-label="Breadcrumb">
      <a href="${PATHS.adminDashboard}" class="sv2-breadcrumb-link">Genel Bakış</a>
      <span class="sv2-breadcrumb-sep">›</span>
      <span class="sv2-breadcrumb-current">Firmalar</span>
    </nav>
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Firmalar</h3>
        <button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-company">
          <i class="fas fa-plus"></i> Yeni Firma
        </button>
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
        <div id="companies-table" class="sv2-mt-1">${renderCompaniesTable(rows)}</div>
      </div>
    </div>`;
}

function renderCompaniesTable(rows) {
  return renderDataTable({
    emptyMessage: "Firma bulunamadı.",
    columns: [
      { key: "name", label: "FİRMA ADI", render: (_, r) => linkCompany(r.id, r.name) },
      { key: "customer_code", label: "KOD" },
      {
        key: "customer_type",
        label: "TİP",
        render: (v) => escapeHtml(CUSTOMER_TYPES[v] || v || "—"),
      },
      {
        key: "has_contract",
        label: "SÖZLEŞME DURUMU",
        render: (_, r) => contractBadge(r),
      },
      { key: "user_count", label: "KAYITLI KULLANICI" },
      { key: "ticket_count", label: "TOPLAM TİCKET" },
      { key: "created_at", label: "OLUŞTURMA", render: (v) => escapeHtml(formatDate(v)) },
      {
        key: "id",
        label: "İŞLEMLER",
        render: (_, r) =>
          `<a href="${PATHS.adminCompanyDetail}?id=${encodeURIComponent(r.id)}" class="sv2-btn sv2-btn-sm sv2-btn-outline">Detay</a>`,
      },
    ],
    rows,
  });
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
    phone: form.phone.value.trim(),
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
  document.getElementById("companies-search")?.addEventListener("input", (e) => {
    filters.search = e.target.value;
    const rows = filterCompanies().map((c) => ({
      id: c.id || c.company_id,
      name: c.name,
      customer_code: c.customer_code,
      customer_type: c.customer_type,
      has_contract: c.has_contract,
      user_count: countUsers(c.id || c.company_id),
      ticket_count: countTickets(c.id || c.company_id),
      created_at: c.created_at,
    }));
    document.getElementById("companies-table").innerHTML = renderCompaniesTable(rows);
  });

  bindFilterChips("#sv2-filter-chips", (v) => {
    filters.type = v;
    refreshView();
  });
  bindFilterChips("#contract-chips", (v) => {
    filters.contract = v;
    refreshView();
  });
  bindFilterChips("#status-chips", (v) => {
    filters.status = v;
    refreshView();
  });
}

function refreshView() {
  renderShell("#sv2-app", {
    title: "Firmalar",
    activePage: "companies",
    profile: session,
    isAdmin: true,
    content: buildContent(),
  });
  bindEvents();
}

async function loadData() {
  [companies, allUsers, allTickets] = await Promise.all([
    ParlaDb.getAllCompanies(),
    ParlaDb.getAllUsers(),
    ParlaDb.getAllTickets(),
  ]);
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
      handleError(err, "Sayfa yüklenemedi");
    }
  } finally {
    showLoading(false);
  }
});
