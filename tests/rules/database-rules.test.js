/**
 * database.rules.json testleri (targaryen ile yerel simülasyon).
 * Çalıştırma:  cd tests/rules && npm install && npm test
 * Başka bir kural dosyasını denemek için: RULES_FILE=/yol/rules.json npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const targaryen = require("targaryen");

const rulesPath = process.env.RULES_FILE || path.join(__dirname, "..", "..", "database.rules.json");
const rules = require(rulesPath);

const U = {
  root: { uid: "root" },
  svc: { uid: "svc" },
  pm: { uid: "pm" },
  cons: { uid: "cons" },
  custA: { uid: "custA" },
  custA2: { uid: "custA2" },
  cadmin: { uid: "cadmin" }, // A firmasının firma yöneticisi
  cadminB: { uid: "cadminB" },
  custB: { uid: "custB" },
  arizi: { uid: "arizi" },
  intruder: { uid: "intruder" }, // Auth hesabı var ama profili yok (açık kayıt ile oluşturulmuş)
};

const data = {
  v2: {
    users: {
      root: { role: "super_admin", is_active: true, email: "root@parla.com" },
      svc: { role: "service_admin", is_active: true },
      pm: { role: "project_manager", is_active: true },
      cons: { role: "consultant", is_active: true },
      custA: { role: "customer", company_id: "cA", is_active: true, last_login_at: "2026-01-01T00:00:00Z" },
      custA2: { role: "customer", company_id: "cA", is_active: true },
      custB: { role: "customer", company_id: "cB", is_active: true },
      cadmin: { role: "company_admin", company_id: "cA", is_active: true },
      cadminB: { role: "company_admin", company_id: "cB", is_active: true },
      arizi: { role: "arizi_customer", company_id: "", is_active: true },
    },
    tickets: {
      t1: { ticket_id: "t1", user_id: "custA", company_id: "cA", status: "waiting_customer", priority: "high", assigned_to_id: "p1", updated_at: "x" },
      t2: { ticket_id: "t2", user_id: "custB", company_id: "cB", status: "open", priority: "low", assigned_to_id: "p2" },
      t3: { ticket_id: "t3", user_id: "arizi", company_id: "", status: "open", priority: "low", assigned_to_id: "" },
    },
    ticket_messages: {
      t1: {
        m1: { message_id: "m1", user_id: "custA", message: "Merhaba", created_at: "x", is_internal: false },
        m2: { message_id: "m2", user_id: "cons", message: "İç not", created_at: "x", is_internal: true },
      },
    },
    ticket_internal_notes: { t1: { n0: { message_id: "n0", user_id: "cons", message: "mevcut iç not", created_at: "x" } } },
    ticket_history: { t1: { h1: { history_id: "h1", action: "created", changed_at: "x" } } },
    ticket_assignments: { t1: { p1: { personnel_id: "p1", personnel_name: "P1", personnel_email: "p1@parla.com", is_primary: true } } },
    ticket_efforts: { t1: { e1: { effort_id: "e1", hours: 1, created_at: "x" } } },
    companies: { cA: { name: "A", customer_code: "AAA" }, cB: { name: "B", customer_code: "BBB" } },
    personnel: { p1: { email: "p1@parla.com", is_active: true } },
    contracts: { k1: { company_id: "cA", value: 100000, status: "active" } },
    projects: { pr1: { company_id: "cA", status: "active" } },
    activities: { a1: { activity_id: "a1", action: "ticket_created", user_uid: "custA", created_at: "x" } },
    counters: { SUP: { AAA: { "2610": 4 } } },
    notifications: { custA: { n1: { notif_id: "n1", title: "x" } } },
    departments: { d1: { name: "D" } },
  },
};

const db = targaryen.database(rules, data);
const as = (u) => db.as(u);
const q = (orderByChild, equalTo) => ({ query: { orderByChild, equalTo } });

function assertAllowed(result, msg) {
  assert.equal(result.allowed, true, `${msg || "izin verilmeliydi"}\n${result.info}`);
}
function assertDenied(result, msg) {
  assert.equal(result.allowed, false, `${msg || "reddedilmeliydi"} (izin verildi)`);
}

// ---------------------------------------------------------------- users
test("[kritik] profili olmayan hesap kendine super_admin profili yazamaz", () => {
  assertDenied(as(U.intruder).write("/v2/users/intruder", { role: "super_admin", is_active: true, email: "x@x.com" }));
  assertDenied(as(U.intruder).update("/v2/users/intruder", { role: "super_admin" }));
});

test("[kritik] müşteri kendi rolünü / firmasını / aktifliğini değiştiremez", () => {
  assertDenied(as(U.custA).write("/v2/users/custA/role", "super_admin"));
  assertDenied(as(U.custA).update("/v2/users/custA", { role: "service_admin" }));
  assertDenied(as(U.custA).write("/v2/users/custA/company_id", "cB"));
  assertDenied(as(U.custA).write("/v2/users/custA/is_active", true));
  assertDenied(as(U.custA).write("/v2/users/custA", { role: "super_admin" }));
});

test("müşteri girişte last_login_at / updated_at yazabilir", () => {
  assertAllowed(as(U.custA).update("/v2/users/custA", { last_login_at: "2026-10-06T10:00:00Z", updated_at: "2026-10-06T10:00:00Z" }));
});

test("müşteri başkasının profilini okuyamaz/yazamaz, kendisini okuyabilir", () => {
  assertAllowed(as(U.custA).read("/v2/users/custA"));
  assertDenied(as(U.custA).read("/v2/users/root"));
  assertDenied(as(U.custA).write("/v2/users/custB/last_login_at", "x"));
  assertDenied(as(U.custA).read("/v2/users"));
});

test("must_change_password yalnızca false'a çekilebilir (kullanıcı tarafından)", () => {
  assertDenied(as(U.custA).write("/v2/users/custA/must_change_password", true));
  assertAllowed(as(U.custA).write("/v2/users/custA/must_change_password", false));
});

test("super_admin kullanıcı oluşturabilir; service_admin super_admin atayamaz", () => {
  assertAllowed(as(U.root).write("/v2/users/new1", { role: "customer", company_id: "cA", is_active: true }));
  assertAllowed(as(U.root).write("/v2/users/new2", { role: "super_admin", is_active: true }));
  assertAllowed(as(U.svc).write("/v2/users/new3", { role: "customer", company_id: "cA", is_active: true }));
  assertDenied(as(U.svc).write("/v2/users/new4", { role: "super_admin", is_active: true }), "service_admin super_admin üretemez");
  assertDenied(as(U.svc).update("/v2/users/custA", { role: "super_admin" }));
});

test("geçersiz rol değeri yazılamaz", () => {
  assertDenied(as(U.root).write("/v2/users/new5", { role: "hacker", is_active: true }));
});

// -------------------------------------------------------------- tickets
test("[kritik] müşteri assigned_to_id sorgusuyla başka firmaların ticket'larını okuyamaz", () => {
  assertDenied(as(U.custA).read("/v2/tickets", q("assigned_to_id", "p2")));
  assertDenied(as(U.intruder).read("/v2/tickets", q("assigned_to_id", "p2")));
});

test("müşteri yalnızca kendi user_id sorgusunu okur; firma sorgusu yalnızca firma yöneticisine açık", () => {
  assertAllowed(as(U.custA).read("/v2/tickets", q("user_id", "custA")));
  assertDenied(as(U.custA).read("/v2/tickets", q("user_id", "custB")));
  assertDenied(as(U.custA).read("/v2/tickets", q("company_id", "cA")), "customer rolü firma listesini göremez");
  assertDenied(as(U.custA).read("/v2/tickets", q("company_id", "cB")));
  assertDenied(as(U.custA).read("/v2/tickets"));
});

test("firma yöneticisi kendi firmasının ticket'larını listeler, başka firmayı listeleyemez", () => {
  assertAllowed(as(U.cadmin).read("/v2/tickets", q("company_id", "cA")));
  assertDenied(as(U.cadmin).read("/v2/tickets", q("company_id", "cB")));
  assertDenied(as(U.cadmin).read("/v2/tickets"));
  assertDenied(as(U.cadmin).read("/v2/tickets", q("assigned_to_id", "p1")));
  assertAllowed(as(U.cadmin).read("/v2/tickets", q("user_id", "cadmin")));
});

test("firma yöneticisi firma ticket'ını, mesajlarını, geçmişini ve atamalarını okur/yanıtlar; başka firmanınkini okuyamaz", () => {
  assertAllowed(as(U.cadmin).read("/v2/tickets/t1"));
  assertDenied(as(U.cadmin).read("/v2/tickets/t2"));
  assertAllowed(as(U.cadmin).read("/v2/ticket_messages/t1"));
  assertAllowed(as(U.cadmin).read("/v2/ticket_history/t1"));
  assertAllowed(as(U.cadmin).read("/v2/ticket_assignments/t1"));
  assertDenied(as(U.cadminB).read("/v2/ticket_messages/t1"));
  assertDenied(as(U.cadmin).read("/v2/ticket_internal_notes/t1"), "iç notlar firma yöneticisine de kapalı");
  const msg = { message_id: "mc", user_id: "cadmin", message: "firma yanıtı", created_at: "now" };
  assertAllowed(as(U.cadmin).write("/v2/ticket_messages/t1/mc", msg));
  assertDenied(as(U.cadmin).write("/v2/ticket_messages/t2/mc", msg));
  assertDenied(as(U.custA2).read("/v2/ticket_messages/t1"), "aynı firmadaki sıradan müşteri görmez");
});

test("firması olmayan (arızi) müşteri company_id='' sorgusuyla diğer arızi kayıtları okuyamaz", () => {
  assertDenied(as(U.arizi).read("/v2/tickets", q("company_id", "")));
  assertAllowed(as(U.arizi).read("/v2/tickets", q("user_id", "arizi")));
});

test("personel rolleri tüm ticket'ları okur", () => {
  for (const u of [U.root, U.svc, U.pm, U.cons]) {
    assertAllowed(as(u).read("/v2/tickets"));
    assertAllowed(as(u).read("/v2/tickets/t2"));
  }
});

test("müşteri yalnızca kendi ticket'ını doğrudan okur", () => {
  assertAllowed(as(U.custA).read("/v2/tickets/t1"));
  assertDenied(as(U.custA).read("/v2/tickets/t2"));
  assertDenied(as(U.custA2).read("/v2/tickets/t1"));
});

test("müşteri kendi adına, 'open' durumda, kendi firmasıyla ticket oluşturabilir", () => {
  const base = { ticket_id: "n1", user_id: "custA", company_id: "cA", status: "open", assigned_to_id: "", priority: "medium" };
  assertAllowed(as(U.custA).write("/v2/tickets/n1", base));
  assertDenied(as(U.custA).write("/v2/tickets/n1", { ...base, user_id: "custB" }), "başkası adına");
  assertDenied(as(U.custA).write("/v2/tickets/n1", { ...base, company_id: "cB" }), "başka firma adına");
  assertDenied(as(U.custA).write("/v2/tickets/n1", { ...base, status: "closed" }), "kapalı olarak oluşturma");
});

test("firması olmayan müşteri company_id='' ile ticket oluşturabilir", () => {
  assertAllowed(as(U.arizi).write("/v2/tickets/n2", { user_id: "arizi", company_id: "", status: "open", assigned_to_id: "" }));
});

test("[kritik] müşteri kendi ticket'ının önceliğini/atamasını/durumunu keyfi değiştiremez", () => {
  assertDenied(as(U.custA).write("/v2/tickets/t1/priority", "low"));
  assertDenied(as(U.custA).write("/v2/tickets/t1/assigned_to_id", "p9"));
  assertDenied(as(U.custA).write("/v2/tickets/t1/status", "closed"));
  assertDenied(as(U.custA).write("/v2/tickets/t1/company_id", "cB"));
  assertDenied(as(U.custA).write("/v2/tickets/t1", { user_id: "custA", status: "closed" }));
});

test("müşteri 'müşteri bekleniyor' ticket'ı yanıtlayınca işlemde durumuna çekebilir", () => {
  assertAllowed(
    as(U.custA).update("/v2/tickets/t1", { status: "in_progress", updated_at: "now", updated_by: "custA" })
  );
  assertDenied(as(U.custA).update("/v2/tickets/t2", { status: "in_progress", updated_at: "now" }));
});

test("müşteri mesaj eklerken ticket updated_at'ini güncelleyebilir (yalnızca kendi ticket'ı)", () => {
  assertAllowed(as(U.custA).update("/v2/tickets/t1", { updated_at: "now" }));
  assertDenied(as(U.custA).update("/v2/tickets/t2", { updated_at: "now" }));
});

test("personel ticket güncelleyebilir; silme yalnızca admin", () => {
  assertAllowed(as(U.cons).update("/v2/tickets/t2", { status: "in_progress", assigned_to_id: "p1" }));
  assertAllowed(as(U.pm).update("/v2/tickets/t2", { priority: "high" }));
  assertDenied(as(U.cons).write("/v2/tickets/t2", null));
  assertAllowed(as(U.root).write("/v2/tickets/t2", null));
  assertAllowed(as(U.svc).write("/v2/tickets/t2", null));
});

// ------------------------------------------------ yaşam döngüsü (onay/yeniden açma)
function withStatus(status, extra) {
  const d = JSON.parse(JSON.stringify(data));
  d.v2.tickets.t1.status = status;
  Object.assign(d.v2.tickets.t1, extra || {});
  return targaryen.database(rules, d);
}

test("müşteri 'kapanış onayı bekliyor' talebi onaylayıp kapatabilir (closed_at ile)", () => {
  const d = withStatus("pending_close");
  assertAllowed(d.as(U.custA).update("/v2/tickets/t1", { status: "closed", closed_at: "now", updated_at: "now", updated_by: "custA", public_updated_at: "now", public_updated_by: "custA" }));
  assertDenied(d.as(U.custB).update("/v2/tickets/t1", { status: "closed", closed_at: "now" }), "başka müşteri kapatamaz");
  assertDenied(d.as(U.custA).update("/v2/tickets/t1", { status: "resolved" }), "müşteri çözüldü işaretleyemez");
});

test("müşteri çözülmüş/kapanmış/onay bekleyen talebi gerekçeyle yeniden açabilir", () => {
  for (const status of ["pending_close", "resolved", "closed"]) {
    const d = withStatus(status);
    assertAllowed(d.as(U.custA).update("/v2/tickets/t1", { status: "reopened", reopened_at: "now", updated_at: "now", updated_by: "custA" }), status + " -> reopened");
  }
  assertAllowed(withStatus("closed", { closed_at: "2026-01-01" }).as(U.custA).update("/v2/tickets/t1", { status: "reopened", reopened_at: "now", closed_at: null }));
  assertDenied(withStatus("in_progress").as(U.custA).update("/v2/tickets/t1", { status: "reopened", reopened_at: "now" }), "açık talep yeniden açılmaz");
  assertDenied(withStatus("open").as(U.custA).update("/v2/tickets/t1", { status: "closed", closed_at: "now" }), "açık talep müşteri tarafından kapatılamaz");
});

test("firma yöneticisi firma ticket'ını onaylayıp yeniden açabilir; sıradan müşteri başkasının ticket'ını yönetemez", () => {
  const d = withStatus("pending_close");
  assertAllowed(d.as(U.cadmin).update("/v2/tickets/t1", { status: "closed", closed_at: "now", updated_at: "now" }));
  assertDenied(d.as(U.cadminB).update("/v2/tickets/t1", { status: "closed", closed_at: "now" }));
  assertDenied(d.as(U.custA2).update("/v2/tickets/t1", { status: "closed", closed_at: "now" }));
});

test("müşteri yaşam döngüsü alanları dışında hiçbir alanı değiştiremez (durum geçişi sırasında bile)", () => {
  const d = withStatus("pending_close");
  assertDenied(d.as(U.custA).update("/v2/tickets/t1", { status: "closed", closed_at: "now", priority: "low" }));
  assertDenied(d.as(U.custA).update("/v2/tickets/t1", { status: "reopened", reopened_at: "now", assigned_to_id: "x" }));
  assertDenied(d.as(U.custA).write("/v2/tickets/t1/first_response_at", "now"));
  assertDenied(d.as(U.custA).write("/v2/tickets/t1/sla_note", "x"));
});

test("personel her durum geçişini yapabilir (pending_close, reopened dahil)", () => {
  for (const status of ["pending_close", "waiting_customer", "reopened", "resolved", "closed", "in_progress"]) {
    assertAllowed(as(U.cons).update("/v2/tickets/t1", { status, updated_at: "now" }), status);
  }
});

// ------------------------------------------------------ ticket_messages
test("[kritik] başka firmanın / yabancı hesabın ticket mesajlarını okuyamaz", () => {
  assertDenied(as(U.custB).read("/v2/ticket_messages/t1"));
  assertDenied(as(U.intruder).read("/v2/ticket_messages/t1"));
  assertDenied(as(U.custA2).read("/v2/ticket_messages/t1"));
});

test("ticket sahibi ve personel mesajları okur", () => {
  assertAllowed(as(U.custA).read("/v2/ticket_messages/t1"));
  assertAllowed(as(U.cons).read("/v2/ticket_messages/t1"));
  assertAllowed(as(U.root).read("/v2/ticket_messages/t1"));
});

test("mesajlar yalnızca eklenebilir: silinemez, düzenlenemez, konu tamamen silinemez", () => {
  assertDenied(as(U.custA).write("/v2/ticket_messages/t1", null), "konu silme");
  assertDenied(as(U.custB).write("/v2/ticket_messages/t1", null));
  assertDenied(as(U.custA).write("/v2/ticket_messages/t1/m1", null), "mesaj silme");
  assertDenied(as(U.custA).write("/v2/ticket_messages/t1/m1/message", "değiştirildi"), "mesaj düzenleme");
  assertDenied(as(U.cons).write("/v2/ticket_messages/t1/m2", null), "personel de silemez");
  assertAllowed(as(U.root).write("/v2/ticket_messages/t1/m2", null), "super_admin moderasyon");
});

test("müşteri kendi ticket'ına kendi adına mesaj ekleyebilir; başkasına ekleyemez", () => {
  const msg = { message_id: "m9", user_id: "custA", message: "yeni", created_at: "now", is_internal: false };
  assertAllowed(as(U.custA).write("/v2/ticket_messages/t1/m9", msg));
  assertDenied(as(U.custA).write("/v2/ticket_messages/t2/m9", { ...msg }), "başkasının ticket'ı");
  assertDenied(as(U.custA).write("/v2/ticket_messages/t1/m9", { ...msg, user_id: "cons" }), "başkası adına");
  assertDenied(as(U.intruder).write("/v2/ticket_messages/t1/m9", { ...msg, user_id: "intruder" }));
});

test("personel herhangi bir ticket'a mesaj ve iç not ekleyebilir", () => {
  const msg = { message_id: "m8", user_id: "cons", message: "not", created_at: "now", is_internal: false };
  assertAllowed(as(U.cons).write("/v2/ticket_messages/t1/m8", msg));
  assertAllowed(as(U.cons).write("/v2/ticket_messages/t2/m8", msg));
  assertAllowed(as(U.cons).write("/v2/ticket_internal_notes/t2/n8", { ...msg, message_id: "n8" }));
});

// ------------------------------------------------- ticket_internal_notes
test("[kritik] iç notlar yalnızca personel tarafından okunur/yazılır; müşteri okuyamaz", () => {
  const note = { message_id: "n1", user_id: "cons", message: "iç not", created_at: "now" };
  assertAllowed(as(U.cons).write("/v2/ticket_internal_notes/t1/n1", note));
  assertAllowed(as(U.pm).read("/v2/ticket_internal_notes/t1"));
  assertDenied(as(U.custA).read("/v2/ticket_internal_notes/t1"), "ticket sahibi müşteri iç notu okuyamaz");
  assertDenied(as(U.custA).write("/v2/ticket_internal_notes/t1/n2", { ...note, user_id: "custA" }));
  assertDenied(as(U.intruder).read("/v2/ticket_internal_notes/t1"));
});

test("iç notlar silinemez/düzenlenemez (super_admin hariç)", () => {
  assertDenied(as(U.cons).write("/v2/ticket_internal_notes/t1/n0", null));
  assertDenied(as(U.cons).write("/v2/ticket_internal_notes/t1", null));
  assertAllowed(as(U.root).write("/v2/ticket_internal_notes/t1/n0", null));
});

test("herkese açık mesaj düğümüne yeni iç not yazılamaz (eski istemciler sızıntı yapamaz)", () => {
  const msg = { message_id: "m7", user_id: "cons", message: "gizli", created_at: "now", is_internal: true };
  assertDenied(as(U.cons).write("/v2/ticket_messages/t1/m7", msg));
  assertAllowed(as(U.cons).write("/v2/ticket_messages/t1/m7", { ...msg, is_internal: false }));
});

// ------------------------------------------------------- ticket_attachments
const att = (uid, over) => ({ att_id: "a1", name: "ekran.png", type: "image/png", size: 1000, data: "AAAA", uploader_uid: uid, created_at: "now", ...(over || {}) });

test("ek: ticket sahibi ve personel yükler; başkası yükleyemez/okuyamaz; liste okunamaz", () => {
  assertAllowed(as(U.custA).write("/v2/ticket_attachments/t1/a1", att("custA")));
  assertAllowed(as(U.cons).write("/v2/ticket_attachments/t1/a2", att("cons", { att_id: "a2" })));
  assertAllowed(as(U.cadmin).write("/v2/ticket_attachments/t1/a3", att("cadmin", { att_id: "a3" })));
  assertDenied(as(U.custB).write("/v2/ticket_attachments/t1/a4", att("custB")), "başka firma");
  assertDenied(as(U.intruder).write("/v2/ticket_attachments/t1/a4", att("intruder")));
  assertDenied(as(U.custA).write("/v2/ticket_attachments/t2/a4", att("custA")), "başkasının ticket'ı");
  assertDenied(as(U.custA).read("/v2/ticket_attachments/t1"), "toplu okuma yok");
  assertDenied(as(U.cons).read("/v2/ticket_attachments/t1"), "personel de toplu okuyamaz (ek verisi büyük)");
});

test("ek: yalnızca kimliği bilinen ek, ticket tarafları ve personelce okunur", () => {
  const d = targaryen.database(rules, JSON.parse(JSON.stringify({ ...data, v2: { ...data.v2, ticket_attachments: { t1: { a1: att("custA") } } } })));
  assertAllowed(d.as(U.custA).read("/v2/ticket_attachments/t1/a1"));
  assertAllowed(d.as(U.cadmin).read("/v2/ticket_attachments/t1/a1"));
  assertAllowed(d.as(U.cons).read("/v2/ticket_attachments/t1/a1"));
  assertDenied(d.as(U.custB).read("/v2/ticket_attachments/t1/a1"));
  assertDenied(d.as(U.custA2).read("/v2/ticket_attachments/t1/a1"));
  assertDenied(d.as(U.custA).write("/v2/ticket_attachments/t1/a1", null), "silinemez");
  assertDenied(d.as(U.custA).write("/v2/ticket_attachments/t1/a1/data", "BBBB"), "değiştirilemez");
  assertAllowed(d.as(U.root).write("/v2/ticket_attachments/t1/a1", null), "super_admin moderasyon");
});

test("ek doğrulama: başkası adına, büyük, izin verilmeyen tür reddedilir", () => {
  assertDenied(as(U.custA).write("/v2/ticket_attachments/t1/a5", att("cons")), "uploader_uid başkası");
  assertDenied(as(U.custA).write("/v2/ticket_attachments/t1/a5", att("custA", { data: "A".repeat(3000001) })), "çok büyük veri");
  assertDenied(as(U.custA).write("/v2/ticket_attachments/t1/a5", att("custA", { size: 3000000 })), "çok büyük boyut");
  assertDenied(as(U.custA).write("/v2/ticket_attachments/t1/a5", att("custA", { type: "application/x-msdownload", name: "virus.exe" })), "exe");
  assertDenied(as(U.custA).write("/v2/ticket_attachments/t1/a5", att("custA", { type: "text/html", name: "x.html" })), "html");
  assertAllowed(as(U.custA).write("/v2/ticket_attachments/t1/a5", att("custA", { type: "application/pdf", name: "rapor.pdf" })));
  assertAllowed(as(U.custA).write("/v2/ticket_attachments/t1/a6", att("custA", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "tablo.xlsx" })));
});

test("[kritik] iç not ekleri yalnızca personelce okunur/yazılır", () => {
  assertAllowed(as(U.cons).write("/v2/ticket_internal_attachments/t1/i1", att("cons", { att_id: "i1" })));
  assertDenied(as(U.custA).write("/v2/ticket_internal_attachments/t1/i2", att("custA", { att_id: "i2" })));
  const d = targaryen.database(rules, JSON.parse(JSON.stringify({ ...data, v2: { ...data.v2, ticket_internal_attachments: { t1: { i1: att("cons") } } } })));
  assertAllowed(d.as(U.cons).read("/v2/ticket_internal_attachments/t1/i1"));
  assertDenied(d.as(U.custA).read("/v2/ticket_internal_attachments/t1/i1"));
  assertDenied(d.as(U.cadmin).read("/v2/ticket_internal_attachments/t1/i1"));
});

// ------------------------------------------------------- ticket_history
test("[kritik] geçmiş kayıtları yalnızca muhataplarca okunur ve yalnızca eklenir", () => {
  assertDenied(as(U.custB).read("/v2/ticket_history/t1"));
  assertAllowed(as(U.custA).read("/v2/ticket_history/t1"));
  assertDenied(as(U.custA).write("/v2/ticket_history/t1", null), "geçmişi silme");
  assertDenied(as(U.custA).write("/v2/ticket_history/t1/h1", null));
  assertDenied(as(U.custB).write("/v2/ticket_history/t1/h2", { action: "x" }), "başkasının ticket'ına geçmiş yazma");
  assertAllowed(as(U.custA).write("/v2/ticket_history/t1/h2", { action: "created", changed_at: "now" }));
  assertAllowed(as(U.cons).write("/v2/ticket_history/t2/h2", { action: "status_changed", changed_at: "now" }));
});

// -------------------------------------------- assignments / efforts / vb.
test("atamalar: müşteri yalnızca kendi ticket'ınınkini okur, yazamaz", () => {
  assertAllowed(as(U.custA).read("/v2/ticket_assignments/t1"));
  assertDenied(as(U.custB).read("/v2/ticket_assignments/t1"));
  assertDenied(as(U.custA).write("/v2/ticket_assignments/t1/p9", { personnel_id: "p9" }));
  assertAllowed(as(U.cons).write("/v2/ticket_assignments/t1/p9", { personnel_id: "p9", personnel_email: "p9@parla.com" }));
  assertAllowed(as(U.pm).read("/v2/ticket_assignments"));
});

test("eforlar yalnızca personelce okunur/yazılır", () => {
  assertDenied(as(U.custA).read("/v2/ticket_efforts/t1"));
  assertAllowed(as(U.cons).read("/v2/ticket_efforts/t1"));
  assertAllowed(as(U.cons).write("/v2/ticket_efforts/t1/e2", { hours: 1 }));
  assertDenied(as(U.custA).write("/v2/ticket_efforts/t1/e2", { hours: 1 }));
});

test("[kritik] sözleşme/proje/personel/firma listesi müşteri ve yabancı hesaplara kapalı", () => {
  for (const u of [U.custA, U.intruder, U.arizi]) {
    assertDenied(as(u).read("/v2/contracts"));
    assertDenied(as(u).read("/v2/contracts/k1"));
    assertDenied(as(u).read("/v2/projects"));
    assertDenied(as(u).read("/v2/personnel"));
    assertDenied(as(u).read("/v2/companies"));
  }
  for (const u of [U.root, U.svc, U.pm, U.cons]) {
    assertAllowed(as(u).read("/v2/contracts"));
    assertAllowed(as(u).read("/v2/projects"));
    assertAllowed(as(u).read("/v2/personnel"));
    assertAllowed(as(u).read("/v2/companies"));
  }
});

test("müşteri yalnızca kendi firmasının kaydını okur", () => {
  assertAllowed(as(U.custA).read("/v2/companies/cA"));
  assertDenied(as(U.custA).read("/v2/companies/cB"));
  assertDenied(as(U.intruder).read("/v2/companies/cA"));
});

test("yazma yetkileri korunur: firma/sözleşme/personel admin, proje PM'e de açık", () => {
  assertAllowed(as(U.svc).write("/v2/companies/cC", { name: "C" }));
  assertDenied(as(U.cons).write("/v2/companies/cC", { name: "C" }));
  assertAllowed(as(U.svc).write("/v2/contracts/k2", { status: "active" }));
  assertDenied(as(U.pm).write("/v2/contracts/k2", { status: "active" }));
  assertAllowed(as(U.pm).write("/v2/projects/pr2", { status: "planning" }));
  assertDenied(as(U.cons).write("/v2/projects/pr2", { status: "planning" }));
  assertAllowed(as(U.svc).write("/v2/personnel/p2", { email: "p2@parla.com" }));
  assertDenied(as(U.custA).write("/v2/personnel/p2", { email: "p2@parla.com" }));
  assertAllowed(as(U.root).write("/v2/departments/d2", { name: "D2" }));
  assertDenied(as(U.svc).write("/v2/departments/d2", { name: "D2" }));
});

// ------------------------------------------- activities/counters/notifs
test("[kritik] aktivite kayıtları silinemez/ezilemez; yalnızca eklenir", () => {
  assertDenied(as(U.custA).write("/v2/activities", null), "tüm aktiviteleri silme");
  assertDenied(as(U.intruder).write("/v2/activities", null));
  assertDenied(as(U.custA).write("/v2/activities/a1", null));
  assertDenied(as(U.custA).write("/v2/activities/a1/action", "x"));
  assertAllowed(as(U.custA).write("/v2/activities/a2", { activity_id: "a2", action: "ticket_message", user_uid: "custA", created_at: "now" }));
  assertDenied(as(U.intruder).write("/v2/activities/a9", { activity_id: "a9", action: "spam", user_uid: "intruder" }), "profilsiz hesap");
  assertAllowed(as(U.cons).write("/v2/activities/a3", { activity_id: "a3", action: "ticket_updated", user_uid: "cons", created_at: "now" }));
});

test("aktiviteleri yalnızca personel okur", () => {
  assertDenied(as(U.custA).read("/v2/activities"));
  assertAllowed(as(U.cons).read("/v2/activities"));
});

test("sayaç: giriş yapmış kullanıcı artırabilir (ticket numarası), sayı dışı değer yazılamaz", () => {
  assertAllowed(as(U.custA).write("/v2/counters/SUP/AAA/2610", 5));
  assertAllowed(as(U.custA).write("/v2/counters/SUP/NEW/2610", 1));
  assertDenied(as(U.custA).write("/v2/counters/SUP/AAA/2610", "abc"));
  assertDenied(as(U.custA).write("/v2/counters", null), "sayaçları toptan silme");
  assertDenied(as(U.intruder).write("/v2/counters/SUP/AAA/2610", 6)) ;
});

test("bildirimler: başkasına yazılamaz/okunamaz", () => {
  assertDenied(as(U.custB).read("/v2/notifications/custA"));
  assertDenied(as(U.custB).write("/v2/notifications/custA/n2", { title: "spam" }));
  assertAllowed(as(U.custA).read("/v2/notifications/custA"));
  assertAllowed(as(U.cons).write("/v2/notifications/custA/n2", { title: "atandı" }));
});

test("kök seviyede hiçbir şey okunamaz/yazılamaz", () => {
  assertDenied(as(U.root).read("/"));
  assertDenied(as(U.root).write("/x", 1));
  assertDenied(as(null).read("/v2/tickets/t1"));
});

test("database.rules.json, generate-rules.js çıktısıyla birebir aynı (JSON'u elle düzenlemeyin)", () => {
  const { output } = require("./generate-rules.js");
  const onDisk = require("node:fs").readFileSync(path.join(__dirname, "..", "..", "database.rules.json"), "utf8");
  assert.equal(onDisk, output, "node tests/rules/generate-rules.js çalıştırıp çıktıyı commit edin");
});
