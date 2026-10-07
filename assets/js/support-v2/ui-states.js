/**
 * Parla BT Ticket V2 — durum bileşenleri ve işlem koruması.
 *
 * Yalnızca `ticket-utils` ve `safe-utils` içe aktarır (auth-guard ve ui-shell tarafından ortak
 * kullanılır; döngüsel bağımlılık yok). Hata/boş/yükleniyor durumları, hata sınıflandırma,
 * zaman aşımı ve "işlem sürüyor" (in-flight) koruması burada toplanır.
 */
import { escapeHtml } from "./ticket-utils.js";
import { safeText } from "./safe-utils.js";

/* ------------------------------------------------------------------ hata sınıflandırma */

/** Hata kodunu tek biçime çevirir: "auth/Wrong-Password" → "wrong_password", "PERMISSION_DENIED" → "permission_denied". */
export function errorCode(error) {
  return safeText(error?.code).replace(/^auth\//i, "").toLowerCase().replace(/-/g, "_");
}

export function isPermissionError(error) {
  const code = errorCode(error);
  const msg = safeText(error?.message).toLowerCase();
  return code === "permission_denied" || msg.includes("permission_denied") || msg.includes("permission denied");
}

const NETWORK_CODES = new Set(["network_request_failed", "network_error", "unavailable", "disconnected", "timeout", "offline"]);

export function isNetworkError(error) {
  const code = errorCode(error);
  const msg = safeText(error?.message).toLowerCase();
  if (NETWORK_CODES.has(code)) return true;
  return /failed to fetch|networkerror|network error|network request failed|load failed|client is offline|timed out/.test(msg);
}

export const ERROR_TEXT = {
  permission: "Bu işlem için yetkiniz yok ya da kaydın durumu değişmiş olabilir. Sayfayı yenileyip yeniden deneyin; sorun sürerse destek ekibine bildirin.",
  network: "Bağlantı hatası. İnternet bağlantınızı kontrol edip yeniden deneyin.",
  timeout: "İşlem zaman aşımına uğradı. Bağlantınız yavaş ya da kopuk olabilir; lütfen yeniden deneyin.",
  auth: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın.",
  notfound: "Aradığınız kayıt bulunamadı ya da bu kayda erişim yetkiniz yok.",
  unknown: "Beklenmeyen bir hata oluştu. Lütfen yeniden deneyin.",
};

const CODE_TEXT = {
  not_authenticated: ERROR_TEXT.auth,
  profile_not_found: "Kullanıcı profili bulunamadı. Lütfen yöneticinizle iletişime geçin.",
  account_inactive: "Hesabınız aktif değil. Sistem yöneticinizle iletişime geçin.",
  too_many_requests: "Çok fazla deneme yapıldı. Birkaç dakika bekleyip yeniden deneyin.",
};

// Geliştirici/SDK kaynaklı İngilizce ya da teknik iletiler son kullanıcıya gösterilmez.
const TECHNICAL_MESSAGE =
  /firebase|invalid location|invalid token|typeerror|referenceerror|syntaxerror|is not a function|is not defined|cannot read|undefined|unexpected token|json|\bat \w+|stack|\[object|rules|console/i;

/**
 * Hatayı sınıflandırır ve kullanıcıya gösterilecek Türkçe iletiyi üretir.
 * @returns {{ kind: "permission"|"network"|"timeout"|"auth"|"notfound"|"unknown", message: string }}
 */
export function classifyError(error) {
  const code = errorCode(error);
  if (isPermissionError(error)) return { kind: "permission", message: ERROR_TEXT.permission };
  if (code === "timeout") return { kind: "timeout", message: safeText(error?.message) || ERROR_TEXT.timeout };
  if (isNetworkError(error)) return { kind: "network", message: ERROR_TEXT.network };
  if (code === "not_found" || code === "notfound") return { kind: "notfound", message: ERROR_TEXT.notfound };
  if (code === "not_authenticated" || safeText(error?.message) === "not_authenticated") {
    return { kind: "auth", message: ERROR_TEXT.auth };
  }
  if (CODE_TEXT[code]) return { kind: code === "profile_not_found" || code === "account_inactive" ? "auth" : "unknown", message: CODE_TEXT[code] };
  const raw = safeText(error?.message).trim();
  if (raw && !TECHNICAL_MESSAGE.test(raw) && raw.length <= 300) return { kind: "unknown", message: raw };
  return { kind: "unknown", message: ERROR_TEXT.unknown };
}

/* ------------------------------------------------------------------ zaman aşımı */

/** Yazma/okuma zaman aşımı (ms); testler için `window.__SV2_WRITE_TIMEOUT_MS` ile kısaltılabilir. */
export function defaultTimeoutMs() {
  const override = typeof window !== "undefined" ? Number(window.__SV2_WRITE_TIMEOUT_MS) : 0;
  return override > 0 ? override : 20000;
}

/**
 * Söz zaman aşımına uğrarsa `code: "timeout"` hatasıyla reddeder. Not: Firebase yazması iptal edilemez;
 * bağlantı gelince arka planda tamamlanabilir (iletide belirtilir).
 */
export function withTimeout(promise, ms, message) {
  const limit = ms && ms > 0 ? ms : defaultTimeoutMs();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message || ERROR_TEXT.timeout);
      err.code = "timeout";
      reject(err);
    }, limit);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/* ------------------------------------------------------------------ işlem sürüyor koruması */

const inflight = new Set();

/**
 * Aynı düğme (ya da anahtar) için eşzamanlı ikinci çalıştırmayı engeller; düğmeyi `disabled` yapar.
 * Enter/Boşluk tekrarı, hızlı çift tık ve programatik çift olay tek işlem olarak sayılır.
 *
 * @param {HTMLElement|string|null} target düğme, düğme kimliği ya da ortak anahtar (ör. "reply")
 * @param {() => Promise<any>|any} fn
 * @returns {Promise<any>} fn sonucu; zaten çalışıyorsa `undefined` (fn çağrılmaz)
 */
export async function withInflight(target, fn) {
  let btn = null;
  let key = target;
  if (typeof target === "string") {
    const el = typeof document !== "undefined" ? document.getElementById(target) : null;
    if (el) {
      btn = el;
      key = el;
    }
  } else if (target && typeof target === "object") {
    btn = target;
  }
  if (inflight.has(key)) return undefined;
  inflight.add(key);
  const wasDisabled = btn ? btn.disabled : false;
  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  }
  try {
    return await fn();
  } finally {
    inflight.delete(key);
    if (btn) {
      btn.removeAttribute("aria-busy");
      // Sayfa yeniden çizildiyse eski düğmeye dokunmanın zararı yok; yaşıyorsa eski durumuna dön.
      btn.disabled = wasDisabled;
    }
  }
}

/* ------------------------------------------------------------------ durum bileşenleri (HTML) */

/** Yükleniyor iskeleti (ekran okuyucuya "Yükleniyor" bildirir). */
export function loadingStateHtml(message) {
  return `
    <div class="sv2-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span class="sv2-sr-only">${escapeHtml(message || "Yükleniyor…")}</span>
      <div class="sv2-skeleton-line sv2-skeleton-title"></div>
      <div class="sv2-skeleton-line"></div>
      <div class="sv2-skeleton-line sv2-skeleton-short"></div>
      <div class="sv2-skeleton-block"></div>
    </div>`;
}

/**
 * Hata kartı. `retry: true` "Yeniden dene" düğmesi çizer (`data-sv2-retry`); `actions` ek bağlantılardır.
 */
export function errorStateHtml(options) {
  const o = options || {};
  const actions = (o.actions || [])
    .map((a) => `<a class="sv2-btn sv2-btn-outline" href="${escapeHtml(a.href)}">${escapeHtml(a.label)}</a>`)
    .join("");
  return `
    <div class="sv2-error-state" role="alert">
      <i class="fas ${escapeHtml(o.icon || "fa-exclamation-triangle")}" aria-hidden="true"></i>
      <h4>${escapeHtml(o.title || "Veriler yüklenemedi")}</h4>
      <p>${escapeHtml(o.message || ERROR_TEXT.unknown)}</p>
      <div class="sv2-error-actions">
        ${o.retry === false ? "" : `<button type="button" class="sv2-btn sv2-btn-primary" data-sv2-retry><i class="fas fa-redo"></i> ${escapeHtml(o.retryLabel || "Yeniden dene")}</button>`}
        ${actions}
      </div>
    </div>`;
}

/**
 * Hata kartını bir kaba yazar ve "Yeniden dene" düğmesini bağlar.
 * @param {HTMLElement|string} target
 * @param {{title?:string,message?:string,onRetry?:Function,retry?:boolean,actions?:Array,icon?:string}} options
 */
export function renderErrorState(target, options) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return null;
  el.innerHTML = errorStateHtml(options);
  const btn = el.querySelector("[data-sv2-retry]");
  btn?.addEventListener("click", () => {
    withInflight(btn, async () => {
      if (typeof options?.onRetry === "function") await options.onRetry();
      else window.location.reload();
    });
  });
  return el;
}

/**
 * Kabuksuz (oturum/profil okunamadığında) tam sayfa hata kartı.
 * @param {HTMLElement|string} app
 */
export function renderFatalState(app, options) {
  const el = typeof app === "string" ? document.querySelector(app) : app;
  if (!el) return null;
  el.innerHTML = `<div class="sv2-fatal-wrap"></div>`;
  return renderErrorState(el.firstElementChild, { icon: "fa-plug", retryLabel: "Yeniden dene", ...(options || {}) });
}
