/**
 * E2E duman testi: her rol, erişebileceği tüm sayfaları açar; sayfa hatası, hata toast'ı ve beklenmeyen
 * PERMISSION_DENIED olmamalı. Çalıştırma: node tests/e2e/smoke-all.e2e.cjs [--verbose]
 */
const fs = require("node:fs");
const path = require("node:path");
const { createWorld, startServer, ROOT } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const verbose = process.argv.includes("--verbose");
const adminPages = fs.readdirSync(path.join(ROOT, "support-v2/admin")).map((f) => `/support-v2/admin/${f}`);
const customerPages = fs.readdirSync(path.join(ROOT, "support-v2/customer")).map((f) => `/support-v2/customer/${f}`);
const query = { "ticket-detail.html": "?id=t1", "company-detail.html": "?id=cA", "personnel-detail.html": "?id=p1", "project-detail.html": "?id=pr1", "user-detail.html": "?uid=u_cust" };
const extra = ["/support-v2/change-password.html"];

// Rol -> açılması beklenen sayfalar. Yönetici sayfalarında bazı roller kısıtlıdır (kurallarla uyumlu).
const matrix = [
  { uid: "u_root", pages: [...adminPages, ...extra] },
  { uid: "u_service", pages: [...adminPages, ...extra] },
  { uid: "u_pm", pages: adminPages.filter((p) => !/users\.html|user-detail/.test(p)) },
  { uid: "u_cons1", pages: adminPages.filter((p) => !/users\.html|user-detail/.test(p)) },
  { uid: "u_cust", pages: [...customerPages, ...extra] },
  { uid: "u_cadmin", pages: customerPages },
];

(async () => {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);
  let bad = 0;
  let total = 0;
  try {
    for (const { uid, pages } of matrix) {
      const s = await srv.session(uid);
      for (const p of pages) {
        total += 1;
        s.errors.length = 0;
        world.denied.length = 0;
        const file = p.split("/").pop();
        await s.goto(p + (query[file] || ""));
        await s.page.waitForTimeout(700);
        const rendered = await s.page.evaluate(() => !!document.querySelector(".sv2-content, .sv2-auth-wrap"));
        const toasts = await s.page.locator(".sv2-toast-error").allTextContents();
        // Bilinen/yakalanan: danışman/PM için kullanıcı listesi okuması (sayfalar .catch ile dayanıklı)
        const denied = world.denied.filter((d) => !(d.path === "/v2/users" && !["u_root", "u_service"].includes(d.uid)));
        const ok = rendered && !s.errors.length && !toasts.length && !denied.length;
        if (!ok) bad += 1;
        if (!ok || verbose) {
          console.log(`${ok ? "OK  " : "FAIL"} [${uid}] ${p}${s.errors.length ? "  " + s.errors.slice(0, 2).join(" | ") : ""}${toasts.length ? "  toast: " + toasts.join(" | ") : ""}${denied.length ? "  denied: " + JSON.stringify(denied.slice(0, 2)) : ""}${rendered ? "" : "  (render yok)"}`);
        }
      }
      await s.context.close();
    }
  } finally {
    await srv.close();
  }
  console.log(`\n${total - bad}/${total} sayfa temiz`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
