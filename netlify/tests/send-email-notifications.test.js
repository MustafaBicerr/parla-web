/**
 * WP-05 bildirim kapsamı testleri (sunucu türetimli alıcılar): atama değişiminde kim ne alır, kritik öncelik, yeni talep →
 * Destek Atayıcılar, `assigned_to_id` yedeği (EML-16), eskiyen atama adresi (YON-04), atama+durum yinelenmesi (EML-28).
 * Çalıştırma: node --test netlify/tests/send-email-notifications.test.js   (openssl gerekir)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { mock } = require("node:test");
const { createFixture, TOKENS, post, withEnv, makeToken } = require("./helpers/fn-fixture");
const { createFakeAdmin } = require("./helpers/fake-admin");

process.env.RESEND_API_KEY = "re_test";
const { handler } = require("../functions/send-email");
const { resetCertCache } = require("../lib/firebase-auth");
const { MemoryStore, setStoreForTests } = require("../lib/guard-store");
const { setAdminForTests } = require("../lib/admin");

const fx = createFixture();
let store;
let restoreEnv = () => {};

function seedExtras() {
  const now = new Date().toISOString();
  const v2 = fx.db.v2;
  v2.personnel.p1 = { personnel_id: "p1", first_name: "Zeynep", last_name: "Arslan", email: "danisman@parla.com", is_active: true, uid: "uid-cons" };
  v2.personnel.p3 = { personnel_id: "p3", first_name: "Baran", last_name: "Kaya", email: "baran@parla.com", is_active: true };
  v2.personnel.p4 = { personnel_id: "p4", first_name: "Deniz", last_name: "Yıldız", email: "deniz@parla.com", is_active: true };
  v2.users["uid-svc"] = { role: "service_admin", is_active: true, email: "atayici@parla.com", first_name: "Sema", last_name: "Atayıcı" };
  // Atama sonrası durum: primary p3, ikincil p1
  v2.tickets.T1.assigned_to_id = "p3";
  v2.tickets.T1.assigned_to_name = "Baran Kaya";
  v2.ticket_assignments.T1 = {
    p3: { personnel_id: "p3", personnel_name: "Baran Kaya", personnel_email: "baran@parla.com", is_primary: true },
    p1: { personnel_id: "p1", personnel_name: "Zeynep Arslan", personnel_email: "danisman@parla.com", is_primary: false },
  };
  v2.ticket_history.T1 = {};
  return now;
}

const hist = (key, uid, entry, atMs) => {
  fx.db.v2.ticket_history.T1[key] = {
    history_id: key,
    changed_by_uid: uid,
    changed_by_name: "Ali Veli",
    changed_at: new Date(atMs == null ? Date.now() : atMs).toISOString(),
    ...entry,
  };
};

test.beforeEach(() => {
  fx.reset();
  fx.install();
  resetCertCache();
  store = new MemoryStore();
  setStoreForTests(store);
  setAdminForTests(null);
  seedExtras();
  restoreEnv = withEnv({
    SITE_URL: null, CONTACT_EMAIL: null, ALLOWED_ORIGINS: null, RESEND_TIMEOUT_MS: null, FIREBASE_SERVICE_ACCOUNT: null,
    DAILY_EMAIL_SOFT_LIMIT: null, DAILY_EMAIL_HARD_LIMIT: null, AWS_LAMBDA_FUNCTION_NAME: null, CONTEXT: null, RATE_LIMIT_MODE: null,
  });
  mock.method(console, "warn", () => {});
  mock.method(console, "error", () => {});
});
test.afterEach(() => {
  restoreEnv();
  setAdminForTests(null);
  mock.restoreAll();
});

const mail = (type, to, ticketId, extra) => ({ type, to, ticketData: { ticket_id: ticketId || "T1" }, extra });
const json = (res) => JSON.parse(res.body);
const byType = () => fx.resendCalls.map((c) => ({ to: c.payload.to, subject: c.payload.subject, text: c.payload.text, tag: c.payload.tags[0].value }));

// ------------------------------------------------------------------------------------------------ atama değişimi
test("A→B yeniden atama: yeni danışmana atama, eski danışmana 'talep sizden alındı', müşteriye TEK 'danışman atandı'", async () => {
  // p1 ikincil kalmasın: yalnız p3 atanmış, p1 çıkarıldı
  delete fx.db.v2.ticket_assignments.T1.p1;
  hist("-H1", "uid-staff", { action: "assigned_to_changed", field_changed: "assigned_to_name", old_value: "Zeynep Arslan", new_value: "Baran Kaya" });
  const res = await post(handler, mail("ticket_assignment_changed", ["@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200, res.body);
  const sent = byType();
  assert.equal(sent.length, 3, JSON.stringify(sent));
  const added = sent.find((m) => m.tag === "ticket_assigned");
  const removed = sent.find((m) => m.tag === "ticket_unassigned");
  const customer = sent.find((m) => m.tag === "consultant_assigned");
  assert.deepEqual(added.to, ["baran@parla.com"]);
  assert.deepEqual(removed.to, ["danisman@parla.com"]);
  assert.match(removed.text, /artık sorumluluğunuzda değil/);
  assert.match(removed.text, /yeni sorumlu: Baran Kaya/);
  assert.deepEqual(customer.to, ["musteri@abc.com"]);
  assert.match(customer.text, /Baran Kaya adlı danışmanımıza atandı/);
  assert.match(customer.text, /customer\/ticket-detail\.html/);
  assert.match(added.text, /admin\/ticket-detail\.html/);
});

test("ikincil danışman eklendi (birincil aynı): yalnız yeni danışmana atama e-postası; müşteriye bildirim yok", async () => {
  hist("-H2", "uid-staff", { action: "assignment_added", field_changed: "assignment", old_value: "", new_value: "Zeynep Arslan" });
  const res = await post(handler, mail("ticket_assignment_changed", ["@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200, res.body);
  const sent = byType();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].tag, "ticket_assigned");
  assert.deepEqual(sent[0].to, ["danisman@parla.com"]);
});

test("ikincil danışman çıkarıldı: yalnız çıkarılana bildirim", async () => {
  delete fx.db.v2.ticket_assignments.T1.p1;
  hist("-H3", "uid-staff", { action: "assignment_removed", field_changed: "assignment", old_value: "Zeynep Arslan", new_value: "" });
  const res = await post(handler, mail("ticket_assignment_changed", ["@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(byType().map((m) => [m.tag, m.to.join()]), [["ticket_unassigned", "danisman@parla.com"]]);
});

test("tekilleştirme: aynı değişiklik için yeniden istek yeni e-posta üretmez; yeni değişiklik üretir", async () => {
  hist("-H4", "uid-staff", { action: "assignment_added", field_changed: "assignment", old_value: "", new_value: "Zeynep Arslan" });
  assert.equal((await post(handler, { ...mail("ticket_assignment_changed", ["@assigned"]), requestId: "r1" }, TOKENS.staff())).statusCode, 200);
  assert.equal(fx.resendCalls.length, 1);
  const again = await post(handler, { ...mail("ticket_assignment_changed", ["@assigned"]), requestId: "r2" }, TOKENS.staff());
  assert.equal(again.statusCode, 200);
  assert.equal(fx.resendCalls.length, 1, "aynı atama için e-posta tekrarlanmaz (EML-28)");
  assert.deepEqual(json(again).data.deduped, ["staff"]);
});

test("geçmişte son 10 dk içinde atama kaydı yoksa ya da başkası yazdıysa bildirim yok (istemci alıcı dayatamaz)", async () => {
  hist("-H5", "uid-staff", { action: "assignment_added", field_changed: "assignment", old_value: "", new_value: "Zeynep Arslan" }, Date.now() - 3600 * 1000);
  hist("-H6", "uid-cons", { action: "assignment_added", field_changed: "assignment", old_value: "", new_value: "Baran Kaya" });
  const res = await post(handler, mail("ticket_assignment_changed", ["yabanci@gmail.com", "@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200);
  assert.equal(fx.resendCalls.length, 0);
  assert.deepEqual(json(res).data.sent, []);
});

test("işlemi yapan kişinin kendi adresine bildirim gitmez", async () => {
  fx.db.v2.personnel.p3.email = "staff@example.com";
  fx.db.v2.ticket_assignments.T1.p3.personnel_email = "staff@example.com";
  hist("-H7", "uid-staff", { action: "assigned_to_changed", field_changed: "assigned_to_name", old_value: "", new_value: "Baran Kaya" });
  const res = await post(handler, mail("ticket_assignment_changed", ["@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200);
  assert.ok(!fx.resendCalls.some((c) => c.payload.to.includes("staff@example.com")));
  assert.ok(fx.resendCalls.some((c) => c.payload.tags[0].value === "consultant_assigned"), "müşteriye yine bildirilir");
});

test("yetki: müşteri bileşik olayları gönderemez (403); yabancı ad eşleşmeyen çıkarılan kişiye bildirim yapılmaz", async () => {
  hist("-H8", "uid-staff", { action: "assignment_removed", field_changed: "assignment", old_value: "Kayıtsız Kişi", new_value: "" });
  assert.equal((await post(handler, mail("ticket_assignment_changed", ["@assigned"]), TOKENS.customer())).statusCode, 403);
  assert.equal((await post(handler, mail("ticket_priority_critical", ["@assigned"]), TOKENS.customer())).statusCode, 403);
  const res = await post(handler, mail("ticket_assignment_changed", ["@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200);
  assert.equal(fx.resendCalls.length, 0);
});

test("ad çakışması (iki personel aynı ad): belirsiz olduğundan kimseye 'talep sizden alındı' gitmez", async () => {
  fx.db.v2.personnel.p5 = { personnel_id: "p5", first_name: "Eski", last_name: "Danışman", email: "eski1@parla.com", is_active: true };
  fx.db.v2.personnel.p6 = { personnel_id: "p6", first_name: "Eski", last_name: "Danışman", email: "eski2@parla.com", is_active: true };
  hist("-H9", "uid-staff", { action: "assignment_removed", field_changed: "assignment", old_value: "Eski Danışman", new_value: "" });
  const res = await post(handler, mail("ticket_assignment_changed", ["@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200);
  assert.equal(fx.resendCalls.length, 0);
});

// ------------------------------------------------------------------------------------------------ EML-28
test("EML-28: atama e-postası alan danışmana kısa süre içinde ayrıca 'durum güncellendi' gitmez; talep sahibi alır", async () => {
  hist("-H10", "uid-staff", { action: "assignment_added", field_changed: "assignment", old_value: "", new_value: "Zeynep Arslan" });
  await post(handler, mail("ticket_assignment_changed", ["@assigned"]), TOKENS.staff());
  fx.resendCalls.length = 0;
  fx.db.v2.tickets.T1.status = "assigned";
  hist("-H11", "uid-staff", { action: "status_note", field_changed: "status", old_value: "open", new_value: "assigned", note: "Atandı ve işleme alınıyor." });
  const res = await post(handler, { ...mail("ticket_status_changed", ["musteri@abc.com", "danisman@parla.com", "baran@parla.com"], "T1", { history_id: "-H11" }), requestId: "st1" }, TOKENS.staff());
  assert.equal(res.statusCode, 200, res.body);
  const recipients = fx.resendCalls.flatMap((c) => c.payload.to).sort();
  assert.deepEqual(recipients, ["baran@parla.com", "musteri@abc.com"], "danisman@parla.com (yeni atanan) ikinci e-postayı almaz");
});

test("EML-28: eski ticket_assigned türü de aynı işareti bırakır", async () => {
  const r1 = await post(handler, mail("ticket_assigned", ["danisman@parla.com"]), TOKENS.staff());
  assert.equal(r1.statusCode, 200, r1.body);
  fx.resendCalls.length = 0;
  const r2 = await post(handler, { ...mail("ticket_status_changed", ["danisman@parla.com"]), requestId: "st2" }, TOKENS.staff());
  assert.equal(r2.statusCode, 200);
  assert.equal(fx.resendCalls.length, 0);
});

// ------------------------------------------------------------------------------------------------ kritik öncelik
test("kritik önceliğe yükselme: atanmış danışmanlara (işlemi yapan hariç) yüksek öncelikli bildirim", async () => {
  fx.db.v2.tickets.T1.priority = "critical";
  hist("-P1", "uid-staff", { action: "priority_changed", field_changed: "priority", old_value: "high", new_value: "critical" });
  const res = await post(handler, mail("ticket_priority_critical", ["@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200, res.body);
  const sent = byType();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to.sort(), ["baran@parla.com", "danisman@parla.com"]);
  assert.match(sent[0].subject, /Kritik öncelik/);
  assert.match(sent[0].text, /1 saat/);
  // tekrar istek yeni e-posta üretmez
  await post(handler, { ...mail("ticket_priority_critical", ["@assigned"]), requestId: "p-again" }, TOKENS.staff());
  assert.equal(fx.resendCalls.length, 1);
});

test("kritik öncelik: atanmış kimse yoksa destek kutusuna; öncelik uyuşmuyorsa 409; geçmiş kaydı yoksa e-posta yok", async () => {
  fx.db.v2.tickets.T1.priority = "critical";
  fx.db.v2.ticket_assignments.T1 = {};
  fx.db.v2.tickets.T1.assigned_to_id = "";
  hist("-P2", "uid-staff", { action: "priority_changed", field_changed: "priority", old_value: "low", new_value: "critical" });
  const res = await post(handler, mail("ticket_priority_critical", ["@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(byType()[0].to, ["info@parlabilgiteknolojileri.net"]);

  fx.db.v2.tickets.T1.priority = "high";
  assert.equal((await post(handler, { ...mail("ticket_priority_critical", ["@assigned"]), requestId: "x" }, TOKENS.staff())).statusCode, 409);

  fx.reset();
  seedExtras();
  fx.db.v2.tickets.T1.priority = "critical";
  fx.resendCalls.length = 0;
  const none = await post(handler, mail("ticket_priority_critical", ["@assigned"]), TOKENS.staff());
  assert.equal(none.statusCode, 200);
  assert.equal(fx.resendCalls.length, 0);
});

// ------------------------------------------------------------------------------------------------ yeni talep → atayıcılar
test("yeni atanmamış talep: destek kutusuna giden bildirime Destek Atayıcılar da eklenir; atanmış talepte eklenmez", async () => {
  fx.db.v2.tickets.T1.assigned_to_id = "";
  fx.db.v2.ticket_assignments.T1 = {};
  const res = await post(handler, mail("ticket_created", ["@support"]), TOKENS.customer());
  assert.equal(res.statusCode, 200, res.body);
  // müşteri çağrısında atayıcıları okumak için Admin yok → destek kutusu (mevcut davranış korunur)
  assert.deepEqual(fx.resendCalls.flatMap((c) => c.payload.to), ["info@parlabilgiteknolojileri.net"]);

  // Admin yapılandırılmışsa müşteri tetiklemesinde de atayıcılar sunucuda çözülür
  fx.reset();
  seedExtras();
  fx.db.v2.tickets.T1.assigned_to_id = "";
  fx.db.v2.ticket_assignments.T1 = {};
  setAdminForTests(createFakeAdmin(JSON.parse(JSON.stringify(fx.db))));
  setStoreForTests(new MemoryStore());
  const withAdmin = await post(handler, { ...mail("ticket_created", ["@support"]), requestId: "c2" }, TOKENS.customer());
  assert.equal(withAdmin.statusCode, 200);
  assert.deepEqual(fx.resendCalls.flatMap((c) => c.payload.to).sort(), ["atayici@parla.com", "info@parlabilgiteknolojileri.net"]);
  assert.ok(!fx.resendCalls[0].payload.to.includes("staff@example.com"), "service_admin varken super_admin eklenmez");

  // Atanmış talep: atayıcılar eklenmez
  fx.reset();
  seedExtras();
  setStoreForTests(new MemoryStore());
  setAdminForTests(createFakeAdmin(JSON.parse(JSON.stringify(fx.db))));
  await post(handler, { ...mail("ticket_created", ["@support"]), requestId: "c3" }, TOKENS.customer());
  assert.deepEqual(fx.resendCalls.flatMap((c) => c.payload.to), ["info@parlabilgiteknolojileri.net"]);
});

test("@assigners sembolü: yalnızca personel çağırabilir", async () => {
  fx.db.v2.tickets.T1.assigned_to_id = "";
  const staff = await post(handler, mail("ticket_message", ["@assigners"]), TOKENS.staff());
  assert.equal(staff.statusCode, 200, staff.body);
  assert.deepEqual(fx.resendCalls.flatMap((c) => c.payload.to), ["atayici@parla.com"]);
  const cust = await post(handler, { ...mail("ticket_message", ["@assigners"]), requestId: "z" }, TOKENS.customer());
  assert.equal(cust.statusCode, 403);
});

// ------------------------------------------------------------------------------------------------ EML-16 / YON-04
test("EML-16: atama kaydı olmayan talepte müşteri yanıtı assigned_to_id yedeğiyle danışmana gider (Admin ile)", async () => {
  fx.db.v2.ticket_assignments.T1 = {};
  fx.db.v2.tickets.T1.assigned_to_id = "p1";
  fx.db.v2.tickets.T1.assigned_to_name = "Zeynep Arslan";
  // Admin yok + müşteri çağrısı: personel kaydı okunamaz → yalnız destek kutusu (eski sınır)
  const noAdmin = await post(handler, mail("ticket_message", ["@support", "@assigned"]), TOKENS.customer());
  assert.equal(noAdmin.statusCode, 200, noAdmin.body);
  assert.deepEqual(fx.resendCalls.flatMap((c) => c.payload.to), ["info@parlabilgiteknolojileri.net"]);

  fx.reset();
  seedExtras();
  fx.db.v2.ticket_assignments.T1 = {};
  fx.db.v2.tickets.T1.assigned_to_id = "p1";
  setStoreForTests(new MemoryStore());
  setAdminForTests(createFakeAdmin(JSON.parse(JSON.stringify(fx.db))));
  const withAdmin = await post(handler, { ...mail("ticket_message", ["@support", "@assigned"]), requestId: "e16" }, TOKENS.customer());
  assert.equal(withAdmin.statusCode, 200);
  assert.deepEqual(fx.resendCalls.flatMap((c) => c.payload.to).sort(), ["danisman@parla.com", "info@parlabilgiteknolojileri.net"]);
});

test("EML-16: personel çağrısında (Admin olmadan) da assigned_to_id yedeği çalışır", async () => {
  fx.db.v2.ticket_assignments.T1 = {};
  fx.db.v2.tickets.T1.assigned_to_id = "p1";
  const res = await post(handler, mail("ticket_message", ["@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(fx.resendCalls.flatMap((c) => c.payload.to), ["danisman@parla.com"]);
});

test("YON-04: atama kaydındaki eskimiş adres güncel personel adresine eşlenir (Admin ile müşteri yanıtı)", async () => {
  fx.db.v2.ticket_assignments.T1 = { p1: { personnel_id: "p1", personnel_email: "eski-adres@parla.com", is_primary: true } };
  setAdminForTests(createFakeAdmin(JSON.parse(JSON.stringify(fx.db))));
  const res = await post(handler, mail("ticket_message", ["eski-adres@parla.com"]), TOKENS.customer());
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(fx.resendCalls.flatMap((c) => c.payload.to), ["danisman@parla.com"], "e-posta güncel adrese gider, eskiye değil");
});

test("Admin arızalıysa çağıranın token'ına düşülür (e-posta hattı Admin'e bağımlı değildir)", async () => {
  const broken = createFakeAdmin(JSON.parse(JSON.stringify(fx.db)));
  broken.failures.push({ op: "db.get" });
  setAdminForTests(broken);
  const res = await post(handler, mail("ticket_message", ["@assigned"]), TOKENS.staff());
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(fx.resendCalls.flatMap((c) => c.payload.to).sort(), ["baran@parla.com", "danisman@parla.com"]);
});

test("müşteri tarafı sahte bileşik olay: iç türler (ticket_unassigned/consultant_assigned) istemciden gönderilemez", async () => {
  for (const type of ["ticket_unassigned", "consultant_assigned", "sla_warning", "ticket_auto_closed", "password_reset_admin"]) {
    const res = await post(handler, mail(type, ["@owner"]), TOKENS.staff());
    assert.equal(res.statusCode, 400, type);
    assert.equal(json(res).code, "bad_type", type);
  }
  assert.equal(fx.resendCalls.length, 0);
});
