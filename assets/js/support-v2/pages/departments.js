/**
 * Parla BT Ticket V2 — Departmanlar (admin)
 */
import ParlaDb from "../firebase-client.js";
import { canWrite } from "../access-control.js";
import { requireAuth } from "../auth-guard.js";
import {
  renderShell,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  renderConfirmDialog,
  toast,
  showLoading,
  handleError,
  handleLoadError,
  escapeHtml,
} from "../ui-shell.js";
import { required } from "../validators.js";
import { isDuplicateName } from "../entity-utils.js";

let session = null;
let departments = [];
let personnel = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Departmanlar",
      activePage: "departments",
      profile: session,
      isAdmin: true,
      content: `
        <div class="sv2-section">
          <div class="sv2-section-header">
            <h3>Departman Yönetimi</h3>
            ${canWrite(session, "super") ? `<button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-dept">
              <i class="fas fa-plus"></i> Yeni Departman
            </button>` : ""}
          </div>
          <div class="sv2-section-body" id="departments-table"></div>
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
    [departments, personnel] = await Promise.all([
      ParlaDb.getAllDepartments(),
      ParlaDb.getAllPersonnel(),
    ]);
    renderTable();
  } catch (err) {
    handleLoadError(err, "Veriler yüklenemedi");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-dept")?.addEventListener("click", () => openFormModal(null));
}

function personnelCount(deptId) {
  return personnel.filter(
    (p) => p.department_id === deptId && p.is_active !== false
  ).length;
}

/** Departmanda (pasifler dahil) hiç personel kaydı var mı? Varsa gerçek silme sunulmaz. */
function hasAnyPersonnel(deptId) {
  return personnel.some((p) => p.department_id === deptId);
}

/** Durum anahtarı yalnız yazma yetkisi olanlarda etkindir (database.rules: departments yazma = super_admin; YON-22). */
function activeToggle(id, isActive) {
  const checked = isActive !== false ? " checked" : "";
  const writable = canWrite(session, "super");
  return `<label class="sv2-switch" title="${writable ? "Durum" : "Durumu yalnızca Süper Admin değiştirebilir"}">
    <input type="checkbox" class="dept-toggle" data-id="${escapeHtml(id)}" aria-label="Departman durumu"${checked}${writable ? "" : " disabled"}>
    <span class="sv2-switch-slider"></span>
  </label>`;
}

function renderTable() {
  const el = document.getElementById("departments-table");
  if (!el) return;

  const sorted = [...departments].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "tr")
  );

  el.innerHTML = renderDataTable({
    columns: [
      { key: "name", label: "DEPARTMAN ADI" },
      {
        key: "description",
        label: "AÇIKLAMA",
        render: (v) => escapeHtml(v || "—"),
      },
      {
        key: "count",
        label: "PERSONEL SAYISI",
        render: (_, row) => String(personnelCount(row.id || row.department_id)),
      },
      {
        key: "is_active",
        label: "DURUM",
        render: (_, row) => activeToggle(row.id || row.department_id, row.is_active),
      },
      {
        key: "actions",
        label: "İŞLEMLER",
        render: (_, row) =>
          `<div class="sv2-actions">
            ${canWrite(session, "super") ? `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-secondary btn-edit" data-id="${escapeHtml(row.id || row.department_id)}">
              <i class="fas fa-edit"></i> Düzenle
            </button>` : ""}
            ${canWrite(session, "super") && !hasAnyPersonnel(row.id || row.department_id) ? `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-danger btn-delete" data-id="${escapeHtml(row.id || row.department_id)}" title="Personeli olmayan departman kalıcı silinir">
              <i class="fas fa-trash"></i> Sil
            </button>` : ""}
          </div>`,
      },
    ],
    rows: sorted.map((d) => ({ ...d, id: d.id || d.department_id })),
    emptyMessage: "Departman bulunamadı.",
  });

  el.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dept = departments.find((d) => (d.id || d.department_id) === btn.dataset.id);
      if (dept) openFormModal(dept);
    });
  });

  el.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dept = departments.find((d) => (d.id || d.department_id) === btn.dataset.id);
      if (dept) confirmDelete(dept);
    });
  });

  el.querySelectorAll(".dept-toggle").forEach((input) => {
    input.addEventListener("change", () => toggleActive(input.dataset.id, input.checked));
  });
}

function deptFormBody(data) {
  const d = data || {};
  return `
    <form id="dept-form">
      <div class="sv2-form-group">
        <label for="df-name">Departman Adı *</label>
        <input type="text" id="df-name" value="${escapeHtml(d.name || "")}" maxlength="100" required>
        <div class="sv2-field-error" id="err-name" hidden></div>
      </div>
      <div class="sv2-form-group">
        <label for="df-desc">Açıklama</label>
        <textarea id="df-desc" rows="3" maxlength="300">${escapeHtml(d.description || "")}</textarea>
      </div>
    </form>`;
}

function openFormModal(dept) {
  const isEdit = !!dept;
  const modalId = "dept-modal";

  renderModal(modalId, {
    title: isEdit ? "Departman Düzenle" : "Yeni Departman",
    body: deptFormBody(dept),
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="${modalId}">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="dept-save">${isEdit ? "Güncelle" : "Kaydet"}</button>`,
  });

  openModal(modalId);
  document.getElementById("dept-save")?.addEventListener("click", () =>
    saveDept(dept?.id || dept?.department_id)
  );
}

async function saveDept(editId) {
  const name = document.getElementById("df-name")?.value.trim();
  const errEl = document.getElementById("err-name");
  errEl.hidden = true;

  if (!required(name)) {
    errEl.hidden = false;
    errEl.textContent = "Departman adı zorunludur.";
    return;
  }
  // Yinelenen ad (büyük/küçük harf ve Türkçe karakter duyarsız) kabul edilmez (YON-35).
  if (isDuplicateName(departments, name, editId)) {
    errEl.hidden = false;
    errEl.textContent = "Bu adla bir departman zaten var.";
    return;
  }

  const payload = {
    name,
    description: document.getElementById("df-desc")?.value.trim() || "",
  };

  showLoading(true);
  try {
    const actor = { uid: session.uid, first_name: session.first_name, last_name: session.last_name };
    if (editId) {
      // Ad değiştiyse personel kayıtlarındaki departman adı kopyaları da yayılır (YON-09).
      const result = await ParlaDb.updateDepartmentAndSync(editId, {
        ...payload,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity(
        "updated",
        "department",
        editId,
        name,
        `Departman güncellendi: ${name}`,
        actor
      );
      toast(result.failed ? "Departman güncellendi ancak personel kayıtlarındaki ad tam güncellenemedi; yeniden kaydedin." : "Departman güncellendi.", result.failed ? "warning" : "success");
    } else {
      const created = await ParlaDb.createDepartment({
        ...payload,
        is_active: true,
        created_by: session.uid,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity(
        "created",
        "department",
        created.id,
        name,
        `Yeni departman: ${name}`,
        actor
      );
      toast("Departman oluşturuldu.", "success");
    }
    closeModal("dept-modal");
    await loadData();
  } catch (err) {
    handleError(err, "Kayıt başarısız");
  } finally {
    showLoading(false);
  }
}

async function toggleActive(id, isActive) {
  showLoading(true);
  try {
    const dept = departments.find((d) => (d.id || d.department_id) === id);
    await ParlaDb.updateDepartment(id, { is_active: isActive, updated_by: session.uid });
    await ParlaDb.logActivity(
      "updated",
      "department",
      id,
      dept?.name || id,
      `Departman ${isActive ? "aktifleştirildi" : "pasifleştirildi"}`,
      { uid: session.uid, first_name: session.first_name, last_name: session.last_name }
    );
    toast(isActive ? "Departman aktif." : "Departman pasif.", "success");
    await loadData();
  } catch (err) {
    handleError(err, "Durum güncellenemedi");
    renderTable(); // anahtar gerçek duruma geri döner
  } finally {
    showLoading(false);
  }
}

function confirmDelete(dept) {
  const id = dept.id || dept.department_id;
  renderConfirmDialog(
    `"${dept.name}" departmanı KALICI olarak silinecek (bu departmanda personel kaydı yok). Devam edilsin mi?`,
    () => deleteDept(id, dept.name)
  );
}

async function deleteDept(id, name) {
  showLoading(true);
  try {
    await ParlaDb.deleteDepartment(id);
    await ParlaDb.logActivity(
      "deleted",
      "department",
      id,
      name,
      `Departman silindi: ${name}`,
      { uid: session.uid, first_name: session.first_name, last_name: session.last_name }
    );
    toast("Departman silindi.", "success");
    await loadData();
  } catch (err) {
    handleError(err, "Silme başarısız");
  } finally {
    showLoading(false);
  }
}
