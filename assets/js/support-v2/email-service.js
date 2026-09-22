/**
 * Parla BT Ticket V2 — e-posta bildirim servisi (Netlify Function + Resend)
 */

function getEmailApiUrl() {
  const cfg = window.__PARLA_SITE_CONFIG || {};
  return cfg.EMAIL_API_URL || "/api/send-email";
}

function newRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function parseResponse(res) {
  const text = await res.text();
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STAFF_EVENTS = new Set(["ticket_assigned", "ticket_reopened"]);

function inferAudience(eventType, to) {
  const cfg = window.__PARLA_SITE_CONFIG || {};
  const contact = String(cfg.CONTACT_EMAIL || "info@parlabilgiteknolojileri.net").toLowerCase();
  const first = String(Array.isArray(to) ? to[0] : to || "").trim().toLowerCase();
  if (first && first === contact) return "staff";
  if (STAFF_EVENTS.has(eventType)) return "staff";
  return "customer";
}

const ParlaEmailService = {
  /**
   * @param {{ type: string, to: string|string[], ticketData?: object, extra?: object, requestId?: string }} params
   */
  async send(params) {
    const url = getEmailApiUrl();
    if (!url) {
      console.warn("ParlaEmailService: EMAIL_API_URL tanımlı değil.");
      return { success: false, message: "E-posta servisi yapılandırılmamış." };
    }

    const payload = {
      type: params.type || "",
      to: params.to,
      ticketData: params.ticketData || null,
      extra: params.extra || null,
      requestId: params.requestId || newRequestId(),
    };

    let lastError = { success: false, message: "E-posta gönderilemedi." };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await parseResponse(res);
        if (json.success === false) {
          lastError = {
            success: false,
            message: json.message || "E-posta gönderilemedi.",
          };
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            return lastError;
          }
        } else {
          return {
            success: true,
            message: json.message || "E-posta gönderildi.",
            data: json.data || null,
          };
        }
      } catch (err) {
        console.error("ParlaEmailService.send hatası:", err);
        lastError = {
          success: false,
          message: "E-posta gönderilirken bağlantı hatası oluştu.",
        };
      }
      await sleep(400 * 2 ** attempt);
    }

    return lastError;
  },

  /**
   * Ticket olayları için hazır bildirim şablonu
   */
  async notifyTicketEvent(eventType, to, ticket, extra) {
    extra = extra || {};
    const number = ticket?.ticket_number || ticket?.id || "";
    const title = ticket?.title || "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";

    return this.send({
      type: eventType,
      to,
      ticketData: {
        event: eventType,
        audience: extra.audience || inferAudience(eventType, to),
        ticket_id: ticket?.id || ticket?.ticket_id || extra.ticket_id || "",
        ticket_number: number,
        title,
        status: ticket?.status,
        priority: ticket?.priority,
        company_name: ticket?.company_name || extra.company_name || "",
        user_name: ticket?.user_name || extra.user_name || "",
        user_email: ticket?.user_email || extra.user_email || "",
        portalUrl: extra.portalUrl || origin,
        note: extra.note || "",
      },
    });
  },
};

export { ParlaEmailService };
export default ParlaEmailService;
