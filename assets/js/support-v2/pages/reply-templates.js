/**
 * Parla BT Ticket V2 — Hazır Yanıtlar (WP-16)
 *
 * Personel sık verdiği yanıtları şablon olarak tutar; talep yanıt kutusunda "Şablon ekle" ile kullanılır.
 * Okuma: tüm personel; ekleme/düzenleme/silme: super_admin ve service_admin (database.rules: reply_templates).
 * Değişkenler: {musteri_adi}, {talep_no}, {danisman}. Tüm metinler kaçışlıdır (başlık/gövde güvenilmez veri sayılır).
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
import {
  TEMPLATE_VARIABLES,
  TEMPLATE_LIMITS,
  renderReplyTemplate,
  validateTemplateInput,
  sortTemplates,
} from "../entity-utils.js";

let session = null;
let templates = [];

document.addEventListener("DOMContentLoaded", init);

function sampleVars() {
  return Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v.key, v.sample]));
}

async function init() {
  try {
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Hazır Yanıtlar",
      activePage: "reply-templates",
      profile: session,
      isAdmin: true,
      content: `
        <div class="sv2-section">
          <div class="sv2-section-header">
            <h3>Hazır Yanıt Şablonları</h3>
            ${canWrite(session, "admin") ? `<button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-template">
              <i class="fas fa-plus"></i> Yeni Şablon
            </button>` : ""}
          </div>
          <div class="sv2-section-body">
            <div class="sv2-alert sv2-alert-warning" id="template-help" role="note">
              <i class="fas fa-info-circle" aria-hidden="true"></i>
              <span>Şablonlar talep sayfasındaki yanıt kutusunda <strong>"Şablon ekle"</strong> ile kullanılır; metin eklendikten sonra göndermeden önce düzenlenebilir.
              Değişkenler: ${TEMPLATE_VARIABLES.map((v) => `<code>{${escapeHtml(v.key)}}</code> (${escapeHtml(v.label)})`).join(", ")}.
              ${canWrite(session, "admin") ? "" : "Şablonları yalnızca Süper Admin ve Destek Atayıcı değiştirebilir."}</span>
            </div>
            <div id="templates-table"></div>
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
    templates = sortTemplates(await ParlaDb.getAllReplyTemplates());
    renderTable();
  } catch (err) {
    handleLoadError(err, "Şablonlar yüklenemedi");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-template")?.addEventListener("click", () => openFormModal(null));
}

function activeToggle(id, isActive) {
  const writable = canWrite(session, "admin");
  return `<label class="sv2-switch" title="${writable ? "Durum" : "Durumu yalnızca yönetici değiştirebilir"}">
    <input type="checkbox" class="tpl-toggle" data-id="${escapeHtml(id)}" aria-label="Şablon durumu"${isActive !== false ? " checked" : ""}${writable ? "" : " disabled"}>
    <span class="sv2-switch-slider"></span>
  </label>`;
}

function renderTable() {
  const el = document.getElementById("templates-table");
  if (!el) return;
  const writable = canWrite(session, "admin");
  el.innerHTML = renderDataTable({
    emptyMessage: "Henüz hazır yanıt şablonu yok.",
    columns: [
      { key: "sort_order", label: "SIRA" },
      { key: "title", label: "BAŞLIK" },
      { key: "category", label: "KATEGORİ", render: (v) => escapeHtml(v || "—") },
      {
        key: "body",
        label: "METİN",
        render: (v) => {
          const text = String(v || "");
          return `<span title="${escapeHtml(text)}">${escapeHtml(text.length > 90 ? `${text.slice(0, 87)}…` : text)}</span>`;
        },
      },
      { key: "is_active", label: "AKTİF", render: (_, r) => activeToggle(r.id, r.is_active) },
      {
        key: "actions",
        label: "İŞLEMLER",
        render: (_, r) =>
          writable
            ? `<div class="sv2-actions">
              <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-secondary btn-edit" data-id="${escapeHtml(r.id)}"><i class="fas fa-edit"></i> Düzenle</button>
              <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-danger btn-delete" data-id="${escapeHtml(r.id)}"><i class="fas fa-trash"></i> Sil</button>
            </div>`
            : "—",
      },
    ],
    rows: templates.map((t) => ({ ...t, id: t.id || t.template_id })),
  });

  el.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = templates.find((x) => (x.id || x.template_id) === btn.dataset.id);
      if (t) openFormModal(t);
    });
  });
  el.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = templates.find((x) => (x.id || x.template_id) === btn.dataset.id);
      if (t) confirmDelete(t);
    });
  });
  el.querySelectorAll(".tpl-toggle").forEach((input) => {
    input.addEventListener("change", () => toggleActive(input.dataset.id, input.checked));
  });
}

function formBody(data) {
  const d = data || {};
  return `
    <form id="template-form" novalidate>
      <div class="sv2-form-group">
        <label for="tf-title">Başlık *</label>
        <input type="text" id="tf-title" value="${escapeHtml(d.title || "")}" maxlength="${TEMPLATE_LIMITS.title}" required>
        <div class="sv2-field-error" id="err-title" hidden></div>
      </div>
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="tf-category">Kategori</label>
          <input type="text" id="tf-category" value="${escapeHtml(d.category || "")}" maxlength="${TEMPLATE_LIMITS.category}" placeholder="Örn. Karşılama, Bilgi talebi">
          <div class="sv2-field-error" id="err-category" hidden></div>
        </div>
        <div class="sv2-form-group">
          <label for="tf-order">Sıra</label>
          <input type="number" id="tf-order" min="0" max="100000" step="1" value="${escapeHtml(String(d.sort_order ?? 0))}">
          <div class="sv2-field-error" id="err-sort_order" hidden></div>
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="tf-body">Metin *</label>
        <textarea id="tf-body" rows="8" maxlength="${TEMPLATE_LIMITS.body}" required>${escapeHtml(d.body || "")}</textarea>
        <div class="sv2-field-error" id="err-body" hidden></div>
        <div class="sv2-mt-1" id="tf-vars" style="display:flex;gap:0.35rem;flex-wrap:wrap">
          ${TEMPLATE_VARIABLES.map((v) => `<button type="button" class="sv2-chip tf-var" data-var="${escapeHtml(v.key)}" title="${escapeHtml(v.label)}">{${escapeHtml(v.key)}}</button>`).join("")}
        </div>
      </div>
      <div class="sv2-form-group">
        <label><input type="checkbox" id="tf-active"${d.is_active === false ? "" : " checked"}> Aktif (yanıt kutusunda listelenir)</label>
      </div>
      <div class="sv2-form-group">
        <label>Önizleme (örnek verilerle)</label>
        <pre id="tf-preview" style="white-space:pre-wrap;margin:0;padding:0.6rem;background:var(--sv2-gray-100);border-radius:var(--sv2-radius-sm);max-height:160px;overflow:auto"></pre>
      </div>
    </form>`;
}

function openFormModal(tpl) {
  const isEdit = !!tpl;
  const modalId = "template-modal";
  renderModal(modalId, {
    title: isEdit ? "Şablonu Düzenle" : "Yeni Şablon",
    body: formBody(tpl),
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="${modalId}">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="template-save">${isEdit ? "Güncelle" : "Kaydet"}</button>`,
  });
  openModal(modalId);

  const bodyEl = document.getElementById("tf-body");
  const previewEl = document.getElementById("tf-preview");
  const updatePreview = () => {
    // textContent: önizleme asla HTML olarak yorumlanmaz
    previewEl.textContent = renderReplyTemplate(bodyEl.value, sampleVars());
  };
  bodyEl.addEventListener("input", updatePreview);
  updatePreview();

  document.querySelectorAll("#tf-vars .tf-var").forEach((btn) => {
    btn.addEventListener("click", () => {
      const token = `{${btn.dataset.var}}`;
      const start = bodyEl.selectionStart ?? bodyEl.value.length;
      const end = bodyEl.selectionEnd ?? bodyEl.value.length;
      bodyEl.value = bodyEl.value.slice(0, start) + token + bodyEl.value.slice(end);
      bodyEl.focus();
      bodyEl.selectionStart = bodyEl.selectionEnd = start + token.length;
      updatePreview();
    });
  });

  document.getElementById("template-save")?.addEventListener("click", () => saveTemplate(tpl ? tpl.id || tpl.template_id : ""));
}

function showErrors(errors) {
  ["title", "category", "sort_order", "body"].forEach((f) => {
    const el = document.getElementById(`err-${f}`);
    if (!el) return;
    el.hidden = !errors[f];
    el.textContent = errors[f] || "";
  });
}

async function saveTemplate(editId) {
  const input = {
    title: document.getElementById("tf-title")?.value,
    body: document.getElementById("tf-body")?.value,
    category: document.getElementById("tf-category")?.value,
    sort_order: document.getElementById("tf-order")?.value,
  };
  const check = validateTemplateInput(input);
  showErrors(check.errors);
  if (!check.valid) return;
  const isActive = !!document.getElementById("tf-active")?.checked;

  showLoading(true);
  try {
    const actor = { uid: session.uid, first_name: session.first_name, last_name: session.last_name };
    if (editId) {
      await ParlaDb.updateReplyTemplate(editId, { ...check.value, is_active: isActive }, actor);
      await ParlaDb.logActivity("updated", "reply_template", editId, check.value.title, "Hazır yanıt şablonu güncellendi", actor);
      toast("Şablon güncellendi.", "success");
    } else {
      const created = await ParlaDb.createReplyTemplate({ ...check.value, is_active: isActive }, actor);
      await ParlaDb.logActivity("created", "reply_template", created.id, check.value.title, "Hazır yanıt şablonu oluşturuldu", actor);
      toast("Şablon oluşturuldu.", "success");
    }
    closeModal("template-modal");
    await loadData();
  } catch (err) {
    handleError(err, "Şablon kaydedilemedi");
  } finally {
    showLoading(false);
  }
}

async function toggleActive(id, isActive) {
  showLoading(true);
  try {
    await ParlaDb.updateReplyTemplate(id, { is_active: isActive }, session);
    toast(isActive ? "Şablon aktif." : "Şablon pasif.", "success");
    await loadData();
  } catch (err) {
    handleError(err, "Durum güncellenemedi");
    renderTable();
  } finally {
    showLoading(false);
  }
}

function confirmDelete(tpl) {
  renderConfirmDialog(`"${tpl.title}" şablonu silinecek. Devam edilsin mi?`, async () => {
    showLoading(true);
    try {
      const id = tpl.id || tpl.template_id;
      await ParlaDb.deleteReplyTemplate(id);
      await ParlaDb.logActivity("deleted", "reply_template", id, tpl.title, "Hazır yanıt şablonu silindi", session);
      toast("Şablon silindi.", "success");
      await loadData();
    } catch (err) {
      handleError(err, "Silme başarısız");
    } finally {
      showLoading(false);
    }
  });
}
