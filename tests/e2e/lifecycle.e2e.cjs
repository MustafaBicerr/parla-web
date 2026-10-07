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


/** Okuma/yazma hatası ve oturum olaylarını enjekte eden başlangıç betikleri (sayfa yüklenmeden önce). */
async function injectFaults(page, rules) {
  await page.addInitScript((initialRules) => {
    window.__failRules = initialRules || [];
    const install = () => {
      const orig = window.__dbOp;
      if (typeof orig !== "function" || orig.__w) return typeof orig === "function";
      const wrapped = (op) => {
        for (const r of window.__failRules || []) {
          if (r.op && r.op !== op.op) continue;
          if (r.path && !String(op.path).includes(r.path)) continue;
          if (r.hang) return new Promise(() => {});
          return Promise.resolve({ error: r.error || "PERMISSION_DENIED", info: "injected" });
        }
        return orig(op);
      };
      wrapped.__w = true;
      window.__dbOp = wrapped;
      return true;
    };
    if (!install()) {
      const t = setInterval(() => { if (install()) clearInterval(t); }, 5);
    }
    let val;
    Object.defineProperty(window, "__PARLA_FIREBASE", {
      configurable: true,
      get: () => val,
      set: (v) => {
        if (v && v.authFn && v.authFn.onAuthStateChanged) {
          const o = v.authFn.onAuthStateChanged;
          window.__authCbs = [];
          v.authFn.onAuthStateChanged = (a, cb) => { window.__authCbs.push(cb); return o(a, cb); };
        }
        val = v;
      },
    });
  }, rules || []);
}

const TICKET_DESC = "Bu bir otomatik test talebidir; açıklama en az yirmi karakter olmalıdır.";

async function fillTicketForm(page, title) {
  await page.fill("#sv2-ticket-title", title);
  await page.fill("#sv2-ticket-description", TICKET_DESC);
}

/**
 * WP-02/WP-11: arayüz dayanıklılığı (kendi world'ü ve sunucusu ile; diğer bölümlerden bağımsız).
 * İkinci talep, çift Enter/çift tık, DB hata kartı, derin bağlantı, oturum bitişi, çevrimdışı zaman aşımı.
 */
async function resilienceSection(check) {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);
  const ticketsWithTitle = (title) => Object.values(world.valueAt("v2/tickets") || {}).filter((t) => t.title === title);
  try {
    // ---- A) Aynı sayfada İKİ talep (MUS-02 / UX-01 / SEN-01): Taleplerim ve Genel Bakış
    for (const [pageName, path, waitSel] of [["Taleplerim", "/support-v2/customer/tickets.html", "#sv2-tickets-table .sv2-table"], ["Genel Bakış", "/support-v2/customer/dashboard.html", "#sv2-recent-tickets .sv2-table"]]) {
      const c = await srv.session("u_custB");
      await c.goto(path);
      await c.page.waitForSelector(waitSel);
      const titles = [`İlk talep ${pageName} ${Date.now()}`, `İkinci talep ${pageName} ${Date.now()}`];
      for (const [i, title] of titles.entries()) {
        await c.page.click("#sv2-new-ticket-btn");
        const opened = await waitFor(() => c.page.locator("#sv2-create-ticket-modal.is-open").isVisible().catch(() => false), 3000);
        check(`${pageName}: ${i + 1}. talep için pencere açılır`, opened);
        if (!opened) break;
        await fillTicketForm(c.page, title);
        await c.page.click("#sv2-create-ticket-submit");
        check(`${pageName}: ${i + 1}. talep oluştu`, await waitFor(() => ticketsWithTitle(title).length === 1), String(ticketsWithTitle(title).length));
        await waitFor(async () => !(await c.page.locator("#sv2-create-ticket-modal.is-open").count()));
        await sleep(400);
      }
      check(`${pageName}: iki talep benzersiz numaralı`, new Set(titles.map((t) => ticketsWithTitle(t)[0]?.ticket_number)).size === 2);
      check(`${pageName}: modal kökü kabuk dışında kalıcı`, (await c.page.locator("body > #sv2-modal-root #sv2-create-ticket-modal").count()) === 1);
      check(`${pageName}: sayfa hatası yok`, c.errors.length === 0, c.errors.slice(0, 2).join(" | "));
      await c.context.close();
    }

    // ---- B) Çift Enter / hızlı çift tık (UX-04, SEN-28, MUS-11): tek kayıt
    const d = await srv.session("u_cust");
    await d.goto("/support-v2/customer/tickets.html");
    await d.page.waitForSelector("#sv2-tickets-table .sv2-table");
    await d.page.click("#sv2-new-ticket-btn");
    const dupTitle = `Çift Enter talebi ${Date.now()}`;
    await fillTicketForm(d.page, dupTitle);
    await d.page.focus("#sv2-create-ticket-title, #sv2-ticket-title");
    await d.page.keyboard.press("Enter");
    await d.page.keyboard.press("Enter");
    await sleep(1500);
    check("çift Enter: yalnız BİR talep oluştu", ticketsWithTitle(dupTitle).length === 1, String(ticketsWithTitle(dupTitle).length));

    await d.goto("/support-v2/customer/ticket-detail.html?id=t1");
    await d.page.waitForSelector("#sv2-send-reply");
    const replyText = `Çift tık yanıtı ${Date.now()}`;
    await d.page.fill("#sv2-reply-message", replyText);
    await d.page.focus("#sv2-send-reply");
    await d.page.keyboard.press("Enter");
    await d.page.keyboard.press("Enter");
    await d.page.keyboard.press("Space");
    await sleep(1800);
    const replies = () => Object.values(world.valueAt("v2/ticket_messages/t1") || {}).filter((m) => m.message === replyText);
    check("yanıt: Enter/Enter/Boşluk tekrarı tek mesaj üretti", replies().length === 1, String(replies().length));
    check("gönderilen yanıt taslağı geri yazılmadı (kutu boş)", (await d.page.inputValue("#sv2-reply-message")) === "");
    await d.page.fill("#sv2-reply-message", `Hızlı çift tık ${Date.now()}`);
    const second = await d.page.inputValue("#sv2-reply-message");
    await d.page.dblclick("#sv2-send-reply");
    await sleep(1800);
    check("yanıt: hızlı çift tık tek mesaj", Object.values(world.valueAt("v2/ticket_messages/t1") || {}).filter((m) => m.message === second).length === 1);

    // ---- C) DB okuma hatası enjeksiyonu: hata kartı + menü + "Yeniden dene" (UX-02, MUS-06, PER-35)
    const fails = [
      ["müşteri Taleplerim", "u_cust", "/support-v2/customer/tickets.html", "tickets"],
      ["müşteri Genel Bakış", "u_cust", "/support-v2/customer/dashboard.html", "tickets"],
      ["müşteri Profil", "u_cust", "/support-v2/customer/profile.html", "tickets"],
      ["müşteri talep detayı", "u_cust", "/support-v2/customer/ticket-detail.html?id=t1", "v2/tickets/t1"],
      ["personel Genel Bakış", "u_cons1", "/support-v2/admin/dashboard.html", "v2/tickets"],
      ["personel Ticketlar", "u_cons1", "/support-v2/admin/tickets.html", "v2/tickets"],
      ["personel Aktiviteler", "u_root", "/support-v2/admin/activities.html", "v2/activities"],
    ];
    for (const [name, uid, path, failPath] of fails) {
      const f = await srv.session(uid);
      await injectFaults(f.page, [{ op: "get", path: failPath === "tickets" ? "v2/tickets" : failPath }]);
      await f.goto(path);
      const card = await f.page.waitForSelector(".sv2-error-state", { timeout: 8000 }).then(() => true).catch(() => false);
      check(`${name}: okuma hatasında hata kartı`, card);
      const sidebar = await f.page.locator(".sv2-sidebar").count();
      check(`${name}: menü (kabuk) çizili`, sidebar === 1);
      const body = await f.page.evaluate(() => document.body.innerText);
      check(`${name}: geliştirici/Firebase metni yok, yanıltıcı boş durum yok`, !/Firebase|Rules|Console/.test(body) && !/Henüz talep oluşturmadınız|Henüz talebiniz yok|Henüz ticket kaydı yok/.test(body), body.slice(0, 160));
      if (name === "müşteri Taleplerim") {
        await f.page.evaluate(() => { window.__failRules = []; });
        await f.page.click("[data-sv2-retry]");
        check("Yeniden dene: liste yüklendi", await f.page.waitForSelector("#sv2-tickets-table .sv2-table", { timeout: 8000 }).then(() => true).catch(() => false));
        check("Yeniden dene: hata kartı kalktı", (await f.page.locator(".sv2-error-state").count()) === 0);
      }
      await f.context.close();
    }

    // yetkisiz / olmayan talep (MUS-07, SEN-06): anlaşılır mesaj + kabuk + geri bağlantısı
    for (const [name, uid, id] of [["başka firmanın talebi", "u_custB", "t1"], ["olmayan talep", "u_cust", "yok123"], ["geçersiz kimlik", "u_cust", "a.b"]]) {
      const u = await srv.session(uid);
      await u.goto(`/support-v2/customer/ticket-detail.html?id=${id}`);
      await u.page.waitForSelector(".sv2-error-state", { timeout: 8000 }).catch(() => {});
      const body = await u.page.evaluate(() => document.body.innerText);
      check(`${name}: anlaşılır mesaj, geliştirici metni yok`, /ulaşılamıyor/.test(body) && !/Firebase|Rules/.test(body), body.slice(0, 200));
      check(`${name}: kabuk ve 'Taleplerime dön' var`, (await u.page.locator(".sv2-sidebar").count()) === 1 && (await u.page.locator('.sv2-error-state a[href*="customer/tickets.html"]').count()) === 1);
      await u.context.close();
    }

    // ---- D) Derin bağlantı (MUS-10, EML-18, SEN-18): oturumsuz → girişe `next` ile; giriş sonrası hedef sayfa
    const anon = await srv.session(null);
    await anon.goto("/support-v2/customer/ticket-detail.html?id=t1");
    const toLogin = await waitFor(() => anon.page.url().includes("/login.html"), 20000);
    const loginUrl = new URL(anon.page.url());
    check("oturumsuz derin bağlantı girişe next ile yönlendirir", toLogin && loginUrl.searchParams.get("next") === "/support-v2/customer/ticket-detail.html?id=t1", anon.page.url());
    await anon.context.close();

    const nextTarget = encodeURIComponent("/support-v2/customer/ticket-detail.html?id=t1");
    const signed = await srv.session("u_cust");
    await signed.goto(`/support-v2/login.html?next=${nextTarget}`);
    check("oturumlu kullanıcı giriş sonrası hedef talep sayfasına gider", await waitFor(() => signed.page.url().includes("/customer/ticket-detail.html?id=t1"), 15000), signed.page.url());
    await signed.context.close();

    const staffSigned = await srv.session("u_cons1");
    await staffSigned.goto(`/support-v2/login.html?next=${nextTarget}`);
    check("personel müşteri bağlantısıyla gelirse aynı talebin personel sayfasına yönlenir", await waitFor(() => staffSigned.page.url().includes("/admin/ticket-detail.html?id=t1"), 15000), staffSigned.page.url());
    await staffSigned.context.close();

    for (const evil of ["https://evil.example/x", "//evil.example/x", "/support-v2/../index.html", "javascript:alert(1)", "/index.html"]) {
      const e = await srv.session("u_cust");
      await e.goto(`/support-v2/login.html?next=${encodeURIComponent(evil)}`);
      await waitFor(() => /dashboard\.html/.test(e.page.url()), 15000);
      check(`açık yönlendirme yok (${evil.slice(0, 24)})`, new URL(e.page.url()).origin === new URL(srv.base).origin && /\/support-v2\/customer\/dashboard\.html$/.test(new URL(e.page.url()).pathname), e.page.url());
      await e.context.close();
    }

    // zorunlu şifre değişimi: hedef korunur
    const must = await srv.session("u_new");
    await must.goto("/support-v2/customer/ticket-detail.html?id=t1");
    await must.page.waitForSelector("#sv2-change-password-form", { timeout: 15000 });
    check("zorunlu şifre değişiminde next korunur", new URL(must.page.url()).searchParams.get("next") === "/support-v2/customer/ticket-detail.html?id=t1", must.page.url());
    await must.page.fill("#sv2-cp-current", "Gecici1234");
    await must.page.fill("#sv2-cp-new", "YeniSifre123");
    await must.page.fill("#sv2-cp-new2", "YeniSifre123");
    await must.page.click("#sv2-cp-submit");
    await must.context.close();

    // ---- E) Oturum bitişi / başka sekmede çıkış (SEN-16)
    const ended = await srv.session("u_cust");
    await injectFaults(ended.page, []);
    await ended.goto("/support-v2/customer/tickets.html");
    await ended.page.waitForSelector("#sv2-tickets-table .sv2-table");
    await ended.page.evaluate(() => (window.__authCbs || []).forEach((cb) => cb(null)));
    check("oturum bitince girişe 'oturum sona erdi' ile yönlendirilir", await waitFor(() => /login\.html\?.*reason=expired/.test(ended.page.url()), 8000), ended.page.url());
    await ended.context.close();
    // (Firebase taklidinde oturum gerçekten kapanmadığından bant ayrı, oturumsuz bir sekmede doğrulanır.)
    const loginView = await srv.session(null);
    await loginView.goto("/support-v2/login.html?reason=expired");
    await loginView.page.waitForSelector("#sv2-login-form", { timeout: 15000 });
    check("giriş sayfasında 'oturum sona erdi' bandı görünür", await loginView.page.locator("#sv2-login-reason").isVisible().catch(() => false));
    await loginView.goto("/support-v2/login.html?reason=%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E");
    await loginView.page.waitForSelector("#sv2-login-form", { timeout: 15000 });
    check("bilinmeyen/zararlı reason parametresi basılmaz", (await loginView.page.locator("#sv2-login-reason").count()) === 0 && !(await loginView.page.evaluate(() => window.__xss)));
    await loginView.context.close();

    // ---- F) Çevrimdışı/askıda yazma zaman aşımı (MUS-21, SEN-24)
    const off = await srv.session("u_cust");
    await injectFaults(off.page, []);
    await off.goto("/support-v2/customer/ticket-detail.html?id=t1");
    await off.page.waitForSelector("#sv2-send-reply");
    await off.page.evaluate(() => { window.__SV2_WRITE_TIMEOUT_MS = 1200; window.__failRules = [{ op: "update", path: "v2", hang: true }]; });
    await off.page.fill("#sv2-reply-message", "Bağlantı koptu denemesi");
    const t0 = Date.now();
    await off.page.click("#sv2-send-reply");
    const sawTimeout = await off.page.waitForSelector(".sv2-toast-error", { timeout: 8000 }).then(() => true).catch(() => false);
    check("askıda yazma zaman aşımıyla sonlanır ve hata gösterir", sawTimeout && Date.now() - t0 < 7000);
    check("zaman aşımı iletisi bağlantıyı anlatır", /Bağlantı yok|zaman aşım/i.test((await off.page.locator(".sv2-toast-error").allTextContents()).join(" ")));
    check("yükleme katmanı kapandı, düğme yeniden etkin, taslak korunur", !(await off.page.locator(".sv2-loading-overlay.is-visible").count()) && (await off.page.isEnabled("#sv2-send-reply")) && (await off.page.inputValue("#sv2-reply-message")) === "Bağlantı koptu denemesi");
    await off.context.close();

    // ---- G) Pasif / rolsüz profil: girişe nedenle yönlendirme (MUS-09, SEC-30)
    world.seed("v2/users/u_inact", { uid: "u_inact", role: "customer", first_name: "Pasif", last_name: "Kişi", email: "pasif@ornekholding.com", company_id: "cA", company_name: "Örnek Holding A.Ş.", customer_code: "ORN", is_active: false, created_at: new Date().toISOString() });
    world.seed("v2/users/u_norole", { uid: "u_norole", first_name: "Rolsüz", last_name: "Kişi", email: "rolsuz@ornekholding.com", is_active: true, created_at: new Date().toISOString() });
    for (const [uid, reason] of [["u_inact", "inactive"], ["u_norole", "no_role"]]) {
      const p = await srv.session(uid);
      let navs = 0;
      p.page.on("framenavigated", (fr) => { if (fr === p.page.mainFrame()) navs += 1; });
      await p.goto("/support-v2/customer/dashboard.html");
      check(`${uid}: girişe ?reason=${reason} ile yönlendirilir`, await waitFor(() => p.page.url().includes(`reason=${reason}`), 15000), p.page.url());
      await sleep(1500);
      check(`${uid}: yönlendirme döngüsü yok ve bilgi bandı görünür`, navs <= 4 && (await p.page.locator("#sv2-login-reason").isVisible().catch(() => false)), `navs=${navs}`);
      await p.context.close();
    }
  } finally {
    await srv.close();
  }
}

(async () => {
  await resilienceSection(check);
  if (process.env.E2E_ONLY === "resilience") {
    results.forEach((r) => console.log(r.join(" | ")));
    console.log(`\n${results.filter((r) => r[0] === "PASS").length}/${results.length} geçti (yalnız dayanıklılık bölümü)`);
    process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
  }

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
    check("geçmişte durum değişimi TEK satır, notu aynı satırda (WP-06)", hist.filter((h) => h.field_changed === "status" && h.new_value === "pending_close").length === 1 && hist.some((h) => h.action === "status_note" && h.new_value === "pending_close" && /VKOA/.test(h.note)));
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
    check("gerekçe konuşmaya mesaj olarak eklendi (önce durum, sonra mesaj)", await waitFor(() => Object.values(world.valueAt("v2/ticket_messages/t1") || {}).some((m) => /Yeniden açma gerekçesi: Sorun yeni oluşturulan/.test(m.message) && m.author_role === "customer")));
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
    await staff.goto("/support-v2/admin/ticket-detail.html?id=t6"); // t6: u_cons1'e atanmış (atanmamış danışman yazamaz, D-08)
    await staff.page.waitForSelector("#sv2-reply-message");
    await staff.page.fill("#sv2-reply-message", "Dahili: müşteri kodunu kontrol et.");
    await staff.page.check("#sv2-reply-internal");
    await staff.page.click("#sv2-reply-send");
    check("iç not ticket_internal_notes düğümüne yazıldı", await waitFor(() => Object.values(world.valueAt("v2/ticket_internal_notes/t6") || {}).some((n) => /müşteri kodunu/.test(n.message))));
    check("iç not herkese açık mesajlarda yok", !Object.values(world.valueAt("v2/ticket_messages/t6") || {}).some((m) => /müşteri kodunu/.test(m.message)));
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
