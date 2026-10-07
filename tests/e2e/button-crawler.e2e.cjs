/**
 * E2E: düğme tarayıcısı (WP-15; rapor "düğme tarayıcısı tüm rollerle"). Her rol, erişebildiği her portal sayfasında GÖRÜNÜR ve
 * etkin her düğmeye (sayfa başına en çok --max, varsayılan 30) tıklar; ardından açılan pencere/onay kapatılır (onaylar İPTAL
 * edilir, yerel `confirm/alert` reddedilir) ve şunlar aranır:
 *   - yakalanmamış sayfa hatası / konsol hatası / same-origin 4xx-5xx (harness `errors`);
 *   - beklenmeyen PERMISSION_DENIED (arayüz rolün yazamayacağı bir düğmeyi göstermemeli; smoke-all ile aynı istisna listesi);
 *   - sayfanın çökmesi (içerik kabuğu kaybolması).
 * Sayfalar arası yalıtım için her sayfadan sonra veritabanı bu sayfa öncesi anlık görüntüye döndürülür.
 * Doğrulama (assert) gereken ayrıntılar işlev e2e'lerindedir; bu test "hiçbir düğme sayfayı bozmaz" güvence testidir.
 *
 * Çalıştırma: node tests/e2e/button-crawler.e2e.cjs [--roles u_root,u_cust] [--max 30] [--verbose]
 */
const fs = require("node:fs");
const path = require("node:path");
const { createWorld, startServer, ROOT } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const verbose = argv.includes("--verbose");
const MAX = Number(opt("--max", 30));

const adminPages = fs.readdirSync(path.join(ROOT, "support-v2/admin")).map((f) => `/support-v2/admin/${f}`);
const customerPages = fs.readdirSync(path.join(ROOT, "support-v2/customer")).map((f) => `/support-v2/customer/${f}`);
const query = { "ticket-detail.html": "?id=t1", "company-detail.html": "?id=cA", "personnel-detail.html": "?id=p1", "project-detail.html": "?id=pr1", "user-detail.html": "?uid=u_cust" };
const staffOnly = (p) => !/users\.html|user-detail/.test(p);
const matrix = [
  { uid: "u_root", pages: adminPages },
  { uid: "u_service", pages: adminPages },
  { uid: "u_pm", pages: adminPages.filter(staffOnly) },
  { uid: "u_cons1", pages: adminPages.filter(staffOnly) },
  { uid: "u_cust", pages: customerPages },
  { uid: "u_cadmin", pages: customerPages },
].filter((m) => !opt("--roles", "") || opt("--roles", "").split(",").includes(m.uid));

// Tıklanmayacaklar: oturumu kapatma (sayfadan çıkarır) ve harici bağlantılar.
const SKIP_TEXT = /çıkış|oturumu kapat/i;

/** Görünür, etkin düğmeleri sırayla etiketler (data-crawl) ve etiket listesi döndürür. */
const TAG = () => {
  const out = [];
  const seen = new Set();
  document.querySelectorAll("button").forEach((b) => {
    b.removeAttribute("data-crawl");
    if (b.disabled || b.getAttribute("aria-disabled") === "true" || b.closest("[inert]") || b.closest(".sv2-modal-overlay")) return;
    const r = b.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || getComputedStyle(b).visibility === "hidden") return;
    const label = (b.getAttribute("aria-label") || b.textContent || b.id || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const key = `${b.id}|${label}|${b.className}`;
    if (seen.has(key)) return; // aynı düğmeden satır başına bir örnek yeter
    seen.add(key);
    b.setAttribute("data-crawl", String(out.length));
    out.push(label || "(etiketsiz)");
  });
  return out;
};

async function closeOverlays(page) {
  for (let i = 0; i < 4; i++) {
    const confirmOpen = await page.locator("#sv2-confirm-overlay.is-open").count();
    if (confirmOpen) {
      const cancel = page.locator("#sv2-confirm-overlay.is-open [data-close], #sv2-confirm-overlay.is-open .sv2-btn-secondary").first();
      if (await cancel.count()) await cancel.click({ timeout: 1500 }).catch(() => {});
      else await page.keyboard.press("Escape");
    } else if (await page.locator(".sv2-modal-overlay.is-open").count()) {
      await page.keyboard.press("Escape");
    } else break;
    await page.waitForTimeout(60);
  }
}

(async () => {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);
  let clicks = 0;
  let bad = 0;
  const failures = [];
  try {
    for (const { uid, pages } of matrix) {
      const s = await srv.session(uid);
      s.page.on("dialog", (d) => d.dismiss().catch(() => {}));
      for (const p of pages) {
        const file = p.split("/").pop();
        const url = p + (query[file] || "");
        const snapshot = world.db;
        const open = async () => {
          s.errors.length = 0;
          await s.goto(url);
          await s.page.waitForSelector(".sv2-content", { timeout: 8000 }).catch(() => {});
          await s.page.waitForTimeout(500);
        };
        await open();
        let labels = await s.page.evaluate(TAG);
        const total = Math.min(labels.length, MAX);
        for (let i = 0; i < total; i++) {
          if (SKIP_TEXT.test(labels[i])) continue;
          s.errors.length = 0;
          world.denied.length = 0;
          const target = s.page.locator(`[data-crawl="${i}"]`);
          if (!(await target.count())) continue; // yeniden çizimle kayboldu
          clicks += 1;
          try {
            await target.click({ timeout: 2000, noWaitAfter: true });
          } catch {
            continue; // tıklanamıyor (örtülü/yeniden çizim): hata sayılmaz
          }
          await s.page.waitForTimeout(150);
          const navigated = new URL(s.page.url()).pathname !== p;
          await closeOverlays(s.page);
          const alive = await s.page.evaluate(() => !!document.querySelector(".sv2-content, .sv2-auth-wrap")).catch(() => false);
          const denied = world.denied.filter((d) => !(d.path === "/v2/users" && !["u_root", "u_service"].includes(d.uid)));
          const problems = [...s.errors.slice(0, 2), ...denied.slice(0, 2).map((d) => `denied ${d.op} ${d.path}`), ...(alive || navigated ? [] : ["sayfa çöktü (içerik kabuğu yok)"])];
          if (problems.length) {
            bad += 1;
            failures.push(`[${uid}] ${url} → "${labels[i]}": ${problems.join(" | ")}`);
          } else if (verbose) console.log(`OK   [${uid}] ${url} → "${labels[i]}"`);
          if (navigated) {
            await open();
            labels = await s.page.evaluate(TAG);
          } else if (!(await s.page.locator(`[data-crawl="${i}"]`).count())) {
            // Yeniden çizim işaretleri sildi: sıradaki düğmeler için yeniden etiketle (sıra korunur)
            const again = await s.page.evaluate(TAG);
            if (again.length) labels = again;
          }
        }
        world.db = snapshot; // sayfa yalıtımı: bu sayfanın yazdıkları geri alınır
      }
      await s.context.close();
    }
  } finally {
    await srv.close();
  }
  failures.slice(0, 60).forEach((f) => console.log("FAIL | " + f));
  console.log(`\n${clicks - bad}/${clicks} tıklama temiz (${matrix.length} rol)`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
