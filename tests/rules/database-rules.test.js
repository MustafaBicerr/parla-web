/**
 * database.rules.json işlevsel testleri (targaryen ile yerel simülasyon).
 * Çalıştırma:  cd tests/rules && npm install && npm test
 * Başka bir kural dosyasını denemek için: RULES_FILE=/yol/rules.json npm test
 *
 * Bu dosya "olumlu yol + temel yalıtım" testleridir; 17 aktör × ~150 işlem matrisi ve her bulgunun
 * "reddedilmeli" probe'ları matrix.test.js içindedir. Ortak örnek veri: helpers.js.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const H = require("./helpers.js");
const { rules, T0, D, ISO, isoAt, att, newTicketPayload, message, historyEntry, effort, activity } = H;

const db = H.makeDb();
const as = (uid) => db.as(H.authOf(uid));
const withData = (mutate) => {
  const d = H.buildData();
  mutate(d.v2);
  return H.makeDb(d);
};
const q = (orderByChild, equalTo) => ({ query: { orderByChild, equalTo } });

function assertAllowed(result, msg) {
  assert.equal(result.allowed, true, `${msg || "izin verilmeliydi"}\n${result.info}`);
}
function assertDenied(result, msg) {
  assert.equal(result.allowed, false, `${msg || "reddedilmeliydi"} (izin verildi)`);
}
const withStatus = (status, extra) => withData((v2) => Object.assign(v2.tickets.t1, { status }, extra || {}));

// ---------------------------------------------------------------- users
test("[kritik] profili olmayan hesap kendine super_admin profili yazamaz", () => {
  assertDenied(as("u_noprofile").write("/v2/users/u_noprofile", { role: "super_admin", is_active: true, email: "x@x.com" }));
  assertDenied(as("u_noprofile").update("/v2/users/u_noprofile", { role: "super_admin" }));
});

test("[kritik] müşteri kendi rolünü / firmasını / aktifliğini değiştiremez", () => {
  assertDenied(as("u_cust").write("/v2/users/u_cust/role", "super_admin"));
  assertDenied(as("u_cust").update("/v2/users/u_cust", { role: "service_admin" }));
  assertDenied(as("u_cust").write("/v2/users/u_cust/company_id", "cB"));
  assertDenied(as("u_cust").write("/v2/users/u_cust/is_active", true));
  assertDenied(as("u_cust").write("/v2/users/u_cust", { role: "super_admin" }));
});

test("müşteri girişte last_login_at / updated_at yazabilir (ISO/≤40 karakter)", () => {
  assertAllowed(as("u_cust").update("/v2/users/u_cust", { last_login_at: ISO, updated_at: ISO }));
  assertDenied(as("u_cust").write("/v2/users/u_cust/last_login_at", "A".repeat(41)));
});

test("müşteri başkasının profilini okuyamaz/yazamaz, kendisini okuyabilir", () => {
  assertAllowed(as("u_cust").read("/v2/users/u_cust"));
  assertDenied(as("u_cust").read("/v2/users/u_root"));
  assertDenied(as("u_cust").write("/v2/users/u_custB/last_login_at", "x"));
  assertDenied(as("u_cust").read("/v2/users"));
});

test("pasif ve profilsiz hesap yine de kendi profilini okuyabilir (istemci pasifliği görsün)", () => {
  assertAllowed(as("u_inact_cust").read("/v2/users/u_inact_cust"));
  assertAllowed(as("u_inact_cons").read("/v2/users/u_inact_cons"));
  assertAllowed(as("u_noprofile").read("/v2/users/u_noprofile"));
});

test("must_change_password yalnızca false'a çekilebilir (kullanıcı tarafından)", () => {
  assertDenied(as("u_cust").write("/v2/users/u_cust/must_change_password", true));
  assertAllowed(as("u_new").write("/v2/users/u_new/must_change_password", false));
});

test("super_admin kullanıcı oluşturabilir; service_admin super_admin atayamaz", () => {
  assertAllowed(as("u_root").write("/v2/users/new1", { role: "customer", company_id: "cA", is_active: true }));
  assertAllowed(as("u_root").write("/v2/users/new2", { role: "super_admin", is_active: true }));
  assertAllowed(as("u_service").write("/v2/users/new3", { role: "customer", company_id: "cA", is_active: true }));
  assertDenied(as("u_service").write("/v2/users/new4", { role: "super_admin", is_active: true }), "service_admin super_admin üretemez");
  assertDenied(as("u_service").update("/v2/users/u_cust", { role: "super_admin" }));
});

test("[YON-05/SEC-09] service_admin super_admin profiline dokunamaz (düşür/pasifleştir/sil/e-posta)", () => {
  assertDenied(as("u_service").update("/v2/users/u_root", { is_active: false }));
  assertDenied(as("u_service").update("/v2/users/u_root", { role: "customer" }));
  assertDenied(as("u_service").write("/v2/users/u_root", null));
  assertDenied(as("u_service").update("/v2/users/u_root", { email: "hack@evil.com" }));
  assertDenied(as("u_service").write("/v2/users/u_root/is_active", false));
  assertAllowed(as("u_root2").update("/v2/users/u_root", { email: "yeni@parla-demo.com" }), "super_admin başka super_admin'i yönetebilir");
});

test("[YON-06] hiç kimse kendi rolünü/aktifliğini/firmasını değiştiremez (kendini kilitleme)", () => {
  assertDenied(as("u_root").update("/v2/users/u_root", { is_active: false }));
  assertDenied(as("u_root").update("/v2/users/u_root", { role: "consultant" }));
  assertDenied(as("u_root").write("/v2/users/u_root", null));
  assertDenied(as("u_service").update("/v2/users/u_service", { role: "customer" }));
  assertDenied(as("u_service").update("/v2/users/u_service", { is_active: false }));
  assertAllowed(as("u_root").update("/v2/users/u_root", { last_login_at: ISO, updated_at: ISO }));
});

test("geçersiz rol değeri yazılamaz", () => {
  assertDenied(as("u_root").write("/v2/users/new5", { role: "hacker", is_active: true }));
});

// -------------------------------------------------------------- pasif / profilsiz hesaplar (ACTIVE / HAS_PROFILE)
test("[SEC-04/MUS-03/YON-01] pasif personel hiçbir veriyi okuyamaz/yazamaz", () => {
  for (const p of ["/v2/tickets", "/v2/tickets/t1", "/v2/contracts", "/v2/companies", "/v2/personnel", "/v2/activities", "/v2/ticket_messages/t1", "/v2/ticket_internal_notes/t1", "/v2/ticket_efforts/t1", "/v2/projects"]) {
    assertDenied(as("u_inact_cons").read(p), `pasif danışman ${p} okuyamaz`);
  }
  assertDenied(as("u_inact_svc").read("/v2/users"), "pasif service_admin kullanıcı listesini okuyamaz");
  assertDenied(as("u_inact_svc").write("/v2/tickets/t2", null));
  assertDenied(as("u_inact_svc").update("/v2/tickets/t2", { priority: "low" }));
  assertDenied(as("u_inact_svc").write("/v2/users/u_root/is_active", false));
  assertDenied(as("u_inact_cons").write("/v2/ticket_messages/t1/mx", message("u_inact_cons", "mx")));
});

test("[MUS-03] pasif müşteri talep okuyamaz/yazamaz/oluşturamaz", () => {
  const d = withData((v2) => {
    v2.tickets.t_inact = H.ticket("t_inact", { user_id: "u_inact_cust" });
  });
  const a = (u) => d.as(H.authOf(u));
  assertDenied(a("u_inact_cust").read("/v2/tickets", q("user_id", "u_inact_cust")));
  assertDenied(a("u_inact_cust").read("/v2/tickets/t_inact"));
  assertDenied(a("u_inact_cust").write("/v2/tickets/n1", newTicketPayload("u_inact_cust")));
  assertDenied(a("u_inact_cust").write("/v2/ticket_messages/t_inact/m9", message("u_inact_cust", "m9")));
  assertDenied(a("u_inact_cust").write("/v2/counters/SUP/ORN/2610", 13));
  assertDenied(a("u_inact_cust").read("/v2/counters"));
});

test("[SEC-05/MUS-04/ALT-06] profilsiz hesap talep/ek/mesaj/sayaç/profil yazamaz", () => {
  const ghost = "u_noprofile";
  assertDenied(as(ghost).write("/v2/tickets/n1", newTicketPayload(ghost, { company_id: "", customer_code: "X" })));
  const p = newTicketPayload(ghost, { company_id: "" });
  delete p.company_id;
  assertDenied(as(ghost).write("/v2/tickets/n1", p));
  assertDenied(as(ghost).write("/v2/counters/SUP/ORN/2610", 13));
  assertDenied(as(ghost).read("/v2/counters"));
  assertDenied(as(ghost).write("/v2/users/u_noprofile/last_login_at", ISO));
  assertDenied(as(ghost).write("/v2/activities/g1", activity(ghost, "g1")));
  assertDenied(as(ghost).write("/v2/notifications/u_noprofile/n", { title: "x" }));
});

// -------------------------------------------------------------- tickets
test("[kritik] müşteri assigned_to_id sorgusuyla başka firmaların ticket'larını okuyamaz", () => {
  assertDenied(as("u_cust").read("/v2/tickets", q("assigned_to_id", "p2")));
  assertDenied(as("u_noprofile").read("/v2/tickets", q("assigned_to_id", "p2")));
});

test("müşteri yalnızca kendi user_id sorgusunu okur; firma sorgusu yalnızca firma yöneticisine açık", () => {
  assertAllowed(as("u_cust").read("/v2/tickets", q("user_id", "u_cust")));
  assertDenied(as("u_cust").read("/v2/tickets", q("user_id", "u_custB")));
  assertDenied(as("u_cust").read("/v2/tickets", q("company_id", "cA")), "customer rolü firma listesini göremez");
  assertDenied(as("u_cust").read("/v2/tickets", q("company_id", "cB")));
  assertDenied(as("u_cust").read("/v2/tickets"));
  assertDenied(as("u_noprofile").read("/v2/tickets", q("user_id", "u_noprofile")), "profilsiz hesap kendi sorgusunu da okuyamaz");
});

test("firma yöneticisi kendi firmasının ticket'larını listeler, başka firmayı listeleyemez", () => {
  assertAllowed(as("u_cadmin").read("/v2/tickets", q("company_id", "cA")));
  assertDenied(as("u_cadmin").read("/v2/tickets", q("company_id", "cB")));
  assertDenied(as("u_cadmin").read("/v2/tickets"));
  assertDenied(as("u_cadmin").read("/v2/tickets", q("assigned_to_id", "p1")));
  assertAllowed(as("u_cadmin").read("/v2/tickets", q("user_id", "u_cadmin")));
});

test("firma yöneticisi firma ticket'ını, mesajlarını, geçmişini ve atamalarını okur/yanıtlar; başka firmanınkini okuyamaz", () => {
  assertAllowed(as("u_cadmin").read("/v2/tickets/t1"));
  assertDenied(as("u_cadmin").read("/v2/tickets/t10"));
  assertAllowed(as("u_cadmin").read("/v2/ticket_messages/t1"));
  assertAllowed(as("u_cadmin").read("/v2/ticket_history/t1"));
  assertAllowed(as("u_cadmin").read("/v2/ticket_assignments/t1"));
  assertDenied(as("u_cadminB").read("/v2/ticket_messages/t1"));
  assertDenied(as("u_cadmin").read("/v2/ticket_internal_notes/t1"), "iç notlar firma yöneticisine de kapalı");
  const msg = message("u_cadmin", "mc");
  assertAllowed(as("u_cadmin").write("/v2/ticket_messages/t1/mc", msg));
  assertDenied(as("u_cadmin").write("/v2/ticket_messages/t10/mc", msg));
  assertDenied(as("u_cust2").read("/v2/ticket_messages/t1"), "aynı firmadaki sıradan müşteri görmez");
});

test("firması olmayan (arızi) müşteri company_id='' sorgusuyla diğer arızi kayıtları okuyamaz", () => {
  assertDenied(as("u_arizi").read("/v2/tickets", q("company_id", "")));
  assertAllowed(as("u_arizi").read("/v2/tickets", q("user_id", "u_arizi")));
});

test("personel rolleri tüm ticket'ları okur (görme geniş)", () => {
  for (const u of ["u_root", "u_service", "u_pm", "u_cons", "u_cons2"]) {
    assertAllowed(as(u).read("/v2/tickets"));
    assertAllowed(as(u).read("/v2/tickets/t10"));
  }
});

test("müşteri yalnızca kendi ticket'ını doğrudan okur", () => {
  assertAllowed(as("u_cust").read("/v2/tickets/t1"));
  assertDenied(as("u_cust").read("/v2/tickets/t10"));
  assertDenied(as("u_cust2").read("/v2/tickets/t1"));
});

test("müşteri kendi adına, 'open' durumda, kendi firması/e-postasıyla ticket oluşturabilir", () => {
  const base = newTicketPayload("u_cust");
  assertAllowed(as("u_cust").write("/v2/tickets/n1", base));
  assertDenied(as("u_cust").write("/v2/tickets/n1", { ...base, user_id: "u_custB", created_by: "u_custB" }), "başkası adına");
  assertDenied(as("u_cust").write("/v2/tickets/n1", { ...base, company_id: "cB" }), "başka firma adına");
  assertDenied(as("u_cust").write("/v2/tickets/n1", { ...base, status: "closed" }), "kapalı olarak oluşturma");
  assertDenied(as("u_cust").write("/v2/tickets/n1", { ...base, user_email: "kurban@baska.com" }), "e-posta taklidi");
  assertAllowed(as("u_cust").write("/v2/tickets/n1", { ...base, user_email: "CUST@ornek-a.com" }), "e-posta büyük/küçük harf duyarsız");
});

test("firması olmayan (arızi) müşteri company_id='' ile ARZ/BUG ticket oluşturabilir; SUP oluşturamaz (D-09)", () => {
  const base = newTicketPayload("u_arizi", { ticket_id: "n2", ticket_type: "ARZ", ticket_number: "ARZ-ARZ0001-FI-2610-0002" });
  assertAllowed(as("u_arizi").write("/v2/tickets/n2", base));
  assertAllowed(as("u_arizi").write("/v2/tickets/n2", { ...base, ticket_type: "BUG", ticket_number: "BUG-ARZ0001-FI-2610-0002" }));
  assertDenied(as("u_arizi").write("/v2/tickets/n2", { ...base, ticket_type: "SUP", ticket_number: "SUP-ARZ0001-FI-2610-0002" }));
  assertDenied(as("u_cust").write("/v2/tickets/n3", newTicketPayload("u_cust", { ticket_id: "n3", ticket_type: "ARZ", ticket_number: "ARZ-ORN-FI-2610-0002" })), "sözleşmeli müşteri ARZ açamaz");
  assertDenied(as("u_cust").write("/v2/tickets/n3", newTicketPayload("u_cust", { ticket_id: "n3", ticket_type: "INT", ticket_number: "INT-ORN-FI-2610-0002" })));
  assertAllowed(as("u_cust").write("/v2/tickets/n3", newTicketPayload("u_cust", { ticket_id: "n3", ticket_type: "BUG", ticket_number: "BUG-ORN-FI-2610-0002" })));
});

test("[kritik] müşteri kendi ticket'ının önceliğini/atamasını/durumunu keyfi değiştiremez", () => {
  assertDenied(as("u_cust").write("/v2/tickets/t1/priority", "low"));
  assertDenied(as("u_cust").write("/v2/tickets/t1/assigned_to_id", "p9"));
  assertDenied(as("u_cust").write("/v2/tickets/t1/status", "closed"));
  assertDenied(as("u_cust").write("/v2/tickets/t1/company_id", "cB"));
  assertDenied(as("u_cust").write("/v2/tickets/t1", { user_id: "u_cust", status: "closed" }));
  assertDenied(as("u_cust").write("/v2/tickets/t1/assigned_uids/u_cust", true));
  assertDenied(as("u_cust").write("/v2/tickets/t1/is_deleted", true));
});

test("müşteri 'müşteri bekleniyor' ticket'ı yanıtlayınca işlemde durumuna çekebilir", () => {
  assertAllowed(as("u_cust").update("/v2/tickets/t3", { status: "in_progress", updated_at: ISO, updated_by: "u_cust" }));
  assertDenied(as("u_cust").update("/v2/tickets/t2", { status: "in_progress", updated_at: ISO }));
});

test("müşteri mesaj eklerken ticket updated_at'ini güncelleyebilir (yalnızca kendi ticket'ı, ISO biçimli)", () => {
  assertAllowed(as("u_cust").update("/v2/tickets/t1", { updated_at: ISO }));
  assertDenied(as("u_cust").update("/v2/tickets/t10", { updated_at: ISO }));
  assertDenied(as("u_cust").update("/v2/tickets/t1", { updated_at: "9999" }));
  assertDenied(as("u_cust").update("/v2/tickets/t1", { updated_at: "2099-01-01T00:00:00.000Z" }));
});

test("yönetici roller (super/service/PM) ticket günceller; tamamen silme yalnızca super_admin (D-05)", () => {
  assertAllowed(as("u_service").update("/v2/tickets/t2", { status: "in_progress", assigned_to_id: "p1", assigned_uids: { u_cons: true } }));
  assertAllowed(as("u_pm").update("/v2/tickets/t2", { priority: "high" }));
  assertDenied(as("u_pm").write("/v2/tickets/t2", null));
  assertDenied(as("u_cons").write("/v2/tickets/t2", null));
  assertDenied(as("u_service").write("/v2/tickets/t2", null), "service_admin yalnızca yumuşak siler");
  assertAllowed(as("u_root").write("/v2/tickets/t2", null));
});

test("[D-05] service_admin yumuşak siler (is_deleted); PM yumuşak silme alanına dokunamaz; müşteri yazamaz", () => {
  const stamp = { is_deleted: true, deleted_at: ISO, deleted_by: "u_service" };
  assertAllowed(as("u_service").update("/v2/tickets/t2", stamp));
  assertAllowed(as("u_root").update("/v2/tickets/t2", stamp));
  assertDenied(as("u_pm").update("/v2/tickets/t2", stamp));
  assertDenied(as("u_cons").update("/v2/tickets/t2", stamp));
  assertDenied(as("u_cust").update("/v2/tickets/t1", stamp));
  assertDenied(as("u_pm").update("/v2/tickets/t14", { is_deleted: null, deleted_at: null, deleted_by: null }), "PM geri yükleyemez");
  assertAllowed(as("u_service").update("/v2/tickets/t14", { is_deleted: null, deleted_at: null, deleted_by: null }), "ADMIN geri yükler");
  assertDenied(as("u_service").update("/v2/tickets/t2", { is_deleted: "evet" }));
});

test("[SEC-11/D-05] cascade silme: yalnızca super_admin, tek çok-yollu update ile 9 düğüm", () => {
  const cascade = {};
  for (const n of ["tickets", "ticket_messages", "ticket_internal_notes", "ticket_attachments", "ticket_internal_attachments", "ticket_history", "ticket_assignments", "ticket_efforts", "ticket_attachment_stats"]) cascade[`${n}/t1`] = null;
  assertAllowed(as("u_root").update("/v2", cascade));
  for (const u of ["u_service", "u_pm", "u_cons", "u_cust", "u_cadmin"]) assertDenied(as(u).update("/v2", cascade), `${u} cascade silemez`);
  // kısmi silmeler de yalnızca super_admin
  for (const n of ["ticket_messages", "ticket_internal_notes", "ticket_history", "ticket_efforts", "ticket_attachments"]) {
    assertDenied(as("u_service").write(`/v2/${n}/t1`, null), `service_admin ${n} konusunu silemez`);
    assertAllowed(as("u_root").write(`/v2/${n}/t1`, null), `super_admin ${n} konusunu siler`);
  }
  // super_admin düğümü toptan silme yetkisiyle başka içerik yazamaz
  assertDenied(as("u_root").write("/v2/ticket_messages/t1", { x: { message: "toplu yaz" } }));
});

test("[SEC-11] silinmiş talebin yetim verisini devralmak için aynı anahtarla talep açılamaz", () => {
  const d = withData((v2) => {
    delete v2.tickets.t1;
  });
  assertDenied(d.as(H.authOf("u_cust2")).write("/v2/tickets/t1", newTicketPayload("u_cust2", { ticket_id: "t1" })));
  assertAllowed(d.as(H.authOf("u_cust2")).write("/v2/tickets/tnew", newTicketPayload("u_cust2", { ticket_id: "tnew" })));
});

// ------------------------------------------------ danışman yazma yetkisi (D-08 A: assigned_uids)
test("[PER-07/D-08] danışman yalnızca atandığı talebe yazar; atanmadığı talepte her yazım reddedilir", () => {
  // atanmış (t1): durum, damgalar, mesaj, not, ek, efor
  assertAllowed(as("u_cons").update("/v2/tickets/t1", { status: "pending_close", updated_at: ISO, updated_by: "u_cons", public_updated_at: ISO, public_updated_by: "u_cons", first_response_at: ISO }));
  assertAllowed(as("u_cons").write("/v2/ticket_messages/t1/mnew", message("u_cons", "mnew")));
  assertAllowed(as("u_cons").write("/v2/ticket_internal_notes/t1/nnew", message("u_cons", "nnew", { is_internal: true })));
  assertAllowed(as("u_cons").write("/v2/ticket_attachments/t1/anew", att("u_cons", { att_id: "anew" })));
  assertAllowed(as("u_cons").write("/v2/ticket_internal_attachments/t1/inew", att("u_cons", { att_id: "inew" })));
  assertAllowed(as("u_cons").write("/v2/ticket_efforts/t1/enew", effort("u_cons", "enew")));
  assertAllowed(as("u_cons").write("/v2/ticket_history/t1/hnew", historyEntry("u_cons", "hnew")));
  // atanmamış danışman (cons2) ve atanmamış talepte (t2) cons: hiçbiri
  for (const [u, t] of [["u_cons2", "t1"], ["u_cons", "t2"], ["u_cons", "t10"]]) {
    assertDenied(as(u).update(`/v2/tickets/${t}`, { status: "closed", updated_at: ISO }), `${u} ${t} durum`);
    assertDenied(as(u).write(`/v2/tickets/${t}/priority`, "low"), `${u} ${t} öncelik`);
    assertDenied(as(u).write(`/v2/ticket_messages/${t}/mx`, message(u, "mx")), `${u} ${t} mesaj`);
    assertDenied(as(u).write(`/v2/ticket_internal_notes/${t}/nx`, message(u, "nx", { is_internal: true })), `${u} ${t} iç not`);
    assertDenied(as(u).write(`/v2/ticket_efforts/${t}/ex`, effort(u, "ex")), `${u} ${t} efor`);
    assertDenied(as(u).write(`/v2/ticket_attachments/${t}/ax`, att(u, { att_id: "ax" })), `${u} ${t} ek`);
    assertDenied(as(u).write(`/v2/ticket_history/${t}/hx`, historyEntry(u, "hx")), `${u} ${t} geçmiş`);
  }
});

test("danışman atama/öncelik/sahiplik/silme alanlarını (atanmış talepte bile) değiştiremez; yöneticiler değiştirir", () => {
  for (const f of [["priority", "low"], ["assigned_to_id", "p9"], ["company_id", "cB"], ["user_id", "u_cons"], ["title", "x"]]) {
    assertDenied(as("u_cons").write(`/v2/tickets/t1/${f[0]}`, f[1]), `danışman ${f[0]} yazamaz`);
  }
  assertDenied(as("u_cons").write("/v2/tickets/t1/assigned_uids/u_cons2", true), "danışman başkasını atayamaz");
  assertDenied(as("u_cons").write("/v2/tickets/t1/is_deleted", true));
  assertDenied(as("u_cons").write("/v2/ticket_assignments/t1/p9", { personnel_id: "p9", personnel_email: "p9@parla-demo.com" }), "atama yalnızca yöneticilerde");
  assertAllowed(as("u_pm").write("/v2/ticket_assignments/t1/p9", { personnel_id: "p9", personnel_email: "p9@parla-demo.com" }));
  assertAllowed(as("u_service").write("/v2/tickets/t1/assigned_uids/u_cons2", true));
  assertAllowed(as("u_pm").update("/v2/tickets/t1", { priority: "critical" }));
});

test("danışman yeni talep açabilir ve oluşturduğu talebin geçmişini yazabilir (atanmadan önce)", () => {
  const p = newTicketPayload("u_cust", { ticket_id: "nc", created_by: "u_cons" });
  assertAllowed(as("u_cons").write("/v2/tickets/nc", p));
  const d = withData((v2) => {
    v2.tickets.nc = p;
  });
  assertAllowed(d.as(H.authOf("u_cons")).write("/v2/ticket_history/nc/h1", historyEntry("u_cons", "h1", { action: "created" })));
  assertDenied(d.as(H.authOf("u_cons2")).write("/v2/ticket_history/nc/h1", historyEntry("u_cons2", "h1")));
});

test("danışman efor kaydını yalnızca kendisi oluşturduysa siler; yöneticiler siler", () => {
  assertAllowed(as("u_cons").write("/v2/ticket_efforts/t1/e1", null), "e1'i u_cons yazdı");
  assertDenied(as("u_cons2").write("/v2/ticket_efforts/t1/e1", null));
  assertAllowed(as("u_service").write("/v2/ticket_efforts/t1/e1", null));
  assertDenied(as("u_cons").write("/v2/ticket_efforts/t1/e1/hours", 99), "mevcut efor düzenlenemez (danışman)");
});

// ------------------------------------------------ yaşam döngüsü (onay/yeniden açma)
test("müşteri 'kapanış onayı bekliyor' talebi onaylayıp kapatabilir (closed_at/closed_at_ms ile)", () => {
  const d = withStatus("pending_close");
  const a = (u) => d.as(H.authOf(u));
  assertAllowed(a("u_cust").update("/v2/tickets/t1", { status: "closed", closed_at: ISO, closed_at_ms: T0, updated_at: ISO, updated_by: "u_cust", public_updated_at: ISO, public_updated_by: "u_cust" }));
  assertAllowed(a("u_cust").update("/v2/tickets/t1", { status: "closed", closed_at: ISO, updated_at: ISO }), "closed_at_ms olmadan da kapatabilir (eski istemci)");
  assertDenied(a("u_custB").update("/v2/tickets/t1", { status: "closed", closed_at: ISO }), "başka müşteri kapatamaz");
  assertDenied(a("u_cust").update("/v2/tickets/t1", { status: "resolved" }), "müşteri çözüldü işaretleyemez");
  assertDenied(a("u_cust").update("/v2/tickets/t1", { status: "closed", closed_at: ISO, closed_at_ms: T0 - 30 * D }), "closed_at_ms sunucu saatine yakın olmalı");
  assertDenied(a("u_cust").update("/v2/tickets/t1", { status: "closed", closed_at: "dün" }));
});

test("müşteri çözülmüş/kapanış onaylı talebi gerekçeyle yeniden açabilir; kapalı talebi yalnızca 14 gün içinde", () => {
  for (const status of ["pending_close", "resolved"]) {
    assertAllowed(withStatus(status).as(H.authOf("u_cust")).update("/v2/tickets/t1", { status: "reopened", reopened_at: ISO, updated_at: ISO, updated_by: "u_cust" }), status + " -> reopened");
  }
  const reopen = { status: "reopened", reopened_at: ISO, closed_at: null, closed_at_ms: null, updated_at: ISO };
  assertAllowed(withStatus("closed", { closed_at: isoAt(10 * D), closed_at_ms: T0 - 10 * D }).as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen), "10 gün önce kapanan");
  assertAllowed(withStatus("closed", { closed_at_ms: T0 - 13 * D - 23 * 3600 * 1000 }).as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen), "13,96 gün");
  assertDenied(withStatus("closed", { closed_at: isoAt(15 * D), closed_at_ms: T0 - 15 * D }).as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen), "15 gün önce kapanan");
  assertDenied(withStatus("closed", { closed_at: isoAt(40 * D), closed_at_ms: T0 - 40 * D }).as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen), "40 gün önce kapanan");
  assertDenied(withStatus("closed", { closed_at: isoAt(1 * D) }).as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen), "closed_at_ms yoksa (eski kayıt) kural 14 günü doğrulayamaz -> reddedilir");
  assertDenied(withStatus("in_progress").as(H.authOf("u_cust")).update("/v2/tickets/t1", { status: "reopened", reopened_at: ISO }), "açık talep yeniden açılmaz");
  assertDenied(withStatus("open").as(H.authOf("u_cust")).update("/v2/tickets/t1", { status: "closed", closed_at: ISO }), "açık talep müşteri tarafından kapatılamaz");
  // 14 gün penceresi sunucu saatiyle ölçülür (now parametresi)
  const closedDb = withStatus("closed", { closed_at_ms: T0 });
  assertAllowed(closedDb.as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen, { now: T0 + 13 * D }));
  assertDenied(closedDb.as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen, { now: T0 + 15 * D }));
});

test("[SEN-40] müşteri closed_at/closed_at_ms'i yeniden açmadan temizleyemez (14 gün sınırını sıfırlayamaz)", () => {
  const d = withStatus("closed", { closed_at: isoAt(20 * D), closed_at_ms: T0 - 20 * D });
  assertDenied(d.as(H.authOf("u_cust")).write("/v2/tickets/t1/closed_at_ms", null));
  assertDenied(d.as(H.authOf("u_cust")).write("/v2/tickets/t1/closed_at_ms", T0));
  assertDenied(d.as(H.authOf("u_cust")).write("/v2/tickets/t1/closed_at", null));
});

test("firma yöneticisi firma ticket'ını onaylayıp kapatabilir; sıradan müşteri/başka firma yönetemez", () => {
  const d = withStatus("pending_close");
  assertAllowed(d.as(H.authOf("u_cadmin")).update("/v2/tickets/t1", { status: "closed", closed_at: ISO, updated_at: ISO }));
  assertDenied(d.as(H.authOf("u_cadminB")).update("/v2/tickets/t1", { status: "closed", closed_at: ISO }));
  assertDenied(d.as(H.authOf("u_cust2")).update("/v2/tickets/t1", { status: "closed", closed_at: ISO }));
});

test("müşteri yaşam döngüsü alanları dışında hiçbir alanı değiştiremez (durum geçişi sırasında bile)", () => {
  const d = withStatus("pending_close");
  assertDenied(d.as(H.authOf("u_cust")).update("/v2/tickets/t1", { status: "closed", closed_at: ISO, priority: "low" }));
  assertDenied(d.as(H.authOf("u_cust")).update("/v2/tickets/t1", { status: "reopened", reopened_at: ISO, assigned_to_id: "x" }));
  assertDenied(d.as(H.authOf("u_cust")).write("/v2/tickets/t1/first_response_at", ISO));
  assertDenied(d.as(H.authOf("u_cust")).write("/v2/tickets/t1/sla_note", "x"));
  assertDenied(d.as(H.authOf("u_cust")).write("/v2/tickets/t1/sla_foo", ISO), "bilinmeyen sla_* alanı müşteri yazamaz");
  assertDenied(d.as(H.authOf("u_cust")).write("/v2/tickets/t1/sla_window", ISO), "yeni SLA penceresi yeniden açma dışında yazılamaz");
});

test("[D-06] SLA damgaları: müşteri yalnızca güvenli yönlere yazar (duraklama süresi azalmaz, ihlal damgası silinmez, yeni pencere yalnızca yeniden açmada)", () => {
  const cust = (d) => d.as(H.authOf("u_cust"));
  // müşteri yanıtı: bekleniyor -> işlemde, duraklama biter
  assertAllowed(cust(db).update("/v2/tickets/t3", { status: "in_progress", sla_paused_since: null, sla_paused_ms: 90000000, updated_at: ISO }));
  assertDenied(cust(db).write("/v2/tickets/t3/sla_paused_ms", 0), "duraklama süresi azaltılamaz");
  assertDenied(cust(db).write("/v2/tickets/t3/sla_response_breached_at", null), "ihlal damgası silinemez");
  assertDenied(cust(db).write("/v2/tickets/t3/sla_response_breached_at", ISO), "ihlal damgası ezilemez");
  assertAllowed(cust(db).write("/v2/tickets/t1/sla_response_breached_at", ISO), "yoksa bir kez yazılabilir");
  assertDenied(cust(db).write("/v2/tickets/t1/sla_window", ISO), "yeniden açma dışında yeni pencere yok");
  assertDenied(cust(db).write("/v2/tickets/t3/sla_paused_ms", 5.5e10), "biçim/aralık dışı");
  assertDenied(cust(db).write("/v2/tickets/t3/sla_paused_since", "dün"));
  // yeniden açma: yeni pencere + sıfırlama serbest
  const reopen = { status: "reopened", reopened_at: ISO, closed_at: null, closed_at_ms: null, sla_window: ISO, sla_paused_ms: 0, sla_resolution_breached_at: null, updated_at: ISO };
  assertAllowed(cust(withStatus("closed", { closed_at_ms: T0 - 2 * D, sla_paused_ms: 5000, sla_resolution_breached_at: isoAt(3 * D) })).update("/v2/tickets/t1", reopen));
  // başkasının talebi
  assertDenied(H.makeDb().as(H.authOf("u_custB")).update("/v2/tickets/t3", { sla_paused_since: null }));
  // atanmış danışman ve yöneticiler sla_* alanlarını serbestçe yazar; atanmamış danışman yazamaz
  assertAllowed(as("u_cons").write("/v2/tickets/t3/sla_response_breached_at", null));
  assertAllowed(as("u_pm").write("/v2/tickets/t3/sla_response_breached_at", null));
  assertDenied(as("u_cons2").write("/v2/tickets/t3/sla_paused_ms", 7));
});

test("müşteri silinmiş talepte hiçbir şey yazamaz", () => {
  const d = withData((v2) => {
    Object.assign(v2.tickets.t3, { is_deleted: true, deleted_at: isoAt(1 * D), deleted_by: "u_service" });
  });
  assertDenied(d.as(H.authOf("u_cust")).update("/v2/tickets/t3", { status: "in_progress", updated_at: ISO }));
  assertDenied(d.as(H.authOf("u_cust")).write("/v2/ticket_messages/t3/mx", message("u_cust", "mx")));
  assertDenied(d.as(H.authOf("u_cust")).write("/v2/ticket_history/t3/hx", historyEntry("u_cust", "hx")));
});

test("personel her durum geçişini yapabilir (atanmış danışman ve yönetici; pending_close, reopened dahil)", () => {
  for (const status of ["pending_close", "waiting_customer", "reopened", "resolved", "closed", "in_progress"]) {
    assertAllowed(as("u_cons").update("/v2/tickets/t1", { status, updated_at: ISO }), status);
    assertAllowed(as("u_service").update("/v2/tickets/t1", { status, updated_at: ISO }), status);
  }
});

test("SLA/hatırlatma damga aileleri (sla_*, reminder_*) yalnızca personel tarafından yazılır", () => {
  assertAllowed(as("u_service").write("/v2/tickets/t1/sla_response_breached_at", ISO));
  assertAllowed(as("u_cons").write("/v2/tickets/t1/reminder_waiting_3d_at", ISO), "atanmış danışman");
  assertDenied(as("u_cons2").write("/v2/tickets/t1/reminder_waiting_3d_at", ISO));
  assertDenied(as("u_service").write("/v2/tickets/t1/rastgele_alan", "x"), "ailelerin dışındaki alan reddedilir");
  assertDenied(as("u_service").write("/v2/tickets/t1/sla_x", "A".repeat(101)));
});

// ------------------------------------------------------ ticket_messages
test("[kritik] başka firmanın / yabancı hesabın ticket mesajlarını okuyamaz", () => {
  assertDenied(as("u_custB").read("/v2/ticket_messages/t1"));
  assertDenied(as("u_noprofile").read("/v2/ticket_messages/t1"));
  assertDenied(as("u_cust2").read("/v2/ticket_messages/t1"));
});

test("ticket sahibi ve personel mesajları okur", () => {
  assertAllowed(as("u_cust").read("/v2/ticket_messages/t1"));
  assertAllowed(as("u_cons").read("/v2/ticket_messages/t1"));
  assertAllowed(as("u_cons2").read("/v2/ticket_messages/t1"), "görme geniş: atanmamış danışman da okur");
  assertAllowed(as("u_root").read("/v2/ticket_messages/t1"));
});

test("mesajlar yalnızca eklenebilir: silinemez, düzenlenemez, konu tamamen silinemez", () => {
  assertDenied(as("u_cust").write("/v2/ticket_messages/t1", null), "konu silme");
  assertDenied(as("u_custB").write("/v2/ticket_messages/t1", null));
  assertDenied(as("u_cust").write("/v2/ticket_messages/t1/m1", null), "mesaj silme");
  assertDenied(as("u_cust").write("/v2/ticket_messages/t1/m1/message", "değiştirildi"), "mesaj düzenleme");
  assertDenied(as("u_cons").write("/v2/ticket_messages/t1/m2", null), "personel de silemez");
  assertAllowed(as("u_root").write("/v2/ticket_messages/t1/m2", null), "super_admin moderasyon");
});

test("müşteri kendi ticket'ına kendi adına mesaj ekleyebilir; başkasına ekleyemez", () => {
  const msg = message("u_cust", "m9");
  assertAllowed(as("u_cust").write("/v2/ticket_messages/t1/m9", msg));
  assertDenied(as("u_cust").write("/v2/ticket_messages/t10/m9", msg), "başkasının ticket'ı");
  assertDenied(as("u_cust").write("/v2/ticket_messages/t1/m9", { ...msg, user_id: "u_cons" }), "başkası adına");
  assertDenied(as("u_noprofile").write("/v2/ticket_messages/t1/m9", message("u_noprofile", "m9")));
});

test("[SEN-40/MUS-17] müşteri kapalı talebe mesaj/ek yazamaz; pending_close/resolved/açık talebe yazabilir", () => {
  assertDenied(as("u_cust").write("/v2/ticket_messages/t5/m9", message("u_cust", "m9")), "kapalı");
  assertDenied(as("u_cust").write("/v2/ticket_attachments/t5/a9", att("u_cust", { att_id: "a9" })), "kapalı");
  assertAllowed(as("u_cust").write("/v2/ticket_messages/t4/m9", message("u_cust", "m9")), "pending_close");
  assertAllowed(as("u_cust").write("/v2/ticket_messages/t7/m9", message("u_cust", "m9")), "resolved");
  assertAllowed(as("u_cust").write("/v2/ticket_messages/t3/m9", message("u_cust", "m9")), "waiting_customer");
  assertAllowed(as("u_service").write("/v2/ticket_messages/t5/m9", message("u_service", "m9")), "personel kapalı talebe yazabilir");
});

test("personel mesaj ve iç not ekler: yönetici her talebe, danışman yalnızca atandığına", () => {
  assertAllowed(as("u_service").write("/v2/ticket_messages/t10/m8", message("u_service", "m8")));
  assertAllowed(as("u_pm").write("/v2/ticket_internal_notes/t10/n8", message("u_pm", "n8", { is_internal: true })));
  assertAllowed(as("u_cons").write("/v2/ticket_messages/t1/m8", message("u_cons", "m8")));
  assertDenied(as("u_cons").write("/v2/ticket_messages/t10/m8", message("u_cons", "m8")));
});

// ------------------------------------------------- ticket_internal_notes
test("[kritik] iç notlar yalnızca personel tarafından okunur/yazılır; müşteri okuyamaz", () => {
  const note = message("u_cons", "n1", { is_internal: true });
  assertAllowed(as("u_cons").write("/v2/ticket_internal_notes/t1/n1", note));
  assertAllowed(as("u_pm").read("/v2/ticket_internal_notes/t1"));
  assertDenied(as("u_cust").read("/v2/ticket_internal_notes/t1"), "ticket sahibi müşteri iç notu okuyamaz");
  assertDenied(as("u_cust").write("/v2/ticket_internal_notes/t1/n2", message("u_cust", "n2")));
  assertDenied(as("u_noprofile").read("/v2/ticket_internal_notes/t1"));
});

test("iç notlar silinemez/düzenlenemez (super_admin hariç)", () => {
  assertDenied(as("u_cons").write("/v2/ticket_internal_notes/t1/n0", null));
  assertDenied(as("u_cons").write("/v2/ticket_internal_notes/t1", null));
  assertAllowed(as("u_root").write("/v2/ticket_internal_notes/t1/n0", null));
});

test("herkese açık mesaj düğümüne yeni iç not yazılamaz (eski istemciler sızıntı yapamaz)", () => {
  const msg = message("u_cons", "m7", { is_internal: true });
  assertDenied(as("u_cons").write("/v2/ticket_messages/t1/m7", msg));
  assertAllowed(as("u_cons").write("/v2/ticket_messages/t1/m7", { ...msg, is_internal: false }));
});

// ------------------------------------------------------- ticket_attachments
test("ek: ticket sahibi ve atanmış personel yükler; başkası yükleyemez/okuyamaz; liste okunamaz", () => {
  assertAllowed(as("u_cust").write("/v2/ticket_attachments/t1/a1x", att("u_cust", { att_id: "a1x" })));
  assertAllowed(as("u_cons").write("/v2/ticket_attachments/t1/a2", att("u_cons", { att_id: "a2" })));
  assertAllowed(as("u_service").write("/v2/ticket_attachments/t10/a2", att("u_service", { att_id: "a2" })));
  assertAllowed(as("u_cadmin").write("/v2/ticket_attachments/t1/a3", att("u_cadmin", { att_id: "a3" })));
  assertDenied(as("u_custB").write("/v2/ticket_attachments/t1/a4", att("u_custB", { att_id: "a4" })), "başka firma");
  assertDenied(as("u_noprofile").write("/v2/ticket_attachments/t1/a4", att("u_noprofile", { att_id: "a4" })));
  assertDenied(as("u_cust").write("/v2/ticket_attachments/t10/a4", att("u_cust", { att_id: "a4" })), "başkasının ticket'ı");
  assertDenied(as("u_cons2").write("/v2/ticket_attachments/t1/a4", att("u_cons2", { att_id: "a4" })), "atanmamış danışman");
  assertDenied(as("u_cust").read("/v2/ticket_attachments/t1"), "toplu okuma yok");
  assertDenied(as("u_cons").read("/v2/ticket_attachments/t1"), "personel de toplu okuyamaz (ek verisi büyük)");
});

test("ek: yalnızca kimliği bilinen ek, ticket tarafları ve personelce okunur; eklenemez/değiştirilemez", () => {
  assertAllowed(as("u_cust").read("/v2/ticket_attachments/t1/a1"));
  assertAllowed(as("u_cadmin").read("/v2/ticket_attachments/t1/a1"));
  assertAllowed(as("u_cons").read("/v2/ticket_attachments/t1/a1"));
  assertDenied(as("u_custB").read("/v2/ticket_attachments/t1/a1"));
  assertDenied(as("u_cust2").read("/v2/ticket_attachments/t1/a1"));
  assertDenied(as("u_cust").write("/v2/ticket_attachments/t1/a1", null), "silinemez");
  assertDenied(as("u_cust").write("/v2/ticket_attachments/t1/a1/data", "BBBB"), "değiştirilemez");
  assertAllowed(as("u_root").write("/v2/ticket_attachments/t1/a1", null), "super_admin moderasyon");
});

test("ek doğrulama: başkası adına, büyük, izin verilmeyen/joker tür ve tehlikeli ad reddedilir", () => {
  const w = (over, uid) => as("u_cust").write(`/v2/ticket_attachments/t1/${(over && over.att_id) || "a5"}`, att(uid || "u_cust", { att_id: "a5", ...over }));
  assertDenied(w({}, "u_cons"), "uploader_uid başkası");
  assertDenied(w({ data: "A".repeat(3000001), size: 2200000 }), "çok büyük veri");
  assertDenied(w({ size: 3000000 }), "çok büyük boyut");
  assertDenied(w({ type: "application/x-msdownload", name: "virus.exe" }), "exe");
  assertDenied(w({ type: "text/html", name: "x.html" }), "html");
  assertDenied(w({ type: "image/svg+xml", name: "x.svg" }), "svg");
  assertDenied(w({ type: "application/vnd.pwg-xhtml-print+xml", name: "x.xhtml" }), "vnd.* joker");
  assertDenied(w({ type: "application/vnd.microsoft.portable-executable", name: "x.exe" }), "portable-executable");
  assertDenied(w({ type: "application/pdf", name: "rapor.pdf.exe" }), "çift uzantı .exe");
  assertDenied(w({ data: "<html><script>alert(1)</script>", size: 1 }), "size yalan, data size ile uyumsuz");
  assertDenied(w({ extra: "A".repeat(1000) }), "ek alan");
  assertAllowed(w({ type: "application/pdf", name: "rapor.pdf" }));
  assertAllowed(w({ att_id: "a6", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "tablo.xlsx" }));
  assertAllowed(w({ type: "application/vnd.ms-excel", name: "eski.xls" }));
});

test("[kritik] iç not ekleri yalnızca personelce okunur/yazılır (yazma: atanmış danışman/yönetici)", () => {
  assertAllowed(as("u_cons").write("/v2/ticket_internal_attachments/t1/i2", att("u_cons", { att_id: "i2" })));
  assertDenied(as("u_cons2").write("/v2/ticket_internal_attachments/t1/i3", att("u_cons2", { att_id: "i3" })));
  assertDenied(as("u_cust").write("/v2/ticket_internal_attachments/t1/i2", att("u_cust", { att_id: "i2" })));
  assertAllowed(as("u_cons").read("/v2/ticket_internal_attachments/t1/i1"));
  assertDenied(as("u_cust").read("/v2/ticket_internal_attachments/t1/i1"));
  assertDenied(as("u_cadmin").read("/v2/ticket_internal_attachments/t1/i1"));
});

// ------------------------------------------------------- ticket_history
test("[kritik] geçmiş kayıtları yalnızca muhataplarca okunur ve yalnızca eklenir", () => {
  assertDenied(as("u_custB").read("/v2/ticket_history/t1"));
  assertAllowed(as("u_cust").read("/v2/ticket_history/t1"));
  assertDenied(as("u_cust").write("/v2/ticket_history/t1", null), "geçmişi silme");
  assertDenied(as("u_cust").write("/v2/ticket_history/t1/h1", null));
  assertDenied(as("u_custB").write("/v2/ticket_history/t1/h2", historyEntry("u_custB", "h2")), "başkasının ticket'ına geçmiş yazma");
  assertAllowed(as("u_cust").write("/v2/ticket_history/t1/h2", historyEntry("u_cust", "h2", { action: "created" })));
  assertAllowed(as("u_service").write("/v2/ticket_history/t10/h2", historyEntry("u_service", "h2")));
});

// -------------------------------------------- assignments / efforts / vb.
test("atamalar: müşteri yalnızca kendi ticket'ınınkini okur, yazamaz; yazma yalnızca yöneticilerde", () => {
  assertAllowed(as("u_cust").read("/v2/ticket_assignments/t1"));
  assertDenied(as("u_custB").read("/v2/ticket_assignments/t1"));
  assertDenied(as("u_cust").write("/v2/ticket_assignments/t1/p9", { personnel_id: "p9" }));
  assertAllowed(as("u_service").write("/v2/ticket_assignments/t1/p9", { personnel_id: "p9", personnel_email: "p9@parla-demo.com", is_primary: false }));
  assertDenied(as("u_service").write("/v2/ticket_assignments/t1/p9", { personnel_id: "p8" }), "anahtar ile personnel_id aynı olmalı");
  assertAllowed(as("u_pm").read("/v2/ticket_assignments"));
});

test("eforlar yalnızca personelce okunur; yazma yönetici/atanmış danışman", () => {
  assertDenied(as("u_cust").read("/v2/ticket_efforts/t1"));
  assertAllowed(as("u_cons").read("/v2/ticket_efforts/t1"));
  assertAllowed(as("u_cons").write("/v2/ticket_efforts/t1/e2", effort("u_cons", "e2")));
  assertDenied(as("u_cust").write("/v2/ticket_efforts/t1/e2", effort("u_cust", "e2")));
  assertDenied(as("u_cons").write("/v2/ticket_efforts/t1/e2", effort("u_cons", "e2", { hours: "<img src=x onerror=alert(1)>" })));
});

test("[D-08] sözleşme bedelleri contract_values düğümünde: yalnızca yönetici roller (super/service) okur/yazar; contracts altına bedel yazılamaz", () => {
  for (const u of ["u_cust", "u_noprofile", "u_arizi", "u_pm", "u_cons", "u_cons2", "u_inact_svc", "u_cadmin"]) {
    assertDenied(as(u).read("/v2/contract_values"), `${u} bedel listesi`);
    assertDenied(as(u).read("/v2/contract_values/k1"), `${u} bedel`);
    assertDenied(as(u).read("/v2/contract_values/k1/value"), `${u} bedel değeri`);
    assertDenied(as(u).write("/v2/contract_values/k1", { value: 1 }), `${u} bedel yazma`);
  }
  for (const u of ["u_root", "u_service"]) {
    assertAllowed(as(u).read("/v2/contract_values"));
    assertAllowed(as(u).read("/v2/contract_values/k1/value"));
    assertAllowed(as(u).write("/v2/contract_values/k2", { value: 5000, currency: "TRY" }));
  }
  assertDenied(as("u_service").write("/v2/contract_values/k2", { value: "<img onerror=alert(1)>" }), "bedel sayı olmalı");
  assertDenied(as("u_service").write("/v2/contract_values/k2", { value: -5 }));
  assertDenied(as("u_service").write("/v2/contract_values/k2", { value: 5, currency: "turk lirası" }));
  // sözleşme meta verisi personele açık; bedel alanı artık contracts altına yazılamaz
  for (const u of ["u_root", "u_service", "u_pm", "u_cons"]) assertAllowed(as(u).read("/v2/contracts"), `${u} sözleşme listesi (bedelsiz)`);
  for (const u of ["u_cust", "u_noprofile", "u_arizi"]) assertDenied(as(u).read("/v2/contracts"));
  assertAllowed(as("u_service").write("/v2/contracts/k2", { status: "active", company_id: "cA" }));
  assertDenied(as("u_service").write("/v2/contracts/k2", { status: "active", value: 5000 }), "bedel contracts altına yazılamaz");
  assertDenied(as("u_service").write("/v2/contracts/k2/value", 5000));
  assertAllowed(as("u_service").write("/v2/contracts/k1/value", null), "eski bedel alanı temizlenebilir (göç)");
  assertDenied(as("u_pm").write("/v2/contracts/k2", { status: "active" }));
});

test("[kritik] proje/personel/firma listesi müşteri ve yabancı hesaplara kapalı", () => {
  for (const u of ["u_cust", "u_noprofile", "u_arizi"]) {
    assertDenied(as(u).read("/v2/projects"));
    assertDenied(as(u).read("/v2/personnel"));
    assertDenied(as(u).read("/v2/companies"));
  }
  for (const u of ["u_root", "u_service", "u_pm", "u_cons"]) {
    assertAllowed(as(u).read("/v2/projects"));
    assertAllowed(as(u).read("/v2/personnel"));
    assertAllowed(as(u).read("/v2/companies"));
  }
});

test("müşteri yalnızca kendi firmasının kaydını okur", () => {
  assertAllowed(as("u_cust").read("/v2/companies/cA"));
  assertDenied(as("u_cust").read("/v2/companies/cB"));
  assertDenied(as("u_noprofile").read("/v2/companies/cA"));
  assertDenied(as("u_inact_cust").read("/v2/companies/cA"));
});

test("yazma yetkileri korunur: firma/personel admin, sözleşme admin, proje PM'e de açık", () => {
  assertAllowed(as("u_service").write("/v2/companies/cC", { name: "C" }));
  assertDenied(as("u_cons").write("/v2/companies/cC", { name: "C" }));
  assertAllowed(as("u_pm").write("/v2/projects/pr2", { status: "planning" }));
  assertDenied(as("u_pm").write("/v2/contracts/k2", { status: "active" }));
  assertDenied(as("u_cons").write("/v2/projects/pr2", { status: "planning" }));
  assertAllowed(as("u_service").write("/v2/personnel/p2", { email: "p2@parla.com" }));
  assertDenied(as("u_cust").write("/v2/personnel/p2", { email: "p2@parla.com" }));
  assertAllowed(as("u_root").write("/v2/departments/d2", { name: "D2" }));
  assertDenied(as("u_service").write("/v2/departments/d2", { name: "D2" }));
});

// ------------------------------------------- activities/counters/notifs/yeni düğümler
test("[kritik] aktivite kayıtları silinemez/ezilemez; yalnızca eklenir ve kendi kimliğiyle", () => {
  assertDenied(as("u_cust").write("/v2/activities", null), "tüm aktiviteleri silme");
  assertDenied(as("u_noprofile").write("/v2/activities", null));
  assertDenied(as("u_cust").write("/v2/activities/a1", null));
  assertDenied(as("u_cust").write("/v2/activities/a1/action", "x"));
  assertAllowed(as("u_cust").write("/v2/activities/a2", activity("u_cust", "a2")));
  assertDenied(as("u_cust").write("/v2/activities/a2", activity("u_root", "a2")), "user_uid taklidi");
  assertDenied(as("u_noprofile").write("/v2/activities/a9", activity("u_noprofile", "a9")), "profilsiz hesap");
  assertAllowed(as("u_cons").write("/v2/activities/a3", activity("u_cons", "a3", { action: "ticket_updated" })));
});

test("aktiviteleri yalnızca personel okur", () => {
  assertDenied(as("u_cust").read("/v2/activities"));
  assertAllowed(as("u_cons").read("/v2/activities"));
});

test("sayaç: yalnızca +1 artış (ADMIN hariç); azaltma/atlatma/sıfırlama reddedilir; counters.read profil gerektirir", () => {
  assertAllowed(as("u_cust").write("/v2/counters/SUP/ORN/2610", 13));
  assertAllowed(as("u_cust").write("/v2/counters/SUP/ORN/2611", 1), "yeni ay: 1'den başlar");
  assertDenied(as("u_cust").write("/v2/counters/SUP/ORN/2610", 1), "sıfırlama");
  assertDenied(as("u_cust").write("/v2/counters/SUP/ORN/2610", 99999), "atlatma");
  assertDenied(as("u_cust").write("/v2/counters/SUP/ORN/2610", 12), "aynı değer");
  assertDenied(as("u_cust").write("/v2/counters/SUP/ORN/2610", 13.5));
  assertDenied(as("u_cust").write("/v2/counters/SUP/ORN/2610", "abc"));
  assertDenied(as("u_cust").write("/v2/counters/SUP/YENI/2610", 1), "başka müşteri kodu için sayaç açamaz");
  assertDenied(as("u_cust").write("/v2/counters/SUP/DMR/2610", 11), "başka firmanın sayacı");
  assertDenied(as("u_cust").write("/v2/counters/INT/ORN/2610", 1), "müşteri INT numarası üretemez");
  assertDenied(as("u_cust").write("/v2/counters", null), "sayaçları toptan silme");
  assertDenied(as("u_noprofile").write("/v2/counters/SUP/ORN/2610", 13));
  assertAllowed(as("u_cons").write("/v2/counters/INT/ORN/2610", 1), "personel her müşteri kodu için üretir");
  assertAllowed(as("u_service").write("/v2/counters/SUP/ORN/2610", 500), "ADMIN düzeltebilir (bakım)");
  assertDenied(as("u_pm").write("/v2/counters/SUP/ORN/2610", 500), "PM +1 dışına çıkamaz");
  assertAllowed(as("u_cust").read("/v2/counters"));
  assertDenied(as("u_noprofile").read("/v2/counters"));
});

test("[SEC-37] bildirimler düğümü kapalı (okuma/yazma kimseye açık değil)", () => {
  for (const u of ["u_cust", "u_cons", "u_root", "u_service"]) {
    assertDenied(as(u).read("/v2/notifications/u_cust"));
    assertDenied(as(u).write("/v2/notifications/u_cust/n2", { title: "x" }));
  }
});

test("[WP-16] reply_templates: okuma personel, yazma yalnızca yönetici (super/service); doğrulamalı", () => {
  const tpl = { template_id: "rt2", title: "Kapanış", body: "Talebiniz çözüldü {talep_no}", category: "kapanis", is_active: true, created_at: ISO, created_by: "u_service" };
  for (const u of ["u_root", "u_service", "u_pm", "u_cons"]) assertAllowed(as(u).read("/v2/reply_templates"), u);
  for (const u of ["u_cust", "u_cadmin", "u_noprofile", "u_inact_cons"]) assertDenied(as(u).read("/v2/reply_templates"), u);
  assertAllowed(as("u_service").write("/v2/reply_templates/rt2", tpl));
  assertAllowed(as("u_root").write("/v2/reply_templates/rt1", null));
  for (const u of ["u_pm", "u_cons", "u_cust"]) assertDenied(as(u).write("/v2/reply_templates/rt2", tpl), `${u} yazamaz`);
  assertDenied(as("u_service").write("/v2/reply_templates/rt2", { ...tpl, body: "A".repeat(10001) }));
  assertDenied(as("u_service").write("/v2/reply_templates/rt2", { title: "başlıksız gövde yok" }));
  assertDenied(as("u_service").write("/v2/reply_templates/rt2", { ...tpl, ekstra: "x" }));
});

test("[WP-03] system_state ve ops düğümleri yalnızca sunucuya açık (istemciye kapalı)", () => {
  for (const u of ["u_root", "u_service", "u_cust", "u_cons"]) {
    for (const n of ["system_state", "ops"]) {
      assertDenied(as(u).read(`/v2/${n}`), `${u} ${n} okuyamaz`);
      assertDenied(as(u).write(`/v2/${n}/x`, { a: 1 }), `${u} ${n} yazamaz`);
    }
  }
});

test("kök seviyede hiçbir şey okunamaz/yazılamaz; tanımsız düğümler kapalı", () => {
  assertDenied(as("u_root").read("/"));
  assertDenied(as("u_root").write("/x", 1));
  assertDenied(as(null).read("/v2/tickets/t1"));
  assertDenied(as("u_root").write("/v2/bilinmeyen/x", 1));
  assertDenied(as("u_root").read("/v2/bilinmeyen"));
});

test("kural ifadelerinin hiçbiri 8000 karakteri aşmaz (Realtime Database güvenli sınırı) ve dosya < 256 KB", () => {
  let max = 0;
  let where = "";
  (function walk(o, p) {
    for (const k of Object.keys(o)) {
      const val = o[k];
      if (typeof val === "string") {
        if (val.length > max) {
          max = val.length;
          where = `${p}/${k}`;
        }
      } else if (val && typeof val === "object") walk(val, `${p}/${k}`);
    }
  })(rules, "");
  assert.ok(max < 8000, `en uzun ifade ${max} karakter: ${where}`);
  const size = require("node:fs").statSync(path.join(__dirname, "..", "..", "database.rules.json")).size;
  assert.ok(size < 256 * 1024, `kural dosyası ${size} bayt`);
});

test("database.rules.json, generate-rules.js çıktısıyla birebir aynı (JSON'u elle düzenlemeyin)", () => {
  const { output } = require("./generate-rules.js");
  const onDisk = require("node:fs").readFileSync(path.join(__dirname, "..", "..", "database.rules.json"), "utf8");
  assert.equal(onDisk, output, "node tests/rules/generate-rules.js çalıştırıp çıktıyı commit edin");
});
