/**
 * Parla BT Ticket V2 — SAP Modülleri (admin)
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth } from "../auth-guard.js";
import {
  renderShell,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  toast,
  showLoading,
  handleError,
  escapeHtml,
} from "../ui-shell.js";
import { required } from "../validators.js";

let session = null;
let modules = [];
let allTickets = [];

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Modüller",
      activePage: "modules",
      profile: session,
      isAdmin: true,
      content: `
        <div class="sv2-section">
          <div class="sv2-section-header">
            <h3>SAP Modülleri</h3>
            <button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-module">
              <i class="fas fa-plus"></i> Yeni Modül
            </button>
          </div>
          <div class="sv2-section-body" id="modules-table"></div>
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
    await ParlaDb.seedSapModulesIfEmpty();
    [modules, allTickets] = await Promise.all([
      ParlaDb.getAllSapModules(),
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
  document.getElementById("btn-new-module")?.addEventListener("click", () => openFormModal(null));
}

function ticketCountForModule(code) {
  const key = String(code || "").toUpperCase();
  return allTickets.filter(
    (t) => String(t.sap_module || "").toUpperCase() === key
  ).length;
}

function activeToggle(code, isActive) {
  const checked = isActive !== false ? " checked" : "";
  return `<label class="sv2-switch">
    <input type="checkbox" class="mod-toggle" data-code="${escapeHtml(code)}"${checked}>
    <span class="sv2-switch-slider"></span>
  </label>`;
}

function renderTable() {
  const el = document.getElementById("modules-table");
  if (!el) return;

  const sorted = [...modules].sort((a, b) =>
    String(a.code || a.module_code).localeCompare(String(b.code || b.module_code), "tr")
  );

  el.innerHTML = renderDataTable({
    columns: [
      {
        key: "code",
        label: "KOD",
        render: (_, row) => escapeHtml(row.code || row.module_code || "—"),
      },
      {
        key: "name",
        label: "MODÜL ADI",
        render: (v) => escapeHtml(v || "—"),
      },
      {
        key: "ticket_count",
        label: "TOPLAM TICKET",
        render: (_, row) => String(ticketCountForModule(row.code || row.module_code)),
      },
      {
        key: "is_active",
        label: "AKTİF",
        render: (_, row) =>
          activeToggle(row.code || row.module_code, row.is_active),
      },
      {
        key: "actions",
        label: "İŞLEMLER",
        render: (_, row) =>
          `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-secondary btn-edit" data-code="${escapeHtml(row.code || row.module_code)}">
            <i class="fas fa-edit"></i> Düzenle
          </button>`,
      },
    ],
    rows: sorted.map((m) => ({
      ...m,
      id: m.id || m.module_code || m.code,
    })),
    emptyMessage: "Modül bulunamadı.",
  });

  el.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mod = modules.find(
        (m) => String(m.code || m.module_code).toUpperCase() === btn.dataset.code.toUpperCase()
      );
      if (mod) openFormModal(mod);
    });
  });

  el.querySelectorAll(".mod-toggle").forEach((input) => {
    input.addEventListener("change", () => toggleActive(input.dataset.code, input.checked));
  });
}

function moduleFormBody(data) {
  const d = data || {};
  const code = d.code || d.module_code || "";
  const isEdit = !!code;
  return `
    <form id="module-form">
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="mf-code">Kod *</label>
          <input type="text" id="mf-code" value="${escapeHtml(code)}" ${isEdit ? "readonly" : ""} maxlength="20" style="text-transform:uppercase" required>
          <div class="sv2-field-error" id="err-code" hidden></div>
        </div>
        <div class="sv2-form-group">
          <label for="mf-name">Modül Adı *</label>
          <input type="text" id="mf-name" value="${escapeHtml(d.name || "")}" required>
          <div class="sv2-field-error" id="err-name" hidden></div>
        </div>
      </div>
    </form>`;
}

function openFormModal(mod) {
  const isEdit = !!mod;
  const modalId = "module-modal";

  renderModal(modalId, {
    title: isEdit ? "Modül Düzenle" : "Yeni Modül",
    body: moduleFormBody(mod),
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="${modalId}">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="module-save">${isEdit ? "Güncelle" : "Kaydet"}</button>`,
  });

  openModal(modalId);
  document.getElementById("module-save")?.addEventListener("click", () =>
    saveModule(isEdit ? mod.code || mod.module_code : null)
  );
}

async function saveModule(editCode) {
  const codeEl = document.getElementById("mf-code");
  const nameEl = document.getElementById("mf-name");
  const errCode = document.getElementById("err-code");
  const errName = document.getElementById("err-name");
  errCode.hidden = true;
  errName.hidden = true;

  const code = String(codeEl?.value || "").trim().toUpperCase();
  const name = nameEl?.value.trim();

  if (!required(code)) {
    errCode.hidden = false;
    errCode.textContent = "Modül kodu zorunludur.";
    return;
  }
  if (!required(name)) {
    errName.hidden = false;
    errName.textContent = "Modül adı zorunludur.";
    return;
  }

  if (!editCode) {
    const exists = modules.some(
      (m) => String(m.code || m.module_code).toUpperCase() === code
    );
    if (exists) {
      errCode.hidden = false;
      errCode.textContent = "Bu kod zaten kullanılıyor.";
      return;
    }
  }

  showLoading(true);
  try {
    const actor = { uid: session.uid, first_name: session.first_name, last_name: session.last_name };
    if (editCode) {
      await ParlaDb.updateSapModule(editCode, { name });
      await ParlaDb.logActivity(
        "updated",
        "sap_module",
        editCode,
        code,
        `Modül güncellendi: ${code}`,
        actor
      );
      toast("Modül güncellendi.", "info");
    } else {
      await ParlaDb.createSapModule({ code, name, is_active: true });
      await ParlaDb.logActivity(
        "created",
        "sap_module",
        code,
        name,
        `Yeni modül: ${code}`,
        actor
      );
      toast("Modül oluşturuldu.", "info");
    }
    closeModal("module-modal");
    await loadData();
  } catch (err) {
    handleError(err, "Kayıt başarısız");
  } finally {
    showLoading(false);
  }
}

async function toggleActive(code, isActive) {
  showLoading(true);
  try {
    await ParlaDb.updateSapModule(code, { is_active: isActive });
    await ParlaDb.logActivity(
      "updated",
      "sap_module",
      code,
      code,
      `Modül ${isActive ? "aktifleştirildi" : "pasifleştirildi"}`,
      { uid: session.uid, first_name: session.first_name, last_name: session.last_name }
    );
    toast(isActive ? "Modül aktif." : "Modül pasif.", "info");
    await loadData();
  } catch (err) {
    handleError(err, "Durum güncellenemedi");
  } finally {
    showLoading(false);
  }
}
