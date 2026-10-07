/**
 * admin-users işlevi testleri (sahte Admin + sahte Resend + sahte saat; ağ yok).
 * Kapsam: rol matrisi, davet/geçici şifre kipi, geri alma, yetim hesap onarımı, son süper admin / kendini kilitleme,
 * pasife alma (Auth devre dışı + oturum iptali), bağlantı e-postası (parola yok), personel eşleştirme, not_configured.
 * Çalıştırma: node --test netlify/tests/admin-users.test.js   (openssl gerekir)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFixture, makeToken, ORIGIN, withEnv } = require("./helpers/fn-fixture");
const { createFakeAdmin } = require("./helpers/fake-admin");
const { MemoryStore } = require("../lib/guard-store");
const guard = require("../lib/email-guard");
const { setAdminForTests } = require("../lib/admin");
const { handler } = require("../functions/admin-users");

const NOW = Date.parse("2026-10-07T09:00:00.000Z");
const fx = createFixture();
fx.install();

const tokens = {
  root: () => makeToken({ sub: "u-root", email: "root@parla.com" }),
  root2: () => makeToken({ sub: "u-root2", email: "root2@parla.com" }),
  svc: () => makeToken({ sub: "u-svc", email: "svc@parla.com" }),
  cons: () => makeToken({ sub: "u-cons", email: "cons@parla.com" }),
  off: () => makeToken({ sub: "u-off", email: "off@parla.com" }),
};

function seed() {
  const iso = "2026-01-01T00:00:00.000Z";
  return {
    v2: {
      users: {
        "u-root": { uid: "u-root", email: "root@parla.com", first_name: "Ali", last_name: "Kök", role: "super_admin", is_active: true },
        "u-svc": { uid: "u-svc", email: "svc@parla.com", first_name: "Sema", last_name: "Atayıcı", role: "service_admin", is_active: true },
        "u-cons": { uid: "u-cons", email: "cons@parla.com", first_name: "Can", last_name: "Danışman", role: "consultant", is_active: true },
        "u-off": { uid: "u-off", email: "off@parla.com", role: "super_admin", is_active: false },
        "u-cust": { uid: "u-cust", email: "musteri@abc.com", first_name: "Müşteri", last_name: "Kişi", role: "customer", is_active: true, company_id: "c1", company_name: "ABC A.Ş.", customer_code: "CUS0001" },
      },
      companies: {
        c1: { company_id: "c1", name: "ABC A.Ş.", customer_code: "CUS0001", customer_type: "CUS", is_active: true },
        c2: { company_id: "c2", name: "Pasif Ltd.", customer_code: "CUS0002", customer_type: "CUS", is_active: false },
      },
      personnel: {
        p1: { personnel_id: "p1", first_name: "Yeni", last_name: "Danışman", email: "yeni.danisman@parla.com", is_active: true, uid: "" },
        p2: { personnel_id: "p2", first_name: "Başka", last_name: "Kişi", email: "baska@parla.com", is_active: true, uid: "u-baska" },
      },
      tickets: { T1: { title: "x", user_id: "u-cust", status: "open" }, T2: { title: "y", user_id: "u-cust", status: "open" } },
      ticket_assignments: { T1: { p1: { personnel_id: "p1", is_primary: true } } },
    },
  };
}

let admin;
let store;
let restore;
let clock;

test.beforeEach(() => {
  fx.reset();
  setAdminForTests(null);
  admin = createFakeAdmin(seed(), { now: () => clock });
  clock = NOW;
  store = new MemoryStore();
  restore = withEnv({ RESEND_API_KEY: "re_test", SITE_URL: "https://www.parlabilgiteknolojileri.net", FIREBASE_SERVICE_ACCOUNT: null });
});
test.afterEach(() => restore());

async function call(body, token, deps, headers) {
  const res = await handler(
    {
      httpMethod: "POST",
      headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
      body: JSON.stringify(body),
    },
    {},
    { admin, store, now: () => clock, limits: guard.getLimits({}, { relaxed: false }), ...(deps || {}) }
  );
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

const newUser = (extra) => ({
  action: "create",
  first_name: "Yeni",
  last_name: "Kullanıcı",
  email: "  Yeni.Kullanici@ABC.com ",
  phone: "+90 532 111 22 33",
  role: "customer",
  company_id: "c1",
  ...(extra || {}),
});

// ------------------------------------------------------------------------------------------------ erişim
test("not_configured: servis hesabı yoksa 503 not_configured (hata değil, özellik kapalı)", async () => {
  const res = await handler({ httpMethod: "POST", headers: { origin: ORIGIN, authorization: `Bearer ${tokens.root()}` }, body: JSON.stringify(newUser()) }, {}, { store, now: () => clock });
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).code, "not_configured");
  assert.equal(fx.resendCalls.length, 0);
});

test("kimlik: jeton yok 401, müşteri/danışman/pasif yönetici 403, yanlış kaynak 403, geçersiz işlem 400", async () => {
  assert.equal((await call(newUser(), null)).status, 401);
  assert.equal((await call(newUser(), tokens.cons())).status, 403);
  assert.equal((await call(newUser(), tokens.off())).status, 403);
  assert.equal((await call(newUser(), tokens.root(), null, { origin: "https://evil.example" })).status, 403);
  assert.equal((await call({ action: "sil" }, tokens.root())).status, 400);
  assert.equal(admin.state.users.size, 0);
});

// ------------------------------------------------------------------------------------------------ rol matrisi
test("rol matrisi: service_admin super_admin/service_admin atayamaz; danışman/müşteri atayabilir; super_admin hepsini", async () => {
  for (const role of ["super_admin", "service_admin"]) {
    const res = await call(newUser({ role, company_id: "", email: `${role}@x.com` }), tokens.svc());
    assert.equal(res.status, 400, role);
    assert.match(res.body.errors.role, /yetkiniz yok/);
  }
  assert.equal(admin.state.users.size, 0, "reddedilen rolde Auth hesabı AÇILMAZ");
  assert.equal((await call(newUser({ role: "consultant", company_id: "", email: "d1@x.com" }), tokens.svc())).status, 200);
  assert.equal((await call(newUser({ role: "project_manager", company_id: "", email: "d2@x.com" }), tokens.svc())).status, 200);
  assert.equal((await call(newUser({ role: "service_admin", company_id: "", email: "d3@x.com" }), tokens.root())).status, 200);
  assert.equal((await call(newUser({ role: "super_admin", company_id: "", email: "d4@x.com" }), tokens.root())).status, 200);
});

// ------------------------------------------------------------------------------------------------ create
test("create (davet): e-posta küçük harf, firma adı/kodu sunucudan, parola yok, bağlantı e-postası gider, must_change_password=false", async () => {
  const res = await call(newUser({ company_name: "SAHTE AD", customer_code: "HACK0001", must_change_password: true }), tokens.svc());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const d = res.body.data;
  assert.equal(d.mode, "invite");
  assert.equal(d.email, "yeni.kullanici@abc.com");
  assert.equal(d.invite.status, "sent");
  const profile = admin.getAt(`v2/users/${d.uid}`);
  assert.equal(profile.email, "yeni.kullanici@abc.com");
  assert.equal(profile.company_name, "ABC A.Ş.", "istemci company_name değerine güvenilmez");
  assert.equal(profile.customer_code, "CUS0001");
  assert.equal(profile.must_change_password, false, "bağlantıyla şifre belirleyen için bayrak kapalı (SEN-10, EML-17)");
  assert.equal(profile.is_active, true);
  assert.equal(profile.created_by, "u-svc");
  assert.equal(profile.phone, "+905321112233");

  const authPw = admin.state.users.get(d.uid).password;
  assert.ok(authPw.length >= 20, "rastgele parola Auth'a yazıldı");
  assert.ok(!JSON.stringify(res.body).includes(authPw), "parola yanıta sızmaz");

  assert.equal(fx.resendCalls.length, 1);
  const mail = fx.resendCalls[0].payload;
  assert.deepEqual(mail.to, ["yeni.kullanici@abc.com"]);
  assert.ok(!(mail.html + mail.text).includes(authPw), "parola e-postada ASLA yok");
  assert.match(mail.text, /https:\/\/www\.parlabilgiteknolojileri\.net\/support-v2\/auth-action\.html\?mode=resetPassword&oobCode=OOB-/);
  const activity = Object.values(admin.getAt("v2/activities"));
  assert.equal(activity[0].action, "user_created");
});

test("create (geçici şifre): must_change_password=true, e-posta gitmez, parola yanıtta/e-postada yok", async () => {
  const res = await call(newUser({ password: "Gecici123x" }), tokens.root());
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.mode, "password");
  assert.equal(admin.getAt(`v2/users/${d.uid}/must_change_password`), true);
  assert.equal(admin.state.users.get(d.uid).password, "Gecici123x");
  assert.equal(fx.resendCalls.length, 0);
  assert.ok(!JSON.stringify(res.body).includes("Gecici123x"));
});

test("create doğrulama: e-posta/telefon/parola/ad/firma hataları alan bazında; Auth hesabı açılmaz", async () => {
  const bad = await call({ action: "create", email: "yok", first_name: "", last_name: "", phone: "123", role: "customer", password: "zayif" }, tokens.root());
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "validation");
  for (const f of ["email", "first_name", "last_name", "phone", "company_id", "password"]) assert.ok(bad.body.errors[f], f);
  assert.equal(admin.state.users.size, 0);
});

test("create çakışmaları: yinelenen e-posta (büyük/küçük harf), personel çakışması, olmayan/pasif firma", async () => {
  const dup = await call(newUser({ email: "MUSTERI@abc.com" }), tokens.root());
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "email_in_use");

  const conflict = await call(newUser({ email: "Baska@Parla.com" }), tokens.root());
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "role_conflict");

  assert.equal((await call(newUser({ company_id: "yok" }), tokens.root())).body.code, "company_not_found");
  assert.equal((await call(newUser({ company_id: "c2" }), tokens.root())).body.code, "company_inactive");
  assert.equal(admin.state.users.size, 0);
});

test("personel rolünde firma alanları boş yazılır (YON-16a)", async () => {
  const res = await call(newUser({ role: "consultant", company_id: "c1", email: "dan@x.com" }), tokens.root());
  const p = admin.getAt(`v2/users/${res.body.data.uid}`);
  assert.equal(p.company_id, "");
  assert.equal(p.company_name, "");
  assert.equal(p.customer_code, "");
});

test("dry_run: doğrular ama hiçbir şey yazmaz (firma yazımından ÖNCE çakışmayı yakalamak için)", async () => {
  const ok = await call(newUser({ dry_run: true }), tokens.root());
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.dry_run, true);
  assert.equal(admin.state.users.size, 0);
  assert.equal(admin.state.calls.filter((c) => c.op === "db.set").length, 0);
  const dup = await call(newUser({ email: "musteri@abc.com", dry_run: true }), tokens.root());
  assert.equal(dup.status, 409);
});

// ------------------------------------------------------------------------------------------------ geri alma
test("geri alma: profil yazımı başarısız olursa Auth hesabı SİLİNİR (yetim hesap oluşmaz)", async () => {
  admin.failures.push({ op: "db.set", times: 1, match: ([p]) => /^v2\/users\//.test(p) });
  const res = await call(newUser({ email: "geri@x.com" }), tokens.root());
  assert.equal(res.status, 500);
  assert.equal(res.body.code, "profile_write_failed");
  assert.equal(res.body.rolled_back, true);
  assert.equal(admin.state.users.size, 0, "Auth hesabı geri alındı");
  assert.ok(!res.body.message.includes("injected"), "ayrıntı sızmaz");
  // Aynı e-postayla yeniden deneme artık çalışır
  assert.equal((await call(newUser({ email: "geri@x.com" }), tokens.root())).status, 200);
});

test("geri alma başarısız olursa rollback_failed + onarım yönergesi", async () => {
  admin.failures.push({ op: "db.set", times: 1, match: ([p]) => /^v2\/users\//.test(p) });
  admin.failures.push({ op: "auth.deleteUser", times: 1 });
  const res = await call(newUser({ email: "geri2@x.com" }), tokens.root());
  assert.equal(res.body.code, "rollback_failed");
  assert.equal(res.body.rolled_back, false);
  assert.match(res.body.message, /yetim hesabı onar/i);
  assert.equal(admin.state.users.size, 1);
  // Onarım yolu: aynı e-posta yetim hesap olarak bağlanır
  const fixed = await call({ ...newUser({ email: "geri2@x.com" }), action: "repair" }, tokens.root());
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  assert.equal(fixed.body.data.orphan_repaired, true);
  assert.equal(admin.state.users.size, 1, "yeni Auth hesabı açılmadı; var olan bağlandı");
});

test("yetim hesap onarımı: Auth'ta var, profil yok → profil mevcut uid'e bağlanır; devre dışıysa etkinleştirilir", async () => {
  admin.addAuthUser("orph-1", "yetim@x.com", { disabled: true });
  const orphans = await call({ action: "orphans" }, tokens.root());
  assert.deepEqual(orphans.body.data.orphans.map((o) => o.email), ["yetim@x.com"]);

  const res = await call(newUser({ email: "yetim@x.com", password: "Yeni1234x" }), tokens.root());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.uid, "orph-1");
  assert.equal(res.body.data.orphan_repaired, true);
  assert.equal(admin.getAt("v2/users/orph-1/email"), "yetim@x.com");
  assert.equal(admin.state.users.get("orph-1").disabled, false);
  assert.equal(admin.state.users.get("orph-1").password, "Yeni1234x", "geçici şifre mod: mevcut hesaba yeni şifre");
  assert.equal(admin.state.users.size, 1);
  assert.equal(Object.values(admin.getAt("v2/activities"))[0].action, "user_repaired");
  assert.deepEqual((await call({ action: "orphans" }, tokens.root())).body.data.orphans, []);
});

test("repair: yetim olmayan e-posta için 404 not_orphan", async () => {
  const res = await call({ ...newUser({ email: "hic-yok@x.com" }), action: "repair" }, tokens.root());
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "not_orphan");
});

test("profil yazıldıktan sonraki hatalar 'oluşturulamadı' DEMEZ (YON-07): aktivite/e-posta hatası uyarıdır", async () => {
  admin.failures.push({ op: "db.set", match: ([p]) => /^v2\/activities\//.test(p) });
  fx.resendResponder = () => ({ ok: false, status: 500, headers: { get: () => "" }, json: async () => ({ name: "application_error" }) });
  const res = await call(newUser({ email: "uyari@x.com" }), tokens.root());
  assert.equal(res.status, 200);
  const codes = res.body.warnings.map((w) => w.code);
  assert.ok(codes.includes("activity_failed"));
  assert.ok(codes.includes("invite_not_sent"));
  assert.ok(admin.getAt(`v2/users/${res.body.data.uid}`), "profil yazıldı");
  assert.match(res.body.data.invite.link, /oobCode=/, "e-posta gitmediyse bağlantı yöneticiye döner (güvenli kanaldan iletilsin)");
});

test("personel eşleştirme: danışman oluşturulunca personnel.uid + assigned_uids bağlanır; kayıt yoksa uyarı", async () => {
  const res = await call(newUser({ role: "consultant", company_id: "", email: "yeni.danisman@parla.com" }), tokens.root());
  const uid = res.body.data.uid;
  assert.equal(res.body.data.personnel.status, "linked");
  assert.equal(admin.getAt("v2/personnel/p1/uid"), uid);
  assert.equal(admin.getAt(`v2/tickets/T1/assigned_uids/${uid}`), true, "atanmış talepte danışman yazma yetkisi");
  assert.equal(admin.getAt(`v2/tickets/T2/assigned_uids/${uid}`), undefined);

  const none = await call(newUser({ role: "consultant", company_id: "", email: "kayitsiz@parla.com" }), tokens.root());
  assert.ok(none.body.warnings.some((w) => w.code === "no_personnel"));
});

// ------------------------------------------------------------------------------------------------ setActive
test("setActive(false): profil pasif + Auth devre dışı + oturumlar iptal; setActive(true): Auth etkinleşir", async () => {
  admin.addAuthUser("u-cust", "musteri@abc.com");
  const res = await call({ action: "setActive", uid: "u-cust", active: false }, tokens.svc());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(admin.getAt("v2/users/u-cust/is_active"), false);
  assert.equal(admin.state.users.get("u-cust").disabled, true);
  assert.equal(admin.state.users.get("u-cust").validSince, Math.floor(NOW / 1000), "refresh token'lar iptal edildi");
  assert.equal(Object.values(admin.getAt("v2/activities"))[0].action, "user_deactivated");

  const back = await call({ action: "setActive", uid: "u-cust", active: true }, tokens.svc());
  assert.equal(back.status, 200);
  assert.equal(admin.getAt("v2/users/u-cust/is_active"), true);
  assert.equal(admin.state.users.get("u-cust").disabled, false);
});

test("setActive: Auth hesabı yoksa profil yine pasifleşir, uyarı döner; Auth hatasında profil pasif kalır", async () => {
  const noAuth = await call({ action: "setActive", uid: "u-cust", active: false }, tokens.root());
  assert.equal(noAuth.status, 200);
  assert.ok(noAuth.body.warnings.some((w) => w.code === "auth_missing"));
  assert.equal(admin.getAt("v2/users/u-cust/is_active"), false);

  admin.addAuthUser("u-cons", "cons@parla.com");
  admin.failures.push({ op: "auth.updateUser" });
  const partial = await call({ action: "setActive", uid: "u-cons", active: false }, tokens.root());
  assert.equal(partial.status, 200);
  assert.ok(partial.body.warnings.some((w) => w.code === "auth_disable_failed"));
  assert.equal(admin.getAt("v2/users/u-cons/is_active"), false, "kurallar düzeyinde erişim kesildi");
});

test("kendini kilitleme: kendi hesabını pasife alamaz, kendi rolünü değiştiremez (YON-06)", async () => {
  assert.equal((await call({ action: "setActive", uid: "u-root", active: false }, tokens.root())).body.code, "self_lock");
  assert.equal((await call({ action: "update", uid: "u-root", role: "consultant" }, tokens.root())).body.code, "self_lock");
  assert.equal(admin.getAt("v2/users/u-root/is_active"), true);
  assert.equal(admin.getAt("v2/users/u-root/role"), "super_admin");
});

test("iki aktif süper admin varken biri diğerini pasife alabilir; 'son' koruması çekirdekte savunma amaçlıdır", async () => {
  admin.setAt("v2/users/u-root2", { uid: "u-root2", email: "root2@parla.com", role: "super_admin", is_active: true });
  assert.equal((await call({ action: "setActive", uid: "u-root", active: false }, tokens.root2())).status, 200);
  assert.equal(admin.getAt("v2/users/u-root/is_active"), false);

  // Çekirdek doğrudan: çağıran (artık silinmiş/pasif) başka bir süper admin gibi davranırsa, TEK aktif süper admin hedefi korunur.
  const core = require("../lib/admin-users-core");
  const ctx = { admin, caller: { uid: "u-ghost", role: "super_admin", name: "Hayalet" }, store, limits: {}, apiKey: "", siteUrl: "https://x", now: () => clock };
  await assert.rejects(core.setActive(ctx, { uid: "u-root2", active: false }), (e) => e.code === "last_super_admin");
  await assert.rejects(core.updateUser(ctx, { uid: "u-root2", role: "consultant" }), (e) => e.code === "last_super_admin");
  assert.equal(admin.getAt("v2/users/u-root2/is_active"), true);
  assert.equal(admin.getAt("v2/users/u-root2/role"), "super_admin");
});

test("service_admin süper admin / destek atayıcı hesaplarını yönetemez", async () => {
  assert.equal((await call({ action: "setActive", uid: "u-root", active: false }, tokens.svc())).body.code, "target_forbidden");
  assert.equal((await call({ action: "update", uid: "u-root", first_name: "X" }, tokens.svc())).body.code, "target_forbidden");
  assert.equal((await call({ action: "resetLink", uid: "u-root" }, tokens.svc())).body.code, "target_forbidden");
  assert.equal(admin.getAt("v2/users/u-root/is_active"), true);
});

// ------------------------------------------------------------------------------------------------ update
test("update: rol matrisi, firma/rol tutarlılığı, boş değişiklik", async () => {
  // service_admin, müşteriyi service_admin yapamaz
  const deny = await call({ action: "update", uid: "u-cust", role: "service_admin" }, tokens.svc());
  assert.equal(deny.status, 400);
  assert.match(deny.body.errors.role, /yetkiniz yok/);
  // customer -> consultant: firma alanları boşalır
  const ok = await call({ action: "update", uid: "u-cust", role: "consultant", phone: "05321112233" }, tokens.svc());
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const p = admin.getAt("v2/users/u-cust");
  assert.equal(p.role, "consultant");
  assert.equal(p.company_id, "");
  assert.equal(p.company_name, "");
  assert.equal(p.phone, "05321112233");
  // consultant -> customer: firma zorunlu
  const noCompany = await call({ action: "update", uid: "u-cust", role: "customer" }, tokens.svc());
  assert.equal(noCompany.status, 400);
  const withCompany = await call({ action: "update", uid: "u-cust", role: "customer", company_id: "c1" }, tokens.svc());
  assert.equal(withCompany.status, 200);
  assert.equal(admin.getAt("v2/users/u-cust/company_name"), "ABC A.Ş.");
  const same = await call({ action: "update", uid: "u-cust" }, tokens.svc());
  assert.equal(same.body.data.changed, false);
  // kendi rolünü değiştiremez
  assert.equal((await call({ action: "update", uid: "u-svc", role: "consultant" }, tokens.svc())).body.code, "self_lock");
});

// ------------------------------------------------------------------------------------------------ resetLink
test("resetLink: şifre belirleme bağlantısı e-postayla gider (parola yok); send:false bağlantıyı yöneticiye verir", async () => {
  admin.addAuthUser("u-cust", "musteri@abc.com");
  const res = await call({ action: "resetLink", uid: "u-cust" }, tokens.svc());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.sent, true);
  assert.equal(res.body.data.link, undefined, "gönderildiyse bağlantı yanıta konmaz");
  assert.equal(fx.resendCalls.length, 1);
  const mail = fx.resendCalls[0].payload;
  assert.deepEqual(mail.to, ["musteri@abc.com"]);
  assert.match(mail.subject, /şifre belirleme/i);
  assert.match(mail.text, /auth-action\.html\?mode=resetPassword&oobCode=OOB-/);

  const manual = await call({ action: "resetLink", uid: "u-cust", send: false }, tokens.svc());
  assert.equal(manual.body.data.sent, false);
  assert.match(manual.body.data.link, /^https:\/\/www\.parlabilgiteknolojileri\.net\/support-v2\/auth-action\.html\?mode=resetPassword&oobCode=/);
  assert.equal(fx.resendCalls.length, 1);
});

test("resetLink: kota doluysa e-posta gitmez, bağlantı yöneticiye döner; pasif hesap ve yetim profil reddedilir", async () => {
  admin.addAuthUser("u-cust", "musteri@abc.com");
  const tight = { limits: { ...guard.getLimits({}, { relaxed: false }), dailySoft: 0, dailyHard: 0 } };
  const res = await call({ action: "resetLink", uid: "u-cust" }, tokens.svc(), tight);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.sent, false);
  assert.match(res.body.data.link, /oobCode=/);
  assert.ok(res.body.warnings.some((w) => w.code === "reset_not_sent"));
  assert.equal(fx.resendCalls.length, 0);

  assert.equal((await call({ action: "resetLink", uid: "u-cons" }, tokens.root())).body.code, "auth_missing");
  admin.setAt("v2/users/u-cust/is_active", false);
  assert.equal((await call({ action: "resetLink", uid: "u-cust" }, tokens.root())).body.code, "inactive_target");
});

// ------------------------------------------------------------------------------------------------ matchPersonnel / sınır
test("matchPersonnel: yalnız danışman/PM; eşleşmeyen kayıt için no_personnel", async () => {
  admin.setAt("v2/users/u-new", { uid: "u-new", email: "yeni.danisman@parla.com", role: "consultant", is_active: true });
  const res = await call({ action: "matchPersonnel", uid: "u-new" }, tokens.svc());
  assert.equal(res.body.data.personnel.status, "linked");
  assert.equal(admin.getAt("v2/personnel/p1/uid"), "u-new");
  assert.equal((await call({ action: "matchPersonnel", uid: "u-cust" }, tokens.svc())).body.code, "not_staff");
});

test("hız sınırı: yönetici başına dakikada 30 istek; sonrası 429 + Retry-After", async () => {
  let last;
  for (let i = 0; i < 31; i += 1) last = await call({ action: "orphans" }, tokens.root());
  assert.equal(last.status, 429);
  assert.equal(last.body.code, "rate_limited_user");
  assert.ok(last.body.retry_after >= 1);
});

test("hata gövdelerinde altyapı ayrıntısı yok (beklenmeyen hata → genel mesaj)", async () => {
  admin.failures.push({ op: "auth.getUserByEmail", error: new Error("SECRET-INFRA-DETAIL token=abc") });
  const res = await call(newUser({ email: "x@y.com" }), tokens.root());
  assert.equal(res.status, 500);
  assert.equal(res.body.code, "internal");
  assert.ok(!JSON.stringify(res.body).includes("SECRET"));
});

test("status: servis hesabı yapılandırılmışsa configured:true; dry_run + __pending__ firma yer tutucusu (satır içi yeni firma)", async () => {
  const st = await call({ action: "status" }, tokens.svc());
  assert.equal(st.status, 200);
  assert.equal(st.body.data.configured, true);
  assert.equal(st.body.data.role, "service_admin");

  const pending = await call(newUser({ company_id: "__pending__", dry_run: true }), tokens.root());
  assert.equal(pending.status, 200, JSON.stringify(pending.body));
  const dup = await call(newUser({ company_id: "__pending__", dry_run: true, email: "musteri@abc.com" }), tokens.root());
  assert.equal(dup.status, 409, "yeni firma yazılmadan önce e-posta çakışması yakalanır");
  // gerçek oluşturmada yer tutucu KABUL EDİLMEZ
  const real = await call(newUser({ company_id: "__pending__" }), tokens.root());
  assert.equal(real.body.code, "company_not_found");
  assert.equal(admin.state.users.size, 0);
});
