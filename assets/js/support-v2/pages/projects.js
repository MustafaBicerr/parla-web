/**
 * Parla BT Ticket V2 — Projeler (admin)
 */
import ParlaDb from "../firebase-client.js";
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
  linkCompany,
  linkProject,
  escapeHtml,
  formatDate,
} from "../ui-shell.js";
import { required } from "../validators.js";

const PROJECT_STATUS = {
  planning: "Planlama",
  active: "Aktif",
  on_hold: "Beklemede",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

let session = null;
let allProjects = [];
let allCompanies = [];
let allPersonnel = [];
let allTickets = [];
let searchTerm = "";

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
            <button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-project">
              <i class="fas fa-plus"></i> Yeni Proje
            </button>
          </div>
          <div class="sv2-section-body">
            <div class="sv2-search-bar" style="margin-bottom:1.25rem">
              <i class="fas fa-search"></i>
              <input type="search" id="project-search" placeholder="Proje kodu, adı, firma..." autocomplete="off">
            </div>
            <div id="projects-table"></div>
          </div>
        </div>`,
    });
    await loadData();
    bindEvents();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin") {
      handleError(err, "Sayfa yüklenemedi");
    }
  }
}

async function loadData() {
  showLoading(true);
  try {
    [allProjects, allCompanies, allPersonnel, allTickets] = await Promise.all([
      ParlaDb.getAllProjects(),
      ParlaDb.getAllCompanies(),
      ParlaDb.getAllPersonnel(),
      ParlaDb.getAllTickets(),
    ]);
    renderTable();
  } catch (err) {
    handleError(err, "Veriler yüklenemedi");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-project")?.addEventListener("click", () => openFormModal(null));
  document.getElementById("project-search")?.addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderTable();
  });
}

async function generateProjectCode() {
  let max = 0;
  for (const p of allProjects) {
    const match = String(p.project_code || "").match(/^PRJ(\d+)$/i);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `PRJ${String(max + 1).padStart(4, "0")}`;
}

function activeTaskCount(projectId) {
  return allTickets.filter(
    (t) =>
      t.project_id === projectId &&
      t.ticket_type === "PRJ" &&
      !["closed", "resolved"].includes(String(t.status || "").toLowerCase())
  ).length;
}

function filterProjects() {
  if (!searchTerm) return allProjects;
  return allProjects.filter((p) => {
    const hay = [p.project_code, p.name, p.company_name, p.manager_name]
      .join(" ")
      .toLowerCase();
    return hay.includes(searchTerm);
  });
}

function projectStatusBadge(status) {
  const key = String(status || "planning");
  const label = PROJECT_STATUS[key] || key;
  const cls =
    key === "active"
      ? "open"
      : key === "completed"
        ? "resolved"
        : key === "on_hold"
          ? "waiting"
          : key === "cancelled"
            ? "closed"
            : "in-progress";
  return `<span class="sv2-badge sv2-badge-${cls}">${escapeHtml(label)}</span>`;
}

function renderTable() {
  const el = document.getElementById("projects-table");
  if (!el) return;

  const filtered = filterProjects().sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );

  el.innerHTML = renderDataTable({
    columns: [
      {
        key: "project_code",
        label: "PROJE KODU",
        render: (v, row) => linkProject(row.id || row.project_id, v || "—"),
      },
      { key: "name", label: "PROJE ADI" },
      {
        key: "company_name",
        label: "FİRMA",
        render: (_, row) =>
          row.company_id
            ? linkCompany(row.company_id, row.company_name || "—")
            : escapeHtml(row.company_name || "—"),
      },
      {
        key: "manager_name",
        label: "YÖNETİCİ",
        render: (v) => escapeHtml(v || "—"),
      },
      {
        key: "start_date",
        label: "BAŞLANGIÇ",
        render: (v) => escapeHtml(formatDate(v)),
      },
      {
        key: "end_date",
        label: "BİTİŞ",
        render: (v) => escapeHtml(formatDate(v)),
      },
      {
        key: "status",
        label: "DURUM",
        render: (v) => projectStatusBadge(v),
      },
      {
        key: "tasks",
        label: "AKTİF TASK",
        render: (_, row) => {
          const count = activeTaskCount(row.id || row.project_id);
          return `<span class="sv2-badge sv2-badge-open">${count}</span>`;
        },
      },
      {
        key: "actions",
        label: "İŞLEMLER",
        render: (_, row) =>
          `<div class="sv2-actions">
            <a href="${PATHS.adminProjectDetail}?id=${encodeURIComponent(row.id || row.project_id)}" class="sv2-btn sv2-btn-sm sv2-btn-secondary">
              <i class="fas fa-eye"></i> Detay
            </a>
            <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-secondary btn-edit" data-id="${escapeHtml(row.id || row.project_id)}">
              <i class="fas fa-edit"></i> Düzenle
            </button>
          </div>`,
      },
    ],
    rows: filtered.map((p) => ({ ...p, id: p.id || p.project_id })),
    emptyMessage: "Proje bulunamadı.",
  });

  el.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const project = allProjects.find((p) => (p.id || p.project_id) === btn.dataset.id);
      if (project) openFormModal(project);
    });
  });
}

function companyOptions(selectedId) {
  return allCompanies
    .filter((c) => c.is_active !== false)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"))
    .map((c) => {
      const id = c.id || c.company_id;
      return `<option value="${escapeHtml(id)}"${id === selectedId ? " selected" : ""}>${escapeHtml(c.name)}</option>`;
    })
    .join("");
}

function managerOptions(selectedUid) {
  const admins = allPersonnel.filter((p) => p.is_active !== false);
  return admins
    .sort((a, b) =>
      `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "tr")
    )
    .map((p) => {
      const id = p.id || p.personnel_id;
      const name = `${p.first_name || ""} ${p.last_name || ""}`.trim();
      return `<option value="${escapeHtml(id)}" data-name="${escapeHtml(name)}"${id === selectedUid ? " selected" : ""}>${escapeHtml(name)}</option>`;
    })
    .join("");
}

function personnelCheckboxes(selected) {
  const sel = selected || {};
  return allPersonnel
    .filter((p) => p.is_active !== false)
    .sort((a, b) =>
      `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "tr")
    )
    .map((p) => {
      const id = p.id || p.personnel_id;
      const name = `${p.first_name || ""} ${p.last_name || ""}`.trim();
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
  const code = d.project_code || (await generateProjectCode());
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
        <input type="text" id="pf-name" value="${escapeHtml(d.name || "")}" required>
        <div class="sv2-field-error" id="err-name" hidden></div>
      </div>
      <div class="sv2-form-group">
        <label for="pf-company">Firma *</label>
        <select id="pf-company" required>
          <option value="">Firma seçiniz</option>
          ${companyOptions(d.company_id)}
        </select>
        <div class="sv2-field-error" id="err-company" hidden></div>
      </div>
      <div class="sv2-form-group">
        <label for="pf-manager">Proje Yöneticisi</label>
        <select id="pf-manager">
          <option value="">Seçiniz</option>
          ${managerOptions(d.manager_uid)}
        </select>
      </div>
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="pf-start">Başlangıç</label>
          <input type="date" id="pf-start" value="${escapeHtml(d.start_date || "")}">
        </div>
        <div class="sv2-form-group">
          <label for="pf-end">Bitiş</label>
          <input type="date" id="pf-end" value="${escapeHtml(d.end_date || "")}">
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="pf-desc">Açıklama</label>
        <textarea id="pf-desc" rows="3">${escapeHtml(d.description || "")}</textarea>
      </div>
      <div class="sv2-form-group">
        <label>Atanan Personel</label>
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
    saveProject(project?.id || project?.project_id)
  );
}

async function saveProject(editId) {
  const nameEl = document.getElementById("pf-name");
  const companyEl = document.getElementById("pf-company");
  const errName = document.getElementById("err-name");
  const errCompany = document.getElementById("err-company");

  errName.hidden = true;
  errCompany.hidden = true;

  const companyId = companyEl?.value || "";
  const company = allCompanies.find((c) => (c.id || c.company_id) === companyId);
  const managerEl = document.getElementById("pf-manager");
  const managerOpt = managerEl?.selectedOptions?.[0];

  const assigned = {};
  document.querySelectorAll(".pf-personnel:checked").forEach((cb) => {
    assigned[cb.value] = { id: cb.value, name: cb.dataset.name || "" };
  });

  const payload = {
    project_code: document.getElementById("pf-code")?.value.trim(),
    name: nameEl?.value.trim(),
    company_id: companyId,
    customer_code: company?.customer_code || "",
    status: document.getElementById("pf-status")?.value || "planning",
    start_date: document.getElementById("pf-start")?.value || "",
    end_date: document.getElementById("pf-end")?.value || "",
    description: document.getElementById("pf-desc")?.value.trim() || "",
    manager_uid: managerEl?.value || "",
    manager_name: managerOpt?.dataset?.name || managerOpt?.textContent?.trim() || "",
    assigned_personnel: assigned,
  };

  if (!required(payload.name)) {
    errName.hidden = false;
    errName.textContent = "Proje adı zorunludur.";
    return;
  }
  if (!required(payload.company_id)) {
    errCompany.hidden = false;
    errCompany.textContent = "Firma seçiniz.";
    return;
  }

  showLoading(true);
  try {
    const actor = { uid: session.uid, first_name: session.first_name, last_name: session.last_name };
    if (editId) {
      await ParlaDb.updateProject(editId, {
        ...payload,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity(
        "updated",
        "project",
        editId,
        payload.project_code,
        `Proje güncellendi: ${payload.name}`,
        actor
      );
      toast("Proje güncellendi.", "info");
    } else {
      const created = await ParlaDb.createProject({
        ...payload,
        created_by: session.uid,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity(
        "created",
        "project",
        created.id,
        payload.project_code,
        `Yeni proje: ${payload.name}`,
        actor
      );
      toast("Proje oluşturuldu.", "info");
    }
    closeModal("project-modal");
    await loadData();
  } catch (err) {
    handleError(err, "Kayıt başarısız");
  } finally {
    showLoading(false);
  }
}
