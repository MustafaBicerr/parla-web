/**
 * Parla BT Destek — Resend üzerinden e-posta gönderimi.
 *
 * Güvenlik modeli:
 *  - Her POST isteği geçerli bir Firebase ID token (Authorization: Bearer ...) taşımalıdır.
 *  - Gönderen kullanıcının profili RTDB'den (kendi token'ı ile) okunur; pasif hesaplar reddedilir.
 *  - Ticket maillerinde içerik (numara, başlık, durum...) istemciden değil veritabanından alınır;
 *    alıcılar yalnızca ticket'ın muhatapları (talep sahibi, personel, CONTACT_EMAIL) olabilir.
 *  - Personel/yönetici tipleri (atama, durum, kimlik bilgisi vb.) rol kontrolüne tabidir.
 *
 * Ortam değişkenleri: RESEND_API_KEY (zorunlu), CONTACT_EMAIL, ALLOWED_ORIGINS (virgüllü host listesi),
 * FIREBASE_PROJECT_ID, FIREBASE_DATABASE_URL.
 */
const { BRAND, buildEmail } = require("../lib/email-templates");
const { HttpError, verifyIdToken, rtdbGet, isSafeKey } = require("../lib/firebase-auth");

const STAFF_ROLES = new Set(["super_admin", "service_admin", "project_manager", "consultant"]);
const ADMIN_ROLES = new Set(["super_admin", "service_admin"]);

/** Ticket olayları: "participant" = ticket'a erişimi olan herkes, "staff" = yalnızca personel/yönetici */
const TICKET_TYPES = {
  ticket_created: "participant",
  ticket_message: "participant",
  ticket_reopened: "participant",
  ticket_assigned: "staff",
  ticket_status_changed: "staff",
  ticket_resolved: "staff",
  ticket_closed: "staff",
  ticket_close_approval: "staff",
  send_to_customer: "staff",
};
const ADMIN_TYPES = new Set(["user_credentials", "test_email", "diagnostic"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_NOTE_LENGTH = 2000;

const DEFAULT_ORIGIN_HOSTS = [
  "parlabilgiteknolojileri.net",
  "www.parlabilgiteknolojileri.net",
  "parla-bt-web.web.app",
  "parla-bt-web.firebaseapp.com",
  "localhost",
  "127.0.0.1",
];

function contactEmail() {
  return String(process.env.CONTACT_EMAIL || BRAND.fromEmail).trim().toLowerCase();
}

function allowedHosts() {
  const extra = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_ORIGIN_HOSTS, ...extra];
}

function isAllowedHost(host) {
  const h = String(host || "").toLowerCase();
  return allowedHosts().includes(h) || h.endsWith(".netlify.app");
}

function originOf(event) {
  const headers = event.headers || {};
  return String(headers.origin || headers.Origin || "").trim();
}

function allowedOrigin(event) {
  const headers = event.headers || {};
  const values = [originOf(event), String(headers.referer || headers.Referer || "").trim()].filter(Boolean);
  // Kimlik doğrulama zorunlu olduğundan Origin yokluğu (sunucudan sunucuya çağrı) tek başına red sebebi değil.
  if (!values.length) return true;
  return values.every((value) => {
    try {
      return isAllowedHost(new URL(value).hostname);
    } catch {
      return false;
    }
  });
}

function corsHeaders(event) {
  const origin = originOf(event);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  try {
    if (origin && isAllowedHost(new URL(origin).hostname)) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
  } catch {
    /* geçersiz origin: CORS başlığı eklenmez */
  }
  return headers;
}

function respond(event, statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(event),
    },
    body: statusCode === 204 ? "" : JSON.stringify(body),
  };
}

function normalizeRecipients(to) {
  const list = Array.isArray(to) ? to : String(to || "").split(",");
  const emails = list.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(emails)];
  if (!unique.length || unique.length > 10) return [];
  if (unique.some((email) => !EMAIL_RE.test(email))) return [];
  return unique;
}

function clip(value, max) {
  return String(value == null ? "" : value).slice(0, max);
}

/** portalUrl yalnızca izinli host'lara ait ise kabul edilir; aksi halde marka adresi kullanılır. */
function safePortalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      if (isAllowedHost(url.hostname)) return url.origin;
    }
  } catch {
    /* geçersiz URL */
  }
  return BRAND.siteUrl;
}

function requestIdFor(body, type, discriminator) {
  const raw = String(body.requestId || "").trim();
  const base = raw || `${type}/${discriminator || "na"}/${Date.now()}`;
  return base.slice(0, 256);
}

async function resendRequest(apiKey, path, init) {
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init && init.headers),
    },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

/** Resend hata yanıtını kullanıcıya gösterilebilir bir mesaja çevirir. */
function describeResendError(status, data) {
  const name = String((data && data.name) || "");
  const message = String((data && data.message) || "");

  if (/not verified|verify.*domain|domain.*not/i.test(message)) {
    return { code: "domain_not_verified", message: "Gönderen alan adı Resend'de doğrulanmamış (DNS kayıtlarını kontrol edin)." };
  }
  if (["missing_api_key", "invalid_api_key", "restricted_api_key"].includes(name) || status === 401) {
    return { code: name || "invalid_api_key", message: "Resend API anahtarı geçersiz veya yetkisiz." };
  }
  if (status === 403) {
    return { code: name || "forbidden", message: "Resend gönderimi reddetti (alan adı veya hesap yetkisi)." };
  }
  if (status === 429) {
    return { code: "rate_limited", message: "E-posta servisi yoğun, lütfen tekrar deneyin." };
  }
  if (status === 400 || status === 422) {
    return { code: name || "validation_error", message: "E-posta içeriği veya alıcı kabul edilmedi." };
  }
  return { code: name || "resend_error", message: "E-posta gönderilemedi." };
}

async function sendWithResend({ apiKey, to, subject, html, text, replyTo, idempotencyKey, tags }) {
  const { response, data } = await resendRequest(apiKey, "/emails", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      from: `${BRAND.fromName} <${BRAND.fromEmail}>`,
      to,
      subject,
      html,
      text,
      reply_to: [replyTo || BRAND.fromEmail],
      tags,
    }),
  });

  if (!response.ok) {
    const info = describeResendError(response.status, data);
    console.error("[send-email] Resend hatası", {
      status: response.status,
      name: data && data.name,
      message: data && data.message,
    });
    const err = new HttpError(
      response.status === 429 ? 429 : response.status >= 400 && response.status < 500 ? 400 : 502,
      info.message,
      info.code
    );
    throw err;
  }
  return data;
}

async function runDiagnostic(apiKey) {
  const result = {
    configured: true,
    from: BRAND.fromEmail,
    domain: BRAND.fromEmail.split("@")[1],
    domain_status: "unknown",
    note: "",
  };
  try {
    const { response, data } = await resendRequest(apiKey, "/domains", { method: "GET" });
    if (response.status === 401 || response.status === 403) {
      const name = String((data && data.name) || "");
      result.domain_status = "unknown";
      result.note =
        name === "restricted_api_key"
          ? "API anahtarı yalnızca gönderim yetkili; alan adı durumu okunamıyor (normal). Test e-postası ile doğrulayın."
          : "Resend API anahtarı geçersiz görünüyor (401/403).";
      result.key_valid = name === "restricted_api_key" ? true : false;
      return result;
    }
    if (!response.ok) {
      result.note = `Resend alan adı sorgusu başarısız (HTTP ${response.status}).`;
      return result;
    }
    result.key_valid = true;
    const list = Array.isArray(data && data.data) ? data.data : [];
    const domain = list.find((d) => String(d.name || "").toLowerCase() === result.domain);
    if (!domain) {
      result.domain_status = "missing";
      result.note = `${result.domain} Resend hesabında kayıtlı değil.`;
    } else {
      result.domain_status = String(domain.status || "unknown");
      if (result.domain_status !== "verified") {
        result.note = "Alan adı henüz doğrulanmamış: Resend panelinden SPF/DKIM kayıtlarını kontrol edin.";
      }
    }
  } catch (err) {
    result.note = "Resend'e ulaşılamadı.";
  }
  return result;
}

async function loadProfile(uid, token) {
  const profile = await rtdbGet(`v2/users/${uid}`, token);
  if (!profile || typeof profile !== "object") {
    throw new HttpError(403, "Kullanıcı profili bulunamadı.", "no_profile");
  }
  if (profile.is_active === false) {
    throw new HttpError(403, "Hesap aktif değil.", "inactive");
  }
  return { ...profile, role: String(profile.role || "").toLowerCase() };
}

async function collectPersonnelEmails(token) {
  const personnel = await rtdbGet("v2/personnel", token);
  const emails = new Set();
  if (personnel && typeof personnel === "object") {
    Object.values(personnel).forEach((p) => {
      if (p && p.is_active !== false && p.email) emails.add(String(p.email).trim().toLowerCase());
    });
  }
  return emails;
}

async function handleTicketEvent({ type, body, token, profile, apiKey }) {
  const kind = TICKET_TYPES[type];
  if (kind === "staff" && !STAFF_ROLES.has(profile.role)) {
    throw new HttpError(403, "Bu bildirimi gönderme yetkiniz yok.", "role_denied");
  }

  const ticketData = body.ticketData && typeof body.ticketData === "object" ? body.ticketData : {};
  const extra = body.extra && typeof body.extra === "object" ? body.extra : {};
  const ticketId = String(ticketData.ticket_id || "").trim();
  if (!isSafeKey(ticketId)) {
    throw new HttpError(400, "Geçerli bir ticket kimliği gerekli.", "bad_ticket_id");
  }

  const recipients = normalizeRecipients(body.to);
  if (!recipients.length) throw new HttpError(400, "Geçerli alıcı bulunamadı.", "bad_recipients");

  // Kullanıcının token'ı ile okunur: RTDB kuralları erişimi zaten sınırlar.
  const ticket = await rtdbGet(`v2/tickets/${ticketId}`, token);
  if (!ticket || typeof ticket !== "object") {
    throw new HttpError(404, "Ticket bulunamadı.", "ticket_not_found");
  }

  const customerEmail = String(ticket.user_email || "").trim().toLowerCase();
  const allowed = new Set([contactEmail()]);
  if (customerEmail) allowed.add(customerEmail);
  if (recipients.some((r) => !allowed.has(r))) {
    const personnelEmails = await collectPersonnelEmails(token);
    personnelEmails.forEach((e) => allowed.add(e));
  }
  const rejected = recipients.filter((r) => !allowed.has(r));
  if (rejected.length) {
    throw new HttpError(403, "Alıcı bu ticket'ın muhatapları arasında değil.", "recipient_not_allowed");
  }

  const base = {
    ticket_id: ticketId,
    ticket_number: ticket.ticket_number || "",
    title: ticket.title || "",
    status: ticket.status || "",
    priority: ticket.priority || "",
    company_name: ticket.company_name || "",
    user_name: ticket.user_name || "",
    note: clip(extra.note != null ? extra.note : ticketData.note, MAX_NOTE_LENGTH),
    portalUrl: safePortalUrl(ticketData.portalUrl),
  };

  // Talep sahibi "customer", diğer herkes "staff" bağlantısı/metni alır.
  const groups = { customer: [], staff: [] };
  recipients.forEach((r) => groups[r === customerEmail ? "customer" : "staff"].push(r));

  const sent = [];
  let failure = null;
  for (const audience of ["customer", "staff"]) {
    if (!groups[audience].length) continue;
    const built = buildEmail(type, { ...base, event: type, audience });
    if (built.error) throw new HttpError(400, built.error, "template_error");
    try {
      const result = await sendWithResend({
        apiKey,
        to: groups[audience],
        subject: built.subject,
        html: built.html,
        text: built.text,
        replyTo: built.replyTo,
        idempotencyKey: `${requestIdFor(body, type, ticketId)}:${audience}`.slice(0, 256),
        tags: [
          { name: "category", value: type.slice(0, 50) },
          { name: "app", value: "support-v2" },
        ],
      });
      sent.push({ audience, id: (result && result.id) || null });
    } catch (err) {
      failure = failure || err;
    }
  }

  if (failure) {
    failure.partial = sent.length > 0;
    failure.sent = sent;
    throw failure;
  }
  return { sent };
}

async function handleAdminType({ type, body, token, profile, uid, authEmail, apiKey }) {
  if (!ADMIN_ROLES.has(profile.role)) {
    throw new HttpError(403, "Bu işlem için yönetici yetkisi gerekli.", "role_denied");
  }

  if (type === "diagnostic") {
    return { diagnostic: await runDiagnostic(apiKey) };
  }

  let recipients;
  let data;
  if (type === "test_email") {
    if (!authEmail) throw new HttpError(400, "Hesabınızda e-posta adresi yok.", "no_email");
    recipients = [authEmail];
    data = { name: [profile.first_name, profile.last_name].filter(Boolean).join(" ") };
  } else {
    // user_credentials
    recipients = normalizeRecipients(body.to);
    if (recipients.length !== 1) {
      throw new HttpError(400, "Kimlik bilgisi tek bir alıcıya gönderilebilir.", "bad_recipients");
    }
    const t = body.ticketData && typeof body.ticketData === "object" ? body.ticketData : {};
    const password = String(t.password || "");
    if (!password || password.length > 128) {
      throw new HttpError(400, "Geçici şifre geçersiz.", "bad_password");
    }
    const portal = safePortalUrl(t.portalUrl);
    data = {
      email: recipients[0],
      password,
      name: clip(t.name, 100),
      portalUrl: portal,
      loginUrl: `${portal}/support-v2/login.html`,
    };
  }

  const built = buildEmail(type, data);
  if (built.error) throw new HttpError(400, built.error, "template_error");
  const result = await sendWithResend({
    apiKey,
    to: recipients,
    subject: built.subject,
    html: built.html,
    text: built.text,
    replyTo: built.replyTo,
    idempotencyKey: requestIdFor(body, type, uid),
    tags: [
      { name: "category", value: type.slice(0, 50) },
      { name: "app", value: "support-v2" },
    ],
  });
  return { sent: [{ audience: "staff", id: (result && result.id) || null }] };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return respond(event, 204, {});
  }

  if (event.httpMethod === "GET") {
    return respond(event, 200, {
      success: true,
      service: "parla-email",
      configured: Boolean(process.env.RESEND_API_KEY),
      auth: "firebase-id-token",
      from: BRAND.fromEmail,
    });
  }

  if (event.httpMethod !== "POST") {
    return respond(event, 405, { success: false, message: "Yalnızca POST kabul edilir." });
  }

  if (!allowedOrigin(event)) {
    return respond(event, 403, { success: false, code: "origin_denied", message: "İstek kaynağı kabul edilmedi." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[send-email] RESEND_API_KEY tanımlı değil.");
    return respond(event, 500, {
      success: false,
      code: "not_configured",
      message: "E-posta servisi yapılandırılmamış (RESEND_API_KEY).",
    });
  }

  if (String(event.body || "").length > MAX_BODY_BYTES) {
    return respond(event, 413, { success: false, message: "İstek çok büyük." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return respond(event, 400, { success: false, message: "Geçersiz JSON." });
  }

  const type = String(body.type || "").trim();
  const isTicketType = Object.prototype.hasOwnProperty.call(TICKET_TYPES, type);
  if (!isTicketType && !ADMIN_TYPES.has(type)) {
    return respond(event, 400, { success: false, code: "bad_type", message: "Geçersiz e-posta tipi." });
  }

  try {
    const headers = event.headers || {};
    const authHeader = String(headers.authorization || headers.Authorization || "");
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      throw new HttpError(401, "Oturum bilgisi eksik. Lütfen yeniden giriş yapın.", "no_token");
    }

    const { uid, email: authEmail } = await verifyIdToken(token);
    const profile = await loadProfile(uid, token);

    const outcome = isTicketType
      ? await handleTicketEvent({ type, body, token, profile, apiKey })
      : await handleAdminType({ type, body, token, profile, uid, authEmail, apiKey });

    if (outcome.diagnostic) {
      return respond(event, 200, { success: true, message: "Tanılama tamamlandı.", data: outcome.diagnostic });
    }
    return respond(event, 200, {
      success: true,
      message: "E-posta gönderildi.",
      data: { id: outcome.sent[0] ? outcome.sent[0].id : null, sent: outcome.sent },
    });
  } catch (err) {
    const status = err.statusCode || 502;
    if (status >= 500) console.error("[send-email] hata", { type, status, code: err.code, msg: err.message });
    return respond(event, status, {
      success: false,
      code: err.code || "error",
      partial: Boolean(err.partial),
      message: err.message || "E-posta gönderilemedi.",
    });
  }
};

exports._internals = { normalizeRecipients, safePortalUrl, describeResendError, allowedOrigin };
