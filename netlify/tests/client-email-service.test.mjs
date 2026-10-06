/**
 * İstemci e-posta servisi testleri (tarayıcı API'leri mock'lanır).
 * Çalıştırma: node --test netlify/tests/client-email-service.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

let calls;
let responder;
let tokenCalls;

const store = new Map();
function setup({ user = true, uid } = {}) {
  calls = [];
  tokenCalls = [];
  store.clear();
  globalThis.window = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    __PARLA_SITE_CONFIG: { EMAIL_API_URL: "/api/send-email" },
    location: { origin: "https://www.parlabilgiteknolojileri.net" },
    __PARLA_FIREBASE: {
      auth: {
        currentUser: user
          ? {
              uid,
              email: "admin@parla.com",
              getIdToken: async (force) => {
                tokenCalls.push(!!force);
                return force ? "fresh-token" : "old-token";
              },
            }
          : null,
      },
    },
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return responder(calls.length, init);
  };
}

function res(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, ok: status < 300, text: async () => text };
}

const { default: Email } = await import("../../assets/js/support-v2/email-service.js");

test("token Authorization başlığında gider", async () => {
  setup();
  responder = () => res(200, { success: true, message: "ok", data: { id: "1" } });
  const r = await Email.notifyTicketEvent("ticket_message", "a@b.com", { id: "T1234567" }, { note: "n" });
  assert.equal(r.success, true);
  assert.equal(calls[0].init.headers.Authorization, "Bearer old-token");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, ["a@b.com"]);
  assert.equal(body.ticketData.ticket_id, "T1234567");
  assert.equal(body.extra.note, "n");
});

test("oturum yoksa istek atılmaz ve anlaşılır hata döner", async () => {
  setup({ user: false });
  responder = () => res(200, { success: true });
  const r = await Email.send({ type: "ticket_message", to: "a@b.com" });
  assert.equal(r.success, false);
  assert.equal(r.code, "no_session");
  assert.equal(calls.length, 0);
});

test("401'de token yenilenip bir kez tekrar denenir", async () => {
  setup();
  responder = (n) => (n === 1 ? res(401, { success: false, message: "x" }) : res(200, { success: true, message: "ok" }));
  const r = await Email.send({ type: "ticket_message", to: "a@b.com" });
  assert.equal(r.success, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Authorization, "Bearer fresh-token");
});

test("404 HTML yanıtı: fonksiyon yayında değil teşhisi", async () => {
  setup();
  responder = () => res(404, "<html>Not found</html>");
  const r = await Email.send({ type: "ticket_message", to: "a@b.com" });
  assert.equal(r.success, false);
  assert.equal(r.code, "endpoint_missing");
  assert.match(r.message, /bulunamadı/);
  assert.equal(calls.length, 1, "4xx tekrar denenmez");
});

test("sunucu hatası (5xx) 3 kez denenir", async () => {
  setup();
  responder = () => res(502, { success: false, message: "boom" });
  const r = await Email.send({ type: "ticket_message", to: "a@b.com" });
  assert.equal(r.success, false);
  assert.equal(calls.length, 3);
});

test("boş alıcı listesinde istek atılmaz", async () => {
  setup();
  responder = () => res(200, { success: true });
  const r = await Email.notifyTicketEvent("ticket_message", ["", null], { id: "T1234567" });
  assert.equal(r.success, true);
  assert.equal(calls.length, 0);
});

test("uniqueEmails: yinelenen ve işlemi yapan kişiyi ayıklar", () => {
  assert.deepEqual(Email.uniqueEmails(["A@x.com", "a@x.com", "b@x.com", "", null], "B@X.com"), ["a@x.com"]);
});

test("health: ulaşılamayan ve yapılandırılmamış servis ayrımı", async () => {
  setup();
  responder = () => res(404, "<html></html>");
  assert.equal((await Email.health()).reachable, false);
  responder = () => res(200, { success: true, configured: false });
  const h = await Email.health();
  assert.equal(h.reachable, true);
  assert.equal(h.configured, false);
});

test("geçici hata (5xx) kuyruğa alınır, sonra flush ile aynı requestId ile gönderilir", async () => {
  setup({ uid: "u1" });
  responder = () => res(503, { success: false, message: "geçici" });
  const r = await Email.send({ type: "ticket_message", to: "a@b.com", ticketData: { ticket_id: "T1" }, requestId: "req-1" });
  assert.equal(r.success, false);
  assert.equal(r.queued, true);
  assert.match(r.message, /yeniden denenecek/);
  assert.equal(Email.outboxSize(), 1);

  calls = [];
  responder = () => res(200, { success: true, message: "ok" });
  const flushed = await Email.flushOutbox();
  assert.deepEqual(flushed, { sent: 1, dropped: 0, pending: 0 });
  assert.equal(Email.outboxSize(), 0);
  assert.equal(JSON.parse(calls[0].init.body).requestId, "req-1", "idempotency için aynı requestId");
});

test("ağ hatası kuyruğa alınır; kalıcı 4xx hatası alınmaz", async () => {
  setup({ uid: "u1" });
  responder = () => { throw new Error("offline"); };
  const net = await Email.send({ type: "ticket_message", to: "a@b.com" });
  assert.equal(net.queued, true);
  setup({ uid: "u1" });
  responder = () => res(403, { success: false, message: "yetki yok", code: "role_denied" });
  const denied = await Email.send({ type: "ticket_message", to: "a@b.com" });
  assert.equal(denied.queued, undefined);
  assert.equal(Email.outboxSize(), 0);
});

test("kimlik bilgisi e-postası (parola içerir) asla kuyruğa alınmaz", async () => {
  setup({ uid: "u1" });
  responder = () => res(503, { success: false, message: "geçici" });
  const r = await Email.send({ type: "user_credentials", to: "a@b.com", ticketData: { password: "gizli" } });
  assert.equal(r.queued, undefined);
  assert.equal(Email.outboxSize(), 0);
  assert.equal([...store.values()].some((v) => v.includes("gizli")), false);
});

test("flush: kalıcı hata kuyruktan düşer, geçici hata kalır, kuyruk kullanıcıya özeldir", async () => {
  setup({ uid: "u1" });
  responder = () => res(503, { success: false, message: "geçici" });
  await Email.send({ type: "ticket_message", to: "a@b.com", requestId: "r1" });
  responder = () => res(503, { success: false, message: "hâlâ kapalı" });
  assert.deepEqual(await Email.flushOutbox(), { sent: 0, dropped: 0, pending: 1 });
  responder = () => res(403, { success: false, message: "yetki", code: "role_denied" });
  const dropped = await Email.flushOutbox();
  assert.equal(dropped.dropped, 1);
  assert.equal(Email.outboxSize(), 0);

  setup({ uid: "u1" });
  responder = () => res(503, { success: false, message: "geçici" });
  await Email.send({ type: "ticket_message", to: "a@b.com" });
  window.__PARLA_FIREBASE.auth.currentUser.uid = "u2";
  assert.equal(Email.outboxSize(), 0, "başka kullanıcı kuyruğu görmez");
});
