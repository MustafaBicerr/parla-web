/**
 * Parla BT Ticket V2 — paylaşılan yeni talep modalı (müşteri)
 */
import ParlaDb from "../firebase-client.js";
import ParlaEmailService from "../email-service.js";
import { validateTicketForm } from "../validators.js";
import {
  TICKET_TYPE_LABELS,
  PRIORITY_LABELS,
  SAP_MODULES,
  SAP_MODULE_LABELS,
  ROLES,
} from "../ticket-utils.js";
import {
  renderModal,
  openModal,
  closeModal,
  toast,
  showLoading,
  handleError,
} from "../ui-shell.js";

export const CREATE_TICKET_MODAL_ID = "sv2-create-ticket-modal";

const CUSTOMER_TICKET_TYPES = ["SUP", "ARZ", "BUG"];
let onTicketCreatedCallback = null;

function defaultTicketType(role) {
  return role === ROLES.ARIZI_CUSTOMER ? "ARZ" : "SUP";
}

function buildModalBody(session) {
  const defaultType = defaultTicketType(session.role);

  const typeOptions = CUSTOMER_TICKET_TYPES.map(
    (code) =>
      `<option value="${code}"${code === defaultType ? " selected" : ""}>${TICKET_TYPE_LABELS[code] || code}</option>`
  ).join("");

  const priorityOptions = Object.entries(PRIORITY_LABELS)
    .map(
      ([value, label]) =>
        `<option value="${value}"${value === "medium" ? " selected" : ""}>${label}</option>`
    )
    .join("");

  const moduleOptions = SAP_MODULES.map(
    (code) => `<option value="${code}">${SAP_MODULE_LABELS[code] || code}</option>`
  ).join("");

  return `
    <form id="sv2-create-ticket-form" novalidate>
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="sv2-ticket-type">Talep Tipi</label>
          <select id="sv2-ticket-type" name="ticket_type" required>${typeOptions}</select>
          <span class="sv2-field-error" id="sv2-err-ticket_type" hidden></span>
        </div>
        <div class="sv2-form-group">
          <label for="sv2-ticket-priority">Öncelik</label>
          <select id="sv2-ticket-priority" name="priority" required>${priorityOptions}</select>
          <span class="sv2-field-error" id="sv2-err-priority" hidden></span>
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-ticket-module">SAP Modülü</label>
        <select id="sv2-ticket-module" name="sap_module" required>${moduleOptions}</select>
        <span class="sv2-field-error" id="sv2-err-sap_module" hidden></span>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-ticket-title">Konu</label>
        <input type="text" id="sv2-ticket-title" name="title" maxlength="100" placeholder="Talebinizi kısaca özetleyin" required>
        <span class="sv2-field-error" id="sv2-err-title" hidden></span>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-ticket-description">Açıklama</label>
        <textarea id="sv2-ticket-description" name="description" rows="5" placeholder="Sorunu adım adım açıklayın, hata mesajlarını ve beklentinizi belirtin." required></textarea>
        <span class="sv2-field-error" id="sv2-err-description" hidden></span>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-ticket-attachment">Ek Dosya (Google Drive linki, isteğe bağlı)</label>
        <input type="url" id="sv2-ticket-attachment" name="attachment_url" placeholder="https://drive.google.com/...">
        <span class="sv2-field-error" id="sv2-err-attachment_url" hidden></span>
      </div>
    </form>`;
}

function clearFormErrors() {
  document.querySelectorAll("#sv2-create-ticket-form .sv2-form-group").forEach((g) => {
    g.classList.remove("has-error");
  });
  document.querySelectorAll("#sv2-create-ticket-form .sv2-field-error").forEach((el) => {
    el.hidden = true;
    el.textContent = "";
  });
}

function showFormErrors(errors) {
  clearFormErrors();
  Object.entries(errors).forEach(([field, message]) => {
    const errEl = document.getElementById(`sv2-err-${field}`);
    const input = document.querySelector(`#sv2-create-ticket-form [name="${field}"]`);
    if (errEl) {
      errEl.textContent = message;
      errEl.hidden = false;
    }
    if (input) {
      input.closest(".sv2-form-group")?.classList.add("has-error");
    }
  });
}

function getActor(session) {
  const name = [session.first_name, session.last_name].filter(Boolean).join(" ");
  return {
    uid: session.uid,
    name: name || session.email,
    email: session.email,
  };
}

export function mountCreateTicketModal(session) {
  renderModal(CREATE_TICKET_MODAL_ID, {
    title: "Yeni Destek Talebi",
    body: buildModalBody(session),
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="${CREATE_TICKET_MODAL_ID}">İptal</button>
      <button type="submit" form="sv2-create-ticket-form" class="sv2-btn sv2-btn-primary" id="sv2-create-ticket-submit">
        <i class="fas fa-paper-plane"></i> Talebi Gönder
      </button>`,
  });

  const form = document.getElementById("sv2-create-ticket-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormErrors();

    const data = {
      ticket_type: form.ticket_type.value,
      priority: form.priority.value,
      sap_module: form.sap_module.value,
      title: form.title.value.trim(),
      description: form.description.value.trim(),
      attachment_url: form.attachment_url.value.trim(),
    };

    const { valid, errors } = validateTicketForm(data);
    if (!valid) {
      showFormErrors(errors);
      return;
    }

    const submitBtn = document.getElementById("sv2-create-ticket-submit");
    submitBtn.disabled = true;
    showLoading(true);

    try {
      const actor = getActor(session);
      const customerCode =
        session.customer_code ||
        (await ParlaDb.getCompany(session.company_id))?.customer_code ||
        "";

      if (!customerCode) {
        toast("Müşteri kodu bulunamadı. Lütfen yöneticinizle iletişime geçin.", "error");
        return;
      }

      const ticket = await ParlaDb.createTicket(
        {
          ticket_type: data.ticket_type,
          priority: data.priority,
          sap_module: data.sap_module,
          title: data.title,
          description: data.description,
          attachment_url: data.attachment_url,
          customer_code: customerCode,
          company_id: session.company_id || "",
          company_name: session.company_name || "",
          user_id: session.uid,
          user_name: actor.name,
          user_email: session.email,
        },
        actor
      );

      await ParlaDb.logActivity(
        "ticket_created",
        "ticket",
        ticket.id,
        ticket.ticket_number,
        data.title,
        actor
      );

      const cfg = window.__PARLA_SITE_CONFIG || {};
      if (cfg.CONTACT_EMAIL) {
        ParlaEmailService.notifyTicketEvent("ticket_created", cfg.CONTACT_EMAIL, ticket, {
          note: `${actor.name} tarafından yeni talep oluşturuldu.`,
        }).catch(() => {});
      }

      closeModal(CREATE_TICKET_MODAL_ID);
      form.reset();
      toast("Talebiniz başarıyla oluşturuldu.", "success");

      onTicketCreatedCallback?.(ticket);
    } catch (err) {
      handleError(err, "Talep oluşturma");
    } finally {
      submitBtn.disabled = false;
      showLoading(false);
    }
  });
}

export function openCreateTicketModal() {
  openModal(CREATE_TICKET_MODAL_ID);
}

export function bindNewTicketButton(buttonId) {
  document.getElementById(buttonId)?.addEventListener("click", () => {
    openCreateTicketModal();
  });
}

export function initCreateTicketModal(session, onCreated) {
  onTicketCreatedCallback = onCreated || null;
  mountCreateTicketModal(session);
}
