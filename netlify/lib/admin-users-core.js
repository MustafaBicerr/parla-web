/**
 * Kullanıcı yönetimi çekirdeği (sunucu tarafı; D-01 B): Auth hesabı + profil TEK işlemde, geri alma, yetim hesap onarımı,
 * pasife alma (Auth devre dışı + oturum iptali), şifre belirleme bağlantısı, personel eşleştirme.
 *
 * Bağlam `ctx`:
 *   admin   — netlify/lib/admin.js arayüzü (servis hesabı; kuralları atlar)
 *   caller  — { uid, email, role, name }  (kimliği doğrulanmış, aktif super_admin | service_admin)
 *   store, limits, apiKey — e-posta koruma deposu / kota sınırları / Resend anahtarı (apiKey yoksa e-posta gönderilmez)
 *   siteUrl — e-posta bağlantılarının kökü (https)
 *   now     — () => ms (test saati)
 *
 * Güvenlik/tutarlılık ilkeleri:
 *   - Rol matrisi: super_admin her rolü atar/yönetir; service_admin YALNIZ müşteri rolleri + danışman + proje yöneticisi atar ve
 *     yalnız bu rollerdeki kullanıcıları yönetir (super_admin/service_admin atayamaz, onların profiline dokunamaz) — YON-05, SEC-09.
 *   - Kendini kilitleme yok (kendi hesabını pasife alma / rol değiştirme) ve SON aktif super_admin pasife alınamaz/düşürülemez — YON-06.
 *   - Parola ASLA e-postayla gitmez; parolasız davette kullanıcı bağlantıyla kendi şifresini belirler (must_change_password=false).
 *   - Hata iletileri Türkçe ve ayrıntı sızdırmaz (altyapı/Auth hata metni istemciye dönmez).
 */
const crypto = require("crypto");
const { sendServerEmail } = require("./mailer");

const ROLE_LABELS = {
  super_admin: "Süper Admin",
  service_admin: "Destek Atayıcı",
  project_manager: "Proje Yöneticisi",
  consultant: "Danışman",
  company_admin: "Firma Yöneticisi",
  customer: "Müşteri Kullanıcısı",
  arizi_customer: "Arızi Müşteri",
};
const ALL_ROLES = Object.keys(ROLE_LABELS);
const CUSTOMER_ROLES = ["company_admin", "customer", "arizi_customer"];
const STAFF_ROLES = ["super_admin", "service_admin", "project_manager", "consultant"];
const PERSONNEL_ROLES = ["consultant", "project_manager"];

/** Çağıran rol → atayabileceği/yönetebileceği roller. */
const ASSIGNABLE_ROLES = {
  super_admin: ALL_ROLES,
  service_admin: [...CUSTOMER_ROLES, "consultant", "project_manager"],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class UserError extends Error {
  constructor(code, message, status, extra) {
    super(message);
    this.code = code;
    this.status = status || 400;
    this.extra = extra || null;
  }
}

const normEmail = (v) => String(v == null ? "" : v).trim().toLowerCase();
const isCustomerRole = (r) => CUSTOMER_ROLES.includes(r);
const fullName = (u) => [u && u.first_name, u && u.last_name].filter(Boolean).join(" ").trim();
const clip = (v, n) => Array.from(String(v == null ? "" : v).trim()).slice(0, n).join("");

function canManage(callerRole, targetRole) {
  const list = ASSIGNABLE_ROLES[callerRole];
  return Boolean(list && list.includes(targetRole));
}

/** Telefon: boşluk/()-. temizlenir; "+" ile başlıyorsa 10–15 hane, değilse 10–15 hane. */
function normalizePhone(value) {
  const v = String(value == null ? "" : value).replace(/[\s()\-.]/g, "");
  if (!v) return "";
  return /^\+?\d{10,15}$/.test(v) ? v : null;
}

/** Parola ilkesi (validators.password ile aynı): ≥8, en az bir büyük harf (TR dahil), bir rakam. */
function passwordOk(value) {
  const v = String(value || "");
  return v.length >= 8 && v.length <= 128 && /[A-ZÇĞİÖŞÜ]/.test(v) && /[0-9]/.test(v);
}

/** Kullanıcıya gösterilmeyen, tahmin edilemez parola (parolasız davet): şifreyi kullanıcı bağlantıyla belirler. */
function randomPassword() {
  return `${crypto.randomBytes(18).toString("base64url")}aZ9`;
}

function setPasswordUrl(ctx, oobCode) {
  return `${ctx.siteUrl}/support-v2/auth-action.html?mode=resetPassword&oobCode=${encodeURIComponent(oobCode)}`;
}

const iso = (ctx) => new Date(ctx.now()).toISOString();

async function loadUsers(admin) {
  const all = await admin.db.get("v2/users");
  return all && typeof all === "object" ? all : {};
}

function profileByEmail(users, email) {
  const hit = Object.entries(users).find(([, u]) => u && normEmail(u.email) === email);
  return hit ? { uid: hit[0], profile: hit[1] } : null;
}

function activeSuperAdminCount(users, excludeUid) {
  return Object.entries(users).filter(([uid, u]) => uid !== excludeUid && u && u.role === "super_admin" && u.is_active !== false).length;
}

async function logActivity(ctx, action, entityId, entityLabel, details) {
  const key = ctx.admin.db.newKey();
  await ctx.admin.db.set(`v2/activities/${key}`, {
    activity_id: key,
    action,
    entity_type: "user",
    entity_id: entityId,
    entity_label: entityLabel || "",
    user_uid: ctx.caller.uid,
    user_name: ctx.caller.name || "",
    details: clip(details, 300),
    created_at: iso(ctx),
  });
}

/** Aktivite/e-posta gibi ikincil adımlar: hata `warnings` olarak döner, işlemi bozmaz (YON-07). */
async function secondary(warnings, code, message, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn("[admin-users] ikincil adım başarısız", { code, err: err && (err.code || err.message) });
    warnings.push({ code, message });
    return undefined;
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Doğrulama
// -------------------------------------------------------------------------------------------------------------------

function validateCreateInput(input, callerRole) {
  const errors = {};
  const out = {};
  out.email = normEmail(input.email);
  if (!out.email) errors.email = "E-posta adresi zorunludur.";
  else if (out.email.length > 254 || !EMAIL_RE.test(out.email)) errors.email = "Geçerli bir e-posta adresi giriniz.";

  out.first_name = clip(input.first_name, 100);
  out.last_name = clip(input.last_name, 100);
  if (!out.first_name) errors.first_name = "Ad alanı zorunludur.";
  if (!out.last_name) errors.last_name = "Soyad alanı zorunludur.";

  const phone = normalizePhone(input.phone);
  if (phone === null || phone === "") errors.phone = phone === "" ? "Telefon numarası zorunludur." : "Geçerli bir telefon numarası giriniz (en az 10 hane).";
  else out.phone = phone;

  out.role = String(input.role || "").trim();
  if (!ALL_ROLES.includes(out.role)) errors.role = "Geçersiz kullanıcı rolü.";
  else if (!canManage(callerRole, out.role)) errors.role = "Bu rolü atama yetkiniz yok.";

  out.company_id = String(input.company_id || "").trim();
  if (isCustomerRole(out.role) && !out.company_id) errors.company_id = "Müşteri kullanıcıları için firma seçimi zorunludur.";

  out.password = input.password == null ? "" : String(input.password);
  if (out.password && !passwordOk(out.password)) errors.password = "Şifre en az 8 karakter, 1 büyük harf ve 1 rakam içermelidir.";
  return { errors, value: out };
}

function fieldError(errors) {
  return new UserError("validation", "Form bilgilerini kontrol edin.", 400, { errors });
}

// -------------------------------------------------------------------------------------------------------------------
// Personel eşleştirme
// -------------------------------------------------------------------------------------------------------------------

async function linkPersonnel(ctx, uid, email) {
  const all = (await ctx.admin.db.get("v2/personnel")) || {};
  const matches = Object.entries(all).filter(([, p]) => p && normEmail(p.email) === email);
  if (!matches.length) return { status: "no_personnel" };
  if (matches.length > 1) return { status: "conflict" };
  const [pid, p] = matches[0];
  if (p.uid && p.uid !== uid) return { status: "uid_mismatch", personnel_id: pid };
  const patch = {};
  if (p.uid !== uid) patch[`personnel/${pid}/uid`] = uid;

  // Bu personele atanmış mevcut taleplerde danışman yazma yetkisi `assigned_uids` haritasına bağlıdır (D-08).
  const assignments = (await ctx.admin.db.get("v2/ticket_assignments")) || {};
  const tickets = (await ctx.admin.db.get("v2/tickets", { shallow: true })) || {};
  let touched = 0;
  for (const [tid, byPid] of Object.entries(assignments)) {
    if (!tickets[tid] || !byPid || !byPid[pid]) continue;
    patch[`tickets/${tid}/assigned_uids/${uid}`] = true;
    touched += 1;
  }
  if (Object.keys(patch).length) await ctx.admin.db.update("v2", patch);
  return { status: "linked", personnel_id: pid, tickets_updated: touched };
}

// -------------------------------------------------------------------------------------------------------------------
// E-posta (davet / sıfırlama)
// -------------------------------------------------------------------------------------------------------------------

async function issueLink(ctx, email) {
  const { oobCode } = await ctx.admin.auth.generatePasswordResetLink(email);
  if (!oobCode) throw new UserError("link_failed", "Şifre belirleme bağlantısı oluşturulamadı.", 502);
  return setPasswordUrl(ctx, oobCode);
}

/** Bağlantı e-postası. Kota doluysa/gönderilemezse `link` döner (yönetici güvenli kanaldan iletebilsin). */
async function emailLink(ctx, { type, email, name, link, idempotencyKey }) {
  if (!ctx.apiKey) return { status: "not_configured", link };
  const res = await sendServerEmail({
    store: ctx.store,
    limits: ctx.limits,
    apiKey: ctx.apiKey,
    type,
    priority: "high",
    to: [email],
    data: { email, name, setPasswordUrl: link, portalUrl: ctx.siteUrl, privacyUrl: ctx.privacyUrl || "" },
    idempotencyKey,
    now: ctx.now(),
  });
  if (res.status === "sent" || res.status === "duplicate") return { status: "sent" };
  return { status: res.status === "quota" ? "quota" : "failed", code: res.code || "", link };
}

// -------------------------------------------------------------------------------------------------------------------
// create / repair
// -------------------------------------------------------------------------------------------------------------------

/**
 * Yeni kullanıcı (ya da `repair`: Auth'ta var, profili olmayan yetim hesabı bağla).
 * input: { email, first_name, last_name, phone, role, company_id?, password?, dry_run?, send_invite? }
 *  - password verilmezse DAVET modu: şifre belirleme bağlantısı e-postayla gider, must_change_password=false.
 *  - password verilirse GEÇİCİ ŞİFRE modu: must_change_password=true; e-posta GİTMEZ (yönetici ilettiği için).
 */
async function createUser(ctx, input, options) {
  const repair = Boolean(options && options.repair);
  const { errors, value } = validateCreateInput(input, ctx.caller.role);
  if (Object.keys(errors).length) throw fieldError(errors);

  const users = await loadUsers(ctx.admin);
  if (profileByEmail(users, value.email)) {
    throw new UserError("email_in_use", "Bu e-posta adresi zaten kayıtlı.", 409, { errors: { email: "Bu e-posta adresi zaten kayıtlı." } });
  }

  // Personel/müşteri çakışması (aynı e-posta hem danışman hem müşteri olamaz)
  const personnelAll = (await ctx.admin.db.get("v2/personnel")) || {};
  const personnelHit = Object.values(personnelAll).some((p) => p && normEmail(p.email) === value.email);
  if (personnelHit && isCustomerRole(value.role)) {
    throw new UserError(
      "role_conflict",
      "Bu e-posta adresi bir danışman (personel) kaydına ait; müşteri kullanıcısı olarak eklenemez.",
      409,
      { errors: { email: "Bu e-posta adresi bir danışman (personel) kaydına ait." } }
    );
  }

  // Firma doğrulaması: müşteri rollerinde firma var olmalı ve aktif olmalı; ad/kod SUNUCUDA firma kaydından türetilir.
  let company = null;
  // `dry_run` + "__pending__": firma henüz yazılmadı (satır içi yeni firma); diğer tüm doğrulamalar yine yapılır (YON-03).
  const pendingCompany = Boolean(input.dry_run) && value.company_id === "__pending__";
  if (isCustomerRole(value.role) && !pendingCompany) {
    company = await ctx.admin.db.get(`v2/companies/${value.company_id}`);
    if (!company || typeof company !== "object") {
      throw new UserError("company_not_found", "Seçilen firma bulunamadı.", 404, { errors: { company_id: "Seçilen firma bulunamadı." } });
    }
    if (company.is_active === false) {
      throw new UserError("company_inactive", "Seçilen firma pasif; kullanıcı eklenemez.", 409, { errors: { company_id: "Seçilen firma pasif." } });
    }
  }

  const existingAuth = await ctx.admin.auth.getUserByEmail(value.email);
  if (repair && !existingAuth) {
    throw new UserError("not_orphan", "Bu e-posta için yetim (profilsiz) bir hesap bulunamadı.", 404);
  }
  if (existingAuth && users[existingAuth.uid]) {
    // Profil başka bir e-postayla bu uid'e bağlı: tutarsız kayıt, otomatik onarılmaz.
    throw new UserError("email_in_use", "Bu e-posta adresi başka bir kullanıcıya bağlı.", 409);
  }
  const orphan = Boolean(existingAuth);
  const invite = !value.password;

  if (input.dry_run) return { dry_run: true, orphan, mode: invite ? "invite" : "password" };

  const warnings = [];
  const displayName = `${value.first_name} ${value.last_name}`;
  let uid;
  let created = false;
  if (orphan) {
    uid = existingAuth.uid;
    const patch = { displayName };
    if (existingAuth.disabled) patch.disabled = false;
    if (value.password) patch.password = value.password;
    await ctx.admin.auth.updateUser(uid, patch).catch((err) => {
      throw new UserError("auth_update_failed", "Mevcut hesap güncellenemedi.", 502, { cause: err && err.code });
    });
  } else {
    try {
      const made = await ctx.admin.auth.createUser({
        email: value.email,
        password: value.password || randomPassword(),
        displayName,
        disabled: false,
      });
      uid = made.uid;
      created = true;
    } catch (err) {
      if (err && err.code === "email_exists") throw new UserError("email_in_use", "Bu e-posta adresi zaten kayıtlı.", 409);
      if (err && err.code === "weak_password") throw new UserError("weak_password", "Şifre çok zayıf.", 400);
      throw new UserError("auth_create_failed", "Kullanıcı hesabı oluşturulamadı. Lütfen tekrar deneyin.", 502);
    }
  }

  const ts = iso(ctx);
  const profile = {
    uid,
    email: value.email,
    first_name: value.first_name,
    last_name: value.last_name,
    phone: value.phone,
    role: value.role,
    // Personel rollerinde firma alanları boş kalır (YON-16a)
    company_id: company ? value.company_id : "",
    company_name: company ? clip(company.name, 200) : "",
    customer_code: company ? clip(company.customer_code, 30) : "",
    is_active: true,
    must_change_password: !invite,
    last_login_at: null,
    created_at: ts,
    created_by: ctx.caller.uid,
    updated_at: ts,
    updated_by: ctx.caller.uid,
  };

  try {
    await ctx.admin.db.set(`v2/users/${uid}`, profile);
  } catch (err) {
    console.error("[admin-users] profil yazılamadı", { code: err && err.code });
    if (created) {
      try {
        await ctx.admin.auth.deleteUser(uid);
      } catch (rollbackErr) {
        console.error("[admin-users] geri alma başarısız", { code: rollbackErr && rollbackErr.code });
        throw new UserError(
          "rollback_failed",
          "Kullanıcı kaydı tamamlanamadı ve oluşturulan hesap geri alınamadı. “Yetim hesabı onar” ile kaydı tamamlayabilirsiniz.",
          500,
          { rolled_back: false }
        );
      }
      throw new UserError("profile_write_failed", "Kullanıcı kaydı tamamlanamadı; oluşturulan hesap geri alındı. Lütfen tekrar deneyin.", 500, { rolled_back: true });
    }
    throw new UserError("profile_write_failed", "Kullanıcı profili yazılamadı. Lütfen tekrar deneyin.", 500, { rolled_back: false });
  }

  // --- Profil yazıldı: bundan sonrası "oluşturulamadı" demez (YON-07) ---
  let personnel = null;
  if (PERSONNEL_ROLES.includes(value.role)) {
    personnel = await secondary(warnings, "personnel_link_failed", "Personel kaydı eşleştirilemedi.", () => linkPersonnel(ctx, uid, value.email));
    if (personnel && personnel.status === "no_personnel") {
      warnings.push({ code: "no_personnel", message: "Bu e-postayla eşleşen bir personel (danışman) kaydı yok; Danışmanlar sayfasında kayıt oluşturup eşleştirin." });
    } else if (personnel && personnel.status === "uid_mismatch") {
      warnings.push({ code: "personnel_uid_mismatch", message: "Eşleşen personel kaydı başka bir kullanıcı hesabına bağlı." });
    } else if (personnel && personnel.status === "conflict") {
      warnings.push({ code: "personnel_conflict", message: "Aynı e-postayla birden çok personel kaydı var; elle eşleştirin." });
    }
  }

  await secondary(warnings, "activity_failed", "Aktivite kaydı yazılamadı.", () =>
    logActivity(ctx, repair || orphan ? "user_repaired" : "user_created", uid, displayName, `${value.email} — ${ROLE_LABELS[value.role]}${orphan ? " (yetim hesap onarıldı)" : ""}`)
  );

  let inviteResult = { status: "skipped" };
  if (invite) {
    inviteResult =
      (await secondary(warnings, "invite_failed", "Şifre belirleme bağlantısı oluşturulamadı.", async () => {
        const link = await issueLink(ctx, value.email);
        const sent = await emailLink(ctx, {
          type: "user_credentials",
          email: value.email,
          name: displayName,
          link,
          idempotencyKey: `invite:${uid}:${ctx.now()}`,
        });
        if (sent.status !== "sent") {
          warnings.push({
            code: "invite_not_sent",
            message:
              sent.status === "quota"
                ? "Günlük e-posta kotası dolu; şifre belirleme bağlantısı gönderilemedi. Bağlantıyı kullanıcıya güvenli bir kanaldan iletin."
                : "Şifre belirleme e-postası gönderilemedi. Bağlantıyı kullanıcıya güvenli bir kanaldan iletin.",
          });
        }
        return sent;
      })) || { status: "failed" };
  }

  return {
    uid,
    email: value.email,
    mode: invite ? "invite" : "password",
    orphan_repaired: orphan,
    profile,
    personnel,
    invite: inviteResult,
    warnings,
  };
}

// -------------------------------------------------------------------------------------------------------------------
// setActive / update / resetLink / orphans / matchPersonnel
// -------------------------------------------------------------------------------------------------------------------

function loadTarget(users, uid) {
  const profile = users[uid];
  if (!profile) throw new UserError("not_found", "Kullanıcı bulunamadı.", 404);
  return profile;
}

function assertManageable(ctx, uid, target) {
  if (uid === ctx.caller.uid) return;
  if (!canManage(ctx.caller.role, target.role)) {
    throw new UserError("target_forbidden", "Bu kullanıcının hesabını yönetme yetkiniz yok.", 403);
  }
}

async function setActive(ctx, input) {
  const uid = String(input.uid || "").trim();
  const active = input.active === true;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new UserError("bad_uid", "Geçersiz kullanıcı.", 400);
  const users = await loadUsers(ctx.admin);
  const target = loadTarget(users, uid);
  assertManageable(ctx, uid, target);

  if (!active) {
    if (uid === ctx.caller.uid) {
      throw new UserError("self_lock", "Kendi hesabınızı devre dışı bırakamazsınız.", 409);
    }
    if (target.role === "super_admin" && activeSuperAdminCount(users, uid) === 0) {
      throw new UserError("last_super_admin", "Son aktif Süper Admin hesabı devre dışı bırakılamaz.", 409);
    }
  }

  const warnings = [];
  const ts = iso(ctx);
  const patch = { is_active: active, updated_at: ts, updated_by: ctx.caller.uid };
  if (active) {
    // Etkinleştirme: önce Auth (aksi halde profil aktif ama giriş yapılamaz durumda kalır)
    const authUser = await ctx.admin.auth.getUser(uid);
    if (authUser) {
      await ctx.admin.auth.updateUser(uid, { disabled: false }).catch(() => {
        throw new UserError("auth_update_failed", "Hesap etkinleştirilemedi. Lütfen tekrar deneyin.", 502);
      });
    } else {
      warnings.push({ code: "auth_missing", message: "Bu profilin oturum (Auth) hesabı bulunamadı; yalnızca profil etkinleştirildi." });
    }
    await ctx.admin.db.update(`v2/users/${uid}`, patch);
  } else {
    // Pasife alma: önce profil (kurallar anında erişimi keser), sonra Auth devre dışı + oturum iptali
    await ctx.admin.db.update(`v2/users/${uid}`, patch);
    const authUser = await secondary(warnings, "auth_lookup_failed", "Oturum hesabı sorgulanamadı.", () => ctx.admin.auth.getUser(uid));
    if (authUser) {
      await secondary(warnings, "auth_disable_failed", "Oturum hesabı kapatılamadı; profil pasif olduğundan erişim yine de engellenir.", async () => {
        await ctx.admin.auth.updateUser(uid, { disabled: true });
        await ctx.admin.auth.revokeRefreshTokens(uid);
      });
    } else if (authUser === null) {
      warnings.push({ code: "auth_missing", message: "Bu profilin oturum (Auth) hesabı bulunamadı; yalnızca profil pasife alındı." });
    }
  }
  await secondary(warnings, "activity_failed", "Aktivite kaydı yazılamadı.", () =>
    logActivity(ctx, active ? "user_activated" : "user_deactivated", uid, fullName(target) || target.email, active ? "Hesap aktive edildi" : "Hesap devre dışı bırakıldı (oturumlar iptal edildi)")
  );
  return { uid, is_active: active, warnings };
}

async function updateUser(ctx, input) {
  const uid = String(input.uid || "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new UserError("bad_uid", "Geçersiz kullanıcı.", 400);
  const users = await loadUsers(ctx.admin);
  const target = loadTarget(users, uid);
  assertManageable(ctx, uid, target);

  const errors = {};
  const patch = {};
  if (input.first_name !== undefined) {
    patch.first_name = clip(input.first_name, 100);
    if (!patch.first_name) errors.first_name = "Ad alanı zorunludur.";
  }
  if (input.last_name !== undefined) {
    patch.last_name = clip(input.last_name, 100);
    if (!patch.last_name) errors.last_name = "Soyad alanı zorunludur.";
  }
  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    if (!phone) errors.phone = "Geçerli bir telefon numarası giriniz (en az 10 hane).";
    else patch.phone = phone;
  }

  let newRole = target.role;
  if (input.role !== undefined && input.role !== target.role) {
    newRole = String(input.role);
    if (!ALL_ROLES.includes(newRole)) errors.role = "Geçersiz kullanıcı rolü.";
    else if (!canManage(ctx.caller.role, newRole)) errors.role = "Bu rolü atama yetkiniz yok.";
    else if (uid === ctx.caller.uid) throw new UserError("self_lock", "Kendi rolünüzü değiştiremezsiniz.", 409);
    else if (target.role === "super_admin" && activeSuperAdminCount(users, uid) === 0) {
      throw new UserError("last_super_admin", "Son aktif Süper Admin'in rolü düşürülemez.", 409);
    }
  }
  if (Object.keys(errors).length) throw fieldError(errors);

  // Rol/firma tutarlılığı (YON-16): personel rollerinde firma alanları boşaltılır; müşteri rollerinde firma zorunlu.
  if (newRole !== target.role || input.company_id !== undefined) {
    if (isCustomerRole(newRole)) {
      const companyId = String(input.company_id !== undefined ? input.company_id : target.company_id || "").trim();
      if (!companyId) throw fieldError({ company_id: "Müşteri kullanıcıları için firma seçimi zorunludur." });
      if (companyId !== target.company_id) {
        const company = await ctx.admin.db.get(`v2/companies/${companyId}`);
        if (!company || typeof company !== "object") throw fieldError({ company_id: "Seçilen firma bulunamadı." });
        patch.company_id = companyId;
        patch.company_name = clip(company.name, 200);
        patch.customer_code = clip(company.customer_code, 30);
      }
    } else {
      patch.company_id = "";
      patch.company_name = "";
      patch.customer_code = "";
    }
  }
  if (newRole !== target.role) patch.role = newRole;

  if (!Object.keys(patch).length) return { uid, changed: false, warnings: [] };
  patch.updated_at = iso(ctx);
  patch.updated_by = ctx.caller.uid;
  await ctx.admin.db.update(`v2/users/${uid}`, patch);

  const warnings = [];
  if (patch.role && patch.role !== target.role) {
    // Yetkisi düşen/yükselen kullanıcının eski jetonları geçersiz sayılsın (rol kural tarafında profilden okunur; yine de iptal et).
    await secondary(warnings, "auth_revoke_failed", "Eski oturumlar iptal edilemedi.", () => ctx.admin.auth.revokeRefreshTokens(uid));
    if (PERSONNEL_ROLES.includes(newRole)) {
      const personnel = await secondary(warnings, "personnel_link_failed", "Personel kaydı eşleştirilemedi.", () => linkPersonnel(ctx, uid, normEmail(target.email)));
      if (personnel && personnel.status === "no_personnel") {
        warnings.push({ code: "no_personnel", message: "Bu e-postayla eşleşen bir personel (danışman) kaydı yok." });
      }
    }
  }
  if (patch.first_name || patch.last_name) {
    await secondary(warnings, "auth_name_failed", "Oturum hesabındaki ad güncellenemedi.", () =>
      ctx.admin.auth.updateUser(uid, { displayName: `${patch.first_name || target.first_name || ""} ${patch.last_name || target.last_name || ""}`.trim() })
    );
  }
  await secondary(warnings, "activity_failed", "Aktivite kaydı yazılamadı.", () => logActivity(ctx, "user_updated", uid, fullName({ ...target, ...patch }) || target.email, "Profil güncellendi"));
  return { uid, changed: true, warnings };
}

async function resetLink(ctx, input) {
  const uid = String(input.uid || "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new UserError("bad_uid", "Geçersiz kullanıcı.", 400);
  const users = await loadUsers(ctx.admin);
  const target = loadTarget(users, uid);
  assertManageable(ctx, uid, target);
  if (target.is_active === false) throw new UserError("inactive_target", "Hesap pasif; önce hesabı aktive edin.", 409);
  const email = normEmail(target.email);
  const authUser = await ctx.admin.auth.getUserByEmail(email);
  if (!authUser) throw new UserError("auth_missing", "Bu profilin oturum (Auth) hesabı bulunamadı.", 404);

  const link = await issueLink(ctx, email);
  const wantSend = input.send !== false;
  const out = { uid, email, sent: false, warnings: [] };
  if (wantSend) {
    const sent = await emailLink(ctx, {
      type: "password_reset_admin",
      email,
      name: fullName(target),
      link,
      // Dakikada en çok bir bağlantı e-postası/kullanıcı (idempotency + kota koruması)
      idempotencyKey: `pwreset:${uid}:${Math.floor(ctx.now() / 60000)}`,
    });
    out.sent = sent.status === "sent";
    if (!out.sent) {
      out.link = link;
      out.warnings.push({
        code: "reset_not_sent",
        message:
          sent.status === "quota"
            ? "Günlük e-posta kotası dolu; bağlantı e-postayla gönderilemedi. Bağlantıyı kullanıcıya güvenli bir kanaldan iletin."
            : "E-posta gönderilemedi. Bağlantıyı kullanıcıya güvenli bir kanaldan iletin.",
      });
    }
  } else {
    out.link = link;
  }
  await secondary(out.warnings, "activity_failed", "Aktivite kaydı yazılamadı.", () =>
    logActivity(ctx, "user_password_reset", uid, fullName(target) || email, wantSend ? "Şifre belirleme bağlantısı gönderildi" : "Şifre belirleme bağlantısı üretildi")
  );
  return out;
}

async function listOrphans(ctx) {
  const users = await loadUsers(ctx.admin);
  const out = [];
  let pageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const res = await ctx.admin.auth.listUsers({ maxResults: 500, pageToken });
    for (const u of res.users) {
      if (!users[u.uid]) out.push({ uid: u.uid, email: u.email, disabled: u.disabled === true, created_at: u.createdAt || "" });
    }
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return { orphans: out.slice(0, 200) };
}

async function matchPersonnel(ctx, input) {
  const uid = String(input.uid || "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new UserError("bad_uid", "Geçersiz kullanıcı.", 400);
  const users = await loadUsers(ctx.admin);
  const target = loadTarget(users, uid);
  assertManageable(ctx, uid, target);
  if (!PERSONNEL_ROLES.includes(target.role)) throw new UserError("not_staff", "Yalnızca danışman/proje yöneticisi kullanıcıları personel kaydıyla eşleştirilir.", 400);
  return { uid, personnel: await linkPersonnel(ctx, uid, normEmail(target.email)) };
}

module.exports = {
  UserError,
  ROLE_LABELS,
  ALL_ROLES,
  CUSTOMER_ROLES,
  STAFF_ROLES,
  ASSIGNABLE_ROLES,
  canManage,
  normalizePhone,
  passwordOk,
  createUser,
  setActive,
  updateUser,
  resetLink,
  listOrphans,
  matchPersonnel,
};
