/**
 * Parla BT Ticket V2 — Admin Firma Detayı
 *
 * WP-09: sözleşme/proje durumları KENDİ etiket ve rozetleriyle (talep durum sözlüğü değil), sözleşme etkin durumu tek
 * yardımcıdan, sözleşme bedeli yalnız super/service görür (contract_values), firma ad/kod değişince kopyalar yayılır,
 * kullanıcı sekmesi/sayıları yalnız kullanıcı listesini okuyabilen rollerde, Efor sekmesi yalnız efor girilen talepler.
 * WP-13: kullanıcı/sözleşme/proje için indeksli (firma bazlı) sorgular; efor yalnız Efor sekmesi açılınca yüklenir; sayfalama.
 */
import { formatNumber } from "../safe-utils.js";
import ParlaDb from "../firebase-client.js";
import { canWrite } from "../access-control.js";
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
  handleLoadError,
  linkTicket,
  linkUser,
  linkProject,
  escapeHtml,
  formatDate,
  renderStatusBadge,
  renderTypeBadge,
} from "../ui-shell.js";
import { CUSTOMER_TYPES, getTicketKey, OPEN_STATUSES, istanbulMonthKey, formatStatusLabel } from "../ticket-utils.js";
import { validateCompanyForm } from "../validators.js";
import { downloadExcel, monthOptions, filterEffortsByMonth } from "../export-utils.js";
import { initPhoneInput, normalizePhone, formatPhoneDisplay, setPhoneValue } from "../phone-utils.js";
import {
  effectiveContractStatus,
  contractBadgeClass,
  contractStatusLabel,
  contractTypeLabel,
  summarizeContracts,
  projectBadgeClass,
  projectStatusLabel,
} from "../entity-utils.js";
import { paginateRows } from "../table-utils.js";

const PAGE_SIZE = 25;

let session = null;
let company = null;
let users = [];
let tickets = [];
let contracts = [];
let contractValues = {};
let projects = [];
let ticketEfforts = [];
let effortsLoaded = false;
// Varsayılan efor ayı İstanbul takvimine göre (UTC değil): ay sonu/başında yanlış aya düşmez.
let effortMonth = istanbulMonthKey(new Date());
let activeTab = "tickets";
const tabPages = {};

function getId() {
  return new URLSearchParams(window.location.search).get("id");
}

/** Kullanıcı listesi (v2/users) ve sözleşme bedelleri yalnız super_admin/service_admin tarafından okunabilir. */
function canSeeAdminData() {
  return canWrite(session, "admin");
}

function effortsForCompanyTickets() {
  const ticketMap = Object.fromEntries(tickets.map((t) => [getTicketKey(t), t]));
  return ticketEfforts
    .filter((e) => ticketMap[e.ticket_id])
    .map((e) => ({ ...e, ticket: ticketMap[e.ticket_id] }));
}

function pagedTable(tabKey, options) {
  const paged = paginateRows(options.rows, tabPages[tabKey] || 1, PAGE_SIZE);
  tabPages[tabKey] = paged.page;
  return renderDataTable({
    emptyMessage: options.emptyMessage,
    columns: options.columns,
    rows: paged.rows,
    pagination:
      paged.total > PAGE_SIZE
        ? {
            page: paged.page,
            totalPages: paged.totalPages,
            total: paged.total,
            onPageChange: (p) => {
              tabPages[tabKey] = p;
              const el = document.getElementById("tab-content");
              if (el) el.innerHTML = renderTabContent();
              bindEvents();
            },
          }
        : undefined,
  });
}

function renderEffortTab() {
  if (!effortsLoaded) {
    return `<div class="sv2-empty"><i class="fas fa-spinner fa-spin"></i><h4>Efor kayıtları yükleniyor...</h4></div>`;
  }
  const monthEfforts = filterEffortsByMonth(effortsForCompanyTickets(), effortMonth);
  const totalHours = monthEfforts.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
  const ticketIds = new Set(monthEfforts.map((e) => e.ticket_id));
  const monthOpts = monthOptions(12)
    .map(
      (o) =>
        `<option value="${o.value}"${o.value === effortMonth ? " selected" : ""}>${o.label}</option>`
    )
    .join("");

  // Efor kayıtlarını talebe göre grupla (O(talep + efor)); yalnız seçili ayda efor girilen talepler listelenir (YON-33).
  const byTicket = new Map();
  for (const e of monthEfforts) {
    if (!byTicket.has(e.ticket_id)) byTicket.set(e.ticket_id, []);
    byTicket.get(e.ticket_id).push(e);
  }
  const rows = tickets
    .filter((t) => byTicket.has(getTicketKey(t)))
    .map((t) => {
      const id = getTicketKey(t);
      const list = byTicket.get(id);
      const monthHours = list.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
      const consultants = [...new Set(list.map((e) => e.personnel_name).filter(Boolean))].join(", ");
      return {
        id,
        ticket_number: t.ticket_number,
        title: t.title,
        created_at: t.created_at,
        status: t.status,
        total_hours: parseFloat(t.total_work_hours) || 0,
        month_hours: Math.round(monthHours * 100) / 100,
        consultants: consultants || t.assigned_to_name || "—",
      };
    });

  return `
    <div class="sv2-filters sv2-mb-1">
      <div class="sv2-form-group">
        <label for="effort-month">Ay</label>
        <select id="effort-month">${monthOpts}</select>
      </div>
      <button type="button" class="sv2-btn sv2-btn-outline" id="btn-export-effort-excel">
        <i class="fas fa-file-excel"></i> Excel İndir
      </button>
    </div>
    ${renderStatsGrid([
      { label: "Seçili Ay Toplam Efor", value: `${Math.round(totalHours * 100) / 100} sa`, variant: "open" },
      { label: "Efor Girilen Talep", value: ticketIds.size, variant: "success" },
      {
        label: "Ortalama / Talep",
        value: ticketIds.size ? `${formatNumber(totalHours / ticketIds.size)} sa` : "0 sa",
      },
    ])}
    ${pagedTable("effort", {
      emptyMessage: "Seçili ayda efor kaydı bulunamadı.",
      columns: [
        { key: "ticket_number", label: "NO", render: (v, r) => linkTicket(r.id, v) },
        { key: "title", label: "KONU" },
        { key: "created_at", label: "TALEP TARİHİ", render: (v) => escapeHtml(formatDate(v)) },
        { key: "status", label: "DURUM", render: (v) => renderStatusBadge(v) },
        { key: "month_hours", label: "AY EFOR (SAAT)" },
        { key: "total_hours", label: "TOPLAM EFOR" },
        { key: "consultants", label: "DANIŞMAN(LAR)" },
      ],
      rows,
    })}`;
}

function buildContent() {
  if (!company) {
    return `<div class="sv2-empty"><i class="fas fa-building"></i><h4>Firma bulunamadı</h4></div>`;
  }

  const seeAdmin = canSeeAdminData();
  const activeUsers = users.filter((u) => u.is_active !== false).length;
  const openTickets = tickets.filter((t) => OPEN_STATUSES.includes(String(t.status).toLowerCase())).length;
  const contractSummary = summarizeContracts(contracts);
  const active = company.is_active !== false;

  const stats = [];
  if (seeAdmin) stats.push({ label: "Aktif Kullanıcı", value: activeUsers, variant: "success" });
  stats.push(
    { label: "Açık Talep", value: openTickets, variant: "open" },
    { label: "Toplam Talep", value: tickets.length, variant: "" },
    { label: "Aktif Sözleşme", value: contractSummary.active, variant: "resolved" }
  );

  const tabs = [
    { id: "tickets", label: "Ticketlar" },
    { id: "effort", label: "Efor" },
  ];
  if (seeAdmin) tabs.push({ id: "users", label: "Kullanıcılar" });
  tabs.push({ id: "contracts", label: "Sözleşmeler" }, { id: "projects", label: "Projeler" });

  return `
    <nav class="sv2-breadcrumb" aria-label="Breadcrumb">
      <a href="${PATHS.adminCompanies}" class="sv2-breadcrumb-link">Müşteriler</a>
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
              <div class="sv2-meta-item"><label>Telefon</label><span>${escapeHtml(formatPhoneDisplay(company.phone))}</span></div>
              <div class="sv2-meta-item"><label>Adres</label><span>${escapeHtml(company.address || "—")}</span></div>
              <div class="sv2-meta-item"><label>Durum</label><span>${active ? '<span class="sv2-badge sv2-badge-resolved">Aktif</span>' : '<span class="sv2-badge sv2-badge-closed" id="company-inactive-badge">Pasif</span>'}</span></div>
              <div class="sv2-meta-item"><label>Sözleşme</label><span>${contractSummary.hasActive ? '<span class="sv2-badge sv2-badge-resolved">Aktif Sözleşme</span>' : '<span class="sv2-badge sv2-badge-closed">Sözleşme Yok</span>'}</span></div>
              <div class="sv2-meta-item"><label>Oluşturma</label><span>${escapeHtml(formatDate(company.created_at))}</span></div>
            </div>
            ${active ? "" : '<p class="sv2-text-muted" style="margin:0.75rem 0 0;font-size:0.8125rem">Pasif firma: kullanıcıları yeni talep açamaz; mevcut talepleri görmeye devam eder. Sözleşme ve projeleri düzenlenebilir.</p>'}
          </div>
          ${canWrite(session, "admin") ? `<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button type="button" class="sv2-btn sv2-btn-primary" id="btn-edit-company"><i class="fas fa-edit"></i> Düzenle</button>
            <button type="button" class="sv2-btn ${active ? "sv2-btn-danger" : "sv2-btn-outline"}" id="btn-toggle-company">
              ${active ? "Pasife Al" : "Aktive Et"}
            </button>
          </div>` : ""}
        </div>
      </div>
    </div>

    ${renderStatsGrid(stats)}

    <div class="sv2-section">
      <div class="sv2-section-header"><h3 id="tab-title">Ticketlar</h3></div>
      <div class="sv2-section-body">
        <div id="company-tabs">${renderTabs(tabs, activeTab, (tab) => {
          activeTab = tab;
          if (tab === "effort" && !effortsLoaded) {
            refreshView();
            loadEfforts();
          } else {
            refreshView();
          }
        })}</div>
        <div id="tab-content" class="sv2-mt-1">${renderTabContent()}</div>
      </div>
    </div>`;
}

function contractRows() {
  return contracts.map((c) => {
    const id = c.id || c.contract_id;
    const eff = effectiveContractStatus(c);
    return {
      id,
      contract_number: c.contract_number,
      type: c.type,
      start_date: c.start_date,
      end_date: c.end_date,
      eff,
      value: contractValues[id] ? contractValues[id].value : c.value,
      notes: c.notes,
    };
  });
}

function renderTabContent() {
  switch (activeTab) {
    case "effort":
      return renderEffortTab();
    case "users":
      if (!canSeeAdminData()) return `<p class="sv2-text-muted">Kullanıcı listesi yalnızca yönetici rollerine açıktır.</p>`;
      return pagedTable("users", {
        emptyMessage: "Bu firmaya kayıtlı kullanıcı yok.",
        columns: [
          { key: "name", label: "AD SOYAD", render: (_, r) => linkUser(r.uid, r.name) },
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
          id: u.uid || u.id,
          uid: u.uid || u.id,
          name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
          email: u.email,
          phone: u.phone,
          is_active: u.is_active,
        })),
      });
    case "contracts": {
      const seeValue = canSeeAdminData();
      const columns = [
        { key: "contract_number", label: "SÖZLEŞME NO" },
        { key: "type", label: "TİP", render: (v) => escapeHtml(contractTypeLabel(v)) },
        { key: "start_date", label: "BAŞLANGIÇ", render: (v) => escapeHtml(formatDate(v)) },
        { key: "end_date", label: "BİTİŞ", render: (v) => escapeHtml(formatDate(v)) },
        {
          key: "eff",
          label: "DURUM",
          render: (v) => `<span class="sv2-badge ${contractBadgeClass(v)}">${escapeHtml(contractStatusLabel(v))}</span>`,
        },
      ];
      if (seeValue) {
        columns.push({
          key: "value",
          label: "DEĞER (₺)",
          render: (v) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? "—" : escapeHtml(Number(v).toLocaleString("tr-TR"))),
        });
      }
      columns.push({ key: "notes", label: "NOT", render: (v) => escapeHtml(v || "—") });
      return pagedTable("contracts", { emptyMessage: "Sözleşme bulunamadı.", columns, rows: contractRows() });
    }
    case "projects":
      return pagedTable("projects", {
        emptyMessage: "Proje bulunamadı.",
        columns: [
          { key: "project_code", label: "KOD", render: (v, r) => linkProject(r.id, v) },
          { key: "name", label: "PROJE ADI" },
          { key: "manager_name", label: "YÖNETİCİ", render: (v) => escapeHtml(v || "—") },
          { key: "start_date", label: "BAŞLANGIÇ", render: (v) => escapeHtml(formatDate(v)) },
          {
            key: "status",
            label: "DURUM",
            render: (v) => `<span class="sv2-badge ${projectBadgeClass(v)}">${escapeHtml(projectStatusLabel(v))}</span>`,
          },
        ],
        rows: projects.map((p) => ({ ...p, id: p.id || p.project_id })),
      });
    default:
      return pagedTable("tickets", {
        emptyMessage: "Talep bulunamadı.",
        columns: [
          { key: "ticket_number", label: "NO", render: (v, r) => linkTicket(r.id, v) },
          { key: "title", label: "KONU" },
          { key: "ticket_type", label: "TİP", render: (v) => renderTypeBadge(v) },
          { key: "status", label: "DURUM", render: (v) => renderStatusBadge(v) },
          {
            key: "total_work_hours",
            label: "TOPLAM EFOR",
            render: (v) => escapeHtml(String(parseFloat(v) || 0)),
          },
          { key: "created_at", label: "TARİH", render: (v) => escapeHtml(formatDate(v)) },
        ],
        rows: tickets.map((t) => ({ ...t, id: getTicketKey(t) })),
      });
  }
}

function openEditModal() {
  renderModal("modal-edit-company", {
    title: "Firma Düzenle",
    body: `
      <form id="edit-company-form">
        <div class="sv2-form-group">
          <label for="ec-name">Firma Adı</label>
          <input type="text" id="ec-name" name="name" value="${escapeHtml(company.name || "")}">
        </div>
        <div class="sv2-form-row">
          <div class="sv2-form-group">
            <label for="ec-type">Müşteri Tipi</label>
            <select id="ec-type" name="customer_type">
              <option value="CUS"${company.customer_type === "CUS" ? " selected" : ""}>CUS</option>
              <option value="ARC"${company.customer_type === "ARC" ? " selected" : ""}>ARC</option>
            </select>
          </div>
          <div class="sv2-form-group">
            <label for="ec-code">Müşteri Kodu</label>
            <input type="text" id="ec-code" name="customer_code" value="${escapeHtml(company.customer_code || "")}">
          </div>
        </div>
        <div class="sv2-form-group">
          <label for="ec-email">E-posta</label>
          <input type="email" id="ec-email" name="primary_contact_email" value="${escapeHtml(company.primary_contact_email || "")}">
        </div>
        <div class="sv2-form-group">
          <label for="ec-phone">Telefon</label>
          <input type="tel" id="ec-phone" name="phone" value="${escapeHtml(company.phone || "")}">
        </div>
        <div class="sv2-form-group">
          <label for="ec-address">Adres</label>
          <textarea id="ec-address" name="address" rows="2">${escapeHtml(company.address || "")}</textarea>
        </div>
        <p class="sv2-text-muted" style="font-size:0.8125rem;margin:0">Sözleşme durumu, firmanın sözleşmelerinden otomatik hesaplanır (Sözleşmeler sayfası). Ad/kod değişirse kullanıcı, talep, sözleşme ve proje kayıtlarındaki kopyalar güncellenir; talep numaraları değişmez.</p>
      </form>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="modal-edit-company">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="edit-company-save">Kaydet</button>`,
  });
  openModal("modal-edit-company");
  const phoneInput = document.querySelector('#edit-company-form [name="phone"]');
  initPhoneInput(phoneInput).then(() => setPhoneValue(phoneInput, company.phone || ""));

  document.getElementById("edit-company-save")?.addEventListener("click", async () => {
    const form = document.getElementById("edit-company-form");
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
      toast(Object.values(errors)[0], "error");
      return;
    }
    showLoading(true);
    try {
      const id = company.id || company.company_id;
      // Müşteri kodu benzersizliği (YON-08): başka firmada aynı kod olamaz.
      if (data.customer_code !== String(company.customer_code || "").toUpperCase()) {
        const others = await ParlaDb.getAllCompanies();
        if (others.some((c) => (c.id || c.company_id) !== id && String(c.customer_code || "").toUpperCase() === data.customer_code)) {
          toast("Bu müşteri kodu başka bir firmada kullanılıyor.", "error");
          return;
        }
      }
      const result = await ParlaDb.updateCompanyAndSync(id, { ...data, updated_by: session.uid });
      company = result.company;
      await ParlaDb.logActivity("company_updated", "company", company.id, company.name, "Firma güncellendi", session);
      closeModal("modal-edit-company");
      const copies = result.synced.users + result.synced.tickets + result.synced.contracts + result.synced.projects;
      if (result.failed) {
        toast(`Firma güncellendi ancak kopyalar tam güncellenemedi (${result.failed}). Düzenlemeyi yeniden kaydedin.`, "warning");
      } else {
        toast(copies ? `Firma güncellendi; ${copies} kayıttaki ad/kod kopyası eşitlendi.` : "Firma güncellendi.", "success");
      }
      await loadData(id);
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
    const activeUsers = users.filter((u) => u.is_active !== false).length;
    const openTickets = tickets.filter((t) => OPEN_STATUSES.includes(String(t.status).toLowerCase())).length;
    const message = next
      ? "Firma aktive edilsin mi? Kullanıcıları yeniden talep açabilir."
      : `Firma pasife alınsın mı? ${canSeeAdminData() ? `${activeUsers} aktif kullanıcı artık yeni talep açamaz; ` : "Kullanıcıları artık yeni talep açamaz; "}${openTickets} açık talep etkilenmez, kullanıcılar mevcut taleplerini görmeye devam eder.`;
    renderConfirmDialog(message, async () => {
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

  const titles = {
    tickets: "Ticketlar",
    effort: "Efor",
    users: "Kullanıcılar",
    contracts: "Sözleşmeler",
    projects: "Projeler",
  };
  const tabTitle = document.getElementById("tab-title");
  if (tabTitle) tabTitle.textContent = titles[activeTab] || "Ticketlar";

  document.getElementById("effort-month")?.addEventListener("change", (e) => {
    effortMonth = e.target.value;
    tabPages.effort = 1;
    document.getElementById("tab-content").innerHTML = renderEffortTab();
    bindEvents();
  });

  document.getElementById("btn-export-effort-excel")?.addEventListener("click", async () => {
    const monthEfforts = filterEffortsByMonth(effortsForCompanyTickets(), effortMonth);
    const rows = monthEfforts.map((e) => {
      const t = e.ticket || {};
      return [
        formatDate(t.created_at),
        t.ticket_number || "",
        t.title || "",
        t.status ? formatStatusLabel(t.status) : "",
        e.personnel_name || "",
        e.hours || 0,
        e.work_date || "",
        e.note || "",
      ];
    });
    showLoading(true);
    try {
      await downloadExcel(`musteri-efor-${company.customer_code || company.id}-${effortMonth}.xlsx`, [
        {
          name: "Efor",
          headers: [
            "Talep Tarihi",
            "Talep No",
            "Konu",
            "Durum",
            "Danışman",
            "Efor (saat)",
            "İşlem Tarihi",
            "Not",
          ],
          rows,
        },
      ]);
      toast("Excel indirildi.", "success");
    } catch (err) {
      handleError(err, "Excel dışa aktarma");
    } finally {
      showLoading(false);
    }
  });
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

/** Efor kayıtları yalnız Efor sekmesi ilk açıldığında ve yalnız bu firmanın talepleri için süzülerek tutulur. */
async function loadEfforts() {
  try {
    const allEfforts = await ParlaDb.getAllTicketEfforts();
    const ticketIds = new Set(tickets.map((t) => getTicketKey(t)));
    ticketEfforts = allEfforts.filter((e) => ticketIds.has(e.ticket_id));
    effortsLoaded = true;
    if (activeTab === "effort") {
      const el = document.getElementById("tab-content");
      if (el) el.innerHTML = renderEffortTab();
      bindEvents();
    }
  } catch (err) {
    handleError(err, "Efor kayıtları yüklenemedi");
  }
}

async function loadData(id) {
  company = await ParlaDb.getCompany(id);
  if (!company) return;
  const seeAdmin = canSeeAdminData();

  const [companyUsers, companyTickets, companyContracts, companyProjects, values] = await Promise.all([
    seeAdmin ? ParlaDb.getUsersByCompany(id).catch(() => []) : Promise.resolve([]), // v2/users yalnız super/service
    ParlaDb.getTicketsForCompany(id),
    ParlaDb.getContractsByCompany(id),
    ParlaDb.getProjectsByCompany(id),
    seeAdmin ? ParlaDb.getContractValues().catch(() => ({})) : Promise.resolve({}), // bedel yalnız super/service
  ]);

  users = companyUsers;
  tickets = companyTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  contracts = companyContracts;
  contractValues = values;
  projects = companyProjects;
  ticketEfforts = [];
  effortsLoaded = false;
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
      handleLoadError(err, "Sayfa yüklenemedi");
    }
  } finally {
    showLoading(false);
  }
});
