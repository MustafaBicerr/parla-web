/**
 * send-email fonksiyonu testleri — bağımlılık yok.
 * Çalıştırma: node --test netlify/tests
 * Gerekli: openssl (test sertifikası üretmek için)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROJECT = "parla-bt-web";
const KID = "test-kid-1";

// ---- Test anahtarı + x509 sertifikası ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parla-test-"));
const keyPath = path.join(tmp, "key.pem");
const certPath = path.join(tmp, "cert.pem");
execFileSync("openssl", [
  "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath,
  "-days", "2", "-subj", "/CN=test",
], { stdio: "ignore" });
const privateKey = fs.readFileSync(keyPath, "utf8");
const certPem = fs.readFileSync(certPath, "utf8");

function b64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function makeToken(overrides, kid) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: kid || KID, typ: "JWT" });
  const payload = b64({
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    sub: "uid-1",
    email: "Staff@Example.com",
    iat: now - 10,
    exp: now + 3600,
    ...overrides,
  });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

// ---- Sahte ağ (Google certs, RTDB, Resend) ----
let db;
let resendCalls;
let resendResponder;

function jsonResponse(status, data, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (headers || {})[k.toLowerCase()] || "" },
    json: async () => data,
  };
}

function installFetch() {
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("securetoken@system.gserviceaccount.com")) {
      return jsonResponse(200, { [KID]: certPem }, { "cache-control": "max-age=3600" });
    }
    if (u.includes("firebasedatabase.app")) {
      const m = /\.app\/(.+)\.json\?auth=(.*)$/.exec(u);
      const p = m[1];
      const token = decodeURIComponent(m[2]);
      const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
      // Kural simülasyonu: başka bir müşterinin ticket'ını okuyamaz
      if (sub === "uid-other" && (p.startsWith("v2/tickets/") || p.startsWith("v2/ticket_assignments/"))) return jsonResponse(401, { error: "Permission denied" });
      // Kural simülasyonu: personel listesi yalnızca personele açık
      if (p.startsWith("v2/personnel") && String(db.v2.users[sub] && db.v2.users[sub].role).includes("customer")) {
        return jsonResponse(401, { error: "Permission denied" });
      }
      const node = p.split("/").reduce((acc, k) => (acc == null ? acc : acc[k]), db);
      return jsonResponse(200, node === undefined ? null : node);
    }
    if (u.startsWith("https://api.resend.com/emails")) {
      const payload = JSON.parse(init.body);
      resendCalls.push({ payload, headers: init.headers });
      return resendResponder(payload);
    }
    if (u.startsWith("https://api.resend.com/domains")) {
      return jsonResponse(200, { data: [{ name: "parlabilgiteknolojileri.net", status: "verified" }] });
    }
    throw new Error(`Beklenmeyen istek: ${u}`);
  };
}

function resetState() {
  resendCalls = [];
  resendResponder = () => jsonResponse(200, { id: "email-id-1" });
  db = {
    v2: {
      users: {
        "uid-1": { role: "super_admin", is_active: true, first_name: "Ali", last_name: "Veli" },
        "uid-cust": { role: "customer", is_active: true, company_id: "c1" },
        "uid-off": { role: "super_admin", is_active: false },
        "uid-other": { role: "customer", is_active: true, company_id: "c2" },
      },
      tickets: {
        T123456789: {
          ticket_number: "SUP-ABC-FI-2610-0001",
          title: "Fatura hatası",
          status: "open",
          priority: "high",
          company_name: "ABC A.Ş.",
          user_id: "uid-cust",
          user_name: "Müşteri Kişi",
          user_email: "musteri@abc.com",
        },
      },
      ticket_assignments: {
        T123456789: { p1: { personnel_id: "p1", personnel_email: "Danisman@Parla.com", is_primary: true } },
      },
      personnel: {
        p1: { email: "Danisman@Parla.com", is_active: true },
        p2: { email: "eski@parla.com", is_active: false },
      },
    },
  };
}

process.env.RESEND_API_KEY = "re_test";
const { handler } = require("../functions/send-email");
const { resetCertCache } = require("../lib/firebase-auth");

function post(body, token, extraHeaders) {
  return handler({
    httpMethod: "POST",
    headers: {
      origin: "https://www.parlabilgiteknolojileri.net",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function ticketMail(type, to, extra) {
  return { type, to, ticketData: { ticket_id: "T123456789", portalUrl: "https://www.parlabilgiteknolojileri.net" }, extra };
}

test.beforeEach(() => {
  resetState();
  resetCertCache();
  installFetch();
});

test("GET yapılandırma durumunu döner", async () => {
  const res = await handler({ httpMethod: "GET", headers: {} });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.configured, true);
});

test("OPTIONS: izinli origin için CORS başlıkları", async () => {
  const res = await handler({ httpMethod: "OPTIONS", headers: { origin: "https://parla-bt-web.web.app" } });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://parla-bt-web.web.app");
  assert.match(res.headers["Access-Control-Allow-Headers"], /Authorization/);
});

test("OPTIONS: yabancı origin CORS izni almaz", async () => {
  const res = await handler({ httpMethod: "OPTIONS", headers: { origin: "https://evil.example" } });
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("token olmadan 401", async () => {
  const res = await post(ticketMail("ticket_message", ["musteri@abc.com"]));
  assert.equal(res.statusCode, 401);
  assert.equal(resendCalls.length, 0);
});

test("yabancı origin 403", async () => {
  const res = await post(ticketMail("ticket_message", ["musteri@abc.com"]), makeToken(), { origin: "https://evil.example" });
  assert.equal(res.statusCode, 403);
});

test("sahte imzalı token reddedilir", async () => {
  const good = makeToken();
  const parts = good.split(".");
  const forged = `${parts[0]}.${b64({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: "uid-1", exp: 9999999999, iat: 1 })}.${parts[2]}`;
  const res = await post(ticketMail("ticket_message", ["musteri@abc.com"]), forged);
  assert.equal(res.statusCode, 401);
});

test("süresi dolmuş / yanlış proje token reddedilir", async () => {
  const past = Math.floor(Date.now() / 1000) - 100;
  assert.equal((await post(ticketMail("ticket_message", ["musteri@abc.com"]), makeToken({ exp: past }))).statusCode, 401);
  assert.equal((await post(ticketMail("ticket_message", ["musteri@abc.com"]), makeToken({ aud: "baska-proje" }))).statusCode, 401);
});

test("pasif hesap 403", async () => {
  const res = await post(ticketMail("ticket_message", ["musteri@abc.com"]), makeToken({ sub: "uid-off" }));
  assert.equal(res.statusCode, 403);
});

test("personel: talep sahibine durum maili gönderir; içerik veritabanından gelir", async () => {
  const res = await post(
    { ...ticketMail("ticket_status_changed", ["musteri@abc.com"], { note: "Test notu" }), requestId: "r1" },
    makeToken()
  );
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(body.success, true);
  assert.equal(resendCalls.length, 1);
  const { payload, headers } = resendCalls[0];
  assert.deepEqual(payload.to, ["musteri@abc.com"]);
  assert.match(payload.subject, /Durum güncellendi · SUP-ABC-FI-2610-0001/);
  assert.match(payload.html, /customer\/ticket-detail\.html\?id=T123456789/);
  assert.match(payload.html, /Test notu/);
  assert.equal(headers["Idempotency-Key"], "r1:customer");
});

test("istemcinin gönderdiği başlık/numara yok sayılır (veritabanı esas)", async () => {
  const body = ticketMail("ticket_message", ["musteri@abc.com"]);
  body.ticketData.title = "SAHTE BAŞLIK";
  body.ticketData.ticket_number = "SAHTE-1";
  await post(body, makeToken());
  assert.doesNotMatch(resendCalls[0].payload.html, /SAHTE/);
  assert.match(resendCalls[0].payload.html, /Fatura hatası/);
});

test("alıcılar müşteri/personel olarak ayrı e-postalara bölünür", async () => {
  const res = await post(ticketMail("ticket_message", ["musteri@abc.com", "danisman@parla.com"]), makeToken());
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(resendCalls.length, 2);
  const staffCall = resendCalls.find((c) => c.payload.to[0] === "danisman@parla.com");
  assert.match(staffCall.payload.html, /admin\/ticket-detail\.html\?id=T123456789/);
});

test("ticket muhatabı olmayan alıcı reddedilir", async () => {
  const res = await post(ticketMail("ticket_message", ["baskasi@gmail.com"]), makeToken());
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).code, "recipient_not_allowed");
  assert.equal(resendCalls.length, 0);
});

test("müşteri yanıtı atanmış danışmana gidebilir (atama kaydındaki adres; personel listesi okunmaz)", async () => {
  const res = await post(ticketMail("ticket_message", ["danisman@parla.com", "info@parlabilgiteknolojileri.net"]), makeToken({ sub: "uid-cust" }));
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(
    resendCalls.map((c) => c.payload.to).flat().sort(),
    ["danisman@parla.com", "info@parlabilgiteknolojileri.net"]
  );
});

test("müşteri, atanmamış bir personele (listede olsa bile) mail tetikleyemez", async () => {
  db.v2.personnel.p3 = { email: "baska@parla.com", is_active: true };
  const res = await post(ticketMail("ticket_message", ["baska@parla.com"]), makeToken({ sub: "uid-cust" }));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).code, "recipient_not_allowed");
});

test("pasif personele gönderim reddedilir", async () => {
  const res = await post(ticketMail("ticket_assigned", ["eski@parla.com"]), makeToken());
  assert.equal(res.statusCode, 403);
});

test("müşteri, talep gerçekten yeniden açıldıysa personele 'tekrar açıldı' bildirimi gönderebilir", async () => {
  db.v2.tickets.T123456789.status = "reopened";
  const res = await post(
    ticketMail("ticket_reopened", ["danisman@parla.com", "info@parlabilgiteknolojileri.net"], { note: "Hata sürüyor" }),
    makeToken({ sub: "uid-cust" })
  );
  assert.equal(res.statusCode, 200, res.body);
  assert.match(resendCalls[0].payload.subject, /Talep tekrar açıldı/);
  assert.match(resendCalls[0].payload.html, /Hata sürüyor/);
});

test("müşteri kapanış onayını bildirebilir (durum 'closed' ise)", async () => {
  db.v2.tickets.T123456789.status = "closed";
  const res = await post(ticketMail("ticket_closed", ["info@parlabilgiteknolojileri.net"], { note: "onay" }), makeToken({ sub: "uid-cust" }));
  assert.equal(res.statusCode, 200, res.body);
});

test("durumla uyuşmayan bildirim reddedilir (sahte 'kapandı/yeniden açıldı' maili üretilemez)", async () => {
  // ticket durumu 'open'
  const closed = await post(ticketMail("ticket_closed", ["info@parlabilgiteknolojileri.net"]), makeToken({ sub: "uid-cust" }));
  assert.equal(closed.statusCode, 409);
  assert.equal(JSON.parse(closed.body).code, "status_mismatch");
  const reopened = await post(ticketMail("ticket_reopened", ["info@parlabilgiteknolojileri.net"]), makeToken({ sub: "uid-cust" }));
  assert.equal(reopened.statusCode, 409);
  const approval = await post(ticketMail("ticket_close_approval", ["musteri@abc.com"]), makeToken());
  assert.equal(approval.statusCode, 409, "personel de durum tutarsızsa gönderemez");
  assert.equal(resendCalls.length, 0);
});

test("kapanış onayı isteği yalnızca personelden ve durum 'pending_close' iken kabul edilir", async () => {
  db.v2.tickets.T123456789.status = "pending_close";
  const asCustomer = await post(ticketMail("ticket_close_approval", ["musteri@abc.com"]), makeToken({ sub: "uid-cust" }));
  assert.equal(asCustomer.statusCode, 403);
  const asStaff = await post(ticketMail("ticket_close_approval", ["musteri@abc.com"]), makeToken());
  assert.equal(asStaff.statusCode, 200, asStaff.body);
  assert.match(resendCalls[0].payload.subject, /Kapanış onayı/);
  assert.match(resendCalls[0].payload.html, /customer\/ticket-detail\.html\?id=T123456789/);
});

test("müşteri personel tiplerini (atama/durum) gönderemez", async () => {
  const token = makeToken({ sub: "uid-cust" });
  assert.equal((await post(ticketMail("ticket_assigned", ["danisman@parla.com"]), token)).statusCode, 403);
  assert.equal((await post(ticketMail("ticket_status_changed", ["musteri@abc.com"]), token)).statusCode, 403);
  assert.equal(resendCalls.length, 0);
});

test("müşteri yanıt bildirimini CONTACT_EMAIL'e gönderebilir", async () => {
  const res = await post(ticketMail("ticket_message", ["info@parlabilgiteknolojileri.net"], { note: "Merhaba" }), makeToken({ sub: "uid-cust" }));
  assert.equal(res.statusCode, 200, res.body);
  assert.match(resendCalls[0].payload.html, /admin\/ticket-detail\.html/);
});

test("ticket'a erişimi olmayan kullanıcı mail tetikleyemez (RTDB kuralı)", async () => {
  const res = await post(ticketMail("ticket_message", ["info@parlabilgiteknolojileri.net"]), makeToken({ sub: "uid-other" }));
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).code, "db_denied");
  assert.equal(resendCalls.length, 0);
});

test("geçersiz ticket kimliği (path enjeksiyonu) reddedilir", async () => {
  const body = ticketMail("ticket_message", ["musteri@abc.com"]);
  body.ticketData.ticket_id = "../users";
  assert.equal((await post(body, makeToken())).statusCode, 400);
});

test("form tipleri artık kabul edilmez", async () => {
  const res = await post({ type: "contact_form", to: ["info@parlabilgiteknolojileri.net"], ticketData: { name: "x" } }, makeToken());
  assert.equal(res.statusCode, 400);
});

test("user_credentials yalnızca admin rolleri için", async () => {
  const payload = { type: "user_credentials", to: "yeni@abc.com", ticketData: { password: "Abc123xyz!", name: "Yeni", portalUrl: "https://evil.example" } };
  assert.equal((await post(payload, makeToken({ sub: "uid-cust" }))).statusCode, 403);
  const ok = await post(payload, makeToken());
  assert.equal(ok.statusCode, 200, ok.body);
  // portalUrl izinli değil -> marka adresi kullanılır
  assert.match(resendCalls[0].payload.html, /https:\/\/www\.parlabilgiteknolojileri\.net\/support-v2\/login\.html/);
  assert.doesNotMatch(resendCalls[0].payload.html, /evil\.example/);
});

test("test_email her zaman çağıranın kendi adresine gider", async () => {
  const res = await post({ type: "test_email", to: ["baskasi@gmail.com"] }, makeToken());
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(resendCalls[0].payload.to, ["staff@example.com"]);
});

test("diagnostic alan adı durumunu döner", async () => {
  const res = await post({ type: "diagnostic" }, makeToken());
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.data.domain_status, "verified");
  assert.equal(resendCalls.length, 0);
});

test("Resend alan adı doğrulanmamış hatası anlaşılır mesaj döner", async () => {
  resendResponder = () =>
    jsonResponse(403, { name: "validation_error", message: "The parlabilgiteknolojileri.net domain is not verified." });
  const res = await post(ticketMail("ticket_message", ["musteri@abc.com"]), makeToken());
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 400);
  assert.equal(body.code, "domain_not_verified");
  assert.match(body.message, /doğrulanmamış/);
});

test("RESEND_API_KEY yoksa 500 + not_configured", async () => {
  const saved = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const res = await post(ticketMail("ticket_message", ["musteri@abc.com"]), makeToken());
    assert.equal(res.statusCode, 500);
    assert.equal(JSON.parse(res.body).code, "not_configured");
  } finally {
    process.env.RESEND_API_KEY = saved;
  }
});
