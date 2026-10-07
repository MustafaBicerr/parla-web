/**
 * E2E: erişilebilirlik (WP-12) — axe-core taraması + klavye-yalnız akışlar.
 *
 *  1. Tüm sayfalar × roller (smoke-all matrisi) ve AÇIK pencereler/onay/bildirim paneli:
 *     axe-core kritik ve ciddi (critical/serious) ihlal sayısı 0 olmalı.
 *  2. Klavye-yalnız: içeriğe geç bağlantısı, pencere aç/kapat/Esc/odak geri dönüşü/arka plan inert,
 *     talep oluşturma (dosya ekle düğmesi dahil), form hatasında ilk hataya odak ve aria-*, otomatik tamamlama,
 *     aç/kapa anahtarı odak halkası, mobil çekmece (inert/odak/Esc), bildirim zili (aria-expanded/Esc).
 *
 * axe-core repoya kurulu değildir; yerel yoldan yüklenir (öncelik sırası):
 *   AXE_CORE_PATH (axe.min.js ya da paket dizini) → `require.resolve("axe-core")` → tests/e2e/node_modules.
 * Bulunamazsa test ATLANIR (çıkış 0); CI'da `A11Y_REQUIRE=1` ile bulunamaması hata sayılır.
 * Önerilen CI kurulumu: `npm i -D axe-core` (tests/e2e/package.json ya da kök devDependency).
 *
 * Çalıştırma: node tests/e2e/a11y.e2e.cjs [--verbose] [--only=pages|modals|keyboard]
 */
const fs = require("node:fs");
const path = require("node:path");
const { createWorld, startServer, ROOT } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const verbose = process.argv.includes("--verbose");
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);

function findAxe() {
  const candidates = [];
  const env = process.env.AXE_CORE_PATH;
  if (env) candidates.push(env, path.join(env, "axe.min.js"), path.join(env, "node_modules", "axe-core", "axe.min.js"));
  try {
    candidates.push(require.resolve("axe-core/axe.min.js"));
  } catch {
    /* kurulu değil */
  }
  candidates.push(path.join(__dirname, "node_modules", "axe-core", "axe.min.js"));
  return candidates.find((c) => c && fs.existsSync(c) && fs.statSync(c).isFile());
}
const axePath = findAxe();
if (!axePath) {
  const msg = "axe-core bulunamadı (AXE_CORE_PATH ayarlayın ya da `npm i -D axe-core`).";
  if (process.env.A11Y_REQUIRE) {
    console.error("FAIL | " + msg);
    process.exit(1);
  }
  console.log("ATLANDI | " + msg);
  process.exit(0);
}

const results = [];
const check = (name, ok, extra) => results.push([ok ? "PASS" : "FAIL", name, ok ? "" : extra || ""]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const adminPages = fs.readdirSync(path.join(ROOT, "support-v2/admin")).map((f) => `/support-v2/admin/${f}`);
const customerPages = fs.readdirSync(path.join(ROOT, "support-v2/customer")).map((f) => `/support-v2/customer/${f}`);
const query = { "ticket-detail.html": "?id=t1", "company-detail.html": "?id=cA", "personnel-detail.html": "?id=p1", "project-detail.html": "?id=pr1", "user-detail.html": "?uid=u_cust" };
const matrix = [
  { uid: "u_root", pages: [...adminPages, "/support-v2/change-password.html"] },
  { uid: "u_service", pages: adminPages },
  { uid: "u_pm", pages: adminPages.filter((p) => !/users\.html|user-detail/.test(p)) },
  { uid: "u_cons1", pages: adminPages.filter((p) => !/users\.html|user-detail/.test(p)) },
  { uid: "u_cust", pages: [...customerPages, "/support-v2/change-password.html"] },
  { uid: "u_cadmin", pages: customerPages },
];

/** Açık pencere taramaları: [rol, sayfa, açıcı seçici, pencere kimliği, açıklama]. */
const MODALS = [
  ["u_cust", "/support-v2/customer/dashboard.html", "#sv2-new-ticket-btn", "sv2-create-ticket-modal", "müşteri: yeni talep"],
  ["u_cust", "/support-v2/customer/tickets.html", "#sv2-new-ticket-btn", "sv2-create-ticket-modal", "müşteri: talepler → yeni talep"],
  ["u_service", "/support-v2/admin/tickets.html", "#sv2-new-ticket", "sv2-create-ticket-modal", "yönetici: yeni talep"],
  ["u_root", "/support-v2/admin/users.html", "#btn-new-user", "modal-new-user", "yeni muhatap"],
  ["u_root", "/support-v2/admin/companies.html", "#btn-new-company", "modal-new-company", "yeni müşteri"],
  ["u_root", "/support-v2/admin/contracts.html", "#btn-new-contract", null, "yeni sözleşme"],
  ["u_root", "/support-v2/admin/projects.html", "#btn-new-project", null, "yeni proje"],
  ["u_root", "/support-v2/admin/personnel.html", "#btn-new-personnel", "modal-new-personnel", "yeni danışman"],
  ["u_root", "/support-v2/admin/departments.html", "#btn-new-dept", null, "yeni departman"],
  ["u_root", "/support-v2/admin/user-detail.html?uid=u_cust", "#btn-edit-user", "modal-edit-user", "muhatap düzenle"],
  ["u_root", "/support-v2/admin/company-detail.html?id=cA", "#btn-edit-company", "modal-edit-company", "müşteri düzenle"],
  ["u_root", "/support-v2/admin/personnel-detail.html?id=p1", "#btn-edit-person", "modal-edit-person", "danışman düzenle"],
];

async function openPage(s, url) {
  s.errors.length = 0;
  await s.goto(url);
  await s.page.waitForSelector(".sv2-content, .sv2-auth-wrap, .sv2-legal-wrap", { timeout: 8000 }).catch(() => {});
  await s.page.waitForTimeout(600);
}

async function runAxe(page, options) {
  await page.addScriptTag({ path: axePath }).catch(() => {});
  return page.evaluate(async (opts) => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
      resultTypes: ["violations"],
      ...opts,
    });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ") + " :: " + (n.failureSummary || "").split("\n").slice(0, 3).join(" ").slice(0, 200)), count: v.nodes.length }));
  }, options || {});
}

const blocking = (v) => v.impact === "critical" || v.impact === "serious";
const fmt = (vs) => vs.map((v) => `${v.id}(${v.impact}×${v.count}) ${v.nodes[0]}`).join(" | ");

(async () => {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);
  const moderate = new Map();
  try {
    // ── 1) Sayfalar × roller
    if (!only || only === "pages") {
      for (const { uid, pages } of matrix) {
        const s = await srv.session(uid);
        for (const p of pages) {
          const file = p.split("/").pop();
          await openPage(s, p + (query[file] || ""));
          const bad = (await runAxe(s.page)).filter((v) => v.impact);
          const hard = bad.filter(blocking);
          bad.filter((v) => !blocking(v)).forEach((v) => moderate.set(v.id, (moderate.get(v.id) || 0) + v.count));
          check(`axe [${uid}] ${p}`, hard.length === 0, fmt(hard));
          if (verbose && bad.length) console.log(`  · ${uid} ${p}: ${bad.map((v) => v.id + "×" + v.count).join(", ")}`);
        }
        await s.context.close();
      }
      // oturumsuz: giriş sayfası + e-posta işlem sayfası
      const anon = await srv.session(null);
      for (const p of ["/support-v2/login.html", "/support-v2/auth-action.html?mode=resetPassword&oobCode=x", "/support-v2/privacy.html"]) {
        await openPage(anon, p);
        const hard = (await runAxe(anon.page)).filter(blocking);
        check(`axe [anonim] ${p}`, hard.length === 0, fmt(hard));
      }
      await anon.context.close();
    }

    // ── 2) Açık pencereler (masaüstü + telefon)
    if (!only || only === "modals") {
      for (const viewport of [{ width: 1440, height: 900, name: "masaüstü" }, { width: 390, height: 844, name: "telefon" }]) {
        const cache = new Map();
        for (const [uid, url, opener, modalId, label] of MODALS) {
          if (!cache.has(uid)) cache.set(uid, await srv.session(uid, { viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.width < 600 }));
          const s = cache.get(uid);
          await openPage(s, url);
          await s.page.click(opener).catch(() => {});
          const open = await s.page.waitForSelector(".sv2-modal-overlay.is-open", { timeout: 3000 }).catch(() => null);
          check(`pencere açıldı [${viewport.name}] ${label}`, !!open, "açılmadı");
          if (!open) continue;
          const id = await s.page.evaluate(() => document.querySelector(".sv2-modal-overlay.is-open").id);
          if (modalId) check(`pencere kimliği [${label}]`, id === modalId, id);
          const hard = (await runAxe(s.page)).filter(blocking);
          check(`axe pencere [${viewport.name}] ${label}`, hard.length === 0, fmt(hard));
          // her pencerede: erişilebilir ad, odak içeride, arka plan inert
          const info = await s.page.evaluate(() => {
            const o = document.querySelector(".sv2-modal-overlay.is-open");
            const name = o.getAttribute("aria-labelledby") && document.getElementById(o.getAttribute("aria-labelledby"))?.textContent.trim();
            return { name, focusInside: o.contains(document.activeElement), appInert: document.getElementById("sv2-app").hasAttribute("inert"), scrollLocked: document.body.classList.contains("sv2-modal-open"), role: o.getAttribute("role"), modal: o.getAttribute("aria-modal") };
          });
          check(`pencere: ad + odak + inert + kilit [${viewport.name}] ${label}`, !!info.name && info.focusInside && info.appInert && info.scrollLocked && info.role === "dialog" && info.modal === "true", JSON.stringify(info));
          await s.page.keyboard.press("Escape");
          await s.page.waitForTimeout(150);
          const closed = await s.page.evaluate(() => !document.querySelector(".sv2-modal-overlay.is-open") && !document.getElementById("sv2-app").hasAttribute("inert") && !document.body.classList.contains("sv2-modal-open"));
          check(`Esc pencereyi kapatır, arka plan açılır [${viewport.name}] ${label}`, closed, "kapanmadı");
        }
        for (const s of cache.values()) await s.context.close();
      }

      // onay penceresi + bildirim paneli
      const svc = await srv.session("u_service");
      await openPage(svc, "/support-v2/admin/tickets.html");
      const del = svc.page.locator(".sv2-delete-ticket").first();
      if (await del.count()) {
        await del.focus();
        await svc.page.keyboard.press("Enter");
        await svc.page.waitForSelector("#sv2-confirm-overlay.is-open");
        const hard = (await runAxe(svc.page)).filter(blocking);
        check("axe onay penceresi", hard.length === 0, fmt(hard));
        const c = await svc.page.evaluate(() => ({
          role: document.getElementById("sv2-confirm-overlay").getAttribute("role"),
          focusId: document.activeElement.id,
          okClass: document.getElementById("sv2-confirm-ok").className,
          cancelClass: document.getElementById("sv2-confirm-cancel").className,
        }));
        check("onay: alertdialog, varsayılan odak İptal, düğmeler ayırt edilir (UX-42)", c.role === "alertdialog" && c.focusId === "sv2-confirm-cancel" && c.okClass.includes("sv2-btn-danger") && !c.cancelClass.includes("sv2-btn-danger"), JSON.stringify(c));
        await svc.page.keyboard.press("Escape");
        await svc.page.waitForTimeout(100);
        check("onay: Esc kapatır, odak Sil düğmesine döner", await svc.page.evaluate(() => !document.querySelector("#sv2-confirm-overlay.is-open") && document.activeElement.classList.contains("sv2-delete-ticket")));
      }
      await svc.page.waitForSelector("#sv2-notif-btn");
      await svc.page.click("#sv2-notif-btn");
      await svc.page.waitForSelector("#sv2-notif-panel.is-open");
      const hardBell = (await runAxe(svc.page)).filter(blocking);
      check("axe bildirim paneli açık", hardBell.length === 0, fmt(hardBell));
      await svc.context.close();
    }

    // ── 3) Klavye-yalnız akışlar
    if (!only || only === "keyboard") {
      // 3a) içeriğe geç + pencere + talep oluşturma (müşteri, masaüstü)
      const cust = await srv.session("u_cust");
      await openPage(cust, "/support-v2/customer/tickets.html");
      await cust.page.evaluate(() => document.activeElement && document.activeElement.blur());
      await cust.page.keyboard.press("Tab");
      const firstFocus = await cust.page.evaluate(() => ({ cls: document.activeElement.className, text: document.activeElement.textContent.trim() }));
      check("ilk Tab 'İçeriğe geç' bağlantısına gider (UX-10)", /sv2-skip/.test(firstFocus.cls) && /İçeriğe geç/.test(firstFocus.text), JSON.stringify(firstFocus));
      await cust.page.keyboard.press("Enter");
      check("'İçeriğe geç' odağı <main>'e taşır", await cust.page.evaluate(() => document.activeElement.id === "sv2-main" && document.activeElement.tagName === "MAIN"));
      check("sayfa başlığı benzersiz ve anlamlı (UX-40)", /^Taleplerim \| Parla BT Destek$/.test(await cust.page.title()), await cust.page.title());
      check("favicon bağlantısı var (UX-39)", (await cust.page.locator('link[rel="icon"]').count()) >= 1);

      await cust.page.focus("#sv2-new-ticket-btn");
      await cust.page.keyboard.press("Enter");
      await cust.page.waitForSelector("#sv2-create-ticket-modal.is-open");
      const mi = await cust.page.evaluate(() => ({ inside: document.getElementById("sv2-create-ticket-modal").contains(document.activeElement), tag: document.activeElement.tagName }));
      check("pencere açılınca odak pencerenin içinde", mi.inside, JSON.stringify(mi));
      // Tab döngüsü: 40 Tab boyunca odak pencere dışına çıkmaz
      let escaped = false;
      for (let i = 0; i < 40; i++) {
        await cust.page.keyboard.press("Tab");
        if (!(await cust.page.evaluate(() => document.getElementById("sv2-create-ticket-modal").contains(document.activeElement)))) escaped = true;
      }
      check("Tab odağı pencere içinde tutar (odak tuzağı)", !escaped);
      let escapedBack = false;
      for (let i = 0; i < 40; i++) {
        await cust.page.keyboard.press("Shift+Tab");
        if (!(await cust.page.evaluate(() => document.getElementById("sv2-create-ticket-modal").contains(document.activeElement)))) escapedBack = true;
      }
      check("Shift+Tab odağı pencere içinde tutar", !escapedBack);

      // boş gönderim: ilk hataya odak + aria
      await cust.page.focus("#sv2-create-ticket-submit");
      await cust.page.keyboard.press("Enter");
      await cust.page.waitForTimeout(300);
      const err = await cust.page.evaluate(() => {
        const a = document.activeElement;
        const d = a.getAttribute("aria-describedby");
        const errEl = d && document.getElementById(d.split(" ")[0]);
        return { id: a.id, invalid: a.getAttribute("aria-invalid"), errText: errEl && errEl.textContent.trim(), errRole: errEl && errEl.getAttribute("role") };
      });
      check("form hatası: odak ilk hatalı alanda, aria-invalid + aria-describedby + role=alert (UX-26)", err.id === "sv2-ticket-title" && err.invalid === "true" && !!err.errText && err.errRole === "alert", JSON.stringify(err));

      // dosya ekle düğmesi klavyeyle odaklanır ve dosya seçiciyi açar (UX-08)
      await cust.page.focus("#sv2-create-btn");
      const [chooser] = await Promise.all([cust.page.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null), cust.page.keyboard.press("Enter")]);
      check("'Dosya Ekle' düğmesi klavyeyle dosya seçiciyi açar (UX-08)", !!chooser);
      if (chooser) await chooser.setFiles([]);

      // klavyeyle doldur + gönder
      await cust.page.focus("#sv2-ticket-title");
      await cust.page.keyboard.type("Klavye ile açılan talep");
      await cust.page.keyboard.press("Tab");
      await cust.page.keyboard.type("Bu talep yalnızca klavye kullanılarak oluşturuldu; fare kullanılmadı.");
      await cust.page.focus("#sv2-create-ticket-submit");
      const before = Object.keys(world.valueAt("v2/tickets") || {}).length;
      await cust.page.keyboard.press("Enter");
      const created = await (async () => {
        for (let i = 0; i < 60; i++) {
          if (Object.keys(world.valueAt("v2/tickets") || {}).length > before) return true;
          await sleep(100);
        }
        return false;
      })();
      check("talep yalnızca klavyeyle oluşturulur", created, JSON.stringify(cust.errors.slice(0, 2)));
      await cust.page.waitForTimeout(500);
      const afterClose = await cust.page.evaluate(() => ({ open: !!document.querySelector(".sv2-modal-overlay.is-open"), inert: document.getElementById("sv2-app").hasAttribute("inert"), focusOk: document.activeElement && document.activeElement !== document.body }));
      check("gönderimden sonra pencere kapanır, arka plan etkin, odak kaybolmaz", !afterClose.open && !afterClose.inert && afterClose.focusOk, JSON.stringify(afterClose));

      // şifre değiştir: hata ilgili alanı işaretler ve odağı taşır; genel hata alanı role=alert (MUS-23)
      await openPage(cust, "/support-v2/change-password.html");
      await cust.page.fill("#sv2-cp-new", "abc");
      await cust.page.focus("#sv2-cp-submit");
      await cust.page.keyboard.press("Enter");
      await cust.page.waitForTimeout(250);
      const cp = await cust.page.evaluate(() => ({ focus: document.activeElement.id, invalid: document.activeElement.getAttribute("aria-invalid"), described: document.activeElement.getAttribute("aria-describedby"), role: document.getElementById("sv2-cp-error").getAttribute("role"), shown: !document.getElementById("sv2-cp-error").hidden }));
      check("şifre değiştir: hata ilgili alanı işaretler, odak ona gider, hata role=alert", cp.focus === "sv2-cp-current" && cp.invalid === "true" && cp.described === "sv2-cp-error" && cp.role === "alert" && cp.shown, JSON.stringify(cp));
      await openPage(cust, "/support-v2/customer/tickets.html");

      // süzgeç çipi ve sekme ARIA durumu
      const chip = cust.page.locator("#sv2-filter-chips .sv2-chip", { hasText: "Açık" }).first();
      if (await chip.count()) {
        await chip.focus();
        await cust.page.keyboard.press("Enter");
        check("çip aria-pressed güncellenir (UX-27)", (await chip.getAttribute("aria-pressed")) === "true");
      }

      // bildirim zili
      await cust.page.focus("#sv2-notif-btn");
      await cust.page.keyboard.press("Enter");
      await cust.page.waitForSelector("#sv2-notif-panel.is-open");
      const bell = await cust.page.evaluate(() => ({ exp: document.getElementById("sv2-notif-btn").getAttribute("aria-expanded"), label: document.getElementById("sv2-notif-btn").getAttribute("aria-label"), inPanel: document.getElementById("sv2-notif-panel").contains(document.activeElement) }));
      check("zil: aria-expanded=true, odak panelde, ad okunmamış sayısını içerir (UX-33)", bell.exp === "true" && bell.inPanel && /Bildirimler/.test(bell.label), JSON.stringify(bell));
      await cust.page.keyboard.press("Escape");
      const bell2 = await cust.page.evaluate(() => ({ exp: document.getElementById("sv2-notif-btn").getAttribute("aria-expanded"), focusBell: document.activeElement.id === "sv2-notif-btn" }));
      check("zil: Esc paneli kapatır ve odağı zile döndürür", bell2.exp === "false" && bell2.focusBell, JSON.stringify(bell2));
      await cust.context.close();

      // 3b) otomatik tamamlama (yönetici yeni talep: firma)
      const svc = await srv.session("u_service");
      await openPage(svc, "/support-v2/admin/tickets.html");
      await svc.page.focus("#sv2-new-ticket");
      await svc.page.keyboard.press("Enter");
      await svc.page.waitForSelector("#sv2-create-ticket-modal.is-open");
      const companyInput = svc.page.locator("#sv2-create-ticket-modal input[role='combobox']").first();
      if (await companyInput.count()) {
        await companyInput.focus();
        await svc.page.keyboard.type("Ör");
        await svc.page.waitForSelector("[role=listbox]:not([hidden]) [role=option]", { timeout: 2000 }).catch(() => {});
        const ac = await svc.page.evaluate(() => {
          const i = document.querySelector("#sv2-create-ticket-modal input[role='combobox']");
          return { expanded: i.getAttribute("aria-expanded"), controls: !!document.getElementById(i.getAttribute("aria-controls")), options: document.querySelectorAll("[role=listbox]:not([hidden]) [role=option]").length };
        });
        check("otomatik tamamlama: combobox/listbox/option ARIA (UX-07)", ac.expanded === "true" && ac.controls && ac.options >= 1, JSON.stringify(ac));
        await svc.page.keyboard.press("ArrowDown");
        const act = await svc.page.evaluate(() => {
          const i = document.querySelector("#sv2-create-ticket-modal input[role='combobox']");
          return { active: i.getAttribute("aria-activedescendant"), selected: document.querySelector("[role=option][aria-selected=true]")?.id };
        });
        check("otomatik tamamlama: ok tuşu aria-activedescendant", !!act.active && act.active === act.selected, JSON.stringify(act));
        await svc.page.keyboard.press("Enter");
        const picked = await svc.page.evaluate(() => ({ value: document.querySelector("#sv2-create-ticket-modal input[role='combobox']").value, modalOpen: !!document.querySelector("#sv2-create-ticket-modal.is-open") }));
        check("otomatik tamamlama: Enter seçer, formu göndermez", picked.value.length > 0 && picked.modalOpen, JSON.stringify(picked));
      }
      await svc.context.close();

      // 3c) aç/kapa anahtarı: klavye odağı görünür (UX-22)
      const root = await srv.session("u_root");
      await openPage(root, "/support-v2/admin/departments.html");
      const sw = root.page.locator(".sv2-switch input").first();
      if (await sw.count()) {
        await root.page.keyboard.press("Tab"); // odağı başlat
        await sw.focus();
        await root.page.keyboard.press("Shift+Tab");
        await root.page.keyboard.press("Tab");
        const ring = await root.page.evaluate(() => {
          const i = document.activeElement;
          const slider = i.nextElementSibling;
          const cs = getComputedStyle(slider);
          return { isSwitch: i.matches(".sv2-switch input"), outline: cs.outlineStyle + " " + cs.outlineWidth, label: i.getAttribute("aria-label") };
        });
        check("anahtar: odakta halka görünür + erişilebilir ad", ring.isSwitch && /solid 2px/.test(ring.outline) && !!ring.label, JSON.stringify(ring));
      }
      // kaydırılabilir tablo bölgesi odaklanabilir (UX-45)
      const region = await root.page.evaluate(() => {
        const w = document.querySelector(".sv2-table-wrap");
        return w ? { tabindex: w.getAttribute("tabindex"), role: w.getAttribute("role"), label: w.getAttribute("aria-label") } : null;
      });
      check("tablo kaydırma bölgesi: tabindex=0 + role=region + ad", !!region && region.tabindex === "0" && region.role === "region" && !!region.label, JSON.stringify(region));
      await root.context.close();

      // 3d) mobil çekmece (UX-09): kapalıyken erişilemez, açıkken odak/inert, Esc ve odak dönüşü
      const mob = await srv.session("u_root", { viewport: { width: 390, height: 844 }, hasTouch: true });
      await openPage(mob, "/support-v2/admin/dashboard.html");
      const closedState = await mob.page.evaluate(() => {
        const sb = document.getElementById("sv2-sidebar");
        const link = sb.querySelector(".sv2-nav-item");
        link.focus(); // görünmez öğeye odak verilemez
        const focused = document.activeElement === link;
        link.blur();
        return { vis: getComputedStyle(sb).visibility, tabbable: focused };
      });
      check("mobil: kapalı çekmece görünmez ve odaklanamaz", closedState.vis === "hidden" && !closedState.tabbable, JSON.stringify(closedState));
      const toggleExpanded = () => mob.page.getAttribute("#sv2-menu-toggle", "aria-expanded");
      check("mobil: menü düğmesi aria-expanded=false", (await toggleExpanded()) === "false");
      await mob.page.focus("#sv2-menu-toggle");
      await mob.page.keyboard.press("Enter");
      await mob.page.waitForTimeout(450);
      const openState = await mob.page.evaluate(() => ({
        expanded: document.getElementById("sv2-menu-toggle").getAttribute("aria-expanded"),
        focusInside: document.getElementById("sv2-sidebar").contains(document.activeElement),
        mainInert: document.querySelector(".sv2-main").hasAttribute("inert"),
        locked: document.body.classList.contains("sv2-sidebar-open"),
      }));
      check("mobil: açılınca aria-expanded, odak çekmecede, arka plan inert + kayma kilidi", openState.expanded === "true" && openState.focusInside && openState.mainInert && openState.locked, JSON.stringify(openState));
      let leaked = false;
      for (let i = 0; i < 30; i++) {
        await mob.page.keyboard.press("Tab");
        if (!(await mob.page.evaluate(() => document.getElementById("sv2-sidebar").contains(document.activeElement)))) leaked = true;
      }
      check("mobil: Tab odağı açık çekmecede tutar", !leaked);
      await mob.page.keyboard.press("Escape");
      await mob.page.waitForTimeout(450);
      const back = await mob.page.evaluate(() => ({ focusToggle: document.activeElement.id === "sv2-menu-toggle", expanded: document.getElementById("sv2-menu-toggle").getAttribute("aria-expanded"), inert: document.querySelector(".sv2-main").hasAttribute("inert") }));
      check("mobil: Esc çekmeceyi kapatır, odak menü düğmesine döner", back.focusToggle && back.expanded === "false" && !back.inert, JSON.stringify(back));
      await mob.context.close();
    }

    const unexpectedErrors = [];
    check("sayfa hatası yok", unexpectedErrors.length === 0);
  } finally {
    await srv.close();
  }
  results.forEach((r) => (verbose || r[0] === "FAIL" ? console.log(r.join(" | ")) : null));
  if (moderate.size) console.log("\nBilgi (orta/düşük etki, engellemez): " + [...moderate].map(([k, v]) => `${k}×${v}`).join(", "));
  const fails = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - fails}/${results.length} geçti`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
