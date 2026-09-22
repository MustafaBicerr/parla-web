/**
 * Parla BT Destek — Resend üzerinden e-posta gönderimi.
 * API anahtarı yalnızca RESEND_API_KEY ortam değişkeninden okunur.
 */
const { BRAND, buildEmail } = require("../lib/email-templates");

const ALLOWED_TYPES = new Set([
  "ticket_created",
  "ticket_assigned",
  "ticket_status_changed",
  "ticket_message",
  "ticket_resolved",
  "ticket_closed",
  "ticket_close_approval",
  "ticket_reopened",
  "send_to_customer",
  "user_credentials",
  "contact_form",
  "career_form",
  "idea_form",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function allowedOrigin(event) {
  const origin = String(event.headers.origin || event.headers.Origin || "").trim();
  const referer = String(event.headers.referer || event.headers.Referer || "").trim();
  const values = [origin, referer].filter(Boolean);
  if (!values.length) return true;
  return values.some((value) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return (
        host === "parlabilgiteknolojileri.net" ||
        host === "www.parlabilgiteknolojileri.net" ||
        host.endsWith(".netlify.app") ||
        host === "localhost" ||
        host === "127.0.0.1"
      );
    } catch {
      return false;
    }
  });
}

function normalizeRecipients(to) {
  const list = Array.isArray(to) ? to : String(to || "").split(",");
  const emails = list
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(emails)];
  if (!unique.length || unique.length > 10) return [];
  if (unique.some((email) => !EMAIL_RE.test(email))) return [];
  return unique;
}

function requestIdFrom(body, type, recipients) {
  const raw = String(body.requestId || "").trim();
  if (raw) return raw.slice(0, 256);
  const entity = body.ticketData?.ticket_id || body.ticketData?.ticket_number || recipients[0] || "na";
  return `${type}/${entity}/${Date.now()}`.slice(0, 256);
}

async function sendWithResend({ apiKey, to, subject, html, text, replyTo, idempotencyKey, tags }) {
  const payload = {
    from: `${BRAND.fromName} <${BRAND.fromEmail}>`,
    to,
    subject,
    html,
    text,
    reply_to: [replyTo || BRAND.fromEmail],
    tags,
  };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error("E-posta gönderilemedi.");
    if (response.status === 401 || response.status === 403) {
      err.message = "Resend API anahtarı veya gönderen alan adı doğrulanamadı.";
    } else if (response.status === 422 || response.status === 400) {
      err.message = "E-posta içeriği veya alıcı kabul edilmedi.";
    } else if (response.status === 429) {
      err.message = "E-posta servisi yoğun, lütfen tekrar deneyin.";
    }
    err.statusCode = response.status === 429 ? 429 : response.status >= 400 && response.status < 500 ? 400 : 502;
    throw err;
  }
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return json(204, {}, { Allow: "GET, POST, OPTIONS" });
  }

  if (event.httpMethod === "GET") {
    return json(200, {
      success: true,
      service: "parla-email",
      configured: Boolean(process.env.RESEND_API_KEY),
      from: BRAND.fromEmail,
    });
  }

  if (event.httpMethod !== "POST") {
    return json(405, { success: false, message: "Yalnızca POST kabul edilir." });
  }

  if (!allowedOrigin(event)) {
    return json(403, { success: false, message: "İstek kaynağı kabul edilmedi." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return json(500, {
      success: false,
      message: "E-posta servisi yapılandırılmamış (RESEND_API_KEY).",
    });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { success: false, message: "Geçersiz JSON." });
  }

  const type = String(body.type || "").trim();
  if (!ALLOWED_TYPES.has(type)) {
    return json(400, { success: false, message: "Geçersiz e-posta tipi." });
  }

  const recipients = normalizeRecipients(body.to);
  if (!recipients.length) {
    return json(400, { success: false, message: "Geçerli alıcı bulunamadı." });
  }

  const ticketData = body.ticketData && typeof body.ticketData === "object" ? body.ticketData : {};
  const extra = body.extra && typeof body.extra === "object" ? body.extra : {};
  const built = buildEmail(type, { ...ticketData, ...extra });
  if (built.error) {
    return json(400, { success: false, message: built.error });
  }

  try {
    const result = await sendWithResend({
      apiKey,
      to: recipients,
      subject: built.subject,
      html: built.html,
      text: built.text,
      replyTo: built.replyTo,
      idempotencyKey: requestIdFrom(body, type, recipients),
      tags: [
        { name: "category", value: type.slice(0, 50) },
        { name: "app", value: "support-v2" },
      ],
    });

    return json(200, {
      success: true,
      message: "E-posta gönderildi.",
      data: { id: result.id || null },
    });
  } catch (err) {
    const status = err.statusCode || 502;
    return json(status, {
      success: false,
      message: err.message || "E-posta gönderilemedi.",
    });
  }
};
