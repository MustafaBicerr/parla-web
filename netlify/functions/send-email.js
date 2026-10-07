/**
 * Parla BT Destek — Resend üzerinden e-posta gönderimi.
 *
 * Güvenlik modeli (WP-04):
 *  - Her POST isteği geçerli bir Firebase ID token (Authorization: Bearer ...) taşımalıdır; pasif hesaplar reddedilir.
 *  - İÇERİĞİ VE ALICIYI SUNUCU BELİRLER. İstemciden yalnızca `type`, `ticketData.ticket_id`, `to` (istek/ayıklanır),
 *    `extra.message_id` / `extra.history_id` ve `requestId` alınır. `note`, `portalUrl`, `loginUrl`, `password`, `name`
 *    gibi alanlar YOK SAYILIR: metin veritabanındaki mesaj/geçmiş kaydından, bağlantılar SITE_URL'den gelir.
 *  - İzinli alıcılar: destek kutusu (CONTACT_EMAIL / "@support"), talebin atama kayıtlarındaki adresler ("@assigned"),
 *    çağıranın kendi adresi ve — yalnızca çağıran PERSONEL ise — talep sahibi (`v2/users/<user_id>/email`, yoksa
 *    `ticket.user_email`) ve aktif personel adresleri. Müşteri kaynaklı `ticket.user_email` müşteri çağrılarında güvenilmez.
 *  - Geçersiz/yetkisiz alıcılar ayıklanır; kalanlara gönderilir (`partial`, `skipped:[{code}]`; adres sızdırılmaz).
 *  - Hız sınırı (kullanıcı + talep), günlük kota (Resend ücretsiz ≈100/gün), olay tekilleştirme: bkz. lib/email-guard.js.
 *  - İç hata ayrıntıları ve altyapı bilgisi (RESEND_API_KEY vb.) istemciye dönmez; yalnızca yönetici rolleri `detail` alır.
 *
 * Ortam değişkenleri: bkz. .env.example (RESEND_API_KEY zorunlu; diğerleri isteğe bağlı).
 */
const { BRAND, buildEmail, truncateText, singleLine } = require("../lib/email-templates");
const { HttpError, verifyIdToken, rtdbGet, isSafeKey } = require("../lib/firebase-auth");
const { getGuardStore } = require("../lib/guard-store");
const guard = require("../lib/email-guard");
const { failure, resendRequest, describeResendError } = require("../lib/resend");
const crypto = require("crypto");
const { getAdmin } = require("../lib/admin");
const { createResolver, tokenDb, withFallback } = require("../lib/recipients");

// Netlify Blobs (hız sınırı/kota/tekilleştirme deposu). Yerelde kurulu olmayabilir: bellek deposuna düşülür.
let blobsModule = null;
try {
  blobsModule = require("@netlify/blobs");
} catch {
  /* @netlify/blobs yok: bellek deposu */
}

const STAFF_ROLES = new Set(["super_admin", "service_admin", "project_manager", "consultant"]);
const ADMIN_ROLES = new Set(["super_admin", "service_admin"]);

/** Ticket olayları: "participant" = ticket'a erişimi olan herkes, "staff" = yalnızca personel/yönetici */
const TICKET_TYPES = {
  ticket_created: "participant",
  ticket_message: "participant",
  ticket_reopened: "participant", // müşteri kapanışı reddedip talebi yeniden açar
  ticket_closed: "participant", // müşteri kapanışı onaylar ya da personel kapatır
  ticket_assigned: "staff",
  ticket_status_changed: "staff",
  ticket_resolved: "staff",
  ticket_close_approval: "staff",
  send_to_customer: "staff",
  // Bileşik olaylar (WP-05): alıcılar `to` içinden DEĞİL, sunucuda atama/öncelik geçmişinden türetilir.
  ticket_assignment_changed: "staff",
  ticket_priority_critical: "staff",
};
/** Alıcıları sunucunun türettiği bileşik olaylar. */
const DERIVED_TYPES = new Set(["ticket_assignment_changed", "ticket_priority_critical"]);

/**
 * Durum bildirimleri yalnızca gerçek ticket durumuyla tutarlıysa gönderilir; böylece "participant"
 * tiplerini kullanan bir müşteri, talep o durumda değilken sahte "kapandı/yeniden açıldı" maili üretemez.
 */
const REQUIRED_STATUS = {
  ticket_resolved: "resolved",
  ticket_closed: "closed",
  ticket_reopened: "reopened",
  ticket_close_approval: "pending_close",
  send_to_customer: "waiting_customer",
};
const ADMIN_TYPES = new Set(["user_credentials", "test_email", "diagnostic"]);
/** Atama e-postası gönderilen kişiye kısa süre aynı talepte "durum güncellendi" e-postası gitmez (EML-28). */
const ASSIGN_MARKER_TTL_MS = 5 * 60 * 1000;

/** Notu geçmiş (ticket_history) kaydından türetilen olaylar. */
const HISTORY_NOTE_TYPES = new Set([
  "ticket_status_changed",
  "ticket_resolved",
  "ticket_closed",
  "ticket_close_approval",
  "ticket_reopened",
  "send_to_customer",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const MAX_EMAIL_LENGTH = 254;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_RECIPIENTS = 10;
const MAX_REQUESTED = 25;
const TOTAL_BUDGET_MS = 8500; // Netlify varsayılan 10 sn bütçesi içinde kalmak için
const RECENT_MS = 10 * 60 * 1000; // `message_id` gönderilmeyen eski istemciler için "son kayıt" penceresi

const DEFAULT_ORIGIN_HOSTS = [
  "parlabilgiteknolojileri.net",
  "www.parlabilgiteknolojileri.net",
  "parla-bt-web.web.app",
  "parla-bt-web.firebaseapp.com",
];
const DEV_ORIGIN_HOSTS = ["localhost", "127.0.0.1"];

/** Netlify (Lambda) üretim çalışma zamanında mı? Yerelde/testte localhost kaynağına izin verilir. */
function isProduction() {
  const e = process.env;
  if (e.ALLOW_LOCALHOST_ORIGIN === "1" || e.NETLIFY_DEV === "true") return false;
  return Boolean(
    e.AWS_LAMBDA_FUNCTION_NAME ||
      e.AWS_EXECUTION_ENV ||
      e.LAMBDA_TASK_ROOT ||
      ["production", "deploy-preview", "branch-deploy"].includes(String(e.CONTEXT || ""))
  );
}

function contactEmail() {
  return String(process.env.CONTACT_EMAIL || BRAND.fromEmail).trim().toLowerCase();
}

/** Geliştirme/testte (Netlify dışı) hız/kota varsayılanları gevşetilir; RATE_LIMIT_MODE=strict ile zorlanır. */
function guardLimits() {
  const relaxed = !isProduction() && String(process.env.RATE_LIMIT_MODE || "").toLowerCase() !== "strict";
  return guard.getLimits(process.env, { relaxed });
}

/** E-postalardaki bağlantıların kökü: yalnızca SITE_URL (https) ya da marka adresi. İstemci `portalUrl` yok sayılır. */
function siteUrl() {
  const raw = String(process.env.SITE_URL || "").trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (!url.username && !url.password) {
        if (url.protocol === "https:") return url.origin;
        if (url.protocol === "http:" && !isProduction() && DEV_ORIGIN_HOSTS.includes(url.hostname)) return url.origin;
      }
    } catch {
      /* geçersiz SITE_URL: marka adresine düş */
    }
  }
  return BRAND.siteUrl;
}

function privacyUrl() {
  const raw = String(process.env.PRIVACY_URL || "").trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(raw) ? raw : "";
}

function allowedHosts() {
  const extra = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean);
  const hosts = [...DEFAULT_ORIGIN_HOSTS, ...extra];
  try {
    hosts.push(new URL(siteUrl()).hostname.toLowerCase());
  } catch {
    /* yok say */
  }
  if (!isProduction()) hosts.push(...DEV_ORIGIN_HOSTS);
  return hosts;
}

/** Tam eşleşme: `*.netlify.app` gibi joker YOK (deploy önizlemeleri için ALLOWED_ORIGINS'e açıkça ekleyin). */
function isAllowedHost(host) {
  return allowedHosts().includes(String(host || "").toLowerCase());
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

function respond(event, statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(event),
      ...(extraHeaders || {}),
    },
    body: statusCode === 204 ? "" : JSON.stringify(body),
  };
}

function normEmail(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function validEmail(email) {
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email);
}

/** Eski/basit kullanım için: geçerli, tekil, en çok 10 adres (bozuk olanlar sessizce atılır). */
function normalizeRecipients(to) {
  const list = Array.isArray(to) ? to : String(to || "").split(",");
  const unique = [...new Set(list.map(normEmail).filter(Boolean))];
  return unique.filter(validEmail).slice(0, MAX_RECIPIENTS);
}

function clip(value, max) {
  return Array.from(String(value == null ? "" : value)).slice(0, max).join("");
}

function requestIdFor(body, type, discriminator) {
  const raw = String(body.requestId || "").trim();
  const base = raw || `${type}/${discriminator || "na"}/${Date.now()}`;
  return base.slice(0, 200);
}

function assertBudget(ctx) {
  if (Date.now() - ctx.started > TOTAL_BUDGET_MS) {
    throw failure(504, "İşlem zaman aşımına uğradı. Lütfen tekrar deneyin.", "timeout");
  }
}

async function sendWithResend(ctx, { to, subject, html, text, replyTo, idempotencyKey, tags }) {
  assertBudget(ctx);
  const { response, data } = await resendRequest(ctx.apiKey, "/emails", {
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
    const info = describeResendError(response.status, data, response);
    console.error("[send-email] Resend hatası", {
      status: response.status,
      name: data && data.name,
      message: data && data.message,
    });
    if (info.duplicate) return { id: null, duplicate: true };
    if (info.code === "daily_quota") await guard.saturateQuota(ctx.store, ctx.limits);
    throw failure(info.status, info.message, info.code, { detail: info.detail, retryAfter: info.retryAfter });
  }
  return data;
}

async function runDiagnostic(ctx) {
  const { apiKey } = ctx;
  const result = {
    configured: true,
    from: BRAND.fromEmail,
    domain: BRAND.fromEmail.split("@")[1],
    domain_status: "unknown",
    note: "",
    quota: await guard.getQuota(ctx.store, ctx.limits),
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
  } catch {
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
      if (p && p.is_active !== false && p.email) emails.add(normEmail(p.email));
    });
  }
  return emails;
}

/** Sunucu tarafı alıcı çözümleyici: Admin yapılandırılmışsa onunla (kuralları atlar, güncel personel adresleri), değilse çağıranın token'ıyla. */
function resolverFor(ctx) {
  if (!ctx.resolver) {
    const state = getAdmin();
    const base = tokenDb(ctx.token);
    ctx.resolver = createResolver(state.ok ? withFallback(state.admin.db, base) : base);
  }
  return ctx.resolver;
}

const hashEmail = (email) => crypto.createHash("sha256").update(String(email)).digest("hex").slice(0, 16);
const assignMarkerKey = (ticketId, email) => `asgn:${ticketId}:${hashEmail(email)}`;

async function markAssigned(ctx, ticketId, emails) {
  await Promise.all(emails.map((e) => ctx.store.set(assignMarkerKey(ticketId, e), { at: Date.now() }, { ttlMs: ASSIGN_MARKER_TTL_MS })));
}

/** db_denied dışındaki hatalar (ağ, 5xx) yukarı fırlar; yetki reddi `fallback` döndürür. */
async function readOr(fallback, promiseFn) {
  try {
    return await promiseFn();
  } catch (err) {
    if (err && err.code === "db_denied") return fallback;
    throw err;
  }
}

const NODE_KEY_SORT = (a, b) => (a < b ? 1 : a > b ? -1 : 0); // push anahtarları kronolojik: büyük = yeni

async function recentEntries(ctx, path) {
  const data = await readOr(null, () =>
    rtdbGet(path, ctx.token, { query: { orderBy: '"$key"', limitToLast: 5 } })
  );
  if (!data || typeof data !== "object") return [];
  return Object.keys(data)
    .sort(NODE_KEY_SORT)
    .slice(0, 5)
    .map((key) => ({ key, value: data[key] }))
    .filter((e) => e.value && typeof e.value === "object");
}

function isRecent(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && Math.abs(Date.now() - ms) <= RECENT_MS;
}

function attachmentsLine(list) {
  // RTDB REST listeleri dizi ya da {"0":…,"1":…} nesnesi olarak döndürebilir.
  const items = Array.isArray(list) ? list : list && typeof list === "object" ? Object.values(list) : [];
  const names = items
    .slice(0, 3)
    .map((a) => singleLine(a && a.name).slice(0, 100))
    .filter(Boolean);
  return names.length ? `\n\nEkler: ${names.join(", ")}` : "";
}

/**
 * Bildirim metnini VERİTABANINDAN türetir (istemci `note` alanı yok sayılır).
 *  - ticket_message: `extra.message_id` (yoksa çağıranın son 10 dk içindeki son herkese açık mesajı)
 *  - durum olayları: `extra.history_id` (yoksa çağıranın son 10 dk içindeki son `status_note` kaydı)
 *  - ticket_created: talep açıklaması
 * Kayıt çağıranın kendisine ait değilse ya da dahili ise metin eklenmez.
 */
async function deriveContent(ctx, ticket, ticketId, type, extra) {
  const empty = { note: "", authorName: "", at: "", eventRef: "" };

  if (type === "ticket_created") {
    return {
      note: String(ticket.description || ""),
      authorName: String(ticket.user_name || ""),
      at: String(ticket.created_at || ""),
      eventRef: "",
    };
  }

  if (type === "ticket_message") {
    let found = null;
    const explicit = String(extra.message_id || "").trim();
    if (explicit) {
      if (isSafeKey(explicit)) {
        const m = await readOr(null, () => rtdbGet(`v2/ticket_messages/${ticketId}/${explicit}`, ctx.token));
        if (m && typeof m === "object") found = { key: explicit, value: m };
      }
    } else {
      const list = await recentEntries(ctx, `v2/ticket_messages/${ticketId}`);
      found = list.find((e) => isRecent(e.value.created_at)) || null;
    }
    if (!found) return empty;
    const m = found.value;
    if (m.user_id !== ctx.uid || m.is_internal === true || typeof m.message !== "string") {
      console.warn("[send-email] mesaj kaydı çağırana ait değil/dahili; not eklenmedi", { uid: ctx.uid, type });
      return empty;
    }
    return {
      note: `${m.message}${attachmentsLine(m.attachments)}`,
      authorName: String(m.author_name || ""),
      at: String(m.created_at || ""),
      eventRef: `msg:${found.key}`,
    };
  }

  if (HISTORY_NOTE_TYPES.has(type)) {
    let found = null;
    const explicit = String(extra.history_id || "").trim();
    if (explicit) {
      if (isSafeKey(explicit)) {
        const h = await readOr(null, () => rtdbGet(`v2/ticket_history/${ticketId}/${explicit}`, ctx.token));
        if (h && typeof h === "object") found = { key: explicit, value: h };
      }
    } else {
      const list = await recentEntries(ctx, `v2/ticket_history/${ticketId}`);
      found = list.find((e) => e.value.action === "status_note" && isRecent(e.value.changed_at)) || null;
    }
    if (!found) return empty;
    const h = found.value;
    if (h.changed_by_uid !== ctx.uid || h.action !== "status_note" || typeof h.note !== "string") {
      console.warn("[send-email] geçmiş kaydı çağırana ait değil; not eklenmedi", { uid: ctx.uid, type });
      return empty;
    }
    return {
      note: h.note,
      authorName: String(h.changed_by_name || ""),
      at: String(h.changed_at || ""),
      eventRef: `hist:${found.key}`,
    };
  }

  return empty;
}

/** Olay tekilleştirme anahtarı (yoksa null: yalnızca hız sınırı/idempotency geçerli). */
function dedupeKeyFor(type, ticket, content) {
  if (type === "ticket_created") return "created";
  if (type === "ticket_closed") return `closed:${ticket.closed_at || content.eventRef || ticket.updated_at || ""}`;
  if (type === "ticket_reopened") return `reopened:${ticket.reopened_at || content.eventRef || ticket.updated_at || ""}`;
  if (content.eventRef) return content.eventRef;
  return null;
}

async function enforceRate(ctx, ticketId) {
  const isStaff = STAFF_ROLES.has(ctx.profile.role);
  const windows = isStaff ? ctx.limits.staff : ctx.limits.customer;
  const user = await guard.consumeRate(ctx.store, "u", ctx.uid, windows);
  if (!user.ok) {
    throw failure(429, "Çok sık istek gönderildi. Lütfen biraz bekleyin.", "rate_limited_user", {
      retryAfter: user.retryAfter,
    });
  }
  if (ticketId) {
    const t = await guard.consumeRate(ctx.store, "t", ticketId, ctx.limits.ticket);
    if (!t.ok) {
      throw failure(429, "Bu talep için çok sık bildirim isteği gönderildi. Lütfen biraz bekleyin.", "rate_limited_ticket", {
        retryAfter: t.retryAfter,
      });
    }
  }
}

/**
 * Tek bir kitle grubuna (müşteri ya da personel) e-posta teslimi: tekilleştirme (claim) → kota → şablon → Resend → tamamla/iade.
 * @returns {Promise<{state: "sent"|"deduped"|"deferred"|"failed", id?: string|null, error?: Error}>}
 */
async function deliverGroup(ctx, job) {
  const { type, audience, group, base, claimKey, requestId, ticket } = job;
  const priority = guard.priorityOf(type);
  if (claimKey && (await guard.claimEvent(ctx.store, claimKey, requestId)) === "duplicate") {
    console.warn("[send-email] yinelenen olay atlandı", { uid: ctx.uid, type });
    return { state: "deduped" };
  }

  const quota = await guard.reserveQuota(ctx.store, ctx.limits, group.length, priority);
  if (!quota.ok) {
    if (priority === "low") {
      await guard.recordDeferred(ctx.store, {
        event: type,
        audience,
        ticket_number: clip(ticket.ticket_number, 60),
        title: truncateText(singleLine(ticket.title), 60).text,
        at: new Date().toISOString(),
      });
      if (claimKey) await guard.completeEvent(ctx.store, claimKey, { deferred: true });
      console.warn("[send-email] günlük yumuşak kota aşıldı; özete ertelendi", { uid: ctx.uid, type });
      return { state: "deferred" };
    }
    if (claimKey) await guard.releaseEvent(ctx.store, claimKey);
    console.warn("[send-email] günlük sert kota aşıldı", { uid: ctx.uid, type });
    return { state: "failed", error: failure(429, "Günlük e-posta kotası doldu.", "daily_quota", { retryAfter: quota.retryAfter }) };
  }

  const built = buildEmail(type, { ...base, ...(job.extra || {}), event: type, audience });
  if (built.error) {
    await guard.refundQuota(ctx.store, group.length);
    if (claimKey) await guard.releaseEvent(ctx.store, claimKey);
    throw new HttpError(400, built.error, "template_error");
  }
  try {
    const result = await sendWithResend(ctx, {
      to: group,
      subject: built.subject,
      html: built.html,
      text: built.text,
      replyTo: built.replyTo,
      idempotencyKey: `${requestId}:${job.idempotencySuffix || audience}`.slice(0, 256),
      tags: [
        { name: "category", value: type.slice(0, 50) },
        { name: "app", value: "support-v2" },
      ],
    });
    if (result && result.duplicate) await guard.refundQuota(ctx.store, group.length);
    if (claimKey) await guard.completeEvent(ctx.store, claimKey);
    return { state: "sent", id: (result && result.id) || null };
  } catch (err) {
    // Resend "kota doldu" dediyse sayaç doldurulmuştur (sendWithResend); iade edilmez.
    if (!(err && err.code === "daily_quota")) await guard.refundQuota(ctx.store, group.length);
    if (claimKey) await guard.releaseEvent(ctx.store, claimKey);
    return { state: "failed", error: err };
  }
}

/** Birden çok teslim işini sırayla çalıştırır ve sonuçları tek yanıt biçiminde toplar. */
async function runJobs(ctx, jobs, skipped) {
  const sent = [];
  const deduped = [];
  const deferred = [];
  let fail = null;
  for (const job of jobs) {
    const r = await deliverGroup(ctx, job);
    if (r.state === "sent") {
      sent.push({ audience: job.audience, id: r.id });
      if (job.onSent) await job.onSent();
    } else if (r.state === "deduped") deduped.push(job.audience);
    else if (r.state === "deferred") deferred.push(job.audience);
    else fail = fail || r.error;
  }
  if (fail) {
    fail.partial = sent.length > 0 || deferred.length > 0 || deduped.length > 0;
    fail.sent = sent;
    throw fail;
  }
  if (!sent.length && !deduped.length && deferred.length) {
    throw failure(429, "Günlük e-posta kotası doldu; bildirim günlük özete eklendi.", "daily_quota", {
      deferred: true,
      retryAfter: guard.secondsToNextDay(),
    });
  }
  return { sent, deduped, deferred, skipped: skipped || [] };
}

const lowerTr = (v) => singleLine(v).toLocaleLowerCase("tr");

/** Çağıranın son 10 dk içindeki geçmiş kayıtları (en yeni önce). Atama/öncelik bildirimleri bunlardan türetilir. */
async function recentOwnHistory(ctx, ticketId) {
  const data = await readOr(null, () =>
    rtdbGet(`v2/ticket_history/${ticketId}`, ctx.token, { query: { orderBy: '"$key"', limitToLast: 40 } })
  );
  if (!data || typeof data !== "object") return [];
  return Object.keys(data)
    .sort(NODE_KEY_SORT)
    .map((key) => ({ key, value: data[key] }))
    .filter((e) => e.value && typeof e.value === "object" && e.value.changed_by_uid === ctx.uid && isRecent(e.value.changed_at));
}

/**
 * Atama değişimi (SEN-08, EML-14, EML-28): kim eklendi / kim çıkarıldı / birincil değişti — son geçmiş kayıtlarından ve güncel
 * atamalardan türetilir. Çıkarılan danışman: adı geçmişte, kaydı artık atamalarda yok; ad tekil eşleşmezse bildirim yapılmaz.
 */
async function deriveAssignmentChange(ctx, ticket, ticketId) {
  const entries = (await recentOwnHistory(ctx, ticketId)).filter((e) =>
    ["assignment_added", "assignment_removed", "assigned_to_changed"].includes(e.value.action)
  );
  if (!entries.length) return null;
  const anchor = entries.map((e) => e.key).sort().pop();
  const resolver = resolverFor(ctx);
  const current = await resolver.assigned(ticketId, ticket);
  const currentPids = new Set(current.map((a) => a.pid));
  const addedNames = new Set();
  const removedNames = new Set();
  entries.forEach(({ value: v }) => {
    if (v.action === "assignment_added") addedNames.add(lowerTr(v.new_value));
    else if (v.action === "assignment_removed") removedNames.add(lowerTr(v.old_value));
    else {
      if (v.new_value) addedNames.add(lowerTr(v.new_value));
      if (v.old_value) removedNames.add(lowerTr(v.old_value));
    }
  });
  const added = current.filter((a) => addedNames.has(lowerTr(a.name)));

  const people = await resolver.personnelMap();
  const byName = new Map();
  Object.entries(people).forEach(([pid, p]) => {
    if (!p || typeof p !== "object") return;
    const key = lowerTr([p.first_name, p.last_name].filter(Boolean).join(" "));
    if (!key) return;
    byName.set(key, [...(byName.get(key) || []), { pid, p }]);
  });
  const removed = [];
  removedNames.forEach((name) => {
    const hits = byName.get(name) || [];
    if (hits.length !== 1) return;
    const { pid, p } = hits[0];
    const email = normEmail(p.email);
    if (currentPids.has(pid) || p.is_active === false || !validEmail(email)) return;
    removed.push({ pid, email });
  });
  const primaryChanged = entries.some((e) => e.value.action === "assigned_to_changed");
  return { anchor, added, removed, primaryChanged, assigneeName: clip(ticket.assigned_to_name, 120) };
}

/** Bileşik olaylar: alıcılar sunucuda türetilir (istemci `to` listesi yalnızca tetikleyicidir). */
async function handleDerivedEvent(ctx, ticket, ticketId, base, parties) {
  const { type } = ctx;
  const { self, support, ownerEmail } = parties;
  const requestId = requestIdFor(ctx.body, type, ticketId);
  const none = { sent: [], deduped: [], deferred: [], skipped: [{ code: "no_change" }] };
  const jobs = [];
  const common = { type: "", audience: "staff", base, requestId, ticket };

  if (type === "ticket_assignment_changed") {
    const change = await deriveAssignmentChange(ctx, ticket, ticketId);
    if (!change) return none;
    const tag = `evt:${ticketId}:asg:${change.anchor}`;
    const added = change.added.map((a) => a.email).filter((e) => e !== self);
    if (added.length) {
      jobs.push({
        ...common,
        type: "ticket_assigned",
        group: added,
        claimKey: `${tag}:added`,
        idempotencySuffix: "added",
        onSent: () => markAssigned(ctx, ticketId, added),
      });
    }
    const removed = change.removed.map((r) => r.email).filter((e) => e !== self);
    if (removed.length) {
      jobs.push({
        ...common,
        type: "ticket_unassigned",
        group: removed,
        claimKey: `${tag}:removed`,
        idempotencySuffix: "removed",
        extra: { assignee_name: change.assigneeName },
      });
    }
    // Müşteriye "danışman atandı": yalnızca birincil danışman değiştiğinde, atama başına TEK e-posta (kota dostu).
    if (change.primaryChanged && String(ticket.assigned_to_id || "").trim() && ownerEmail && ownerEmail !== self) {
      jobs.push({
        ...common,
        type: "consultant_assigned",
        audience: "customer",
        group: [ownerEmail],
        claimKey: `${tag}:customer`,
        idempotencySuffix: "customer",
        extra: { assignee_name: change.assigneeName },
      });
    }
  } else {
    if (String(ticket.priority || "").toLowerCase() !== "critical") {
      throw new HttpError(409, "Talep önceliği bu bildirimle uyuşmuyor.", "priority_mismatch");
    }
    const entries = (await recentOwnHistory(ctx, ticketId)).filter(
      (e) => e.value.action === "priority_changed" && String(e.value.new_value || "").toLowerCase() === "critical"
    );
    if (!entries.length) return none;
    let group = (await resolverFor(ctx).assigned(ticketId, ticket)).map((a) => a.email).filter((e) => e !== self);
    if (!group.length && support && support !== self) group = [support];
    if (group.length) {
      jobs.push({ ...common, type: "ticket_priority_critical", group, claimKey: `evt:${ticketId}:crit:${entries[0].key}:staff`, idempotencySuffix: "crit" });
    }
  }
  if (!jobs.length) return none;
  return runJobs(ctx, jobs, []);
}

async function handleTicketEvent(ctx) {
  const { type, body, token, uid, authEmail, profile } = ctx;
  const kind = TICKET_TYPES[type];
  const isStaff = STAFF_ROLES.has(profile.role);
  if (kind === "staff" && !isStaff) {
    throw new HttpError(403, "Bu bildirimi gönderme yetkiniz yok.", "role_denied");
  }

  const ticketData = body.ticketData && typeof body.ticketData === "object" ? body.ticketData : {};
  const extra = body.extra && typeof body.extra === "object" ? body.extra : {};
  const ticketId = String(ticketData.ticket_id || "").trim();
  if (!isSafeKey(ticketId)) {
    throw new HttpError(400, "Geçerli bir ticket kimliği gerekli.", "bad_ticket_id");
  }

  await enforceRate(ctx, ticketId);

  // Kullanıcının token'ı ile okunur: RTDB kuralları erişimi zaten sınırlar.
  const ticket = await rtdbGet(`v2/tickets/${ticketId}`, token);
  if (!ticket || typeof ticket !== "object") {
    throw new HttpError(404, "Talep bulunamadı.", "ticket_not_found");
  }

  const requiredStatus = REQUIRED_STATUS[type];
  if (requiredStatus && String(ticket.status || "").toLowerCase() !== requiredStatus) {
    throw new HttpError(409, "Talep durumu bu bildirimle uyuşmuyor.", "status_mismatch");
  }

  // --- Alıcı çözümleme ------------------------------------------------------------------------------------------
  const support = contactEmail();
  const self = validEmail(authEmail) ? authEmail : "";
  let ownerEmail = "";
  const storedUserEmail = normEmail(ticket.user_email);
  if (isStaff) {
    // Personel çağrısında talep sahibi: kullanıcı profilindeki adres (müşterinin yazabildiği `user_email` değil).
    ownerEmail = storedUserEmail;
    if (isSafeKey(ticket.user_id)) {
      const profileEmail = normEmail(await readOr("", () => rtdbGet(`v2/users/${ticket.user_id}/email`, token)));
      if (validEmail(profileEmail)) ownerEmail = profileEmail;
    }
    if (!validEmail(ownerEmail)) ownerEmail = "";
  } else {
    ownerEmail = self; // müşteri tarafı gönderici: yalnızca kendi adresi "talep sahibi" kitlesidir
  }

  const base = {
    ticket_id: ticketId,
    ticket_number: clip(ticket.ticket_number, 60),
    title: clip(ticket.title, 300),
    status: clip(ticket.status, 40),
    priority: clip(ticket.priority, 20),
    company_name: clip(ticket.company_name, 200),
    user_name: clip(ticket.user_name, 120),
    note: "",
    author_name: "",
    at: "",
    portalUrl: siteUrl(),
    privacyUrl: privacyUrl(),
  };

  if (DERIVED_TYPES.has(type)) {
    return handleDerivedEvent(ctx, ticket, ticketId, base, { self, support, ownerEmail });
  }

  const allowed = new Set([support]);
  if (ownerEmail) allowed.add(ownerEmail);
  if (self) allowed.add(self);

  const requestedRaw = Array.isArray(body.to) ? body.to : String(body.to || "").split(",");
  const requested = [...new Set(requestedRaw.slice(0, MAX_REQUESTED).map(normEmail).filter(Boolean))];

  // Atanmış danışmanlar: güncel personel adresi (Admin varsa) + atama kaydı kopyası; kayıt yoksa `assigned_to_id` yedeği (EML-16).
  let assignedInfo = null;
  const assignedList = async () => {
    if (!assignedInfo) assignedInfo = await resolverFor(ctx).assigned(ticketId, ticket);
    return assignedInfo;
  };
  const assigned = async () => new Set((await assignedList()).flatMap((a) => [a.email, a.recordEmail].filter(Boolean)));
  /** Eskimiş kopya adres → güncel personel adresi. */
  const currentAddress = async (email) => {
    const hit = (await assignedList()).find((a) => a.recordEmail === email);
    return hit ? hit.email : email;
  };
  let personnelEmails = null;
  const personnel = async () => {
    if (!personnelEmails) personnelEmails = await collectPersonnelEmails(token);
    return personnelEmails;
  };

  const recipients = [];
  const skipped = [];
  const push = (email) => {
    if (!recipients.includes(email)) recipients.push(email);
  };
  for (const item of requested) {
    if (item === "@support") {
      push(support);
    } else if (item === "@owner") {
      if (ownerEmail) push(ownerEmail);
      else skipped.push({ code: "not_allowed" });
    } else if (item === "@assigned") {
      (await assignedList()).forEach((a) => validEmail(a.email) && push(a.email));
    } else if (item === "@assigners") {
      if (isStaff || type === "ticket_created") (await resolverFor(ctx).assigners()).forEach((e) => e !== self && push(e));
      else skipped.push({ code: "not_allowed" });
    } else if (!validEmail(item)) {
      skipped.push({ code: "invalid_address" });
    } else if (isStaff && ownerEmail && item === storedUserEmail && item !== ownerEmail) {
      // Talepte saklı (eski/sahte olabilen) adres = "talep sahibi" takma adıdır: e-posta profildeki GÜNCEL adrese gider.
      push(ownerEmail);
    } else if (allowed.has(item) || (await assigned()).has(item) || (isStaff && (await personnel()).has(item))) {
      push(await currentAddress(item));
    } else {
      skipped.push({ code: "not_allowed" });
    }
  }
  // Yeni/atanmamış talep → Destek Atayıcılar da (yalnızca destek kutusuna giden personel bildirimine eklenir; WP-05, EML-34)
  if (type === "ticket_created" && recipients.includes(support) && !String(ticket.assigned_to_id || "").trim()) {
    try {
      (await resolverFor(ctx).assigners()).forEach((e) => e !== self && e !== ownerEmail && push(e));
    } catch {
      /* Atayıcılar çözülemedi: destek kutusu yine bilgilendirilir */
    }
  }
  if (recipients.length > MAX_RECIPIENTS) {
    recipients.length = MAX_RECIPIENTS;
    skipped.push({ code: "too_many" });
  }
  if (!recipients.length) {
    if (skipped.some((s) => s.code === "not_allowed")) {
      throw new HttpError(403, "Alıcı bu talebin muhatapları arasında değil.", "recipient_not_allowed");
    }
    throw new HttpError(400, "Geçerli alıcı bulunamadı.", "bad_recipients");
  }

  // EML-28: aynı dakikalarda "Size atanan talep" alan danışmana ayrıca "Durum güncellendi" gitmez.
  if (type === "ticket_status_changed") {
    for (const email of [...recipients]) {
      if (email !== ownerEmail && (await ctx.store.get(assignMarkerKey(ticketId, email)))) {
        recipients.splice(recipients.indexOf(email), 1);
      }
    }
    if (!recipients.length) return { sent: [], deduped: ["staff"], deferred: [], skipped };
  }

  // --- İçerik (veritabanından) ------------------------------------------------------------------------------------
  const content = await deriveContent(ctx, ticket, ticketId, type, extra);
  Object.assign(base, {
    note: content.note,
    author_name: clip(content.authorName, 120),
    at: content.at,
  });

  // Talep sahibi "customer", diğer herkes "staff" bağlantısı/metni alır.
  const groups = { customer: [], staff: [] };
  recipients.forEach((r) => groups[ownerEmail && r === ownerEmail ? "customer" : "staff"].push(r));

  const dedupeBase = dedupeKeyFor(type, ticket, content);
  const requestId = requestIdFor(body, type, ticketId);

  const jobs = [];
  for (const audience of ["customer", "staff"]) {
    const group = groups[audience];
    if (!group.length) continue;
    jobs.push({
      type,
      audience,
      group,
      base,
      ticket,
      requestId,
      claimKey: dedupeBase ? `evt:${ticketId}:${dedupeBase}:${audience}` : null,
      onSent: type === "ticket_assigned" && audience === "staff" ? () => markAssigned(ctx, ticketId, group) : null,
    });
  }
  return runJobs(ctx, jobs, skipped);
}

async function handleAdminType(ctx) {
  const { type, body, token, authEmail, profile, uid } = ctx;
  if (!ADMIN_ROLES.has(profile.role)) {
    throw new HttpError(403, "Bu işlem için yönetici yetkisi gerekli.", "role_denied");
  }

  if (type === "diagnostic") {
    return { diagnostic: await runDiagnostic(ctx) };
  }

  await enforceRate(ctx, "");

  let recipients;
  let data;
  if (type === "test_email") {
    if (!authEmail) throw new HttpError(400, "Hesabınızda e-posta adresi yok.", "no_email");
    recipients = [authEmail];
    data = { name: [profile.first_name, profile.last_name].filter(Boolean).join(" ") };
  } else {
    // user_credentials: parola GÖNDERİLMEZ; alıcı kayıtlı bir kullanıcı olmalı, ad profilden gelir.
    recipients = normalizeRecipients(body.to);
    if (recipients.length !== 1) {
      throw new HttpError(400, "Hesap bilgilendirmesi tek bir alıcıya gönderilebilir.", "bad_recipients");
    }
    const users = await rtdbGet("v2/users", token, { query: { orderBy: '"email"', equalTo: JSON.stringify(recipients[0]) } });
    const match =
      users && typeof users === "object"
        ? Object.values(users).find((u) => u && typeof u === "object" && normEmail(u.email) === recipients[0])
        : null;
    if (!match) throw new HttpError(404, "Alıcı kayıtlı bir kullanıcı değil.", "recipient_not_registered");
    if (match.is_active === false) throw new HttpError(409, "Kullanıcı hesabı aktif değil.", "inactive_recipient");
    data = {
      email: recipients[0],
      name: [match.first_name, match.last_name].filter(Boolean).join(" ").slice(0, 100),
    };
  }

  const quota = await guard.reserveQuota(ctx.store, ctx.limits, recipients.length, guard.priorityOf(type));
  if (!quota.ok) {
    throw failure(429, "Günlük e-posta kotası doldu.", "daily_quota", { retryAfter: quota.retryAfter });
  }

  const built = buildEmail(type, { ...data, portalUrl: siteUrl(), privacyUrl: privacyUrl() });
  if (built.error) {
    await guard.refundQuota(ctx.store, recipients.length);
    throw new HttpError(400, built.error, "template_error");
  }
  try {
    const result = await sendWithResend(ctx, {
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
    return { sent: [{ audience: "staff", id: (result && result.id) || null }], deduped: [], deferred: [], skipped: [] };
  } catch (err) {
    if (!(err && err.code === "daily_quota")) await guard.refundQuota(ctx.store, recipients.length);
    throw err;
  }
}

function bearerToken(event) {
  const headers = event.headers || {};
  const authHeader = String(headers.authorization || headers.Authorization || "");
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

/** GET: kimliksiz → yalnızca erişilebilirlik + destek adresi; yönetici token'ı → yapılandırma ve günlük kota. */
async function handleGet(event) {
  const payload = { success: true, service: "parla-email", contact: contactEmail() };
  const token = bearerToken(event);
  if (token) {
    try {
      const { uid } = await verifyIdToken(token);
      const profile = await loadProfile(uid, token);
      if (ADMIN_ROLES.has(profile.role)) {
        const store = getGuardStore(event, { blobs: blobsModule });
        payload.configured = Boolean(process.env.RESEND_API_KEY);
        payload.from = BRAND.fromEmail;
        payload.quota = await guard.getQuota(store, guardLimits());
      }
    } catch {
      /* geçersiz token: kimliksiz yanıt */
    }
  }
  return respond(event, 200, payload);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return respond(event, 204, {});
  }

  if (event.httpMethod === "GET") {
    return handleGet(event);
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
      message: "E-posta servisi şu an kullanılamıyor.",
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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return respond(event, 400, { success: false, message: "Geçersiz istek." });
  }

  const type = String(body.type || "").trim();
  const isTicketType = Object.prototype.hasOwnProperty.call(TICKET_TYPES, type);
  if (!isTicketType && !ADMIN_TYPES.has(type)) {
    return respond(event, 400, { success: false, code: "bad_type", message: "Geçersiz e-posta tipi." });
  }

  const ctx = { type, body, apiKey, started: Date.now(), uid: "", callerIsAdmin: false };
  try {
    const token = bearerToken(event);
    if (!token) {
      throw new HttpError(401, "Oturum bilgisi eksik. Lütfen yeniden giriş yapın.", "no_token");
    }

    const { uid, email: authEmail } = await verifyIdToken(token);
    ctx.uid = uid;
    ctx.token = token;
    ctx.authEmail = authEmail;
    ctx.profile = await loadProfile(uid, token);
    ctx.callerIsAdmin = ADMIN_ROLES.has(ctx.profile.role);
    ctx.store = getGuardStore(event, { blobs: blobsModule });
    ctx.limits = guardLimits();

    const outcome = isTicketType ? await handleTicketEvent(ctx) : await handleAdminType(ctx);

    if (outcome.diagnostic) {
      return respond(event, 200, { success: true, message: "Tanılama tamamlandı.", data: outcome.diagnostic });
    }
    const partial = outcome.skipped.length > 0 || outcome.deferred.length > 0;
    const firstSent = outcome.sent[0];
    return respond(event, 200, {
      success: true,
      partial,
      message: outcome.sent.length ? "E-posta gönderildi." : "Bildirim zaten gönderilmiş.",
      data: {
        id: firstSent ? firstSent.id : null,
        sent: outcome.sent,
        deduped: outcome.deduped,
        deferred: outcome.deferred.length,
        skipped: outcome.skipped,
      },
    });
  } catch (err) {
    const known = err instanceof HttpError;
    const status = known ? err.statusCode : 500;
    if (status >= 500) {
      console.error("[send-email] hata", { type, status, code: err.code, msg: err.message });
    } else {
      // Reddedilenler izlenebilsin (kişisel veri yok: yalnızca uid, tip, durum, kod).
      console.warn("[send-email] reddedildi", { uid: ctx.uid || null, type, status, code: err.code || "" });
    }
    const responseBody = {
      success: false,
      code: known ? err.code || "error" : "internal",
      partial: Boolean(err.partial),
      message: known ? err.message : "E-posta gönderilemedi.",
    };
    if (err.deferred) responseBody.deferred = true;
    if (err.retryAfter) responseBody.retry_after = err.retryAfter;
    if (err.detail && ctx.callerIsAdmin) {
      // Yönetici rolleri eyleme dönük ayrıntıyı görür (pano "Test e-postası"/"Durumu Kontrol Et" `message`'ı gösterir).
      responseBody.detail = err.detail;
      responseBody.message = err.detail;
    }
    const headers = err.retryAfter ? { "Retry-After": String(err.retryAfter) } : undefined;
    return respond(event, status, responseBody, headers);
  }
};

exports._internals = {
  normalizeRecipients,
  describeResendError,
  allowedOrigin,
  isAllowedHost,
  isProduction,
  siteUrl,
  contactEmail,
  privacyUrl,
  respond,
  corsHeaders,
  bearerToken,
  guardLimits,
  TICKET_TYPES,
  ADMIN_TYPES,
};
