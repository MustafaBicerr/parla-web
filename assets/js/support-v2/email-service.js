/**
 * Parla BT Ticket V2 — e-posta bildirim servisi (Netlify Function + Resend)
 *
 * Her istek giriş yapmış kullanıcının Firebase ID token'ını taşır; sunucu içeriği
 * (numara, başlık, durum...) veritabanından okur, alıcıları ticket muhataplarıyla sınırlar.
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
    return { success: false, message: "Boş yanıt", code: "empty_response" };
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
  // JSON değilse genelde HTML 404/500 sayfasıdır: fonksiyon bu sunucuda yayında değildir.
  return {
    success: false,
    code: res.status === 404 ? "endpoint_missing" : "bad_response",
    message:
      res.status === 404
        ? "E-posta servisi bu sitede bulunamadı (/api/send-email 404). Netlify function yayında mı?"
        : "Sunucu yanıtı işlenemedi.",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getIdToken(forceRefresh) {
  const user = window.__PARLA_FIREBASE?.auth?.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(!!forceRefresh);
  } catch {
    return null;
  }
}

/** Boş/yinelenen adresleri ve (varsa) işlemi yapan kişinin kendi adresini ayıklar. */
function uniqueEmails(list, excludeEmail) {
  const skip = String(excludeEmail || "").trim().toLowerCase();
  const seen = new Set();
  const out = [];
  (list || []).forEach((item) => {
    const email = String(item || "").trim().toLowerCase();
    if (!email || email === skip || seen.has(email)) return;
    seen.add(email);
    out.push(email);
  });
  return out;
}

const ParlaEmailService = {
  uniqueEmails,

  /**
   * @param {{ type: string, to: string|string[], ticketData?: object, extra?: object, requestId?: string }} params
   * @returns {Promise<{success: boolean, message: string, code?: string, partial?: boolean, data?: object}>}
   */
  async send(params) {
    const url = getEmailApiUrl();
    if (!url) {
      console.warn("ParlaEmailService: EMAIL_API_URL tanımlı değil.");
      return { success: false, code: "not_configured", message: "E-posta servisi yapılandırılmamış." };
    }

    let token = await getIdToken(false);
    if (!token) {
      return {
        success: false,
        code: "no_session",
        message: "Oturum bulunamadı; e-posta gönderilemedi. Lütfen yeniden giriş yapın.",
      };
    }

    const payload = {
      type: params.type || "",
      to: params.to,
      ticketData: params.ticketData || null,
      extra: params.extra || null,
      requestId: params.requestId || newRequestId(),
    };

    let lastError = { success: false, code: "unknown", message: "E-posta gönderilemedi." };
    let refreshed = false;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        const json = await parseResponse(res);

        if (res.status === 401 && !refreshed) {
          // Süresi dolmuş token olabilir: bir kez yenileyip tekrar dene.
          refreshed = true;
          token = (await getIdToken(true)) || token;
          continue;
        }

        if (json.success === false) {
          lastError = {
            success: false,
            code: json.code || "",
            partial: !!json.partial,
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
          code: "network",
          message: "E-posta gönderilirken bağlantı hatası oluştu.",
        };
      }
      await sleep(400 * 2 ** attempt);
    }

    return lastError;
  },

  /**
   * Ticket olayları için bildirim. `to` tek adres ya da dizi olabilir; sunucu talep sahibi ve
   * personel için ayrı (doğru bağlantılı) e-postalar üretir.
   */
  async notifyTicketEvent(eventType, to, ticket, extra) {
    extra = extra || {};
    const recipients = uniqueEmails(Array.isArray(to) ? to : [to]);
    if (!recipients.length) {
      return { success: true, message: "Alıcı yok; e-posta gönderilmedi.", data: { skipped: true } };
    }

    return this.send({
      type: eventType,
      to: recipients,
      ticketData: {
        ticket_id: ticket?.id || ticket?.ticket_id || extra.ticket_id || "",
        portalUrl: extra.portalUrl || (typeof window !== "undefined" ? window.location.origin : ""),
      },
      extra: { note: extra.note || "" },
    });
  },

  /** GET /api/send-email — sunucu yapılandırması (RESEND_API_KEY var mı?). */
  async health() {
    try {
      const res = await fetch(getEmailApiUrl(), { method: "GET" });
      const json = await parseResponse(res);
      if (json.success === false) return { reachable: false, configured: false, message: json.message };
      return { reachable: true, configured: !!json.configured, from: json.from || "" };
    } catch {
      return { reachable: false, configured: false, message: "E-posta servisine ulaşılamadı." };
    }
  },

  /** Resend alan adı doğrulama durumu (yalnızca admin rolleri). */
  async diagnose() {
    const res = await this.send({ type: "diagnostic", to: "diagnostic@invalid.local" });
    return res;
  },

  /** Giriş yapan yöneticinin kendi adresine test e-postası gönderir. */
  async sendTest() {
    const me = window.__PARLA_FIREBASE?.auth?.currentUser?.email || "";
    return this.send({ type: "test_email", to: me || "test@invalid.local" });
  },
};

export { ParlaEmailService, uniqueEmails };
export default ParlaEmailService;
