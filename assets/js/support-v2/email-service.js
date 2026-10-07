/**
 * Parla BT Ticket V2 — e-posta bildirim servisi (Netlify Function + Resend)
 *
 * Her istek giriş yapmış kullanıcının Firebase ID token'ını taşır. SUNUCU alıcıyı ve içeriği belirler:
 *  - metin (`note`) ve bağlantı (`portalUrl`) istemciden gönderilmez; yalnızca `message_id` / `history_id` gönderilir,
 *    sunucu kaydı veritabanından okur;
 *  - `to` içindeki geçersiz/yetkisiz adresler sunucuda ayıklanır (kısmi başarı), destek kutusu için sembolik "@support" kullanılır.
 *
 * Geçici hatalarda (ağ, 5xx, hız sınırı, kota) istek tarayıcıda kuyruğa alınır; kuyruk:
 *  - Web Locks ile çok sekmede serileştirilir; flush yalnızca tek sekmede çalışır;
 *  - ilk deneme hemen (≤1 dk), sonra üstel geri çekilme (5 dk, 30 dk, 2 sa, 6 sa, 12 sa): en çok 6 deneme (≈20 saat)
 *    ya da 24 saat sürer; süre/deneme dolarsa e-posta düşer ve aktiviteye `email_failed` yazılır;
 *  - aynı requestId kullanıldığından e-posta mükerrer gitmez (Resend idempotency + sunucu olay tekilleştirme).
 */

/** Sunucuda CONTACT_EMAIL env'ine çözülen sembolik alıcı (istemci adres bilmek zorunda değildir). */
export const SUPPORT_RECIPIENT = "@support";

const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requestTimeoutMs() {
  const n = Number((window.__PARLA_SITE_CONFIG || {}).EMAIL_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 100 ? n : DEFAULT_REQUEST_TIMEOUT_MS;
}

function getEmailApiUrl() {
  const cfg = window.__PARLA_SITE_CONFIG || {};
  return cfg.EMAIL_API_URL || "/api/send-email";
}

function newRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Yanıtı JSON olarak okur. JSON değilse (HTML 404/502 sayfası vb.) içinden `{…}` AYIKLANMAZ:
 * `success: true` içermeyen hiçbir yanıt başarı sayılmaz.
 */
async function parseResponse(res) {
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* JSON değil */
    }
  }
  return {
    success: false,
    code: res.status === 404 ? "endpoint_missing" : text ? "bad_response" : "empty_response",
    message: res.status === 404 ? "E-posta servisine ulaşılamadı." : "E-posta servisi beklenmeyen bir yanıt verdi.",
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getIdToken(forceRefresh) {
  const user = window.__PARLA_FIREBASE?.auth?.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(!!forceRefresh);
  } catch {
    return null;
  }
}

/** Zaman aşımlı fetch (AbortController). Gövde okuması da süreye dahildir. */
async function fetchJson(url, init) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), requestTimeoutMs()) : null;
  try {
    const res = await fetch(url, controller ? { ...init, signal: controller.signal } : init);
    const json = await parseResponse(res);
    return { res, json };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Boş/yinelenen adresleri ve (varsa) işlemi yapan kişinin kendi adresini ayıklar. */
function uniqueEmails(list, excludeEmail) {
  const skip = String(excludeEmail || "").trim().toLowerCase();
  const seen = new Set();
  const out = [];
  (list || []).forEach((item) => {
    const email = String(item || "").trim().toLowerCase();
    if (!email || email === skip || seen.has(email)) return;
    seen.add(email);
    out.push(email);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Kuyruk (localStorage) — okuma/yazma Web Locks ile serileştirilir
// ---------------------------------------------------------------------------------------------------------------

const OUTBOX_PREFIX = "sv2_email_outbox_";
const OUTBOX_MAX_ITEMS = 50;
const OUTBOX_MAX_AGE_MS = 24 * 3600 * 1000;
/** n. başarısız flush denemesinden sonra beklenecek süre (dk). Denemeler ≈ 0, 5 dk, 35 dk, 2,6 sa, 8,6 sa, 20,6 sa'te olur. */
const OUTBOX_BACKOFF_MIN = [5, 30, 120, 360, 720];
/** En çok flush denemesi (belge: "en çok 6 deneme veya 24 saat"). */
const OUTBOX_MAX_ATTEMPTS = OUTBOX_BACKOFF_MIN.length + 1;

const tabChains = new Map();
const tabFlushLocks = new Set();

function webLocks() {
  const nav = typeof globalThis !== "undefined" ? globalThis.navigator : null;
  return nav && nav.locks && typeof nav.locks.request === "function" ? nav.locks : null;
}

/** Aynı ada sahip işlemleri (sekme içinde ve — Web Locks varsa — sekmeler arasında) sıraya sokar. */
function runExclusive(name, fn) {
  const locks = webLocks();
  const previous = tabChains.get(name) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => (locks ? locks.request(name, fn) : fn()));
  tabChains.set(name, next);
  return next;
}

/** Kilit başka sekmede/çağrıda tutuluyorsa BEKLEMEZ ve null döner. */
async function runIfFree(name, fn) {
  const locks = webLocks();
  if (locks) return locks.request(name, { ifAvailable: true }, (lock) => (lock ? fn() : null));
  if (tabFlushLocks.has(name)) return null;
  tabFlushLocks.add(name);
  try {
    return await fn();
  } finally {
    tabFlushLocks.delete(name);
  }
}

function currentUid() {
  return window.__PARLA_FIREBASE?.auth?.currentUser?.uid || "";
}

function outboxLock(uid) {
  return `sv2-email-outbox-${uid}`;
}

function normalizeItem(item) {
  const now = Date.now();
  const legacy = !item.nextAt; // eski sürüm: attempts=3'ten başlıyordu → sıfırdan, zamana bağlı şemaya geçir
  return {
    payload: item.payload,
    attempts: legacy ? 0 : Number(item.attempts) || 0,
    firstAt: Number(item.firstAt) || now,
    lastAt: Number(item.lastAt) || now,
    nextAt: Number(item.nextAt) || 0,
  };
}

function readOutbox(uid) {
  try {
    const raw = window.localStorage?.getItem(OUTBOX_PREFIX + uid);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((i) => i && i.payload).map(normalizeItem) : [];
  } catch {
    return [];
  }
}

function writeOutbox(uid, list) {
  try {
    if (!list.length) window.localStorage?.removeItem(OUTBOX_PREFIX + uid);
    else window.localStorage?.setItem(OUTBOX_PREFIX + uid, JSON.stringify(list.slice(-OUTBOX_MAX_ITEMS)));
  } catch {
    /* depolama kapalı/dolu: kuyruk devre dışı kalır, gönderim yine denenmiştir */
  }
}

function itemId(item) {
  return item.payload && item.payload.requestId;
}

/** Başka kullanıcılara ait yaşlanmış kuyrukları (ortak bilgisayar gizliliği) süpürür. */
function sweepForeignOutboxes(uid) {
  try {
    const ls = window.localStorage;
    if (!ls || typeof ls.key !== "function") return;
    const stale = [];
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (!key || !key.startsWith(OUTBOX_PREFIX) || key === OUTBOX_PREFIX + uid) continue;
      let list = [];
      try {
        list = JSON.parse(ls.getItem(key) || "[]");
      } catch {
        list = [];
      }
      const alive = Array.isArray(list) && list.some((it) => it && Date.now() - Number(it.firstAt || 0) <= OUTBOX_MAX_AGE_MS);
      if (!alive) stale.push(key);
    }
    stale.forEach((key) => ls.removeItem(key));
  } catch {
    /* sessiz geç */
  }
}

/**
 * Yeniden denenmeye değer hata mı? Ağ kesintisi/zaman aşımı, 5xx, hız sınırı, kota (ertelenmemişse),
 * çözümlenemeyen yanıt (`bad_response`) ve eşzamanlı istek çakışması. `deferred` (sunucu günlük özete aldı) denenmez.
 */
function isRetryable(result) {
  if (!result || result.success) return false;
  if (result.deferred) return false;
  const code = String(result.code || "");
  if (
    ["network", "bad_response", "empty_response", "concurrent_request", "daily_quota", "monthly_quota", "timeout"].includes(code) ||
    code.startsWith("rate_limited")
  ) {
    return true;
  }
  return typeof result.status === "number" && (result.status >= 500 || result.status === 429);
}

function retryAfterSeconds(json, res) {
  const fromBody = Number(json && json.retry_after);
  if (Number.isFinite(fromBody) && fromBody > 0) return fromBody;
  const header = res && res.headers && typeof res.headers.get === "function" ? Number(res.headers.get("retry-after")) : NaN;
  return Number.isFinite(header) && header > 0 ? header : 0;
}


// ---------------------------------------------------------------------------------------------------------------
// Kullanıcıya gösterilecek metin / aktivite ayrıntısı (email-report.js kullanır)
// ---------------------------------------------------------------------------------------------------------------

const TRANSIENT_CODE = /^(network|timeout|rate_limited|daily_quota|monthly_quota|concurrent_request|bad_response|empty_response)/;

function isTransient(res) {
  return Boolean(res && (res.queued || TRANSIENT_CODE.test(String(res.code || "")) || res.status >= 500));
}

/** Toast metni: sade ve teknik değil (müşteri dahil herkes görür); sunucunun `detail`'i yalnızca yöneticilere döner. */
function emailFailureMessage(res, label) {
  const subject = label || "E-posta bildirimi";
  let text = `${subject} gönderilemedi.`;
  if (res && res.deferred) text = `${subject} şu an iletilemedi; kaydınız alındı.`;
  else if (isTransient(res)) text = `${subject} şu an gönderilemedi; otomatik olarak yeniden denenecek.`;
  if (res && res.detail) text += ` (${res.detail})`;
  return text;
}

/** Aktivite kaydı ayrıntısı: [kod] mesaj · HTTP durum · kuyruğa alındı · N alıcı · kısmi. */
function emailFailureDetails(res, ctx) {
  const parts = [`${(ctx && ctx.eventType) || "e-posta"} — ${res.code ? `[${res.code}] ` : ""}${res.message || "bilinmeyen hata"}`];
  if (res.status) parts.push(`HTTP ${res.status}`);
  if (res.queued) parts.push("kuyruğa alındı");
  if (res.deferred) parts.push("günlük özete eklendi");
  if (res.recipientCount) parts.push(`${res.recipientCount} alıcı`);
  if (res.partial) parts.push("kısmi");
  if (res.detail) parts.push(res.detail);
  return parts.join(" · ").slice(0, 300);
}

const ParlaEmailService = {
  uniqueEmails,

  /**
   * Tek bir gönderim denemesi (en fazla `attempts` kez, üstel bekleme ile).
   * Başarı ölçütü: HTTP 2xx VE gövdede `success: true`. 401'de token bir kez yenilenir (deneme hakkından düşmez).
   */
  async attemptSend(payload, attempts) {
    const url = getEmailApiUrl();
    if (!url) {
      console.warn("ParlaEmailService: EMAIL_API_URL tanımlı değil.");
      return { success: false, code: "not_configured", message: "E-posta servisine ulaşılamadı." };
    }

    let token = await getIdToken(false);
    if (!token) {
      return {
        success: false,
        code: "no_session",
        message: "Oturum bulunamadı; e-posta gönderilemedi. Lütfen yeniden giriş yapın.",
      };
    }

    let lastError = { success: false, code: "unknown", message: "E-posta gönderilemedi." };
    let refreshed = false;
    const maxAttempts = attempts || 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      try {
        const { res, json } = await fetchJson(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });

        if (res.ok && json.success === true) {
          return {
            success: true,
            partial: !!json.partial,
            message: json.message || "E-posta gönderildi.",
            data: json.data || null,
          };
        }

        if (res.status === 401 && !refreshed) {
          // Süresi dolmuş token olabilir: bir kez yenileyip tekrar dene (deneme hakkı tüketilmez).
          refreshed = true;
          token = (await getIdToken(true)) || token;
          continue;
        }

        lastError = {
          success: false,
          code: json.code || (res.ok ? "bad_response" : `http_${res.status}`),
          status: res.status,
          partial: !!json.partial,
          deferred: !!json.deferred,
          retryAfter: retryAfterSeconds(json, res),
          message: json.message || "E-posta gönderilemedi.",
        };
        if (json.detail) lastError.detail = String(json.detail);
        if (!isRetryable(lastError)) return lastError;
        // Uzun beklemeli durumlarda (hız sınırı/kota) hemen tekrar denemek anlamsız: kuyruğa bırak.
        if (lastError.retryAfter > 3) return lastError;
      } catch (err) {
        console.error("ParlaEmailService.send hatası:", err);
        lastError = {
          success: false,
          code: "network",
          message: "E-posta gönderilirken bağlantı hatası oluştu.",
        };
      }
      attempt += 1;
      if (attempt < maxAttempts) await sleep(400 * 2 ** (attempt - 1));
    }

    return lastError;
  },

  /**
   * @param {{ type: string, to: string|string[], ticketData?: object, extra?: object, requestId?: string, noQueue?: boolean }} params
   * @returns {Promise<{success: boolean, message: string, code?: string, partial?: boolean, queued?: boolean, data?: object}>}
   *
   * Geçici hatalarda istek tarayıcıda kuyruğa alınır ve otomatik yeniden denenir; aynı requestId
   * kullanıldığından e-posta mükerrer gitmez.
   */
  async send(params) {
    // Hesap bilgilendirme e-postasında parola SUNUCUYA GÖNDERİLMEZ (eski çağrılar `ticketData.password` verse bile):
    // sunucu yalnızca alıcıyı kullanır, içeriği ve bağlantıyı kendisi üretir.
    const accountMail = params.type === "user_credentials";
    const payload = {
      type: params.type || "",
      to: params.to,
      ticketData: accountMail ? null : params.ticketData || null,
      extra: accountMail ? null : params.extra || null,
      requestId: params.requestId || newRequestId(),
    };
    const recipientCount = Array.isArray(payload.to) ? payload.to.length : payload.to ? 1 : 0;

    const result = { ...(await this.attemptSend(payload, 3)), recipientCount };
    // Kimlik/hesap e-postaları ve yönetici tanılama istekleri asla kuyruğa (localStorage) alınmaz.
    const neverQueue =
      params.noQueue || payload.type === "user_credentials" || payload.type === "diagnostic" || payload.type === "test_email";
    if (!neverQueue && isRetryable(result)) {
      const uid = currentUid();
      if (uid) {
        const now = Date.now();
        // İlk yeniden deneme hemen uygundur (anlık 3 deneme zaten yapıldı; zamanlayıcı en geç 1 dk sonra çalışır);
        // sunucu `Retry-After` verdiyse o kadar beklenir. Sonraki denemeler üstel geri çekilmeyle ilerler.
        const waitMs = Math.max(0, (result.retryAfter || 0) * 1000);
        await runExclusive(outboxLock(uid), async () => {
          const list = readOutbox(uid);
          list.push({ payload, attempts: 0, firstAt: now, lastAt: now, nextAt: now + waitMs });
          writeOutbox(uid, list);
        });
        return { ...result, queued: true, message: `${result.message} Otomatik olarak yeniden denenecek.` };
      }
    }
    return result;
  },

  /**
   * Kuyruktaki e-postaları yeniden dener (sayfa açılışından 4 sn sonra, dakikada bir ve çevrimiçi olunca çağrılır).
   * Yalnızca zamanı gelmiş (`nextAt`) öğeler denenir; flush tek sekmede çalışır. Flush sırasında eklenen öğeler
   * kaybolmaz: sonuçlar, kuyruk yeniden okunarak (öğe bazında) uygulanır.
   * @param {{ now?: number }} [options] test/elle tetikleme için saat enjeksiyonu
   */
  async flushOutbox(options) {
    const uid = currentUid();
    if (!uid) return { sent: 0, dropped: 0, pending: 0 };
    const now = (options && options.now) || Date.now();

    const outcome = await runIfFree(`sv2-email-flush-${uid}`, async () => {
      sweepForeignOutboxes(uid);

      // 1) Süresi dolanları ayıkla, zamanı gelenleri seç.
      const droppedItems = [];
      const due = await runExclusive(outboxLock(uid), async () => {
        const list = readOutbox(uid);
        const keep = [];
        const picked = [];
        list.forEach((item) => {
          if (now - item.firstAt > OUTBOX_MAX_AGE_MS || item.attempts >= OUTBOX_MAX_ATTEMPTS) {
            droppedItems.push({ item, reason: "Yeniden deneme süresi/sayısı doldu." });
            return;
          }
          keep.push(item);
          if (item.nextAt <= now) picked.push(item);
        });
        if (droppedItems.length) writeOutbox(uid, keep);
        return picked;
      });
      if (!due.length && !droppedItems.length) return { sent: 0, dropped: 0, pending: readOutbox(uid).length, droppedItems };

      // 2) Ağ istekleri kilit DIŞINDA yapılır (yeni öğe eklenebilsin).
      const results = new Map();
      for (const item of due) {
        results.set(itemId(item), await this.attemptSend(item.payload, 1));
      }

      // 3) Sonuçları güncel kuyruğa öğe bazında uygula.
      let sent = 0;
      const pending = await runExclusive(outboxLock(uid), async () => {
        const next = [];
        readOutbox(uid).forEach((item) => {
          const id = itemId(item);
          if (!results.has(id)) {
            next.push(item);
            return;
          }
          const res = results.get(id);
          if (res.success) {
            sent += 1;
          } else if (isRetryable(res) || res.code === "no_session") {
            const quotaWait = ["daily_quota", "monthly_quota"].includes(res.code);
            // Kota beklemesi deneme hakkından düşmez (öğenin kusuru değil); süre 24 saat sınırıyla zaten sonlanır.
            const attempts = quotaWait ? item.attempts : item.attempts + 1;
            const backoffMs = OUTBOX_BACKOFF_MIN[Math.min(item.attempts, OUTBOX_BACKOFF_MIN.length - 1)] * 60 * 1000;
            const waitMs = Math.max(backoffMs, (res.retryAfter || 0) * 1000);
            if (attempts >= OUTBOX_MAX_ATTEMPTS) {
              droppedItems.push({ item, reason: res.message || "Yeniden deneme sayısı doldu." });
            } else {
              next.push({ ...item, attempts, lastAt: now, nextAt: now + waitMs });
            }
          } else if (res.deferred) {
            // Sunucu günlük özete aldı: yeniden gönderilirse mükerrer olur.
            droppedItems.push({ item, reason: "Günlük kota nedeniyle özete eklendi.", quiet: true });
          } else {
            droppedItems.push({ item, reason: res.message || "Kalıcı hata." });
          }
        });
        writeOutbox(uid, next);
        return next.length;
      });
      return { sent, dropped: droppedItems.length, pending, droppedItems };
    });

    if (!outcome) return { sent: 0, dropped: 0, pending: this.outboxSize(), skipped: true };
    (outcome.droppedItems || []).forEach(({ item, reason, quiet }) => {
      if (!quiet) this._reportDropped(item, reason);
    });
    return { sent: outcome.sent, dropped: outcome.dropped, pending: outcome.pending };
  },

  outboxSize() {
    const uid = currentUid();
    return uid ? readOutbox(uid).length : 0;
  },

  /** Çıkışta çağrılabilir: kuyruğu (alıcı adresleri içerir) siler. */
  clearOutbox(uid) {
    const target = uid || currentUid();
    if (!target) return;
    try {
      window.localStorage?.removeItem(OUTBOX_PREFIX + target);
    } catch {
      /* sessiz geç */
    }
  },

  /** Kuyruktan kalıcı olarak düşen e-postayı aktivite kaydına yazar (kalıcı başarısızlık görünür olsun). */
  async _reportDropped(item, reason) {
    try {
      const { default: ParlaDb } = await import("./firebase-client.js");
      const user = window.__PARLA_FIREBASE?.auth?.currentUser || {};
      const payload = item.payload || {};
      const ageMin = Math.max(0, Math.round((Date.now() - item.firstAt) / 60000));
      const details = [
        `${payload.type || "e-posta"} — kuyruktan düşürüldü: ${reason}`,
        `${item.attempts} yeniden deneme`,
        `${ageMin} dk`,
        `${Array.isArray(payload.to) ? payload.to.length : payload.to ? 1 : 0} alıcı`,
      ].join(" · ");
      await ParlaDb.logActivity(
        "email_failed",
        "ticket",
        payload.ticketData?.ticket_id || "",
        "",
        details.slice(0, 300),
        { uid: user.uid || currentUid(), name: user.displayName || user.email || "" }
      );
    } catch {
      /* günlük yazılamadıysa sessiz geç */
    }
  },

  /**
   * Ticket olayları için bildirim. `to` tek adres ya da dizi olabilir; sunucu talep sahibi ve
   * personel için ayrı (doğru bağlantılı) e-postalar üretir.
   *
   * `extra`: { message_id?, history_id? } — sunucu bildirim metnini bu kayıtlardan okur (varsa).
   * Eski çağrılardaki `extra.note` / `extra.portalUrl` GÖNDERİLMEZ (sunucu yok sayar). `extra.message?.id` / `extra.history?.id` de kabul edilir.
   * `site-config` destek adresiyle eşleşen alıcı sembolik "@support" olarak gönderilir (adres tek kaynakta: sunucu env).
   */
  async notifyTicketEvent(eventType, to, ticket, extra) {
    extra = extra || {};
    const cfg = (typeof window !== "undefined" && window.__PARLA_SITE_CONFIG) || {};
    const contact = String(cfg.CONTACT_EMAIL || "").trim().toLowerCase();
    const recipients = uniqueEmails(Array.isArray(to) ? to : [to])
      .filter((r) => r.startsWith("@") || EMAIL_RE.test(r))
      .map((r) => (contact && r === contact ? SUPPORT_RECIPIENT : r));
    const unique = uniqueEmails(recipients);
    if (!unique.length) {
      return { success: true, message: "Alıcı yok; e-posta gönderilmedi.", data: { skipped: true } };
    }

    const messageId = extra.message_id || extra.messageId || extra.message?.id || "";
    const historyId = extra.history_id || extra.historyId || extra.history?.id || "";
    const refs = {};
    if (messageId) refs.message_id = String(messageId);
    if (historyId) refs.history_id = String(historyId);

    return this.send({
      type: eventType,
      to: unique,
      ticketData: { ticket_id: ticket?.id || ticket?.ticket_id || extra.ticket_id || "" },
      extra: Object.keys(refs).length ? refs : null,
    });
  },

  /**
   * GET /api/send-email — erişilebilirlik + destek adresi (kimliksiz); oturum açık yönetici ise yapılandırma ve günlük kota.
   * @returns {{reachable: boolean, configured: boolean|null, from?: string, contact?: string, quota?: object, message?: string}}
   */
  async health() {
    try {
      const token = await getIdToken(false);
      const { json } = await fetchJson(getEmailApiUrl(), {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (json.success !== true) return { reachable: false, configured: false, message: json.message };
      return {
        reachable: true,
        configured: json.configured === undefined ? null : !!json.configured,
        from: json.from || "",
        contact: json.contact || "",
        quota: json.quota || null,
      };
    } catch {
      return { reachable: false, configured: false, message: "E-posta servisine ulaşılamadı." };
    }
  },

  /** Resend alan adı doğrulama durumu (yalnızca admin rolleri). */
  async diagnose() {
    const res = await this.send({ type: "diagnostic", to: "diagnostic@invalid.local" });
    return res;
  },

  /** Giriş yapan yöneticinin kendi adresine test e-postası gönderir. */
  async sendTest() {
    const me = window.__PARLA_FIREBASE?.auth?.currentUser?.email || "";
    return this.send({ type: "test_email", to: me || "test@invalid.local" });
  },
};

function startScheduler() {
  const run = () => ParlaEmailService.flushOutbox().catch(() => {});
  window.addEventListener("online", run);
  const first = setTimeout(run, 4000);
  const timer = setInterval(run, 60000);
  if (first && typeof first.unref === "function") first.unref();
  if (timer && typeof timer.unref === "function") timer.unref();
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  startScheduler();
}

export { ParlaEmailService, uniqueEmails, emailFailureMessage, emailFailureDetails };
export default ParlaEmailService;
