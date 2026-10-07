/**
 * İstemci tarafı kullanıcı yönetimi yardımcıları: rol matrisi, sunucu işlevi istemcisi (not_configured geri dönüşü),
 * müşteri kodu doğrulayıcı, geçici şifre (crypto), boşta oturum zaman aşımı, çıkışta yerel iz temizliği.
 * Çalıştırma: node --test netlify/tests/client-user-admin.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

// Tarayıcı ortamı taklidi
const store = new Map();
globalThis.window = globalThis;
globalThis.document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  },
});
window.__PARLA_FIREBASE = { auth: { currentUser: { uid: "u1", getIdToken: async () => "tok-1" } } };

const { assignableRoles, canManageRole, isHighPrivilegeRole, callAdminUsers, warningsText } = await import("../../assets/js/support-v2/user-admin.js");
const { suggestNextCode, validateCustomerCode } = await import("../../assets/js/support-v2/company-code.js");
const { generateTempPassword } = await import("../../assets/js/support-v2/ticket-utils.js");
const guard = await import("../../assets/js/support-v2/auth-guard.js");

const res = (status, body, raw) => ({ status, ok: status < 300, text: async () => (raw !== undefined ? raw : JSON.stringify(body)) });
let realFetch;
test.before(() => {
  realFetch = globalThis.fetch;
});
test.after(() => {
  globalThis.fetch = realFetch;
});

// ------------------------------------------------------------------------------------------------ rol matrisi
test("rol matrisi: Süper Admin hepsini, Destek Atayıcı yalnız müşteri rolleri + danışman + proje yöneticisini atar/yönetir", () => {
  assert.equal(assignableRoles("super_admin").length, 7);
  const svc = assignableRoles("service_admin");
  assert.deepEqual([...svc].sort(), ["arizi_customer", "company_admin", "consultant", "customer", "project_manager"]);
  assert.deepEqual(assignableRoles("consultant"), []);
  assert.deepEqual(assignableRoles(undefined), []);
  assert.equal(canManageRole("service_admin", "super_admin"), false);
  assert.equal(canManageRole("service_admin", "service_admin"), false);
  assert.equal(canManageRole("service_admin", "customer"), true);
  assert.equal(canManageRole("super_admin", "service_admin"), true);
  assert.equal(isHighPrivilegeRole("service_admin") && isHighPrivilegeRole("super_admin") && !isHighPrivilegeRole("consultant"), true);
});

// ------------------------------------------------------------------------------------------------ sunucu işlevi istemcisi
test("callAdminUsers: başarı → ok + data + warnings; Authorization jetonu ve action gönderilir", async () => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return res(200, { success: true, data: { uid: "x" }, warnings: [{ message: "Uyarı 1" }, { message: "Uyarı 2" }] });
  };
  const out = await callAdminUsers("create", { email: "a@b.com" });
  assert.equal(out.ok, true);
  assert.deepEqual(out.data, { uid: "x" });
  assert.equal(warningsText(out.warnings), "Uyarı 1 Uyarı 2");
  assert.equal(seen.url, "/api/admin-users");
  assert.equal(seen.init.headers.Authorization, "Bearer tok-1");
  assert.deepEqual(JSON.parse(seen.init.body), { email: "a@b.com", action: "create" });
});

test("callAdminUsers: işlev yok/yapılandırılmamış → unavailable (404, 405, 503 not_configured, JSON olmayan 502); gerçek hatalar unavailable DEĞİL", async () => {
  const cases = [
    [404, null, "not found", true],
    [405, null, "", true],
    [503, { success: false, code: "not_configured", message: "x" }, undefined, true],
    [502, null, "<html>Bad gateway</html>", true],
    [409, { success: false, code: "email_in_use", message: "Bu e-posta adresi zaten kayıtlı.", errors: { email: "Bu e-posta adresi zaten kayıtlı." } }, undefined, false],
    [403, { success: false, code: "role_denied", message: "Yetki yok" }, undefined, false],
    [500, { success: false, code: "profile_write_failed", message: "Geri alındı", rolled_back: true }, undefined, false],
  ];
  for (const [status, body, raw, unavailable] of cases) {
    globalThis.fetch = async () => res(status, body, raw);
    const out = await callAdminUsers("create", {});
    assert.equal(out.ok, false, String(status));
    assert.equal(out.unavailable, unavailable, `${status}: unavailable`);
  }
  globalThis.fetch = async () => res(409, { success: false, code: "email_in_use", message: "M", errors: { email: "E" } });
  const conflict = await callAdminUsers("create", {});
  assert.deepEqual(conflict.errors, { email: "E" });
  assert.equal(conflict.message, "M");
  globalThis.fetch = async () => res(500, { success: false, code: "profile_write_failed", message: "M", rolled_back: true });
  assert.equal((await callAdminUsers("create", {})).rolledBack, true);
});

test("callAdminUsers: ağ hatası → network (unavailable değil: yedek akışa SESSİZCE düşülmez); oturum yoksa no_session", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  const net = await callAdminUsers("create", {});
  assert.equal(net.code, "network");
  assert.equal(net.unavailable, false);
  const saved = window.__PARLA_FIREBASE;
  window.__PARLA_FIREBASE = { auth: { currentUser: null } };
  try {
    assert.equal((await callAdminUsers("create", {})).code, "no_session");
  } finally {
    window.__PARLA_FIREBASE = saved;
  }
});

// ------------------------------------------------------------------------------------------------ müşteri kodu
test("müşteri kodu: biçim, tip öneki uyumu, benzersizlik, eski kodu koruma, sıradaki öneri (YON-08)", () => {
  const companies = [
    { id: "c1", name: "ABC", customer_code: "CUS0001" },
    { id: "c2", name: "Eski Firma", customer_code: "DMR" },
    { id: "c3", name: "Arızi", customer_code: "ARC0007" },
  ];
  assert.equal(suggestNextCode("CUS", companies), "CUS0002");
  assert.equal(suggestNextCode("ARC", companies), "ARC0008");
  assert.equal(suggestNextCode("???", []), "CUS0001");
  assert.equal(validateCustomerCode({ code: " cus0002 ", type: "CUS", companies }).valid, true);
  assert.equal(validateCustomerCode({ code: "CUS0002", type: "CUS", companies }).code, "CUS0002");
  assert.match(validateCustomerCode({ code: "CUS0001", type: "CUS", companies }).error, /ABC/);
  assert.equal(validateCustomerCode({ code: "CUS0001", type: "CUS", companies, excludeId: "c1" }).valid, true, "kendi koduyla çakışmaz");
  assert.match(validateCustomerCode({ code: "ARC0009", type: "CUS", companies }).error, /CUS ile başlamalı/);
  assert.equal(validateCustomerCode({ code: "abc", type: "CUS", companies }).valid, false);
  assert.equal(validateCustomerCode({ code: "", type: "CUS", companies }).valid, false);
  assert.equal(validateCustomerCode({ code: "DMR0001", type: "CUS", companies }).valid, false, "yeni kodlar yalnız CUS/ARC önekli");
  assert.equal(validateCustomerCode({ code: "DMR0001", type: "CUS", companies, keepLegacy: "DMR0001" }).valid, true, "değişmemiş eski kod korunur");
});

// ------------------------------------------------------------------------------------------------ geçici şifre
test("generateTempPassword: Math.random kullanmaz, ilkeye uyar, çeşitli (SEC-31)", () => {
  const orig = Math.random;
  let used = false;
  Math.random = () => {
    used = true;
    return 0.5;
  };
  const seen = new Set();
  try {
    for (let i = 0; i < 200; i += 1) seen.add(generateTempPassword());
  } finally {
    Math.random = orig;
  }
  assert.equal(used, false);
  assert.equal(seen.size, 200);
  for (const p of seen) {
    assert.equal(p.length, 12);
    assert.match(p, /[A-Z]/);
    assert.match(p, /[a-z]/);
    assert.match(p, /[0-9]/);
  }
  assert.equal(generateTempPassword(20).length, 20);
  assert.equal(generateTempPassword(3).length, 8, "alt sınır 8");
});

// ------------------------------------------------------------------------------------------------ boşta zaman aşımı
test("boşta oturum zaman aşımı: personel 8 saat, müşteri 30 gün; kayıt yoksa dolmuş sayılmaz (SEC-35)", () => {
  const H = 3600 * 1000;
  const now = Date.now();
  assert.equal(guard.idleLimitMs("consultant"), 8 * H);
  assert.equal(guard.idleLimitMs("super_admin"), 8 * H);
  assert.equal(guard.idleLimitMs("customer"), 30 * 24 * H);
  assert.equal(guard.idleLimitMs("company_admin"), 30 * 24 * H);
  assert.equal(guard.isIdleExpired("consultant", "ux", now), false, "ilk giriş: kayıt yok");
  store.set("sv2_last_active_ux", String(now - 7 * H));
  assert.equal(guard.isIdleExpired("consultant", "ux", now), false);
  store.set("sv2_last_active_ux", String(now - 8 * H - 1000));
  assert.equal(guard.isIdleExpired("consultant", "ux", now), true);
  assert.equal(guard.isIdleExpired("customer", "ux", now), false, "aynı boşta süre müşteri için sorun değil");
  store.set("sv2_last_active_ux", String(now - 31 * 24 * H));
  assert.equal(guard.isIdleExpired("customer", "ux", now), true);
});

// ------------------------------------------------------------------------------------------------ çıkışta temizlik
test("çıkışta yerel iz temizliği: e-posta kuyruğu + 'görüldü' + zil önbelleği + etkinlik damgası silinir; başka veriler kalır (SEC-28)", async () => {
  store.clear();
  const future = Date.now() + 3600 * 1000;
  store.set("sv2_email_outbox_u1", JSON.stringify([{ payload: { type: "ticket_message", requestId: "r1", to: ["a@b.com"], extra: { note: "gizli yanıt" } }, attempts: 0, firstAt: Date.now(), lastAt: Date.now(), nextAt: future }]));
  store.set("sv2_seen_u1", "{}");
  store.set("sv2_seen_baseline_u1", "1");
  store.set("sv2_bell_cache_u1", "{}");
  store.set("sv2_bell_pid_u1", "p1");
  store.set("sv2_last_active_u1", String(Date.now()));
  store.set("baska_ayar", "kalsın");
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return res(500, null, "");
  };
  await guard.clearLocalSessionData("u1");
  assert.deepEqual([...store.keys()], ["baska_ayar"]);
  assert.equal(calls, 0, "zamanı gelmemiş kuyruk öğesi için ağ isteği yapılmadı");
});
