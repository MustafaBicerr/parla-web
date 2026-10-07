/**
 * Parla BT Ticket V2 — paylaşılan yeni talep modalı (müşteri)
 */
import ParlaDb from "../firebase-client.js";
import ParlaEmailService from "../email-service.js";
import { reportEmailResults } from "../email-report.js";
import { attachmentsNote, bindFilePicker, renderFilePicker, uploadAttachments } from "../attachments.js";
import { validateTicketForm, TICKET_LIMITS } from "../validators.js";
import {
  TICKET_TYPE_LABELS,
  PRIORITY_LABELS,
  SAP_MODULES,
  SAP_MODULE_LABELS,
  resolveCustomerType,
  allowedCustomerTicketTypes,
} from "../ticket-utils.js";
import {
  renderModal,
  openModal,
  closeModal,
  toast,
  showLoading,
  handleError,
  withInflight,
  withTimeout,
} from "../ui-shell.js";

export const CREATE_TICKET_MODAL_ID = "sv2-create-ticket-modal";

let onTicketCreatedCallback = null;
let createPicker = null;
let modalSession = null;

/**
 * Talep tipi kilidi (D-09 B): destek anlaşmalı (CUS) müşteri → SUP/BUG, arızi (ARC) müşteri → ARZ/BUG.
 * İlk seçenek varsayılandır (ARZ / SUP). Firma tipi (company_admin) firma kaydından gelir; yüklenene dek role göre.
 */
function typeOptionsHtml(customerType) {
  const allowed = allowedCustomerTicketTypes(customerType);
  return allowed
    .map((code, i) => `<option value="${code}"${i === 0 ? " selected" : ""}>${TICKET_TYPE_LABELS[code] || code}</option>`)
    .join("");
}

function buildModalBody(session) {
  const typeOptions = typeOptionsHtml(resolveCustomerType(session.role));

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
        <input type="text" id="sv2-ticket-title" name="title" maxlength="${TICKET_LIMITS.title}" placeholder="Talebinizi kısaca özetleyin" required>
        <span class="sv2-field-error" id="sv2-err-title" hidden></span>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-ticket-description">Açıklama</label>
        <textarea id="sv2-ticket-description" name="description" rows="5" maxlength="${TICKET_LIMITS.description}" placeholder="Sorunu adım adım açıklayın, hata mesajlarını ve beklentinizi belirtin." required></textarea>
        <span class="sv2-field-error" id="sv2-err-description" hidden></span>
      </div>
      <div class="sv2-form-group" role="group" aria-labelledby="sv2-create-files-label">
        <span class="sv2-label" id="sv2-create-files-label">Ekran Görüntüsü / Dosya (isteğe bağlı)</span>
        ${renderFilePicker("sv2-create")}
      </div>
      <div class="sv2-form-group">
        <label for="sv2-ticket-attachment">Ek Bağlantı (Google Drive vb., isteğe bağlı)</label>
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
  modalSession = session || modalSession;
  session = modalSession;
  renderModal(CREATE_TICKET_MODAL_ID, {
    persist: true, // kabuk (renderShell) yeniden çizilse de pencere yerinde kalır (MUS-02)
    title: "Yeni Destek Talebi",
    body: buildModalBody(session),
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="${CREATE_TICKET_MODAL_ID}">İptal</button>
      <button type="submit" form="sv2-create-ticket-form" class="sv2-btn sv2-btn-primary" id="sv2-create-ticket-submit">
        <i class="fas fa-paper-plane"></i> Talebi Gönder
      </button>`,
  });

  createPicker = bindFilePicker("sv2-create");
  // Firma tipi arızi (ARC) ise (ör. firma yöneticisi) tip listesi firma kaydına göre yeniden kurulur.
  if (session.company_id && String(session.role || "").toLowerCase() !== "arizi_customer") {
    ParlaDb.getCompany(session.company_id)
      .then((company) => {
        const select = document.getElementById("sv2-ticket-type");
        if (!select || !company) return;
        const type = resolveCustomerType(session.role, company.customer_type);
        if (type === "ARC") select.innerHTML = typeOptionsHtml(type);
      })
      .catch(() => {});
  }
  const form = document.getElementById("sv2-create-ticket-form");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    // Enter/Boşluk tekrarı ve hızlı çift tık tek talep üretir (UX-04, SEN-28).
    withInflight(document.getElementById("sv2-create-ticket-submit") || "create-ticket", () => submitTicket(form, session));
  });
}

async function submitTicket(form, session) {
  {
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
    const allowedTypes = Array.from(form.ticket_type.options).map((o) => o.value);
    if (!allowedTypes.includes(data.ticket_type)) {
      showFormErrors({ ticket_type: "Bu talep tipi firmanız için açılamaz." });
      return;
    }

    showLoading(true);

    try {
      // Dosyalar talep oluşturulmadan doğrulanır (hatalıysa talep açılmaz).
      const prepared = createPicker ? await createPicker.getPrepared() : [];
      if (prepared === null) return;

      const actor = getActor(session);
      const customerCode =
        session.customer_code ||
        (session.company_id ? (await ParlaDb.getCompany(session.company_id))?.customer_code : "") ||
        "";

      if (!customerCode) {
        toast("Müşteri kodu bulunamadı. Lütfen yöneticinizle iletişime geçin.", "error");
        return;
      }

      const ticket = await withTimeout(
        ParlaDb.createTicket(
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
        ),
        0,
        "Bağlantı yok ya da çok yavaş: talebiniz gönderilemedi. Bağlantı gelince Taleplerim listesini kontrol edin; talep oluşmadıysa yeniden deneyin."
      );

      await ParlaDb.logActivity(
        "ticket_created",
        "ticket",
        ticket.id,
        ticket.ticket_number,
        data.title,
        actor
      );

      let refs = [];
      if (prepared.length) {
        try {
          refs = await uploadAttachments(ticket.id, prepared, { session });
          await ParlaDb.addTicketMessage(ticket.id, {
            user_id: session.uid,
            author_name: actor.name,
            author_email: session.email,
            author_role: "customer",
            message: "Talebe ek dosya(lar) eklendi.",
            attachments: refs,
          });
        } catch (uploadErr) {
          toast("Talep oluşturuldu ancak dosyalar yüklenemedi; talep sayfasından yeniden ekleyebilirsiniz.", "warning");
        }
      }

      closeModal(CREATE_TICKET_MODAL_ID);
      form.reset();
      createPicker?.clear();
      toast("Talebiniz başarıyla oluşturuldu.", "success");

      // Müşteriye kayıt onayı + destek ekibine yeni talep bildirimi.
      // Gönderim sonucu beklenmez (arayüz bloklanmasın) ama başarısızlık raporlanır.
      const cfg = window.__PARLA_SITE_CONFIG || {};
      const notifications = [];
      if (cfg.CONTACT_EMAIL) {
        notifications.push(
          ParlaEmailService.notifyTicketEvent("ticket_created", cfg.CONTACT_EMAIL, ticket, {
            note: `${actor.name} tarafından yeni talep oluşturuldu.${attachmentsNote(refs)}`,
          })
        );
      }
      if (session.email) {
        notifications.push(ParlaEmailService.notifyTicketEvent("ticket_created", session.email, ticket));
      }
      Promise.all(notifications)
        .then((results) =>
          reportEmailResults(results, { eventType: "ticket_created", label: "Talep bildirimi", ticket, actor })
        )
        .catch(() => {});

      onTicketCreatedCallback?.(ticket);
    } catch (err) {
      handleError(err, "Talep oluşturma");
    } finally {
      showLoading(false);
    }
  }
}

/** Pencere DOM'dan düşmüşse (ör. başka bir sayfa çizimi) yeniden kurar; her durumda açar. */
export function openCreateTicketModal() {
  if (!document.getElementById(CREATE_TICKET_MODAL_ID)) {
    if (!modalSession) return false;
    mountCreateTicketModal(modalSession);
  }
  return openModal(CREATE_TICKET_MODAL_ID);
}

export function bindNewTicketButton(buttonId) {
  document.getElementById(buttonId)?.addEventListener("click", () => {
    openCreateTicketModal();
  });
}

export function initCreateTicketModal(session, onCreated) {
  onTicketCreatedCallback = onCreated || null;
  modalSession = session;
  mountCreateTicketModal(session);
}
