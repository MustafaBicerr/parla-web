/**
 * E2E: PDF kılavuz bağlantıları (giriş sayfası, kenar menü, üst çubuk) ve dosyaların sunulması.
 * Çalıştırma: node tests/e2e/guides.e2e.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { createWorld, startServer, ROOT } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const USER_PDF = "/support-v2/docs/Kullanici-Kilavuzu.pdf";
const ADMIN_PDF = "/support-v2/docs/Sistem-Adminleri-Kullanim-Kilavuzu.pdf";
let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${ok ? "" : " | " + (detail || "")}`);
}

(async () => {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);
  try {
    // 1) Dosyalar yayında ve gerçekten PDF
    for (const f of [USER_PDF, ADMIN_PDF]) {
      const file = path.join(ROOT, f);
      const exists = fs.existsSync(file);
      check(`${f} dosyası mevcut`, exists);
      if (exists) {
        const head = fs.readFileSync(file).subarray(0, 5).toString();
        const size = fs.statSync(file).size;
        check(`${f} geçerli PDF (${Math.round(size / 1024)} KB)`, head === "%PDF-" && size > 200 * 1024 && size < 14 * 1024 * 1024, head + " " + size);
      }
    }

    // 2) Giriş sayfası
    const anon = await srv.session(null);
    await anon.goto("/support-v2/login.html");
    await anon.page.waitForSelector("#sv2-auth-guides");
    const attr = (sel, a) => anon.page.getAttribute(sel, a);
    check("giriş: kullanıcı kılavuzu 'Aç' bağlantısı", (await attr("#sv2-guide-user-open", "href")) === USER_PDF && (await attr("#sv2-guide-user-open", "target")) === "_blank");
    check("giriş: kullanıcı kılavuzu 'İndir' bağlantısı", (await attr("#sv2-guide-user-dl", "href")) === USER_PDF && !!(await attr("#sv2-guide-user-dl", "download")));
    check("giriş: sistem adminleri kılavuzu bağlantıları", (await attr("#sv2-guide-admin-open", "href")) === ADMIN_PDF && (await attr("#sv2-guide-admin-dl", "href")) === ADMIN_PDF);
    const res = await anon.page.request.get(srv.base + USER_PDF);
    check("giriş: PDF HTTP 200 + application/pdf", res.status() === 200 && /pdf/.test(res.headers()["content-type"] || ""), res.status() + " " + res.headers()["content-type"]);
    check("giriş: sayfa hatası yok", anon.errors.length === 0, anon.errors.join(" | "));
    await anon.context.close();

    // 3) Müşteri: yalnızca kullanıcı kılavuzu
    const cust = await srv.session("u_cust");
    await cust.goto("/support-v2/customer/dashboard.html");
    await cust.page.waitForSelector("#sv2-sidebar");
    const custLinks = await cust.page.locator("#sv2-sidebar .sv2-nav-guide-open").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    check("müşteri: menüde yalnızca kullanıcı kılavuzu", custLinks.length === 1 && custLinks[0] === USER_PDF, JSON.stringify(custLinks));
    const custDl = await cust.page.locator("#sv2-sidebar .sv2-nav-guide-dl").evaluateAll((els) => els.map((e) => [e.getAttribute("href"), e.getAttribute("download")]));
    check("müşteri: menüde indirme bağlantısı", custDl.length === 1 && custDl[0][0] === USER_PDF && !!custDl[0][1], JSON.stringify(custDl));
    check("müşteri: üst çubukta kılavuz bağlantısı", (await cust.page.getAttribute("#sv2-topbar-guide", "href")) === USER_PDF);
    check("müşteri: 'Kılavuzlar' menü bölümü diğer menüleri bozmadı", (await cust.page.locator("#sv2-sidebar .sv2-nav-item[data-page]").count()) === 3);
    // gerçek indirme
    const [download] = await Promise.all([cust.page.waitForEvent("download"), cust.page.click("#sv2-sidebar .sv2-nav-guide-dl")]);
    check("müşteri: indirme dosya adı", download.suggestedFilename() === "Parla-BT-Kullanici-Kilavuzu.pdf", download.suggestedFilename());
    check("müşteri: sayfa hatası yok", cust.errors.length === 0, cust.errors.join(" | "));
    await cust.context.close();

    // 4) Personel: iki kılavuz
    const staff = await srv.session("u_cons1");
    await staff.goto("/support-v2/admin/dashboard.html");
    await staff.page.waitForSelector("#sv2-sidebar");
    const staffLinks = await staff.page.locator("#sv2-sidebar .sv2-nav-guide-open").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    check("personel: menüde iki kılavuz (admin önce)", staffLinks.length === 2 && staffLinks[0] === ADMIN_PDF && staffLinks[1] === USER_PDF, JSON.stringify(staffLinks));
    check("personel: üst çubuk sistem adminleri kılavuzuna gider", (await staff.page.getAttribute("#sv2-topbar-guide", "href")) === ADMIN_PDF);
    check("personel: sayfa hatası yok", staff.errors.length === 0, staff.errors.join(" | "));
    await staff.context.close();
  } finally {
    await srv.close();
  }
  console.log(`\n${pass}/${pass + fail} geçti`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
