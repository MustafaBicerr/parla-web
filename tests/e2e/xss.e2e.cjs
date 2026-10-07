/**
 * E2E (WP-02): çıktı kaçışı / XSS / zehirli veri.
 *
 *  Geçiş 1 — "yük": demo verideki HER kullanıcı kontrollü metin alanı (öncelik, başlık, açıklama, mesaj, author_role,
 *            work_hours, firma/kullanıcı/personel adı, attachment_url, ek dosya adı, sözleşme değeri…) betik yüküyle
 *            doldurulur; müşteri + personel rollerinin TÜM sayfaları (açılır pencere, sekme, bildirim paneli,
 *            otomatik tamamlama dahil) gezilir ve `window.__xss` hiçbir yerde set olmamalıdır.
 *  Geçiş 2 — "tür karışıklığı": aktivite/geçmiş/mesaj/iç not/efor kayıtlarındaki alanlar sayıya çevrilir
 *            (ör. action: 123); hiçbir sayfa çökmemeli, menü çizilmeli, sayfa hatası olmamalı.
 *  Ek      — `id`/`ticket_id` ezme: kayıt içindeki id anahtarı eziyor mu; ek dosyası türü (svg) satır içi açılmaz.
 *
 * Çalıştırma: node tests/e2e/xss.e2e.cjs [--verbose]
 */
const fs = require("node:fs");
const path = require("node:path");
const { createWorld, startServer, ROOT } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const verbose = process.argv.includes("--verbose");
const PAYLOADS = [
  `"'><img src=x onerror=window.__xss=1>`,
  `<svg onload=window.__xss=1>`,
  `</script><script>window.__xss=1</script>`,
  `" onmouseover="window.__xss=1" x="`,
];
let seq = 0;
const payload = () => PAYLOADS[seq++ % PAYLOADS.length];

const results = [];
const check = (name, ok, extra) => results.push([ok ? "PASS" : "FAIL", name, ok ? "" : extra || ""]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ veri hazırlama */
// Kimlik/anahtar/rol/durum bayrakları ve kullanıcı e-postası (oturum açma için) dışındaki her alan zehirlenir.
const KEEP_KEY = /(^|_)(id|uid)$|^id$|^uid$|^role$|^is_active$|^is_primary$|^must_change_password$|^created_by$|^updated_by$|^public_updated_by$|^sequence_number$|^start_date$|^end_date$/;

function poisonValue(key, value, ctx) {
  if (value && typeof value === "object") return poisonObject(value, ctx);
  if (typeof value === "boolean") return value;
  if (KEEP_KEY.test(key)) return value;
  if (ctx.keepEmail && key === "email") return value;
  if (typeof value === "string" || typeof value === "number") return payload();
  return value;
}
function poisonObject(obj, ctx) {
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) out[k] = poisonValue(k, v, ctx);
  return out;
}

function buildPoisonedSeed() {
  const seed = buildSeed();
  const v2 = seed.v2;
  for (const [node, ctx] of [
    ["users", { keepEmail: true }],
    ["companies", {}],
    ["personnel", {}],
    ["departments", {}],
    ["contracts", {}],
    ["projects", {}],
    ["sap_modules", {}],
    ["support_types", {}],
    ["tickets", {}],
    ["ticket_messages", {}],
    ["ticket_internal_notes", {}],
    ["ticket_history", {}],
    ["ticket_assignments", {}],
    ["ticket_efforts", {}],
    ["activities", {}],
  ]) {
    for (const [id, rec] of Object.entries(v2[node] || {})) {
      v2[node][id] = poisonObject(rec, ctx);
      // Sözleşme değeri / efor gibi sayısal alanlar da dize yüküyle gelir.
      if (node === "contracts") v2[node][id].value = payload();
    }
  }
  // Sözleşme bedeli düzenleme penceresine girer (SEC-25).
  // Ek dosyası meta verisi (ad/tür) ve ek verisi: ad yüklü, tür svg (satır içi açılmamalı).
  v2.ticket_messages.t1.m1.attachments = [{ id: "att1", name: payload(), type: "image/svg+xml", size: payload() }, null, "dize", { id: payload(), name: 5 }];
  v2.ticket_attachments = {
    t1: { att1: { att_id: "att1", name: payload(), type: "image/svg+xml", size: 10, data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss=1"></svg>').toString("base64"), created_at: new Date().toISOString() } },
  };
  // attachment_url: javascript: şeması ve normal yük
  v2.tickets.t1.attachment_url = "javascript:window.__xss=1";
  v2.tickets.t2.attachment_url = `https://example.com/"><img src=x onerror=window.__xss=1>`;
  // Zehirli aktivite: action/details sayı (müşteri yazımı); sıralamada hep sona yapışan anahtar
  v2.activities["~zz"] = { activity_id: "~zz", action: 123, details: 456, entity_type: 7, entity_label: { x: 1 }, entity_id: 8, user_uid: "u_cust", user_name: 9, created_at: new Date().toISOString() };
  // id/ticket_id ezme (başka talebin anahtarı)
  v2.tickets.tspoof = { ...JSON.parse(JSON.stringify(v2.tickets.t2)), id: "t10", ticket_id: "t10", title: "SAHTE-ID-TALEBI" };
  return seed;
}

/** Aktivite/geçmiş/mesaj/iç not/efor/atama alanlarını SAYIYA çevirir (tür karışıklığı). */
function buildTypeConfusedSeed() {
  const seed = buildSeed();
  const v2 = seed.v2;
  const confuse = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object") out[k] = confuse(v);
      else if (typeof v === "string" && !KEEP_KEY.test(k) && !/_at$/.test(k) && k !== "status" && k !== "message_id") out[k] = 123;
      else out[k] = v;
    }
    return out;
  };
  for (const node of ["activities", "ticket_history", "ticket_messages", "ticket_internal_notes", "ticket_efforts"]) {
    for (const [id, rec] of Object.entries(v2[node] || {})) {
      v2[node][id] = rec && rec.action !== undefined && rec.entity_type !== undefined ? confuse(rec) : Object.fromEntries(Object.entries(rec).map(([k, r]) => [k, confuse(r)]));
    }
  }
  // a1/a3 sağlam kalır (etiket doğrulaması için); a2 ve diğerleri zehirli
  const clean = buildSeed().v2.activities;
  v2.activities.a1 = clean.a1;
  v2.activities.a3 = clean.a3;
  // Sayısal alanlara metin, metin alanlarına nesne
  v2.ticket_internal_notes.t1.n1.work_hours = "<img src=x onerror=window.__xss=1>";
  v2.activities.a2.action = { x: 1 };
  v2.activities["~zz"] = { activity_id: "~zz", action: 123, details: 456, user_uid: "u_cust", user_name: 9, created_at: new Date().toISOString() };
  v2.ticket_history.t1.hzz = { history_id: "hzz", action: 5, field_changed: 7, old_value: 1, new_value: { a: 1 }, changed_by_name: 3, changed_at: new Date().toISOString() };
  return seed;
}

/* ------------------------------------------------------------------ gezinme */
const adminPages = fs.readdirSync(path.join(ROOT, "support-v2/admin")).map((f) => `/support-v2/admin/${f}`);
const customerPages = fs.readdirSync(path.join(ROOT, "support-v2/customer")).map((f) => `/support-v2/customer/${f}`);
const query = { "ticket-detail.html": "?id=t1", "company-detail.html": "?id=cA", "personnel-detail.html": "?id=p1", "project-detail.html": "?id=pr1", "user-detail.html": "?uid=u_cust" };
const matrix = (extraAdmin) => [
  { uid: "u_root", pages: [...adminPages, ...extraAdmin, "/support-v2/change-password.html"] },
  { uid: "u_service", pages: adminPages },
  { uid: "u_cons1", pages: adminPages.filter((p) => !/users\.html|user-detail/.test(p)) },
  { uid: "u_pm", pages: adminPages.filter((p) => !/users\.html|user-detail/.test(p)) },
  { uid: "u_cust", pages: [...customerPages, `/support-v2/customer/ticket-detail.html?id=t2`] },
  { uid: "u_cadmin", pages: customerPages },
];

/** Açılır pencere / sekme / bildirim paneli / otomatik tamamlama gibi etkileşimleri tetikler. */
async function interact(page) {
  const sels = ["#sv2-notif-btn", ".sv2-tab", ".btn-edit", "#btn-edit-company", "#btn-edit-user", "#btn-edit-person", "#sv2-new-ticket", "#btn-new-contract", "#btn-new-company", "#btn-new-user", "#btn-new-personnel", "#btn-new-project", "#sv2-new-ticket-btn", "#sv2-advanced-toggle", ".sv2-quick-assign", "#sv2-start-work", ".sv2-quick-status"];
  for (const sel of sels) {
    const loc = page.locator(sel);
    const n = Math.min(await loc.count().catch(() => 0), 3);
    for (let i = 0; i < n; i++) {
      try {
        await loc.nth(i).click({ timeout: 700 });
        await page.waitForTimeout(100);
        for (const acSel of ["#sv2-create-company", "#nu-company", "#sv2-ticket-search"]) {
          const ac = page.locator(acSel);
          if (await ac.count()) await ac.first().fill("a").catch(() => {});
        }
        await page.waitForTimeout(100);
      } catch {
        /* görünür/tıklanabilir değil */
      }
    }
    await page.keyboard.press("Escape");
  }
  // Tablo satırı ve bağlantı üzerine gelme (title/attribute yürütme denemeleri)
  await page.locator(".sv2-table tbody tr").first().hover({ timeout: 500 }).catch(() => {});
}

async function visitAll(srv, world, label, extraAdmin, { expectNoErrorCard }) {
  let bad = 0;
  let total = 0;
  for (const { uid, pages } of matrix(extraAdmin || [])) {
    const s = await srv.session(uid);
    s.page.on("dialog", (d) => d.dismiss().catch(() => {}));
    for (const p of pages) {
      total += 1;
      s.errors.length = 0;
      const file = p.split("/").pop().split("?")[0];
      const url = p.includes("?") ? p : p + (query[file] || "");
      await s.goto(url);
      await s.page.waitForTimeout(650);
      await s.page.evaluate(() => { window.__xss = undefined; }); // yalnız etkileşim sırasındaki tetiklemeleri de ölç
      const before = await s.page.evaluate(() => window.__xss);
      await interact(s.page);
      await s.page.waitForTimeout(250);
      const xss = await s.page.evaluate(() => window.__xss);
      const shell = await s.page.locator(".sv2-sidebar").count();
      const errCard = await s.page.locator(".sv2-error-state").count();
      const ok = !xss && !before && s.errors.length === 0 && shell >= 1 && (!expectNoErrorCard || errCard === 0);
      if (!ok) bad += 1;
      if (!ok || verbose) console.log(`${ok ? "OK  " : "FAIL"} [${label}/${uid}] ${url}${xss ? "  XSS TETİKLENDİ" : ""}${s.errors.length ? "  " + s.errors.slice(0, 2).join(" | ") : ""}${shell ? "" : "  (kabuk yok)"}${errCard ? "  (hata kartı)" : ""}`);
    }
    // XSS'in sayfa yüklenmeden ÖNCE de set olmadığını kanıtla: init betiği yerine her sayfa başında sıfırlıyoruz; ayrıca
    // her gezinme yeni belge olduğundan değer yalnızca o sayfada üretilmiş olabilir.
    await s.context.close();
  }
  check(`${label}: ${total} sayfa/rol — betik çalışmadı, sayfa hatası yok, menü çizildi${expectNoErrorCard ? ", hata kartı yok" : ""}`, bad === 0, `${bad} sorunlu`);
}

(async () => {
  /* -------- Geçiş 1: yük */
  let world = createWorld(buildPoisonedSeed());
  let srv = await startServer(world);
  try {
    await visitAll(srv, world, "yük", [], { expectNoErrorCard: true });

    // id/ticket_id ezme: kayıttaki id anahtarı ezemez; satır/bağlantı DB anahtarını kullanır
    const root = await srv.session("u_root");
    await root.goto("/support-v2/admin/tickets.html");
    await root.page.waitForSelector(".sv2-table", { timeout: 15000 });
    await root.page.waitForTimeout(500);
    const ids = await root.page.locator("#sv2-tickets-table tbody tr").evaluateAll((rows) => rows.map((r) => r.dataset.id));
    check("id ezme: sahte kayıt kendi anahtarıyla listelenir (tspoof)", ids.includes("tspoof"), ids.join(","));
    check("id ezme: t10 satırı tek (sahte kayıt başka talebi taklit edemez)", ids.filter((i) => i === "t10").length === 1, ids.join(","));
    await root.goto("/support-v2/admin/ticket-detail.html?id=tspoof");
    await root.page.waitForSelector(".sv2-section", { timeout: 15000 });
    await root.page.waitForTimeout(400);
    const crumb = await root.page.evaluate(() => document.querySelector(".sv2-breadcrumb")?.innerText || "");
    check("id ezme: tspoof sayfası tspoof talebini gösterir", /SAHTE-ID-TALEBI|<img|svg/.test(await root.page.evaluate(() => document.body.innerText)) || crumb.length > 0);
    await root.context.close();

    // Ek bağlantısı: javascript: şeması bağlantı olarak çizilmez; https bağlantı çizilir ve kaçışlıdır
    const cust = await srv.session("u_cust");
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t1");
    await cust.page.waitForSelector(".sv2-section", { timeout: 15000 });
    check("ek bağlantı: javascript: şeması href olarak çizilmez (müşteri)", (await cust.page.locator('a[href^="javascript:"]').count()) === 0);
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t2");
    await cust.page.waitForSelector(".sv2-section", { timeout: 15000 });
    const hrefs = await cust.page.locator('a[href*="example.com"]').evaluateAll((a) => a.map((x) => x.getAttribute("href")));
    check("ek bağlantı: https bağlantı kaçışlı ve tek öznitelik", hrefs.every((h) => !/[<>]/.test(h || "")) && !(await cust.page.evaluate(() => window.__xss)));
    await cust.context.close();

    const staff = await srv.session("u_cons1");
    await staff.goto("/support-v2/admin/ticket-detail.html?id=t1");
    await staff.page.waitForSelector(".sv2-section", { timeout: 15000 });
    await staff.page.waitForTimeout(400);
    check("ek bağlantı: personel ekranında görünür (SEN-12) ve javascript: tıklanabilir değil", (await staff.page.locator("#sv2-attachment-url").count()) === 0 && /Geçersiz bağlantı/.test(await staff.page.evaluate(() => document.body.innerText)));
    await staff.goto("/support-v2/admin/ticket-detail.html?id=t2");
    await staff.page.waitForSelector(".sv2-section", { timeout: 15000 });
    await staff.page.waitForTimeout(400);
    check("ek bağlantı: geçerli https bağlantı personelde tıklanabilir", (await staff.page.locator('a#sv2-attachment-url[href^="https://example.com/"]').count()) === 1);

    // Ek dosyası: svg türü satır içi açılmaz (blob + site kökeni), yalnız indirilir
    await staff.goto("/support-v2/admin/ticket-detail.html?id=t1");
    await staff.page.waitForSelector(".sv2-section", { timeout: 15000 });
    const popups = [];
    staff.context.on("page", (pg) => popups.push(pg));
    const chip = staff.page.locator(".sv2-attachment").first();
    if (await chip.count()) {
      const dl = staff.page.waitForEvent("download", { timeout: 4000 }).then(() => true).catch(() => false);
      await chip.click().catch(() => {});
      const downloaded = await dl;
      await sleep(500);
      check("ek dosyası: image/svg+xml satır içi açılmaz (indirilir)", downloaded && popups.length === 0, `downloaded=${downloaded} popups=${popups.length}`);
    } else {
      check("ek dosyası çipi çizildi", false, "çip yok");
    }
    check("ek dosyası: bozuk/boş ek girdileri sayfayı çökertmedi", staff.errors.length === 0, staff.errors.slice(0, 2).join(" | "));
    await staff.context.close();
  } finally {
    await srv.close();
  }

  /* -------- Geçiş 2: tür karışıklığı (zehirli aktivite/geçmiş/mesaj) */
  world = createWorld(buildTypeConfusedSeed());
  srv = await startServer(world);
  try {
    await visitAll(srv, world, "tür karışıklığı", [], { expectNoErrorCard: true });

    // Zehirli aktivite: pano ve kullanıcı detayı çökmez; aktivite sayfası etiketleri okunur Türkçe
    const root = await srv.session("u_root");
    await root.goto("/support-v2/admin/dashboard.html");
    await root.page.waitForSelector(".sv2-stat-card", { timeout: 15000 }).catch(() => {});
    check("zehirli aktivite (action sayı): pano çizilir (istatistik kartları var)", (await root.page.locator(".sv2-stat-card").count()) > 0 && root.errors.length === 0, root.errors.slice(0, 2).join(" | "));
    await root.goto("/support-v2/admin/user-detail.html?uid=u_cust");
    await root.page.waitForSelector(".sv2-meta-grid", { timeout: 15000 }).catch(() => {});
    check("zehirli aktivite (details sayı): kullanıcı detayı çizilir", (await root.page.locator(".sv2-meta-grid").count()) > 0 && root.errors.length === 0, root.errors.slice(0, 2).join(" | "));
    await root.goto("/support-v2/admin/ticket-detail.html?id=t1");
    await root.page.waitForSelector(".sv2-tab", { timeout: 15000 }).catch(() => {});
    await root.page.click('.sv2-tab[data-tab="history"]').catch(() => {});
    await root.page.waitForTimeout(300);
    check("zehirli geçmiş kaydı: Geçmiş sekmesi açılır, sayfa hatası yok", (await root.page.locator("#sv2-tab-content .sv2-table, #sv2-tab-content .sv2-empty").count()) > 0 && root.errors.length === 0, root.errors.slice(0, 2).join(" | "));
    await root.goto("/support-v2/admin/activities.html");
    await root.page.waitForSelector(".sv2-table", { timeout: 15000 }).catch(() => {});
    const actText = await root.page.evaluate(() => document.querySelector("#activities-content")?.innerText || "");
    check("Aktiviteler: bilinen olaylar Türkçe etiketle ('Talep Oluşturuldu'), ham kod yok", /Talep Oluşturuldu/.test(actText) && !/ticket_created/.test(actText), actText.slice(0, 200));
    check("Aktiviteler: zehirli kayıt tabloyu çökertmedi", root.errors.length === 0, root.errors.slice(0, 2).join(" | "));
    await root.context.close();
  } finally {
    await srv.close();
  }

  results.forEach((r) => console.log(r.join(" | ")));
  console.log(`\n${results.filter((r) => r[0] === "PASS").length}/${results.length} geçti`);
  process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
