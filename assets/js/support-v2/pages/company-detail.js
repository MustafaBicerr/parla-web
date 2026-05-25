/**
 * Parla BT Ticket V2 — Admin Firma Detayı
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  toast,
  showLoading,
  renderStatsGrid,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  renderTabs,
  renderConfirmDialog,
  handleError,
  linkTicket,
  linkUser,
  linkProject,
  escapeHtml,
  formatDate,
  renderStatusBadge,
  renderTypeBadge,
} from "../ui-shell.js";
import { CUSTOMER_TYPES } from "../ticket-utils.js";
import { validateCompanyForm } from "../validators.js";

let session = null;
let company = null;
let users = [];
let tickets = [];
let contracts = [];
let projects = [];
let activeTab = "tickets";

function getId() {
  return new URLSearchParams(window.location.search).get("id");
}

function openStatuses() {
  return ["open", "in_progress", "waiting_customer"];
}

function buildContent() {
  if (!company) {
    return `<div class="sv2-empty"><i class="fas fa-building"></i><h4>Firma bulunamadı</h4></div>`;
  }

  const id = company.id || company.company_id;
  const activeUsers = users.filter((u) => u.is_active !== false).length;
  const openTickets = tickets.filter((t) => openStatuses().includes(t.status)).length;
  const activeContracts = contracts.filter((c) => c.status === "active").length;
  const active = company.is_active !== false;

  const stats = [
    { label: "Aktif Kullanıcı", value: activeUsers, variant: "success" },
    { label: "Açık Ticket", value: openTickets, variant: "open" },
    { label: "Toplam Ticket", value: tickets.length, variant: "" },
    { label: "Aktif Sözleşme", value: activeContracts, variant: "resolved" },
  ];

  return `
    <nav class="sv2-breadcrumb" aria-label="Breadcrumb">
      <a href="${PATHS.adminCompanies}" class="sv2-breadcrumb-link">Firmalar</a>
      <span class="sv2-breadcrumb-sep">›</span>
      <span class="sv2-breadcrumb-current">${escapeHtml(company.name)}</span>
    </nav>

    <div class="sv2-section">
      <div class="sv2-section-body">
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:1rem;align-items:flex-start;">
          <div>
            <h2 style="margin:0 0 0.5rem;color:var(--sv2-navy);">${escapeHtml(company.name)}</h2>
            <p style="margin:0 0 1rem;">
              <span class="sv2-type-badge">${escapeHtml(company.customer_code || "")}</span>
              <span class="sv2-text-muted" style="margin-left:0.5rem;">${escapeHtml(CUSTOMER_TYPES[company.customer_type] || company.customer_type || "")}</span>
            </p>
            <div class="sv2-meta-grid">
              <div class="sv2-meta-item"><label>E-posta</label><span>${escapeHtml(company.primary_contact_email || "—")}</span></div>
              <div class="sv2-meta-item"><label>Telefon</label><span>${escapeHtml(company.phone || "—")}</span></div>
              <div class="sv2-meta-item"><label>Adres</label><span>${escapeHtml(company.address || "—")}</span></div>
              <div class="sv2-meta-item"><label>Durum</label><span>${active ? '<span class="sv2-badge sv2-badge-resolved">Aktif</span>' : '<span class="sv2-badge sv2-badge-closed">Pasif</span>'}</span></div>
              <div class="sv2-meta-item"><label>Oluşturma</label><span>${escapeHtml(formatDate(company.created_at))}</span></div>
            </div>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button type="button" class="sv2-btn sv2-btn-primary" id="btn-edit-company"><i class="fas fa-edit"></i> Düzenle</button>
            <button type="button" class="sv2-btn ${active ? "sv2-btn-danger" : "sv2-btn-outline"}" id="btn-toggle-company">
              ${active ? "Pasife Al" : "Aktive Et"}
            </button>
          </div>
        </div>
      </div>
    </div>

    ${renderStatsGrid(stats)}

    <div class="sv2-section">
      <div class="sv2-section-header"><h3 id="tab-title">Ticketlar</h3></div>
      <div class="sv2-section-body">
        <div id="company-tabs">${renderTabs(
          [
            { id: "tickets", label: "Ticketlar" },
            { id: "users", label: "Kullanıcılar" },
            { id: "contracts", label: "Sözleşmeler" },
            { id: "projects", label: "Projeler" },
          ],
          activeTab,
          (tab) => {
            activeTab = tab;
            refreshView();
          }
        )}</div>
        <div id="tab-content" class="sv2-mt-1">${renderTabContent()}</div>
      </div>
    </div>`;
}

function renderTabContent() {
  switch (activeTab) {
    case "users":
      return renderDataTable({
        emptyMessage: "Bu firmaya kayıtlı kullanıcı yok.",
        columns: [
          {
            key: "name",
            label: "AD SOYAD",
            render: (_, r) => linkUser(r.uid, r.name),
          },
          { key: "email", label: "E-POSTA" },
          { key: "phone", label: "TELEFON" },
          {
            key: "is_active",
            label: "DURUM",
            render: (v) =>
              v !== false
                ? `<span class="sv2-badge sv2-badge-resolved">Aktif</span>`
                : `<span class="sv2-badge sv2-badge-closed">Pasif</span>`,
          },
        ],
        rows: users.map((u) => ({
          uid: u.uid || u.id,
          name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
          email: u.email,
          phone: u.phone,
          is_active: u.is_active,
        })),
      });
    case "contracts":
      return renderDataTable({
        emptyMessage: "Sözleşme bulunamadı.",
        columns: [
          { key: "contract_number", label: "SÖZLEŞME NO" },
          {
            key: "type",
            label: "TİP",
            render: (v) => escapeHtml(v || "—"),
          },
          { key: "start_date", label: "BAŞLANGIÇ", render: (v) => escapeHtml(formatDate(v)) },
          { key: "end_date", label: "BİTİŞ", render: (v) => escapeHtml(formatDate(v)) },
          {
            key: "status",
            label: "DURUM",
            render: (v) => renderStatusBadge(v === "active" ? "resolved" : v === "expired" ? "closed" : "open"),
          },
        ],
        rows: contracts,
      });
    case "projects":
      return renderDataTable({
        emptyMessage: "Proje bulunamadı.",
        columns: [
          {
            key: "project_code",
            label: "KOD",
            render: (v, r) => linkProject(r.id, v),
          },
          { key: "name", label: "PROJE ADI" },
          { key: "manager_name", label: "YÖNETİCİ" },
          { key: "start_date", label: "BAŞLANGIÇ", render: (v) => escapeHtml(formatDate(v)) },
          {
            key: "status",
            label: "DURUM",
            render: (v) => renderStatusBadge(v === "active" ? "in_progress" : v === "completed" ? "resolved" : "open"),
          },
        ],
        rows: projects.map((p) => ({ ...p, id: p.id || p.project_id })),
      });
    default:
      return renderDataTable({
        emptyMessage: "Ticket bulunamadı.",
        columns: [
          { key: "ticket_number", label: "NO", render: (v, r) => linkTicket(r.id, v) },
          { key: "title", label: "KONU" },
          { key: "ticket_type", label: "TİP", render: (v) => renderTypeBadge(v) },
          { key: "status", label: "DURUM", render: (v) => renderStatusBadge(v) },
          { key: "created_at", label: "TARİH", render: (v) => escapeHtml(formatDate(v)) },
        ],
        rows: tickets.map((t) => ({ ...t, id: t.id || t.ticket_id })),
      });
  }
}

function openEditModal() {
  renderModal("modal-edit-company", {
    title: "Firma Düzenle",
    body: `
      <form id="edit-company-form">
        <div class="sv2-form-group">
          <label>Firma Adı</label>
          <input type="text" name="name" value="${escapeHtml(company.name || "")}">
        </div>
        <div class="sv2-form-row">
          <div class="sv2-form-group">
            <label>Müşteri Tipi</label>
            <select name="customer_type">
              <option value="CUS"${company.customer_type === "CUS" ? " selected" : ""}>CUS</option>
              <option value="ARC"${company.customer_type === "ARC" ? " selected" : ""}>ARC</option>
            </select>
          </div>
          <div class="sv2-form-group">
            <label>Müşteri Kodu</label>
            <input type="text" name="customer_code" value="${escapeHtml(company.customer_code || "")}">
          </div>
        </div>
        <div class="sv2-form-group">
          <label>E-posta</label>
          <input type="email" name="primary_contact_email" value="${escapeHtml(company.primary_contact_email || "")}">
        </div>
        <div class="sv2-form-group">
          <label>Telefon</label>
          <input type="tel" name="phone" value="${escapeHtml(company.phone || "")}">
        </div>
        <div class="sv2-form-group">
          <label>Adres</label>
          <textarea name="address" rows="2">${escapeHtml(company.address || "")}</textarea>
        </div>
        <div class="sv2-form-group">
          <label><input type="checkbox" name="has_contract" ${company.has_contract ? "checked" : ""}> Aktif sözleşme var</label>
        </div>
      </form>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="modal-edit-company">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="edit-company-save">Kaydet</button>`,
  });
  openModal("modal-edit-company");

  document.getElementById("edit-company-save")?.addEventListener("click", async () => {
    const form = document.getElementById("edit-company-form");
    const data = {
      name: form.name.value.trim(),
      customer_type: form.customer_type.value,
      customer_code: form.customer_code.value.trim().toUpperCase(),
      primary_contact_email: form.primary_contact_email.value.trim(),
      phone: form.phone.value.trim(),
      address: form.address.value.trim(),
      has_contract: form.has_contract.checked,
    };
    const { valid, errors } = validateCompanyForm(data);
    if (!valid) {
      toast(Object.values(errors)[0], "error");
      return;
    }
    showLoading(true);
    try {
      company = await ParlaDb.updateCompany(company.id || company.company_id, {
        ...data,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity("company_updated", "company", company.id, company.name, "Firma güncellendi", session);
      closeModal("modal-edit-company");
      toast("Firma güncellendi.", "success");
      refreshView();
    } catch (err) {
      handleError(err, "Güncelleme");
    } finally {
      showLoading(false);
    }
  });
}

function bindEvents() {
  document.getElementById("btn-edit-company")?.addEventListener("click", openEditModal);
  document.getElementById("btn-toggle-company")?.addEventListener("click", () => {
    const next = company.is_active === false;
    renderConfirmDialog(next ? "Firma aktive edilsin mi?" : "Firma pasife alınsın mı?", async () => {
      showLoading(true);
      try {
        company = await ParlaDb.updateCompany(company.id || company.company_id, {
          is_active: next,
          updated_by: session.uid,
        });
        await ParlaDb.logActivity(
          next ? "company_activated" : "company_deactivated",
          "company",
          company.id,
          company.name,
          "",
          session
        );
        toast(next ? "Firma aktive edildi." : "Firma pasife alındı.", "success");
        refreshView();
      } catch (err) {
        handleError(err, "Durum güncelleme");
      } finally {
        showLoading(false);
      }
    });
  });

  const titles = { tickets: "Ticketlar", users: "Kullanıcılar", contracts: "Sözleşmeler", projects: "Projeler" };
  const tabTitle = document.getElementById("tab-title");
  if (tabTitle) tabTitle.textContent = titles[activeTab] || "Ticketlar";
}

function refreshView() {
  renderShell("#sv2-app", {
    title: company?.name || "Firma Detayı",
    activePage: "companies",
    profile: session,
    isAdmin: true,
    content: buildContent(),
  });
  bindEvents();
}

async function loadData(id) {
  company = await ParlaDb.getCompany(id);
  if (!company) return;

  const [allUsers, companyTickets, allContracts, allProjects] = await Promise.all([
    ParlaDb.getAllUsers(),
    ParlaDb.getTicketsForCompany(id),
    ParlaDb.getAllContracts(),
    ParlaDb.getAllProjects(),
  ]);

  users = allUsers.filter((u) => u.company_id === id);
  tickets = companyTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  contracts = allContracts.filter((c) => c.company_id === id);
  projects = allProjects.filter((p) => p.company_id === id);
}

document.addEventListener("DOMContentLoaded", async () => {
  const id = getId();
  if (!id) {
    window.location.href = PATHS.adminCompanies;
    return;
  }
  try {
    showLoading(true);
    session = await requireAuth({ adminOnly: true });
    await ParlaDb.waitForFirebase();
    await loadData(id);
    if (!company) {
      toast("Firma bulunamadı.", "error");
      setTimeout(() => { window.location.href = PATHS.adminCompanies; }, 1500);
      return;
    }
    refreshView();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin") {
      handleError(err, "Sayfa yüklenemedi");
    }
  } finally {
    showLoading(false);
  }
});
