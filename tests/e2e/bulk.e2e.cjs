/**
 * E2E (WP-16): admin talep listesinde çoklu seçim + toplu ata / toplu durum.
 *
 *  - 5 talep toplu atanır (birincil): durum "atandı", assigned_uids + atama kaydı, TEK özet aktivite, e-posta YOK.
 *  - 5 talep toplu kapatılır: 4 geçerli kapanır (damgalar updateTicket'ten), 1 geçersiz geçiş ATLANIR ve özette listelenir;
 *    yalnız kapanan talepler için müşteriye e-posta gider; TEK özet aktivite.
 *  - Bildirimsiz durum (işleme al): e-posta gitmez.
 *  - "Filtrelenen tümünü seç"; yetki: danışman toplu işlem arayüzünü GÖRMEZ, PM görür.
 *
 * Çalıştırma: node tests/e2e/bulk.e2e.cjs
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

const NOW = Date.now();
const iso = (offsetMs) => new Date(NOW - offsetMs).toISOString();
const H = 3600 * 1000;

function mkTicket(id, n, o) {
  return {
    ticket_id: id,
    ticket_number: `SUP-ORN-FI-2610-${String(n).padStart(4, "0")}`,
    ticket_type: "SUP",
    customer_code: "ORN",
    company_id: "cA",
    company_name: "Örnek Holding A.Ş.",
    user_id: "u_cust",
    user_name: "Ayşe Demir",
    user_email: "ayse.demir@ornekholding.com",
    title: o.title,
    description: "Toplu işlem testi için oluşturulmuş talep açıklaması (en az yirmi karakter).",
    priority: "medium",
    sap_module: "FI",
    status: o.status,
    assigned_to_id: "",
    assigned_to_name: "",
    total_work_hours: 0,
    project_id: "",
    sequence_number: n,
    created_at: iso(o.age || 5 * H),
    created_by: "u_cust",
    updated_at: iso(o.age || 5 * H),
    updated_by: "u_cust",
    public_updated_at: iso(o.age || 5 * H),
    public_updated_by: "u_cust",
    ...(o.status === "pending_close" || o.status === "resolved" ? { resolved_at: iso(2 * H) } : {}),
  };
}

(async () => {
  const world = createWorld(buildSeed());
  // 5 açık (atama testi) + 3 kapanış onayı bekleyen + 1 çözüldü + 1 açık (geçersiz geçiş) + 30 toplu-seçim sayfası için ek talepler
  const assignSet = ["a1", "a2", "a3", "a4", "a5"];
  assignSet.forEach((id, i) => world.seed(`v2/tickets/${id}`, mkTicket(id, 100 + i, { title: `Atama testi ${i + 1}`, status: "open", age: (10 + i) * H })));
  const closeSet = [
    ["b1", "pending_close"],
    ["b2", "pending_close"],
    ["b3", "pending_close"],
    ["b4", "resolved"],
    ["b5", "open"], // open → closed geçersiz: atlanmalı
  ];
  closeSet.forEach(([id, status], i) => world.seed(`v2/tickets/${id}`, mkTicket(id, 200 + i, { title: `Kapatma testi ${i + 1}`, status, age: (20 + i) * H })));
  for (let i = 0; i < 30; i += 1) {
    world.seed(`v2/tickets/z${i}`, mkTicket(`z${i}`, 300 + i, { title: `Sayfa testi ${i}`, status: "open", age: (40 + i) * H }));
  }

  const srv = await startServer(world);
  try {
    /* ------------------------------------------------------------ yetki: danışman görmez, PM görür */
    const cons = await srv.session("u_cons1");
    await cons.goto("/support-v2/admin/tickets.html");
    await cons.page.waitForSelector("#sv2-tickets-table table, #sv2-tickets-table .sv2-empty", { timeout: 15000 });
    check("danışman: toplu seçim onay kutusu YOK", (await cons.page.locator(".sv2-bulk-cb, #sv2-bulk-all").count()) === 0);
    check("danışman: toplu işlem çubuğu YOK", (await cons.page.locator("#sv2-bulk-bar").count()) === 0);
    check("danışman: sayfa hatası yok", cons.errors.length === 0, cons.errors);
    await cons.context.close();

    const pm = await srv.session("u_pm");
    await pm.goto("/support-v2/admin/tickets.html");
    await pm.page.waitForSelector(".sv2-bulk-cb", { timeout: 15000 });
    check("PM: toplu seçim onay kutuları görünür", (await pm.page.locator(".sv2-bulk-cb").count()) > 0);
    await pm.context.close();

    /* ------------------------------------------------------------ yönetici: toplu ata */
    const root = await srv.session("u_root");
    await root.goto("/support-v2/admin/tickets.html");
    await root.page.waitForSelector(".sv2-bulk-cb", { timeout: 15000 });
    const page = root.page;
    const emailsBefore = world.emails.length;

    await page.fill("#sv2-ticket-search", "Atama testi");
    await page.waitForFunction(() => document.querySelectorAll(".sv2-bulk-cb").length === 5, null, { timeout: 8000 });
    check("arama: 5 'Atama testi' talebi listelendi (debounce sonrası)", true);
    await page.check("#sv2-bulk-all");
    await page.waitForSelector("#sv2-bulk-bar");
    check("başlık onay kutusu görünen 5 satırı seçer", (await page.locator("#sv2-bulk-count").textContent()).includes("5 talep seçili"));

    await page.click("#sv2-bulk-assign");
    await page.waitForSelector("#bulk-assign-person");
    await page.selectOption("#bulk-assign-person", "p2");
    await page.waitForFunction(() => /5\s*talep atanacak/.test(document.getElementById("bulk-assign-preview")?.textContent || ""), null, { timeout: 5000 });
    check("önizleme: 5 talep atanacak", true);
    check("politika notu: e-posta gönderilmez", /e-posta gönderilmez/.test(await page.locator("#bulk-assign-policy").textContent()));
    await page.click("#bulk-assign-confirm");
    await page.waitForSelector("#bulk-result-summary", { timeout: 15000 });
    check("sonuç özeti: 5 talep atandı", /5 talep/.test(await page.locator("#bulk-result-summary").textContent()), await page.locator("#bulk-result-summary").textContent());

    for (const id of assignSet) {
      const t = world.valueAt(`v2/tickets/${id}`);
      const asg = world.valueAt(`v2/ticket_assignments/${id}/p2`);
      const hist = Object.values(world.valueAt(`v2/ticket_history/${id}`) || {});
      check(`${id}: birincil p2, durum 'atandı', assigned_uids, atama kaydı + e-posta kopyası`,
        t.assigned_to_id === "p2" && t.assigned_to_name === "Can Öztürk" && t.status === "assigned" && t.assigned_uids && t.assigned_uids.u_cons2 === true && asg && asg.is_primary === true && asg.personnel_email === "can.ozturk@parla-demo.com" && !!t.assigned_at,
        { t, asg });
      check(`${id}: geçmişe atama + durum satırı yazıldı`, hist.some((h) => h.field_changed === "assigned_to_name") && hist.some((h) => h.field_changed === "status" && h.new_value === "assigned"), hist);
    }
    const acts = Object.values(world.valueAt("v2/activities") || {});
    check("TEK özet aktivite: ticket_bulk_assigned", acts.filter((a) => a.action === "ticket_bulk_assigned").length === 1, acts.map((a) => a.action));
    check("toplu atamada hiç e-posta gönderilmedi", world.emails.length === emailsBefore, world.emails.length - emailsBefore);
    check("toplu atama: tek 'ticket_assigned' aktivitesi yazılmadı (özet dışında)", !acts.some((a) => a.action === "ticket_assigned" && String(a.entity_id).startsWith("a")), acts);
    await page.click('[data-close="sv2-bulk-result-modal"]');

    /* ------------------------------------------------------------ toplu durum: kapat (4 geçerli + 1 geçersiz) */
    await page.fill("#sv2-ticket-search", "Kapatma testi");
    await page.waitForFunction(() => document.querySelectorAll(".sv2-bulk-cb").length === 5, null, { timeout: 8000 });
    await page.check("#sv2-bulk-all");
    await page.click("#sv2-bulk-status");
    await page.waitForSelector("#bulk-status-target");
    await page.selectOption("#bulk-status-target", "closed");
    await page.waitForFunction(() => /4\s*talep/.test(document.getElementById("bulk-status-preview")?.textContent || ""), null, { timeout: 5000 });
    const previewText = await page.locator("#bulk-status-preview").textContent();
    check("önizleme: 4 talep kapanacak, 1 atlanacak", /4\s*talep/.test(previewText) && /1\s*talep atlanacak/.test(previewText), previewText);
    check("politika: yalnız Çözüldü/Kapandı bildirilir (UI'da belirtilir)", /yalnızca\s*Çözüldü\s*ve\s*Kapandı/.test((await page.locator("#bulk-status-policy").textContent()).replace(/\s+/g, " ")));
    // not zorunlu (en az 10 karakter)
    await page.fill("#bulk-status-note", "kısa");
    await page.click("#bulk-status-confirm");
    check("kısa not reddedilir", await page.locator("#bulk-status-note-error").isVisible());
    const emailsBeforeClose = world.emails.length;
    await page.fill("#bulk-status-note", "Toplu kapanış: talepler çözüme kavuştu.");
    await page.click("#bulk-status-confirm");
    await page.waitForSelector("#bulk-result-summary", { timeout: 20000 });
    check("özet: 4 talep kapandı", /4 talep/.test(await page.locator("#bulk-result-summary").textContent()));
    const skippedText = await page.locator("#bulk-result-skipped").textContent();
    check("geçersiz geçiş ATLANDI ve özette listelendi (Kapatma testi 5 / open→closed)", /SUP-ORN-FI-2610-0204/.test(skippedText) && /geçişine izin yok/.test(skippedText), skippedText);

    for (const id of ["b1", "b2", "b3", "b4"]) {
      const t = world.valueAt(`v2/tickets/${id}`);
      const hist = Object.values(world.valueAt(`v2/ticket_history/${id}`) || {});
      check(`${id}: kapandı + damgalar (closed_at, closed_at_ms, resolved_at korunur) + notlu geçmiş`,
        t.status === "closed" && !!t.closed_at && typeof t.closed_at_ms === "number" && !!t.resolved_at && hist.some((h) => h.field_changed === "status" && h.new_value === "closed" && /Toplu kapanış/.test(h.note)),
        t);
    }
    const b5 = world.valueAt("v2/tickets/b5");
    check("b5 (open → closed geçersiz): DEĞİŞMEDİ", b5.status === "open" && !b5.closed_at, b5);
    const closeMails = world.emails.slice(emailsBeforeClose);
    check("müşteriye 4 kapanış e-postası gitti (yalnız kapatma olayı)", closeMails.length === 4, closeMails.map((m) => m.subject));
    check("e-postalar talep sahibine", closeMails.every((m) => [].concat(m.to).includes("ayse.demir@ornekholding.com")), closeMails.map((m) => m.to));
    const acts2 = Object.values(world.valueAt("v2/activities") || {});
    check("TEK özet aktivite: ticket_bulk_status (kapatma)", acts2.filter((a) => a.action === "ticket_bulk_status").length === 1, acts2.map((a) => a.action));
    await page.click('[data-close="sv2-bulk-result-modal"]');

    /* ------------------------------------------------------------ bildirimsiz durum: işleme al */
    await page.fill("#sv2-ticket-search", "Atama testi");
    await page.waitForFunction(() => document.querySelectorAll(".sv2-bulk-cb").length === 5, null, { timeout: 8000 });
    await page.check("#sv2-bulk-all");
    await page.click("#sv2-bulk-status");
    await page.waitForSelector("#bulk-status-target");
    await page.selectOption("#bulk-status-target", "in_progress");
    await page.waitForFunction(() => /5\s*talep/.test(document.getElementById("bulk-status-preview")?.textContent || ""), null, { timeout: 5000 });
    check("işleme alma için bildirim yapılmayacağı belirtilir", /e-posta gönderilmez/.test(await page.locator("#bulk-status-preview").textContent()));
    const emailsBeforeProg = world.emails.length;
    await page.fill("#bulk-status-note", "Toplu işleme alma: çalışma başladı.");
    await page.click("#bulk-status-confirm");
    await page.waitForSelector("#bulk-result-summary", { timeout: 20000 });
    check("5 talep işleme alındı (started_at damgası)", assignSet.every((id) => { const t = world.valueAt(`v2/tickets/${id}`); return t.status === "in_progress" && !!t.started_at; }));
    check("bildirimsiz durum: e-posta gönderilmedi", world.emails.length === emailsBeforeProg, world.emails.length - emailsBeforeProg);
    check("iki özet aktivite (kapatma + işleme alma)", Object.values(world.valueAt("v2/activities") || {}).filter((a) => a.action === "ticket_bulk_status").length === 2);
    await page.click('[data-close="sv2-bulk-result-modal"]');

    /* ------------------------------------------------------------ "Filtrelenen tümünü seç" */
    await page.fill("#sv2-ticket-search", "Sayfa testi");
    await page.waitForFunction(() => document.querySelectorAll(".sv2-bulk-cb").length === 25, null, { timeout: 8000 });
    await page.check("#sv2-bulk-all");
    await page.waitForSelector("#sv2-bulk-select-filtered");
    const offer = await page.locator("#sv2-bulk-select-filtered").textContent();
    check("'Filtrelenen tüm 30 talebi seç' teklifi", /30/.test(offer), offer);
    await page.click("#sv2-bulk-select-filtered");
    check("30 talep seçildi (sayfalar arası)", /30 talep seçili/.test(await page.locator("#sv2-bulk-count").textContent()));
    await page.click("#sv2-bulk-clear");
    check("seçim temizlendi", (await page.locator("#sv2-bulk-bar").count()) === 0);

    check("yönetici oturumunda sayfa hatası yok", root.errors.length === 0, root.errors);

    /* ------------------------------------------------------------ pano hızlı atama: yerel güncelleme (tüm talepler yeniden indirilmez) */
    await root.goto("/support-v2/admin/dashboard.html");
    await page.waitForSelector(".sv2-quick-assign", { timeout: 15000 });
    const quickId = await page.locator(".sv2-quick-assign").first().getAttribute("data-id");
    await page.locator(".sv2-quick-assign").first().click();
    await page.waitForSelector("#sv2-assign-personnel");
    await page.selectOption("#sv2-assign-personnel", "p1");
    await page.click("#sv2-assign-save");
    await page.waitForFunction((id) => !document.querySelector(`.sv2-quick-assign[data-id="${id}"]`), quickId, { timeout: 15000 });
    check("pano: hızlı atama sonrası satır listeden kalkar (yerel güncelleme)", true);
    check("pano: talep p1'e atandı", world.valueAt(`v2/tickets/${quickId}/assigned_to_id`) === "p1" && world.valueAt(`v2/tickets/${quickId}/status`) === "assigned");
    check("pano: hızlı atama sayfa hatası vermedi", root.errors.length === 0, root.errors);
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
