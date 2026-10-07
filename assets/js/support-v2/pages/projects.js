/**
 * Parla BT Ticket V2 — Projeler (admin)
 *
 * WP-09: firma adı yazılır/çözülür ("—" ve ham kimlik biter), yönetici = kullanıcı kimliği (personel kaydına bağlıysa)
 * + personel kimliği + ad ("Seçiniz" kaydedilmez), tarih doğrulaması, rozetler mevcut CSS sınıflarıyla,
 * firma adıyla arama, pasif firmanın projesi düzenlenebilir, PRJ taleplerinin proje bağı ("Aktif Task" sayacı).
 * WP-13: sayaç için tüm talepler indirilmez (açık talepler durum bazlı indeksli sorgularla), sıralama + sayfalama + debounce.
 */
import ParlaDb from "../firebase-client.js";
import { canWrite } from "../access-control.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  toast,
  showLoading,
  handleError,
  handleLoadError,
  linkCompany,
  linkProject,
  escapeHtml,
  formatDate,
} from "../ui-shell.js";
import { matchesSearch } from "../ticket-utils.js";
import {
  PROJECT_STATUS,
  projectBadgeClass,
  projectStatusLabel,
  selectableCompanies,
  validateProjectInput,
  personnelFullName,
} from "../entity-utils.js";
import { sortRows, paginateRows, debounce, nextSort, makeHeadersSortable } from "../table-utils.js";

const PAGE_SIZE = 25;

let session = null;
let allProjects = [];
let allCompanies = [];
let allPersonnel = [];
let openProjectTasks = [];
let searchTerm = "";
let sort = { key: "created_at", dir: "desc" };
let page = 1;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Projeler",
      activePage: "projects",
      profile: session,
      isAdmin: true,
      content: `
        <div class="sv2-section">
          <div class="sv2-section-header">
            <h3>Proje Listesi</h3>
            ${canWrite(session, "project") ? `<button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-project">
              <i class="fas fa-plus"></i> Yeni Proje
            </button>` : ""}
          </div>
          <div class="sv2-section-body">
            <div class="sv2-search-bar" style="margin-bottom:1.25rem">
              <i class="fas fa-search"></i>
              <input type="search" id="project-search" aria-label="Proje ara" placeholder="Proje kodu, adı, firma, yönetici..." autocomplete="off">
            </div>
            <div id="projects-table"></div>
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
    let tasks;
    [allProjects, allCompanies, allPersonnel, tasks] = await Promise.all([
      ParlaDb.getAllProjects(),
      ParlaDb.getAllCompanies(),
      ParlaDb.getAllPersonnel(),
      ParlaDb.getOpenTickets(), // yalnız açık talepler (durum bazlı indeksli sorgular); tüm koleksiyon indirilmez
    ]);
    openProjectTasks = tasks.filter((t) => t.project_id && String(t.ticket_type || "").toUpperCase() === "PRJ");
    renderTable();
  } catch (err) {
    handleLoadError(err, "Veriler yüklenemedi");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-project")?.addEventListener("click", () => openFormModal(null));
  const applySearch = debounce(() => {
    page = 1;
    renderTable();
  }, 200);
  document.getElementById("project-search")?.addEventListener("input", (e) => {
    searchTerm = e.target.value.trim();
    applySearch();
  });
}

function projectId(p) {
  return p.id || p.project_id;
}

function companyName(p) {
  const c = allCompanies.find((x) => (x.id || x.company_id) === p.company_id);
  return (c && c.name) || p.company_name || "";
}

function activeTaskCount(id) {
  return openProjectTasks.filter((t) => t.project_id === id).length;
}

function filterProjects() {
  return allProjects.filter((p) =>
    matchesSearch(searchTerm, [p.project_code, p.name, companyName(p), p.manager_name, projectStatusLabel(p.status)])
  );
}

function projectStatusBadge(status) {
  return `<span class="sv2-badge ${projectBadgeClass(status)}">${escapeHtml(projectStatusLabel(status))}</span>`;
}

const SORT_ACCESSORS = {
  project_code: (r) => r.project_code,
  name: (r) => r.name,
  company_name: (r) => r.company_label,
  manager_name: (r) => r.manager_name,
  start_date: (r) => r.start_date,
  end_date: (r) => r.end_date,
  status: (r) => projectStatusLabel(r.status),
  tasks: (r) => r.task_count,
  created_at: (r) => (r.created_at ? Date.parse(r.created_at) || 0 : 0),
};

function renderTable() {
  const el = document.getElementById("projects-table");
  if (!el) return;

  const rows = filterProjects().map((p) => ({
    ...p,
    id: projectId(p),
    company_label: companyName(p),
    task_count: activeTaskCount(projectId(p)),
  }));
  const paged = paginateRows(sortRows(rows, sort, SORT_ACCESSORS), page, PAGE_SIZE);
  page = paged.page;

  const columns = [
    { key: "project_code", label: "PROJE KODU", sortable: true, render: (v, row) => linkProject(row.id, v || "—") },
    { key: "name", label: "PROJE ADI", sortable: true },
    {
      key: "company_name",
      label: "FİRMA",
      sortable: true,
      render: (_, row) =>
        row.company_id && row.company_label
          ? linkCompany(row.company_id, row.company_label)
          : escapeHtml(row.company_label || "—"),
    },
    { key: "manager_name", label: "YÖNETİCİ", sortable: true, render: (v) => escapeHtml(v || "—") },
    { key: "start_date", label: "BAŞLANGIÇ", sortable: true, render: (v) => escapeHtml(formatDate(v)) },
    { key: "end_date", label: "BİTİŞ", sortable: true, render: (v) => escapeHtml(formatDate(v)) },
    { key: "status", label: "DURUM", sortable: true, render: (v) => projectStatusBadge(v) },
    {
      key: "tasks",
      label: "AKTİF TASK",
      sortable: true,
      render: (_, row) => `<span class="sv2-badge sv2-badge-assigned" data-task-count="${escapeHtml(row.id)}">${row.task_count}</span>`,
    },
    {
      key: "actions",
      label: "İŞLEMLER",
      render: (_, row) =>
        `<div class="sv2-actions">
            <a href="${PATHS.adminProjectDetail}?id=${encodeURIComponent(row.id)}" class="sv2-btn sv2-btn-sm sv2-btn-secondary">
              <i class="fas fa-eye"></i> Detay
            </a>
            ${canWrite(session, "project") ? `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-secondary btn-edit" data-id="${escapeHtml(row.id)}">
              <i class="fas fa-edit"></i> Düzenle
            </button>` : ""}
          </div>`,
    },
  ];

  el.innerHTML = renderDataTable({
    columns,
    rows: paged.rows,
    emptyMessage: "Proje bulunamadı.",
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
      const project = allProjects.find((p) => projectId(p) === btn.dataset.id);
      if (project) openFormModal(project);
    });
  });
}

/** Pasif firmanın projesi düzenlenirken mevcut firma "(pasif)" etiketiyle seçenekte kalır (YON-11). */
function companyOptions(selectedId) {
  return selectableCompanies(allCompanies, selectedId)
    .map((o) => `<option value="${escapeHtml(o.id)}"${o.id === selectedId ? " selected" : ""}>${escapeHtml(o.label)}</option>`)
    .join("");
}

/** Yönetici seçeneği: personel kimliği; eski kayıtlarda `manager_uid` personel kimliği ya da kullanıcı kimliği olabilir. */
function selectedManagerPersonnelId(project) {
  if (!project) return "";
  if (project.manager_personnel_id) return project.manager_personnel_id;
  const byId = allPersonnel.find((p) => (p.id || p.personnel_id) === project.manager_uid);
  if (byId) return byId.id || byId.personnel_id;
  const byUid = allPersonnel.find((p) => p.uid && p.uid === project.manager_uid);
  return byUid ? byUid.id || byUid.personnel_id : "";
}

/** Personel kaydıyla eşleşmeyen eski yönetici adı (ör. personel kaydı olmayan PM) seçenek olarak korunur; ezilmez. */
function legacyManagerOption(project) {
  if (!project || !project.manager_name || selectedManagerPersonnelId(project)) return "";
  return `<option value="__legacy" selected>${escapeHtml(project.manager_name)} (kayıtlı yönetici)</option>`;
}

function managerOptions(selectedPersonnelId) {
  return allPersonnel
    .filter((p) => p.is_active !== false || (p.id || p.personnel_id) === selectedPersonnelId)
    .sort((a, b) => personnelFullName(a).localeCompare(personnelFullName(b), "tr"))
    .map((p) => {
      const id = p.id || p.personnel_id;
      const name = personnelFullName(p) || p.email || id;
      return `<option value="${escapeHtml(id)}" data-name="${escapeHtml(name)}" data-uid="${escapeHtml(p.uid || "")}"${id === selectedPersonnelId ? " selected" : ""}>${escapeHtml(name)}${p.is_active === false ? " (pasif)" : ""}</option>`;
    })
    .join("");
}

function personnelCheckboxes(selected) {
  const sel = selected || {};
  return allPersonnel
    .filter((p) => p.is_active !== false)
    .sort((a, b) => personnelFullName(a).localeCompare(personnelFullName(b), "tr"))
    .map((p) => {
      const id = p.id || p.personnel_id;
      const name = personnelFullName(p);
      const checked = sel[id] ? " checked" : "";
      return `<label style="display:block;margin-bottom:0.375rem">
        <input type="checkbox" class="pf-personnel" value="${escapeHtml(id)}" data-name="${escapeHtml(name)}"${checked}>
        ${escapeHtml(name)}
      </label>`;
    })
    .join("");
}

async function projectFormBody(data) {
  const d = data || {};
  const code = d.project_code || (await ParlaDb.generateProjectCode());
  return `
    <form id="project-form">
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="pf-code">Proje Kodu</label>
          <input type="text" id="pf-code" value="${escapeHtml(code)}" readonly>
        </div>
        <div class="sv2-form-group">
          <label for="pf-status">Durum</label>
          <select id="pf-status">
            ${Object.entries(PROJECT_STATUS)
              .map(
                ([k, v]) =>
                  `<option value="${k}"${(d.status || "planning") === k ? " selected" : ""}>${escapeHtml(v)}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="pf-name">Proje Adı *</label>
        <input type="text" id="pf-name" value="${escapeHtml(d.name || "")}" maxlength="200" required>
        <div class="sv2-field-error" id="err-name" hidden></div>
      </div>
      <div class="sv2-form-group">
        <label for="pf-company">Firma *</label>
        <select id="pf-company" required>
          <option value="">Firma seçin</option>
          ${companyOptions(d.company_id)}
        </select>
        <div class="sv2-field-error" id="err-company" hidden></div>
      </div>
      <div class="sv2-form-group">
        <label for="pf-manager">Proje Yöneticisi</label>
        <select id="pf-manager">
          <option value="">Seçilmedi</option>
          ${legacyManagerOption(data)}
          ${managerOptions(selectedManagerPersonnelId(data))}
        </select>
      </div>
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="pf-start">Başlangıç</label>
          <input type="date" id="pf-start" min="2000-01-01" max="2100-12-31" value="${escapeHtml(d.start_date || "")}">
          <div class="sv2-field-error" id="err-start" hidden></div>
        </div>
        <div class="sv2-form-group">
          <label for="pf-end">Bitiş</label>
          <input type="date" id="pf-end" min="2000-01-01" max="2100-12-31" value="${escapeHtml(d.end_date || "")}">
          <div class="sv2-field-error" id="err-end" hidden></div>
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="pf-desc">Açıklama</label>
        <textarea id="pf-desc" rows="3">${escapeHtml(d.description || "")}</textarea>
      </div>
      <div class="sv2-form-group">
        <label>Atanan Danışman</label>
        <div style="max-height:160px;overflow-y:auto;border:1px solid var(--sv2-gray-200);padding:0.75rem;border-radius:var(--sv2-radius-sm)">
          ${personnelCheckboxes(d.assigned_personnel) || "<span style='color:var(--sv2-gray-500)'>Personel kaydı yok.</span>"}
        </div>
      </div>
    </form>`;
}

async function openFormModal(project) {
  const isEdit = !!project;
  const modalId = "project-modal";

  renderModal(modalId, {
    title: isEdit ? "Proje Düzenle" : "Yeni Proje",
    body: await projectFormBody(project),
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="${modalId}">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="project-save">${isEdit ? "Güncelle" : "Kaydet"}</button>`,
  });

  openModal(modalId);

  document.getElementById("project-save")?.addEventListener("click", () =>
    saveProject(project ? projectId(project) : "")
  );
}

function showError(field, message) {
  const el = document.getElementById(`err-${field}`);
  if (!el) return;
  el.hidden = false;
  el.textContent = message;
}

async function saveProject(editId) {
  ["name", "company", "start", "end"].forEach((f) => {
    const el = document.getElementById(`err-${f}`);
    if (el) {
      el.hidden = true;
      el.textContent = "";
    }
  });

  const companyId = document.getElementById("pf-company")?.value || "";
  const company = allCompanies.find((c) => (c.id || c.company_id) === companyId);
  const managerEl = document.getElementById("pf-manager");
  const keepLegacy = managerEl?.value === "__legacy";
  const existing = editId ? allProjects.find((p) => projectId(p) === editId) : null;
  const managerOpt = managerEl?.value && !keepLegacy ? managerEl.selectedOptions?.[0] : null;

  const assigned = {};
  document.querySelectorAll(".pf-personnel:checked").forEach((cb) => {
    assigned[cb.value] = { id: cb.value, name: cb.dataset.name || "" };
  });

  const payload = {
    project_code: document.getElementById("pf-code")?.value.trim(),
    name: document.getElementById("pf-name")?.value.trim(),
    company_id: companyId,
    company_name: company?.name || "",
    customer_code: company?.customer_code || "",
    status: document.getElementById("pf-status")?.value || "planning",
    start_date: document.getElementById("pf-start")?.value || "",
    end_date: document.getElementById("pf-end")?.value || "",
    description: document.getElementById("pf-desc")?.value.trim() || "",
    // Yönetici: yalnız gerçekten seçildiyse (yer tutucu metin asla kaydedilmez)
    manager_uid: keepLegacy ? existing?.manager_uid || "" : managerOpt?.dataset?.uid || "",
    manager_personnel_id: keepLegacy ? existing?.manager_personnel_id || "" : managerOpt ? managerEl.value : "",
    manager_name: keepLegacy ? existing?.manager_name || "" : managerOpt ? managerOpt.dataset.name || "" : "",
    assigned_personnel: assigned,
  };

  const check = validateProjectInput(payload);
  for (const [field, message] of Object.entries(check.errors)) showError(field, message);
  if (!check.valid) return;

  showLoading(true);
  try {
    const actor = { uid: session.uid, first_name: session.first_name, last_name: session.last_name };
    if (editId) {
      await ParlaDb.updateProject(editId, {
        ...payload,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity("updated", "project", editId, payload.project_code, `Proje güncellendi: ${payload.name}`, actor);
      toast("Proje güncellendi.", "success");
    } else {
      // Kod, kayıt anında yeniden denetlenir (eşzamanlı iki yönetici aynı kodu almasın).
      payload.project_code = await ParlaDb.generateProjectCode();
      const created = await ParlaDb.createProject({
        ...payload,
        created_by: session.uid,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity("created", "project", created.id, payload.project_code, `Yeni proje: ${payload.name}`, actor);
      toast("Proje oluşturuldu.", "success");
    }
    closeModal("project-modal");
    await loadData();
  } catch (err) {
    handleError(err, "Kayıt başarısız");
  } finally {
    showLoading(false);
  }
}
