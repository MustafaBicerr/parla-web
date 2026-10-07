/**
 * E-posta hattı koruması: kayan pencere hız sınırı, günlük kota sayacı, olay tekilleştirme, günlük özet kuyruğu.
 *
 * Bağlam (D-04 A): Resend ÜCRETSİZ plan ≈100 e-posta/gün (UTC gün) — Firebase Auth e-postaları ve form e-postaları
 * AYNI hesabı kullanır. Bu yüzden:
 *   - Yumuşak sınır (varsayılan 80): aşılınca düşük öncelikli bildirimler gönderilmez, günlük özete eklenir.
 *   - Sert sınır (varsayılan 95): aşılınca yüksek öncelikliler de gönderilmez (429 daily_quota).
 *   - Sayaç alıcı başına sayar (en kötü durum varsayımı: Resend çok alıcılı e-postayı alıcı başına sayabilir).
 *
 * Ortam değişkenleri (hepsi isteğe bağlı): bkz. .env.example
 */

const DAY_MS = 24 * 3600 * 1000;

function intEnv(env, name, fallback) {
  const raw = env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Sınırlar. `options.relaxed`: geliştirme/test (Netlify dışı) — varsayılanlar 1000 katına çıkar ki makine hızında koşan
 * e2e testleri (tek müşteri dakikada onlarca eylem) sahte 429 almasın. Açıkça verilen RATE_ ve DAILY_ ile başlayan değerler aynen
 * uygulanır; `RATE_LIMIT_MODE=strict` ile geliştirmede de üretim varsayılanları zorlanır. Üretimde (Lambda) her zaman sıkıdır.
 */
function getLimits(env, options) {
  const e = env || process.env;
  const k = options && options.relaxed ? 1000 : 1;
  return {
    customer: [
      { name: "minute", ms: 60 * 1000, max: intEnv(e, "RATE_CUSTOMER_PER_MIN", 5 * k) },
      { name: "hour", ms: 3600 * 1000, max: intEnv(e, "RATE_CUSTOMER_PER_HOUR", 20 * k) },
    ],
    staff: [
      { name: "minute", ms: 60 * 1000, max: intEnv(e, "RATE_STAFF_PER_MIN", 30 * k) },
      { name: "hour", ms: 3600 * 1000, max: intEnv(e, "RATE_STAFF_PER_HOUR", 120 * k) },
    ],
    ticket: [{ name: "hour", ms: 3600 * 1000, max: intEnv(e, "RATE_TICKET_PER_HOUR", 40 * k) }],
    dailySoft: intEnv(e, "DAILY_EMAIL_SOFT_LIMIT", 80 * k),
    dailyHard: intEnv(e, "DAILY_EMAIL_HARD_LIMIT", 95 * k),
  };
}

/** Yüksek öncelikli olaylar (sert sınıra kadar gönderilir); diğerleri düşük önceliklidir. */
const HIGH_PRIORITY = new Set([
  "ticket_created",
  "ticket_assigned",
  "ticket_close_approval",
  "send_to_customer",
  "ticket_reopened",
  "user_credentials",
  "password_reset_admin",
  "daily_digest",
  // WP-05 / D-07 C: kritik yükselme, otomatik kapanış ve SLA aşımı yüksek öncelikli (sert sınıra kadar gönderilir);
  // hatırlatma, %80 uyarısı, atama kaldırma/danışman bilgisi düşük öncelikli (yumuşak sınırda özete düşer).
  "ticket_priority_critical",
  "ticket_auto_closed",
  "sla_breached",
]);

function priorityOf(type) {
  return HIGH_PRIORITY.has(type) ? "high" : "low";
}

function dayKey(now) {
  return new Date(now == null ? Date.now() : now).toISOString().slice(0, 10);
}

/** Bir sonraki UTC gün başlangıcına kalan saniye (kota sıfırlanma zamanı). */
function secondsToNextDay(now) {
  const t = now == null ? Date.now() : now;
  const next = Math.floor(t / DAY_MS) * DAY_MS + DAY_MS;
  return Math.max(1, Math.ceil((next - t) / 1000));
}

/**
 * Kayan pencere hız sınırı. Reddedilen istekler pencereye YAZILMAZ (yeniden deneyen istemci kendini kilitlemesin).
 * @returns {Promise<{ok: boolean, retryAfter?: number, window?: string}>}
 */
async function consumeRate(store, scope, id, windows, now) {
  const t = now == null ? Date.now() : now;
  const longest = Math.max(...windows.map((w) => w.ms));
  const cap = Math.max(...windows.map((w) => w.max)) + 1;
  return store.update(
    `rl:${scope}:${id}`,
    (current) => {
      const stamps = (Array.isArray(current) ? current : []).filter((s) => typeof s === "number" && t - s < longest);
      for (const w of windows) {
        const inWindow = stamps.filter((s) => t - s < w.ms);
        if (inWindow.length >= w.max) {
          const oldest = Math.min(...inWindow);
          const retryAfter = Math.max(1, Math.ceil((oldest + w.ms - t) / 1000));
          return { skip: true, result: { ok: false, retryAfter, window: w.name } };
        }
      }
      stamps.push(t);
      return { value: stamps.slice(-cap), result: { ok: true } };
    },
    { ttlMs: longest }
  );
}

/** Günlük kota: `n` alıcıyı rezerve eder. Düşük öncelikli yumuşak, yüksek öncelikli sert sınıra tabidir. */
async function reserveQuota(store, limits, n, priority, now) {
  const limit = priority === "high" ? limits.dailyHard : limits.dailySoft;
  return store.update(
    `quota:${dayKey(now)}`,
    (current) => {
      const used = current && Number.isFinite(current.used) ? current.used : 0;
      if (used + n > limit) {
        return { skip: true, result: { ok: false, used, limit, retryAfter: secondsToNextDay(now) } };
      }
      return { value: { used: used + n }, result: { ok: true, used: used + n, limit } };
    },
    { ttlMs: 3 * DAY_MS }
  );
}

async function refundQuota(store, n, now) {
  await store.update(
    `quota:${dayKey(now)}`,
    (current) => {
      const used = current && Number.isFinite(current.used) ? current.used : 0;
      return { value: { used: Math.max(0, used - n) }, result: true };
    },
    { ttlMs: 3 * DAY_MS }
  );
}

/** Resend "kota doldu" dediğinde sayaç gerçeği geride bırakmışsa: gün sonuna dek sert sınıra çek. */
async function saturateQuota(store, limits, now) {
  await store.update(
    `quota:${dayKey(now)}`,
    (current) => {
      const used = current && Number.isFinite(current.used) ? current.used : 0;
      return { value: { used: Math.max(used, limits.dailyHard) }, result: true };
    },
    { ttlMs: 3 * DAY_MS }
  );
}

async function getQuota(store, limits, now) {
  const current = await store.get(`quota:${dayKey(now)}`);
  return {
    day: dayKey(now),
    used: current && Number.isFinite(current.used) ? current.used : 0,
    soft_limit: limits.dailySoft,
    hard_limit: limits.dailyHard,
  };
}

/**
 * Olay tekilleştirme (iki aşamalı): claim -> (gönder) -> complete | release.
 * `pending` kayıt 2 dakika sonra bayat sayılır (çöken istek olayı sonsuza dek kilitlemesin).
 * Aynı requestId ile gelen yeniden deneme, yarım kalmış `pending` kaydı devralır.
 * @returns {Promise<"claimed"|"duplicate">}
 */
const PENDING_STALE_MS = 2 * 60 * 1000;
const SENT_TTL_MS = 45 * DAY_MS;

async function claimEvent(store, key, requestId, now) {
  const t = now == null ? Date.now() : now;
  return store.update(
    key,
    (current) => {
      if (current && current.state === "sent") return { skip: true, result: "duplicate" };
      if (current && current.state === "pending" && t - current.at < PENDING_STALE_MS && current.rid !== requestId) {
        return { skip: true, result: "duplicate" };
      }
      return { value: { state: "pending", at: t, rid: requestId }, result: "claimed" };
    },
    { ttlMs: SENT_TTL_MS }
  );
}

async function completeEvent(store, key, extra) {
  await store.set(key, { state: "sent", at: Date.now(), ...(extra || {}) }, { ttlMs: SENT_TTL_MS });
}

async function releaseEvent(store, key) {
  await store.delete(key);
}

/** Kısaltılmış ve yalnızca gerekli alanları içeren günlük özet kaydı ekler (yumuşak kota aşıldığında). */
const DIGEST_MAX = 300;

async function recordDeferred(store, entry, now) {
  const day = dayKey(now);
  await store.update(
    `digest:${day}`,
    (current) => {
      const list = Array.isArray(current) ? current : [];
      if (list.length >= DIGEST_MAX) return { skip: true, result: false };
      list.push(entry);
      return { value: list, result: true };
    },
    { ttlMs: 14 * DAY_MS }
  );
}

module.exports = {
  getLimits,
  priorityOf,
  dayKey,
  secondsToNextDay,
  consumeRate,
  reserveQuota,
  refundQuota,
  saturateQuota,
  getQuota,
  claimEvent,
  completeEvent,
  releaseEvent,
  recordDeferred,
  HIGH_PRIORITY,
};
