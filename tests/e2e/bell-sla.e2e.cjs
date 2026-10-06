/**
 * E2E: bildirim zili, SLA rozetleri, e-posta kuyruğu (tarayıcıda).
 * Çalıştırma: node tests/e2e/bell-sla.e2e.cjs
 */
const { createWorld, startServer } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const results = [];
const check = (name, ok, extra) => results.push([ok ? "PASS" : "FAIL", name, ok ? "" : extra || ""]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(60); } return false; }

(async () => {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);
  try {
    // ---- Müşteri zili
    const cust = await srv.session("u_cust");
    await cust.goto("/support-v2/customer/dashboard.html");
    await cust.page.waitForSelector("#sv2-notif-btn");
    await waitFor(async () => !(await cust.page.locator("#sv2-notif-badge").isHidden()));
    check("müşteri zil rozeti 4 (kapanış onayı, yanıt bekleniyor, 2 güncelleme)", (await cust.page.textContent("#sv2-notif-badge")).trim() === "4", await cust.page.textContent("#sv2-notif-badge"));
    await cust.page.click("#sv2-notif-btn");
    await cust.page.waitForSelector("#sv2-notif-panel.is-open .sv2-notif-item");
    const texts = await cust.page.locator("#sv2-notif-panel .sv2-notif-item").allTextContents();
    check("panel: kapanış onayı ve yanıt bekleme eylemleri listelenir", texts.some((x) => x.includes("Kapanış onayınız bekleniyor")) && texts.some((x) => x.includes("yanıtınızı bekliyor")), texts.join(" | "));
    check("panel: iç not/gizli içerik yok", !texts.join(" ").includes("TR-4711"));
    await cust.page.keyboard.press("Escape");
    check("Escape paneli kapatır", !(await cust.page.locator("#sv2-notif-panel.is-open").count()));
    // t1'i aç -> görüldü işaretlenir -> rozet 3
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t1");
    await cust.page.waitForSelector("#sv2-lifecycle-banner, .sv2-section");
    await cust.goto("/support-v2/customer/dashboard.html");
    await waitFor(async () => (await cust.page.textContent("#sv2-notif-badge")).trim() === "3");
    check("talep açılınca okundu sayılır (rozet 3)", (await cust.page.textContent("#sv2-notif-badge")).trim() === "3", await cust.page.textContent("#sv2-notif-badge"));
    check("müşteri sayfasında hedef süreler gösterilir", (await (async () => { await cust.goto("/support-v2/customer/ticket-detail.html?id=t1"); await cust.page.waitForSelector(".sv2-meta-grid"); return cust.page.textContent(".sv2-meta-grid"); })()).includes("İlk yanıt: 1 sa"));

    // ---- Personel zili + SLA
    const staff = await srv.session("u_cons1");
    await staff.goto("/support-v2/admin/dashboard.html");
    await waitFor(async () => !(await staff.page.locator("#sv2-notif-badge").isHidden()));
    check("danışman zil rozeti 2 (SLA aşımı + müşteri güncellemesi)", (await staff.page.textContent("#sv2-notif-badge")).trim() === "2", await staff.page.textContent("#sv2-notif-badge"));
    await staff.page.click("#sv2-notif-btn");
    const staffTexts = await staff.page.locator("#sv2-notif-panel .sv2-notif-item").allTextContents();
    check("danışman paneli: 'SLA hedefi aşıldı' ve 'Müşteri yanıtladı'", staffTexts.some((x) => x.includes("SLA hedefi aşıldı")) && staffTexts.some((x) => x.includes("Müşteri yanıtladı")), staffTexts.join(" | "));
    const dashText = await staff.page.textContent(".sv2-stats-grid");
    check("dashboard 'SLA Aşımı' kartı var", dashText.includes("SLA Aşımı"));
    await staff.goto("/support-v2/admin/tickets.html");
    await staff.page.waitForSelector(".sv2-table");
    const header = await staff.page.textContent(".sv2-table thead");
    check("admin listesinde SLA sütunu", header.includes("SLA"));
    const slaBadges = await staff.page.locator(".sv2-sla").allTextContents();
    check("SLA rozetleri render edilir (aşıldı / kaldı / duraklatıldı)", slaBadges.some((x) => /aşıldı/.test(x)) && slaBadges.some((x) => /kaldı/.test(x)) && slaBadges.some((x) => /duraklatıldı/.test(x)), slaBadges.join(" | "));
    check("danışmanda 'Sil' düğmesi yok (yetki yok)", (await staff.page.locator(".sv2-delete-ticket").count()) === 0);
    const svc = await srv.session("u_service");
    await svc.goto("/support-v2/admin/tickets.html");
    await svc.page.waitForSelector(".sv2-table");
    check("destek atayıcıda 'Sil' düğmesi var", (await svc.page.locator(".sv2-delete-ticket").count()) > 0);
    await svc.goto("/support-v2/admin/dashboard.html");
    await waitFor(async () => !(await svc.page.locator("#sv2-notif-badge").isHidden()));
    await svc.page.click("#sv2-notif-btn");
    const svcTexts = await svc.page.locator("#sv2-notif-panel .sv2-notif-item").allTextContents();
    check("atayıcı: atanmamış talepler için 'Atama bekliyor'", svcTexts.some((x) => x.includes("Atama bekliyor")), svcTexts.join(" | "));

    // ---- İlk yanıt zamanı
    await staff.goto("/support-v2/admin/ticket-detail.html?id=t6");
    await staff.page.waitForSelector("#sv2-reply-message");
    check("yanıtlanmamış talepte 'Henüz yanıtlanmadı'", (await staff.page.textContent(".sv2-meta-grid")).includes("Henüz yanıtlanmadı"));
    await staff.page.fill("#sv2-reply-message", "Merhaba, F110 ayarlarını inceliyorum.");
    await staff.page.click("#sv2-reply-send");
    check("personel yanıtı first_response_at yazar", await waitFor(() => !!world.valueAt("v2/tickets/t6/first_response_at")));

    // ---- E-posta kuyruğu: Resend geçici hata -> kuyruk -> düzelince otomatik gönderim
    await waitFor(() => world.emails.some((e) => /F110 ayarlarını/.test(e.html))); // ilk yanıtın maili tamamlansın
    world.resendFailure = { status: 503, body: { name: "application_error", message: "geçici" } };
    await staff.page.fill("#sv2-reply-message", "İkinci yanıt: kayıtları kontrol ettim.");
    await staff.page.click("#sv2-reply-send");
    check("geçici hatada e-posta tarayıcı kuyruğuna alındı", await waitFor(async () => (await staff.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("sv2_email_outbox_")).length)) === 1, 20000));
    world.resendFailure = null;
    const flushed = await staff.page.evaluate(() => import("/assets/js/support-v2/email-service.js").then((m) => m.default.flushOutbox()));
    check("flush sonrası e-posta gitti ve kuyruk boşaldı", flushed.sent === 1 && flushed.pending === 0 && world.emails.some((e) => /İkinci yanıt/.test(e.html)), JSON.stringify(flushed) + " " + JSON.stringify(world.emails.map((e) => [e.to, e.subject, (e.text || "").slice(0, 160)])));

    for (const [name, s] of [["cust", cust], ["staff", staff], ["svc", svc]]) check(`${name}: sayfa hatası yok`, s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
    // Bilinen/yakalanan: müşterinin iç not okuması; danışmanın kullanıcı listesi okuması (sayfalar .catch ile dayanıklı)
    const unexpected = world.denied.filter((d) => !(d.uid === "u_cust" && /internal/.test(d.path)) && !(d.path === "/v2/users" && d.uid !== "u_root" && d.uid !== "u_service"));
    check("beklenmeyen PERMISSION_DENIED yok", unexpected.length === 0, JSON.stringify(unexpected.slice(0, 4)));
  } finally {
    await srv.close();
  }
  results.forEach((r) => console.log(r.join(" | ")));
  console.log(`\n${results.filter((r) => r[0] === "PASS").length}/${results.length} geçti`);
  process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
