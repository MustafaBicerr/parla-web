/**
 * E2E: kapanış onayı / yeniden açma / iç not / firma yöneticisi görünürlüğü
 * (gerçek kurallar + gerçek e-posta fonksiyonu; Firebase ve Resend taklit).
 * Çalıştırma: node tests/e2e/lifecycle.e2e.cjs
 */
const { createWorld, startServer } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const results = [];
const check = (name, ok, extra) => { results.push([ok ? "PASS" : "FAIL", name, ok ? "" : extra || ""]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(60); } return false; }

(async () => {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);
  const emailsTo = (addr) => world.emails.filter((e) => e.to.includes(addr));

  try {
    // ---------- 1) Personel "Kapanış Onayı İste"
    const staff = await srv.session("u_cons1");
    await staff.goto("/support-v2/admin/ticket-detail.html?id=t1");
    await staff.page.waitForSelector("#sv2-quick-actions");
    const quickLabels = await staff.page.locator("#sv2-quick-actions button").allTextContents();
    check("işlemdeki talepte hızlı işlemler: müşteri testi + kapanış onayı", quickLabels.some((t) => t.includes("Müşteri Testine Gönder")) && quickLabels.some((t) => t.includes("Kapanış Onayı İste")), quickLabels.join("|"));
    await staff.page.click('.sv2-quick-status[data-status="pending_close"]');
    await staff.page.fill("#sv2-quick-note", "kısa");
    await staff.page.click("#sv2-quick-confirm");
    check("10 karakterden kısa not reddedilir", !(await staff.page.locator("#sv2-quick-error").getAttribute("hidden")) === false || (await staff.page.locator("#sv2-quick-error").isVisible()));
    await staff.page.fill("#sv2-quick-note", "VKOA kaydı düzeltildi, test edip onaylayın.");
    await staff.page.click("#sv2-quick-confirm");
    check("durum pending_close oldu", await waitFor(() => world.valueAt("v2/tickets/t1/status") === "pending_close"));
    check("kapanış onayı e-postası müşteriye gitti (müşteri bağlantılı)", await waitFor(() => emailsTo("ayse.demir@ornekholding.com").some((e) => /Kapanış onayı/.test(e.subject) && /customer\/ticket-detail\.html\?id=t1/.test(e.html))), JSON.stringify(world.emails.map((e) => e.subject)));
    check("not geçmişe ve e-postaya yazıldı", /VKOA kaydı düzeltildi/.test(emailsTo("ayse.demir@ornekholding.com")[0]?.html || ""));
    const hist = Object.values(world.valueAt("v2/ticket_history/t1") || {});
    check("geçmişte status_note kaydı var", hist.some((h) => h.action === "status_note" && /VKOA/.test(h.note)));
    check("public_updated_at işaretlendi", !!world.valueAt("v2/tickets/t1/public_updated_at"));

    // ---------- 2) Müşteri bandı + yeniden açma
    const cust = await srv.session("u_cust");
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t1");
    await cust.page.waitForSelector("#sv2-lifecycle-banner");
    check("müşteri 'Kapanış onayınız bekleniyor' bandını görür", (await cust.page.textContent("#sv2-lifecycle-banner")).includes("Kapanış onayınız bekleniyor"));
    check("iç not müşteri sayfasında görünmez", !(await cust.page.content()).includes("TR-4711"));
    await cust.page.click("#sv2-reopen-ticket");
    await cust.page.fill("#sv2-lifecycle-note", "kısa");
    await cust.page.click("#sv2-lifecycle-confirm");
    check("kısa gerekçe reddedilir", await cust.page.locator("#sv2-lifecycle-error").isVisible());
    await cust.page.fill("#sv2-lifecycle-note", "Sorun yeni oluşturulan faturalarda hâlâ devam ediyor.");
    await cust.page.click("#sv2-lifecycle-confirm");
    check("durum reopened oldu", await waitFor(() => world.valueAt("v2/tickets/t1/status") === "reopened"));
    check("reopened_at yazıldı", !!world.valueAt("v2/tickets/t1/reopened_at"));
    const msgs = Object.values(world.valueAt("v2/ticket_messages/t1") || {});
    check("gerekçe konuşmaya mesaj olarak eklendi", msgs.some((m) => /Yeniden açma gerekçesi: Sorun yeni oluşturulan/.test(m.message) && m.author_role === "customer"));
    check("personele 'Talep tekrar açıldı' maili gitti (personel bağlantılı)", await waitFor(() => emailsTo("zeynep.arslan@parla-demo.com").some((e) => /Talep tekrar açıldı/.test(e.subject) && /admin\/ticket-detail\.html\?id=t1/.test(e.html))), JSON.stringify(world.emails.map((e) => [e.to, e.subject])));
    check("müşteriye banner 'yeniden açıldı' gösterildi", await waitFor(async () => (await cust.page.textContent("#sv2-lifecycle-banner")).includes("yeniden açıldı")));

    // ---------- 3) Personel tekrar onay ister, müşteri onaylar
    await staff.goto("/support-v2/admin/ticket-detail.html?id=t1");
    await staff.page.waitForSelector("#sv2-quick-actions");
    await staff.page.click('.sv2-quick-status[data-status="pending_close"]');
    await staff.page.fill("#sv2-quick-note", "Yeni faturalar için de düzeltme yapıldı.");
    await staff.page.click("#sv2-quick-confirm");
    await waitFor(() => world.valueAt("v2/tickets/t1/status") === "pending_close");
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t1");
    await cust.page.waitForSelector("#sv2-approve-close");
    await cust.page.click("#sv2-approve-close");
    await cust.page.fill("#sv2-lifecycle-note", "Teşekkürler, çözüldü.");
    await cust.page.click("#sv2-lifecycle-confirm");
    check("müşteri onayıyla talep kapandı", await waitFor(() => world.valueAt("v2/tickets/t1/status") === "closed"));
    check("closed_at yazıldı", !!world.valueAt("v2/tickets/t1/closed_at"));
    check("personele 'Talep kapatıldı' maili gitti", await waitFor(() => emailsTo("zeynep.arslan@parla-demo.com").some((e) => /Talep kapatıldı/.test(e.subject))));

    // ---------- 4) Yeniden açma penceresi
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t5");
    await cust.page.waitForSelector("#sv2-lifecycle-banner");
    check("10 gün önce kapanan talep yeniden açılabilir", (await cust.page.locator("#sv2-reopen-ticket").count()) === 1);
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t12");
    await cust.page.waitForSelector("#sv2-lifecycle-banner");
    check("30 gün önce kapanan talep yeniden açılamaz", (await cust.page.locator("#sv2-reopen-ticket").count()) === 0 && (await cust.page.textContent("#sv2-lifecycle-banner")).includes("doldu"));

    // ---------- 5) Müşteri onayı: bekleyen kayıt (t4) onaylama düğmeleri
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t4");
    await cust.page.waitForSelector("#sv2-approve-close");
    check("kapanış onayı bekleyen talepte iki düğme var", (await cust.page.locator("#sv2-approve-close, #sv2-reopen-ticket").count()) === 2);

    // ---------- 6) İç notlar
    await staff.goto("/support-v2/admin/ticket-detail.html?id=t2");
    await staff.page.waitForSelector("#sv2-reply-message");
    await staff.page.fill("#sv2-reply-message", "Dahili: müşteri kodunu kontrol et.");
    await staff.page.check("#sv2-reply-internal");
    await staff.page.click("#sv2-reply-send");
    check("iç not ticket_internal_notes düğümüne yazıldı", await waitFor(() => Object.values(world.valueAt("v2/ticket_internal_notes/t2") || {}).some((n) => /müşteri kodunu/.test(n.message))));
    check("iç not herkese açık mesajlarda yok", !Object.values(world.valueAt("v2/ticket_messages/t2") || {}).some((m) => /müşteri kodunu/.test(m.message)));
    check("iç not için müşteriye e-posta gitmedi", !world.emails.some((e) => /müşteri kodunu/.test(e.html)));
    const custRead = world.dbOp({ op: "get", path: "v2/ticket_internal_notes/t1", uid: "u_cust" });
    check("müşteri iç notları veritabanından da okuyamaz", custRead.error === "PERMISSION_DENIED");

    // ---------- 7) Firma yöneticisi görünürlüğü
    const cadmin = await srv.session("u_cadmin");
    await cadmin.goto("/support-v2/customer/tickets.html");
    await cadmin.page.waitForSelector("#sv2-tickets-table .sv2-table");
    const cadminRows = await cadmin.page.locator("#sv2-tickets-table tbody tr").count();
    check("firma yöneticisi firmanın tüm taleplerini listeler (A firması: 11 talep)", cadminRows === 11, String(cadminRows));
    check("firma yöneticisi listesinde 'Talep Sahibi' sütunu var", (await cadmin.page.textContent("#sv2-tickets-table thead")).includes("TALEP SAHİBİ"));
    const custList = await srv.session("u_cust2");
    await custList.goto("/support-v2/customer/tickets.html");
    await custList.page.waitForSelector("#sv2-tickets-table .sv2-table");
    check("sıradan müşteri yalnızca kendi talebini görür (Kemal: 1 talep)", (await custList.page.locator("#sv2-tickets-table tbody tr").count()) === 1);
    await cadmin.goto("/support-v2/customer/ticket-detail.html?id=t9");
    await cadmin.page.waitForSelector(".sv2-section");
    check("firma yöneticisi meslektaşının talebini açabilir", (await cadmin.page.textContent("body")).includes("Bütçe raporu"));
    const custB = await srv.session("u_custB");
    await custB.goto("/support-v2/customer/ticket-detail.html?id=t1");
    await sleep(1200);
    check("başka firmanın müşterisi A firması talebini göremez", !(await custB.page.content()).includes("Fatura kesiminde"));

    // ---------- 8) Genel
    const unexpected = world.denied.filter((d) => !(d.uid === "u_custB") && !(d.uid === "u_cust" && d.path.includes("internal_notes")) && !(d.uid === "u_cust2") && !(d.uid === "u_cadmin"));
    check("meşru akışlarda beklenmeyen PERMISSION_DENIED yok", unexpected.length === 0, JSON.stringify(unexpected.slice(0, 4)));
    for (const [name, s] of [["staff", staff], ["cust", cust], ["cadmin", cadmin]]) {
      check(`${name}: sayfa hatası yok`, s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
    }
  } finally {
    await srv.close();
  }
  results.forEach((r) => console.log(r.join(" | ")));
  console.log(`\n${results.filter((r) => r[0] === "PASS").length}/${results.length} geçti`);
  process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
