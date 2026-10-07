/**
 * Koruma deposu / hız sınırı / kota / tekilleştirme / günlük özet testleri (soyut `store` arayüzü).
 * Çalıştırma: node --test netlify/tests/email-guard.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MemoryStore, BlobsStore, ResilientStore, getGuardStore, setStoreForTests } = require("../lib/guard-store.js");
const guard = require("../lib/email-guard.js");
const { runDigest } = await import("../functions/email-digest.mjs");

const T0 = Date.UTC(2026, 9, 6, 12, 0, 0);

/** @netlify/blobs Store'unun ETag/koşullu yazma semantiğini taklit eder (CAS testi için). */
function fakeBlobs() {
  const data = new Map();
  let etagSeq = 0;
  return {
    data,
    async get(key) {
      const e = data.get(key);
      return e ? JSON.parse(e.body) : null;
    },
    async getWithMetadata(key) {
      const e = data.get(key);
      return e ? { data: JSON.parse(e.body), etag: e.etag, metadata: {} } : null;
    },
    async setJSON(key, value, opts) {
      const cur = data.get(key);
      if (opts && opts.onlyIfNew && cur) return { modified: false };
      if (opts && opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      etagSeq += 1;
      const etag = `"e${etagSeq}"`;
      data.set(key, { body: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
    async delete(key) {
      data.delete(key);
    },
    async list({ prefix }) {
      return { blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
}

test("MemoryStore: get/set/ttl/update/list/delete", async () => {
  const s = new MemoryStore();
  await s.set("a", { n: 1 }, { ttlMs: 300 });
  assert.deepEqual(await s.get("a"), { n: 1 });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await s.get("a"), null, "süresi dolan kayıt görünmez");
  const out = await s.update("c", (cur) => ({ value: (cur || 0) + 1, result: "ok" }));
  assert.equal(out, "ok");
  assert.equal(await s.update("c", (cur) => ({ skip: true, result: cur })), 1, "skip yazmaz");
  await s.set("p:1", 1);
  await s.set("p:2", 2);
  assert.deepEqual((await s.list("p:")).sort(), ["p:1", "p:2"]);
  await s.delete("p:1");
  assert.deepEqual(await s.list("p:"), ["p:2"]);
});

test("MemoryStore: eşzamanlı update'ler kayıp güncelleme üretmez", async () => {
  const s = new MemoryStore();
  await Promise.all(Array.from({ length: 50 }, () => s.update("n", (cur) => ({ value: (cur || 0) + 1, result: null }))));
  assert.equal(await s.get("n"), 50);
});

test("BlobsStore: ETag ile karşılaştır-ve-yaz; eşzamanlı update'lerde kayıp güncelleme yok; TTL zarfı", async () => {
  const blobs = fakeBlobs();
  const s = new BlobsStore(blobs);
  await Promise.all(Array.from({ length: 6 }, () => s.update("n", (cur) => ({ value: (cur || 0) + 1, result: null }))));
  assert.equal(await s.get("n"), 6);
  await s.set("t", "x", { ttlMs: 300 });
  assert.equal(await s.get("t"), "x");
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(await s.get("t"), null);
  await s.set("k:1", 1);
  assert.deepEqual(await s.list("k:"), ["k:1"]);
  await s.delete("k:1");
  assert.deepEqual(await s.list("k:"), []);
});

test("ResilientStore: birincil depo hata verirse bellek yedeğine düşer (denetimsiz kalmaz)", async () => {
  const broken = { kind: "blobs", get: async () => { throw new Error("blobs down"); }, set: async () => { throw new Error("blobs down"); }, delete: async () => { throw new Error("x"); }, update: async () => { throw new Error("x"); }, list: async () => { throw new Error("x"); } };
  const fallback = new MemoryStore();
  const s = new ResilientStore(broken, fallback);
  const orig = console.error;
  console.error = () => {};
  try {
    const first = await guard.consumeRate(s, "u", "x", [{ name: "m", ms: 60000, max: 2 }], T0);
    const second = await guard.consumeRate(s, "u", "x", [{ name: "m", ms: 60000, max: 2 }], T0 + 1);
    const third = await guard.consumeRate(s, "u", "x", [{ name: "m", ms: 60000, max: 2 }], T0 + 2);
    assert.deepEqual([first.ok, second.ok, third.ok], [true, true, false]);
  } finally {
    console.error = orig;
  }
});

test("getGuardStore: Blobs olmadan bellek; Blobs + event.blobs ile connectLambda çağrılır; GUARD_STORE=memory zorlar", () => {
  setStoreForTests(null);
  assert.equal(getGuardStore({}).kind, "memory");
  let connected = 0;
  const blobsModule = { connectLambda: () => { connected += 1; }, getStore: () => fakeBlobs() };
  const s = getGuardStore({ blobs: "base64" }, { blobs: blobsModule });
  assert.match(s.kind, /^blobs/);
  getGuardStore({ blobs: "base64" }, { blobs: blobsModule });
  assert.equal(connected, 2, "bağlam her çağrıda event'ten yenilenir");
  process.env.GUARD_STORE = "memory";
  try {
    assert.equal(getGuardStore({ blobs: "x" }, { blobs: blobsModule }).kind, "memory");
  } finally {
    delete process.env.GUARD_STORE;
  }
  setStoreForTests(null);
});

test("hız sınırı: dakika ve saat pencereleri, retryAfter, kayan pencere (süre dolunca yeniden izin)", async () => {
  const s = new MemoryStore();
  const w = [{ name: "minute", ms: 60_000, max: 5 }, { name: "hour", ms: 3_600_000, max: 20 }];
  const res = [];
  for (let i = 0; i < 7; i += 1) res.push(await guard.consumeRate(s, "u", "a", w, T0 + i * 1000));
  assert.deepEqual(res.map((r) => r.ok), [true, true, true, true, true, false, false]);
  assert.equal(res[5].window, "minute");
  assert.equal(res[5].retryAfter, 55, "ilk kayıt T0'da → 60 sn - 5 sn");
  assert.equal((await guard.consumeRate(s, "u", "a", w, T0 + 61_000)).ok, true, "pencere kaydı");
  assert.equal((await guard.consumeRate(s, "u", "b", w, T0)).ok, true, "kullanıcılar bağımsız");
});

test("günlük kota: yumuşak/sert sınır, iade, doldurma, gün değişimi", async () => {
  const s = new MemoryStore();
  const limits = { dailySoft: 3, dailyHard: 5 };
  assert.equal((await guard.reserveQuota(s, limits, 2, "low", T0)).ok, true);
  assert.equal((await guard.reserveQuota(s, limits, 2, "low", T0)).ok, false, "2+2 > 3 yumuşak");
  const hardOk = await guard.reserveQuota(s, limits, 2, "high", T0);
  assert.equal(hardOk.ok, true);
  const over = await guard.reserveQuota(s, limits, 2, "high", T0);
  assert.equal(over.ok, false);
  assert.ok(over.retryAfter >= 1 && over.retryAfter <= 12 * 3600, "gün sonuna kalan süre");
  await guard.refundQuota(s, 2, T0);
  assert.equal((await guard.getQuota(s, limits, T0)).used, 2);
  await guard.saturateQuota(s, limits, T0);
  assert.equal((await guard.getQuota(s, limits, T0)).used, 5);
  const tomorrow = T0 + 24 * 3600 * 1000;
  assert.equal((await guard.getQuota(s, limits, tomorrow)).used, 0, "UTC günü değişince sayaç sıfırdan");
  assert.equal((await guard.reserveQuota(s, limits, 2, "low", tomorrow)).ok, true);
});

test("getLimits: varsayılanlar ve env geçersiz kılma", () => {
  const d = guard.getLimits({});
  assert.deepEqual([d.customer[0].max, d.customer[1].max, d.staff[1].max, d.dailySoft, d.dailyHard], [5, 20, 120, 80, 95]);
  const o = guard.getLimits({ RATE_CUSTOMER_PER_MIN: "2", DAILY_EMAIL_SOFT_LIMIT: "10", DAILY_EMAIL_HARD_LIMIT: "x" });
  assert.deepEqual([o.customer[0].max, o.dailySoft, o.dailyHard], [2, 10, 95], "geçersiz değer varsayılana düşer");
});

test("öncelik sınıfları: yüksek = oluşturma/atama/onay/yeniden açma/hesap; düşük = yanıt/durum/çözüm/kapanış", () => {
  ["ticket_created", "ticket_assigned", "ticket_close_approval", "send_to_customer", "ticket_reopened", "user_credentials"].forEach((t) => assert.equal(guard.priorityOf(t), "high", t));
  ["ticket_message", "ticket_status_changed", "ticket_resolved", "ticket_closed", "test_email"].forEach((t) => assert.equal(guard.priorityOf(t), "low", t));
});

test("olay tekilleştirme: claim → duplicate; aynı requestId yeniden deneme devralır; bayat pending devralınır; release/complete", async () => {
  const s = new MemoryStore();
  assert.equal(await guard.claimEvent(s, "evt:1", "r1", T0), "claimed");
  assert.equal(await guard.claimEvent(s, "evt:1", "r2", T0 + 1000), "duplicate", "uçuştaki başka istek");
  assert.equal(await guard.claimEvent(s, "evt:1", "r1", T0 + 1000), "claimed", "aynı requestId (yeniden deneme) devralır");
  assert.equal(await guard.claimEvent(s, "evt:1", "r3", T0 + 3 * 60_000), "claimed", "2 dk'dan eski pending bayat");
  await guard.completeEvent(s, "evt:1");
  assert.equal(await guard.claimEvent(s, "evt:1", "r4"), "duplicate", "gönderilmiş olay tekrar gönderilmez");
  await guard.releaseEvent(s, "evt:1");
  assert.equal(await guard.claimEvent(s, "evt:1", "r5"), "claimed");
});

test("günlük özet: dünkü kayıtlar tek e-postada destek kutusuna gider ve silinir; kota doluysa korunur; bugünküne dokunulmaz", async () => {
  const s = new MemoryStore();
  const today = guard.dayKey(T0);
  const yesterday = guard.dayKey(T0 - 24 * 3600 * 1000);
  await s.set(`digest:${yesterday}`, [
    { event: "ticket_message", audience: "customer", ticket_number: "SUP-1", title: "Başlık 1", at: "2026-10-05T10:00:00Z" },
    { event: "ticket_status_changed", audience: "staff", ticket_number: "SUP-2", title: "Başlık 2", at: "2026-10-05T11:00:00Z" },
  ]);
  await s.set(`digest:${today}`, [{ event: "ticket_message", audience: "staff", ticket_number: "SUP-3", title: "Bugün", at: "2026-10-06T09:00:00Z" }]);

  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return { ok: true, status: 200, headers: { get: () => "" }, json: async () => ({ id: "digest-1" }) };
  };
  try {
    const limits = { DAILY_EMAIL_SOFT_LIMIT: "80", DAILY_EMAIL_HARD_LIMIT: "95" };
    const result = await runDigest({ store: s, apiKey: "re_x", contact: "info@parla.com", env: limits, now: T0 });
    assert.deepEqual(result, { sent: true, count: 2 });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body.to, ["info@parla.com"]);
    assert.match(calls[0].body.text, /Yeni yanıt \(müşteriye\): SUP-1/);
    assert.match(calls[0].body.subject, new RegExp(yesterday));
    assert.doesNotMatch(calls[0].body.text, /SUP-3/, "bugünün kayıtları ertesi gün özetlenir");
    assert.equal(await s.get(`digest:${yesterday}`), null, "gönderilen özet silindi");
    assert.ok(await s.get(`digest:${today}`), "bugünkü kayıt korundu");
    assert.equal((await guard.getQuota(s, guard.getLimits(limits), T0)).used, 1, "özet 1 e-posta kotası harcar");

    // Boş: ikinci çalıştırma e-posta atmaz
    assert.equal((await runDigest({ store: s, apiKey: "re_x", contact: "info@parla.com", env: limits, now: T0 })).sent, false);
    assert.equal(calls.length, 1);

    // Kota dolu: kayıtlar korunur, e-posta atılmaz
    await s.set(`digest:${yesterday}`, [{ event: "ticket_message", audience: "staff", ticket_number: "SUP-9", title: "x", at: "2026-10-05T12:00:00Z" }]);
    await guard.saturateQuota(s, guard.getLimits(limits), T0);
    const blocked = await runDigest({ store: s, apiKey: "re_x", contact: "info@parla.com", env: limits, now: T0 });
    assert.equal(blocked.sent, false);
    assert.equal(blocked.reason, "quota");
    assert.ok(await s.get(`digest:${yesterday}`));
    assert.equal(calls.length, 1);

    // Resend hatası: kayıtlar korunur, kota iade edilir
    const s2 = new MemoryStore();
    await s2.set(`digest:${yesterday}`, [{ event: "ticket_message", audience: "staff", ticket_number: "SUP-5", title: "x", at: "2026-10-05T12:00:00Z" }]);
    global.fetch = async () => ({ ok: false, status: 503, headers: { get: () => "" }, json: async () => ({ name: "internal_server_error" }) });
    const failed = await runDigest({ store: s2, apiKey: "re_x", contact: "info@parla.com", env: limits, now: T0 });
    assert.equal(failed.sent, false);
    assert.ok(await s2.get(`digest:${yesterday}`));
    assert.equal((await guard.getQuota(s2, guard.getLimits(limits), T0)).used, 0);
  } finally {
    global.fetch = realFetch;
  }
});
