/**
 * Parla BT Ticket V2 — Admin Danışmanlar / Personel Yönetimi
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
  linkPersonnel,
  escapeHtml,
} from "../ui-shell.js";
import { validatePersonnelForm } from "../validators.js";
import { getTicketKey, matchesSearch } from "../ticket-utils.js";
import { initPhoneInput, normalizePhone, formatPhoneDisplay } from "../phone-utils.js";
import { selectableDepartments } from "../entity-utils.js";
import { sortRows, paginateRows, debounce, nextSort, makeHeadersSortable } from "../table-utils.js";

const PAGE_SIZE = 25;

let session = null;
let personnel = [];
let departments = [];
let openTickets = [];
let assignmentsByTicket = {};
let allEfforts = [];
let openCountByPersonnel = new Map();
let effortByPersonnel = new Map();
let filters = { search: "", department: "all", status: "all" };
let sort = { key: "name", dir: "asc" };
let page = 1;

function fullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "—";
}

/**
 * Açık talep sayısı: birincil VE ikincil danışman (atama kayıtları; kayıt yoksa birincil). Yalnız açık talepler
 * (durum bazlı indeksli sorgular) + atama düğümü okunur; tüm talepler indirilmez (OLC-04).
 */
function computeOpenCounts() {
  const counts = new Map();
  for (const t of openTickets) {
    const list = assignmentsByTicket[getTicketKey(t)];
    const ids = list && list.length ? list.map((a) => a.personnel_id) : t.assigned_to_id ? [t.assigned_to_id] : [];
    for (const pid of new Set(ids)) counts.set(pid, (counts.get(pid) || 0) + 1);
  }
  return counts;
}

/** Danışmanın KENDİ girdiği efor (efor kaydındaki personel kimliği; başkalarının eforu birincil danışmana yazılmaz). */
function computeEffortTotals() {
  const totals = new Map();
  for (const e of allEfforts) {
    if (!e.personnel_id) continue;
    totals.set(e.personnel_id, (totals.get(e.personnel_id) || 0) + (parseFloat(e.hours) || 0));
  }
  return totals;
}

function filterPersonnel() {
  return personnel.filter((p) => {
    if (filters.department !== "all" && p.department_id !== filters.department) return false;
    if (filters.status === "active" && p.is_active === false) return false;
    if (filters.status === "inactive" && p.is_active !== false) return false;
    return matchesSearch(filters.search, [p.first_name, p.last_name, p.email, p.department_name, p.role_title]);
  });
}

function buildRows() {
  return filterPersonnel().map((p) => {
    const id = p.id || p.personnel_id;
    return {
      id,
      name: fullName(p),
      email: p.email || "—",
      phone: formatPhoneDisplay(p.phone),
      department_name: p.department_name || "—",
      role_title: p.role_title || "—",
      open_tickets: openCountByPersonnel.get(id) || 0,
      total_effort: Math.round((effortByPersonnel.get(id) || 0) * 10) / 10,
      is_active: p.is_active,
      linked: !!p.uid,
    };
  });
}

function buildContent() {
  const deptOptions = departments
    .map(
      (d) =>
        `<option value="${escapeHtml(d.id || d.department_id)}"${filters.department === (d.id || d.department_id) ? " selected" : ""}>${escapeHtml(d.name)}${d.is_active === false ? " (pasif)" : ""}</option>`
    )
    .join("");

  return `
    <nav class="sv2-breadcrumb" aria-label="Breadcrumb">
      <a href="${PATHS.adminDashboard}" class="sv2-breadcrumb-link">Genel Bakış</a>
      <span class="sv2-breadcrumb-sep">›</span>
      <span class="sv2-breadcrumb-current">Danışmanlar</span>
    </nav>
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Danışmanlar</h3>
        ${canWrite(session, "admin") ? `<div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button type="button" class="sv2-btn sv2-btn-outline" id="btn-link-personnel" title="E-posta eşleşmesiyle personel kaydını kullanıcı hesabına bağlar">
            <i class="fas fa-link"></i> Personel ↔ Kullanıcı Eşleştir
          </button>
          <button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-personnel">
            <i class="fas fa-plus"></i> Yeni Danışman
          </button>
        </div>` : ""}
      </div>
      <div class="sv2-section-body">
        ${renderFilterBar({
          search: { id: "personnel-search", placeholder: "Ad, e-posta veya bölüm ara...", value: filters.search },
        })}
        <div class="sv2-filters sv2-mt-1">
          <div class="sv2-form-group">
            <label for="dept-filter">Departman</label>
            <select id="dept-filter">
              <option value="all"${filters.department === "all" ? " selected" : ""}>Tüm Departmanlar</option>
              ${deptOptions}
            </select>
          </div>
        </div>
        <div class="sv2-filter-chips sv2-mt-1" id="status-chips">
          <button type="button" class="sv2-chip${filters.status === "all" ? " is-active" : ""}" data-value="all">Tüm Durumlar</button>
          <button type="button" class="sv2-chip${filters.status === "active" ? " is-active" : ""}" data-value="active">Aktif</button>
          <button type="button" class="sv2-chip${filters.status === "inactive" ? " is-active" : ""}" data-value="inactive">Pasif</button>
        </div>
        <div id="personnel-table" class="sv2-mt-1"></div>
      </div>
    </div>`;
}

const SORT_ACCESSORS = {
  name: (r) => r.name,
  email: (r) => r.email,
  department_name: (r) => r.department_name,
  role_title: (r) => r.role_title,
  linked: (r) => (r.linked ? 1 : 0),
  open_tickets: (r) => r.open_tickets,
  total_effort: (r) => r.total_effort,
  is_active: (r) => (r.is_active === false ? 0 : 1),
};

function renderPersonnelTable() {
  const container = document.getElementById("personnel-table");
  if (!container) return;
  const paged = paginateRows(sortRows(buildRows(), sort, SORT_ACCESSORS), page, PAGE_SIZE);
  page = paged.page;
  const columns = [
    { key: "name", label: "AD SOYAD", sortable: true, render: (_, r) => linkPersonnel(r.id, r.name) },
    { key: "email", label: "E-POSTA", sortable: true },
    { key: "phone", label: "TELEFON" },
    { key: "department_name", label: "DEPARTMAN", sortable: true },
    { key: "role_title", label: "ROL ÜNVANI", sortable: true },
    {
      key: "linked",
      label: "KULLANICI",
      sortable: true,
      render: (v) =>
        v
          ? '<span class="sv2-badge sv2-badge-resolved" title="Kullanıcı hesabıyla eşleşti">Bağlı</span>'
          : '<span class="sv2-badge sv2-badge-waiting_customer" title="Kullanıcı hesabıyla eşleşmedi: danışman talepte yazamaz">Eşleşmedi</span>',
    },
    { key: "open_tickets", label: "Açık Talep", sortable: true },
    { key: "total_effort", label: "TOPLAM EFOR", sortable: true, render: (v) => `${escapeHtml(String(v))} sa` },
    {
      key: "is_active",
      label: "DURUM",
      sortable: true,
      render: (v) =>
        v !== false
          ? `<span class="sv2-badge sv2-badge-resolved">Aktif</span>`
          : `<span class="sv2-badge sv2-badge-closed">Pasif</span>`,
    },
    {
      key: "id",
      label: "İŞLEMLER",
      render: (_, r) =>
        `<a href="${PATHS.adminPersonnelDetail}?id=${encodeURIComponent(r.id)}" class="sv2-btn sv2-btn-sm sv2-btn-outline">Detay</a>`,
    },
  ];
  container.innerHTML = renderDataTable({
    emptyMessage: "Danışman bulunamadı.",
    columns,
    rows: paged.rows,
    pagination: {
      page: paged.page,
      totalPages: paged.totalPages,
      total: paged.total,
      onPageChange: (p) => {
        page = p;
        renderPersonnelTable();
      },
    },
  });
  makeHeadersSortable(container, columns, sort, (key) => {
    sort = nextSort(sort, key);
    page = 1;
    renderPersonnelTable();
  });
}

function openNewPersonnelModal() {
  // Pasif departman yeni personele atanamaz (YON-35).
  const deptOpts = selectableDepartments(departments, "")
    .map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)}</option>`)
    .join("");

  renderModal("modal-new-personnel", {
    title: "Yeni Danışman",
    body: `
      <form id="new-personnel-form">
        <div class="sv2-form-row">
          <div class="sv2-form-group">
            <label for="np-first">Ad *</label>
            <input type="text" id="np-first" name="first_name" required>
          </div>
          <div class="sv2-form-group">
            <label for="np-last">Soyad *</label>
            <input type="text" id="np-last" name="last_name" required>
          </div>
        </div>
        <div class="sv2-form-group">
          <label for="np-email">E-posta *</label>
          <input type="email" id="np-email" name="email" required>
        </div>
        <div class="sv2-form-group">
          <label for="np-phone">Telefon</label>
          <input type="tel" id="np-phone" name="phone">
        </div>
        <div class="sv2-form-group">
          <label for="np-dept">Departman *</label>
          <select id="np-dept" name="department_id" required>
            <option value="">Seçiniz</option>
            ${deptOpts}
          </select>
        </div>
        <div class="sv2-form-group">
          <label for="np-role">Rol Ünvanı *</label>
          <input type="text" id="np-role" name="role_title" placeholder="Danışman, IT Uzmanı..." required>
        </div>
      </form>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="modal-new-personnel">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="np-submit">Kaydet</button>`,
  });
  openModal("modal-new-personnel");
  initPhoneInput(document.getElementById("np-phone"));
  document.getElementById("np-submit")?.addEventListener("click", submitNewPersonnel);
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

async function submitNewPersonnel() {
  const form = document.getElementById("new-personnel-form");
  const deptSelect = form.department_id;
  const dept = departments.find((d) => (d.id || d.department_id) === deptSelect.value);

  const data = {
    first_name: form.first_name.value.trim(),
    last_name: form.last_name.value.trim(),
    email: form.email.value.trim(),
    phone: normalizePhone(form.phone) || form.phone.value.trim(),
    department_id: deptSelect.value,
    role_title: form.role_title.value.trim(),
  };

  const { valid, errors } = validatePersonnelForm(data);
  if (!valid) {
    showFormErrors(form, errors);
    return;
  }

  data.email = data.email.trim().toLowerCase();
  const dup = personnel.find(
    (p) => String(p.email || "").trim().toLowerCase() === data.email
  );
  if (dup) {
    showFormErrors(form, { email: "Bu e-posta zaten kayıtlı." });
    return;
  }

  showLoading(true);
  try {
    // Müşteri kullanıcısının e-postasıyla personel kaydı açılamaz (YON-13).
    const conflict = await ParlaDb.emailHasConflictingRole(data.email, "consultant");
    if (conflict) {
      showFormErrors(form, { email: conflict });
      return;
    }
    // Açık kimlik bağı: aynı e-postalı personel/danışman hesabı varsa uid yazılır (talepte yazma yetkisi buna bağlıdır).
    let uid = "";
    try {
      const match = (await ParlaDb.getAllUsers()).find(
        (u) => String(u.email || "").trim().toLowerCase() === data.email && ["consultant", "project_manager", "service_admin", "super_admin"].includes(String(u.role || "").toLowerCase())
      );
      uid = match ? match.uid || match.id : "";
    } catch {
      /* kullanıcı listesi okunamadı: eşleştirme aracıyla sonradan bağlanır */
    }
    const created = await ParlaDb.createPersonnel({
      ...data,
      uid,
      department_name: dept?.name || "",
      created_by: session.uid,
      updated_by: session.uid,
    });
    if (!uid) {
      toast("Bu e-postayla kayıtlı bir kullanıcı hesabı bulunamadı; danışmanın talepte işlem yapabilmesi için kullanıcı hesabı oluşturup \"Personel ↔ Kullanıcı Eşleştir\" aracını çalıştırın.", "warning");
    }
    await ParlaDb.logActivity(
      "personnel_created",
      "personnel",
      created.id,
      fullName(created),
      data.role_title,
      session
    );
    closeModal("modal-new-personnel");
    toast("Danışman eklendi.", "success");
    await loadData();
    refreshView();
  } catch (err) {
    handleError(err, "Danışman eklenemedi");
  } finally {
    showLoading(false);
  }
}

function linkListHtml(title, items, render) {
  if (!items.length) return "";
  return `<h4 style="margin:1rem 0 0.35rem">${escapeHtml(title)} (${items.length})</h4>
    <ul style="margin:0;padding-left:1.25rem">${items.map((i) => `<li>${render(i)}</li>`).join("")}</ul>`;
}

/** "Personel ↔ kullanıcı eşleştir": e-posta eşleşmesiyle personel.uid doldurur, eşleşmeyenleri uyarı olarak listeler. */
async function runPersonnelLinkTool() {
  showLoading(true);
  try {
    const report = await ParlaDb.linkPersonnelUsers();
    await loadData();
    refreshView();
    const warn = report.unmatchedPersonnel.length + report.staffWithoutPersonnel.length + report.conflicts.length;
    renderModal("modal-link-result", {
      title: "Personel ↔ Kullanıcı Eşleştirme Sonucu",
      body: `
        <p id="link-result-summary"><strong>${report.linked.length}</strong> personel yeni eşleştirildi, <strong>${report.alreadyLinked}</strong> personel zaten bağlıydı; <strong>${report.ticketsUpdated}</strong> talebin atama haritası güncellendi.</p>
        ${warn ? '<p class="sv2-text-muted">Aşağıdaki uyarılar giderilmeden ilgili danışmanlar talepte işlem yapamaz.</p>' : '<p class="sv2-text-muted">Eşleşmeyen kayıt yok.</p>'}
        ${linkListHtml("Eşleşen kullanıcı hesabı bulunamayan personel", report.unmatchedPersonnel, (i) => `${escapeHtml(i.name)} — ${escapeHtml(i.email || "e-posta yok")}${i.active ? "" : " (pasif)"}`)}
        ${linkListHtml("Birden çok kullanıcıyla eşleşen personel", report.conflicts, (i) => `${escapeHtml(i.name)} — ${escapeHtml(i.email)}`)}
        ${linkListHtml("Personel kaydı olmayan danışman / proje yöneticisi hesapları", report.staffWithoutPersonnel, (i) => `${escapeHtml(i.name)} — ${escapeHtml(i.email)} (${escapeHtml(i.role)})`)}`,
      footer: `<button type="button" class="sv2-btn sv2-btn-primary" data-close="modal-link-result">Tamam</button>`,
    });
    openModal("modal-link-result");
  } catch (err) {
    handleError(err, "Personel eşleştirme");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-personnel")?.addEventListener("click", openNewPersonnelModal);
  document.getElementById("btn-link-personnel")?.addEventListener("click", runPersonnelLinkTool);

  const applySearch = debounce(() => {
    page = 1;
    renderPersonnelTable();
  }, 200);
  document.getElementById("personnel-search")?.addEventListener("input", (e) => {
    filters.search = e.target.value;
    applySearch();
  });

  document.getElementById("dept-filter")?.addEventListener("change", (e) => {
    filters.department = e.target.value;
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
    title: "Danışmanlar",
    activePage: "personnel",
    profile: session,
    isAdmin: true,
    content: buildContent(),
  });
  renderPersonnelTable();
  bindEvents();
}

async function loadData() {
  [personnel, departments, openTickets, assignmentsByTicket, allEfforts] = await Promise.all([
    ParlaDb.getAllPersonnel(),
    ParlaDb.getAllDepartments(),
    ParlaDb.getOpenTickets(), // yalnız açık talepler (indeksli sorgular); sayaçlar için tüm koleksiyon indirilmez
    ParlaDb.getAllAssignments().catch(() => ({})),
    ParlaDb.getAllTicketEfforts().catch(() => []),
  ]);
  openCountByPersonnel = computeOpenCounts();
  effortByPersonnel = computeEffortTotals();
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
