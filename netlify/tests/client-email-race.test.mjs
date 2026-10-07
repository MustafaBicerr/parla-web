/**
 * İstemci e-posta servisi: yanıt doğrulama (res.ok + success), zaman aşımı, kuyruk yarışları (flush kilidi, çok sekme,
 * flush sırasında eklenen öğe, 401), geri çekilme/24 saat/6 deneme semantiği, kota/hız sınırı bekleme, gizlilik.
 * (Denetim B-eposta client-race / client-race-a / client-attempts probe'larından.)
 * Çalıştırma: node --test netlify/tests/client-email-race.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

const store = new Map();
let calls = [];
let responder;
let uid = "u1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ORIGINAL_NAVIGATOR = Object.getOwnPropertyDescriptor(globalThis, "navigator");

/** Web Locks taklidi: aynı ada sahip isteklere karşılıklı dışlama; ifAvailable desteği. */
function installLocks() {
  const held = new Set();
  const waiters = new Map();
  const locks = {
    async request(name, optionsOrFn, maybeFn) {
      const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
      const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
      if (options.ifAvailable && held.has(name)) return fn(null);
      while (held.has(name)) {
        await new Promise((resolve) => waiters.set(name, [...(waiters.get(name) || []), resolve]));
      }
      held.add(name);
      try {
        return await fn({ name });
      } finally {
        held.delete(name);
        const next = (waiters.get(name) || []).shift();
        if (next) next();
      }
    },
  };
  Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true, writable: true });
  return locks;
}

function removeLocks() {
  if (ORIGINAL_NAVIGATOR) Object.defineProperty(globalThis, "navigator", ORIGINAL_NAVIGATOR);
  else delete globalThis.navigator;
}

function setup(options = {}) {
  calls = [];
  store.clear();
  uid = "u1";
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      get length() { return store.size; },
      key: (i) => [...store.keys()][i] ?? null,
    },
    __PARLA_SITE_CONFIG: { EMAIL_API_URL: "/api/send-email", ...(options.config || {}) },
    location: { origin: "https://www.parlabilgiteknolojileri.net" },
    __PARLA_FIREBASE: { auth: { get currentUser() { return { uid, email: "x@y.com", displayName: "X Y", getIdToken: async (force) => (force ? "fresh" : "tok") }; } } },
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : null, init, t: Date.now() });
    return responder(calls.length, init);
  };
}

const res = (status, body, headers) => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, headers: { get: (k) => (headers || {})[String(k).toLowerCase()] || "" } };
};

const { default: Email, emailFailureMessage, emailFailureDetails } = await import("../../assets/js/support-v2/email-service.js");
const { default: Email2 } = await import("../../assets/js/support-v2/email-service.js?tab2");

const send = (o, svc = Email) => svc.send({ type: "ticket_message", to: "a@b.com", ticketData: { ticket_id: "T1" }, ...o });
const outbox = () => JSON.parse(store.get("sv2_email_outbox_u1") || "[]");

test.afterEach(() => removeLocks());

// ---------------------------------------------------------------------------------------------------------------
// EML-05: yanıt doğrulama
// ---------------------------------------------------------------------------------------------------------------

test("[EML-05] `success: true` olmayan hiçbir yanıt başarı sayılmaz; 5xx/bad_response yeniden denenebilir ve kuyruğa alınır", async () => {
  const cases = [
    ["502 {errorMessage} (Netlify zaman aşımı JSON)", res(502, { errorMessage: "Task timed out after 10.01 seconds" }), true],
    ["500 {errorType,errorMessage}", res(500, { errorType: "Error", errorMessage: "boom" }), true],
    ["503 {message}", res(503, { message: "Service Unavailable" }), true],
    ["200 ama boş nesne {}", res(200, {}), true],
    ["200 ama success:'true' (string)", res(200, { success: "true" }), true],
    ["404 HTML içinde gömülü {}", res(404, "<html><script>window.x={}</script></html>"), false],
    ["düz metin 502", res(502, "Internal Error. ID: 01ABC"), true],
    ["200 HTML (SPA yönlendirmesi)", res(200, "<html>app</html>"), true],
  ];
  for (const [label, response, retryable] of cases) {
    setup();
    responder = () => response;
    const r = await send({ requestId: `c-${label.length}` });
    assert.equal(r.success, false, label);
    assert.equal(!!r.queued, retryable, `${label}: kuyruk`);
    assert.equal(outbox().length, retryable ? 1 : 0, label);
  }
});

test("HTTP 200 + success:true başarıdır; kısmi başarı işaretlenir; 4xx yeniden denenmez", async () => {
  setup();
  responder = () => res(200, { success: true, partial: true, message: "ok", data: { skipped: [{ code: "not_allowed" }] } });
  const r = await send({});
  assert.equal(r.success, true);
  assert.equal(r.partial, true);
  responder = () => res(403, { success: false, code: "recipient_not_allowed", message: "x" });
  calls = [];
  const denied = await send({});
  assert.equal(denied.success, false);
  assert.equal(calls.length, 1);
  assert.equal(denied.queued, undefined);
});

test("[EML-12] istemci zaman aşımı (AbortController): askıdaki istek 'network' olarak sonlanır ve kuyruğa alınır", async () => {
  setup({ config: { EMAIL_TIMEOUT_MS: 120 } });
  let aborted = 0;
  responder = (n, init) =>
    new Promise((resolve, reject) => {
      const keep = setTimeout(() => {}, 3000);
      init.signal.addEventListener("abort", () => {
        aborted += 1;
        clearTimeout(keep);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    });
  const t0 = Date.now();
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await Email.attemptSend({ type: "ticket_message", to: ["a@b.com"] }, 1);
    assert.equal(r.code, "network");
    assert.ok(Date.now() - t0 < 2000);
    assert.equal(aborted, 1);
  } finally {
    console.error = orig;
  }
});

test("[EML-13] kota/hız sınırı: Retry-After > 3 sn ise anında tekrar denenmez, kuyruğa bekleme süresiyle alınır; ertelenen (deferred) kuyruğa alınmaz", async () => {
  setup();
  responder = () => res(429, { success: false, code: "rate_limited_user", message: "çok sık", retry_after: 40 }, { "retry-after": "40" });
  const r = await send({ requestId: "rl" });
  assert.equal(calls.length, 1, "uzun beklemede döngüye girmez");
  assert.equal(r.queued, true);
  assert.ok(outbox()[0].nextAt - Date.now() > 35_000, "nextAt Retry-After'i gözetir");

  setup();
  responder = () => res(429, { success: false, code: "daily_quota", deferred: true, message: "özete eklendi", retry_after: 3600 });
  const d = await send({});
  assert.equal(d.deferred, true);
  assert.equal(d.queued, undefined, "sunucu özete aldı: yeniden gönderilirse mükerrer olurdu");
  assert.equal(outbox().length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// EML-08: geri çekilme, 24 saat, 6 deneme
// ---------------------------------------------------------------------------------------------------------------

test("[EML-08] kalıcı 503: 6 flush denemesi (0, +5, +30, +120, +360, +720 dk ≈ 20 sa) ya da 24 saat; eskiden ≈3 dk'da düşerdi", async () => {
  setup({ config: {} });
  responder = () => res(503, { success: false, message: "geçici" });
  await send({ requestId: "r1" });
  assert.equal(outbox().length, 1);
  const t0 = Date.now();
  const delaysMin = [0, 5, 30, 120, 360, 720];
  let now = t0;
  const log = [];
  for (let i = 0; i < 6; i += 1) {
    now += delaysMin[i] * 60_000 + 1000;
    const before = calls.length;
    const r = await Email.flushOutbox({ now });
    log.push([i + 1, calls.length - before, r.pending, r.dropped]);
    if (i < 5) assert.equal(r.pending, 1, `deneme ${i + 1} sonrası kuyrukta`);
  }
  assert.equal(log[5][3], 1, "6. başarısız denemeden sonra düşer");
  assert.equal(outbox().length, 0);
  assert.ok(now - t0 > 20 * 3600 * 1000, "≈20 saat boyunca denendi (eski hata: ≈3 dk'da düşme)");
  assert.ok(now - t0 < 24 * 3600 * 1000, "24 saat içinde sonlandı");
});

test("[EML-08] zamanı gelmemiş öğe denenmez; sayfa gezintisindeki ek flush geri çekilmeyi atlamaz", async () => {
  setup();
  responder = () => res(503, { success: false, message: "geçici" });
  await send({ requestId: "r2" });
  const t0 = Date.now();
  await Email.flushOutbox({ now: t0 + 1000 }); // 1. başarısız → nextAt = +5 dk
  calls = [];
  for (let i = 0; i < 5; i += 1) await Email.flushOutbox({ now: t0 + 2000 + i * 1000 });
  assert.equal(calls.length, 0, "5 ek flush ağ isteği üretmedi");
});

test("[EML-08] 24 saat dolan öğe düşer ve aktiviteye yazılır; eski sürüm kuyruk biçimi (attempts:3) sıfırdan şemaya geçer", async () => {
  setup();
  store.set("sv2_email_outbox_u1", JSON.stringify([
    { payload: { type: "ticket_message", to: ["a@b.com"], ticketData: { ticket_id: "T1" }, requestId: "old1" }, attempts: 3, firstAt: Date.now() - 100_000, lastAt: Date.now() },
    { payload: { type: "ticket_message", to: ["a@b.com"], ticketData: { ticket_id: "T2" }, requestId: "old2" }, attempts: 1, firstAt: Date.now() - 25 * 3600_000, lastAt: Date.now(), nextAt: 1 },
  ]));
  responder = () => res(200, { success: true, message: "ok" });
  const r = await Email.flushOutbox();
  assert.deepEqual(r, { sent: 1, dropped: 1, pending: 0 }, "eski biçim gönderildi; 25 saatlik düştü");
  assert.deepEqual(calls.map((c) => c.body.requestId), ["old1"]);
});

test("kota beklemesi (daily_quota) deneme hakkından düşmez; yalnızca 24 saat sınırı geçerlidir", async () => {
  setup();
  responder = () => res(429, { success: false, code: "daily_quota", message: "kota", retry_after: 4 * 3600 }, { "retry-after": "14400" });
  await send({ requestId: "q1" });
  const t0 = Date.now();
  for (let i = 1; i <= 5; i += 1) await Email.flushOutbox({ now: t0 + i * 4.1 * 3600_000 }); // 20,5 saate kadar
  assert.equal(calls.length, 1 + 5, "her 4 saatte bir denendi");
  assert.equal(outbox().length, 1, "hâlâ kuyrukta");
  assert.equal(outbox()[0].attempts, 0, "deneme sayacı artmadı");
});

// ---------------------------------------------------------------------------------------------------------------
// EML-09: kuyruk yarışları
// ---------------------------------------------------------------------------------------------------------------

test("[EML-09a] flush sürerken eklenen e-posta flush sonunda KAYBOLMAZ", async () => {
  setup();
  installLocks();
  responder = () => res(503, { success: false, message: "geçici" });
  await send({ requestId: "X", ticketData: { ticket_id: "TX" } });
  assert.equal(outbox().length, 1);

  let release;
  const gate = new Promise((r) => { release = r; });
  let xStarted = false;
  responder = async (n, init) => {
    const b = JSON.parse(init.body);
    if (b.requestId === "X") { xStarted = true; await gate; return res(200, { success: true, message: "ok" }); }
    return res(503, { success: false, message: "geçici" });
  };
  const flushing = Email.flushOutbox();
  while (!xStarted) await sleep(5);
  const sendY = send({ requestId: "Y", ticketData: { ticket_id: "TY" } }); // kullanıcı o sırada yeni işlem yapar
  while (outbox().length < 2) await sleep(20); // Y'nin 3 denemesi bitip kuyruğa girer
  release();
  const [f] = await Promise.all([flushing, sendY]);
  assert.equal(f.sent, 1);
  assert.deepEqual(outbox().map((i) => i.payload.requestId), ["Y"], "Y kayboldu mu? (beklenen: kalır)");
});

test("[EML-09b] iki sekme: flush yalnızca tek sekmede çalışır; her öğe tek kez istenir; sahte 'kalıcı hata' ile düşürme yok", async () => {
  setup();
  installLocks();
  responder = () => res(503, { success: false, message: "geçici" });
  await send({ requestId: "Z1" });
  await send({ requestId: "Z2" });
  calls = [];
  const seen = new Set();
  responder = async (n, init) => {
    const id = JSON.parse(init.body).requestId;
    await sleep(40);
    if (seen.has(id)) return res(409, { success: false, code: "concurrent_request", message: "x" });
    seen.add(id);
    return res(200, { success: true, message: "ok" });
  };
  const [r1, r2] = await Promise.all([Email.flushOutbox(), Email2.flushOutbox()]);
  const results = [r1, r2];
  assert.equal(results.filter((r) => r.skipped).length, 1, "ikinci sekme bekletilmeden atlandı");
  assert.equal(calls.length, 2, "2 öğe için yalnızca 2 istek");
  assert.equal(results.reduce((a, r) => a + r.dropped, 0), 0);
  assert.equal(outbox().length, 0);
});

test("[EML-09b] 409 concurrent_request yeniden denenebilir (kalıcı hata sayılıp düşürülmez)", async () => {
  setup();
  responder = () => res(503, { success: false, message: "geçici" });
  await send({ requestId: "W1" });
  responder = () => res(409, { success: false, code: "concurrent_request", message: "x" });
  const r = await Email.flushOutbox();
  assert.deepEqual(r, { sent: 0, dropped: 0, pending: 1 });
});

test("[EML-09c] flush sırasında 401: token yenilenip aynı öğe bir kez daha denenir (düşürülmez)", async () => {
  setup();
  responder = () => res(503, { success: false, message: "geçici" });
  await send({ requestId: "V1" });
  calls = [];
  responder = (n, init) => (init.headers.Authorization === "Bearer fresh" ? res(200, { success: true, message: "ok" }) : res(401, { success: false, code: "bad_claims", message: "x" }));
  const r = await Email.flushOutbox();
  assert.deepEqual(r, { sent: 1, dropped: 0, pending: 0 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Authorization, "Bearer fresh");
});

test("eşzamanlı send() çağrıları kuyruğu ezmez (okuma-değiştirme-yazma serileştirilir)", async () => {
  setup();
  installLocks();
  responder = () => res(503, { success: false, message: "geçici" });
  await Promise.all(Array.from({ length: 6 }, (_, i) => send({ requestId: `p${i}` })));
  assert.equal(outbox().length, 6);
});

test("no_session: oturum yokken flush öğeyi düşürmez", async () => {
  setup();
  responder = () => res(503, { success: false, message: "geçici" });
  await send({ requestId: "ns" });
  globalThis.window.__PARLA_FIREBASE.auth = { get currentUser() { return { uid, getIdToken: async () => null }; } };
  const r = await Email.flushOutbox();
  assert.equal(r.dropped, 0);
  assert.equal(r.pending, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// EML-26: gizlilik
// ---------------------------------------------------------------------------------------------------------------

test("[EML-26] kuyruğa mesaj metni girmez (yalnızca kimlikler); notifyTicketEvent note göndermez; çıkışta temizlenir; yabancı yaşlı kuyruklar süpürülür", async () => {
  setup();
  responder = () => res(503, { success: false, message: "geçici" });
  await Email.notifyTicketEvent("ticket_message", ["danisman@parla.com"], { id: "TG" }, { note: "Müşterinin gizli iş bilgisi: IBAN TR00", message_id: "m9" });
  const raw = store.get("sv2_email_outbox_u1");
  assert.doesNotMatch(raw, /IBAN|gizli iş/);
  assert.match(raw, /"message_id":"m9"/);

  // başka kullanıcıya ait yaşlı kuyruk süpürülür; taze olan kalır
  store.set("sv2_email_outbox_old", JSON.stringify([{ payload: { requestId: "z" }, firstAt: Date.now() - 30 * 3600_000 }]));
  store.set("sv2_email_outbox_fresh", JSON.stringify([{ payload: { requestId: "f" }, firstAt: Date.now() - 1000 }]));
  responder = () => res(200, { success: true, message: "ok" });
  await Email.flushOutbox({ now: Date.now() + 1000 });
  assert.equal(store.has("sv2_email_outbox_old"), false);
  assert.equal(store.has("sv2_email_outbox_fresh"), true);

  Email.clearOutbox("u1");
  assert.equal(store.has("sv2_email_outbox_u1"), false);
});

test("parola içeren/hesap e-postaları ve test/tanılama kuyruğa alınmaz", async () => {
  for (const type of ["user_credentials", "test_email", "diagnostic"]) {
    setup();
    responder = () => res(503, { success: false, message: "geçici" });
    const r = await Email.send({ type, to: "a@b.com", ticketData: { password: "gizli" } });
    assert.equal(r.queued, undefined, type);
    assert.equal(outbox().length, 0);
    assert.equal([...store.values()].some((v) => v.includes("gizli")), false);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// EML-30: hata metinleri sade; ayrıntı aktivite kaydında
// ---------------------------------------------------------------------------------------------------------------

test("[EML-30/SEN-41/MUS-30] kullanıcı metni sade: altyapı adı yok; yalnızca yöneticiye gelen `detail` eklenir; aktivite ayrıntısı zengin", () => {
  const customerView = emailFailureMessage({ success: false, code: "not_configured", status: 500, message: "E-posta servisi şu an kullanılamıyor." }, "Yanıt bildirimi");
  assert.equal(customerView, "Yanıt bildirimi şu an gönderilemedi; otomatik olarak yeniden denenecek.");
  assert.doesNotMatch(customerView, /RESEND|API|DNS|Netlify|function|404/i);
  assert.equal(emailFailureMessage({ success: false, code: "recipient_not_allowed", status: 403 }, "Bildirim e-postası"), "Bildirim e-postası gönderilemedi.");
  assert.match(emailFailureMessage({ success: false, deferred: true, code: "daily_quota" }, "Yanıt bildirimi"), /kaydınız alındı/);
  assert.match(emailFailureMessage({ success: false, code: "domain_not_verified", status: 502, detail: "Gönderen alan adı doğrulanmamış." }, "Bildirim"), /\(Gönderen alan adı doğrulanmamış\.\)$/);

  const details = emailFailureDetails({ code: "rate_limited_user", status: 429, message: "Çok sık", queued: true, recipientCount: 3, partial: true }, { eventType: "ticket_message" });
  assert.match(details, /ticket_message — \[rate_limited_user\] Çok sık · HTTP 429 · kuyruğa alındı · 3 alıcı · kısmi/);
  assert.ok(details.length <= 300);
});

test("health: kimlik token'ıyla yapılandırma/kota; kimliksiz yalnızca erişilebilirlik + contact", async () => {
  setup();
  responder = (n, init) =>
    init.headers.Authorization
      ? res(200, { success: true, configured: true, from: "info@x.com", contact: "info@x.com", quota: { used: 3, soft_limit: 80, hard_limit: 95 } })
      : res(200, { success: true, contact: "info@x.com" });
  const withToken = await Email.health();
  assert.deepEqual([withToken.reachable, withToken.configured, withToken.quota.used], [true, true, 3]);
  globalThis.window.__PARLA_FIREBASE.auth = { currentUser: null };
  const anon = await Email.health();
  assert.deepEqual([anon.reachable, anon.configured, anon.contact], [true, null, "info@x.com"]);
});
