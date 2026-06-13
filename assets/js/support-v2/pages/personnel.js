/**
 * Parla BT Ticket V2 — Admin Danışmanlar / Personel Yönetimi
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
  linkPersonnel,
  escapeHtml,
} from "../ui-shell.js";
import { validatePersonnelForm } from "../validators.js";
import { STATUSES } from "../ticket-utils.js";
import { initPhoneInput, normalizePhone, formatPhoneDisplay } from "../phone-utils.js";

let session = null;
let personnel = [];
let departments = [];
let allTickets = [];
let filters = { search: "", department: "all", status: "all" };

function fullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || "—";
}

function openTicketCount(personnelId) {
  const open = [STATUSES.OPEN, STATUSES.IN_PROGRESS, STATUSES.WAITING_CUSTOMER];
  return allTickets.filter(
    (t) => t.assigned_to_id === personnelId && open.includes(t.status)
  ).length;
}

function totalEffort(personnelId) {
  return allTickets
    .filter((t) => t.assigned_to_id === personnelId)
    .reduce((sum, t) => sum + (parseFloat(t.total_work_hours) || 0), 0)
    .toFixed(1);
}

function filterPersonnel() {
  const q = filters.search.trim().toLowerCase();
  return personnel.filter((p) => {
    const id = p.id || p.personnel_id;
    if (filters.department !== "all" && p.department_id !== filters.department) return false;
    if (filters.status === "active" && p.is_active === false) return false;
    if (filters.status === "inactive" && p.is_active !== false) return false;
    if (!q) return true;
    const hay = [p.first_name, p.last_name, p.email, p.department_name, p.role_title]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function buildContent() {
  const rows = filterPersonnel().map((p) => {
    const id = p.id || p.personnel_id;
    return {
      id,
      name: fullName(p),
      email: p.email || "—",
      phone: formatPhoneDisplay(p.phone),
      department_name: p.department_name || "—",
      role_title: p.role_title || "—",
      open_tickets: openTicketCount(id),
      total_effort: totalEffort(id),
      is_active: p.is_active,
    };
  });

  const deptOptions = departments
    .map(
      (d) =>
        `<option value="${escapeHtml(d.id || d.department_id)}"${filters.department === (d.id || d.department_id) ? " selected" : ""}>${escapeHtml(d.name)}</option>`
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
        <button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-personnel">
          <i class="fas fa-plus"></i> Yeni Personel
        </button>
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
        <div id="personnel-table" class="sv2-mt-1">${renderPersonnelTable(rows)}</div>
      </div>
    </div>`;
}

function renderPersonnelTable(rows) {
  return renderDataTable({
    emptyMessage: "Personel bulunamadı.",
    columns: [
      { key: "name", label: "AD SOYAD", render: (_, r) => linkPersonnel(r.id, r.name) },
      { key: "email", label: "E-POSTA" },
      { key: "phone", label: "TELEFON" },
      { key: "department_name", label: "DEPARTMAN" },
      { key: "role_title", label: "ROL ÜNVANI" },
      { key: "open_tickets", label: "AÇIK TİCKET" },
      { key: "total_effort", label: "TOPLAM EFOR", render: (v) => `${escapeHtml(String(v))} sa` },
      {
        key: "is_active",
        label: "DURUM",
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
    ],
    rows,
  });
}

function openNewPersonnelModal() {
  const deptOpts = departments
    .map(
      (d) =>
        `<option value="${escapeHtml(d.id || d.department_id)}">${escapeHtml(d.name)}</option>`
    )
    .join("");

  renderModal("modal-new-personnel", {
    title: "Yeni Personel",
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

  const dup = personnel.find(
    (p) => String(p.email || "").toLowerCase() === data.email.toLowerCase()
  );
  if (dup) {
    showFormErrors(form, { email: "Bu e-posta zaten kayıtlı." });
    return;
  }

  showLoading(true);
  try {
    const created = await ParlaDb.createPersonnel({
      ...data,
      department_name: dept?.name || "",
      created_by: session.uid,
      updated_by: session.uid,
    });
    await ParlaDb.logActivity(
      "personnel_created",
      "personnel",
      created.id,
      fullName(created),
      data.role_title,
      session
    );
    closeModal("modal-new-personnel");
    toast("Personel eklendi.", "success");
    await loadData();
    refreshView();
  } catch (err) {
    handleError(err, "Personel eklenemedi");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-personnel")?.addEventListener("click", openNewPersonnelModal);

  document.getElementById("personnel-search")?.addEventListener("input", (e) => {
    filters.search = e.target.value;
    const rows = filterPersonnel().map((p) => {
      const id = p.id || p.personnel_id;
      return {
        id,
        name: fullName(p),
        email: p.email,
        phone: p.phone,
        department_name: p.department_name,
        role_title: p.role_title,
        open_tickets: openTicketCount(id),
        total_effort: totalEffort(id),
        is_active: p.is_active,
      };
    });
    document.getElementById("personnel-table").innerHTML = renderPersonnelTable(rows);
  });

  document.getElementById("dept-filter")?.addEventListener("change", (e) => {
    filters.department = e.target.value;
    refreshView();
  });

  bindFilterChips("#status-chips", (v) => {
    filters.status = v;
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
  bindEvents();
}

async function loadData() {
  [personnel, departments, allTickets] = await Promise.all([
    ParlaDb.getAllPersonnel(),
    ParlaDb.getAllDepartments(),
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
