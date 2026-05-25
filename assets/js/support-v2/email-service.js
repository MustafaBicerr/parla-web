/**
 * Parla BT Ticket V2 — e-posta bildirim servisi (Google Apps Script)
 */

function getScriptUrl() {
  const cfg = window.__PARLA_SITE_CONFIG || {};
  return cfg.GOOGLE_SCRIPT_URL || "";
}

function parseGasResponse(text) {
  if (!text) {
    return { success: false, message: "Boş yanıt" };
  }
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* ignore */
      }
    }
  }
  return { success: false, message: "Sunucu yanıtı işlenemedi." };
}

const ParlaEmailService = {
  /**
   * @param {{ type?: string, to: string|string[], subject: string, body: string, ticketData?: object }} params
   */
  async send(params) {
    const url = getScriptUrl();
    if (!url) {
      console.warn("ParlaEmailService: GOOGLE_SCRIPT_URL tanımlı değil.");
      return { success: false, message: "E-posta servisi yapılandırılmamış." };
    }

    const payload = {
      type: params.type || "support_v2_notify",
      to: params.to,
      subject: params.subject || "",
      body: params.body || "",
      ticketData: params.ticketData || null,
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      const json = parseGasResponse(text);

      if (json.success === false) {
        return {
          success: false,
          message: json.message || "E-posta gönderilemedi.",
        };
      }

      return {
        success: true,
        message: json.message || "E-posta gönderildi.",
        data: json.data || null,
      };
    } catch (err) {
      console.error("ParlaEmailService.send hatası:", err);
      return {
        success: false,
        message: "E-posta gönderilirken bağlantı hatası oluştu.",
      };
    }
  },

  /**
   * Ticket olayları için hazır bildirim şablonu
   */
  async notifyTicketEvent(eventType, to, ticket, extra) {
    extra = extra || {};
    const number = ticket?.ticket_number || ticket?.id || "";
    const title = ticket?.title || "";

    const subjects = {
      ticket_created: `Yeni Destek Talebi: ${number}`,
      ticket_assigned: `Size Atanan Görev: ${number}`,
      ticket_status_changed: `Talep Durumu Güncellendi: ${number}`,
      ticket_message: `Yeni Yanıt: ${number}`,
      ticket_resolved: `Talebiniz Çözüldü: ${number}`,
      ticket_closed: `Talep Kapatıldı: ${number}`,
    };

    const subject = extra.subject || subjects[eventType] || `Bildirim: ${number}`;
    let body =
      extra.body ||
      `Ticket: ${number}\nKonu: ${title}\n\n${extra.note || ""}`.trim();

    return this.send({
      type: "support_v2_notify",
      to,
      subject,
      body,
      ticketData: {
        event: eventType,
        ticket_number: number,
        title,
        status: ticket?.status,
        priority: ticket?.priority,
        ...extra,
      },
    });
  },
};

export { ParlaEmailService };
export default ParlaEmailService;
