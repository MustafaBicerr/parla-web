/**
 * WP-09 / WP-10 / WP-13 / WP-16 birim testleri: sözleşme etkin durumu, doğrulamalar, denormalize kopya yayma planları,
 * hazır yanıt şablonu değişkenleri, toplu işlem planları, rapor aralığı, liste yardımcıları.
 * Çalıştırma: node --test tests/unit/entity-utils.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDateOnly,
  isValidDateOnly,
  addMonthsClamped,
  contractDaysRemaining,
  effectiveContractStatus,
  contractBadgeClass,
  summarizeContracts,
  companiesWithActiveContract,
  validateContractInput,
  projectBadgeClass,
  validateProjectInput,
  cleanManagerName,
  selectableCompanies,
  selectableDepartments,
  isDuplicateName,
  validateReferenceCode,
  planCompanyCopies,
  planPersonnelCopies,
  planDepartmentCopies,
  planUserNameCopies,
  chunkPaths,
  renderReplyTemplate,
  validateTemplateInput,
  sortTemplates,
  needsAssignee,
  ticketAssigneeIds,
  resolveReportRange,
  canBulkOperate,
  planBulkStatus,
  planBulkAssign,
  describeSkipped,
  BULK_NOTIFY_STATUSES,
} from "../../assets/js/support-v2/entity-utils.js";
import { sortRows, paginateRows, nextSort, compareValues, debounce } from "../../assets/js/support-v2/table-utils.js";
import { formatDate, formatDateTime } from "../../assets/js/support-v2/ticket-utils.js";

const NOW = new Date(2026, 9, 7, 12, 0, 0); // 7 Ekim 2026 (yerel)

/* ------------------------------------------------------------------ tarih */
test("parseDateOnly / isValidDateOnly: gerçek gün ve 2000–2100 aralığı", () => {
  assert.ok(parseDateOnly("2026-02-28"));
  assert.equal(parseDateOnly("2026-02-30"), null);
  assert.equal(parseDateOnly("26-02-28"), null);
  assert.equal(isValidDateOnly("0002-01-01"), false);
  assert.equal(isValidDateOnly("2101-01-01"), false);
  assert.equal(isValidDateOnly("2026-10-07"), true);
});

test("addMonthsClamped: ay sonunda taşmaz", () => {
  const d = addMonthsClamped(new Date(2026, 4, 31), -3); // 31 Mayıs - 3 ay
  assert.equal(d.getMonth(), 1); // Şubat
  assert.equal(d.getDate(), 28);
  const e = addMonthsClamped(new Date(2026, 0, 15), 1);
  assert.equal(e.getMonth(), 1);
  assert.equal(e.getDate(), 15);
});

/* ------------------------------------------------------------------ sözleşme etkin durumu */
test("effectiveContractStatus: tek yardımcı — aktif / süresi dolmuş / beklemede / iptal / başlamamış", () => {
  const base = { start_date: "2026-01-01", end_date: "2026-12-31", status: "active" };
  assert.equal(effectiveContractStatus(base, NOW), "active");
  assert.equal(effectiveContractStatus({ ...base, end_date: "2024-12-31" }, NOW), "expired");
  assert.equal(effectiveContractStatus({ ...base, status: "expired" }, NOW), "expired");
  assert.equal(effectiveContractStatus({ ...base, status: "cancelled" }, NOW), "cancelled");
  assert.equal(effectiveContractStatus({ ...base, status: "pending" }, NOW), "pending");
  assert.equal(effectiveContractStatus({ ...base, start_date: "2026-11-01" }, NOW), "pending");
  // bugün biten sözleşme hâlâ aktiftir (kalan gün 0)
  assert.equal(effectiveContractStatus({ ...base, end_date: "2026-10-07" }, NOW), "active");
  assert.equal(contractDaysRemaining("2026-10-07", NOW), 0);
  assert.equal(contractDaysRemaining("2026-10-06", NOW), -1);
  assert.equal(contractDaysRemaining("", NOW), null);
});

test("contractBadgeClass yalnız mevcut CSS sınıflarını döner (UX-24)", () => {
  const known = ["sv2-badge-resolved", "sv2-badge-closed", "sv2-badge-in_progress", "sv2-badge-priority-critical"];
  for (const s of ["active", "expired", "pending", "cancelled", "bilinmeyen"]) assert.ok(known.includes(contractBadgeClass(s)), s);
  const projectKnown = ["sv2-badge-resolved", "sv2-badge-assigned", "sv2-badge-in_progress", "sv2-badge-open", "sv2-badge-priority-critical", "sv2-badge-closed"];
  for (const s of ["planning", "active", "on_hold", "completed", "cancelled", "x"]) assert.ok(projectKnown.includes(projectBadgeClass(s)), s);
});

test("summarizeContracts / companiesWithActiveContract: has_contract sözleşmelerden türer", () => {
  const contracts = [
    { id: "k1", company_id: "cA", status: "active", start_date: "2026-01-01", end_date: "2026-12-31" },
    { id: "k2", company_id: "cA", status: "active", start_date: "2020-01-01", end_date: "2021-12-31" },
    { id: "k3", company_id: "cB", status: "cancelled", start_date: "2026-01-01", end_date: "2026-12-31" },
    { id: "k4", company_id: "cC", status: "active", start_date: "2024-01-01", end_date: "2024-12-31" },
  ];
  const a = summarizeContracts(contracts.filter((c) => c.company_id === "cA"), NOW);
  assert.deepEqual([a.total, a.active, a.expired, a.hasActive, a.activeContractId], [2, 1, 1, true, "k1"]);
  const set = companiesWithActiveContract(contracts, NOW);
  assert.deepEqual([...set], ["cA"]); // cB iptal, cC süresi dolmuş: "Sözleşmeli" değil
});

/* ------------------------------------------------------------------ sözleşme doğrulama */
test("validateContractInput: benzersiz no, değer ≥ 0 (0 geçerli), tarih sınırları, çakışma uyarısı", () => {
  const existing = [{ id: "k1", contract_number: "SZL-2026-001", company_id: "cA", status: "active", start_date: "2026-01-01", end_date: "2026-12-31" }];
  const ok = { contract_number: "SZL-2026-002", company_id: "cB", start_date: "2026-01-01", end_date: "2026-12-31", value: "0" };
  const r = validateContractInput(ok, existing, "", NOW);
  assert.equal(r.valid, true);
  assert.equal(r.value, 0, "0 değeri null olmaz");

  assert.ok(validateContractInput({ ...ok, contract_number: " szl-2026-001 " }, existing, "", NOW).errors.number, "yinelenen no");
  assert.equal(validateContractInput({ ...ok, contract_number: "SZL-2026-001" }, existing, "k1", NOW).valid, true, "kendi numarası düzenlemede serbest");
  assert.ok(validateContractInput({ ...ok, value: "-500" }, existing, "", NOW).errors.value, "negatif değer");
  assert.ok(validateContractInput({ ...ok, value: "abc" }, existing, "", NOW).errors.value);
  assert.equal(validateContractInput({ ...ok, value: "" }, existing, "", NOW).value, null);
  assert.ok(validateContractInput({ ...ok, start_date: "0002-01-01" }, existing, "", NOW).errors.start);
  assert.ok(validateContractInput({ ...ok, end_date: "2025-12-31" }, existing, "", NOW).errors.end, "bitiş < başlangıç");
  assert.ok(validateContractInput({ ...ok, company_id: "" }, existing, "", NOW).errors.company);

  const overlap = validateContractInput({ ...ok, company_id: "cA", contract_number: "SZL-2026-003" }, existing, "", NOW);
  assert.equal(overlap.valid, true);
  assert.equal(overlap.warnings.length, 1, "aynı firmada çakışan etkin sözleşme uyarısı");
});

test("validateProjectInput / cleanManagerName", () => {
  assert.ok(validateProjectInput({ name: "", company_id: "cA" }).errors.name);
  assert.ok(validateProjectInput({ name: "P", company_id: "" }).errors.company);
  const r = validateProjectInput({ name: "P", company_id: "cA", start_date: "2026-09-01", end_date: "2026-01-01" });
  assert.ok(r.errors.end, "bitiş < başlangıç");
  assert.equal(validateProjectInput({ name: "P", company_id: "cA" }).valid, true);
  assert.equal(cleanManagerName("Seçiniz"), "");
  assert.equal(cleanManagerName("—"), "");
  assert.equal(cleanManagerName("Burak Şahin"), "Burak Şahin");
});

/* ------------------------------------------------------------------ seçici listeleri */
test("selectableCompanies: pasif firma yalnız mevcut seçim olarak '(pasif)' etiketiyle (YON-10/11)", () => {
  const companies = [
    { id: "a", name: "Zeta A.Ş.", is_active: true },
    { id: "b", name: "Alfa Ltd.", is_active: false },
    { id: "c", name: "Beta" },
  ];
  assert.deepEqual(selectableCompanies(companies, "").map((o) => o.id), ["c", "a"]);
  const withSelected = selectableCompanies(companies, "b");
  assert.deepEqual(withSelected.map((o) => o.label), ["Alfa Ltd. (pasif)", "Beta", "Zeta A.Ş."]);
  assert.deepEqual(selectableDepartments([{ id: "d1", name: "X", is_active: false }, { id: "d2", name: "Y" }], "").map((o) => o.id), ["d2"]);
});

test("isDuplicateName: büyük/küçük harf ve Türkçe karakter duyarsız", () => {
  const depts = [{ id: "d1", name: "SAP Danışmanlık" }];
  assert.equal(isDuplicateName(depts, "sap danismanlik", ""), true);
  assert.equal(isDuplicateName(depts, "SAP  Danışmanlık", ""), true);
  assert.equal(isDuplicateName(depts, "SAP Danışmanlık", "d1"), false, "kendisi hariç");
  assert.equal(isDuplicateName(depts, "Yeni", ""), false);
});

test("validateReferenceCode: yalnız A–Z 0–9 _", () => {
  assert.equal(validateReferenceCode("fi").code, "FI");
  assert.equal(validateReferenceCode("A/B").valid, false);
  assert.equal(validateReferenceCode("A.B").valid, false);
  assert.equal(validateReferenceCode("K L").valid, false);
  assert.equal(validateReferenceCode("ışık").valid, false);
  assert.equal(validateReferenceCode("").valid, false);
  assert.equal(validateReferenceCode("X".repeat(21)).valid, false);
  assert.equal(validateReferenceCode("BASIS_2").valid, true);
});

/* ------------------------------------------------------------------ denormalize kopyalar */
test("planCompanyCopies: yalnız farklı kopyalar yazılır, talep numarası ASLA değişmez, ikinci çalıştırma boş", () => {
  const company = { id: "cA", name: "YENİ AD A.Ş.", customer_code: "new0001" };
  const related = {
    users: [
      { uid: "u1", company_name: "Eski Ad", customer_code: "ORN" },
      { uid: "u2", company_name: "YENİ AD A.Ş.", customer_code: "NEW0001" },
    ],
    tickets: [{ ticket_id: "t1", ticket_number: "SUP-ORN-FI-2610-0001", company_name: "Eski Ad", customer_code: "ORN" }],
    contracts: [{ id: "k1", company_name: "Eski Ad" }],
    projects: [{ id: "p1", company_name: "", customer_code: "ORN" }],
  };
  const paths = planCompanyCopies(company, related);
  assert.deepEqual(Object.keys(paths).sort(), [
    "contracts/k1/company_name",
    "projects/p1/company_name",
    "projects/p1/customer_code",
    "tickets/t1/company_name",
    "tickets/t1/customer_code",
    "users/u1/company_name",
    "users/u1/customer_code",
  ]);
  assert.equal(paths["users/u1/customer_code"], "NEW0001");
  assert.ok(!Object.keys(paths).some((k) => k.includes("ticket_number")));
  // idempotent: kopyalar eşitlendikten sonra yazılacak yol kalmaz
  const synced = {
    users: related.users.map((u) => ({ ...u, company_name: "YENİ AD A.Ş.", customer_code: "NEW0001" })),
    tickets: related.tickets.map((t) => ({ ...t, company_name: "YENİ AD A.Ş.", customer_code: "NEW0001" })),
    contracts: [{ id: "k1", company_name: "YENİ AD A.Ş." }],
    projects: [{ id: "p1", company_name: "YENİ AD A.Ş.", customer_code: "NEW0001" }],
  };
  assert.deepEqual(planCompanyCopies(company, synced), {});
});

test("planPersonnelCopies: e-posta/ad yayılır; pasife alınca e-posta boşalır, aktifleşince geri döner (YON-04)", () => {
  const assignments = {
    t1: [{ personnel_id: "p1", personnel_name: "Eski Ad", personnel_email: "eski@parla-demo.com" }, { personnel_id: "p2", personnel_name: "Can", personnel_email: "can@parla-demo.com" }],
    t2: [{ personnel_id: "p2", personnel_name: "Can", personnel_email: "can@parla-demo.com" }],
  };
  const tickets = [{ ticket_id: "t1", assigned_to_id: "p1", assigned_to_name: "Eski Ad" }, { ticket_id: "t2", assigned_to_id: "p2", assigned_to_name: "Can" }];
  const projects = [
    { id: "pr1", manager_personnel_id: "p1", manager_name: "Eski Ad", assigned_personnel: { p1: { id: "p1", name: "Eski Ad" } } },
    { id: "pr2", manager_uid: "p1", manager_name: "Eski Ad" }, // eski kayıt: manager_uid personel kimliği
    { id: "pr3", manager_personnel_id: "p2", manager_name: "Can" },
  ];
  const person = { personnel_id: "p1", first_name: "Zeynep", last_name: "Arslan", email: "Zeynep.Yeni@parla-demo.com", is_active: true };
  const paths = planPersonnelCopies(person, { assignments, tickets, projects });
  assert.equal(paths["ticket_assignments/t1/p1/personnel_email"], "zeynep.yeni@parla-demo.com");
  assert.equal(paths["ticket_assignments/t1/p1/personnel_name"], "Zeynep Arslan");
  assert.equal(paths["tickets/t1/assigned_to_name"], "Zeynep Arslan");
  assert.equal(paths["projects/pr1/manager_name"], "Zeynep Arslan");
  assert.equal(paths["projects/pr1/assigned_personnel/p1/name"], "Zeynep Arslan");
  assert.equal(paths["projects/pr2/manager_name"], "Zeynep Arslan");
  assert.ok(!Object.keys(paths).some((k) => k.includes("/p2") || k.includes("t2") || k.includes("pr3")), "başkasının kayıtlarına dokunulmaz");

  const inactive = planPersonnelCopies({ ...person, is_active: false }, { assignments, tickets: [], projects: [] });
  assert.equal(inactive["ticket_assignments/t1/p1/personnel_email"], "", "pasif personelin e-postası kopyadan boşaltılır");
  // zaten boşsa yazılacak yol yok
  const already = { t1: [{ personnel_id: "p1", personnel_name: "Zeynep Arslan", personnel_email: "" }] };
  assert.deepEqual(planPersonnelCopies({ ...person, is_active: false }, { assignments: already }), {});
});

test("planDepartmentCopies / planUserNameCopies / chunkPaths", () => {
  const d = planDepartmentCopies({ id: "d1", name: "Yeni Departman" }, [
    { id: "p1", department_id: "d1", department_name: "Eski" },
    { id: "p2", department_id: "d2", department_name: "Başka" },
  ]);
  assert.deepEqual(d, { "personnel/p1/department_name": "Yeni Departman" });
  const u = planUserNameCopies("u1", " Ayşe Yılmaz ", [
    { ticket_id: "t1", user_id: "u1", user_name: "Ayşe Demir" },
    { ticket_id: "t2", user_id: "u2", user_name: "Başka" },
    { ticket_id: "t3", user_id: "u1", user_name: "Ayşe Yılmaz" },
  ]);
  assert.deepEqual(u, { "tickets/t1/user_name": "Ayşe Yılmaz" });
  assert.deepEqual(planUserNameCopies("u1", "", [{ ticket_id: "t1", user_id: "u1", user_name: "X" }]), {}, "boş ad yayılmaz");
  const chunks = chunkPaths(Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`a/${i}`, i])), 3);
  assert.deepEqual(chunks.map((c) => Object.keys(c).length), [3, 3, 1]);
});

/* ------------------------------------------------------------------ hazır yanıt şablonları */
test("renderReplyTemplate: değişkenler dolar, bilinmeyen kalır, HTML metni kaçışlanmadan DEĞİL düz metin olarak taşınır", () => {
  const out = renderReplyTemplate("Merhaba {musteri_adi}, {talep_no} numaralı talebiniz. {danisman} {bilinmeyen} { talep_no }", {
    musteri_adi: "Ayşe Demir",
    talep_no: "SUP-ORN-FI-2610-0001",
    danisman: "Zeynep Arslan",
  });
  assert.equal(out, "Merhaba Ayşe Demir, SUP-ORN-FI-2610-0001 numaralı talebiniz. Zeynep Arslan {bilinmeyen} SUP-ORN-FI-2610-0001");
  // Değer içindeki kalıp ikinci kez genişletilmez
  assert.equal(renderReplyTemplate("{musteri_adi}", { musteri_adi: "{talep_no}", talep_no: "X" }), "{talep_no}");
  // Eksik değişken değeri boş dizedir
  assert.equal(renderReplyTemplate("a{danisman}b", {}), "ab");
  const payload = `<img src=x onerror=window.__xss=1>`;
  assert.equal(renderReplyTemplate("{musteri_adi}", { musteri_adi: payload }), payload);
});

test("validateTemplateInput / sortTemplates", () => {
  assert.ok(validateTemplateInput({ title: "", body: "x" }).errors.title);
  assert.ok(validateTemplateInput({ title: "t", body: "" }).errors.body);
  assert.ok(validateTemplateInput({ title: "t".repeat(201), body: "x" }).errors.title);
  assert.ok(validateTemplateInput({ title: "t", body: "x".repeat(10001) }).errors.body);
  assert.ok(validateTemplateInput({ title: "t", body: "x", sort_order: "1.5" }).errors.sort_order);
  const ok = validateTemplateInput({ title: " Başlık ", body: " Metin ", category: " K ", sort_order: "3" });
  assert.deepEqual(ok.value, { title: "Başlık", body: "Metin", category: "K", sort_order: 3 });
  const sorted = sortTemplates([
    { title: "B", sort_order: 2 },
    { title: "A", sort_order: 2 },
    { title: "Z", sort_order: 1 },
    { title: "P", sort_order: 0, is_active: false },
  ]);
  assert.deepEqual(sorted.map((t) => t.title), ["P", "Z", "A", "B"]);
  assert.deepEqual(sortTemplates(sorted, { onlyActive: true }).map((t) => t.title), ["Z", "A", "B"]);
});

/* ------------------------------------------------------------------ atanmamış / sahipsiz */
test("needsAssignee: açık + atanmamış ya da yalnız pasif danışmana atanmış (pano ile aynı tanım)", () => {
  const assignments = { t2: [{ personnel_id: "p9" }], t3: [{ personnel_id: "p1" }] };
  const active = new Set(["p1"]);
  assert.equal(needsAssignee({ ticket_id: "t1", status: "open" }, assignments, active), true);
  assert.equal(needsAssignee({ ticket_id: "t1", status: "closed" }, assignments, active), false, "kapalı sayılmaz");
  assert.equal(needsAssignee({ ticket_id: "t1", status: "resolved" }, assignments, active), false);
  assert.equal(needsAssignee({ ticket_id: "t2", status: "in_progress" }, assignments, active), true, "pasif danışman = sahipsiz");
  assert.equal(needsAssignee({ ticket_id: "t3", status: "in_progress" }, assignments, active), false);
  assert.deepEqual(ticketAssigneeIds({ ticket_id: "t9", assigned_to_id: "p1" }, {}), ["p1"]);
});

/* ------------------------------------------------------------------ rapor aralığı */
test("resolveReportRange: ters/eksik aralık hata, 3 ay ay sonlarında taşmaz", () => {
  const bad = resolveReportRange("custom", "2026-10-10", "2026-10-01", NOW);
  assert.match(bad.error, /önce olamaz/);
  assert.match(resolveReportRange("custom", "", "", NOW).error, /girin/);
  assert.equal(resolveReportRange("custom", "2026-10-01", "2026-10-10", NOW).error, "");
  const may31 = new Date(2026, 4, 31, 10, 0, 0);
  const r = resolveReportRange("3months", "", "", may31);
  assert.equal(r.start.getMonth(), 1);
  assert.equal(r.start.getDate(), 28);
  const month = resolveReportRange("month", "", "", NOW);
  assert.equal(month.start.getDate(), 1);
  assert.equal(month.end.getDate(), 7);
  const week = resolveReportRange("week", "", "", NOW); // 7 Ekim 2026 Çarşamba -> hafta 5 Ekim Pazartesi
  assert.equal(week.start.getDate(), 5);
});

/* ------------------------------------------------------------------ toplu işlemler */
test("canBulkOperate: yalnız super/service/PM", () => {
  assert.equal(canBulkOperate("super_admin"), true);
  assert.equal(canBulkOperate("service_admin"), true);
  assert.equal(canBulkOperate("project_manager"), true);
  assert.equal(canBulkOperate("consultant"), false);
  assert.equal(canBulkOperate("customer"), false);
  assert.equal(canBulkOperate(""), false);
});

test("planBulkStatus: izinli geçiş matrisi; geçersizler sebebiyle atlanır; bildirim yalnız çözüldü/kapandı", () => {
  const tickets = [
    { ticket_id: "a", ticket_number: "N-1", status: "in_progress", assigned_to_id: "p1" },
    { ticket_id: "b", ticket_number: "N-2", status: "open" },
    { ticket_id: "c", ticket_number: "N-3", status: "pending_close", assigned_to_id: "p1" },
    { ticket_id: "d", ticket_number: "N-4", status: "closed" },
    { ticket_id: "e", ticket_number: "N-5", status: "resolved", is_deleted: true },
  ];
  const toClosed = planBulkStatus(tickets, "closed", { role: "super_admin" });
  assert.deepEqual(toClosed.eligible.map((t) => t.ticket_id), ["c"], "yalnız kapanış onayı bekleyen kapatılabilir");
  assert.equal(toClosed.skipped.length, 4);
  assert.ok(toClosed.skipped.find((s) => s.ticket.ticket_id === "d").reason.includes("Zaten"));
  assert.ok(toClosed.skipped.find((s) => s.ticket.ticket_id === "e").reason.includes("Arşiv"));
  assert.ok(toClosed.skipped.find((s) => s.ticket.ticket_id === "a").reason.includes("geçişine izin yok"));

  const toProgress = planBulkStatus(tickets, "in_progress", { role: "project_manager" });
  assert.deepEqual(toProgress.eligible.map((t) => t.ticket_id), ["c"], "pending_close → in_progress izinli; atanmamış açık talep işleme alınamaz");

  assert.deepEqual(BULK_NOTIFY_STATUSES, ["resolved", "closed"]);
  assert.equal(describeSkipped(toClosed.skipped, 2).length, 3);
});

test("planBulkAssign: birincil / yerine ata kipleri, kapalı ve zaten atanmış talepler atlanır", () => {
  const person = { personnel_id: "p3", first_name: "Mehmet", last_name: "Kaya", email: "MEHMET@parla-demo.com", uid: "u3" };
  const personnel = [
    person,
    { personnel_id: "p1", first_name: "Zeynep", last_name: "Arslan", email: "z@parla-demo.com", uid: "u1" },
  ];
  const tickets = [
    { ticket_id: "a", ticket_number: "N-1", status: "open" },
    { ticket_id: "b", ticket_number: "N-2", status: "in_progress", assigned_to_id: "p1" },
    { ticket_id: "c", ticket_number: "N-3", status: "closed" },
    { ticket_id: "d", ticket_number: "N-4", status: "assigned", assigned_to_id: "p3" },
  ];
  const assignments = { b: [{ personnel_id: "p1", is_primary: true, personnel_name: "Zeynep Arslan" }], d: [{ personnel_id: "p3", is_primary: true }] };
  const primary = planBulkAssign(tickets, person, "primary", assignments, personnel);
  assert.deepEqual(primary.eligible.map((e) => e.ticket.ticket_id), ["a", "b"]);
  const forB = primary.eligible[1].assignments;
  assert.deepEqual(forB.map((x) => [x.personnel_id, x.is_primary]), [["p3", true], ["p1", false]], "mevcut danışman ikincil kalır");
  assert.equal(forB[0].personnel_email, "mehmet@parla-demo.com");
  assert.equal(forB[0].personnel_uid, "u3");
  assert.equal(primary.skipped.length, 2);

  const replace = planBulkAssign(tickets, person, "replace", assignments, personnel);
  assert.deepEqual(replace.eligible.map((e) => e.ticket.ticket_id), ["a", "b"]);
  assert.deepEqual(replace.eligible[1].assignments.map((x) => x.personnel_id), ["p3"], "yerine ata: diğerleri kalkar");
  assert.ok(replace.skipped.find((s) => s.ticket.ticket_id === "d").reason.includes("Zaten yalnızca"));
});

/* ------------------------------------------------------------------ liste yardımcıları */
test("sortRows: boşlar yönden bağımsız sonda; sayısal ve Türkçe sıralama; kararlı", () => {
  const rows = [
    { n: "Çelik", v: 3 },
    { n: "Ankara", v: null },
    { n: "Zeta", v: 10 },
    { n: "ırmak", v: 2 },
  ];
  assert.deepEqual(sortRows(rows, { key: "n", dir: "asc" }).map((r) => r.n), ["Ankara", "Çelik", "ırmak", "Zeta"]);
  assert.deepEqual(sortRows(rows, { key: "v", dir: "asc" }).map((r) => r.v), [2, 3, 10, null]);
  assert.deepEqual(sortRows(rows, { key: "v", dir: "desc" }).map((r) => r.v), [10, 3, 2, null]);
  assert.ok(compareValues("a2", "a10") < 0, "doğal sayı sıralaması");
  assert.deepEqual(nextSort({ key: "n", dir: "asc" }, "n"), { key: "n", dir: "desc" });
  assert.deepEqual(nextSort({ key: "n", dir: "desc" }, "v", "desc"), { key: "v", dir: "desc" });
});

test("paginateRows: sayfa sınırlanır", () => {
  const rows = Array.from({ length: 53 }, (_, i) => i);
  const p3 = paginateRows(rows, 3, 25);
  assert.deepEqual([p3.page, p3.totalPages, p3.rows.length, p3.total], [3, 3, 3, 53]);
  assert.equal(paginateRows(rows, 99, 25).page, 3);
  assert.equal(paginateRows([], 1, 25).totalPages, 1);
});

test("debounce: son çağrıdan sonra bir kez çalışır", async () => {
  let calls = 0;
  const fn = debounce(() => {
    calls += 1;
  }, 20);
  fn();
  fn();
  fn();
  assert.equal(calls, 0);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, 1);
});

test("formatDate/formatDateTime önbellekli biçimleyiciyle aynı çıktıyı verir", () => {
  const iso = "2026-10-06T10:05:00Z";
  const d = new Date(iso);
  assert.equal(formatDate(iso), d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }));
  assert.equal(
    formatDateTime(iso),
    d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  );
  assert.equal(formatDate(""), "—");
  assert.equal(formatDate("geçersiz"), "geçersiz");
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20000; i += 1) formatDateTime(iso);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1500, `20.000 çağrı ${ms.toFixed(0)} ms sürdü (önbellekli biçimleyici bekleniyor)`);
});
