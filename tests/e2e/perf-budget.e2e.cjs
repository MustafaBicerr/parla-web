/**
 * E2E: ön yüz yük bütçesi (WP-12/13; UX-38/39/48, ALT-18, SEC-27, OLC-16).
 *  - Üçüncü taraf CDN'den simge CSS'i/yazı tipi YOK (Font Awesome yerel alt küme, font-display: swap);
 *  - logo portal boyutunda küçük dosya (136 KB'lık özgün PNG portalda istenmez);
 *  - favicon 200 (sekme simgesi), `/favicon.ico` var;
 *  - sayfa başına aynı kökenli aktarım ve CSS bütçeleri.
 * Çalıştırma: node tests/e2e/perf-budget.e2e.cjs [--verbose]
 */
const fs = require("node:fs");
const path = require("node:path");
const { createWorld, startServer, ROOT } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const verbose = process.argv.includes("--verbose");
const results = [];
const check = (name, ok, extra) => results.push([ok ? "PASS" : "FAIL", name, ok ? "" : extra || ""]);
const KB = 1024;

const PAGES = [
  ["u_cust", "/support-v2/customer/dashboard.html"],
  ["u_cust", "/support-v2/customer/tickets.html"],
  ["u_root", "/support-v2/admin/tickets.html"],
  ["u_root", "/support-v2/admin/dashboard.html"],
  [null, "/support-v2/login.html"],
];

(async () => {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);
  try {
    for (const [uid, url] of PAGES) {
      const s = await srv.session(uid);
      const own = [];
      const external = [];
      s.page.on("request", (r) => {
        const u = new URL(r.url());
        if (u.origin !== srv.base && /^https?:$/.test(u.protocol)) external.push(u.host + u.pathname);
      });
      s.page.on("response", async (r) => {
        try {
          const u = new URL(r.url());
          if (u.origin === srv.base) own.push({ path: u.pathname, bytes: (await r.body()).length, status: r.status() });
        } catch {
          /* gövde okunamadı */
        }
      });
      await s.goto(url);
      await s.page.waitForTimeout(1500);
      const total = own.reduce((a, r) => a + r.bytes, 0);
      if (verbose) console.log(`  · ${url}: ${(total / KB).toFixed(0)} KB, ${own.length} istek`);
      check(`aynı kökenli aktarım ≤ 600 KB ${url}`, total <= 600 * KB, `${(total / KB).toFixed(0)} KB`);
      check(`simge CSS'i/yazı tipi 3. taraf CDN'den gelmez ${url}`, !external.some((h) => /cdnjs\.cloudflare\.com|fontawesome|fonts\.(googleapis|gstatic)\.com/.test(h)), external.join(", "));
      check(`orijinal 136 KB logo portal sayfasında istenmez ${url}`, !own.some((r) => /parla-logo\/parla-logo\.png$/.test(r.path)), JSON.stringify(own.filter((r) => /logo/.test(r.path))));
      const logos = own.filter((r) => /parla-logo/.test(r.path));
      check(`logo ≤ 25 KB ${url}`, logos.length > 0 && logos.every((r) => r.bytes <= 25 * KB), JSON.stringify(logos));
      const fa = own.filter((r) => /vendor\/fontawesome/.test(r.path));
      check(`Font Awesome yerel alt küme ≤ 16 KB (CSS+yazı tipi) ${url}`, fa.length >= 2 && fa.reduce((a, r) => a + r.bytes, 0) <= 16 * KB, JSON.stringify(fa));
      check(`favicon 200 ${url}`, own.some((r) => /favicon\.svg$/.test(r.path) && r.status === 200), JSON.stringify(own.filter((r) => /favicon/.test(r.path))));
      check(`CSS ≤ 100 KB ${url}`, (own.find((r) => /support-v2\.css$/.test(r.path)) || { bytes: 0 }).bytes <= 100 * KB);
      // simgeler gerçekten çizilir: yazı tipi yüklendi ve ilk simge boş değil
      const iconOk = await s.page.evaluate(async () => {
        await document.fonts.ready;
        const i = document.querySelector("i.fas");
        if (!i) return true;
        return getComputedStyle(i).fontFamily.includes("Font Awesome") && [...document.fonts].some((f) => f.family.includes("Font Awesome") && f.status === "loaded");
      });
      check(`simge yazı tipi yüklenir ${url}`, iconOk);
      await s.context.close();
    }
    const css = fs.readFileSync(path.join(ROOT, "assets/vendor/fontawesome/fa-subset.css"), "utf8");
    check("FA alt küme: font-display: swap", /font-display:\s*swap/.test(css));
    check("kök /favicon.ico dosyası var", fs.existsSync(path.join(ROOT, "favicon.ico")));
    const html = fs.readdirSync(path.join(ROOT, "support-v2"), { recursive: true }).filter((f) => f.endsWith(".html") && !f.startsWith("docs"));
    const missing = html.filter((f) => !/rel="icon"/.test(fs.readFileSync(path.join(ROOT, "support-v2", f), "utf8")));
    check("tüm portal sayfalarında <link rel=icon>", missing.length === 0, missing.join(", "));
    const titles = html.map((f) => (/<title>([^<]*)<\/title>/.exec(fs.readFileSync(path.join(ROOT, "support-v2", f), "utf8")) || [])[1]);
    check("<title> değerleri 'Ad | Parla BT Destek' biçiminde, 'V2' eki yok (UX-40)", titles.every((t) => /^[^|]+ \| Parla BT Destek$/.test(t || "")), titles.join("; "));
    const dupes = titles.filter((t, i) => titles.indexOf(t) !== i);
    check("sayfa başlıkları benzersiz (genel bakış yönetici/müşteri hariç)", dupes.every((t) => /^Genel Bakış|^Talep Detayı/.test(t)), dupes.join(", "));
  } finally {
    await srv.close();
  }
  results.forEach((r) => (verbose || r[0] === "FAIL" ? console.log(r.join(" | ")) : null));
  const fails = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - fails}/${results.length} geçti`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
