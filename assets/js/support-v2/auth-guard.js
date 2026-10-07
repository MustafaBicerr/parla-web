/**
 * Parla BT Ticket V2 — kimlik doğrulama ve rota koruması
 */
import ParlaDb from "./firebase-client.js";
import { isAdminRole, isCustomerRole } from "./ticket-utils.js";
import { safeNextPath } from "./safe-utils.js";
import { classifyError, renderFatalState } from "./ui-states.js";

export const PATHS = {
  login: "/support-v2/login.html",
  changePassword: "/support-v2/change-password.html",
  customerDashboard: "/support-v2/customer/dashboard.html",
  customerTickets: "/support-v2/customer/tickets.html",
  customerTicketDetail: "/support-v2/customer/ticket-detail.html",
  customerProfile: "/support-v2/customer/profile.html",
  adminDashboard: "/support-v2/admin/dashboard.html",
  adminTickets: "/support-v2/admin/tickets.html",
  adminTicketDetail: "/support-v2/admin/ticket-detail.html",
  adminUsers: "/support-v2/admin/users.html",
  adminUserDetail: "/support-v2/admin/user-detail.html",
  adminCompanies: "/support-v2/admin/companies.html",
  adminCompanyDetail: "/support-v2/admin/company-detail.html",
  adminPersonnel: "/support-v2/admin/personnel.html",
  adminPersonnelDetail: "/support-v2/admin/personnel-detail.html",
  adminContracts: "/support-v2/admin/contracts.html",
  adminProjects: "/support-v2/admin/projects.html",
  adminProjectDetail: "/support-v2/admin/project-detail.html",
  adminDepartments: "/support-v2/admin/departments.html",
  adminModules: "/support-v2/admin/modules.html",
  adminSupportTypes: "/support-v2/admin/support-types.html",
  adminActivities: "/support-v2/admin/activities.html",
  adminReports: "/support-v2/admin/reports.html",
  guideUser: "/support-v2/docs/Kullanici-Kilavuzu.pdf",
  guideAdmin: "/support-v2/docs/Sistem-Adminleri-Kullanim-Kilavuzu.pdf",
};

const AUTH_ERROR_MESSAGES = {
  // SEC-33: hesabın VARLIĞINI ayırt ettirmemek için "kullanıcı yok" ve "şifre yanlış" aynı genel iletiyi verir.
  "auth/user-not-found":
    "E-posta veya şifre hatalı. Lütfen bilgilerinizi kontrol edin; şifrenizi unuttuysanız 'Şifremi Unuttum' bağlantısını kullanın.",
  "auth/wrong-password":
    "E-posta veya şifre hatalı. Lütfen bilgilerinizi kontrol edin; şifrenizi unuttuysanız 'Şifremi Unuttum' bağlantısını kullanın.",
  "auth/invalid-email": "Geçersiz e-posta adresi formatı.",
  "auth/user-disabled":
    "Hesabınız devre dışı bırakılmış. Lütfen sistem yöneticinizle iletişime geçin.",
  "auth/too-many-requests":
    "Çok fazla başarısız deneme. Hesabınız geçici olarak kilitlendi. Birkaç dakika bekleyin.",
  "auth/network-request-failed":
    "İnternet bağlantınızı kontrol edin ve tekrar deneyin.",
  "auth/invalid-credential":
    "E-posta veya şifre hatalı. Lütfen bilgilerinizi kontrol edin.",
  "auth/email-already-in-use": "Bu e-posta adresi zaten kullanımda.",
  "auth/weak-password": "Şifre çok zayıf. En az 8 karakter kullanın.",
  "auth/requires-recent-login": "Güvenlik nedeniyle yeniden giriş yapmanız gerekiyor.",
};

function mapAuthError(error) {
  const code = error?.code || "";
  return AUTH_ERROR_MESSAGES[code] || error?.message || "Bir hata oluştu. Lütfen tekrar deneyin.";
}

/** Giriş sayfasının gösterdiği bilgi iletileri (`login.html?reason=...`). Sabit liste: parametre metni asla basılmaz. */
export const LOGIN_REASONS = {
  inactive: "Hesabınız aktif değil. Sistem yöneticinizle iletişime geçin.",
  no_role: "Hesabınıza henüz bir rol atanmamış. Sistem yöneticinizle iletişime geçin.",
  no_profile: "Kullanıcı profiliniz bulunamadı. Lütfen yöneticinizle iletişime geçin.",
  expired: "Oturumunuz sona erdi. Devam etmek için lütfen tekrar giriş yapın.",
};

let lastSession = null;
let signingOut = false;

/** requireAuth ile doğrulanmış son oturum (hata ekranları menüyü çizebilsin diye). */
export function getLastSession() {
  return lastSession;
}

/** Bulunulan sayfanın yolu + sorgusu (`/support-v2/...`); giriş sonrası dönüş için. Geçersizse "". */
export function currentNextPath() {
  try {
    return safeNextPath(window.location.pathname + window.location.search + window.location.hash);
  } catch {
    return "";
  }
}

/** Girişe yönlendirme adresi; geçerli bir `next` ve neden eklenir (MUS-10, EML-18, SEN-18). */
export function buildLoginUrl(options) {
  const o = options || {};
  const params = new URLSearchParams();
  const next = o.next === undefined ? currentNextPath() : safeNextPath(o.next);
  if (next) params.set("next", next);
  if (o.reason && LOGIN_REASONS[o.reason]) params.set("reason", o.reason);
  const qs = params.toString();
  return qs ? `${PATHS.login}?${qs}` : PATHS.login;
}

/**
 * `next` hedefini kullanıcının rolüne göre uyarlar: personel bağlantısı müşteri hesabıyla (ya da tersi)
 * açılırsa aynı talebin kendi rolündeki sayfasına gidilir; başka uyuşmazlıkta "" (panoya düş).
 */
export function resolveNextForRole(next, role) {
  const safe = safeNextPath(next);
  if (!safe) return "";
  const staff = isAdminRole(role);
  const customer = isCustomerRole(role);
  if (!staff && !customer) return "";
  if (staff && safe.startsWith("/support-v2/customer/ticket-detail.html")) {
    return safe.replace("/support-v2/customer/ticket-detail.html", "/support-v2/admin/ticket-detail.html");
  }
  if (customer && safe.startsWith("/support-v2/admin/ticket-detail.html")) {
    return safe.replace("/support-v2/admin/ticket-detail.html", "/support-v2/customer/ticket-detail.html");
  }
  if (staff && safe.startsWith("/support-v2/customer/")) return "";
  if (customer && safe.startsWith("/support-v2/admin/")) return "";
  return safe;
}

function goto(url) {
  window.location.href = url;
}

/** Oturumla ilgili yerel iz taşıyan anahtar önekleri (zil görüldü/önbellek, etkinlik damgası). E-posta kuyruğu ayrıca `clearOutbox` ile silinir. */
const LOCAL_KEY_PREFIXES = ["sv2_seen_", "sv2_bell_", "sv2_last_active_"];

/** Eşzamanlı (sync) temizlik: çıkış/oturum bitişinde paylaşılan bilgisayarda iz kalmasın (SEC-28). */
function wipeLocalKeys() {
  try {
    const ls = window.localStorage;
    if (!ls) return;
    const drop = [];
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (key && LOCAL_KEY_PREFIXES.some((p) => key.startsWith(p))) drop.push(key);
    }
    drop.forEach((key) => ls.removeItem(key));
  } catch {
    /* depolama kapalı */
  }
}

/**
 * Çıkışta: önce bekleyen e-postaları göndermeyi dener (en çok 2,5 sn), sonra e-posta kuyruğunu (alıcı adresleri + yanıt metni),
 * `sv2_seen_*` ve zil önbelleğini siler (SEC-28). Hatalar çıkışı engellemez.
 */
async function clearLocalSessionData(uid) {
  try {
    const { default: emailService } = await import("./email-service.js");
    if (emailService && uid) {
      await Promise.race([Promise.resolve(emailService.flushOutbox()).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
      emailService.clearOutbox(uid);
    }
  } catch {
    /* e-posta servisi yüklenemedi: aşağıdaki genel temizlik yine yapılır */
  }
  wipeLocalKeys();
}

/* ------------------------------------------------------------------ *
 * Boşta oturum zaman aşımı (SEC-35): personel 8 saat, müşteri 30 gün.
 * Son etkinlik zamanı localStorage'ta (sekmeler arası ortak) tutulur; süre dolduysa sayfa açılışında ya da açık sayfada
 * (dakikada bir) oturum kapatılır ve girişe "oturum sona erdi" iletisiyle yönlendirilir.
 * ------------------------------------------------------------------ */
export const IDLE_LIMITS_MS = { staff: 8 * 3600 * 1000, customer: 30 * 24 * 3600 * 1000 };
const ACTIVITY_THROTTLE_MS = 30 * 1000;
let idleWatchBound = false;

const activityKey = (uid) => `sv2_last_active_${uid}`;

export function idleLimitMs(role) {
  return isAdminRole(role) ? IDLE_LIMITS_MS.staff : IDLE_LIMITS_MS.customer;
}

function readLastActive(uid) {
  try {
    const n = Number(window.localStorage?.getItem(activityKey(uid)));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function touchActivity(uid, now) {
  try {
    window.localStorage?.setItem(activityKey(uid), String(now == null ? Date.now() : now));
  } catch {
    /* depolama kapalı: zaman aşımı devre dışı kalır (sunucu jetonu zaten süresiz değildir) */
  }
}

/** Boşta süre dolduysa true. Kayıt yoksa (ilk giriş) dolmuş sayılmaz. */
export function isIdleExpired(role, uid, now) {
  const last = readLastActive(uid);
  return last > 0 && (now == null ? Date.now() : now) - last > idleLimitMs(role);
}

function watchIdle(role, uid, fb) {
  if (idleWatchBound || typeof window === "undefined") return;
  idleWatchBound = true;
  let lastTouch = Date.now();
  const touch = () => {
    const now = Date.now();
    if (now - lastTouch < ACTIVITY_THROTTLE_MS) return;
    lastTouch = now;
    touchActivity(uid, now);
  };
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((evt) => window.addEventListener(evt, touch, { passive: true, capture: true }));
  const check = async () => {
    if (signingOut || !isIdleExpired(role, uid)) return;
    signingOut = true;
    await clearLocalSessionData(uid);
    try {
      await fb.authFn.signOut(fb.auth);
    } catch {
      /* çıkış başarısızsa da yönlendirme sürer */
    }
    goto(buildLoginUrl({ reason: "expired" }));
  };
  const timer = setInterval(check, 60 * 1000);
  if (timer && typeof timer.unref === "function") timer.unref();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
}


/** Tüm sayfalarda: başka sekmede çıkış / oturum bitişi → "Oturumunuz sona erdi" + girişe yönlendirme (SEN-16). */
let sessionWatchBound = false;
function watchSession(fb) {
  if (sessionWatchBound) return;
  sessionWatchBound = true;
  try {
    let hadUser = !!fb.auth.currentUser;
    fb.authFn.onAuthStateChanged(fb.auth, (user) => {
      if (user) {
        hadUser = true;
        return;
      }
      if (!hadUser || signingOut) return;
      signingOut = true;
      wipeLocalKeys();
      goto(buildLoginUrl({ reason: "expired" }));
    });
  } catch {
    /* dinleyici kurulamadı: işlemler yetki hatasıyla zaten korunur */
  }
}

/** Çıkıştan sonra geri tuşu önbellekteki (bfcache) eski sayfayı göstermesin (MUS-37). */
let pageshowBound = false;
function bindPageshowGuard() {
  if (pageshowBound || typeof window === "undefined") return;
  pageshowBound = true;
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) window.location.reload();
  });
}

function waitForAuth(timeoutMs) {
  const maxWait = timeoutMs || 15000;
  return ParlaDb.waitForFirebase().then(
    (fb) =>
      new Promise((resolve, reject) => {
        if (fb.auth.currentUser) {
          resolve(fb.auth.currentUser);
          return;
        }

        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          unsub();
          if (fb.auth.currentUser) {
            resolve(fb.auth.currentUser);
          } else {
            reject(new Error("not_authenticated"));
          }
        }, maxWait);

        const unsub = fb.authFn.onAuthStateChanged(fb.auth, (user) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsub();
          if (user) {
            resolve(user);
          } else {
            reject(new Error("not_authenticated"));
          }
        });
      })
  );
}

async function getSessionUser() {
  await ParlaDb.waitForFirebase();
  let authUser;
  try {
    authUser = await waitForAuth(8000);
  } catch {
    return null;
  }

  const profile = await ParlaDb.getUserProfile(authUser.uid);
  if (!profile) {
    return {
      uid: authUser.uid,
      email: authUser.email,
      profile: null,
      authUser,
    };
  }

  return {
    uid: authUser.uid,
    email: authUser.email,
    ...profile,
    profile,
    authUser,
  };
}

/**
 * Rolüne göre ilk sayfaya yönlendirir. Adreste geçerli bir `next` varsa (giriş öncesi hedef) oraya gider;
 * geçici şifreli hesaplar önce şifre değiştirme sayfasına (hedef korunarak) yönlenir.
 * Rolü tanınmayan profil girişe neden iletisiyle döner (sonsuz yönlendirme yok; SEC-30).
 */
function redirectByRole(profile, options) {
  const role = profile?.role || profile?.profile?.role;
  const must = profile?.must_change_password === true || profile?.profile?.must_change_password === true;
  let rawNext;
  if (options && options.next !== undefined) rawNext = options.next;
  else {
    try {
      rawNext = new URLSearchParams(window.location.search).get("next") || "";
    } catch {
      rawNext = "";
    }
  }
  if (!isAdminRole(role) && !isCustomerRole(role)) {
    goto(buildLoginUrl({ next: "", reason: "no_role" }));
    return;
  }
  const next = resolveNextForRole(rawNext, role);
  if (must) {
    goto(next ? `${PATHS.changePassword}?next=${encodeURIComponent(next)}` : PATHS.changePassword);
    return;
  }
  goto(next || (isAdminRole(role) ? PATHS.adminDashboard : PATHS.customerDashboard));
}

async function forceSignOut(fb) {
  signingOut = true;
  wipeLocalKeys();
  try {
    await fb.authFn.signOut(fb.auth);
  } catch {
    /* çıkış başarısızsa da yönlendirme sürer */
  }
}

function guardError(message, code) {
  const err = new Error(message);
  err.code = code || "";
  err.handled = true; // çağıran sayfa ikinci bir hata iletisi üretmesin
  return err;
}

async function requireAuth(options) {
  options = options || {};
  const customRedirect = typeof options.redirect === "string" ? options.redirect : "";
  const redirect = options.redirect !== false;
  const toLogin = (reason) => {
    if (redirect) goto(customRedirect || buildLoginUrl(reason ? { reason } : {}));
  };

  bindPageshowGuard();

  let fb;
  try {
    await ParlaDb.waitForFirebase();
    fb = window.__PARLA_FIREBASE;
  } catch (err) {
    renderFatalState("#sv2-app", { title: "Bağlantı kurulamadı", message: classifyError(err).message });
    throw guardError("Firebase başlatılamadı.", "firebase_unavailable");
  }

  let authUser;
  try {
    authUser = await waitForAuth(8000);
  } catch {
    toLogin();
    throw new Error("not_authenticated");
  }

  let profile;
  try {
    profile = await ParlaDb.getUserProfile(authUser.uid);
  } catch (err) {
    // Çevrimdışı ya da okuma hatası: boş ekran yerine "Yeniden dene" kartı (SEN-24, MUS-06).
    const cls = classifyError(err);
    renderFatalState("#sv2-app", { title: "Oturum bilgileriniz alınamadı", message: cls.message });
    throw guardError("Oturum bilgileri okunamadı.", "profile_load_failed");
  }

  if (!profile) {
    await forceSignOut(fb);
    toLogin("no_profile");
    throw guardError("Kullanıcı profili bulunamadı. Lütfen yöneticinizle iletişime geçin.", "profile_not_found");
  }

  if (profile.is_active === false) {
    await forceSignOut(fb);
    toLogin("inactive");
    throw guardError("Hesabınız aktif değil. Sistem yöneticinizle iletişime geçin.", "account_inactive");
  }

  if (!isAdminRole(profile.role) && !isCustomerRole(profile.role)) {
    await forceSignOut(fb);
    toLogin("no_role");
    throw guardError("Hesabınıza henüz bir rol atanmamış. Sistem yöneticinizle iletişime geçin.", "no_role");
  }

  // Boşta oturum zaman aşımı (SEC-35): personel 8 sa, müşteri 30 gün.
  if (isIdleExpired(profile.role, authUser.uid)) {
    await clearLocalSessionData(authUser.uid);
    await forceSignOut(fb);
    toLogin("expired");
    throw guardError("Oturumunuz uzun süre boşta kaldığı için sona erdi. Lütfen yeniden giriş yapın.", "session_idle_expired");
  }
  touchActivity(authUser.uid);
  watchIdle(profile.role, authUser.uid, fb);

  const session = { uid: authUser.uid, email: authUser.email, ...profile, authUser };

  // Geçici şifreyle açılmış hesaplar şifresini değiştirmeden portalı kullanamaz (hedef sayfa korunur).
  if (profile.must_change_password === true && !options.allowPasswordChange) {
    const next = currentNextPath();
    goto(next ? `${PATHS.changePassword}?next=${encodeURIComponent(next)}` : PATHS.changePassword);
    // Yönlendirme sürerken çağıran sayfanın devam edip hata göstermesini engelle.
    return new Promise(() => {});
  }

  const wrongRoleTarget = (fallback) => resolveNextForRole(currentNextPath(), profile.role) || fallback;

  if (options.adminOnly && !isAdminRole(profile.role)) {
    goto(wrongRoleTarget(PATHS.customerDashboard));
    throw guardError("not_admin");
  }

  if (options.customerOnly && !isCustomerRole(profile.role)) {
    goto(wrongRoleTarget(PATHS.adminDashboard));
    throw guardError("not_customer");
  }

  if (options.roles && options.roles.length > 0) {
    const allowed = options.roles.map((r) => String(r).toLowerCase());
    if (!allowed.includes(String(profile.role).toLowerCase())) {
      redirectByRole(profile, { next: "" });
      throw guardError("role_denied");
    }
  }

  lastSession = session;
  watchSession(fb);
  return session;
}

async function signIn(email, password) {
  await ParlaDb.waitForFirebase();
  const fb = window.__PARLA_FIREBASE;

  try {
    const credential = await fb.authFn.signInWithEmailAndPassword(
      fb.auth,
      String(email || "").trim(),
      String(password || "")
    );

    const profile = await ParlaDb.getUserProfile(credential.user.uid);

    if (!profile) {
      await fb.authFn.signOut(fb.auth);
      throw new Error("Kullanıcı profili bulunamadı. Lütfen yöneticinizle iletişime geçin.");
    }

    if (profile.is_active === false) {
      await fb.authFn.signOut(fb.auth);
      throw new Error("Hesabınız aktif değil. Sistem yöneticinizle iletişime geçin.");
    }

    if (!isAdminRole(profile.role) && !isCustomerRole(profile.role)) {
      await fb.authFn.signOut(fb.auth);
      throw new Error("Hesabınıza henüz bir rol atanmamış. Sistem yöneticinizle iletişime geçin.");
    }

    await ParlaDb.updateUserProfile(credential.user.uid, {
      last_login_at: new Date().toISOString(),
    });

    return {
      uid: credential.user.uid,
      email: credential.user.email,
      ...profile,
    };
  } catch (err) {
    if (err.message && !err.code) throw err;
    throw new Error(mapAuthError(err));
  }
}

async function signOutUser() {
  await ParlaDb.waitForFirebase();
  const fb = window.__PARLA_FIREBASE;
  signingOut = true;
  lastSession = null;
  // Çıkıştan ÖNCE (hâlâ oturumluyken): bekleyen e-posta kuyruğunu göndermeyi dene, kalanı ve yerel izleri sil (SEC-28).
  await clearLocalSessionData(fb.auth.currentUser?.uid);
  try {
    await fb.authFn.signOut(fb.auth);
  } catch (err) {
    signingOut = false;
    throw err;
  }
  window.location.href = PATHS.login;
}

/**
 * Şifre sıfırlama e-postası. SEC-33: kayıtlı olmayan adres için de BAŞARILI döner (hesap varlığı sızmasın);
 * yöneticinin kullanıcı sayfasından çağrısında `{ revealMissing: true }` ile gerçek durum bildirilir.
 */
async function resetPassword(email, options) {
  await ParlaDb.waitForFirebase();
  const fb = window.__PARLA_FIREBASE;

  try {
    await fb.authFn.sendPasswordResetEmail(fb.auth, String(email || "").trim());
    return true;
  } catch (err) {
    if (err?.code === "auth/user-not-found" && !(options && options.revealMissing)) return true;
    throw new Error(err?.code === "auth/user-not-found" ? "Bu e-posta için Firebase hesabı bulunamadı (yetim profil olabilir)." : mapAuthError(err));
  }
}

/**
 * Oturum açmış kullanıcının şifresini değiştirir (mevcut şifre ile yeniden doğrulama gerekir)
 * ve must_change_password bayrağını kaldırır.
 */
async function changePassword(currentPassword, newPassword) {
  await ParlaDb.waitForFirebase();
  const fb = window.__PARLA_FIREBASE;
  const user = fb.auth.currentUser;
  if (!user || !user.email) throw new Error("Oturum bulunamadı. Lütfen yeniden giriş yapın.");

  try {
    const credential = fb.authFn.EmailAuthProvider.credential(user.email, String(currentPassword || ""));
    await fb.authFn.reauthenticateWithCredential(user, credential);
    await fb.authFn.updatePassword(user, String(newPassword || ""));
  } catch (err) {
    // Bu sayfada e-posta alanı ve "Şifremi Unuttum" bağlantısı yok: bağlama uygun mesajlar (MUS-29).
    const code = err?.code || "";
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      throw new Error("Mevcut şifreniz hatalı. Lütfen kontrol edip tekrar deneyin.");
    }
    throw new Error(mapAuthError(err));
  }

  await ParlaDb.updateUserProfile(user.uid, { must_change_password: false });
}

/**
 * İkincil Firebase uygulaması (gstatic CDN): mevcut yönetici oturumunu bozmadan başka bir hesapla işlem yapmayı sağlar.
 * @returns {Promise<{authMod: object, secondaryAuth: object, dispose: () => Promise<void>}>}
 */
async function openSecondaryAuth() {
  await ParlaDb.waitForFirebase();
  const fb = window.__PARLA_FIREBASE;
  const appMod = await import("https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js");
  const authMod = await import("https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js");
  const secondaryApp = appMod.initializeApp(fb.app.options, `parla-create-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const secondaryAuth = authMod.getAuth(secondaryApp);
  const dispose = async () => {
    try {
      await appMod.deleteApp(secondaryApp);
    } catch {
      /* ikincil app temizliği opsiyonel */
    }
  };
  return { authMod, secondaryAuth, dispose };
}

/**
 * Admin kullanıcı oluşturma (SUNUCU İŞLEVİ YOKKEN eski/yedek yol) — ikincil Firebase app ile mevcut oturumu bozmaz.
 *
 * Dönen `rollback()`: profil yazımı başarısız olursa yeni açılan Auth hesabını siler (yetim hesap kalmasın; SEC-20, YON-02).
 * `dispose()` işlem bitince ikincil uygulamayı kapatır (rollback bunu kendisi yapar).
 * `options.recoverOrphan`: e-posta Auth'ta zaten varsa (önceki yarım kalmış oluşturma) AYNI parolayla oturum açıp kimliği alır;
 * parola uymazsa `orphan_unrecoverable` hatası (Console'dan silme ya da sunucu tarafı onarım gerekir; SEN-19).
 * @returns {Promise<{user: object, uid: string, email: string, recovered: boolean, rollback: () => Promise<boolean>, dispose: () => Promise<void>}>}
 */
async function createUserAccount(email, password, options) {
  const { authMod, secondaryAuth, dispose } = await openSecondaryAuth();
  const mail = String(email || "").trim();
  let user;
  let recovered = false;
  try {
    try {
      user = (await authMod.createUserWithEmailAndPassword(secondaryAuth, mail, String(password || ""))).user;
    } catch (err) {
      if (err?.code === "auth/email-already-in-use" && options?.recoverOrphan && typeof authMod.signInWithEmailAndPassword === "function") {
        try {
          user = (await authMod.signInWithEmailAndPassword(secondaryAuth, mail, String(password || ""))).user;
          recovered = true;
        } catch {
          const e = new Error(
            "Bu e-posta adresi Firebase'de kayıtlı ama portalda profili yok (yarım kalmış bir oluşturma). Parola bilinmediği için otomatik onarılamadı; sunucu tarafı onarım yapılandırıldığında “Yetim Hesabı Onar” kullanılabilir ya da hesabı Firebase Console'dan silin."
          );
          e.code = "orphan_unrecoverable";
          throw e;
        }
      } else {
        throw new Error(mapAuthError(err));
      }
    }
  } catch (err) {
    await dispose();
    throw err;
  }
  return {
    user,
    uid: user.uid,
    email: user.email || mail,
    recovered,
    async rollback() {
      // Yalnızca BU işlemde yeni açılan hesap silinir (kurtarılan/mevcut hesaba dokunulmaz).
      if (recovered) {
        await dispose();
        return false;
      }
      try {
        if (typeof authMod.deleteUser !== "function") return false;
        await authMod.deleteUser(user);
        return true;
      } catch {
        return false;
      } finally {
        await dispose();
      }
    },
    dispose,
  };
}

/** Eski imza (geriye uyumluluk): hesabı açar ve ikincil uygulamayı kapatır; geri alma gerekiyorsa `createUserAccount` kullanın. */
async function createUser(email, password) {
  const account = await createUserAccount(email, password);
  await account.dispose();
  return account.user;
}

export {
  guardError,
  waitForAuth,
  getSessionUser,
  requireAuth,
  redirectByRole,
  signIn,
  signOutUser,
  resetPassword,
  changePassword,
  createUser,
  createUserAccount,
  clearLocalSessionData,
  mapAuthError,
};
