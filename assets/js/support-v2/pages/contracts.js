/**
 * Parla BT Ticket V2 — Sözleşmeler (admin)
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderFilterBar,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  bindFilterChips,
  toast,
  showLoading,
  handleError,
  linkCompany,
  escapeHtml,
  formatDate,
} from "../ui-shell.js";
import { required } from "../validators.js";

const CONTRACT_TYPES = {
  yillik: "Yıllık Bakım",
  bakim: "Bakım Anlaşması",
  proje: "Proje Sözleşmesi",
  lisans: "Lisans",
  diger: "Diğer",
};

const CONTRACT_STATUS = {
  active: "Aktif",
  expired: "Sona Ermiş",
  pending: "Beklemede",
  cancelled: "İptal",
};

let session = null;
let allContracts = [];
let allCompanies = [];
let activeFilter = "all";
let searchTerm = "";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Sözleşmeler",
      activePage: "contracts",
      profile: session,
      isAdmin: true,
      content: `
        <div class="sv2-section">
          <div class="sv2-section-header">
            <h3>Sözleşme Listesi</h3>
            <button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-contract">
              <i class="fas fa-plus"></i> Yeni Sözleşme
            </button>
          </div>
          <div class="sv2-section-body">
            <div id="contracts-filters"></div>
            <div id="contracts-table"></div>
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
    [allContracts, allCompanies] = await Promise.all([
      ParlaDb.getAllContracts(),
      ParlaDb.getAllCompanies(),
    ]);
    renderFilters();
    renderTable();
  } catch (err) {
    handleError(err, "Veriler yüklenemedi");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-contract")?.addEventListener("click", () => openFormModal(null));
}

function daysRemaining(endDate) {
  if (!endDate) return null;
  const end = new Date(endDate);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end - today) / (1000 * 60 * 60 * 24));
}

function effectiveStatus(contract) {
  const days = daysRemaining(contract.end_date);
  if (contract.status === "cancelled") return "cancelled";
  if (contract.status === "pending") return "pending";
  if (contract.status === "expired" || (days !== null && days < 0)) return "expired";
  return "active";
}

function filterContracts() {
  return allContracts.filter((c) => {
    const status = effectiveStatus(c);
    const days = daysRemaining(c.end_date);

    if (activeFilter === "active" && status !== "active") return false;
    if (activeFilter === "expired" && status !== "expired") return false;
    if (activeFilter === "renewal" && !(status === "active" && days !== null && days <= 30 && days >= 0))
      return false;
    if (activeFilter === "pending" && status !== "pending") return false;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const hay = [
        c.contract_number,
        c.company_name,
        CONTRACT_TYPES[c.type],
        CONTRACT_STATUS[status],
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderFilters() {
  const el = document.getElementById("contracts-filters");
  if (!el) return;
  el.innerHTML = renderFilterBar({
    search: { id: "contract-search", placeholder: "Sözleşme no, firma...", value: searchTerm },
    chips: [
      { value: "all", label: "Tümü", active: activeFilter === "all" },
      { value: "active", label: "Aktif", active: activeFilter === "active" },
      { value: "expired", label: "Sona Ermiş", active: activeFilter === "expired" },
      { value: "renewal", label: "Yenileme Gerekiyor (30 gün)", active: activeFilter === "renewal" },
      { value: "pending", label: "Beklemede", active: activeFilter === "pending" },
    ],
  });

  document.getElementById("contract-search")?.addEventListener("input", (e) => {
    searchTerm = e.target.value.trim();
    renderTable();
  });

  bindFilterChips("#sv2-filter-chips", (value) => {
    activeFilter = value;
    renderFilters();
    renderTable();
  });
}

function statusBadge(status) {
  const cls =
    status === "active"
      ? "resolved"
      : status === "expired"
        ? "closed"
        : status === "pending"
          ? "waiting"
          : "open";
  return `<span class="sv2-badge sv2-badge-${cls}">${escapeHtml(CONTRACT_STATUS[status] || status)}</span>`;
}

function renderTable() {
  const el = document.getElementById("contracts-table");
  if (!el) return;

  const filtered = filterContracts().sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );

  el.innerHTML = renderDataTable({
    columns: [
      { key: "contract_number", label: "SÖZLEŞME NO" },
      {
        key: "company_name",
        label: "FİRMA",
        render: (_, row) =>
          row.company_id
            ? linkCompany(row.company_id, row.company_name || "—")
            : escapeHtml(row.company_name || "—"),
      },
      {
        key: "type",
        label: "TİP",
        render: (v) => escapeHtml(CONTRACT_TYPES[v] || v || "—"),
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
        key: "days",
        label: "KALAN GÜN",
        render: (_, row) => {
          const days = daysRemaining(row.end_date);
          if (days === null) return "—";
          const cls = days <= 30 ? "sv2-text-danger" : "";
          const label = days < 0 ? `${Math.abs(days)} gün geçti` : `${days} gün`;
          return `<span class="${cls}">${escapeHtml(label)}</span>`;
        },
      },
      {
        key: "status",
        label: "DURUM",
        render: (_, row) => statusBadge(effectiveStatus(row)),
      },
      {
        key: "actions",
        label: "İŞLEMLER",
        render: (_, row) =>
          `<div class="sv2-actions">
            <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-secondary btn-edit" data-id="${escapeHtml(row.id)}">
              <i class="fas fa-edit"></i> Düzenle
            </button>
          </div>`,
      },
    ],
    rows: filtered.map((c) => ({ ...c, id: c.id || c.contract_id })),
    emptyMessage: "Sözleşme bulunamadı.",
  });

  el.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const contract = allContracts.find((c) => (c.id || c.contract_id) === id);
      if (contract) openFormModal(contract);
    });
  });
}

function companyOptions(selectedId) {
  return allCompanies
    .filter((c) => c.is_active !== false)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"))
    .map((c) => {
      const id = c.id || c.company_id;
      const sel = id === selectedId ? " selected" : "";
      return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(c.name)}</option>`;
    })
    .join("");
}

function contractFormBody(data) {
  const d = data || {};
  return `
    <form id="contract-form">
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="cf-number">Sözleşme No *</label>
          <input type="text" id="cf-number" value="${escapeHtml(d.contract_number || "")}" required>
          <div class="sv2-field-error" id="err-number" hidden></div>
        </div>
        <div class="sv2-form-group">
          <label for="cf-type">Tip *</label>
          <select id="cf-type" required>
            ${Object.entries(CONTRACT_TYPES)
              .map(
                ([k, v]) =>
                  `<option value="${k}"${d.type === k ? " selected" : ""}>${escapeHtml(v)}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="cf-company">Firma *</label>
        <select id="cf-company" required>
          <option value="">Firma seçiniz</option>
          ${companyOptions(d.company_id)}
        </select>
        <div class="sv2-field-error" id="err-company" hidden></div>
      </div>
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="cf-start">Başlangıç *</label>
          <input type="date" id="cf-start" value="${escapeHtml(d.start_date || "")}" required>
          <div class="sv2-field-error" id="err-start" hidden></div>
        </div>
        <div class="sv2-form-group">
          <label for="cf-end">Bitiş *</label>
          <input type="date" id="cf-end" value="${escapeHtml(d.end_date || "")}" required>
          <div class="sv2-field-error" id="err-end" hidden></div>
        </div>
      </div>
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="cf-status">Durum</label>
          <select id="cf-status">
            ${Object.entries(CONTRACT_STATUS)
              .map(
                ([k, v]) =>
                  `<option value="${k}"${(d.status || "active") === k ? " selected" : ""}>${escapeHtml(v)}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="sv2-form-group">
          <label for="cf-value">Değer (₺)</label>
          <input type="number" id="cf-value" min="0" step="0.01" value="${d.value ?? ""}">
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="cf-notes">Notlar</label>
        <textarea id="cf-notes" rows="3">${escapeHtml(d.notes || "")}</textarea>
      </div>
    </form>`;
}

function openFormModal(contract) {
  const isEdit = !!contract;
  const modalId = "contract-modal";

  renderModal(modalId, {
    title: isEdit ? "Sözleşme Düzenle" : "Yeni Sözleşme",
    body: contractFormBody(contract),
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="${modalId}">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="contract-save">${isEdit ? "Güncelle" : "Kaydet"}</button>`,
  });

  openModal(modalId);

  document.getElementById("contract-save")?.addEventListener("click", () =>
    saveContract(contract?.id || contract?.contract_id)
  );
}

function clearFormErrors() {
  ["number", "company", "start", "end"].forEach((f) => {
    const el = document.getElementById(`err-${f}`);
    if (el) {
      el.hidden = true;
      el.textContent = "";
    }
  });
}

function showFormError(field, msg) {
  const el = document.getElementById(`err-${field}`);
  if (el) {
    el.hidden = false;
    el.textContent = msg;
  }
}

async function saveContract(editId) {
  clearFormErrors();

  const companyId = document.getElementById("cf-company")?.value || "";
  const company = allCompanies.find((c) => (c.id || c.company_id) === companyId);
  const payload = {
    contract_number: document.getElementById("cf-number")?.value.trim(),
    company_id: companyId,
    company_name: company?.name || "",
    type: document.getElementById("cf-type")?.value,
    start_date: document.getElementById("cf-start")?.value,
    end_date: document.getElementById("cf-end")?.value,
    status: document.getElementById("cf-status")?.value || "active",
    value: parseFloat(document.getElementById("cf-value")?.value) || null,
    notes: document.getElementById("cf-notes")?.value.trim() || "",
  };

  let valid = true;
  if (!required(payload.contract_number)) {
    showFormError("number", "Sözleşme numarası zorunludur.");
    valid = false;
  }
  if (!required(payload.company_id)) {
    showFormError("company", "Firma seçiniz.");
    valid = false;
  }
  if (!required(payload.start_date)) {
    showFormError("start", "Başlangıç tarihi zorunludur.");
    valid = false;
  }
  if (!required(payload.end_date)) {
    showFormError("end", "Bitiş tarihi zorunludur.");
    valid = false;
  }
  if (payload.start_date && payload.end_date && payload.end_date < payload.start_date) {
    showFormError("end", "Bitiş tarihi başlangıçtan önce olamaz.");
    valid = false;
  }
  if (!valid) return;

  showLoading(true);
  try {
    const actor = { uid: session.uid, first_name: session.first_name, last_name: session.last_name };
    if (editId) {
      await ParlaDb.updateContract(editId, {
        ...payload,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity(
        "updated",
        "contract",
        editId,
        payload.contract_number,
        `Sözleşme güncellendi: ${payload.contract_number}`,
        actor
      );
      toast("Sözleşme güncellendi.", "info");
    } else {
      const created = await ParlaDb.createContract({
        ...payload,
        created_by: session.uid,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity(
        "created",
        "contract",
        created.id,
        payload.contract_number,
        `Yeni sözleşme: ${payload.contract_number}`,
        actor
      );
      toast("Sözleşme oluşturuldu.", "info");
    }
    closeModal("contract-modal");
    await loadData();
  } catch (err) {
    handleError(err, "Kayıt başarısız");
  } finally {
    showLoading(false);
  }
}
