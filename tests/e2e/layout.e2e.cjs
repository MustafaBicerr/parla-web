/**
 * E2E: yerleşim (WP-12) — 360/390/768/1440 px'te sayfa düzeyinde yatay taşma 0, kritik düğmeler görünür,
 * tablolar dar ekranda kart düzenine geçer, pencere altbilgisi (Kaydet/İptal) görünür alandadır,
 * giriş sayfası 360 px'te taşmaz, mobilde sayfa başlığı okunur, uzun kesilmez metin taşmaz/kırpılmaz.
 *
 * Çalıştırma: node tests/e2e/layout.e2e.cjs [--verbose]
 */
const fs = require("node:fs");
const path = require("node:path");
const { createWorld, startServer, ROOT } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const verbose = process.argv.includes("--verbose");
const results = [];
const check = (name, ok, extra) => results.push([ok ? "PASS" : "FAIL", name, ok ? "" : extra || ""]);

const adminPages = fs.readdirSync(path.join(ROOT, "support-v2/admin")).map((f) => `/support-v2/admin/${f}`);
const customerPages = fs.readdirSync(path.join(ROOT, "support-v2/customer")).map((f) => `/support-v2/customer/${f}`);
const query = { "ticket-detail.html": "?id=t1", "company-detail.html": "?id=cA", "personnel-detail.html": "?id=p1", "project-detail.html": "?id=pr1", "user-detail.html": "?uid=u_cust" };
const VIEWPORTS = [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "768", width: 768, height: 1024, mobile: true },
  { name: "1440", width: 1440, height: 900, mobile: false },
];
const roles = [
  { uid: "u_root", pages: [...adminPages, "/support-v2/change-password.html"] },
  { uid: "u_cons1", pages: adminPages.filter((p) => !/users\.html|user-detail/.test(p)) },
  { uid: "u_cust", pages: [...customerPages, "/support-v2/change-password.html"] },
  { uid: "u_cadmin", pages: customerPages },
];

/** Sayfa düzeyinde yatay taşma + sayfa içi kapların taşması (kırpılan içerik). */
async function overflowInfo(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    const out = { vw, scrollW: doc.scrollWidth, bodyW: document.body.scrollWidth, offenders: [] };
    document.querySelectorAll(".sv2-content *").forEach((el) => {
      if (out.offenders.length >= 3) return;
      if (el.closest(".sv2-table-wrap, .sv2-assign-list, .sv2-notif-panel, [hidden]")) return;
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== "fixed") out.offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
    });
    return out;
  });
}

(async () => {
  const world = createWorld(buildSeed());
  // Uzun, kesilmez metin içeren bir talep (UX-17, MUS-22)
  const LONG = "https://ornek.com/cok/uzun/bir/baglanti/" + "a".repeat(120) + "?hata=" + "KOD1234567890".repeat(8);
  world.seed("v2/tickets/t1/title", "UZUN" + "X".repeat(90));
  world.seed("v2/tickets/t1/description", LONG);
  const srv = await startServer(world);
  try {
    // ── 1) Tüm sayfalar × roller × ekran genişlikleri: yatay taşma 0
    for (const vp of VIEWPORTS) {
      for (const { uid, pages } of roles) {
        const s = await srv.session(uid, { viewport: { width: vp.width, height: vp.height }, hasTouch: vp.mobile });
        for (const p of pages) {
          const file = p.split("/").pop();
          await s.goto(p + (query[file] || ""));
          await s.page.waitForSelector(".sv2-content", { timeout: 8000 }).catch(() => {});
          await s.page.waitForTimeout(450);
          const o = await overflowInfo(s.page);
          check(`taşma yok [${vp.name}] [${uid}] ${p}`, o.scrollW <= o.vw + 1 && o.bodyW <= o.vw + 1 && o.offenders.length === 0, JSON.stringify(o));
          if (vp.mobile) {
            const bar = await s.page.evaluate(() => {
              const t = document.querySelector(".sv2-page-title");
              const m = document.querySelector("#sv2-menu-toggle");
              const r = t && t.getBoundingClientRect();
              const mr = m && m.getBoundingClientRect();
              return { titleW: r ? Math.round(r.width) : 0, clipped: t ? t.scrollWidth > t.clientWidth + 1 : true, toggleVisible: !!mr && mr.width >= 40 && mr.height >= 40 };
            });
            check(`mobil üst çubuk: menü düğmesi ≥40 px, sayfa başlığı kırpılmaz [${vp.name}] [${uid}] ${p}`, bar.toggleVisible && !bar.clipped && bar.titleW > 0, JSON.stringify(bar));
          }
        }
        await s.context.close();
      }
    }

    // ── 2) Giriş sayfası: 360 px (UX-16)
    for (const width of [360, 320]) {
      const anon = await srv.session(null, { viewport: { width, height: 740 }, hasTouch: true });
      await anon.goto("/support-v2/login.html");
      await anon.page.waitForSelector("#sv2-login-submit");
      const o = await overflowInfo(anon.page);
      check(`giriş sayfası ${width} px'te taşmaz`, o.scrollW <= o.vw + 1, JSON.stringify(o));
      const inView = await anon.page.evaluate(() => {
        const b = document.getElementById("sv2-login-submit").getBoundingClientRect();
        return { bottom: Math.round(b.bottom), vh: window.innerHeight };
      });
      check(`"Giriş Yap" düğmesi ilk ekranda görünür (${width} px)`, inView.bottom <= inView.vh, JSON.stringify(inView));
      const logo = await anon.page.evaluate(() => {
        const i = document.querySelector(".sv2-auth-logo").getBoundingClientRect();
        return { w: Math.round(i.width), h: Math.round(i.height) };
      });
      check(`giriş logosu küçük gösterilir (≤ 64 px yükseklik) (${width} px)`, logo.h <= 64, JSON.stringify(logo));
      await anon.context.close();
    }
    {
      const anon = await srv.session(null);
      await anon.goto("/support-v2/login.html");
      await anon.page.waitForSelector("#sv2-login-submit");
      const logo = await anon.page.evaluate(() => {
        const i = document.querySelector(".sv2-auth-logo").getBoundingClientRect();
        return { w: Math.round(i.width), h: Math.round(i.height) };
      });
      check("giriş logosu masaüstünde 64 px yükseklikte (UX-38)", logo.h <= 64 && logo.w <= 280, JSON.stringify(logo));
      await anon.context.close();
    }

    // ── 3) Tablo → kart (UX-11, MUS-24, PER-41): müşteri listesi ve yönetici talep listesi
    for (const [uid, url, sel, label] of [
      ["u_cust", "/support-v2/customer/tickets.html", "#sv2-tickets-table", "müşteri talepleri"],
      ["u_cadmin", "/support-v2/customer/dashboard.html", "#sv2-recent-tickets", "müşteri pano son talepler"],
      ["u_root", "/support-v2/admin/tickets.html", ".sv2-table-wrap", "yönetici talepleri"],
      ["u_root", "/support-v2/admin/companies.html", ".sv2-table-wrap", "müşteriler"],
    ]) {
      for (const vp of VIEWPORTS.filter((v) => v.mobile)) {
        const s = await srv.session(uid, { viewport: { width: vp.width, height: vp.height }, hasTouch: true });
        await s.goto(url);
        await s.page.waitForSelector(`${sel} .sv2-table`, { timeout: 8000 });
        const t = await s.page.evaluate((selector) => {
          const wrap = document.querySelector(selector).closest(".sv2-table-wrap") || document.querySelector(selector);
          const table = wrap.querySelector(".sv2-table");
          const row = table.querySelector("tbody tr");
          const cells = [...row.querySelectorAll("td")];
          const labelled = cells.every((c) => c.hasAttribute("data-label"));
          const stacked = getComputedStyle(row).display === "block";
          const theadHidden = getComputedStyle(table.querySelector("thead")).display === "none";
          const status = cells.find((c) => /durum/i.test(c.getAttribute("data-label") || ""));
          const statusVisible = status ? status.getBoundingClientRect().width > 0 && status.getBoundingClientRect().right <= window.innerWidth + 1 : null;
          return { labelled, stacked, theadHidden, statusVisible, scrollW: wrap.scrollWidth, clientW: wrap.clientWidth };
        }, sel);
        check(`kart düzeni [${vp.name}] ${label}`, t.labelled && t.stacked && t.theadHidden && t.scrollW <= t.clientW + 1 && t.statusVisible !== false, JSON.stringify(t));
        await s.context.close();
      }
    }

    // ── 3b) Masaüstü: yönetici talep listesi — SLA/İşlemler ekran dışında kalmaz, NO/KONU harf harf sarılmaz (UX-12)
    for (const width of [1440, 1366]) {
      const s = await srv.session("u_root", { viewport: { width, height: 900 } });
      await s.goto("/support-v2/admin/tickets.html");
      await s.page.waitForSelector(".sv2-table tbody tr");
      const t = await s.page.evaluate(() => {
        const wrap = document.querySelector(".sv2-table-wrap");
        const w = wrap.getBoundingClientRect();
        const lastBtn = wrap.querySelector("tbody tr td:last-child a, tbody tr td:last-child button").getBoundingClientRect();
        const sla = wrap.querySelector("tbody tr .sv2-sla");
        const num = wrap.querySelector('tbody tr td[data-label="NO"] a').getBoundingClientRect();
        const subject = wrap.querySelector('tbody tr td[data-label="KONU"]').getBoundingClientRect();
        return { scrollW: wrap.scrollWidth, clientW: wrap.clientWidth, actionsInside: lastBtn.right <= w.right + 1, slaRight: sla ? Math.round(sla.getBoundingClientRect().right) : 0, wrapRight: Math.round(w.right), numH: Math.round(num.height), subjectW: Math.round(subject.width) };
      });
      check(`yönetici talep listesi [${width}]: İşlemler düğmeleri görünür, NO tek satır, KONU ≥ 150 px`, t.actionsInside && t.numH < 30 && t.subjectW >= 150, JSON.stringify(t));
      if (width === 1440) check("yönetici talep listesi [1440]: tablo yatay kaydırma gerektirmez (SLA + İşlemler ekranda)", t.scrollW <= t.clientW + 1 && t.slaRight <= t.wrapRight, JSON.stringify(t));
      await s.context.close();
    }

    // ── 4) Pencere: altbilgi düğmeleri görünür alanda (UX-32) — telefon
    {
      const s = await srv.session("u_cust", { viewport: { width: 390, height: 844 }, hasTouch: true });
      await s.goto("/support-v2/customer/tickets.html");
      await s.page.waitForSelector("#sv2-new-ticket-btn");
      await s.page.click("#sv2-new-ticket-btn");
      await s.page.waitForSelector("#sv2-create-ticket-modal.is-open");
      await s.page.waitForTimeout(400);
      const m = await s.page.evaluate(() => {
        const modal = document.querySelector("#sv2-create-ticket-modal .sv2-modal");
        const submit = document.getElementById("sv2-create-ticket-submit").getBoundingClientRect();
        const body = modal.querySelector(".sv2-modal-body");
        return { submitBottom: Math.round(submit.bottom), vh: window.innerHeight, submitVisible: submit.top >= 0 && submit.bottom <= window.innerHeight + 1, bodyScrolls: body.scrollHeight > body.clientHeight, pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1 && getComputedStyle(document.body).overflow !== "hidden" };
      });
      check("telefon: pencere altbilgisi (Talebi Gönder) kaydırmadan görünür; yalnız gövde kayar", m.submitVisible && m.bodyScrolls, JSON.stringify(m));
      check("telefon: pencere açıkken sayfa kaymaz (kayma kilidi)", !m.pageScrolls, JSON.stringify(m));
      const touch = await s.page.evaluate(() => [...document.querySelectorAll("#sv2-create-ticket-modal button, #sv2-create-ticket-modal select, #sv2-create-ticket-modal input:not([type=hidden])")].filter((e) => e.getClientRects().length).map((e) => ({ id: e.id || e.className, h: Math.round(e.getBoundingClientRect().height) })).filter((x) => x.h < 40));
      check("telefon: pencere öğeleri ≥ 40 px yükseklik", touch.length === 0, JSON.stringify(touch));
      const fs16 = await s.page.evaluate(() => [...document.querySelectorAll("#sv2-create-ticket-modal input:not([type=hidden]), #sv2-create-ticket-modal select, #sv2-create-ticket-modal textarea")].filter((e) => e.getClientRects().length && parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id));
      check("telefon: giriş alanları ≥ 16 px (iOS yakınlaştırma)", fs16.length === 0, JSON.stringify(fs16));
      await s.context.close();
    }

    // ── 5) Uzun kesilmez metin: kırpılmaz, taşmaz (UX-17, MUS-22)
    for (const vp of [VIEWPORTS[0], VIEWPORTS[2]]) {
      const s = await srv.session("u_cust", { viewport: { width: vp.width, height: vp.height }, hasTouch: vp.mobile });
      await s.goto("/support-v2/customer/ticket-detail.html?id=t1");
      await s.page.waitForSelector(".sv2-meta-grid");
      await s.page.waitForTimeout(300);
      const o = await overflowInfo(s.page);
      const clipped = await s.page.evaluate(() => {
        const out = [];
        document.querySelectorAll(".sv2-section-header h3, .sv2-ticket-description p").forEach((el) => {
          const sec = el.closest(".sv2-section").getBoundingClientRect();
          const r = el.getBoundingClientRect();
          if (r.right > sec.right + 1) out.push(el.tagName + " " + Math.round(r.right) + ">" + Math.round(sec.right));
        });
        return out;
      });
      check(`uzun metin taşmaz/kırpılmaz [${vp.name}] talep detayı`, o.scrollW <= o.vw + 1 && clipped.length === 0, JSON.stringify({ o, clipped }));
      await s.context.close();
    }
    {
      const s = await srv.session("u_cust", { viewport: { width: 390, height: 844 }, hasTouch: true });
      await s.goto("/support-v2/customer/profile.html");
      await s.page.waitForSelector(".sv2-meta-grid");
      const inside = await s.page.evaluate(() => [...document.querySelectorAll(".sv2-meta-item > span")].every((e) => e.getBoundingClientRect().right <= document.documentElement.clientWidth + 1));
      check("profil: e-posta/rol 390 px'te sığar (MUS-25)", inside);
      const badge = await s.page.evaluate(() => {
        const b = document.querySelector(".sv2-role-badge");
        const cs = getComputedStyle(b);
        return { color: cs.color, bg: cs.backgroundColor, size: cs.fontSize };
      });
      check("profil: rol rozeti beyaz metin (UX-23/29)", badge.color === "rgb(255, 255, 255)" && badge.size === "12px", JSON.stringify(badge));
      await s.context.close();
    }

    // ── 6) Bildirim paneli telefonda kenarlıklı ve sağa/sola taşmaz (UX-31)
    {
      const s = await srv.session("u_cust", { viewport: { width: 390, height: 844 }, hasTouch: true });
      await s.goto("/support-v2/customer/dashboard.html");
      await s.page.waitForSelector("#sv2-notif-btn");
      await s.page.click("#sv2-notif-btn");
      await s.page.waitForSelector("#sv2-notif-panel.is-open");
      await s.page.waitForTimeout(350);
      const r = await s.page.evaluate(() => {
        const p = document.getElementById("sv2-notif-panel");
        const b = p.getBoundingClientRect();
        const cs = getComputedStyle(p);
        return { left: Math.round(b.left), right: Math.round(b.right), vw: window.innerWidth, radius: cs.borderTopLeftRadius, border: cs.borderLeftWidth };
      });
      check("telefon: bildirim paneli iki yanda eşit boşluklu, kenarlıklı", r.left >= 4 && r.vw - r.right >= 4 && Math.abs(r.left - (r.vw - r.right)) <= 2 && r.border === "1px" && r.radius !== "0px", JSON.stringify(r));
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
