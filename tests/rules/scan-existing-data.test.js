/**
 * scan-existing-data.cjs testleri: eski (canlı) kayıtlar için yeni .validate sınıflandırması ve salt-okunur davranış.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const H = require("./helpers.js");
const { scan, formatReport, exitCode } = require("./scan-existing-data.cjs");

const SCRIPT = path.join(__dirname, "scan-existing-data.cjs");
const codes = (r, cls) => r.findings.filter((f) => f.cls === cls).map((f) => `${f.code}@${f.where}`);
const has = (r, cls, code, where) => r.findings.some((f) => f.cls === cls && f.code === code && (!where || f.where === where));

function dirtyExport() {
  const d = H.buildData();
  const v2 = d.v2;
  // ENGEL: talep üst düğüm validate'ini geçmiyor
  v2.tickets.bad_id = H.ticket("bad_id", { id: "t10" });
  v2.tickets.bad_missing = (({ ticket_type, ...rest }) => rest)(H.ticket("bad_missing"));
  v2.tickets.bad_ticketid = H.ticket("bad_ticketid", { ticket_id: "baska" });
  // KAYIT: yalnızca alan düzeyi ihlaller (talep yine güncellenebilir)
  v2.tickets.old_prio = H.ticket("old_prio", { priority: "urgent", title: "x".repeat(250), foo_legacy: "x" });
  // GÖÇ: atanmış danışman (personel e-postası -> kullanıcı), closed_at_ms yok
  v2.ticket_assignments.old_prio = { p1: { personnel_id: "p1", personnel_name: "P1", personnel_email: "cons@parla-demo.com", is_primary: true } };
  v2.contracts.k7 = { contract_id: "k7", company_id: "cA", value: 1234, status: "active" };
  // mesaj / not / geçmiş / aktivite / sayaç
  v2.ticket_messages.t1.mm = { message_id: "baska", user_id: "u_cust", author_role: "customer", author_email: "cust@ornek-a.com", message: "x", created_at: H.ISO, is_internal: true };
  v2.ticket_history.t1.hh = { history_id: "hh", action: 5, field_changed: 7, changed_by_uid: "u_cust", changed_at: H.ISO };
  v2.activities.az = { activity_id: "az", action: 123, details: 456, user_uid: "u_cust", created_at: H.ISO };
  v2.counters.SUP["ÖRN"] = { 2610: 3 };
  v2.ticket_messages.t_yok = { m1: H.message("u_cust", "m1") };
  v2.users.u_bad = { role: "hacker", last_login_at: "x".repeat(50) };
  return d;
}

test("temiz örnek veri: ENGEL ve KAYIT yok (yalnızca GÖÇ/BİLGİ olabilir)", () => {
  const r = scan(H.buildData(), {});
  assert.equal(r.byClass.ENGEL || 0, 0, JSON.stringify(r.findings.filter((f) => f.cls === "ENGEL")));
  assert.equal(r.byClass.KAYIT || 0, 0, JSON.stringify(r.findings.filter((f) => f.cls === "KAYIT")));
  assert.ok(exitCode(r) <= 1);
});

test("kirli veri: her ihlal doğru sınıfta raporlanır", () => {
  const r = scan(dirtyExport(), {});
  // ENGEL
  assert.ok(has(r, "ENGEL", "ticket-güncellenemez", "tickets/bad_id"), "id alanlı talep güncellenemez");
  assert.ok(has(r, "ENGEL", "ticket-güncellenemez", "tickets/bad_missing"), "zorunlu alanı eksik talep güncellenemez");
  assert.ok(has(r, "ENGEL", "ticket-güncellenemez", "tickets/bad_ticketid"), "ticket_id ≠ anahtar talep güncellenemez");
  assert.ok(has(r, "ENGEL", "sayaç-artırılamaz", "counters/SUP/ÖRN/2610"), "biçimsiz müşteri kodlu sayaç artırılamaz");
  assert.ok(!has(r, "ENGEL", "ticket-güncellenemez", "tickets/old_prio"), "yalnızca alan ihlali olan talep güncellenebilir");
  assert.ok(!has(r, "ENGEL", "ticket-güncellenemez", "tickets/t1"));
  // KAYIT
  assert.ok(has(r, "KAYIT", "ticket-validate", "tickets/old_prio/priority"), "geçersiz öncelik");
  assert.ok(has(r, "KAYIT", "ticket-validate", "tickets/old_prio/title"), "uzun başlık");
  assert.ok(has(r, "KAYIT", "ticket-validate", "tickets/old_prio/foo_legacy"), "izinli listede olmayan alan");
  assert.ok(has(r, "KAYIT", "SEC-07-id-alanı", "tickets/bad_id/id"));
  assert.ok(has(r, "KAYIT", "SEC-08-message_id", "ticket_messages/t1/mm"));
  assert.ok(codes(r, "KAYIT").some((c) => c.startsWith("geçmiş-validate@ticket_history/t1/hh")), "geçmişte sayı action");
  assert.ok(codes(r, "KAYIT").some((c) => c.startsWith("aktivite-validate@activities/az")), "aktivitede sayı action");
  assert.ok(has(r, "KAYIT", "geçersiz-rol", "users/u_bad/role"));
  assert.ok(has(r, "KAYIT", "kullanıcı-damga", "users/u_bad/last_login_at"));
  // GÖÇ
  assert.ok(has(r, "GÖÇ", "sözleşme-bedeli", "contracts/k7/value"));
  assert.ok(has(r, "GÖÇ", "closed_at_ms", "tickets/t13"));
  assert.ok(has(r, "GÖÇ", "assigned_uids"), "assigned_uids göçü");
  // BİLGİ
  assert.ok(has(r, "BİLGİ", "yetim-kayıt", "ticket_messages/t_yok"));
  assert.ok(has(r, "BİLGİ", "iç-not-herkese-açık-düğümde", "ticket_messages/t1/mm"));
  assert.equal(exitCode(r), 2);
});

test("göç dosyası: assigned_uids (e-posta eşleşmesi), closed_at_ms ve contract_values üretilir", () => {
  const r = scan(dirtyExport(), {});
  assert.equal(r.backfill["tickets/old_prio/assigned_uids/u_cons"], true);
  assert.equal(r.backfill["tickets/t13/closed_at_ms"], Date.parse(dirtyExport().v2.tickets.t13.closed_at));
  assert.equal(r.backfill["contract_values/k7/value"], 1234);
  assert.equal(r.backfill["contracts/k7/value"], null);
  assert.ok(!("tickets/t1/assigned_uids/u_cons" in r.backfill), "zaten atanmış talepler için göç gerekmez");
});

test("tarayıcı girdiyi DEĞİŞTİRMEZ (salt-okunur)", () => {
  const d = dirtyExport();
  const before = JSON.stringify(d);
  scan(d, {});
  assert.equal(JSON.stringify(d), before);
});

test("Console dışa aktarım biçimi: kök {v2:{...}} ve yalnız v2 düğümü ikisi de okunur", () => {
  const d = dirtyExport();
  const a = scan(d, {});
  const b = scan(d.v2, {});
  assert.deepEqual(a.byCode, b.byCode);
});

test("CLI: dosyadan okur, rapor basar, çıkış kodu 2 (ENGEL); --emit-backfill/--json yerel dosyaya yazar; girdinin üzerine yazmaz", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parla-scan-"));
  const input = path.join(dir, "export.json");
  fs.writeFileSync(input, JSON.stringify(dirtyExport()));
  const out = spawnSync(process.execPath, [SCRIPT, input, "--emit-backfill", path.join(dir, "goc.json"), "--json", path.join(dir, "rapor.json"), "--max", "2"], { encoding: "utf8" });
  assert.equal(out.status, 2, out.stdout + out.stderr);
  assert.match(out.stdout, /ENGEL/);
  assert.match(out.stdout, /KURALLARI DAĞITMAYIN/);
  assert.ok(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, "goc.json"), "utf8"))).length > 0);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "rapor.json"), "utf8")).findings.length > 0);
  const refuse = spawnSync(process.execPath, [SCRIPT, input, "--json", input], { encoding: "utf8" });
  assert.equal(refuse.status, 64);
  assert.equal(JSON.parse(fs.readFileSync(input, "utf8")).v2.tickets.t1.ticket_id, "t1", "girdi bozulmadı");
  const clean = path.join(dir, "clean.json");
  fs.writeFileSync(clean, JSON.stringify(H.buildData()));
  assert.ok([0, 1].includes(spawnSync(process.execPath, [SCRIPT, clean], { encoding: "utf8" }).status));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rapor metni Türkçe özet ve sonuç satırı içerir", () => {
  const text = formatReport(scan(dirtyExport(), {}), { max: 1 });
  assert.match(text, /ÖZET\s+ENGEL: \d+ · GÖÇ: \d+ · KAYIT: \d+ · BİLGİ: \d+/);
  assert.match(text, /SONUÇ:/);
});
