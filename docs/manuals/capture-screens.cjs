/**
 * Kılavuz ekran görüntülerini üretir: gerçek portal arayüzü + gerçek kurallar + demo veri
 * (tests/e2e harness + seed). Pin koordinatları (%) her görüntünün yanına .json olarak yazılır.
 *
 * Kullanım:  node docs/manuals/capture-screens.cjs [user|admin|all]
 * Gerekenler: cd tests/rules && npm install ; cd docs/manuals && npm install ; Playwright + Chromium
 */
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..", "..");
const { createWorld, startServer } = require(path.join(ROOT, "tests", "e2e", "harness.cjs"));
const { buildSeed } = require(path.join(ROOT, "tests", "e2e", "seed.cjs"));
const FA = path.join(__dirname, "node_modules", "@fortawesome", "fontawesome-free");

const which = process.argv[2] || "all";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(page, extra) {
  await page.waitForFunction(() => !document.querySelector(".sv2-loading-overlay.is-visible"), null, { timeout: 10000 }).catch(() => {});
  await sleep(extra || 450);
}

/** Bir öğenin görüntü içindeki konumunu (%) hesaplar. anchor: c | tl | tr | bl | br | l | r | t | b */
function pinPoint(box, clip, anchor) {
  const pt = {
    c: [box.x + box.width / 2, box.y + box.height / 2],
    tl: [box.x, box.y], tr: [box.x + box.width, box.y], bl: [box.x, box.y + box.height], br: [box.x + box.width, box.y + box.height],
    l: [box.x, box.y + box.height / 2], r: [box.x + box.width, box.y + box.height / 2],
    t: [box.x + box.width / 2, box.y], b: [box.x + box.width / 2, box.y + box.height],
  }[anchor || "c"];
  return { left: +(((pt[0] - clip.x) / clip.width) * 100).toFixed(1), top: +(((pt[1] - clip.y) / clip.height) * 100).toFixed(1) };
}

async function main() {
  const world = createWorld(buildSeed());
  const srv = await startServer(world, { fontAwesomeDir: FA });
  const sessions = new Map();
  const get = async (uid, w, h, scale) => {
    const key = `${uid}|${w}x${h}@${scale}`;
    if (!sessions.has(key)) sessions.set(key, await srv.session(uid, { viewport: { width: w, height: h }, deviceScaleFactor: scale }));
    return sessions.get(key);
  };
  let count = 0;

  /**
   * spec: { guide, name, as, url, vp:[w,h], scale, before(page,world), target (selector | null), pad, hide:[selectors], pins:{ n: [selector, anchor, index?] } }
   */
  async function shot(spec) {
    const [w, h] = spec.vp || [1100, 700];
    const s = await get(spec.as === undefined ? "u_cust" : spec.as, w, h, spec.scale || 1.6);
    const page = s.page;
    if (spec.url) {
      await s.goto(spec.url);
      await page.waitForSelector(spec.wait || ".sv2-content, .sv2-auth-wrap", { timeout: 10000 }).catch(() => {});
      await settle(page, spec.settle);
    }
    if (spec.before) { await spec.before(page, world); await settle(page, 300); }
    for (const sel of spec.hide || []) await page.addStyleTag({ content: `${sel}{visibility:hidden !important}` });

    let clip;
    if (spec.target) {
      const loc = page.locator(spec.target).first();
      await loc.scrollIntoViewIfNeeded();
      await sleep(150);
      const b = await loc.boundingBox();
      const pad = spec.pad === undefined ? 12 : spec.pad;
      clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
      clip.width = Math.min(clip.width, w - clip.x);
    } else {
      clip = { x: 0, y: 0, width: w, height: h };
    }
    const dir = path.join(__dirname, "content", spec.guide, "screens");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${spec.name}.png`);
    await page.screenshot({ path: file, clip, animations: "disabled" });

    const pins = {};
    for (const [n, def] of Object.entries(spec.pins || {})) {
      const [sel, anchor, idx] = def;
      const loc = idx !== undefined ? page.locator(sel).nth(idx) : page.locator(sel).first();
      if (!(await loc.count())) { console.warn(`  ! pin ${n} için öğe yok: ${sel}`); continue; }
      const b = await loc.boundingBox();
      if (b) pins[n] = pinPoint(b, clip, anchor);
    }
    fs.writeFileSync(file.replace(/\.png$/, ".json"), JSON.stringify({ size: [Math.round(clip.width * (spec.scale || 1.6)), Math.round(clip.height * (spec.scale || 1.6))], pins }, null, 2));
    for (const sel of spec.hide || []) { /* stil kalıcı; sonraki çekimlerde sayfa yeniden yüklenir */ }
    count += 1;
    console.log(`  ✓ ${spec.guide}/${spec.name}`);
  }

  /** E-posta şablonunu (netlify/lib/email-templates) gerçek görünümüyle çeker. */
  async function emailShot(guide, name, type, data) {
    const { buildEmail } = require(path.join(ROOT, "netlify", "lib", "email-templates.js"));
    const built = buildEmail(type, data);
    const s = await get(null, 760, 900, 2);
    await s.page.route("**/assets/img/parla-logo/**", (r) => r.fulfill({ contentType: "image/png", body: fs.readFileSync(path.join(ROOT, "assets/img/parla-logo/parla-logo.png")) }));
    await s.page.route("https://www.parlabilgiteknolojileri.net/assets/img/parla-logo/parla-logo.png", (r) => r.fulfill({ contentType: "image/png", body: fs.readFileSync(path.join(ROOT, "assets/img/parla-logo/parla-logo.png")) }));
    await s.page.setContent(built.html, { waitUntil: "load" });
    await sleep(300);
    const dir = path.join(__dirname, "content", guide, "screens");
    fs.mkdirSync(dir, { recursive: true });
    await s.page.locator('table[width="600"]').first().screenshot({ path: path.join(dir, `${name}.png`) });
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ subject: built.subject }, null, 2));
    count += 1;
    console.log(`  ✓ ${guide}/${name} (e-posta: ${built.subject})`);
  }

  const specs = require("./capture-specs.cjs");
  const todo = which === "all" ? ["user", "admin"] : [which];
  for (const guide of todo) {
    console.log(`\n== ${guide} kılavuzu ekran görüntüleri ==`);
    if (specs[guide]) await specs[guide]({ shot, emailShot, world, get, sleep, settle, srv });
  }
  console.log(`\n${count} görüntü üretildi.`);
  await srv.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
