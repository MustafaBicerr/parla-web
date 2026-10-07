/**
 * E2E: bildirim zili — ağ yükü ve doğruluk (WP-13; OLC-01/02/07, PER-05, MUS-19/28, SEN-33/34, karar 4).
 *
 *  - Hedefli sorgular: personel eylem bildirimleri tüm koleksiyonu/son-80 penceresini değil, `status` sorgularını kullanır;
 *    200 yeni kapalı talep eski atanmamış / SLA'sı aşmış talebi zilden DÜŞÜRMEZ.
 *  - Yoklama: sayfa açılışında bir kez; görünür sekmede periyodik (5 dk; testte kısaltılır) ve yalnız "değişti mi?" yoklaması;
 *    gizli sekmede durur; yeniden çizim ağa gitmez; sayfadan sayfaya geçişte önbellek.
 *  - Bayt bütçesi (personel, sayfa başına ilk yükleme) ve boşta yoklama maliyeti.
 *  - Müşteri panosu/talepleri/profil: aynı liste TEK okuma.
 *  - Rozet sayısı = panel satır sayısı (MUS-28); zil metinleri doğru atıf (SEN-33); "x dk önce" yuvarlaması (SEN-34).
 *
 * Çalıştırma: node tests/e2e/bell-perf.e2e.cjs [--verbose]
 */
const { createWorld, startServer } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const verbose = process.argv.includes("--verbose");
const results = [];
const check = (name, ok, extra) => results.push([ok ? "PASS" : "FAIL", name, ok ? "" : extra || ""]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return true;
    await sleep(50);
  }
  return false;
}

const H = 3600 * 1000;
const D = 24 * H;
const NOW = Date.now();
const iso = (ago) => new Date(NOW - ago).toISOString();

function ticket(id, n, o) {
  return {
    ticket_id: id,
    ticket_number: `SUP-ORN-FI-2610-${String(n).padStart(4, "0")}`,
    ticket_type: "SUP",
    customer_code: "ORN",
    company_id: o.company_id || "cA",
    company_name: "Örnek Holding A.Ş.",
    user_id: o.user_id || "u_cust",
    user_name: "Ayşe Demir",
    user_email: "ayse.demir@ornekholding.com",
    title: o.title || `Test talebi ${n}`,
    description: "Açıklama ".repeat(40), // gerçekçi boyut (~1,8 KB/talep)
    priority: o.priority || "medium",
    sap_module: "FI",
    status: o.status,
    assigned_to_id: o.assigned || "",
    assigned_to_name: o.assigned ? "Zeynep Arslan" : "",
    ...(o.assigned ? { assigned_uids: { u_cons1: true } } : {}),
    attachment_url: "",
    total_work_hours: 0,
    project_id: "",
    sequence_number: n,
    created_at: iso(o.age),
    created_by: o.user_id || "u_cust",
    updated_at: iso(o.updated != null ? o.updated : o.age),
    updated_by: o.updated_by || o.user_id || "u_cust",
    public_updated_at: iso(o.updated != null ? o.updated : o.age),
    public_updated_by: o.updated_by || o.user_id || "u_cust",
    ...(o.closed ? { resolved_at: iso(o.updated), closed_at: iso(o.updated), first_response_at: iso(o.age - H) } : {}),
  };
}

/** world.dbOp'u sarar: her okuma/yazma kaydedilir (bayt = dönen JSON uzunluğu). */
function instrument(world) {
  const log = [];
  const orig = world.dbOp.bind(world);
  world.dbOp = (op) => {
    const res = orig(op);
    log.push({ uid: op.uid, op: op.op, path: String(op.path || "").replace(/^\/+/, ""), q: op.q || null, bytes: op.op === "get" ? JSON.stringify(res.val ?? null).length : 0 });
    return res;
  };
  return log;
}

const ticketReads = (log, uid, from = 0) => log.slice(from).filter((e) => e.uid === uid && e.op === "get" && e.path === "v2/tickets");

(async () => {
  const world = createWorld(buildSeed(NOW));
  // 200 yeni güncellenmiş KAPALI talep + eski atanmamış talep + eski SLA aşımı (PER-05/OLC-02 senaryosu)
  for (let i = 1; i <= 200; i++) world.seed(`v2/tickets/c${i}`, ticket(`c${i}`, 1000 + i, { status: "closed", closed: true, assigned: "p1", age: 5 * D, updated: i * 60 * 1000, updated_by: "u_cons1", user_id: "u_custB", company_id: "cB" }));
  world.seed("v2/tickets/old_unassigned", ticket("old_unassigned", 9001, { status: "open", age: 5 * D }));
  world.seed("v2/tickets/old_sla", ticket("old_sla", 9002, { status: "in_progress", assigned: "p1", priority: "high", age: 6 * D, updated: 6 * D }));
  const log = instrument(world);
  const srv = await startServer(world);
  try {
    // ── Yapılandırma: varsayılan yoklama 5 dk
    {
      const s = await srv.session("u_service");
      await s.goto("/support-v2/change-password.html");
      await s.page.waitForSelector("#sv2-notif-btn");
      const cfg = await s.page.evaluate(() => import("/assets/js/support-v2/notifications.js").then((m) => m.BELL_CONFIG));
      check("yoklama aralığı 5 dk, önbellek 1 dk, tam yenileme 30 dk", cfg.pollMs === 300000 && cfg.cacheFreshMs === 60000 && cfg.fullReloadMs === 1800000 && cfg.recentN <= 30, JSON.stringify(cfg));
      await s.context.close();
    }

    // ── Personel (atayıcı): hedefli sorgular, eski atanmamış talep kaybolmaz
    {
      const start = log.length;
      const s = await srv.session("u_service");
      await s.goto("/support-v2/change-password.html"); // yalnız kabuk + zil: sayfa verisi okumaz
      await waitFor(async () => !(await s.page.locator("#sv2-notif-badge").isHidden()));
      await sleep(300);
      const reads = ticketReads(log, "u_service", start);
      const full = reads.filter((r) => !r.q);
      const shapes = reads.map((r) => `${r.q.orderByChild}${r.q.equalTo !== undefined ? "=" + r.q.equalTo : ""}${r.q.limitToLast ? "/son" + r.q.limitToLast : ""}`).sort();
      check("zil: tüm koleksiyon okuması YOK (hepsi hedefli sorgu)", reads.length > 0 && full.length === 0, JSON.stringify(shapes));
      const statuses = reads.filter((r) => r.q.orderByChild === "status").map((r) => r.q.equalTo).sort();
      check("zil: açık/atandı/işlemde/yeniden açıldı için status sorguları + 1 'son güncellenen' sorgusu", JSON.stringify(statuses) === JSON.stringify(["assigned", "in_progress", "open", "reopened"]) && reads.filter((r) => r.q.orderByChild === "updated_at").length === 1, JSON.stringify(shapes));
      const personnelReads = log.slice(start).filter((e) => e.uid === "u_service" && e.path === "v2/personnel");
      check("zil: personel kaydı e-posta indeksli sorguyla (tüm liste değil)", personnelReads.length <= 1 && personnelReads.every((r) => r.q && r.q.orderByChild === "email"), JSON.stringify(personnelReads.map((r) => r.q)));
      const bytes = reads.reduce((a, r) => a + r.bytes, 0);
      if (verbose) console.log(`  · atayıcı ilk yükleme: ${reads.length} sorgu, ${(bytes / 1024).toFixed(1)} KB (son-80 penceresi ≈ 80×1,8 = 144 KB idi)`);
      check("zil: ilk yükleme ≤ 100 KB (N=200 kapalı talepli veride; eski ~144 KB + tüm personel)", bytes <= 100 * 1024, `${(bytes / 1024).toFixed(1)} KB`);
      await s.page.click("#sv2-notif-btn");
      const texts = await s.page.locator("#sv2-notif-panel .sv2-notif-item").allTextContents();
      check("200 yeni kapalı talepten sonra bile eski atanmamış talep 'Atama bekliyor' bildirimi verir (PER-05/OLC-02)", texts.some((t) => t.includes("Atama bekliyor") && t.includes("SUP-ORN-FI-2610-9001")), texts.slice(0, 3).join(" | "));
      const badge = Number((await s.page.textContent("#sv2-notif-badge")).replace(/\D/g, ""));
      check("rozet = panel satır sayısı (atayıcı)", badge === texts.length, `${badge} ≠ ${texts.length}`);
      await s.page.keyboard.press("Escape");

      // sayfadan sayfaya geçiş: önbellek → ağ okuması yok
      const mark = log.length;
      await s.goto("/support-v2/change-password.html");
      await waitFor(async () => !(await s.page.locator("#sv2-notif-badge").isHidden()));
      await sleep(300);
      const second = log.slice(mark).filter((e) => e.uid === "u_service" && (e.path === "v2/tickets" || e.path === "v2/personnel"));
      check("ikinci sayfa yüklemesi (1 dk içinde): zil için ağ okuması 0", second.length === 0, JSON.stringify(second.map((r) => r.path + JSON.stringify(r.q))));

      // yeniden çizim (kabuk anahtarı değişse bile) ağa gitmez
      const mark2 = log.length;
      await s.page.evaluate(async () => {
        const ui = await import("/assets/js/support-v2/ui-shell.js");
        const auth = await import("/assets/js/support-v2/auth-guard.js");
        const profile = auth.getLastSession();
        for (let i = 0; i < 6; i++) ui.renderShell("#sv2-app", { title: "Deneme " + i, activePage: i % 2 ? "password" : "tickets", profile, isAdmin: true, content: "<p>içerik</p>" });
      });
      await sleep(300);
      check("6 kabuk yeniden çizimi: zil için ağ okuması 0 (yoklama yalnız ilk çağrıda)", log.slice(mark2).filter((e) => e.uid === "u_service" && e.path.startsWith("v2/tickets")).length === 0);
      check("yeniden çizimden sonra zil rozeti ve düğmesi çalışır", (await s.page.locator("#sv2-notif-badge").isVisible()) && (await s.page.locator("#sv2-notif-btn").count()) === 1);
      await s.context.close();
    }

    // ── Danışman: eski SLA aşımı kaybolmaz
    {
      const s = await srv.session("u_cons1");
      await s.goto("/support-v2/change-password.html");
      await waitFor(async () => !(await s.page.locator("#sv2-notif-badge").isHidden()));
      await s.page.click("#sv2-notif-btn");
      const texts = await s.page.locator("#sv2-notif-panel .sv2-notif-item").allTextContents();
      check("200 yeni kapalı talepten sonra bile eski SLA aşımı bildirimi kalır", texts.some((t) => t.includes("SLA hedefi aşıldı") && t.includes("SUP-ORN-FI-2610-9002")), texts.slice(0, 4).join(" | "));
      check("kapalı talepler bildirim üretmez (yalnız eylem bekleyenler)", !texts.some((t) => /SUP-ORN-FI-2610-10\d\d/.test(t)));
      await s.context.close();
    }

    // ── Yoklama sıklığı (test dikişi: 400 ms ≙ 5 dk): görünürken yalnız "değişti mi?" yoklaması, gizliyken sıfır
    {
      const s = await srv.session("u_cons1");
      await s.page.addInitScript(() => {
        window.__SV2_BELL_POLL_MS = 400;
      });
      const start = log.length;
      await s.goto("/support-v2/change-password.html");
      await waitFor(async () => !(await s.page.locator("#sv2-notif-badge").isHidden()));
      const initial = ticketReads(log, "u_cons1", start).length;
      const afterInit = log.length;
      await sleep(2600);
      const polls = ticketReads(log, "u_cons1", afterInit);
      check("görünür sekmede periyodik yoklama çalışır ve yalnız 'değişti mi?' sorgusudur (tek talep)", polls.length >= 3 && polls.every((r) => r.q && r.q.orderByChild === "updated_at" && r.q.limitToLast === 1), JSON.stringify(polls.map((r) => r.q)));
      check("boşta yoklama maliyeti: yoklama başına ≤ 3 KB", polls.every((r) => r.bytes <= 3 * 1024), JSON.stringify(polls.map((r) => r.bytes)));
      if (verbose) console.log(`  · ilk yükleme ${initial} sorgu; 2,6 sn'de ${polls.length} yoklama`);

      // veri değişirse tam yenileme (hedefli sorgular)
      const beforeChange = log.length;
      world.seed("v2/tickets/t2/updated_at", new Date().toISOString());
      const reloaded = await waitFor(() => ticketReads(log, "u_cons1", beforeChange).filter((r) => r.q.orderByChild === "status").length >= 4, 3000);
      check("veri değişince tam yenileme (4 status sorgusu) yapılır", reloaded);

      // gizli sekme: yoklama durur
      await s.page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await sleep(300);
      const hiddenStart = log.length;
      await sleep(2200);
      check("gizli sekmede yoklama YOK", ticketReads(log, "u_cons1", hiddenStart).length === 0, String(ticketReads(log, "u_cons1", hiddenStart).length));
      // yeniden görünür: son yoklamadan beri aralık geçtiği için bir yenileme olur
      await s.page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      check("sekme yeniden görünür olunca yoklama sürer", await waitFor(() => ticketReads(log, "u_cons1", hiddenStart).length >= 1, 2500));
      await s.context.close();
    }

    // ── Müşteri: aynı liste TEK okuma (OLC-07, MUS-19)
    for (const [uid, page, label, expectBy] of [
      ["u_cust", "/support-v2/customer/dashboard.html", "pano", "user_id"],
      ["u_cust", "/support-v2/customer/tickets.html", "talepler", "user_id"],
      ["u_cust", "/support-v2/customer/profile.html", "profil", "user_id"],
      ["u_cadmin", "/support-v2/customer/dashboard.html", "firma yöneticisi panosu", "company_id"],
      ["u_cust", "/support-v2/customer/ticket-detail.html?id=t1", "talep detayı (yalnız zil)", "user_id"],
    ]) {
      const start = log.length;
      const s = await srv.session(uid);
      await s.goto(page);
      await waitFor(async () => !(await s.page.locator("#sv2-notif-badge").isHidden()));
      await sleep(800);
      const reads = ticketReads(log, uid, start).filter((r) => r.q && r.q.orderByChild === expectBy);
      const direct = log.slice(start).filter((e) => e.uid === uid && e.path === "v2/tickets/t1" && e.op === "get").length;
      check(`müşteri ${label}: talep listesi ${/detay/.test(label) ? "zil için " : ""}TEK okuma`, reads.length === 1, `${reads.length} okuma`);
      void direct;
      await s.context.close();
    }

    // ── Rozet = panel sayısı (MUS-28); 50 üstü "+N" satırı
    {
      for (let i = 1; i <= 14; i++) world.seed(`v2/tickets/w${i}`, ticket(`w${i}`, 3000 + i, { status: "waiting_customer", assigned: "p1", age: 2 * D, updated: 3 * H, updated_by: "u_cons1" }));
      const s = await srv.session("u_cust");
      await s.goto("/support-v2/customer/profile.html");
      await waitFor(async () => !(await s.page.locator("#sv2-notif-badge").isHidden()));
      await s.page.click("#sv2-notif-btn");
      const n1 = await s.page.locator("#sv2-notif-panel .sv2-notif-item").count();
      const b1 = (await s.page.textContent("#sv2-notif-badge")).trim();
      check("18 bildirim: rozet = panel satırı (12 sınırı yok; MUS-28)", n1 === 18 && b1 === "18", `panel ${n1}, rozet ${b1}`);
      await s.context.close();

      for (let i = 15; i <= 60; i++) world.seed(`v2/tickets/w${i}`, ticket(`w${i}`, 3000 + i, { status: "waiting_customer", assigned: "p1", age: 2 * D, updated: 3 * H, updated_by: "u_cons1" }));
      const s2 = await srv.session("u_cust");
      await s2.goto("/support-v2/customer/profile.html");
      await waitFor(async () => !(await s2.page.locator("#sv2-notif-badge").isHidden()));
      await s2.page.click("#sv2-notif-btn");
      const n2 = await s2.page.locator("#sv2-notif-panel .sv2-notif-item").count();
      const more = await s2.page.locator("#sv2-notif-panel .sv2-notif-more").textContent().catch(() => "");
      const b2 = (await s2.page.textContent("#sv2-notif-badge")).trim();
      check("64 bildirim: panel 50 satır + '+14' notu, rozet '50+'", n2 === 50 && /\+14/.test(more) && b2 === "50+", `panel ${n2}, not "${more}", rozet ${b2}`);
      const live = await s2.page.evaluate(() => ({ label: document.getElementById("sv2-notif-btn").getAttribute("aria-label") }));
      check("zil düğmesi adı okunmamış sayısını içerir", /Bildirimler, 50\+ okunmamış/.test(live.label), live.label);
      await s2.context.close();
    }

    // ── Saf işlevler: yuvarlama (SEN-34) ve doğru atıf (SEN-33)
    {
      const s = await srv.session("u_cust");
      await s.goto("/support-v2/change-password.html");
      await s.page.waitForSelector("#sv2-notif-btn");
      const out = await s.page.evaluate(async (now) => {
        const m = await import("/assets/js/support-v2/notifications.js");
        const ago = (ms) => new Date(now - ms).toISOString();
        const rel = {
          s30: m.relativeTime(ago(30 * 1000), now),
          m59: m.relativeTime(ago(59.7 * 60000), now),
          m5: m.relativeTime(ago(5 * 60000 + 40000), now),
          h23: m.relativeTime(ago(23.7 * 3600000), now),
          h2: m.relativeTime(ago(2 * 3600000 + 1800000), now),
        };
        const base = { id: "x1", ticket_number: "SUP-1", title: "T", status: "in_progress", user_id: "u_cust", user_name: "Ayşe Demir", created_at: ago(20 * 60000), updated_at: ago(60000), public_updated_at: ago(60000), assigned_uids: { u_cons1: true, u_cons2: true }, assigned_to_id: "p1" };
        const run = (session, t, extra) => m.deriveNotifications({ tickets: [{ ...base, ...t }], session, myPersonnelId: "p1", seen: {}, baseline: 0, now, ...(extra || {}) })[0]?.text;
        return {
          rel,
          staffCustomer: run({ uid: "u_cons1", role: "consultant" }, { public_updated_by: "u_cust" }),
          staffColleague: run({ uid: "u_cons1", role: "consultant" }, { public_updated_by: "u_cons2" }),
          staffUnknown: run({ uid: "u_cons1", role: "consultant" }, { public_updated_by: "u_root" }),
          colleagueUpdate: run({ uid: "u_cadmin", role: "company_admin" }, { public_updated_by: "u_cust", user_id: "u_cust" }),
          colleagueClosed: run({ uid: "u_cadmin", role: "company_admin" }, { public_updated_by: "u_cust", user_id: "u_cust", status: "closed" }),
          staffToCustomer: run({ uid: "u_cust", role: "customer" }, { public_updated_by: "u_cons1" }),
        };
      }, Date.now());
      check("zil zamanı: 59,7 dk → '59 dk önce', 23,7 sa → '23 sa önce' (SEN-34)", out.rel.m59 === "59 dk önce" && out.rel.h23 === "23 sa önce" && out.rel.s30 === "az önce" && out.rel.m5 === "5 dk önce" && out.rel.h2 === "2 sa önce", JSON.stringify(out.rel));
      check("zil metni: müşteri güncellemesi personele 'Müşteri yanıtladı…' (SEN-33)", /^Müşteri yanıtladı/.test(out.staffCustomer), out.staffCustomer);
      check("zil metni: meslektaş danışman işlemi 'Başka bir danışman…'", /Başka bir danışman/.test(out.staffColleague), out.staffColleague);
      check("zil metni: yönetici/diğer işlem müşteri sayılmaz", out.staffUnknown === "Talep güncellendi", out.staffUnknown);
      check("zil metni: firma yöneticisi için meslektaş işlemi ayrı yazılır", /Ayşe Demir talebi güncelledi/.test(out.colleagueUpdate) && /Firma çalışanınız talebi kapattı/.test(out.colleagueClosed), JSON.stringify([out.colleagueUpdate, out.colleagueClosed]));
      check("zil metni: personel işlemi müşteriye 'Danışmanımız…'", /^Danışmanımız talebinizi/.test(out.staffToCustomer), out.staffToCustomer);
      await s.context.close();
    }
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
