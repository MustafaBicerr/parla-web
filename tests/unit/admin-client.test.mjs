/**
 * WP-09 / WP-10 / WP-16 istemci testleri (bellek içi DB): denormalize kopya yayma, sözleşme bedeli + has_contract türetimi,
 * proje kodu, toplu talep güncelleme (çok yollu, atomik parçalar), hazır yanıt şablonu CRUD, iç not taşıma, açık talep sorgusu.
 * Çalıştırma: node --test tests/unit/admin-client.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMemDb, installFirebase } from "../../netlify/tests/helpers/memdb.mjs";

globalThis.window = {};
const { default: ParlaDb } = await import("../../assets/js/support-v2/firebase-client.js");

const NOW = Date.now();
const iso = (offsetMs) => new Date(NOW - offsetMs).toISOString();
const H = 3600 * 1000;
const day = (offsetDays) => new Date(NOW + offsetDays * 86400000).toISOString().slice(0, 10);

const ticket = (id, o) => ({
  ticket_id: id,
  ticket_number: `SUP-ORN-FI-2610-${id.replace(/\D/g, "").padStart(4, "0")}`,
  ticket_type: "SUP",
  priority: "medium",
  status: "open",
  title: "x",
  user_id: "uc",
  user_name: "Eski Müşteri Adı",
  company_id: "cA",
  company_name: "Eski Ad",
  customer_code: "ORN",
  created_at: iso(5 * H),
  updated_at: iso(5 * H),
  assigned_to_id: "",
  assigned_to_name: "",
  ...o,
});

function seed(extra) {
  const mem = createMemDb({
    v2: {
      users: {
        uc: { uid: "uc", role: "customer", company_id: "cA", company_name: "Eski Ad", customer_code: "ORN", first_name: "Eski", last_name: "Ad" },
        uc2: { uid: "uc2", role: "customer", company_id: "cA", company_name: "Eski Ad", customer_code: "ORN" },
        ub: { uid: "ub", role: "customer", company_id: "cB", company_name: "Başka", customer_code: "BSK" },
      },
      companies: {
        cA: { company_id: "cA", name: "Yeni Ad", customer_code: "NEW0001", is_active: true },
        cB: { company_id: "cB", name: "Başka", customer_code: "BSK0001", is_active: true },
      },
      contracts: { k1: { contract_id: "k1", company_id: "cA", company_name: "Eski Ad", contract_number: "S1", status: "active", start_date: day(-10), end_date: day(100), value: 999 } },
      projects: { p1: { project_id: "p1", project_code: "PRJ0001", company_id: "cA", company_name: "Eski Ad", customer_code: "ORN", manager_personnel_id: "pe1", manager_name: "Eski Kişi", assigned_personnel: { pe1: { id: "pe1", name: "Eski Kişi" } } } },
      personnel: {
        pe1: { personnel_id: "pe1", first_name: "Yeni", last_name: "Kişi", email: "yeni@x.com", uid: "u1", is_active: true, department_id: "d1", department_name: "Eski Dept" },
        pe2: { personnel_id: "pe2", first_name: "Diğer", last_name: "Kişi", email: "diger@x.com", is_active: true, department_id: "d2", department_name: "Başka Dept" },
      },
      departments: { d1: { department_id: "d1", name: "Yeni Dept" }, d2: { department_id: "d2", name: "Başka Dept" } },
      tickets: {
        t1: ticket("t1", { assigned_to_id: "pe1", assigned_to_name: "Eski Kişi", assigned_uids: { u1: true }, status: "in_progress" }),
        t2: ticket("t2", {}),
        t3: ticket("t3", { company_id: "cB", company_name: "Başka", customer_code: "BSK", user_id: "ub", user_name: "Başka Kişi" }),
        t4: ticket("t4", { is_deleted: true, deleted_at: iso(H) }),
      },
      ticket_assignments: {
        t1: { pe1: { personnel_id: "pe1", personnel_name: "Eski Kişi", personnel_email: "eski@x.com", is_primary: true } },
        t2: { pe2: { personnel_id: "pe2", personnel_name: "Diğer Kişi", personnel_email: "diger@x.com", is_primary: true } },
      },
      ...(extra || {}),
    },
  });
  installFirebase(mem, { uid: "u_admin" });
  return mem;
}
const actor = { uid: "u_admin", role: "super_admin", first_name: "Y", last_name: "Y" };

/* ------------------------------------------------------------------ denormalize yayma */
test("updateCompanyAndSync: ad/kod kopyaları (kullanıcı, talep [silinmiş dahil], sözleşme, proje) yayılır; numara ve başka firma değişmez", async () => {
  const mem = seed();
  // firma kaydı kodu henüz eski: güncelleme yeni değerleri yazar ve yayar
  const res = await ParlaDb.updateCompanyAndSync("cA", { name: "Yeni Ad", customer_code: "NEW0001", updated_by: "u_admin" });
  assert.equal(res.failed, "");
  assert.deepEqual(res.synced, { users: 2, tickets: 3, contracts: 1, projects: 1 });
  for (const u of ["uc", "uc2"]) {
    assert.equal(mem.getAt(`v2/users/${u}/company_name`), "Yeni Ad");
    assert.equal(mem.getAt(`v2/users/${u}/customer_code`), "NEW0001");
  }
  assert.equal(mem.getAt("v2/tickets/t1/company_name"), "Yeni Ad");
  assert.equal(mem.getAt("v2/tickets/t4/customer_code"), "NEW0001", "arşivdeki talep de eşitlenir");
  assert.equal(mem.getAt("v2/tickets/t1/ticket_number"), "SUP-ORN-FI-2610-0001", "talep numarası değişmez");
  assert.equal(mem.getAt("v2/contracts/k1/company_name"), "Yeni Ad");
  assert.equal(mem.getAt("v2/projects/p1/company_name"), "Yeni Ad");
  assert.equal(mem.getAt("v2/projects/p1/customer_code"), "NEW0001");
  assert.equal(mem.getAt("v2/users/ub/company_name"), "Başka", "başka firma dokunulmaz");
  assert.equal(mem.getAt("v2/tickets/t3/company_name"), "Başka");
  // idempotent: ikinci çağrı yazılacak kopya bulamaz
  const before = mem.state.log.length;
  const again = await ParlaDb.syncCompanyCopies("cA");
  assert.deepEqual(again, { users: 0, tickets: 0, contracts: 0, projects: 0 });
  assert.equal(mem.state.log.slice(before).filter((l) => l[0] === "update").length, 0, "değişiklik yoksa yazım yok");
});

test("updatePersonnelAndSync: e-posta + ad yayılır; pasife alınca e-posta kopyası boşalır, aktifleşince geri döner; başkasına dokunulmaz", async () => {
  const mem = seed();
  const r1 = await ParlaDb.updatePersonnelAndSync("pe1", { email: " Yeni.Mail@X.com ", first_name: "Zeynep", last_name: "Arslan", updated_by: "u_admin" });
  assert.equal(r1.failed, "");
  assert.equal(mem.getAt("v2/personnel/pe1/email"), "yeni.mail@x.com");
  assert.equal(mem.getAt("v2/ticket_assignments/t1/pe1/personnel_email"), "yeni.mail@x.com");
  assert.equal(mem.getAt("v2/ticket_assignments/t1/pe1/personnel_name"), "Zeynep Arslan");
  assert.equal(mem.getAt("v2/tickets/t1/assigned_to_name"), "Zeynep Arslan");
  assert.equal(mem.getAt("v2/projects/p1/manager_name"), "Zeynep Arslan");
  assert.equal(mem.getAt("v2/projects/p1/assigned_personnel/pe1/name"), "Zeynep Arslan");
  assert.equal(mem.getAt("v2/ticket_assignments/t2/pe2/personnel_email"), "diger@x.com", "başka personelin kopyası değişmez");

  await ParlaDb.updatePersonnelAndSync("pe1", { is_active: false, updated_by: "u_admin" });
  assert.equal(mem.getAt("v2/ticket_assignments/t1/pe1/personnel_email"), "", "pasif personelin e-postası kopyadan boşaltılır");
  await ParlaDb.updatePersonnelAndSync("pe1", { is_active: true, updated_by: "u_admin" });
  assert.equal(mem.getAt("v2/ticket_assignments/t1/pe1/personnel_email"), "yeni.mail@x.com");

  // eski API: açık e-posta ile yalnız e-posta kopyaları
  const n = await ParlaDb.updatePersonnelEmailCopies("pe1", "baska@x.com");
  assert.equal(n, 1);
  assert.equal(mem.getAt("v2/ticket_assignments/t1/pe1/personnel_email"), "baska@x.com");
});

test("backfillAssignmentEmails: pasif personelin e-postası doldurulmaz", async () => {
  const mem = seed({ personnel: { pe1: { personnel_id: "pe1", first_name: "A", last_name: "B", email: "a@x.com", is_active: false } } });
  const wrote = await ParlaDb.backfillAssignmentEmails("t1", [{ personnel_id: "pe1", personnel_email: "" }], [{ personnel_id: "pe1", email: "a@x.com", is_active: false }]);
  assert.equal(wrote, false);
  assert.equal(mem.getAt("v2/ticket_assignments/t1/pe1/personnel_email"), "eski@x.com", "mevcut kayıt korunur (bu testte boş verilmedi)");
});

test("updateDepartmentAndSync: ad personel kopyalarına yayılır; deleteDepartment gerçekten siler", async () => {
  const mem = seed();
  const r = await ParlaDb.updateDepartmentAndSync("d1", { name: "SAP Destek", updated_by: "u_admin" });
  assert.equal(r.failed, "");
  assert.equal(r.synced, 1);
  assert.equal(mem.getAt("v2/personnel/pe1/department_name"), "SAP Destek");
  assert.equal(mem.getAt("v2/personnel/pe2/department_name"), "Başka Dept");
  await ParlaDb.deleteDepartment("d2");
  assert.equal(mem.getAt("v2/departments/d2"), undefined);
});

test("updateUserProfile: ad değişince talepler üzerindeki user_name yayılır; yalnız ad alanları verilince", async () => {
  const mem = seed();
  mem.setAt("v2/tickets/t1/user_id", "uc");
  await ParlaDb.updateUserProfile("uc", { phone: "+905551112233" });
  assert.equal(mem.getAt("v2/tickets/t1/user_name"), "Eski Müşteri Adı", "ad değişmediyse yayma yok");
  await ParlaDb.updateUserProfile("uc", { first_name: "Ayşe", last_name: "Yılmaz" });
  assert.equal(mem.getAt("v2/tickets/t1/user_name"), "Ayşe Yılmaz");
  assert.equal(mem.getAt("v2/tickets/t2/user_name"), "Ayşe Yılmaz");
  assert.equal(mem.getAt("v2/tickets/t3/user_name"), "Başka Kişi", "başka kullanıcının talebine dokunulmaz");
});

/* ------------------------------------------------------------------ sözleşme */
test("saveContract: bedel contract_values'a, eski contracts/<id>/value temizlenir, has_contract sözleşmelerden türetilir", async () => {
  const mem = seed();
  // düzenleme: eski kayıttaki value göçle kaldırılır
  const edited = await ParlaDb.saveContract({
    id: "k1",
    data: { contract_number: "S1", company_id: "cA", company_name: "Yeni Ad", type: "yillik", start_date: day(-10), end_date: day(100), status: "active", notes: "not" },
    value: 1500.5,
    actor,
  });
  assert.equal(edited.id, "k1");
  assert.equal(mem.getAt("v2/contract_values/k1/value"), 1500.5);
  assert.equal(mem.getAt("v2/contract_values/k1/currency"), "TRY");
  assert.equal(mem.getAt("v2/contracts/k1/value"), undefined, "eski bedel kaldırıldı");
  assert.equal(mem.getAt("v2/contracts/k1/notes"), "not");
  assert.equal(mem.getAt("v2/companies/cA/has_contract"), true);
  assert.equal(mem.getAt("v2/companies/cA/contract_id"), "k1");

  // yeni sözleşme başka firmaya: yalnız o firma bayrağı
  const created = await ParlaDb.saveContract({
    data: { contract_number: "S2", company_id: "cB", company_name: "Başka", type: "bakim", start_date: day(-5), end_date: day(300), status: "active", notes: "" },
    value: null,
    actor,
  });
  assert.equal(mem.getAt(`v2/contract_values/${created.id}`), undefined, "bedel boşsa düğüm yazılmaz");
  assert.equal(mem.getAt("v2/companies/cB/has_contract"), true);
  assert.equal(mem.getAt("v2/contracts/" + created.id + "/created_by"), "u_admin");

  // sözleşmeyi başka firmaya taşı: eski firma bayrağı yeniden hesaplanır (artık sözleşmesiz)
  await ParlaDb.saveContract({
    id: "k1",
    data: { contract_number: "S1", company_id: "cB", company_name: "Başka", type: "yillik", start_date: day(-10), end_date: day(100), status: "active", notes: "" },
    value: 10,
    actor,
  });
  assert.equal(mem.getAt("v2/companies/cA/has_contract"), false);
  assert.equal(mem.getAt("v2/companies/cA/contract_id"), "");
  // iptal
  await ParlaDb.saveContract({
    id: "k1",
    data: { contract_number: "S1", company_id: "cB", company_name: "Başka", type: "yillik", start_date: day(-10), end_date: day(100), status: "cancelled", notes: "" },
    value: 10,
    actor,
  });
  assert.equal(mem.getAt("v2/companies/cB/has_contract"), true, "cB'nin diğer sözleşmesi (S2) hâlâ etkin");
  await ParlaDb.saveContract({
    id: created.id,
    data: { contract_number: "S2", company_id: "cB", company_name: "Başka", type: "bakim", start_date: day(-5), end_date: day(-1), status: "active", notes: "" },
    value: null,
    actor,
  });
  assert.equal(mem.getAt("v2/companies/cB/has_contract"), false, "süresi biten sözleşme 'sözleşmeli' saymaz");

  // bedel yetkisi olmayan çağıran (canWriteValue:false) contract_values'a dokunmaz
  const before = mem.getAt("v2/contract_values/k1");
  await ParlaDb.saveContract({
    id: "k1",
    data: { contract_number: "S1", company_id: "cB", company_name: "Başka", type: "yillik", start_date: day(-10), end_date: day(100), status: "active", notes: "" },
    value: 7777,
    canWriteValue: false,
    actor,
  });
  assert.deepEqual(mem.getAt("v2/contract_values/k1"), before);
  assert.deepEqual(Object.keys(await ParlaDb.getContractValues()).sort(), ["k1"]);
  // createContract/updateContract bedel yazmaz
  const c2 = await ParlaDb.createContract({ contract_number: "S9", company_id: "cA", value: 5 });
  assert.equal(mem.getAt(`v2/contracts/${c2.id}/value`), undefined);
  await ParlaDb.updateContract(c2.id, { value: 6, notes: "n" });
  assert.equal(mem.getAt(`v2/contracts/${c2.id}/value`), undefined);
});

test("generateProjectCode: en büyük + 1, mevcut kodla çakışmaz; createProject yönetici adı 'Seçiniz' kaydetmez", async () => {
  const mem = seed({ projects: { p1: { project_id: "p1", project_code: "PRJ0001" }, p2: { project_id: "p2", project_code: "PRJ0005" }, p3: { project_id: "p3", project_code: "ESKI-01" } } });
  assert.equal(await ParlaDb.generateProjectCode(), "PRJ0006");
  const created = await ParlaDb.createProject({ name: "N", company_id: "cA", company_name: "Yeni Ad", manager_name: "Seçiniz", project_code: "PRJ0006" });
  assert.equal(created.manager_name, "");
  assert.equal(created.company_name, "Yeni Ad");
  assert.equal(await ParlaDb.generateProjectCode(), "PRJ0007");
  assert.equal(mem.getAt(`v2/projects/${created.id}/company_name`), "Yeni Ad");
});

test("getOpenTickets / getTicketsByProject / getTicketCountsForCompanies: indeksli sorgular, arşiv dışında", async () => {
  seed({
    tickets: {
      a: ticket("a", { status: "open", project_id: "p1", ticket_type: "PRJ" }),
      b: ticket("b", { status: "resolved", project_id: "p1" }),
      c: ticket("c", { status: "waiting_customer", company_id: "cB" }),
      d: ticket("d", { status: "closed" }),
      e: ticket("e", { status: "assigned", is_deleted: true }),
    },
  });
  const open = await ParlaDb.getOpenTickets();
  assert.deepEqual(open.map((t) => t.ticket_id).sort(), ["a", "c"]);
  assert.deepEqual((await ParlaDb.getTicketsByProject("p1")).map((t) => t.ticket_id).sort(), ["a", "b"]);
  const counts = await ParlaDb.getTicketCountsForCompanies(["cA", "cB"]);
  assert.deepEqual(counts, { cA: { total: 3, open: 1 }, cB: { total: 1, open: 1 } }, "arşivdeki talep sayılmaz");
});

/* ------------------------------------------------------------------ toplu güncelleme */
test("bulkUpdateTickets: durum matrisi/damgalar updateTicket'ten, parça başına TEK atomik yazım, hatalı talep atlanır", async () => {
  const mem = seed({
    tickets: {
      a: ticket("a", { status: "pending_close", resolved_at: iso(H), assigned_to_id: "pe1", assigned_to_name: "Y K" }),
      b: ticket("b", { status: "pending_close", resolved_at: iso(H), assigned_to_id: "pe1", assigned_to_name: "Y K" }),
      c: ticket("c", { status: "open" }), // open → closed: geçersiz geçiş (matris) -> hata
    },
    ticket_assignments: {},
  });
  const before = mem.state.log.length;
  const results = await ParlaDb.bulkUpdateTickets(
    [
      { id: "a", updates: { status: "closed" }, options: { note: "Toplu kapanış notu", expectedStatus: "pending_close" } },
      { id: "b", updates: { status: "closed" }, options: { note: "Toplu kapanış notu", expectedStatus: "pending_close" } },
      { id: "c", updates: { status: "closed" }, options: { note: "Toplu kapanış notu", expectedStatus: "open" } },
    ],
    actor
  );
  assert.deepEqual(results.map((r) => [r.id, r.ok]), [["a", true], ["b", true], ["c", false]]);
  assert.equal(results[2].error.code, "invalid_transition");
  assert.ok(results[0].report.statusHistoryId, "e-posta için history_id döner");
  assert.equal(results[0].ticket.status, "closed");
  const writes = mem.state.log.slice(before).filter((l) => l[0] === "update");
  assert.equal(writes.length, 1, "2 geçerli talep TEK atomik çok yollu yazımla gider");
  for (const id of ["a", "b"]) {
    const t = mem.getAt(`v2/tickets/${id}`);
    assert.equal(t.status, "closed");
    assert.ok(t.closed_at && typeof t.closed_at_ms === "number" && t.resolved_at, "damgalar tek yerden");
    const hist = Object.values(mem.getAt(`v2/ticket_history/${id}`) || {});
    assert.ok(hist.some((h) => h.field_changed === "status" && h.new_value === "closed" && h.note === "Toplu kapanış notu"));
  }
  assert.equal(mem.getAt("v2/tickets/c/status"), "open", "geçersiz geçiş yazılmadı");
  // bayat ekran: expectedStatus uyuşmazsa talep atlanır
  const stale = await ParlaDb.bulkUpdateTickets([{ id: "a", updates: { status: "reopened" }, options: { note: "x".repeat(12), expectedStatus: "pending_close" } }], actor);
  assert.equal(stale[0].ok, false);
  assert.equal(stale[0].error.code, "status_conflict");
});

test("bulkUpdateTickets: toplu atama — assigned_uids + atama kaydı + durum 'atandı'; parça reddedilirse talepler tek tek denenir", async () => {
  const mem = seed({
    tickets: { a: ticket("a", {}), b: ticket("b", {}), c: ticket("c", {}) },
    ticket_assignments: {},
  });
  const people = Object.values(mem.getAt("v2/personnel")).map((p) => ({ ...p, id: p.personnel_id }));
  const assignments = [{ personnel_id: "pe2", personnel_name: "Diğer Kişi", personnel_email: "diger@x.com", personnel_uid: "", is_primary: true }];
  // 'b' talebi için yazım reddedilsin: DB update'i b yollarını içeren ilk çağrıda hata fırlatır
  const realUpdate = window.__PARLA_FIREBASE.db.update;
  let failedOnce = false;
  window.__PARLA_FIREBASE.db.update = async (ref, patch) => {
    if (!failedOnce && Object.keys(patch).some((k) => k.startsWith("tickets/b/"))) {
      failedOnce = true;
      throw Object.assign(new Error("PERMISSION_DENIED: test"), { code: "PERMISSION_DENIED" });
    }
    if (Object.keys(patch).length && Object.keys(patch).every((k) => k.startsWith("tickets/b/") || k.startsWith("ticket_history/b/") || k.startsWith("ticket_assignments/b/")) && mem.getAt("v2/tickets/b/__fail")) {
      throw new Error("kalıcı hata");
    }
    return realUpdate(ref, patch);
  };
  mem.setAt("v2/tickets/b/__fail", true);
  const results = await ParlaDb.bulkUpdateTickets(
    ["a", "b", "c"].map((id) => ({ id, updates: {}, options: { assignments, expectedStatus: "open" } })),
    { ...actor, role: "project_manager" },
    { personnel: people }
  );
  window.__PARLA_FIREBASE.db.update = realUpdate;
  assert.deepEqual(results.map((r) => [r.id, r.ok]), [["a", true], ["b", false], ["c", true]], "reddedilen parça tek tek denenir; yalnız b başarısız");
  for (const id of ["a", "c"]) {
    const t = mem.getAt(`v2/tickets/${id}`);
    assert.equal(t.assigned_to_id, "pe2");
    assert.equal(t.status, "assigned");
    assert.ok(t.assigned_at);
    assert.equal(mem.getAt(`v2/ticket_assignments/${id}/pe2/personnel_email`), "diger@x.com");
  }
  assert.equal(mem.getAt("v2/tickets/b/assigned_to_id"), "", "başarısız talepte kısmi yazım yok");
});

/* ------------------------------------------------------------------ şablonlar, bakım */
test("hazır yanıt şablonları CRUD", async () => {
  const mem = seed();
  const t = await ParlaDb.createReplyTemplate({ title: " Karşılama ", body: " Merhaba {musteri_adi} ", category: "Genel", sort_order: 3 }, actor);
  assert.equal(mem.getAt(`v2/reply_templates/${t.id}/title`), "Karşılama");
  assert.equal(mem.getAt(`v2/reply_templates/${t.id}/is_active`), true);
  assert.equal(mem.getAt(`v2/reply_templates/${t.id}/created_by`), "u_admin");
  assert.equal(mem.getAt(`v2/reply_templates/${t.id}/template_id`), t.id);
  await ParlaDb.updateReplyTemplate(t.id, { is_active: false, title: "Yeni" }, actor);
  const list = await ParlaDb.getAllReplyTemplates();
  assert.equal(list.length, 1);
  assert.equal(list[0].is_active, false);
  assert.equal(list[0].title, "Yeni");
  assert.equal(list[0].body, "Merhaba {musteri_adi}", "alanlar korunur");
  await ParlaDb.deleteReplyTemplate(t.id);
  assert.deepEqual(await ParlaDb.getAllReplyTemplates(), []);
});

test("migrateInternalMessages: paralel gruplar, iç mesajlar tek çok yollu yazımla taşınır, ilerleme bildirilir", async () => {
  const tickets = {};
  const messages = {};
  for (let i = 0; i < 40; i += 1) {
    tickets[`t${i}`] = ticket(`t${i}`, {});
    messages[`t${i}`] = { m1: { message_id: "m1", message: "açık", is_internal: false }, ...(i % 4 === 0 ? { m2: { message_id: "m2", message: "iç", is_internal: true, user_id: "u" } } : {}) };
  }
  const mem = seed({ tickets, ticket_messages: messages, ticket_assignments: {} });
  const progress = [];
  const res = await ParlaDb.migrateInternalMessages({ onProgress: (d, t) => progress.push([d, t]) });
  assert.deepEqual(res, { tickets: 10, moved: 10 });
  assert.equal(progress.length, 40);
  assert.deepEqual(progress.at(-1), [40, 40]);
  assert.equal(mem.getAt("v2/ticket_messages/t0/m2"), undefined);
  assert.equal(mem.getAt("v2/ticket_internal_notes/t0/m2/message"), "iç");
  assert.equal(mem.getAt("v2/ticket_messages/t1/m1/message"), "açık", "açık mesajlar yerinde kalır");
  const updates = mem.state.log.filter((l) => l[0] === "update");
  assert.equal(updates.length, 10, "taşınan talep başına TEK yazım (mesaj başına set+remove değil)");
});

test("removeUploadedAttachments: yüklenen ekler silinir; kural reddederse sessizce 0", async () => {
  const mem = seed({ ticket_attachments: { t1: { a1: { att_id: "a1", name: "x" }, a2: { att_id: "a2", name: "y" } } } });
  assert.equal(await ParlaDb.removeUploadedAttachments("t1", [{ id: "a1" }, { id: "a2" }], false), 2);
  assert.equal(mem.getAt("v2/ticket_attachments/t1/a1"), undefined);
  assert.equal(mem.getAt("v2/ticket_attachments/t1/a2"), undefined);
  const real = window.__PARLA_FIREBASE.db.update;
  window.__PARLA_FIREBASE.db.update = async () => {
    throw new Error("PERMISSION_DENIED");
  };
  assert.equal(await ParlaDb.removeUploadedAttachments("t1", [{ id: "a1" }], false), 0);
  window.__PARLA_FIREBASE.db.update = real;
  assert.equal(await ParlaDb.removeUploadedAttachments("t1", [], false), 0);
});

test("getActivitiesByField: sunucuda süzülmüş aktiviteler (en yeni önce)", async () => {
  seed({
    activities: {
      a1: { activity_id: "a1", entity_id: "pe1", created_at: iso(3 * H), action: "x" },
      a2: { activity_id: "a2", entity_id: "pe1", created_at: iso(1 * H), action: "x" },
      a3: { activity_id: "a3", entity_id: "pe2", created_at: iso(2 * H), action: "x" },
    },
  });
  const rows = await ParlaDb.getActivitiesByField("entity_id", "pe1", 50);
  assert.deepEqual(rows.map((r) => r.id), ["a2", "a1"]);
});
