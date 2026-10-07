/**
 * E2E (WP-09/10/13): yönetim modülleri tutarlılığı + proje bağı + sayfa düzeyi performans/liste davranışı.
 *
 *  A  Firma listesi: türetilmiş sözleşme rozeti, talep sayıları (görünen satırlar için), sıralama, yeni firma
 *  B  Firma adı/kodu değişince kopyalar yayılır (kullanıcı, talep, sözleşme, proje) — talep numarası DEĞİŞMEZ
 *  C  Firma pasife alma: gösterge, pasif firmanın sözleşmesi düzenlenebilir, seçicilerden çıkar
 *  D  Sözleşme CRUD: bedel `contract_values` düğümünde; PM/danışman bedeli GÖRMEZ; doğrulama; has_contract türetimi
 *  E  Proje: firma adı/yönetici kimliği/tarih doğrulaması; PRJ talebinde proje seçimi; proje sayacı + detay listesi
 *  F  Departman: yinelenen ad, ad yayma, gerçek "Sil", yetkisiz rolde anahtar kapalı, pasif departman seçilemez
 *  G  Modül / Destek Türü: referans uyarısı, anahtarlar yetkisiz rolde kapalı, kod doğrulama
 *  H  Personel: e-posta/ad değişimi → atama kopyaları; pasife alınca e-posta boşalır, aktifleşince geri döner
 *  I  Danışman/PM: firma sayfasında kullanıcı sütun/sekme/kartı yok, kullanıcı listesi okunmaz
 *  J  Raporlar: tarih aralığı doğrulaması, Efor Detayı sayfalama
 *  K  Talep listesi: ?filter=unassigned (pano tanımı), "Uygula" tutarlılığı, aktif filtre rozeti, sütun sıralama,
 *     sayfa boyutu, sayfa değişiminde gelişmiş panel kapanmaz, EFOR 2 ondalık
 *
 * Çalıştırma: node tests/e2e/admin-modules.e2e.cjs
 */
const { createWorld, startServer } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${ok ? "" : " | " + (detail === undefined ? "" : typeof detail === "string" ? detail : JSON.stringify(detail))}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, ms = 6000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v || Date.now() - t0 > ms) return v;
    await sleep(100);
  }
}

const NOW = Date.now();
const DAY = 24 * 3600 * 1000;
const H = 3600 * 1000;
const dateStr = (offsetDays) => {
  const d = new Date(NOW + offsetDays * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const iso = (offsetMs) => new Date(NOW - offsetMs).toISOString();

function mkTicket(id, n, o) {
  return {
    ticket_id: id,
    ticket_number: `SUP-ORN-FI-2610-${String(n).padStart(4, "0")}`,
    ticket_type: "SUP",
    customer_code: "ORN",
    company_id: "cA",
    company_name: "Örnek Holding A.Ş.",
    user_id: "u_cust",
    user_name: "Ayşe Demir",
    user_email: "ayse.demir@ornekholding.com",
    title: o.title,
    description: "Test talebi açıklaması (en az yirmi karakter olacak biçimde).",
    priority: "medium",
    sap_module: "FI",
    status: o.status || "open",
    assigned_to_id: "",
    assigned_to_name: "",
    total_work_hours: o.hours || 0,
    project_id: "",
    sequence_number: n,
    created_at: iso(o.age || 5 * H),
    created_by: "u_cust",
    updated_at: iso(o.age || 5 * H),
    updated_by: "u_cust",
    public_updated_at: iso(o.age || 5 * H),
    public_updated_by: "u_cust",
    ...(o.closed ? { closed_at: iso(2 * H), closed_at_ms: NOW - 2 * H, resolved_at: iso(3 * H) } : {}),
  };
}

const upper = (t) => String(t).toLocaleUpperCase("tr");
async function openAndWait(sess, url, selector) {
  await sess.goto(url);
  await sess.page.waitForSelector(selector, { timeout: 15000 });
  await sess.page.waitForTimeout(250);
}

(async () => {
  const world = createWorld(buildSeed());
  // Sözleşme tarihleri bugüne göre (saat bağımsız test)
  world.seed("v2/contracts/k1/start_date", dateStr(-100));
  world.seed("v2/contracts/k1/end_date", dateStr(200));
  world.seed("v2/contracts/k2/start_date", dateStr(-50));
  world.seed("v2/contracts/k2/end_date", dateStr(300));
  world.seed("v2/contracts/k3", { contract_id: "k3", contract_number: "SZL-ESKI-003", company_id: "cA", company_name: "Örnek Holding A.Ş.", type: "bakim", start_date: dateStr(-900), end_date: dateStr(-400), status: "active", notes: "", created_at: iso(900 * DAY) });
  // Demir Çelik'in yalnız süresi dolmuş sözleşmesi olsun diye ayrı firma (sözleşmesiz rozet için)
  world.seed("v2/companies/cC", { company_id: "cC", name: "Gamma Yazılım Ltd.", customer_code: "GMA", customer_type: "CUS", has_contract: true, is_active: true, created_at: iso(10 * DAY) });
  world.seed("v2/contracts/k4", { contract_id: "k4", contract_number: "SZL-GMA-004", company_id: "cC", company_name: "Gamma Yazılım Ltd.", type: "yillik", start_date: dateStr(-800), end_date: dateStr(-100), status: "active", notes: "", created_at: iso(800 * DAY) });
  // Efor sayfalama testi için 55 efor
  for (let i = 0; i < 55; i += 1) {
    world.seed(`v2/ticket_efforts/t9/ex${i}`, { effort_id: `ex${i}`, personnel_id: "p2", personnel_name: "Can Öztürk", hours: 0.25, work_date: dateStr(0), note: `Efor ${i}`, created_at: iso(H), created_by_uid: "u_cons2", created_by_name: "Can Öztürk" });
  }

  const srv = await startServer(world);
  try {
    const root = await srv.session("u_root");
    const page = root.page;

    /* ============================================================ A — firma listesi */
    await openAndWait(root, "/support-v2/admin/companies.html", "#companies-table table");
    const rowText = async (name) => (await page.locator("#companies-table tbody tr", { hasText: name }).first().textContent()).replace(/\s+/g, " ");
    check("A: sözleşmeli firma (etkin sözleşme) 'Aktif Sözleşme' rozeti", /Aktif Sözleşme/.test(await rowText("Örnek Holding")), await rowText("Örnek Holding"));
    check("A: yalnız süresi dolmuş sözleşmesi olan firma 'Sözleşme Yok' (elle işaretli has_contract=true olmasına rağmen)", /Sözleşme Yok/.test(await rowText("Gamma")), await rowText("Gamma"));
    await page.waitForFunction(() => document.querySelector('.sv2-ticket-count[data-company="cA"]')?.textContent === "11", null, { timeout: 8000 }).catch(() => {});
    check("A: talep sayısı yalnız görünen satırlar için hesaplanır (cA = 11)", (await page.locator('.sv2-ticket-count[data-company="cA"]').textContent()) === "11", await page.locator('.sv2-ticket-count[data-company="cA"]').textContent());
    check("A: firma listesi kullanıcı sayısı sütunu (yönetici)", /KAYITLI KULLANICI/.test(upper(await page.locator("#companies-table thead").textContent())));
    const firstBefore = (await page.locator("#companies-table tbody tr").first().textContent()).replace(/\s+/g, " ");
    await page.click('#companies-table button.sv2-sort-btn[data-sort-key="name"]');
    const firstAfter = (await page.locator("#companies-table tbody tr").first().textContent()).replace(/\s+/g, " ");
    check("A: sütun başlığı sıralaması ters çevirir", firstBefore !== firstAfter && (await page.locator('#companies-table th[aria-sort="descending"]').count()) === 1, [firstBefore, firstAfter]);
    await page.click("#btn-new-company");
    await page.waitForSelector("#nc-name");
    await page.fill("#nc-name", "Yeni Test A.Ş.");
    await page.click("#nc-submit");
    const newCompany = await eventually(() => Object.values(world.valueAt("v2/companies") || {}).find((c) => c.name === "Yeni Test A.Ş."));
    check("A: yeni firma kaydedildi", !!newCompany && /^CUS\d{4}$/.test(newCompany.customer_code), newCompany);
    await page.waitForFunction(() => document.querySelector("#companies-table")?.textContent.includes("Yeni Test"), null, { timeout: 8000 });

    /* ============================================================ B — ad/kod yayma */
    const numbersBefore = Object.fromEntries(Object.entries(world.valueAt("v2/tickets")).map(([id, t]) => [id, t.ticket_number]));
    await openAndWait(root, "/support-v2/admin/company-detail.html?id=cA", "#btn-edit-company");
    await page.click("#btn-edit-company");
    await page.waitForSelector("#ec-name");
    await page.fill("#ec-code", "CUS0001"); // başka firmanın (Yeni Test A.Ş.) kodu
    await page.click("#edit-company-save");
    await page.waitForTimeout(600);
    check("B: başka firmanın müşteri kodu reddedilir", world.valueAt("v2/companies/cA/customer_code") === "ORN");
    await page.fill("#ec-name", "Örnek Holding Yeni Ad A.Ş.");
    await page.fill("#ec-code", "new0001");
    await page.click("#edit-company-save");
    await eventually(() => world.valueAt("v2/companies/cA/name") === "Örnek Holding Yeni Ad A.Ş." && world.valueAt("v2/users/u_cust/customer_code") === "NEW0001");
    check("B: firma kaydı güncellendi (kod büyük harf)", world.valueAt("v2/companies/cA/customer_code") === "NEW0001");
    check("B: kullanıcı kopyaları yayıldı (ad + kod)", ["u_cust", "u_cust2", "u_cadmin", "u_new"].every((u) => world.valueAt(`v2/users/${u}/company_name`) === "Örnek Holding Yeni Ad A.Ş." && world.valueAt(`v2/users/${u}/customer_code`) === "NEW0001"));
    check("B: talep kopyaları yayıldı", ["t1", "t2", "t9", "t12"].every((t) => world.valueAt(`v2/tickets/${t}/company_name`) === "Örnek Holding Yeni Ad A.Ş." && world.valueAt(`v2/tickets/${t}/customer_code`) === "NEW0001"));
    check("B: talep NUMARASI değişmedi (tüm talepler)", Object.entries(numbersBefore).every(([id, n]) => world.valueAt(`v2/tickets/${id}/ticket_number`) === n) && world.valueAt("v2/tickets/t1/ticket_number") === "SUP-ORN-SD-2610-0001");
    check("B: başka firmanın talebine dokunulmadı", world.valueAt("v2/tickets/t10/company_name") === "Demir Çelik San. A.Ş." && world.valueAt("v2/tickets/t10/customer_code") === "DMR");
    check("B: sözleşme + proje kopyaları yayıldı", world.valueAt("v2/contracts/k1/company_name") === "Örnek Holding Yeni Ad A.Ş." && world.valueAt("v2/projects/pr1/company_name") === "Örnek Holding Yeni Ad A.Ş." && world.valueAt("v2/projects/pr1/customer_code") === "NEW0001");
    check("B: yeni talepler yeni kodla açılır (kullanıcı profili kodu NEW0001)", world.valueAt("v2/users/u_cust/customer_code") === "NEW0001");
    check("B: firma düzenleme hata vermedi", root.errors.length === 0, root.errors);

    /* ============================================================ C — pasife alma */
    await openAndWait(root, "/support-v2/admin/company-detail.html?id=cB", "#btn-toggle-company");
    await page.click("#btn-toggle-company");
    const confirmMsg = await page.locator("#sv2-confirm-message").textContent();
    check("C: pasife alma onayı etkiyi açıklar (yeni talep açamaz, mevcut talepler etkilenmez)", /yeni talep açamaz/.test(confirmMsg) && /etkilenmez/.test(confirmMsg), confirmMsg);
    await page.click("#sv2-confirm-ok");
    await eventually(() => world.valueAt("v2/companies/cB/is_active") === false);
    check("C: firma pasife alındı", world.valueAt("v2/companies/cB/is_active") === false);
    await page.waitForSelector("#company-inactive-badge", { timeout: 5000 });
    check("C: firma detayında 'Pasif' göstergesi + açıklama", (await page.locator("#company-inactive-badge").count()) === 1);
    await openAndWait(root, "/support-v2/admin/companies.html", "#companies-table table");
    check("C: firma listesinde '(pasif)' göstergesi", /pasif/i.test(await rowText("Demir")), await rowText("Demir"));

    await openAndWait(root, "/support-v2/admin/contracts.html", "#contracts-table table");
    await page.locator("#contracts-table tbody tr", { hasText: "SZL-2026-007" }).locator(".btn-edit").click();
    await page.waitForSelector("#cf-company");
    const selectedOption = await page.locator("#cf-company option:checked").textContent();
    check("C: pasif firmanın sözleşmesi düzenlenirken firma '(pasif)' etiketiyle seçili", /Demir/.test(selectedOption) && /pasif/.test(selectedOption), selectedOption);
    await page.fill("#cf-notes", "Pasif firma notu güncellendi");
    await page.click("#contract-save");
    await eventually(() => world.valueAt("v2/contracts/k2/notes") === "Pasif firma notu güncellendi");
    check("C: pasif firmanın sözleşme notu güncellendi (firma değişmedi)", world.valueAt("v2/contracts/k2/notes") === "Pasif firma notu güncellendi" && world.valueAt("v2/contracts/k2/company_id") === "cB");
    check("C: firmanın has_contract bayrağı sözleşmelerden türetildi (cB: etkin sözleşme var)", world.valueAt("v2/companies/cB/has_contract") === true);

    /* ============================================================ D — sözleşme CRUD + bedel */
    await page.click("#btn-new-contract");
    await page.waitForSelector("#cf-number");
    const companyOpts = await page.locator("#cf-company option").allTextContents();
    check("D: yeni sözleşme firma listesinde pasif firma YOK", !companyOpts.some((o) => /Demir/.test(o)), companyOpts);
    // doğrulamalar
    await page.fill("#cf-number", "SZL-2026-001");
    await page.selectOption("#cf-company", "cA");
    await page.fill("#cf-start", dateStr(0));
    await page.fill("#cf-end", dateStr(-10));
    await page.fill("#cf-value", "-5");
    await page.click("#contract-save");
    check("D: yinelenen no reddedilir", await page.locator("#err-number").isVisible());
    check("D: bitiş < başlangıç reddedilir", await page.locator("#err-end").isVisible());
    check("D: negatif değer reddedilir", await page.locator("#err-value").isVisible());
    check("D: doğrulama hatasında yazım olmadı", Object.keys(world.valueAt("v2/contracts") || {}).length === 4);
    // geçerli kayıt: yeni firma için, bedel 12500,5
    await page.fill("#cf-number", "SZL-TEST-1");
    await page.selectOption("#cf-company", newCompany.company_id);
    await page.fill("#cf-start", dateStr(-1));
    await page.fill("#cf-end", dateStr(364));
    await page.fill("#cf-value", "12500.5");
    await page.fill("#cf-notes", "Bedel notu");
    await page.click("#contract-save");
    const newContract = await eventually(() => Object.values(world.valueAt("v2/contracts") || {}).find((c) => c.contract_number === "SZL-TEST-1"));
    if (!newContract) console.log("DEBUG toasts:", await page.locator(".sv2-toast").allTextContents(), "errs:", await page.locator(".sv2-field-error:not([hidden])").allTextContents(), "denied:", JSON.stringify(world.denied.slice(-3)), root.errors);
    check("D: sözleşme kaydedildi (not + durum)", !!newContract && newContract.notes === "Bedel notu" && newContract.status === "active", newContract);
    check("D: BEDEL contract_values düğümünde", !!newContract && world.valueAt(`v2/contract_values/${newContract.contract_id}/value`) === 12500.5 && world.valueAt(`v2/contract_values/${newContract.contract_id}/currency`) === "TRY");
    check("D: contracts/<id>/value YAZILMADI", !!newContract && world.valueAt(`v2/contracts/${newContract.contract_id}/value`) == null);
    check("D: firma has_contract=true (türetildi)", world.valueAt(`v2/companies/${newCompany.company_id}/has_contract`) === true && world.valueAt(`v2/companies/${newCompany.company_id}/contract_id`) === newContract.contract_id);
    await page.waitForFunction(() => /12\.500,5/.test(document.querySelector("#contracts-table")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
    const contractsText = (await page.locator("#contracts-table").textContent()).replace(/\s+/g, " ");
    check("D: değer ve not listede görünür (yönetici)", /12\.500,5/.test(contractsText) && /Bedel notu/.test(contractsText), contractsText.slice(0, 400));
    const statusLabels = await page.locator("#contracts-table .sv2-badge").allTextContents();
    check("D: sözleşme durumları kendi etiketleriyle (Aktif / Sona Ermiş)", statusLabels.some((t) => /Aktif/.test(t)) && statusLabels.some((t) => /Sona Ermiş/.test(t)), statusLabels);
    // düzenle: bedel yeniden doldurulur; iptale al → firma bayrağı false
    await page.locator("#contracts-table tbody tr", { hasText: "SZL-TEST-1" }).locator(".btn-edit").click();
    await page.waitForSelector("#cf-value");
    check("D: düzenleme formunda bedel contract_values'tan gelir", (await page.inputValue("#cf-value")) === "12500.5");
    await page.selectOption("#cf-status", "cancelled");
    await page.click("#contract-save");
    await eventually(() => world.valueAt(`v2/companies/${newCompany.company_id}/has_contract`) === false);
    check("D: tek sözleşme iptal edilince firma 'sözleşmeli' değil", world.valueAt(`v2/companies/${newCompany.company_id}/has_contract`) === false);
    check("D: sözleşme etkinlikleri aktiviteye yazıldı", Object.values(world.valueAt("v2/activities") || {}).some((a) => a.entity_type === "contract" && a.action === "created"));

    // Bedel yetkisi: PM / danışman GÖRMEZ
    for (const uid of ["u_pm", "u_cons1"]) {
      const s = await srv.session(uid);
      world.denied.length = 0;
      await openAndWait(s, "/support-v2/admin/contracts.html", "#contracts-table table");
      const head = await s.page.locator("#contracts-table thead").textContent();
      check(`D: ${uid} sözleşme listesinde DEĞER sütunu yok`, !/DEĞER/.test(upper(head)), head);
      check(`D: ${uid} sözleşme bedelini istemedi (contract_values okuması yok)`, !world.denied.some((d) => /contract_values/.test(d.path)) && !/12\.500/.test(await s.page.locator("#contracts-table").textContent()), world.denied);
      check(`D: ${uid} yeni sözleşme düğmesi yok`, (await s.page.locator("#btn-new-contract").count()) === 0);
      await openAndWait(s, "/support-v2/admin/company-detail.html?id=cA", ".sv2-tab");
      await s.page.click('.sv2-tab[data-tab="contracts"]');
      await s.page.waitForTimeout(300);
      const tabText = await s.page.locator("#tab-content").textContent();
      check(`D: ${uid} firma detayı sözleşme sekmesinde değer yok`, !/DEĞER/.test(upper(tabText)) && !/12\.500/.test(tabText) && /SZL-2026-001/.test(tabText), tabText.slice(0, 200));
      check(`D: ${uid} oturumunda hata/PERMISSION_DENIED yok`, s.errors.length === 0 && !world.denied.some((d) => d.uid === uid && d.path !== "/v2/users"), { errors: s.errors, denied: world.denied });
      const direct = world.dbOp({ uid, op: "get", path: "v2/contract_values" });
      check(`D: kurallar ${uid} için contract_values'ı kapatır`, direct.error === "PERMISSION_DENIED");
      await s.context.close();
    }
    {
      const s = await srv.session("u_service");
      await openAndWait(s, "/support-v2/admin/contracts.html", "#contracts-table table");
      check("D: u_service (Destek Atayıcı) bedeli görür", /DEĞER/.test(upper(await s.page.locator("#contracts-table thead").textContent())));
      await s.context.close();
    }

    /* ============================================================ E — proje + PRJ talebi */
    await openAndWait(root, "/support-v2/admin/projects.html", "#projects-table table");
    const cellOfPr1 = (await page.locator("#projects-table tbody tr", { hasText: "S/4HANA" }).first().textContent()).replace(/\s+/g, " ");
    check("E: mevcut projede firma adı yazılır (ham kimlik/— değil), rozet etiketi 'Aktif'", /Örnek Holding Yeni Ad/.test(cellOfPr1) && /Aktif/.test(cellOfPr1), cellOfPr1);
    await page.click("#btn-new-project");
    await page.waitForSelector("#pf-name");
    const pfCompanies = await page.locator("#pf-company option").allTextContents();
    check("E: proje firma seçeneklerinde pasif firma yok", !pfCompanies.some((o) => /Demir/.test(o)), pfCompanies);
    await page.fill("#pf-name", "Yeni E2E Projesi");
    await page.selectOption("#pf-company", "cA");
    await page.selectOption("#pf-manager", "p1");
    await page.fill("#pf-start", "2026-09-01");
    await page.fill("#pf-end", "2026-01-01");
    await page.click("#project-save");
    check("E: bitiş < başlangıç reddedilir", await page.locator("#err-end").isVisible());
    check("E: reddedilen proje yazılmadı", Object.keys(world.valueAt("v2/projects") || {}).length === 1);
    await page.fill("#pf-end", "2027-01-01");
    await page.click("#project-save");
    const proj = await eventually(() => Object.values(world.valueAt("v2/projects") || {}).find((p) => p.name === "Yeni E2E Projesi"));
    check("E: proje kodu PRJ0001, firma adı/kodu yazıldı", !!proj && proj.project_code === "PRJ0001" && proj.company_name === "Örnek Holding Yeni Ad A.Ş." && proj.customer_code === "NEW0001", proj);
    check("E: yönetici = kullanıcı kimliği + personel kimliği + ad ('Seçiniz' değil)", !!proj && proj.manager_uid === "u_cons1" && proj.manager_personnel_id === "p1" && proj.manager_name === "Zeynep Arslan", proj);
    await page.waitForFunction(() => document.querySelector("#projects-table")?.textContent.includes("Yeni E2E"), null, { timeout: 8000 });
    // yöneticisiz proje: "Seçiniz" kaydedilmez
    await page.click("#btn-new-project");
    await page.waitForSelector("#pf-name");
    await page.fill("#pf-name", "Yöneticisiz Proje");
    await page.selectOption("#pf-company", "cA");
    await page.click("#project-save");
    const proj2 = await eventually(() => Object.values(world.valueAt("v2/projects") || {}).find((p) => p.name === "Yöneticisiz Proje"));
    check("E: yönetici seçilmeyen projede yönetici adı BOŞ (≠ 'Seçiniz'); kod benzersiz", !!proj2 && proj2.manager_name === "" && proj2.project_code === "PRJ0002", proj2);
    // eski kayıt: personel kaydı olmayan yönetici korunur
    await page.locator("#projects-table tbody tr", { hasText: "S/4HANA" }).locator(".btn-edit").click();
    await page.waitForSelector("#pf-manager");
    check("E: eski kayıttaki yönetici adı seçenek olarak korunur", /Burak Şahin/.test(await page.locator("#pf-manager option:checked").textContent()));
    await page.fill("#pf-desc", "Güncellendi");
    await page.click("#project-save");
    await eventually(() => world.valueAt("v2/projects/pr1/description") === "Güncellendi");
    check("E: eski yönetici bilgisi ezilmedi", world.valueAt("v2/projects/pr1/manager_name") === "Burak Şahin" && world.valueAt("v2/projects/pr1/manager_uid") === "u_pm");
    await page.fill("#project-search", "yeni ad");
    await page.waitForFunction(() => document.querySelectorAll("#projects-table tbody tr").length >= 3, null, { timeout: 5000 }).catch(() => {});
    check("E: firma adıyla arama çalışır", (await page.locator("#projects-table tbody tr").count()) >= 3);
    const badgeBg = await page.evaluate(() => {
      const el = [...document.querySelectorAll("#projects-table .sv2-badge")].find((b) => /Planlama/.test(b.textContent));
      return el ? getComputedStyle(el).backgroundColor : "";
    });
    check("E: 'Planlama' rozeti stilli (arka plan şeffaf değil)", !!badgeBg && badgeBg !== "rgba(0, 0, 0, 0)", badgeBg);

    // PRJ talebi: proje seçimi
    await openAndWait(root, "/support-v2/admin/tickets.html", ".sv2-bulk-cb");
    await page.click("#sv2-new-ticket");
    await page.waitForSelector("#sv2-create-type");
    await page.selectOption("#sv2-create-type", "PRJ");
    check("E: PRJ seçilince proje alanı görünür", await page.locator("#sv2-create-project-group").isVisible());
    await page.selectOption("#sv2-create-user", "u_cust");
    await page.waitForFunction(() => document.querySelectorAll("#sv2-create-project option").length >= 3, null, { timeout: 5000 });
    const projOpts = await page.locator("#sv2-create-project option").allTextContents();
    check("E: proje seçenekleri yalnız seçilen firmanın projeleri", projOpts.some((o) => /Yeni E2E/.test(o)) && projOpts.some((o) => /S\/4HANA/.test(o)) && projOpts.length === 4, projOpts);
    await page.fill("#sv2-create-title", "PRJ görevi testi");
    await page.fill("#sv2-create-desc", "Proje görevi için açıklama metni, yirmi karakteri aşar.");
    await page.click("#sv2-create-save");
    check("E: PRJ talebi proje seçilmeden oluşturulamaz", /proje seçimi zorunludur/i.test(await page.locator("#sv2-create-errors").textContent()));
    await page.selectOption("#sv2-create-project", proj.project_id);
    await page.click("#sv2-create-save");
    const prjTicket = await eventually(() => Object.values(world.valueAt("v2/tickets") || {}).find((t) => t.title === "PRJ görevi testi"));
    check("E: PRJ talebi project_id ile yazıldı", !!prjTicket && prjTicket.ticket_type === "PRJ" && prjTicket.project_id === proj.project_id && /^PRJ-/.test(prjTicket.ticket_number), prjTicket);

    await openAndWait(root, "/support-v2/admin/projects.html", "#projects-table table");
    await page.waitForFunction(() => document.querySelector('[data-task-count]') !== null, null, { timeout: 5000 });
    const taskCount = await page.locator(`[data-task-count="${proj.project_id}"]`).textContent();
    check("E: proje 'Aktif Task' sayacı çalışır (1)", taskCount.trim() === "1", taskCount);
    check("E: diğer projenin sayacı 0", (await page.locator('[data-task-count="pr1"]').textContent()).trim() === "0");
    await openAndWait(root, `/support-v2/admin/project-detail.html?id=${proj.project_id}`, "#project-tickets-table table");
    check("E: proje detayı PRJ taskını listeler", (await page.locator("#project-tickets-table").textContent()).includes(prjTicket.ticket_number));
    check("E: proje detayında firma adı yazılı (ham kimlik değil)", /Örnek Holding Yeni Ad/.test(await page.locator(".sv2-meta-grid").first().textContent()));
    // talep sayfasından proje değiştir
    await openAndWait(root, `/support-v2/admin/ticket-detail.html?id=${prjTicket.ticket_id}`, "#sv2-admin-project");
    check("E: PRJ talebinde proje alanı görünür ve mevcut proje seçili", (await page.inputValue("#sv2-admin-project")) === proj.project_id);
    await page.selectOption("#sv2-admin-project", proj2.project_id);
    await page.click("#sv2-admin-update");
    await eventually(() => world.valueAt(`v2/tickets/${prjTicket.ticket_id}/project_id`) === proj2.project_id);
    const histories = Object.values(world.valueAt(`v2/ticket_history/${prjTicket.ticket_id}`) || {});
    check("E: proje değişimi talebe ve geçmişe yazıldı", world.valueAt(`v2/tickets/${prjTicket.ticket_id}/project_id`) === proj2.project_id && histories.some((h) => h.action === "project_changed"), histories);

    /* ============================================================ F — departman */
    await openAndWait(root, "/support-v2/admin/departments.html", "#departments-table table");
    check("F: personeli olan departmanda 'Sil' yok", (await page.locator('#departments-table .btn-delete').count()) === 0);
    await page.click("#btn-new-dept");
    await page.waitForSelector("#df-name");
    await page.fill("#df-name", "sap danismanlik");
    await page.click("#dept-save");
    check("F: yinelenen departman adı reddedilir (büyük/küçük harf ve Türkçe karakter duyarsız)", await page.locator("#err-name").isVisible());
    check("F: yinelenen departman yazılmadı", Object.keys(world.valueAt("v2/departments") || {}).length === 2);
    await page.fill("#df-name", "Boş Departman");
    await page.click("#dept-save");
    const emptyDept = await eventually(() => Object.entries(world.valueAt("v2/departments") || {}).find(([, d]) => d.name === "Boş Departman"));
    await page.waitForSelector(`#departments-table .btn-delete[data-id="${emptyDept && emptyDept[0]}"]`, { timeout: 5000 });
    check("F: personeli olmayan departmanda 'Sil' görünür", true);
    await page.click(`#departments-table .btn-delete[data-id="${emptyDept[0]}"]`);
    check("F: silme onayı kalıcı silmeyi belirtir", /KALICI/.test(await page.locator("#sv2-confirm-message").textContent()));
    await page.click("#sv2-confirm-ok");
    await eventually(() => !world.valueAt(`v2/departments/${emptyDept[0]}`));
    check("F: 'Sil' kaydı gerçekten siler", !world.valueAt(`v2/departments/${emptyDept[0]}`));
    // ad yayma
    await page.locator("#departments-table tbody tr", { hasText: "SAP Danışmanlık" }).locator(".btn-edit").click();
    await page.waitForSelector("#df-name");
    await page.fill("#df-name", "SAP Danışmanlık ve Destek");
    await page.click("#dept-save");
    await eventually(() => world.valueAt("v2/personnel/p1/department_name") === "SAP Danışmanlık ve Destek");
    check("F: departman adı personel kopyalarına yayıldı (p1, p3); diğer departman dokunulmadı", world.valueAt("v2/personnel/p1/department_name") === "SAP Danışmanlık ve Destek" && world.valueAt("v2/personnel/p3/department_name") === "SAP Danışmanlık ve Destek" && world.valueAt("v2/personnel/p2/department_name") === "SAP Geliştirme");
    // pasif departman seçilemez
    await page.locator('#departments-table tbody tr', { hasText: "SAP Geliştirme" }).locator(".sv2-switch-slider").click();
    await eventually(() => world.valueAt("v2/departments/d2/is_active") === false);
    await openAndWait(root, "/support-v2/admin/personnel.html", "#btn-new-personnel");
    await page.click("#btn-new-personnel");
    await page.waitForSelector("#np-dept");
    const deptOpts = await page.locator("#np-dept option").allTextContents();
    check("F: pasif departman yeni personel formunda seçilemez", !deptOpts.some((o) => /Geliştirme/.test(o)) && deptOpts.some((o) => /Destek/.test(o)), deptOpts);
    await page.click('[data-close="modal-new-personnel"]');
    // yetkisiz roller
    for (const uid of ["u_service", "u_pm", "u_cons1"]) {
      const s = await srv.session(uid);
      await openAndWait(s, "/support-v2/admin/departments.html", "#departments-table table");
      const enabled = await s.page.locator(".dept-toggle:not([disabled])").count();
      const total = await s.page.locator(".dept-toggle").count();
      check(`F: ${uid} departman durum anahtarları kapalı`, total >= 1 && enabled === 0, { total, enabled });
      await openAndWait(s, "/support-v2/admin/modules.html", "#modules-table table");
      check(`G: ${uid} modül anahtarları kapalı`, (await s.page.locator(".mod-toggle:not([disabled])").count()) === 0 && (await s.page.locator(".mod-toggle").count()) >= 1);
      await openAndWait(s, "/support-v2/admin/support-types.html", "#types-table table");
      check(`G: ${uid} destek türü anahtarları kapalı`, (await s.page.locator(".type-toggle:not([disabled])").count()) === 0 && (await s.page.locator(".type-toggle").count()) >= 1);
      check(`F/G: ${uid} sayfalarda hata yok`, s.errors.length === 0, s.errors);
      await s.context.close();
    }

    /* ============================================================ G — modül / destek türü */
    await openAndWait(root, "/support-v2/admin/modules.html", "#modules-table table");
    check("G: modül sayfası 'Referans (salt-okunur)' uyarısı", (await page.locator("#modules-reference-note").isVisible()) && /yansımaz/.test(await page.locator("#modules-reference-note").textContent()));
    check("G: modül sayfasında talep sayısı sütunu yok (tüm talepler indirilmez)", !/TOPLAM (TICKET|TALEP|TİCKET)/.test(upper(await page.locator("#modules-table thead").textContent())));
    check("G: Süper Admin için anahtarlar etkin", (await page.locator(".mod-toggle:not([disabled])").count()) >= 1);
    await page.click("#btn-new-module");
    await page.waitForSelector("#mf-code");
    await page.fill("#mf-code", "A/B");
    await page.fill("#mf-name", "Bozuk");
    await page.click("#module-save");
    check("G: 'A/B' kodu reddedilir", await page.locator("#err-code").isVisible());
    await page.fill("#mf-code", "ışık");
    await page.click("#module-save");
    check("G: Türkçe karakterli kod reddedilir", await page.locator("#err-code").isVisible());
    check("G: geçersiz kod yazılmadı", !world.valueAt("v2/sap_modules/A") && !world.valueAt("v2/sap_modules/IŞIK"));
    await page.click('[data-close="module-modal"]');
    // küçük harfli eski anahtar: pasifleştirme hayalet kayıt üretmez ("Diğer")
    await page.locator("#modules-table tbody tr", { hasText: "Diğer" }).first().locator(".sv2-switch-slider").click();
    await eventually(() => world.valueAt("v2/sap_modules/Diğer/is_active") === false);
    check("G: 'Diğer' pasifleştirilince asıl kayıt güncellenir, hayalet 'DIĞER' kaydı oluşmaz", world.valueAt("v2/sap_modules/Diğer/is_active") === false && !world.valueAt("v2/sap_modules/DIĞER"));
    await openAndWait(root, "/support-v2/admin/support-types.html", "#types-table table");
    check("G: destek türü sayfası referans uyarısı", /yansımaz/.test(await page.locator("#types-reference-note").textContent()));
    await page.click("#btn-new-type");
    await page.waitForSelector("#tf-code");
    await page.fill("#tf-code", "K L");
    await page.fill("#tf-name", "Bozuk tür");
    await page.click("#type-save");
    check("G: boşluklu tür kodu reddedilir", await page.locator("#err-code").isVisible());
    await page.click('[data-close="type-modal"]');

    /* ============================================================ H — personel e-posta/ad yayma */
    const assignedTo = (pid) => Object.entries(world.valueAt("v2/ticket_assignments") || {}).filter(([, byPid]) => byPid && byPid[pid]).map(([tid]) => tid);
    const p1Tickets = assignedTo("p1");
    check("H: ön koşul: p1 birden çok talepte atanmış", p1Tickets.length >= 4, p1Tickets);
    await openAndWait(root, "/support-v2/admin/personnel-detail.html?id=p1", "#btn-edit-person");
    await page.click("#btn-edit-person");
    await page.waitForSelector('#edit-person-form [name="email"]');
    await page.fill('#edit-person-form [name="email"]', "Zeynep.Yeni@parla-demo.com");
    await page.fill('#edit-person-form [name="last_name"]', "Arslan-Yeni");
    await page.click("#edit-person-save");
    await eventually(() => world.valueAt("v2/personnel/p1/email") === "zeynep.yeni@parla-demo.com" && p1Tickets.every((t) => world.valueAt(`v2/ticket_assignments/${t}/p1/personnel_email`) === "zeynep.yeni@parla-demo.com"));
    check("H: personel e-postası küçük harfe normalize yazıldı", world.valueAt("v2/personnel/p1/email") === "zeynep.yeni@parla-demo.com");
    check("H: TÜM atama kayıtlarındaki personnel_email güncellendi", p1Tickets.every((t) => world.valueAt(`v2/ticket_assignments/${t}/p1/personnel_email`) === "zeynep.yeni@parla-demo.com"), p1Tickets.map((t) => world.valueAt(`v2/ticket_assignments/${t}/p1/personnel_email`)));
    check("H: atama kayıtlarındaki ad güncellendi", p1Tickets.every((t) => world.valueAt(`v2/ticket_assignments/${t}/p1/personnel_name`) === "Zeynep Arslan-Yeni"));
    check("H: talepteki birincil danışman adı güncellendi", ["t1", "t3", "t6", "t8"].every((t) => world.valueAt(`v2/tickets/${t}/assigned_to_name`) === "Zeynep Arslan-Yeni"));
    check("H: diğer personelin kopyalarına dokunulmadı", world.valueAt("v2/ticket_assignments/t1/p2/personnel_email") === "can.ozturk@parla-demo.com" && world.valueAt("v2/tickets/t4/assigned_to_name") === "Can Öztürk");
    check("H: e-posta aynı zamanda personel kaydında eşleşme güncel (atama haritası bozulmadı)", world.valueAt("v2/tickets/t1/assigned_uids/u_cons1") === true);
    // pasife al -> e-posta boşalır
    await page.waitForSelector("#btn-toggle-person");
    await page.click("#btn-toggle-person");
    await page.click("#sv2-confirm-ok");
    await eventually(() => p1Tickets.every((t) => world.valueAt(`v2/ticket_assignments/${t}/p1/personnel_email`) === ""));
    check("H: pasife alınınca atama kopyalarındaki e-posta BOŞALIR", p1Tickets.every((t) => world.valueAt(`v2/ticket_assignments/${t}/p1/personnel_email`) === ""), p1Tickets.map((t) => world.valueAt(`v2/ticket_assignments/${t}/p1/personnel_email`)));
    await page.waitForFunction(() => /Aktive Et/.test(document.getElementById("btn-toggle-person")?.textContent || ""), null, { timeout: 5000 });
    await page.click("#btn-toggle-person");
    await page.click("#sv2-confirm-ok");
    await eventually(() => p1Tickets.every((t) => world.valueAt(`v2/ticket_assignments/${t}/p1/personnel_email`) === "zeynep.yeni@parla-demo.com"));
    check("H: yeniden aktifleşince e-posta kopyaları geri yazılır", p1Tickets.every((t) => world.valueAt(`v2/ticket_assignments/${t}/p1/personnel_email`) === "zeynep.yeni@parla-demo.com"));
    // atama sütunu / ikincil danışman istatistikleri
    await openAndWait(root, "/support-v2/admin/personnel-detail.html?id=p2", ".sv2-stat-card");
    const detailText = (await page.locator(".sv2-content").textContent()).replace(/\s+/g, " ");
    check("H: danışman detayında açık talep sayısı ikincil atamayı da sayar (p2: 4)", /4\s*Açık (Talep|Ticket)/.test(detailText), detailText.slice(0, 500));
    check("H: danışman detayı 'ROL' sütunu: ikincil atama 'İkincil'", /İkincil/.test(detailText));
    check("H: efor yalnız kendi girdiği (p2: 55×0,25 = 13,75 sa → 13.8)", /Toplam Efor \(kendi girdiği\)/.test(detailText) && /13[.,][78] sa/.test(detailText), detailText.slice(0, 400));
    await openAndWait(root, "/support-v2/admin/personnel.html", "#personnel-table table");
    const cellOf = async (name, header) => {
      return page.evaluate(({ name, header }) => {
        const up = (t) => t.toLocaleUpperCase("tr");
        const ths = [...document.querySelectorAll("#personnel-table thead th")];
        const idx = ths.findIndex((th) => up(th.textContent).includes(header));
        const tr = [...document.querySelectorAll("#personnel-table tbody tr")].find((r) => r.textContent.includes(name));
        return tr && idx >= 0 ? tr.children[idx].textContent.trim() : null;
      }, { name, header });
    };
    const zOpen = await cellOf("Zeynep", "AÇIK");
    const cOpen = await cellOf("Can", "AÇIK");
    check("H: personel listesi açık talep sayısı (p1: 3; ikincil dahil p2: 4) — tüm talepler indirilmeden", zOpen === "3" && cOpen === "4", [zOpen, cOpen]);
    const zEffort = await cellOf("Zeynep", "EFOR");
    check("H: personel listesi efor = kendi girdiği (p1: 3,5 sa)", /^3[.,]5 sa$/.test(zEffort), zEffort);
    check("H: personel listesi sıralanabilir başlıklar", (await page.locator("#personnel-table button.sv2-sort-btn").count()) >= 5);

    /* ============================================================ I — danışman/PM: kullanıcı sayıları */
    for (const uid of ["u_pm", "u_cons1"]) {
      const s = await srv.session(uid);
      world.denied.length = 0;
      await openAndWait(s, "/support-v2/admin/companies.html", "#companies-table table");
      check(`I: ${uid} firma listesinde 'Kayıtlı Kullanıcı' sütunu yok (0 göstermez)`, !/KAYITLI KULLANICI/.test(upper(await s.page.locator("#companies-table thead").textContent())));
      await openAndWait(s, "/support-v2/admin/company-detail.html?id=cA", ".sv2-tab");
      const tabs = await s.page.locator(".sv2-tab").allTextContents();
      const cards = await s.page.locator(".sv2-stat-card").allTextContents();
      check(`I: ${uid} firma detayında Kullanıcılar sekmesi ve 'Aktif Kullanıcı' kartı yok`, !tabs.some((t) => /Kullanıcılar/.test(t)) && !cards.some((t) => /Aktif Kullanıcı/.test(t)), { tabs, cards });
      check(`I: ${uid} kullanıcı listesi okuması denenmedi (PERMISSION_DENIED yok)`, !world.denied.some((d) => d.uid === uid), world.denied);
      await s.context.close();
    }
    // yönetici: efor sekmesi yalnız efor girilen talepler
    await openAndWait(root, "/support-v2/admin/company-detail.html?id=cA", ".sv2-tab");
    const adminTabs = await page.locator(".sv2-tab").allTextContents();
    check("I: yönetici Kullanıcılar sekmesini görür", adminTabs.some((t) => /Kullanıcılar/.test(t)));
    await page.click('.sv2-tab[data-tab="effort"]');
    await page.waitForFunction(() => document.querySelector("#effort-month"), null, { timeout: 8000 });
    const effortRows = await page.locator("#tab-content tbody tr").count();
    check("I: Efor sekmesi yalnız efor girilen talepleri listeler (efor yoksa tüm talepler listelenmez)", effortRows >= 1 && effortRows <= 3, effortRows);
    await page.selectOption("#effort-month", { index: 5 });
    await page.waitForTimeout(300);
    check("I: efor olmayan ayda 'efor kaydı bulunamadı' (tüm talepler listelenmez)", (await page.locator("#tab-content tbody tr").count()) === 0 && /efor kaydı bulunamadı/.test(await page.locator("#tab-content").textContent()));

    /* ============================================================ J — raporlar */
    await openAndWait(root, "/support-v2/admin/reports.html", "#rp-preset");
    await page.selectOption("#rp-preset", "custom");
    await page.fill("#rp-from", dateStr(10));
    await page.fill("#rp-to", dateStr(-10));
    await page.click("#rp-apply");
    check("J: ters tarih aralığı açık hata gösterir (boş 'ticket bulunamadı' değil)", (await page.locator("#report-range-error").count()) === 1 && /önce olamaz/.test(await page.locator("#report-range-error").textContent()));
    await page.fill("#rp-from", dateStr(-30));
    await page.fill("#rp-to", dateStr(1));
    await page.click("#rp-apply");
    await page.waitForSelector('[data-report="consultant-effort"] table', { timeout: 8000 });
    const note = await page.locator("#effort-detail-note").textContent();
    check("J: Efor Detayı kırpma uyarısı + toplam (55 kayıt…)", /55|57|56/.test(note) && /Dışa aktarma/.test(note), note);
    check("J: Efor Detayı ilk sayfada 50 satır", (await page.locator('[data-report="consultant-effort"] tbody tr').count()) === 50);
    await page.click('[data-report="consultant-effort"] .sv2-page-next');
    await page.waitForTimeout(400);
    check("J: Efor Detayı sonraki sayfa", (await page.locator('[data-report="consultant-effort"] tbody tr').count()) >= 5 && /51–/.test(await page.locator("#effort-detail-note").textContent()));
    check("J: kart adı 'Firma Eforu (Seçili Dönem)'", /Firma Eforu \(Seçili Dönem\)/.test(await page.locator('[data-report="company-effort"] h4').textContent()));

    check("A–J: yönetici oturumunda sayfa hatası yok", root.errors.length === 0, root.errors);
    await root.context.close();
  } finally {
    await srv.close();
  }

  /* ============================================================== K — talep listesi (ayrı dünya) */
  {
    const world = createWorld(buildSeed());
    // 40 ek talep (sayfalama) + kapalı atanmamış talep + 2,25 saat eforlu talep
    for (let i = 0; i < 40; i += 1) world.seed(`v2/tickets/q${i}`, mkTicket(`q${i}`, 500 + i, { title: `Liste testi ${i}`, status: "closed", closed: true, age: (30 + i) * H, hours: 0 }));
    world.seed("v2/tickets/zh", mkTicket("zh", 600, { title: "Efor testi", status: "closed", closed: true, hours: 2.25 }));
    const srv = await startServer(world);
    try {
      const root = await srv.session("u_root");
      const page = root.page;
      await openAndWait(root, "/support-v2/admin/tickets.html?filter=unassigned", "#sv2-active-filters");
      check("K: ?filter=unassigned görünür filtre rozeti", /Atanmamış \/ sahipsiz \(açık\)/.test(await page.locator("#sv2-active-filters").textContent()));
      // açık + atanmamış: t2, t10 (kapalı atanmamış q* ve zh sayılmaz); t11 yalnız p3'e atanmış (aktif)
      check("K: filtre pano tanımıyla uyumlu (kapalı atanmamışlar sayılmaz): 2 kayıt", /^2 kayıt/.test((await page.locator("#sv2-result-count").textContent()).trim()), await page.locator("#sv2-result-count").textContent());
      await page.click("#sv2-active-filters .sv2-clear-filter");
      await page.waitForSelector("#sv2-tickets-table table");
      check("K: rozet kaldırılınca filtre temizlenir", !/^2 kayıt/.test((await page.locator("#sv2-result-count").textContent()).trim()));
      check("K: gelişmiş panel 'Atanmamış / sahipsiz (açık)' etiketli onay kutusu", /Atanmamış \/ sahipsiz/.test(await page.locator("#sv2-filter-unassigned").locator("xpath=..").textContent()));

      // firma filtresi: seçim yalnız Uygula'da etkinleşir
      await page.click("#sv2-advanced-toggle");
      await page.fill("#sv2-filter-company", "Demir");
      await page.waitForSelector(".sv2-ac-item", { timeout: 5000 });
      await page.click(".sv2-ac-item");
      const allOpenBefore = await page.locator("#sv2-result-count").textContent();
      await page.click('#sv2-filter-chips .sv2-chip[data-value="open"]');
      await page.waitForTimeout(300);
      const afterChip = (await page.locator("#sv2-result-count").textContent()).trim();
      check("K: firma seçimi 'Uygula'dan ÖNCE listeyi daraltmaz (açık talepler tüm firmalardan: 2 kayıt)", /^2 kayıt/.test(afterChip), [allOpenBefore, afterChip]);
      await page.click("#sv2-apply-advanced");
      await page.waitForTimeout(300);
      check("K: 'Uygula' firma filtresini uygular (1 kayıt) ve rozet gösterir", /^1 kayıt/.test((await page.locator("#sv2-result-count").textContent()).trim()) && /Firma: Demir/.test(await page.locator("#sv2-active-filters").textContent()));
      await page.fill("#sv2-filter-company", "");
      await page.click("#sv2-apply-advanced");
      await page.waitForTimeout(300);
      check("K: firma kutusu boşaltılıp Uygula'ya basılınca filtre kalkar (2 kayıt, rozet yok)", /^2 kayıt/.test((await page.locator("#sv2-result-count").textContent()).trim()) && !/Firma:/.test(await page.locator("#sv2-active-filters").textContent()));
      await page.click("#sv2-clear-all-filters");
      await page.waitForSelector("#sv2-tickets-table table");

      // sıralama + sayfa boyutu + sayfa değişiminde panel kapanmaz
      await page.click('#sv2-table-holder button.sv2-sort-btn[data-sort-key="company_name"]');
      check("K: sütun başlığı sıralaması (aria-sort)", (await page.locator('#sv2-table-holder th[aria-sort="ascending"]').count()) === 1);
      await page.click("#sv2-advanced-toggle");
      await page.selectOption("#sv2-filter-sap", "FI");
      check("K: ön koşul: birden çok sayfa var", (await page.locator(".sv2-page-next:not([disabled])").count()) === 1);
      await page.click(".sv2-page-next");
      await page.waitForTimeout(300);
      check("K: sayfa değişiminde gelişmiş panel kapanmaz ve seçim korunur", (await page.locator("#sv2-advanced-panel").isVisible()) && (await page.inputValue("#sv2-filter-sap")) === "FI");
      await page.selectOption("#sv2-page-size", "100");
      await page.waitForTimeout(300);
      check("K: sayfa boyutu 100: tüm talepler tek sayfada", (await page.locator(".sv2-bulk-cb").count()) > 50);
      await page.fill("#sv2-ticket-search", "Efor testi");
      await page.waitForFunction(() => document.querySelectorAll("#sv2-table-holder tbody tr").length === 1, null, { timeout: 5000 });
      check("K: EFOR sütunu 2 ondalık (2,25)", /2,25/.test((await page.locator("#sv2-table-holder tbody tr").textContent()).replace(/\s+/g, " ")));
      check("K: talep listesinde sayfa hatası yok", root.errors.length === 0, root.errors);
      await root.context.close();
    } finally {
      await srv.close();
    }
  }

  console.log(`\n${pass}/${pass + fail} geçti`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
