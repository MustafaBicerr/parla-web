/**
 * Parla BT Destek — sunucu tarafı kullanıcı yönetimi (D-01 B; WP-08).
 *
 * POST /api/admin-users   { action, ... }   Authorization: Bearer <Firebase ID token>
 *   status        servis hesabı yapılandırılmış mı? ({configured:true,...}; yoksa 503 not_configured)
 *   create        yeni kullanıcı: Auth hesabı + profil TEK işlemde (hata olursa hesap geri alınır); parolasız davet ya da geçici şifre
 *   repair        yetim hesap (Auth'ta var, profil yok) için profili bağlar
 *   orphans       profilsiz Auth hesaplarını listeler
 *   update        profil düzenleme (rol matrisi, son süper admin / kendini kilitleme koruması)
 *   setActive     pasife alma (Auth devre dışı + oturum iptali) / aktive etme
 *   resetLink     şifre belirleme bağlantısı üretir ve e-postayla gönderir (parola ASLA e-postada yok)
 *   matchPersonnel danışman kullanıcısını e-postayla personel kaydına bağlar (personnel.uid + assigned_uids)
 *
 * Yalnızca aktif super_admin / service_admin çağırabilir. Servis hesabı (FIREBASE_SERVICE_ACCOUNT) yoksa 503 + `not_configured`
 * döner: istemci bunu "özellik kapalı" sayıp eski (istemci tarafı) akışa zarifçe geri döner.
 * Hata iletileri Türkçedir ve altyapı ayrıntısı sızdırmaz.
 */
const { HttpError, verifyIdToken } = require("../lib/firebase-auth");
const { getGuardStore } = require("../lib/guard-store");
const guard = require("../lib/email-guard");
const { getAdmin } = require("../lib/admin");
const core = require("../lib/admin-users-core");
const sendEmail = require("./send-email");

const { allowedOrigin, respond, bearerToken, guardLimits, siteUrl, privacyUrl } = sendEmail._internals;

let blobsModule = null;
try {
  blobsModule = require("@netlify/blobs");
} catch {
  /* @netlify/blobs yok: bellek deposu */
}

const MAX_BODY_BYTES = 16 * 1024;
const MANAGER_ROLES = new Set(["super_admin", "service_admin"]);
const ACTIONS = new Set(["status", "create", "repair", "orphans", "update", "setActive", "resetLink", "matchPersonnel"]);
/** Yönetici başına kayan pencere sınırı (kötüye kullanım/döngü koruması). */
const ADMIN_RATE = [
  { name: "minute", ms: 60 * 1000, max: 30 },
  { name: "hour", ms: 3600 * 1000, max: 300 },
];

function fail(event, status, code, message, extra) {
  return respond(event, status, { success: false, code, message, ...(extra || {}) });
}

exports.handler = async (event, context, deps) => {
  const injected = deps || {};
  if (event.httpMethod === "OPTIONS") return respond(event, 204, {});
  if (event.httpMethod !== "POST") return fail(event, 405, "method_not_allowed", "Yalnızca POST kabul edilir.");
  if (!allowedOrigin(event)) return fail(event, 403, "origin_denied", "İstek kaynağı kabul edilmedi.");
  if (String(event.body || "").length > MAX_BODY_BYTES) return fail(event, 413, "too_large", "İstek çok büyük.");

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return fail(event, 400, "bad_json", "Geçersiz JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(event, 400, "bad_request", "Geçersiz istek.");
  const action = String(body.action || "");
  if (!ACTIONS.has(action)) return fail(event, 400, "bad_action", "Geçersiz işlem.");

  let uid = "";
  try {
    const token = bearerToken(event);
    if (!token) throw new HttpError(401, "Oturum bilgisi eksik. Lütfen yeniden giriş yapın.", "no_token");
    const verified = await verifyIdToken(token, injected.fetchImpl ? { fetchImpl: injected.fetchImpl } : undefined);
    uid = verified.uid;

    const adminState = injected.admin ? { ok: true, admin: injected.admin } : getAdmin();
    if (!adminState.ok) {
      return fail(event, 503, "not_configured", "Sunucu tarafı kullanıcı yönetimi henüz yapılandırılmadı.");
    }
    const admin = adminState.admin;

    const profile = await admin.db.get(`v2/users/${uid}`);
    const role = String((profile && profile.role) || "").toLowerCase();
    if (!profile || profile.is_active === false || !MANAGER_ROLES.has(role)) {
      throw new HttpError(403, "Bu işlem için yönetici yetkisi gerekli.", "role_denied");
    }

    const store = injected.store || getGuardStore(event, { blobs: blobsModule });
    const rate = await guard.consumeRate(store, "adm", uid, ADMIN_RATE);
    if (!rate.ok) {
      return respond(event, 429, { success: false, code: "rate_limited_user", message: "Çok sık işlem yapıldı. Lütfen biraz bekleyin.", retry_after: rate.retryAfter }, { "Retry-After": String(rate.retryAfter) });
    }

    const ctx = {
      admin,
      caller: { uid, email: verified.email, role, name: [profile.first_name, profile.last_name].filter(Boolean).join(" ") || verified.email },
      store,
      limits: injected.limits || guardLimits(),
      apiKey: process.env.RESEND_API_KEY || "",
      siteUrl: siteUrl(),
      privacyUrl: privacyUrl(),
      now: injected.now || (() => Date.now()),
    };

    let data;
    if (action === "status") data = { configured: true, email_configured: Boolean(ctx.apiKey), role };
    else if (action === "create") data = await core.createUser(ctx, body);
    else if (action === "repair") data = await core.createUser(ctx, body, { repair: true });
    else if (action === "orphans") data = await core.listOrphans(ctx);
    else if (action === "update") data = await core.updateUser(ctx, body);
    else if (action === "setActive") data = await core.setActive(ctx, body);
    else if (action === "resetLink") data = await core.resetLink(ctx, body);
    else data = await core.matchPersonnel(ctx, body);

    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    return respond(event, 200, { success: true, action, data, warnings });
  } catch (err) {
    if (err instanceof core.UserError) {
      const extra = err.extra || {};
      return respond(event, err.status, {
        success: false,
        code: err.code,
        message: err.message,
        ...(extra.errors ? { errors: extra.errors } : {}),
        ...(extra.rolled_back !== undefined ? { rolled_back: extra.rolled_back } : {}),
      });
    }
    if (err instanceof HttpError) {
      return respond(event, err.statusCode, { success: false, code: err.code || "error", message: err.message });
    }
    // Altyapı/Auth hata metni istemciye dönmez.
    console.error("[admin-users] hata", { action, uid, code: err && err.code, msg: err && err.message });
    return respond(event, 500, { success: false, code: "internal", message: "İşlem tamamlanamadı. Lütfen tekrar deneyin." });
  }
};
