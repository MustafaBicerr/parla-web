/**
 * Parla BT Ticket V2 — çıktı güvenliği yardımcıları (DOM'dan bağımsız; Node'da test edilebilir).
 *
 * Kural: kullanıcı kontrollü hiçbir değer HTML'e `class=`, `data-*=`, `style=`, `href=` gibi
 * bir öznitelik içinde ya da şablon sabiti olarak ham basılmaz. Metin düğümleri için `escapeHtml`,
 * sınıf/anahtar türü değerler için `safeToken`/`safeClass`, bağlantılar için `safeHttpUrl` kullanılır.
 */

/** Öncelik değerleri için izinli simgeler (CSS: .sv2-priority-<değer>). */
export const PRIORITY_TOKENS = ["low", "medium", "high", "critical"];

/** Herhangi bir değeri güvenle metne çevirir (null/undefined → ""; nesne/dizi → ""). */
export function safeText(value) {
  if (value === null || value === undefined) return "";
  const t = typeof value;
  if (t === "string") return value;
  if (t === "number" || t === "boolean" || t === "bigint") return String(value);
  return "";
}

/**
 * Beyaz liste süzgeci: değer (küçük harfe çevrilerek) izinli listede ise onu, değilse `fallback` döner.
 * Sınıf adı/öznitelik içine girecek enum benzeri değerler için kullanılır.
 * @param {*} value
 * @param {Iterable<string>} allowed
 * @param {string} [fallback]
 */
export function safeToken(value, allowed, fallback = "") {
  const key = safeText(value).toLowerCase();
  const list = allowed instanceof Set ? allowed : new Set(Array.from(allowed || []));
  return list.has(key) ? key : fallback;
}

/** Serbest biçimli ama güvenli bir CSS sınıf simgesi: yalnız [a-z0-9_-], en çok 40 karakter; aksi halde "". */
export function safeClass(value) {
  const s = safeText(value).toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(s) ? s : "";
}

/** Veritabanı anahtarı / URL parametresi olarak kabul edilebilir kimlik mi (push-id, kısa kodlar). */
export function isSafeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** Sonlu sayıya çevirir; olmuyorsa `fallback`. */
export function safeNumber(value, fallback = 0) {
  if (typeof value === "string" && value.trim() === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Yalnız http(s) bağlantılarını kabul eder (javascript:, data:, vbscript: … reddedilir).
 * @returns {string} normalleştirilmiş URL ya da "" (geçersizse)
 */
export function safeHttpUrl(value) {
  const raw = safeText(value).trim();
  if (!raw || raw.length > 2048) return "";
  // Denetim karakterleri/boşluk numarası (java\tscript:) yoluyla şema gizlemeyi engelle.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "";
  let u;
  try {
    u = new URL(raw);
  } catch {
    return "";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  if (!u.hostname) return "";
  return u.href;
}

/**
 * Giriş sonrası dönülecek yolu doğrular (açık yönlendirme engeli): yalnız `/support-v2/` altındaki
 * göreli yollar kabul edilir. Geçersizse "" döner.
 */
export function safeNextPath(value) {
  const raw = safeText(value).trim();
  if (!raw || raw.length > 600) return "";
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return "";
  if (!raw.startsWith("/support-v2/")) return "";
  if (raw.startsWith("//") || raw.includes("://")) return "";
  try {
    const u = new URL(raw, "http://x.invalid");
    if (u.origin !== "http://x.invalid") return "";
    if (!u.pathname.startsWith("/support-v2/") || u.pathname.includes("//")) return "";
    // Giriş/şifre eylemi sayfalarına geri dönme (döngü) yok.
    if (/\/support-v2\/(login|auth-action)\.html$/.test(u.pathname)) return "";
    return u.pathname + u.search + u.hash;
  } catch {
    return "";
  }
}

const numberFormats = new Map();

/**
 * Sayı gösterimi tr-TR: ondalık ayracı virgül, binlik ayracı nokta ("3,5", "1.234,5"; UX-36, PER-47).
 * Biçimleyiciler basamak sayısına göre önbelleklenir. Sayı olmayan değer "—" olur.
 * @param {number|string} value
 * @param {number} [maxDigits] en fazla ondalık basamak (varsayılan 1)
 * @param {number} [minDigits] en az ondalık basamak (varsayılan 0)
 */
export function formatNumber(value, maxDigits = 1, minDigits = 0) {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return "—";
  const key = `${minDigits}:${maxDigits}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits });
    numberFormats.set(key, f);
  }
  return f.format(n);
}
