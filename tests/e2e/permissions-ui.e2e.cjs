/**
 * E2E: yazma düğmeleri yalnızca yazma yetkisi olan rollerde görünür (database.rules.json ile uyumlu).
 * Çalıştırma: node tests/e2e/permissions-ui.e2e.cjs
 */
const { createWorld, startServer } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${ok ? "" : " | " + (detail || "")}`);
}

// [sayfa, bekleme seçicisi, kontrol edilen düğme, yazma yetkisi olan roller]
const PAGES = [
  ["/support-v2/admin/companies.html", "#btn-new-company", ["u_root", "u_service"]],
  ["/support-v2/admin/company-detail.html?id=cA", "#btn-edit-company", ["u_root", "u_service"]],
  ["/support-v2/admin/personnel.html", "#btn-new-personnel", ["u_root", "u_service"]],
  ["/support-v2/admin/personnel-detail.html?id=p1", "#btn-edit-person", ["u_root", "u_service"]],
  ["/support-v2/admin/contracts.html", "#btn-new-contract", ["u_root", "u_service"]],
  ["/support-v2/admin/projects.html", "#btn-new-project", ["u_root", "u_service", "u_pm"]],
  ["/support-v2/admin/departments.html", "#btn-new-dept", ["u_root"]],
  ["/support-v2/admin/modules.html", "#btn-new-module", ["u_root"]],
  ["/support-v2/admin/support-types.html", "#btn-new-type", ["u_root"]],
  ["/support-v2/admin/departments.html", ".btn-edit", ["u_root"]],
  ["/support-v2/admin/modules.html", ".btn-edit", ["u_root"]],
  ["/support-v2/admin/support-types.html", ".btn-edit", ["u_root"]],
  ["/support-v2/admin/dashboard.html", ".sv2-quick-assign", ["u_root", "u_service", "u_pm"]],
];
const ROLES = ["u_root", "u_service", "u_pm", "u_cons1"];

(async () => {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);
  try {
    for (const uid of ROLES) {
      const s = await srv.session(uid);
      for (const [url, selector, allowed] of PAGES) {
        s.errors.length = 0;
        await s.goto(url);
        await s.page.waitForSelector(".sv2-content", { timeout: 10000 });
        await s.page.waitForTimeout(600);
        const count = await s.page.locator(selector).count();
        const expected = allowed.includes(uid);
        check(`${uid} ${url.split("/").pop().split("?")[0]} ${selector} ${expected ? "görünür" : "gizli"}`, expected ? count > 0 : count === 0, `bulunan=${count}`);
        if (s.errors.length) check(`${uid} ${url} sayfa hatası yok`, false, s.errors.join(" | "));
      }
      await s.context.close();
    }
  } finally {
    await srv.close();
  }
  console.log(`\n${pass}/${pass + fail} geçti`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
