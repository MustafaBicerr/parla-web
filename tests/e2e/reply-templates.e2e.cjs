/**
 * E2E (WP-16): hazır yanıt şablonları.
 *
 *  - Yönetici sayfada şablon ekler/düzenler/pasifleştirir/siler (başlık + metin + değişkenler).
 *  - Atanmış danışman ve yönetici talep sayfasında "Şablon ekle" ile metni değişkenleri dolu olarak yanıt kutusuna alır,
 *    düzenleyip gönderir; pasif şablon listelenmez.
 *  - Yetki: danışman/PM şablon YAZAMAZ (kural + arayüz), müşteri ne okuyabilir ne görür.
 *  - XSS: başlık/gövde/kategori/değişken değeri betik yükü olsa da hiçbir yerde çalışmaz; metin düz metin olarak taşınır.
 *
 * Çalıştırma: node tests/e2e/reply-templates.e2e.cjs
 */
const { createWorld, startServer } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${ok ? "" : " | " + (detail === undefined ? "" : typeof detail === "string" ? detail : JSON.stringify(detail))}`);
}

const XSS_TITLE = `"'><img src=x onerror=window.__xss=1>`;
const XSS_BODY = `<svg onload=window.__xss=1> Merhaba {musteri_adi} </script><script>window.__xss=1</script>`;
const XSS_CAT = `" onmouseover="window.__xss=1" x="`;
const iso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v || Date.now() - t0 > ms) return v;
    await sleep(100);
  }
}

(async () => {
  const seed = buildSeed();
  // Zehirli şablon (kural kontrolü olmadan tohumlanır; güvenilmez veri sayılır)
  seed.v2.reply_templates = {
    tx: { template_id: "tx", title: XSS_TITLE, body: XSS_BODY, category: XSS_CAT, is_active: true, sort_order: 5, created_at: iso(), created_by: "u_root", updated_at: iso(), updated_by: "u_root" },
    tp: { template_id: "tp", title: "Pasif şablon", body: "Bu şablon pasif.", is_active: false, sort_order: 1, created_at: iso(), created_by: "u_root", updated_at: iso(), updated_by: "u_root" },
  };
  const world = createWorld(seed);
  const srv = await startServer(world);
  try {
    /* ------------------------------------------------------------ yönetici: CRUD */
    const root = await srv.session("u_root");
    await root.goto("/support-v2/admin/reply-templates.html");
    await root.page.waitForSelector("#templates-table table", { timeout: 15000 });
    const page = root.page;
    check("liste: zehirli başlık düz metin olarak çizildi (betik çalışmadı)", (await page.evaluate(() => window.__xss)) === undefined);
    check("liste: başlık metni birebir görünür", (await page.locator("#templates-table").textContent()).includes(XSS_TITLE));
    check("menüde 'Hazır Yanıtlar' bağlantısı var", (await page.locator('a.sv2-nav-item[data-page="reply-templates"]').count()) === 1);
    check("değişken yardımı görünür", /\{musteri_adi\}/.test(await page.locator("#template-help").textContent()) && /\{talep_no\}/.test(await page.locator("#template-help").textContent()) && /\{danisman\}/.test(await page.locator("#template-help").textContent()));

    await page.click("#btn-new-template");
    await page.waitForSelector("#tf-title");
    // doğrulama
    await page.click("#template-save");
    check("boş başlık/metin reddedilir", (await page.locator("#err-title").isVisible()) && (await page.locator("#err-body").isVisible()));
    await page.fill("#tf-title", "Karşılama");
    await page.fill("#tf-category", "Genel");
    await page.fill("#tf-order", "2");
    await page.fill("#tf-body", "Merhaba {musteri_adi},\n{talep_no} numaralı talebinizi aldık. {danisman}");
    await page.waitForFunction(() => /Merhaba Ayşe Demir/.test(document.getElementById("tf-preview")?.textContent || ""), null, { timeout: 5000 }).catch(() => {});
    const previewTxt = await page.locator("#tf-preview").textContent();
    check("önizleme örnek verilerle dolar", /Merhaba Ayşe Demir/.test(previewTxt), previewTxt);
    await page.click("#tf-vars .tf-var[data-var='talep_no']");
    check("değişken düğmesi imlece belirteç ekler", /\{talep_no\}/.test(await page.inputValue("#tf-body")));
    await page.click("#template-save");
    await page.waitForFunction(() => document.querySelector("#templates-table")?.textContent.includes("Karşılama"), null, { timeout: 8000 });
    const created = await eventually(() => Object.values(world.valueAt("v2/reply_templates") || {}).find((t) => t.title === "Karşılama"));
    check("şablon veritabanına yazıldı (alanlar)", created && created.category === "Genel" && created.sort_order === 2 && created.is_active === true && created.created_by === "u_root" && created.template_id && /\{danisman\}/.test(created.body), created);

    // düzenle + pasifleştir
    await page.click(`#templates-table .btn-edit[data-id="${created.template_id}"]`);
    await page.waitForSelector("#tf-title");
    await page.fill("#tf-title", "Karşılama (güncel)");
    await page.click("#template-save");
    await page.waitForFunction(() => document.querySelector("#templates-table")?.textContent.includes("Karşılama (güncel)"), null, { timeout: 8000 });
    check("şablon güncellendi", world.valueAt(`v2/reply_templates/${created.template_id}/title`) === "Karşılama (güncel)");

    check("şablon etkinlikleri aktivite kaydına yazıldı", Object.values(world.valueAt("v2/activities") || {}).some((a) => a.entity_type === "reply_template" && a.action === "created"));
    check("yönetici sayfasında hata yok", root.errors.length === 0, root.errors);

    /* ------------------------------------------------------------ danışman: salt okunur */
    const cons = await srv.session("u_cons1");
    await cons.goto("/support-v2/admin/reply-templates.html");
    await cons.page.waitForSelector("#templates-table table", { timeout: 15000 });
    check("danışman: 'Yeni Şablon' düğmesi yok", (await cons.page.locator("#btn-new-template").count()) === 0);
    check("danışman: düzenle/sil düğmesi yok", (await cons.page.locator(".btn-edit, .btn-delete").count()) === 0);
    check("danışman: durum anahtarları devre dışı", (await cons.page.locator(".tpl-toggle:not([disabled])").count()) === 0 && (await cons.page.locator(".tpl-toggle[disabled]").count()) >= 1);
    const denied = world.dbOp({ uid: "u_cons1", op: "set", path: "v2/reply_templates/hack", value: { title: "x", body: "y" } });
    check("kurallar: danışman şablon yazamaz", denied.error === "PERMISSION_DENIED", denied);
    const deniedPm = world.dbOp({ uid: "u_pm", op: "set", path: "v2/reply_templates/hack", value: { title: "x", body: "y" } });
    check("kurallar: PM şablon yazamaz", deniedPm.error === "PERMISSION_DENIED", deniedPm);
    const custRead = world.dbOp({ uid: "u_cust", op: "get", path: "v2/reply_templates" });
    check("kurallar: müşteri şablon okuyamaz", custRead.error === "PERMISSION_DENIED", custRead);
    check("danışman sayfasında hata yok", cons.errors.length === 0, cons.errors);

    /* ------------------------------------------------------------ talep sayfasında şablon ekle (atanmış danışman) */
    await cons.goto("/support-v2/admin/ticket-detail.html?id=t1");
    await cons.page.waitForSelector("#sv2-reply-template", { timeout: 15000 });
    const options = await cons.page.locator("#sv2-reply-template option").allTextContents();
    check("seçici: aktif şablonlar listelenir, pasif listelenmez", options.some((o) => o.includes("Karşılama")) && !options.some((o) => o.includes("Pasif şablon")), options);
    check("seçici: zehirli başlık düz metin (betik çalışmadı)", (await cons.page.evaluate(() => window.__xss)) === undefined && options.some((o) => o.includes(XSS_TITLE)), options);
    await cons.page.selectOption("#sv2-reply-template", created.template_id);
    const filled = await cons.page.inputValue("#sv2-reply-message");
    check("şablon değişkenleri doldu (müşteri adı, talep no, danışman)", /Merhaba Ayşe Demir,/.test(filled) && /SUP-ORN-SD-2610-0001/.test(filled) && /Zeynep Arslan/.test(filled) && !/\{/.test(filled), filled);
    check("seçici sıfırlandı", (await cons.page.inputValue("#sv2-reply-template")) === "");
    // ikinci şablon mevcut metne eklenir (üzerine yazmaz)
    await cons.page.selectOption("#sv2-reply-template", "tx");
    const appended = await cons.page.inputValue("#sv2-reply-message");
    check("ikinci şablon mevcut metne eklenir ve zehirli gövde DÜZ METİN olarak taşınır", appended.startsWith(filled) && appended.includes("<svg onload=window.__xss=1>") && appended.includes("Merhaba Ayşe Demir"), appended);
    check("şablon eklemek betik çalıştırmadı", (await cons.page.evaluate(() => window.__xss)) === undefined);
    // düzenle ve gönder
    await cons.page.fill("#sv2-reply-message", filled.replace("Merhaba", "Selam"));
    const before = Object.keys(world.valueAt("v2/ticket_messages/t1") || {}).length;
    await cons.page.click("#sv2-reply-send");
    await cons.page.waitForFunction((n) => !document.getElementById("sv2-reply-message")?.value && true, before, { timeout: 15000 });
    await cons.page.waitForTimeout(500);
    const msgs = Object.values(world.valueAt("v2/ticket_messages/t1") || {});
    const sent = msgs.find((m) => /^Selam Ayşe Demir,/.test(m.message));
    check("düzenlenen şablon metni yanıt olarak gönderildi", !!sent && sent.author_role === "consultant" && /SUP-ORN-SD-2610-0001/.test(sent.message), msgs.map((m) => m.message));
    check("danışman talep sayfasında hata yok", cons.errors.length === 0, cons.errors);
    await cons.context.close();

    /* ------------------------------------------------------------ yönetici/PM: talep sayfasında seçici */
    const pm = await srv.session("u_pm");
    await pm.goto("/support-v2/admin/ticket-detail.html?id=t2");
    await pm.page.waitForSelector("#sv2-reply-template", { timeout: 15000 });
    await pm.page.selectOption("#sv2-reply-template", created.template_id);
    const pmText = await pm.page.inputValue("#sv2-reply-message");
    check("PM: şablon eklenir; {danisman} yanıtı yazan kişi", /Burak Şahin/.test(pmText) && /SUP-ORN-MM-2610-0002/.test(pmText), pmText);
    await pm.context.close();

    /* ------------------------------------------------------------ müşteri: şablon yok */
    const cust = await srv.session("u_cust");
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t1");
    await cust.page.waitForSelector(".sv2-content", { timeout: 15000 });
    await cust.page.waitForTimeout(600);
    check("müşteri talep sayfasında şablon seçici yok", (await cust.page.locator("#sv2-reply-template").count()) === 0);
    check("müşteri sayfasında kural reddi/hata yok", cust.errors.length === 0, cust.errors);
    await cust.context.close();

    /* ------------------------------------------------------------ yönetici: pasifleştir + sil */
    await page.click(`#templates-table .tpl-toggle[data-id="${created.template_id}"] + .sv2-switch-slider`);
    await page.waitForFunction((id) => document.querySelector(`.tpl-toggle[data-id="${id}"]`) && !document.querySelector(`.tpl-toggle[data-id="${id}"]`).checked, created.template_id, { timeout: 8000 });
    check("şablon pasifleştirildi", world.valueAt(`v2/reply_templates/${created.template_id}/is_active`) === false);
    await page.click(`#templates-table .btn-delete[data-id="${created.template_id}"]`);
    await page.click("#sv2-confirm-ok");
    await page.waitForFunction((id) => !document.querySelector(`.btn-delete[data-id="${id}"]`), created.template_id, { timeout: 8000 });
    check("şablon silindi", world.valueAt(`v2/reply_templates/${created.template_id}`) === null || world.valueAt(`v2/reply_templates/${created.template_id}`) === undefined);
    check("zehirli yük hiçbir sayfada çalışmadı (yönetici)", (await page.evaluate(() => window.__xss)) === undefined && root.errors.length === 0, root.errors);
    await root.context.close();
  } finally {
    await srv.close();
  }
  console.log(`\n${pass}/${pass + fail} geçti`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
