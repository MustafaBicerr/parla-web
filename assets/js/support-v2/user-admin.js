/**
 * Parla BT Ticket V2 — kullanıcı yönetimi: sunucu işlevi istemcisi (/api/admin-users) + rol matrisi (DOM'dan bağımsız).
 *
 * Sunucu işlevi (netlify/functions/admin-users.js) Auth hesabı + profili tek işlemde yazar, geri alma/onarım yapar ve pasife alırken
 * Auth hesabını da kapatır. Servis hesabı henüz tanımlı değilse işlev 503 `not_configured` döner; bu durumda (ya da işlev hiç yoksa: 404)
 * çağıran sayfa `unavailable: true` görür ve eski istemci tarafı akışa UYARIYLA geri döner.
 */

import { getPhoneInstance } from "./phone-utils.js";

export const ROLE_ORDER = ["super_admin", "service_admin", "project_manager", "consultant", "company_admin", "customer", "arizi_customer"];
const CUSTOMER = ["company_admin", "customer", "arizi_customer"];

/** Çağıran rol → atayabileceği/yönetebileceği roller (sunucu ve veritabanı kurallarıyla AYNI; YON-02, YON-05). */
const ASSIGNABLE = {
  super_admin: ROLE_ORDER,
  service_admin: [...CUSTOMER, "consultant", "project_manager"],
};

export function assignableRoles(sessionRole) {
  return [...(ASSIGNABLE[String(sessionRole || "").toLowerCase()] || [])];
}

/** Çağıran, bu roldeki kullanıcıyı yönetebilir mi (profil düzenleme/pasife alma/şifre bağlantısı)? */
export function canManageRole(sessionRole, targetRole) {
  return assignableRoles(sessionRole).includes(String(targetRole || "").toLowerCase());
}

export function isHighPrivilegeRole(role) {
  return role === "super_admin" || role === "service_admin";
}

function apiUrl() {
  const cfg = (typeof window !== "undefined" && window.__PARLA_SITE_CONFIG) || {};
  return cfg.ADMIN_USERS_API_URL || "/api/admin-users";
}

async function idToken() {
  const user = window.__PARLA_FIREBASE?.auth?.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(false);
  } catch {
    return null;
  }
}

/**
 * Sunucu işlevini çağırır. Hiçbir zaman fırlatmaz.
 * @returns {Promise<{ok: boolean, status: number, code: string, message: string, data: any, warnings: Array, errors: object|null,
 *   unavailable: boolean, rolledBack?: boolean}>}
 *   unavailable: işlev yok/yapılandırılmamış (404/405/501, 503 not_configured, JSON olmayan 5xx) → eski akışa dönülebilir.
 */
export async function callAdminUsers(action, payload, options) {
  const o = options || {};
  const fail = (extra) => ({ ok: false, status: 0, code: "", message: "", data: null, warnings: [], errors: null, unavailable: false, ...extra });
  const token = await idToken();
  if (!token) return fail({ code: "no_session", message: "Oturum bulunamadı. Lütfen yeniden giriş yapın." });

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), o.timeoutMs || 25000) : null;
  let res;
  let text = "";
  try {
    res = await fetch(apiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...(payload || {}), action }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    text = await res.text();
  } catch {
    return fail({ code: "network", message: "Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin." });
  } finally {
    if (timer) clearTimeout(timer);
  }

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const status = res.status;
  if (json && typeof json === "object" && json.success === true) {
    return fail({ ok: true, status, data: json.data || null, warnings: Array.isArray(json.warnings) ? json.warnings : [] });
  }
  const code = String((json && json.code) || "");
  const unavailable = code === "not_configured" || [404, 405, 501].includes(status) || (!json && status >= 500);
  return fail({
    status,
    code: code || (unavailable ? "not_configured" : `http_${status}`),
    message: (json && json.message) || "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
    errors: json && json.errors && typeof json.errors === "object" ? json.errors : null,
    rolledBack: json && json.rolled_back,
    unavailable,
  });
}

/** Sunucu uyarılarını (warnings) tek bir okunabilir metne çevirir. */
export function warningsText(warnings) {
  return (warnings || []).map((w) => w && w.message).filter(Boolean).join(" ");
}

/**
 * Telefon alanı geçersizse hata metni, geçerli/denetlenemiyorsa "" (YON-31). Telefon bileşeni (intl-tel-input) yüklüyse ülke
 * kurallarıyla doğrulanır: fazla/eksik haneli numara kaydedilmez. Bileşen/utils yüklenemediyse (isValidNumber → null) engellenmez;
 * biçim denetimi (validators.phone) ve sunucu denetimi yine uygulanır.
 */
export function phoneInputError(inputEl) {
  const iti = getPhoneInstance(inputEl);
  if (!iti || typeof iti.isValidNumber !== "function") return "";
  let valid = null;
  try {
    valid = iti.isValidNumber();
  } catch {
    valid = null;
  }
  return valid === false ? "Geçerli bir telefon numarası giriniz (ülke kodu ve hane sayısı kontrol edilir)." : "";
}
