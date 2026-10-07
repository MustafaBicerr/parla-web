/**
 * WP-04 sertleştirme testleri (denetim B-eposta fn-abuse/matrix probe'larından): alıcı/içerik sunucu türetimi, portalUrl yok
 * sayma, CORS/Origin, hız sınırı, günlük kota, olay tekilleştirme, kısmi başarı, hata sadeleştirme, CRLF konu.
 * Çalıştırma: node --test netlify/tests/send-email-hardening.test.js   (openssl gerekir)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { mock } = require("node:test");
const { createFixture, TOKENS, post, withEnv, response, makeToken, b64, certPem, privateKey, PROJECT } = require("./helpers/fn-fixture");

process.env.RESEND_API_KEY = "re_test";
const { handler } = require("../functions/send-email");
const { resetCertCache, verifyIdToken } = require("../lib/firebase-auth");
const { MemoryStore, setStoreForTests } = require("../lib/guard-store");
const guard = require("../lib/email-guard");

const fx = createFixture();
let store;
let restoreEnv = () => {};

test.beforeEach(() => {
  fx.reset();
  fx.install();
  resetCertCache();
  store = new MemoryStore();
  setStoreForTests(store);
  restoreEnv = withEnv({
    SITE_URL: null,
    CONTACT_EMAIL: null,
    ALLOWED_ORIGINS: null,
    RESEND_TIMEOUT_MS: null,
    DAILY_EMAIL_SOFT_LIMIT: null,
    DAILY_EMAIL_HARD_LIMIT: null,
    AWS_LAMBDA_FUNCTION_NAME: null,
    CONTEXT: null,
    RATE_LIMIT_MODE: "strict", // geliştirmede varsayılanlar gevşektir; sınır testleri üretim değerlerini kullanır
  });
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
});

test.afterEach(() => {
  restoreEnv();
  mock.restoreAll();
});

const ticketMail = (type, to, extra, ticketId) => ({ type, to, ticketData: { ticket_id: ticketId || "T1" }, extra });
const json = (res) => JSON.parse(res.body);
const sentTo = () => fx.resendCalls.flatMap((c) => c.payload.to).sort();

function addMessage(ticketId, id, uid, message, extra) {
  fx.db.v2.ticket_messages[ticketId][id] = {
    message_id: id, user_id: uid, author_name: "Yazar Kişi", message, is_internal: false, created_at: new Date().toISOString(), ...extra,
  };
}
function addHistory(ticketId, id, uid, note, extra) {
  fx.db.v2.ticket_history[ticketId][id] = {
    action: "status_note", note, changed_by_uid: uid, changed_by_name: "Ali Veli", changed_at: new Date().toISOString(), ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// EML-02 / MUS-05 / SEC-06: alıcı sunucu türetimi
// ---------------------------------------------------------------------------------------------------------------

test("[EML-02] müşteri, user_email'i başkasının adresi olan talep üzerinden DIŞ adrese posta gönderemez", async () => {
  for (const type of ["ticket_message", "ticket_created"]) {
    const res = await post(handler, ticketMail(type, ["kurban@baska-firma.example"], { note: "kimlik avı" }, "EVIL"), TOKENS.customer2());
    assert.equal(res.statusCode, 403, type);
    assert.equal(json(res).code, "recipient_not_allowed");
  }
  assert.equal(fx.resendCalls.length, 0);
});

test("[EML-02] müşteri çağrısında ticket.user_email güvenilmez; yalnızca destek kutusu + atama + kendi adresi", async () => {
  // EVIL talebinin sahibi uid-cust2 (kotu@abc.com): kendi adresine ve destek kutusuna gidebilir.
  const ok = await post(handler, ticketMail("ticket_created", ["kotu@abc.com", "@support"], null, "EVIL"), TOKENS.customer2());
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(sentTo(), ["info@parlabilgiteknolojileri.net", "kotu@abc.com"]);
});

test("[MUS-05] personel çağrısında talep sahibi kullanıcı profilinden çözülür (müşterinin yazdığı user_email değil)", async () => {
  // Müşteri user_email'i sahte adrese çevirmiş; profildeki gerçek adres musteri@abc.com
  fx.db.v2.tickets.T1.user_email = "kurban@baska-firma.example";
  const forged = await post(handler, ticketMail("ticket_status_changed", ["kurban@baska-firma.example"]), TOKENS.staff());
  assert.equal(forged.statusCode, 200, forged.body);
  assert.deepEqual(sentTo(), ["musteri@abc.com"], "talepte saklı sahte adres 'talep sahibi' takma adıdır: posta profildeki gerçek adrese gider, kurbana ASLA");
  const real = await post(handler, ticketMail("ticket_status_changed", ["@owner"]), TOKENS.staff());
  assert.equal(real.statusCode, 200, real.body);
  assert.ok(fx.resendCalls.every((c) => c.payload.to.every((a) => a === "musteri@abc.com")));
  const stranger = await post(handler, ticketMail("ticket_status_changed", ["baska-kurban@example.com"]), TOKENS.staff());
  assert.equal(stranger.statusCode, 403);
});

test("müşteri başka bir müşterinin talebi için posta tetikleyemez (RTDB erişimi yok)", async () => {
  const res = await post(handler, ticketMail("ticket_message", ["@support"], null, "T1"), TOKENS.customer2());
  assert.equal(res.statusCode, 403);
  assert.equal(json(res).code, "db_denied");
});

test("sembolik alıcılar: @support, @assigned, @owner sunucuda çözülür; destek adresi env'den (tek kaynak)", async () => {
  const restore = withEnv({ CONTACT_EMAIL: "Destek@Parla.com" });
  try {
    const res = await post(handler, ticketMail("ticket_message", ["@support", "@assigned"]), TOKENS.customer());
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(sentTo(), ["danisman@parla.com", "destek@parla.com"]);
  } finally {
    restore();
  }
});

test("eski istemci site-config adresiyle (env değişmişse): o alıcı ayıklanır, kalanlara gider (EML-11)", async () => {
  const restore = withEnv({ CONTACT_EMAIL: "destek@parla.com" });
  try {
    const res = await post(handler, ticketMail("ticket_message", ["info@parlabilgiteknolojileri.net", "danisman@parla.com"]), TOKENS.customer());
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(json(res).partial, true);
    assert.deepEqual(sentTo(), ["danisman@parla.com"]);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// EML-10: kısmi başarı
// ---------------------------------------------------------------------------------------------------------------

test("[EML-10] tek geçersiz/yetkisiz alıcı tüm bildirimi düşürmez: kalan gönderilir, partial + skipped (adres sızmaz)", async () => {
  const res = await post(
    handler,
    ticketMail("ticket_message", ["@support", "danisman@parla.com", "bozuk-adres", "yabanci@gmail.com"]),
    TOKENS.customer()
  );
  const body = json(res);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(body.success, true);
  assert.equal(body.partial, true);
  assert.deepEqual(sentTo(), ["danisman@parla.com", "info@parlabilgiteknolojileri.net"]);
  assert.deepEqual(body.data.skipped.map((s) => s.code).sort(), ["invalid_address", "not_allowed"]);
  assert.doesNotMatch(res.body, /yabanci@gmail|bozuk-adres/, "yanıt adres sızdırmaz");
});

test("[EML-10] hiç geçerli alıcı kalmazsa 400 bad_recipients", async () => {
  const res = await post(handler, ticketMail("ticket_message", ["bozuk", ""]), TOKENS.customer());
  assert.equal(res.statusCode, 400);
  assert.equal(json(res).code, "bad_recipients");
});

test("alıcı sayısı 10'la sınırlıdır (fazlası ayıklanır)", async () => {
  fx.db.v2.ticket_assignments.T1 = {};
  for (let i = 0; i < 15; i += 1) fx.db.v2.ticket_assignments.T1[`p${i}`] = { personnel_email: `d${i}@parla.com` };
  const res = await post(handler, ticketMail("ticket_message", ["@assigned"]), TOKENS.customer());
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(sentTo().length, 10);
  assert.ok(json(res).data.skipped.some((s) => s.code === "too_many"));
});

test("kısmi gönderim hatası: bir kitle gitti, diğeri Resend hatası → partial + hata kodu; yeniden denemede gidenler tekrarlanmaz", async () => {
  let n = 0;
  fx.resendResponder = () => (++n === 2 ? response(503, { name: "internal_server_error", message: "x" }) : response(200, { id: `e${n}` }));
  const body = ticketMail("ticket_status_changed", ["musteri@abc.com", "danisman@parla.com"]);
  body.extra = { history_id: "h1" };
  addHistory("T1", "h1", "uid-staff", "Durum notu burada.");
  const first = await post(handler, { ...body, requestId: "rq1" }, TOKENS.staff());
  assert.equal(first.statusCode, 502);
  assert.equal(json(first).partial, true);
  const second = await post(handler, { ...body, requestId: "rq1" }, TOKENS.staff());
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(fx.resendCalls.length, 3, "ilk istekte 2 + yeniden denemede yalnızca başarısız kitle (tekilleştirme)");
});

// ---------------------------------------------------------------------------------------------------------------
// note / portalUrl: istemci içeriği yok sayılır
// ---------------------------------------------------------------------------------------------------------------

test("[EML-02c] istemci `note` yok sayılır; metin message_id ile VERİTABANINDAN okunur", async () => {
  addMessage("T1", "m1", "uid-cust", "Gerçek mesaj: F110 ayarını kontrol edin.");
  const res = await post(
    handler,
    { ...ticketMail("ticket_message", ["@support"], { note: "SAHTE: hesabınız askıya alındı", message_id: "m1" }), ticketData: { ticket_id: "T1", note: "BASKA SAHTE" } },
    TOKENS.customer()
  );
  assert.equal(res.statusCode, 200, res.body);
  const { html, text } = fx.resendCalls[0].payload;
  assert.match(html, /Gerçek mesaj: F110/);
  assert.doesNotMatch(html + text, /SAHTE|askıya/);
  assert.match(html, /Yazar Kişi/, "yazan kişi DB kaydından");
});

test("başkasının mesajı / dahili not ile message_id verilirse metin eklenmez", async () => {
  addMessage("T1", "m2", "uid-staff", "Personel mesajı (müşteri kimliğiyle gönderilemez)");
  addMessage("T1", "m3", "uid-cust", "Dahili görünen", { is_internal: true });
  for (const id of ["m2", "m3"]) {
    fx.resendCalls.length = 0;
    const res = await post(handler, ticketMail("ticket_message", ["@support"], { message_id: id }), TOKENS.customer());
    assert.equal(res.statusCode, 200);
    assert.doesNotMatch(fx.resendCalls[0].payload.html, /Personel mesajı|Dahili görünen/);
  }
});

test("message_id yoksa (eski istemci) çağıranın son 10 dk içindeki mesajı kullanılır; eskisi/başkasınınki kullanılmaz", async () => {
  addMessage("T1", "-N0001", "uid-cust", "Çok eski mesaj", { created_at: new Date(Date.now() - 3600e3).toISOString() });
  addMessage("T1", "-N0002", "uid-staff", "Personelin yeni mesajı");
  const stale = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer());
  assert.equal(stale.statusCode, 200);
  assert.doesNotMatch(fx.resendCalls[0].payload.html, /Çok eski|Personelin yeni/);

  fx.resendCalls.length = 0;
  addMessage("T1", "-N0003", "uid-cust", "Taze müşteri mesajı");
  const fresh = await post(handler, ticketMail("ticket_message", ["@owner", "@support"]), TOKENS.customer());
  assert.equal(fresh.statusCode, 200, fresh.body);
  assert.match(fx.resendCalls[0].payload.html, /Taze müşteri mesajı/);
});

test("ek adları DB mesajından eklenir (dizi ya da {0:…} nesnesi)", async () => {
  addMessage("T1", "m4", "uid-cust", "Ekran görüntüsü ekte", { attachments: { 0: { id: "a1", name: "analiz.csv" }, 1: { id: "a2", name: "rapor.pdf" } } });
  await post(handler, ticketMail("ticket_message", ["@support"], { message_id: "m4" }), TOKENS.customer());
  assert.match(fx.resendCalls[0].payload.text, /Ekler: analiz\.csv, rapor\.pdf/);
});

test("[SEN-31] uzun mesaj kod noktası/emoji bölünmeden kesilir ve 'devamı portalda' eklenir", async () => {
  addMessage("T1", "m5", "uid-cust", `${"a".repeat(499)}😀😀 son`);
  await post(handler, ticketMail("ticket_message", ["@support"], { message_id: "m5" }), TOKENS.customer());
  const { text } = fx.resendCalls[0].payload;
  assert.match(text, /\(devamı portalda\)/);
  assert.doesNotMatch(text, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/, "yalnız yüksek/alçak vekil kalmaz");
});

test("durum notu geçmiş kaydından (history_id) okunur; başkasının kaydı kullanılmaz", async () => {
  addHistory("T1", "h1", "uid-staff", "Gerçek durum notu burada yazılı.");
  addHistory("T1", "h2", "uid-cons", "Başkasının notu");
  const ok = await post(handler, ticketMail("ticket_status_changed", ["@owner"], { history_id: "h1" }), TOKENS.staff());
  assert.equal(ok.statusCode, 200);
  assert.match(fx.resendCalls[0].payload.html, /Gerçek durum notu/);
  fx.resendCalls.length = 0;
  fx.db.v2.tickets.T1.status = "closed";
  await post(handler, ticketMail("ticket_closed", ["@owner"], { history_id: "h2" }), TOKENS.staff());
  assert.doesNotMatch(fx.resendCalls[0].payload.html, /Başkasının notu/);
});

test("ticket_created: metin talep açıklamasından (DB) gelir", async () => {
  await post(handler, ticketMail("ticket_created", ["@support"], { note: "SAHTE" }), TOKENS.customer());
  assert.match(fx.resendCalls[0].payload.html, /Fatura kesilirken hata alıyorum/);
  assert.doesNotMatch(fx.resendCalls[0].payload.html, /SAHTE/);
});

test("[EML-03] portalUrl tamamen yok sayılır: bağlantılar her zaman SITE_URL/marka adresi", async () => {
  const hostile = [
    "https://evil.netlify.app", "http://evil.netlify.app", "https://EVIL.NETLIFY.APP", "https://xn--evil.netlify.app",
    "https://evil.netlify.app.attacker.com", "https://attacker.com#.netlify.app", "http://localhost:8080",
    "https://www.parlabilgiteknolojileri.net@evil.com", "https://parlabilgiteknolojileri.net.evil.com", "javascript:alert(1)", "//evil.com",
  ];
  for (const portalUrl of hostile) {
    fx.resendCalls.length = 0;
    store = new MemoryStore();
    setStoreForTests(store);
    const body = { type: "ticket_message", to: ["@support"], ticketData: { ticket_id: "T1", portalUrl }, extra: { portalUrl }, portalUrl };
    const res = await post(handler, body, TOKENS.customer());
    assert.equal(res.statusCode, 200, portalUrl);
    const { html, text } = fx.resendCalls[0].payload;
    const hrefs = html.match(/href="([^"]*)"/g) || [];
    assert.ok(hrefs.every((h) => /^href="(https:\/\/www\.parlabilgiteknolojileri\.net|https:\/\/www\.parlabilgiteknolojileri\.net\/[^"]*)"$/.test(h) || h.startsWith('href="https://www.parlabilgiteknolojileri.net')), `${portalUrl}: ${hrefs.join(" ")}`);
    assert.doesNotMatch(html + text, /evil|attacker|localhost|javascript:/i, portalUrl);
  }
});

test("SITE_URL env bağlantı kökünü belirler; geçersiz/şemasız SITE_URL marka adresine düşer; üretimde http://localhost reddedilir", async () => {
  let restore = withEnv({ SITE_URL: "https://destek.parla.com/yol/ignored" });
  await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer());
  restore();
  assert.match(fx.resendCalls[0].payload.html, /href="https:\/\/destek\.parla\.com\/support-v2\/admin\/ticket-detail\.html\?id=T1"/);

  for (const bad of ["javascript:alert(1)", "http://evil.com", "ftp://x", "not a url", "https://u:p@evil.com"]) {
    fx.resendCalls.length = 0;
    setStoreForTests(new MemoryStore());
    restore = withEnv({ SITE_URL: bad });
    await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer());
    restore();
    assert.doesNotMatch(fx.resendCalls[0].payload.html, /evil|javascript:|u:p@|not a url/, bad);
    assert.match(fx.resendCalls[0].payload.html, /href="https:\/\/www\.parlabilgiteknolojileri\.net\//);
  }

  fx.resendCalls.length = 0;
  setStoreForTests(new MemoryStore());
  restore = withEnv({ SITE_URL: "http://localhost:8888", AWS_LAMBDA_FUNCTION_NAME: "send-email" });
  await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer());
  restore();
  assert.doesNotMatch(fx.resendCalls[0].payload.html, /localhost/, "üretimde localhost bağlantısı kurulmaz");
});

test("[CRLF] konu satırı tek satır ve ≤150 karakter (ticket_number/başlık düşmanca)", async () => {
  fx.db.v2.tickets.T1.ticket_number = `TEMP-1\r\nBcc: saldirgan@evil.example\r\nX-Injected: 1 ${"A".repeat(3000)}`;
  fx.db.v2.tickets.T1.title = "<b>x</b>\r\nBcc: y@z.com";
  const res = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer());
  assert.equal(res.statusCode, 200, res.body);
  const { subject } = fx.resendCalls[0].payload;
  assert.doesNotMatch(subject, /[\r\n]/);
  assert.ok(Array.from(subject).length <= 150, `uzunluk ${subject.length}`);
});

// ---------------------------------------------------------------------------------------------------------------
// EML-03 / EML-23: CORS + Origin
// ---------------------------------------------------------------------------------------------------------------

test("[EML-03] *.netlify.app jokeri yok: evil.netlify.app Origin'i 403 ve CORS izni almaz", async () => {
  const res = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer(), { origin: "https://evil.netlify.app" });
  assert.equal(res.statusCode, 403);
  assert.equal(json(res).code, "origin_denied");
  const pre = await handler({ httpMethod: "OPTIONS", headers: { origin: "https://evil.netlify.app" } });
  assert.equal(pre.headers["Access-Control-Allow-Origin"], undefined);
  for (const origin of ["https://parlabilgiteknolojileri.net.evil.com", "https://evil.com", "null", "https://xn--parlabilgiteknolojileri.net"]) {
    const r = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer(), { origin });
    assert.equal(r.statusCode, 403, origin);
  }
  assert.equal(fx.resendCalls.length, 0);
});

test("ALLOWED_ORIGINS: yalnızca açıkça eklenen tam host (deploy önizlemesi) kabul edilir", async () => {
  const restore = withEnv({ ALLOWED_ORIGINS: "deploy-preview-3--parla.netlify.app, https://staging.parla.com/yol" });
  try {
    const a = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer(), { origin: "https://deploy-preview-3--parla.netlify.app" });
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(a.headers["Access-Control-Allow-Origin"], "https://deploy-preview-3--parla.netlify.app");
    const b = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer2(), { origin: "https://deploy-preview-4--parla.netlify.app" });
    assert.equal(b.statusCode, 403);
    const pre = await handler({ httpMethod: "OPTIONS", headers: { origin: "https://staging.parla.com" } });
    assert.equal(pre.headers["Access-Control-Allow-Origin"], "https://staging.parla.com");
  } finally {
    restore();
  }
});

test("[EML-23c] localhost yalnızca geliştirmede; Netlify üretim çalışma zamanında (Lambda) reddedilir", async () => {
  const dev = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer(), { origin: "http://localhost:8888" });
  assert.equal(dev.statusCode, 200, "geliştirmede izinli");

  setStoreForTests(new MemoryStore());
  const restore = withEnv({ AWS_LAMBDA_FUNCTION_NAME: "send-email" });
  try {
    for (const origin of ["http://localhost:8888", "http://127.0.0.1:3000"]) {
      const r = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer(), { origin });
      assert.equal(r.statusCode, 403, origin);
    }
    const pre = await handler({ httpMethod: "OPTIONS", headers: { origin: "http://localhost:8888" } });
    assert.equal(pre.headers["Access-Control-Allow-Origin"], undefined);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------------------------------------------
// EML-04: hız sınırı
// ---------------------------------------------------------------------------------------------------------------

test("[EML-04] 40 ardışık müşteri isteği: yalnızca ilk 5'i geçer, kalanı 429 rate_limited_user + Retry-After", async () => {
  let ok = 0;
  let limited = 0;
  let last = null;
  for (let i = 0; i < 40; i += 1) {
    const res = await post(handler, { ...ticketMail("ticket_message", ["@support"]), requestId: `spam-${i}` }, TOKENS.customer());
    if (res.statusCode === 200) ok += 1;
    if (res.statusCode === 429) {
      limited += 1;
      last = res;
    }
  }
  assert.equal(ok, 5);
  assert.equal(limited, 35);
  assert.equal(json(last).code, "rate_limited_user");
  assert.ok(Number(last.headers["Retry-After"]) >= 1);
  assert.equal(json(last).retry_after, Number(last.headers["Retry-After"]));
  assert.equal(fx.resendCalls.length, 5, "Resend'e yalnızca 5 çağrı gitti");
});

test("sınırlar: geliştirmede gevşek (e2e makine hızı), üretimde (Lambda) her zaman sıkı; RATE_LIMIT_MODE=strict geliştirmede de sıkılaştırır", async () => {
  const burst = async () => {
    setStoreForTests(new MemoryStore());
    let ok = 0;
    for (let i = 0; i < 12; i += 1) {
      const res = await post(handler, { ...ticketMail("ticket_message", ["@support"]), requestId: `b${i}` }, TOKENS.customer());
      if (res.statusCode === 200) ok += 1;
    }
    return ok;
  };
  let restore = withEnv({ RATE_LIMIT_MODE: null });
  assert.equal(await burst(), 12, "geliştirme: gevşek");
  restore();
  restore = withEnv({ RATE_LIMIT_MODE: null, AWS_LAMBDA_FUNCTION_NAME: "send-email" });
  assert.equal(await burst(), 5, "üretim: RATE_LIMIT_MODE olmasa da sıkı");
  restore();
  restore = withEnv({ RATE_LIMIT_MODE: "strict" });
  assert.equal(await burst(), 5, "strict");
  restore();
});

test("saatlik müşteri sınırı (20/sa) ve personel sınırı (120/sa) ayrı uygulanır; reddedilenler pencereye yazılmaz", async () => {
  const t0 = 1_700_000_000_000;
  const windows = guard.getLimits({}).customer;
  let allowed = 0;
  for (let i = 0; i < 30; i += 1) {
    const r = await guard.consumeRate(store, "u", "x", windows, t0 + i * 20_000); // 3/dk: dakikalık sınır geçmez
    if (r.ok) allowed += 1;
  }
  assert.equal(allowed, 20, "saatlik 20 sınırı");
  const staff = guard.getLimits({}).staff;
  let staffOk = 0;
  for (let i = 0; i < 130; i += 1) {
    if ((await guard.consumeRate(store, "u", "s", staff, t0 + i * 20_000)).ok) staffOk += 1;
  }
  assert.equal(staffOk, 120);
  // Reddedilen istekler pencereyi uzatmaz: 1 saat sonra tekrar izin verilir.
  assert.equal((await guard.consumeRate(store, "u", "x", windows, t0 + 3600_000 + 700_000)).ok, true);
});

test("talep başına sınır (40/sa): farklı kullanıcılar aynı talebi boğamaz", async () => {
  const restore = withEnv({ RATE_TICKET_PER_HOUR: "3" });
  try {
    let limited = null;
    for (let i = 0; i < 6; i += 1) {
      const token = i % 2 ? TOKENS.staff() : TOKENS.consultant();
      const res = await post(handler, { ...ticketMail("ticket_status_changed", ["@owner"]), requestId: `t${i}` }, token);
      if (res.statusCode === 429) limited = res;
    }
    assert.ok(limited);
    assert.equal(json(limited).code, "rate_limited_ticket");
  } finally {
    restore();
  }
});

test("reddedilenler loglanır (uid + tip + kod; adres/metin yok)", async () => {
  await post(handler, ticketMail("ticket_message", ["yabanci@gmail.com"]), TOKENS.customer());
  const calls = console.warn.mock.calls.map((c) => JSON.stringify(c.arguments));
  const line = calls.find((c) => c.includes("reddedildi"));
  assert.ok(line, "reddetme logu var");
  assert.match(line, /uid-cust/);
  assert.match(line, /recipient_not_allowed/);
  assert.doesNotMatch(line, /yabanci@gmail/);
});

// ---------------------------------------------------------------------------------------------------------------
// D-04 A: günlük kota + günlük özet
// ---------------------------------------------------------------------------------------------------------------

test("[D-04] günlük kota: yumuşak sınırda düşük öncelikli bildirim 429 daily_quota + özete eklenir; yüksek öncelikli sert sınıra dek gider", async () => {
  const restore = withEnv({ DAILY_EMAIL_SOFT_LIMIT: "2", DAILY_EMAIL_HARD_LIMIT: "4", RATE_STAFF_PER_MIN: "100", RATE_STAFF_PER_HOUR: "1000", RATE_TICKET_PER_HOUR: "1000" });
  try {
    const low = (id) => post(handler, { ...ticketMail("ticket_status_changed", ["@owner"]), requestId: id }, TOKENS.staff());
    assert.equal((await low("a")).statusCode, 200);
    assert.equal((await low("b")).statusCode, 200);
    const deferred = await low("c");
    assert.equal(deferred.statusCode, 429);
    assert.equal(json(deferred).code, "daily_quota");
    assert.equal(json(deferred).deferred, true);
    assert.ok(Number(deferred.headers["Retry-After"]) >= 1);
    assert.equal(fx.resendCalls.length, 2);

    const digest = await store.get(`digest:${guard.dayKey()}`);
    assert.equal(digest.length, 1);
    assert.deepEqual(Object.keys(digest[0]).sort(), ["at", "audience", "event", "ticket_number", "title"], "özet kaydında kişisel veri yok");

    // Yüksek öncelikli (atama) sert sınıra kadar gider: kullanılan 2 + 1 + 1 = 4
    const high = (id) => post(handler, { ...ticketMail("ticket_assigned", ["danisman@parla.com"]), requestId: id }, TOKENS.staff());
    assert.equal((await high("h1")).statusCode, 200);
    assert.equal((await high("h2")).statusCode, 200);
    const over = await high("h3");
    assert.equal(over.statusCode, 429);
    assert.equal(json(over).code, "daily_quota");
    assert.equal(json(over).deferred, undefined, "yüksek öncelikli özete ertelenmez");
    assert.equal(fx.resendCalls.length, 4);
  } finally {
    restore();
  }
});

test("kota Resend hatasında iade edilir; Resend 'daily_quota_exceeded' dediğinde gün sonuna dek doldu sayılır", async () => {
  fx.resendResponder = () => response(503, { name: "internal_server_error", message: "x" });
  await post(handler, ticketMail("ticket_status_changed", ["@owner"]), TOKENS.staff());
  assert.equal((await guard.getQuota(store, guard.getLimits({}))).used, 0, "başarısız gönderimde iade");

  fx.resendResponder = () => response(429, { name: "daily_quota_exceeded", message: "quota" });
  const res = await post(handler, ticketMail("ticket_assigned", ["danisman@parla.com"]), TOKENS.staff());
  assert.equal(res.statusCode, 429);
  assert.equal(json(res).code, "daily_quota");
  assert.ok(Number(res.headers["Retry-After"]) >= 1);
  assert.equal((await guard.getQuota(store, guard.getLimits({}))).used, 95, "sayaç sert sınıra çekildi");
});

test("Resend hata eşlemesi: rate_limit/monthly/concurrent/invalid_idempotent", async () => {
  const cases = [
    [429, { name: "rate_limit_exceeded", message: "Too many" }, 429, "rate_limited"],
    [429, { name: "monthly_quota_exceeded", message: "m" }, 429, "monthly_quota"],
    [409, { name: "concurrent_idempotent_requests", message: "c" }, 409, "concurrent_request"],
    [422, { name: "validation_error", message: "Invalid `to` field" }, 400, "validation_error"],
    [500, { name: "internal_server_error", message: "x" }, 502, "resend_error"],
  ];
  for (const [status, data, expectStatus, expectCode] of cases) {
    setStoreForTests(new MemoryStore());
    fx.resendResponder = () => response(status, data, { "retry-after": "7" });
    const res = await post(handler, ticketMail("ticket_assigned", ["danisman@parla.com"]), TOKENS.staff());
    assert.equal(res.statusCode, expectStatus, `${status} ${data.name}`);
    assert.equal(json(res).code, expectCode);
  }
  // Aynı anahtar farklı içerikle: ilk gönderim zaten kabul edilmiş → başarı (mükerrer değil)
  setStoreForTests(new MemoryStore());
  fx.resendResponder = () => response(409, { name: "invalid_idempotent_request", message: "different payload" });
  const dup = await post(handler, ticketMail("ticket_assigned", ["danisman@parla.com"]), TOKENS.staff());
  assert.equal(dup.statusCode, 200, dup.body);
  assert.equal((await guard.getQuota(store, guard.getLimits({}))).used, 0, "mükerrer sayılan gönderim kotadan düşmez");
  // 403 doğrulama hatası "domain" ifadesi içermiyorsa alan adı hatası sayılmaz (EML-13)
  setStoreForTests(new MemoryStore());
  fx.resendResponder = () => response(403, { name: "validation_error", message: "Invalid to address" });
  const notDomain = await post(handler, ticketMail("ticket_assigned", ["danisman@parla.com"]), TOKENS.staff());
  assert.notEqual(json(notDomain).code, "domain_not_verified");
});

// ---------------------------------------------------------------------------------------------------------------
// Olay tekilleştirme
// ---------------------------------------------------------------------------------------------------------------

test("[EML-04] ticket_created ticket başına kitle başına bir kez; yinelenen istek e-posta üretmez", async () => {
  const send = (id) => post(handler, { ...ticketMail("ticket_created", ["@support"]), requestId: id }, TOKENS.customer());
  assert.equal((await send("c1")).statusCode, 200);
  const dup = await send("c2");
  assert.equal(dup.statusCode, 200);
  assert.equal(json(dup).data.sent.length, 0);
  assert.deepEqual(json(dup).data.deduped, ["staff"]);
  assert.equal(fx.resendCalls.length, 1);
  // Müşteri kitlesi ayrı olaydır (iki paralel çağrı doğal akış)
  const own = await post(handler, ticketMail("ticket_created", ["musteri@abc.com"]), TOKENS.customer());
  assert.equal(own.statusCode, 200);
  assert.equal(fx.resendCalls.length, 2);
});

test("ticket_closed/ticket_reopened: aynı durum örneği için bir kez; yeniden açıp kapatınca (yeni damga) yine gider", async () => {
  fx.db.v2.tickets.T1.status = "closed";
  fx.db.v2.tickets.T1.closed_at = "2026-10-06T10:00:00.000Z";
  const close = (id) => post(handler, { ...ticketMail("ticket_closed", ["@support"]), requestId: id }, TOKENS.customer());
  assert.equal(json(await close("x1")).data.sent.length, 1);
  assert.equal(json(await close("x2")).data.sent.length, 0, "aynı closed_at → tekilleştirildi");
  fx.db.v2.tickets.T1.closed_at = "2026-10-07T10:00:00.000Z";
  assert.equal(json(await close("x3")).data.sent.length, 1, "yeni kapanış → yeni e-posta");

  fx.db.v2.tickets.T1.status = "reopened";
  fx.db.v2.tickets.T1.reopened_at = "2026-10-08T10:00:00.000Z";
  const reopen = (id) => post(handler, { ...ticketMail("ticket_reopened", ["@support"]), requestId: id }, TOKENS.customer2());
  // customer2 bu talebe erişemez; sahibi customer
  assert.equal((await reopen("r0")).statusCode, 403);
  const own = (id) => post(handler, { ...ticketMail("ticket_reopened", ["@support"]), requestId: id }, TOKENS.customer());
  assert.equal(json(await own("r1")).data.sent.length, 1);
  assert.equal(json(await own("r2")).data.sent.length, 0);
});

test("ticket_message: aynı message_id için bir kez (kuyruktan çift gönderim/iki sekme)", async () => {
  addMessage("T1", "mm1", "uid-cust", "Merhaba");
  const send = (id) => post(handler, { ...ticketMail("ticket_message", ["@support"], { message_id: "mm1" }), requestId: id }, TOKENS.customer());
  assert.equal(json(await send("s1")).data.sent.length, 1);
  assert.equal(json(await send("s2")).data.sent.length, 0);
  assert.equal(fx.resendCalls.length, 1);
});

test("başarısız gönderimde olay kilidi bırakılır: yeniden deneme e-postayı gönderir", async () => {
  fx.resendResponder = () => response(503, { name: "internal_server_error", message: "x" });
  const body = { ...ticketMail("ticket_created", ["@support"]), requestId: "retry-1" };
  const first = await post(handler, body, TOKENS.customer());
  assert.equal(first.statusCode, 502);
  fx.resendResponder = () => response(200, { id: "ok" });
  const second = await post(handler, body, TOKENS.customer());
  assert.equal(second.statusCode, 200);
  assert.equal(json(second).data.sent.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// Hata sadeleştirme / dayanıklılık
// ---------------------------------------------------------------------------------------------------------------

test("[SEN-41/MUS-30] beklenmeyen hata iç ayrıntı sızdırmaz: code=internal/sabit mesaj", async () => {
  const realFetch = global.fetch;
  try {
  global.fetch = async (url, init) => {
    if (String(url).includes("firebasedatabase.app/v2/tickets/T1")) throw new TypeError("fetch failed: ECONNRESET 10.0.0.5");
    return realFetch(url, init);
  };
  const res = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer());
  assert.ok(res.statusCode >= 500);
  assert.doesNotMatch(res.body, /ECONNRESET|10\.0\.0\.5|fetch failed|Unexpected token/);

  // RTDB 200 ama JSON olmayan gövde
  global.fetch = async (url, init) => {
    if (String(url).includes("firebasedatabase.app/v2/tickets/T1")) return { ok: true, status: 200, headers: { get: () => "" }, json: async () => { throw new SyntaxError("Unexpected token '<', \"<html>...\" is not valid JSON"); } };
    return realFetch(url, init);
  };
  const res2 = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer());
  assert.doesNotMatch(res2.body, /Unexpected token|<html/);

  // Resend'e ağ hatası
  global.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.resend.com")) throw new TypeError("fetch failed");
    return realFetch(url, init);
  };
  const res3 = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer());
  assert.equal(res3.statusCode, 502);
  assert.doesNotMatch(res3.body, /fetch failed|api\.resend|RESEND/i);
  } finally {
    global.fetch = realFetch;
  }
});

test("Resend askıda kalırsa zaman aşımı (504) — istemci yeniden denenebilir", async () => {
  const restore = withEnv({ RESEND_TIMEOUT_MS: "200" });
  try {
    fx.resendResponder = (payload, init) =>
      new Promise((resolve, reject) => {
        const keepAlive = setTimeout(() => {}, 2000); // AbortSignal.timeout zamanlayıcısı unref'lidir; döngüyü canlı tut
        init.signal.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
        });
      });
    const t0 = Date.now();
    const res = await post(handler, ticketMail("ticket_message", ["@support"]), TOKENS.customer());
    assert.equal(res.statusCode, 504);
    assert.equal(json(res).code, "email_timeout");
    assert.ok(Date.now() - t0 < 3000);
  } finally {
    restore();
  }
});

test("geçersiz gövde türleri: dizi/null JSON 400; tip yok 400", async () => {
  for (const body of ["[]", "null", "5", "{}"]) {
    const res = await handler({ httpMethod: "POST", headers: { origin: "https://www.parlabilgiteknolojileri.net" }, body });
    assert.equal(res.statusCode, 400, body);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// EML-23: kimlik doğrulama sertleştirme
// ---------------------------------------------------------------------------------------------------------------

test("[EML-23d] exp/iat yok ya da sayı değilse token reddedilir", async () => {
  const mk = (payload) => {
    const header = b64({ alg: "RS256", kid: "fixture-kid", typ: "JWT" });
    const p = b64({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: "uid-cust", ...payload });
    const sig = require("node:crypto").sign("RSA-SHA256", Buffer.from(`${header}.${p}`), privateKey).toString("base64url");
    return `${header}.${p}.${sig}`;
  };
  const now = Math.floor(Date.now() / 1000);
  for (const [name, payload] of [
    ["exp yok", { iat: now }],
    ["iat yok", { exp: now + 3600 }],
    ["exp string", { exp: String(now + 3600), iat: now }],
    ["exp null", { exp: null, iat: now }],
  ]) {
    const res = await post(handler, ticketMail("ticket_message", ["@support"]), mk(payload));
    assert.equal(res.statusCode, 401, name);
  }
  const good = await post(handler, ticketMail("ticket_message", ["@support"]), mk({ exp: now + 3600, iat: now - 5, email: "musteri@abc.com" }));
  assert.equal(good.statusCode, 200, good.body);
});

test("[EML-23e] bilinmeyen kid'li sahte token'lar sertifika uç noktasını bombalayamaz (dakikada ≤1 zorla yenileme)", async () => {
  await verifyIdToken(TOKENS.customer()); // önbelleği doldur
  const before = fx.certFetches;
  for (let i = 0; i < 25; i += 1) {
    const tok = `${b64({ alg: "RS256", kid: `rnd-${i}` })}.${b64({ sub: "x" })}.AAAA`;
    await verifyIdToken(tok).catch(() => {});
  }
  assert.ok(fx.certFetches - before <= 1, `ek sertifika isteği: ${fx.certFetches - before}`);
});

test("eşzamanlı soğuk başlangıç istekleri tek sertifika çağrısını paylaşır", async () => {
  resetCertCache();
  await Promise.all(Array.from({ length: 8 }, () => verifyIdToken(TOKENS.customer())));
  assert.equal(fx.certFetches, 1);
});

// ---------------------------------------------------------------------------------------------------------------
// GET + kimlik bilgisi (hesap) e-postası
// ---------------------------------------------------------------------------------------------------------------

test("GET: destek adresi env'den döner (tek kaynak); yönetici ayrıntısı ve kota yalnızca yöneticiye", async () => {
  const restore = withEnv({ CONTACT_EMAIL: "destek@parla.com" });
  try {
    const anon = json(await handler({ httpMethod: "GET", headers: {} }));
    assert.equal(anon.contact, "destek@parla.com");
    assert.equal(anon.configured, undefined);
    const admin = json(await handler({ httpMethod: "GET", headers: { authorization: `Bearer ${TOKENS.staff()}` } }));
    assert.equal(admin.configured, true);
    assert.equal(admin.quota.used, 0);
    const cons = json(await handler({ httpMethod: "GET", headers: { authorization: `Bearer ${TOKENS.consultant()}` } }));
    assert.equal(cons.configured, undefined);
  } finally {
    restore();
  }
});

test("user_credentials: parolasız hesap e-postası; kayıtsız alıcı reddedilir; eski istemci parolası yok sayılır", async () => {
  const ok = await post(
    handler,
    { type: "user_credentials", to: "musteri@abc.com", ticketData: { password: "ESKI-PAROLA-123", portalUrl: "https://evil.netlify.app", loginUrl: "https://evil.netlify.app/x" } },
    TOKENS.staff()
  );
  assert.equal(ok.statusCode, 200, ok.body);
  const { html, text, subject } = fx.resendCalls[0].payload;
  assert.doesNotMatch(html + text + subject, /ESKI-PAROLA|evil\.netlify/);
  assert.match(text, /musteri@abc\.com/);
  assert.match(text, /https:\/\/www\.parlabilgiteknolojileri\.net\/support-v2\/login\.html/);
  assert.match(text, /Şifremi Unuttum/);

  const stranger = await post(handler, { type: "user_credentials", to: "yabanci@gmail.com" }, TOKENS.staff());
  assert.equal(stranger.statusCode, 404);
  const asCons = await post(handler, { type: "user_credentials", to: "musteri@abc.com" }, TOKENS.consultant());
  assert.equal(asCons.statusCode, 403);
});

// ---------------------------------------------------------------------------------------------------------------
// Olay matrisi (sunucu düzeyi): tip × çağıran × alıcı sınıfı (denetim matrix.cjs'in sunucu karşılığı)
// ---------------------------------------------------------------------------------------------------------------

test("olay matrisi: 9 tip × 4 çağıran × 5 alıcı sınıfı — yetki ve alıcı sonuçları beklenen tabloyla birebir", async () => {
  const restore = withEnv({
    RATE_CUSTOMER_PER_MIN: "1000", RATE_CUSTOMER_PER_HOUR: "1000", RATE_STAFF_PER_MIN: "1000", RATE_STAFF_PER_HOUR: "1000",
    RATE_TICKET_PER_HOUR: "100000", DAILY_EMAIL_SOFT_LIMIT: "100000", DAILY_EMAIL_HARD_LIMIT: "100000",
  });
  const { TICKET_TYPES } = require("../functions/send-email")._internals;
  // Bileşik olaylar (atama değişimi / kritik öncelik) ayrı testlerde (send-email-notifications.test.js) doğrulanır.
  const MATRIX_TYPES = Object.entries(TICKET_TYPES).filter(([t]) => !["ticket_assignment_changed", "ticket_priority_critical"].includes(t));
  const statusFor = { ticket_resolved: "resolved", ticket_closed: "closed", ticket_reopened: "reopened", ticket_close_approval: "pending_close", send_to_customer: "waiting_customer" };
  const callers = {
    owner: { token: TOKENS.customer, staff: false, access: true },
    other: { token: TOKENS.customer2, staff: false, access: false },
    consultant: { token: TOKENS.consultant, staff: true, access: true },
    admin: { token: TOKENS.staff, staff: true, access: true },
  };
  const recipients = {
    support: ["@support", "info@parlabilgiteknolojileri.net"],
    assigned: ["@assigned", "danisman@parla.com"],
    owner: ["@owner", "musteri@abc.com"],
    stranger: ["yabanci@gmail.com"],
    personnel: ["baska@parla.com"], // aktif personel ama bu talebe atanmamış
  };
  const rows = [];
  try {
    for (const [type, kind] of MATRIX_TYPES) {
      for (const [who, caller] of Object.entries(callers)) {
        for (const [rname, list] of Object.entries(recipients)) {
          fx.reset();
          fx.db.v2.tickets.T1.status = statusFor[type] || "open";
          setStoreForTests(new MemoryStore());
          const res = await post(handler, { ...ticketMail(type, [list[0]]), requestId: `${type}-${who}-${rname}` }, caller.token());
          const literal = await post(handler, { ...ticketMail(type, [list[list.length - 1]]), requestId: `${type}-${who}-${rname}-lit` }, caller.token());
          // beklenen
          let expected;
          if (kind === "staff" && !caller.staff) expected = 403;
          else if (!caller.access) expected = 403;
          else if (rname === "stranger") expected = 403;
          else if (rname === "personnel") expected = caller.staff ? 200 : 403;
          else if (rname === "owner") expected = 200; // staff: profil adresi; müşteri sahibi: kendi adresi
          else expected = 200;
          rows.push([type, who, rname, res.statusCode, expected]);
          assert.equal(res.statusCode, expected, `${type}/${who}/${rname}: ${res.body}`);
          if (rname !== "personnel") assert.equal(literal.statusCode, expected, `${type}/${who}/${rname} (adres): ${literal.body}`);
          // gönderilen e-postada kaçak alıcı yok
          // staff@example.com: Destek Atayıcı yedeği (service_admin yok → super_admin); yalnızca atanmamış yeni talepte (WP-05).
          fx.resendCalls.forEach((c) => c.payload.to.forEach((addr) => assert.ok(
            ["info@parlabilgiteknolojileri.net", "danisman@parla.com", "musteri@abc.com", "baska@parla.com"].concat(type === "ticket_created" ? ["staff@example.com"] : []).includes(addr), `kaçak alıcı: ${addr}`)));
          if (expected === 200) {
            const mails = fx.resendCalls.map((c) => c.payload);
            mails.forEach((m) => {
              assert.ok(m.text && m.html && m.subject, "html + text + konu");
              assert.doesNotMatch(m.subject, /[\r\n]/);
              // kitleye uygun bağlantı: müşteri adresine müşteri sayfası, diğerlerine yönetim sayfası
              const customerAddr = m.to.includes("musteri@abc.com");
              assert.match(m.html, customerAddr ? /customer\/ticket-detail\.html/ : /admin\/ticket-detail\.html/, `${type}/${who}/${rname}`);
            });
          }
        }
      }
    }
  } finally {
    restore();
  }
  assert.equal(rows.length, 9 * 4 * 5);
});
