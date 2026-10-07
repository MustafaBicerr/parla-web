/**
 * netlify/lib/admin.js (REST tabanlı Admin katmanı) testleri — sahte fetch; ağ yok.
 * Çalıştırma: node --test netlify/tests/admin-rest.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { parseServiceAccount, createRestAdmin, getAdmin, setAdminForTests, newPushKey, AdminError } = require("../lib/admin");

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const SA = { client_email: "svc@parla-bt-web.iam.gserviceaccount.com", private_key: privateKey, project_id: "parla-bt-web" };

function res(status, data) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => "" }, json: async () => data };
}

function recorder(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === "https://oauth2.googleapis.com/token") return res(200, { access_token: "tok-1", expires_in: 3600 });
    return handler(u, init, calls);
  };
  return { calls, fetchImpl };
}

test("parseServiceAccount: düz JSON, base64 JSON ve bozuk girdi", () => {
  assert.equal(parseServiceAccount(""), null);
  assert.equal(parseServiceAccount("not json"), null);
  assert.equal(parseServiceAccount(JSON.stringify({ foo: 1 })), null);
  const plain = parseServiceAccount(JSON.stringify(SA));
  assert.equal(plain.client_email, SA.client_email);
  const b64 = parseServiceAccount(Buffer.from(JSON.stringify(SA)).toString("base64"));
  assert.equal(b64.project_id, "parla-bt-web");
  const escaped = parseServiceAccount(JSON.stringify({ ...SA, private_key: privateKey.replace(/\n/g, "\\n") }));
  assert.ok(escaped.private_key.includes("\n"), "\\n metni gerçek satır sonuna çevrilir");
});

test("getAdmin: servis hesabı yoksa ya da bozuksa not_configured (hata fırlatmaz)", () => {
  setAdminForTests(null);
  assert.deepEqual(getAdmin({}), { ok: false, code: "not_configured" });
  assert.deepEqual(getAdmin({ FIREBASE_SERVICE_ACCOUNT: "{bozuk" }), { ok: false, code: "not_configured" });
  const ok = getAdmin({ FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA) });
  assert.equal(ok.ok, true);
  assert.equal(ok.admin.projectId, "parla-bt-web");
  setAdminForTests({ marker: 1 });
  assert.equal(getAdmin({}).admin.marker, 1, "enjekte edilen sahte Admin önceliklidir");
  setAdminForTests(null);
});

test("OAuth: imzalı JWT iddiası + jeton önbelleği (tek token isteği)", async () => {
  const { calls, fetchImpl } = recorder(() => res(200, { x: 1 }));
  const admin = createRestAdmin(SA, { fetchImpl, now: () => 1_800_000_000_000, dbUrl: "https://db.example/" });
  await admin.db.get("v2/users");
  await admin.db.get("v2/companies");
  const tokenCalls = calls.filter((c) => c.url.includes("oauth2.googleapis.com"));
  assert.equal(tokenCalls.length, 1, "jeton önbelleğe alınır");
  const form = new URLSearchParams(tokenCalls[0].init.body);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [h, c, s] = form.get("assertion").split(".");
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, "base64url")), "RS256 imzası doğrulanır");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.iss, SA.client_email);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claims.exp - claims.iat, 3600);
  assert.match(claims.scope, /identitytoolkit/);
  assert.match(claims.scope, /firebase\.database/);
  const dbCall = calls.find((c2) => c2.url.startsWith("https://db.example/v2/users.json"));
  assert.equal(dbCall.init.headers.Authorization, "Bearer tok-1");
});

test("OAuth: servis hesabı reddedilirse service_account_rejected (ayrıntı sızmaz)", async () => {
  const fetchImpl = async () => res(400, { error: "invalid_grant", error_description: "SECRET-DETAIL" });
  const admin = createRestAdmin(SA, { fetchImpl });
  await assert.rejects(admin.db.get("v2/x"), (err) => {
    assert.ok(err instanceof AdminError);
    assert.equal(err.code, "service_account_rejected");
    assert.ok(!String(err.message).includes("SECRET"));
    return true;
  });
});

test("RTDB: sorgu parametreleri JSON kodlanır; PATCH çok yollu; null silme", async () => {
  const { calls, fetchImpl } = recorder(() => res(200, null));
  const admin = createRestAdmin(SA, { fetchImpl, dbUrl: "https://db.example" });
  assert.equal(await admin.db.get("v2/users", { orderBy: "email", equalTo: "a@b.com", limitToLast: 3 }), null);
  const getUrl = calls.find((c) => c.url.includes("/v2/users.json?")).url;
  assert.match(getUrl, /orderBy=%22email%22/);
  assert.match(getUrl, /equalTo=%22a%40b\.com%22/);
  assert.match(getUrl, /limitToLast=3/);
  await admin.db.update("v2", { "tickets/T1/status": "closed", "tickets/T1/closed_at_ms": null });
  const patch = calls.find((c) => c.init && c.init.method === "PATCH");
  assert.equal(patch.url, "https://db.example/v2.json");
  assert.deepEqual(JSON.parse(patch.init.body), { "tickets/T1/status": "closed", "tickets/T1/closed_at_ms": null });
  await admin.db.set("v2/users/u1", { a: 1 });
  assert.equal(calls.find((c) => c.init && c.init.method === "PUT").url, "https://db.example/v2/users/u1.json");
  await admin.db.remove("v2/users/u1");
  assert.ok(calls.some((c) => c.init && c.init.method === "DELETE"));
});

test("RTDB hatası: db_error; ağ hatası: unreachable", async () => {
  const bad = createRestAdmin(SA, { fetchImpl: recorder(() => res(500, { error: "x" })).fetchImpl });
  await assert.rejects(bad.db.get("v2/a"), (e) => e.code === "db_error");
  let first = true;
  const down = createRestAdmin(SA, {
    fetchImpl: async (url) => {
      if (first) {
        first = false;
        return res(200, { access_token: "t", expires_in: 3600 });
      }
      throw Object.assign(new Error("boom"), { name: "TypeError" });
    },
  });
  await assert.rejects(down.db.get("v2/a"), (e) => e.code === "unreachable");
});

test("Auth: hesap oluştur / ara / devre dışı + iptal / sil / bağlantı / liste", async () => {
  const { calls, fetchImpl } = recorder((url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    if (url.endsWith("/accounts") && init.method === "POST") return res(200, { localId: "uid-1", email: body.email });
    if (url.endsWith("accounts:lookup")) {
      return body.email && body.email[0] === "yok@x.com"
        ? res(200, {})
        : res(200, { users: [{ localId: "uid-9", email: "Var@X.com", disabled: true, createdAt: "1700000000000" }] });
    }
    if (url.endsWith("accounts:update")) return res(200, { localId: body.localId });
    if (url.endsWith("accounts:delete")) return res(200, {});
    if (url.endsWith("accounts:sendOobCode")) {
      return res(200, { email: body.email, oobLink: "https://parla-bt-web.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=ABC123&apiKey=k" });
    }
    if (url.includes("accounts:batchGet")) return res(200, { users: [{ localId: "u1", email: "a@x.com" }], nextPageToken: "" });
    return res(404, {});
  });
  const admin = createRestAdmin(SA, { fetchImpl, now: () => 1_800_000_000_000 });

  const created = await admin.auth.createUser({ email: "Yeni@X.com", password: "Abcdefg1", displayName: "Yeni Kişi" });
  assert.deepEqual(created, { uid: "uid-1", email: "yeni@x.com" });

  assert.equal(await admin.auth.getUserByEmail("yok@x.com"), null);
  const found = await admin.auth.getUserByEmail(" Var@X.com ");
  assert.equal(found.uid, "uid-9");
  assert.equal(found.disabled, true);
  assert.equal(found.email, "var@x.com");

  await admin.auth.updateUser("uid-9", { disabled: true });
  await admin.auth.revokeRefreshTokens("uid-9");
  const updates = calls.filter((c) => c.url.endsWith("accounts:update")).map((c) => JSON.parse(c.init.body));
  assert.deepEqual(updates[0], { localId: "uid-9", disableUser: true });
  assert.deepEqual(updates[1], { localId: "uid-9", validSince: String(Math.floor(1_800_000_000_000 / 1000)) });

  await admin.auth.deleteUser("uid-9");
  assert.ok(calls.some((c) => c.url.endsWith("accounts:delete")));

  const link = await admin.auth.generatePasswordResetLink("a@x.com", { continueUrl: "https://site/x" });
  assert.equal(link.oobCode, "ABC123", "oobCode bağlantıdan çıkarılır");
  const oobReq = JSON.parse(calls.find((c) => c.url.endsWith("accounts:sendOobCode")).init.body);
  assert.equal(oobReq.returnOobLink, true);
  assert.equal(oobReq.requestType, "PASSWORD_RESET");

  const list = await admin.auth.listUsers({ maxResults: 50 });
  assert.equal(list.users[0].uid, "u1");
});

test("Auth hataları kod eşlemesi: EMAIL_EXISTS → email_exists/409", async () => {
  const { fetchImpl } = recorder(() => res(400, { error: { message: "EMAIL_EXISTS" } }));
  const admin = createRestAdmin(SA, { fetchImpl });
  await assert.rejects(admin.auth.createUser({ email: "a@b.com", password: "x" }), (e) => e.code === "email_exists" && e.status === 409);
});

test("newPushKey: 20 karakter ve kronolojik sıralı", () => {
  const a = newPushKey(1_800_000_000_000);
  const b = newPushKey(1_800_000_001_000);
  assert.equal(a.length, 20);
  assert.ok(a < b);
  const c = newPushKey(1_800_000_001_000);
  assert.ok(c > b, "aynı milisaniyede artan sıra");
});
