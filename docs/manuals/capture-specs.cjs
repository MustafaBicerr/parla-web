/**
 * Ekran görüntüsü tanımları. Her tanım capture-screens.cjs'deki shot()/emailShot() yardımcılarını kullanır.
 */
const zlib = require("node:zlib");
/** Gerçekçi boyutta (≈100-200 KB) örnek PNG üretir. */
function samplePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let seed = 11;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed >> 16) % 24;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const band = (Math.floor(y / 40) % 2) * 18;
      raw[o] = (230 + n / 3 - band) & 255; raw[o + 1] = (232 + n / 3 - band) & 255; raw[o + 2] = (240 + n / 4) & 255;
    }
  }
  const tbl = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = tbl[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 3 })), chunk("IEND", Buffer.alloc(0))]);
}
const PNG_1X1 = samplePng(1000, 560);
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n"), Buffer.alloc(183 * 1024, 32), Buffer.from("\ntrailer<</Root 1 0 R>>\n%%EOF\n")]);

const MODAL = "#sv2-create-ticket-modal .sv2-modal";

exports.user = async ({ shot, emailShot, world, sleep }) => {
  // ---------- 1. Başlangıç
  await shot({ guide: "user", name: "01-giris", as: null, url: "/support-v2/login.html", wait: "#sv2-login-form", vp: [1100, 640], scale: 2.4, target: ".sv2-auth-panel .sv2-card", pad: 14,
    pins: { 1: ["#sv2-email", "l"], 2: ["#sv2-password", "l"], 3: ["#sv2-login-submit", "l"], 4: ["#sv2-forgot-password", "r"], 5: ["#sv2-guide-user-dl", "l"] } });

  await shot({ guide: "user", name: "01-sifre-degistir", as: "u_new", url: "/support-v2/change-password.html", wait: "#sv2-change-password-form", vp: [1100, 760], scale: 2.2, target: ".sv2-content .sv2-section", pad: 8,
    pins: { 1: ["#sv2-cp-current", "tl"], 2: ["#sv2-cp-new", "tl"], 3: ["#sv2-cp-new2", "tl"], 4: ["#sv2-cp-submit", "r"] } });

  await shot({ guide: "user", name: "01-sifre-sifirla", as: null, url: "/support-v2/auth-action.html?mode=resetPassword&oobCode=demo", wait: "#sv2-reset-form", vp: [1100, 700], scale: 2.4, target: ".sv2-auth-panel .sv2-card", pad: 14,
    pins: { 1: ["#sv2-new-password", "tl"], 2: ["#sv2-new-password2", "tl"], 3: ["#sv2-reset-submit", "r"] } });

  await shot({ guide: "user", name: "01-genel-bakis", as: "u_cust", url: "/support-v2/customer/dashboard.html", wait: ".sv2-stats-grid", vp: [1366, 800],
    pins: { 1: ["#sv2-sidebar .sv2-nav", "r"], 2: ["#sv2-notif-btn", "b"], 3: [".sv2-stats-grid", "tl"], 4: ["#sv2-new-ticket-btn", "l"], 5: ["#sv2-recent-tickets tbody tr .sv2-badge", "r"], 6: [".sv2-topbar-user", "b"], 7: ["#sv2-change-password-link", "r"], 8: ["#sv2-topbar-guide", "b"] } });

  await shot({ guide: "user", name: "01-menu", as: "u_cust", url: "/support-v2/customer/dashboard.html", wait: ".sv2-stats-grid", vp: [1100, 760], target: "#sv2-sidebar .sv2-nav", pad: 8, scale: 2.4,
    pins: { 1: ["#sv2-sidebar .sv2-nav-item", "r", 0], 2: ["#sv2-sidebar .sv2-nav-item", "r", 1], 3: ["#sv2-sidebar .sv2-nav-item", "r", 2], 4: ["#sv2-sidebar .sv2-nav-guide-open", "r"] } });
  await shot({ guide: "user", name: "01-kullanici-kutusu", as: "u_cust", url: "/support-v2/customer/dashboard.html", wait: ".sv2-stats-grid", vp: [1100, 760], target: "#sv2-sidebar .sv2-sidebar-footer", pad: 0, scale: 2.4,
    pins: { 1: ["#sv2-sidebar .sv2-user-mini", "r"], 2: ["#sv2-change-password-link", "r"], 3: ["#sv2-logout-btn", "r"] } });

  // ---------- 2. Talep oluşturma
  const openModal = async (page) => { await page.click("#sv2-new-ticket-btn"); await page.waitForSelector("#sv2-create-ticket-form"); await sleep(250); };
  await shot({ guide: "user", name: "02-yeni-talep-bos", as: "u_cust", url: "/support-v2/customer/tickets.html", wait: "#sv2-new-ticket-btn", vp: [1100, 1180], scale: 1.6, before: openModal, target: MODAL, pad: 6,
    pins: { 1: ["#sv2-ticket-type", "tl"], 2: ["#sv2-ticket-priority", "tl"], 3: ["#sv2-ticket-module", "tl"], 4: ["#sv2-ticket-title", "tl"], 5: ["#sv2-ticket-description", "tl"], 6: ["#sv2-create-picker .sv2-file-btn", "l"], 7: ["#sv2-ticket-attachment", "tl"], 8: ["#sv2-create-ticket-submit", "tl"] } });

  await shot({ guide: "user", name: "02-yeni-talep-dolu", as: "u_cust", url: "/support-v2/customer/tickets.html", wait: "#sv2-new-ticket-btn", vp: [1100, 1180], scale: 1.6,
    before: async (page) => {
      await openModal(page);
      await page.selectOption("#sv2-ticket-type", "SUP");
      await page.selectOption("#sv2-ticket-priority", "high");
      await page.selectOption("#sv2-ticket-module", "FI");
      await page.fill("#sv2-ticket-title", "F110 ödeme programı banka dosyası üretmiyor");
      await page.fill("#sv2-ticket-description", "F110 ile ödeme önerisi oluşturuyorum, çalıştırma başarılı görünüyor ancak banka dosyası (DME) üretilmiyor.\nHata mesajı: 'Ödeme ortamı bulunamadı'.\nİşlem tarihi: bugün 10:15. Şirket kodu 1000, ödeme yöntemi T.");
      await page.setInputFiles("#sv2-create-input", [{ name: "hata-ekrani.png", mimeType: "image/png", buffer: PNG_1X1 }, { name: "islem-kaydi.pdf", mimeType: "application/pdf", buffer: PDF }]);
    }, target: MODAL, pad: 6,
    pins: { 1: ["#sv2-ticket-title", "tl"], 2: ["#sv2-ticket-description", "tl"], 3: ["#sv2-create-list", "l"], 4: ["#sv2-create-ticket-submit", "tl"] } });

  await shot({ guide: "user", name: "02-dosya-ekle", as: "u_cust", url: "/support-v2/customer/tickets.html", wait: "#sv2-new-ticket-btn", vp: [1100, 1180], scale: 2.2,
    before: async (page) => {
      await openModal(page);
      await page.setInputFiles("#sv2-create-input", [{ name: "hata-ekrani.png", mimeType: "image/png", buffer: PNG_1X1 }, { name: "islem-kaydi.pdf", mimeType: "application/pdf", buffer: PDF }]);
    }, target: "#sv2-create-picker", pad: 10,
    pins: { 1: ["#sv2-create-picker .sv2-file-btn", "tl"], 2: ["#sv2-create-list li", "tr", 0], 3: ["#sv2-create-picker .sv2-file-hint", "b"] } });

  // ---------- 3. Takip
  await shot({ guide: "user", name: "03-taleplerim", as: "u_cust", url: "/support-v2/customer/tickets.html", wait: "#sv2-tickets-table .sv2-table", vp: [1366, 820], scale: 1.5,
    pins: { 1: ["#sv2-new-ticket-btn", "l"], 2: ["#sv2-ticket-search", "tl"], 3: ["#sv2-filter-chips", "tl"], 4: ["#sv2-sort-select", "tr"], 5: ["#sv2-tickets-table tbody tr .sv2-badge", "r", 2] } });

  await shot({ guide: "user", name: "03-filtre", as: "u_cust", url: "/support-v2/customer/tickets.html", wait: "#sv2-tickets-table .sv2-table", vp: [1100, 820], scale: 2,
    before: async (page) => { await page.click('#sv2-filter-chips [data-value="pending_close"]'); }, target: ".sv2-section", pad: 4,
    pins: { 1: ["#sv2-filter-chips .is-active, #sv2-filter-chips .active", "b"], 2: ["#sv2-tickets-table tbody tr", "l"] } });

  await shot({ guide: "user", name: "03-bildirimler", as: "u_cust", url: "/support-v2/customer/dashboard.html", wait: ".sv2-stats-grid", vp: [1100, 700], scale: 2,
    before: async (page) => { await page.waitForFunction(() => !document.getElementById("sv2-notif-badge").hidden); await page.click("#sv2-notif-btn"); await page.waitForSelector("#sv2-notif-panel.is-open .sv2-notif-item"); await sleep(300); },
    target: "#sv2-notif-panel", pad: 10,
    pins: { 1: ["#sv2-notif-panel .sv2-notif-item", "tl", 0], 2: ["#sv2-notif-panel .sv2-notif-item", "tl", 2], 3: ["#sv2-notif-panel .sv2-notif-readall", "l"] } });

  // ---------- 4. Talep ayrıntısı
  await shot({ guide: "user", name: "04-talep-detay", as: "u_cust", url: "/support-v2/customer/ticket-detail.html?id=t1", wait: ".sv2-meta-grid", vp: [1100, 720], scale: 1.6,
    pins: { 1: [".sv2-breadcrumb", "l"], 2: [".sv2-meta-item .sv2-badge", "b"], 3: [".sv2-meta-grid", "tr"], 4: [".sv2-section .sv2-meta-grid + div", "l"] } });

  await shot({ guide: "user", name: "04-yazisma", as: "u_cust", url: "/support-v2/customer/ticket-detail.html?id=t1", wait: ".sv2-meta-grid", vp: [1100, 1250], scale: 1.6, target: ".sv2-content .sv2-section:nth-of-type(3)", pad: 6,
    pins: { 1: [".sv2-timeline-item", "tl", 0], 2: [".sv2-timeline-item.customer", "tl"], 3: ["#sv2-reply-message", "tl"], 4: ["#sv2-reply-picker .sv2-file-btn", "l"], 5: ["#sv2-send-reply", "tl"] } });

  await shot({ guide: "user", name: "04-gecmis", as: "u_cust", url: "/support-v2/customer/ticket-detail.html?id=t1", wait: ".sv2-meta-grid", vp: [1100, 1250], scale: 1.6, target: ".sv2-content .sv2-section:nth-of-type(2)", pad: 6,
    pins: { 1: [".sv2-timeline-item", "tl", 0], 2: [".sv2-timeline-item", "tl", 2] } });

  await emailShot("user", "04-eposta-talep-alindi", "ticket_created", { event: "ticket_created", audience: "customer", ticket_id: "t2", ticket_number: "SUP-ORN-MM-2610-0002", title: "Yeni satıcı hesabı açılamıyor (XK01)", status: "open", priority: "high", company_name: "Örnek Holding A.Ş.", user_name: "Ayşe Demir", portalUrl: "https://www.parlabilgiteknolojileri.net" });
  await emailShot("user", "04-eposta-yanit", "ticket_message", { event: "ticket_message", audience: "customer", ticket_id: "t1", ticket_number: "SUP-ORN-SD-2610-0001", title: "Fatura kesiminde muhasebe kaydı oluşmuyor", status: "in_progress", priority: "critical", company_name: "Örnek Holding A.Ş.", user_name: "Ayşe Demir", note: "Teşekkürler. VKOA hesap belirleme tablosunda dünkü transport sonrası bir kayıt silinmiş görünüyor. Düzeltmeyi hazırlıyorum.", portalUrl: "https://www.parlabilgiteknolojileri.net" });

  // ---------- 5. Çözüm, onay, yeniden açma
  await shot({ guide: "user", name: "05-banner-bekleniyor", as: "u_cust", url: "/support-v2/customer/ticket-detail.html?id=t3", wait: "#sv2-lifecycle-banner", vp: [1100, 720], scale: 2, target: "#sv2-lifecycle-banner", pad: 8 });
  await shot({ guide: "user", name: "05-banner-onay", as: "u_cust", url: "/support-v2/customer/ticket-detail.html?id=t4", wait: "#sv2-lifecycle-banner", vp: [1100, 720], scale: 2, target: "#sv2-lifecycle-banner", pad: 8,
    pins: { 1: ["#sv2-approve-close", "tl"], 2: ["#sv2-reopen-ticket", "tr"] } });
  await shot({ guide: "user", name: "05-onay-penceresi", as: "u_cust", url: "/support-v2/customer/ticket-detail.html?id=t4", wait: "#sv2-lifecycle-banner", vp: [1100, 800], scale: 2,
    before: async (page) => { await page.click("#sv2-approve-close"); await page.waitForSelector("#sv2-lifecycle-modal .sv2-modal"); await page.fill("#sv2-lifecycle-note", "Düzeltme için teşekkürler, rapor artık doğru çalışıyor."); await sleep(250); },
    target: "#sv2-lifecycle-modal .sv2-modal", pad: 6,
    pins: { 1: ["#sv2-lifecycle-note", "tl"], 2: ["#sv2-lifecycle-confirm", "tl"] } });
  await shot({ guide: "user", name: "05-yeniden-ac-penceresi", as: "u_cust", url: "/support-v2/customer/ticket-detail.html?id=t4", wait: "#sv2-lifecycle-banner", vp: [1100, 800], scale: 2,
    before: async (page) => { await page.click("#sv2-reopen-ticket"); await page.waitForSelector("#sv2-lifecycle-modal .sv2-modal"); await page.fill("#sv2-lifecycle-note", "Rapor yalnızca Eylül ayı için düzeldi; Ağustos verileri hâlâ hatalı görünüyor."); await sleep(250); },
    target: "#sv2-lifecycle-modal .sv2-modal", pad: 6,
    pins: { 1: ["#sv2-lifecycle-note", "tl"], 2: ["#sv2-lifecycle-confirm", "tl"] } });
  await shot({ guide: "user", name: "05-banner-yeniden-acildi", as: "u_cust", url: "/support-v2/customer/ticket-detail.html?id=t7", wait: "#sv2-lifecycle-banner", vp: [1100, 720], scale: 2, target: "#sv2-lifecycle-banner", pad: 8 });
  await shot({ guide: "user", name: "05-banner-cozuldu", as: "u_cust", url: "/support-v2/customer/ticket-detail.html?id=t8", wait: "#sv2-lifecycle-banner", vp: [1100, 720], scale: 2, target: "#sv2-lifecycle-banner", pad: 8 });
  await shot({ guide: "user", name: "05-banner-kapandi", as: "u_cust", url: "/support-v2/customer/ticket-detail.html?id=t5", wait: "#sv2-lifecycle-banner", vp: [1100, 720], scale: 2, target: "#sv2-lifecycle-banner", pad: 8 });
  await emailShot("user", "05-eposta-kapanis-onayi", "ticket_close_approval", { event: "ticket_close_approval", audience: "customer", ticket_id: "t4", ticket_number: "SUP-ORN-MM-2610-0004", title: "Stok devir hızı raporunda hatalı değerler", status: "pending_close", priority: "medium", company_name: "Örnek Holding A.Ş.", user_name: "Ayşe Demir", note: "Rapordaki hesaplama düzeltmesi üretime alındı. Lütfen raporu kontrol edip kapanışı onaylayın.", portalUrl: "https://www.parlabilgiteknolojileri.net" });

  // ---------- 6. Firma yöneticisi
  await shot({ guide: "user", name: "06-firma-talepleri", as: "u_cadmin", url: "/support-v2/customer/tickets.html", wait: "#sv2-tickets-table .sv2-table", vp: [1366, 800], scale: 1.5,
    pins: { 1: [".sv2-section-header h3", "l"], 2: ["#sv2-tickets-table thead th:nth-child(3)", "b"], 3: ["#sv2-ticket-search", "tl"] } });

  // ---------- 7. Hesap
  await shot({ guide: "user", name: "07-profil", as: "u_cust", url: "/support-v2/customer/profile.html", wait: ".sv2-meta-grid", vp: [1100, 700], scale: 1.6,
    pins: { 1: [".sv2-meta-grid", "tl"], 2: [".sv2-stats-grid", "tl"], 3: ["#sv2-change-password-link", "r"] } });
};


/* ====================================================================================================
 * SİSTEM ADMİNLERİ KILAVUZU — ekran görüntüleri
 * Roller: u_root (Süper Admin), u_service (Destek Atayıcı), u_pm (Proje Yöneticisi), u_cons1/u_cons2 (Danışman).
 * Örnek verinin bir kısmı (etkinlik günlüğü, ek dosya, ek efor/sözleşme/proje kayıtları) burada world.seed ile
 * eklenir (kurallar atlanır; yalnızca bu kılavuzun çekimleri içindir, e2e tohum verisi değişmez).
 * Çalıştırma: node docs/manuals/capture-screens.cjs admin
 * ================================================================================================== */
const sec = (t) => `.sv2-section:has(.sv2-section-header h3:text-is("${t}"))`;
const statCard = (label) => `.sv2-stat-card:has(.sv2-stat-label:text-is("${label}"))`;
const metaItem = (label) => `.sv2-meta-item:has(label:text-is("${label}"))`;
const nav = (id) => `#sv2-sidebar .sv2-nav-item[data-page="${id}"]`;
const modal = (id) => `#${id} .sv2-modal`;
const tab = (id) => `.sv2-tab[data-tab="${id}"]`;
/** Kenar menüyü gizleyip içeriği tam genişliğe yayar (geniş tablolar için). */
const noSidebar = async (page) => { await page.addStyleTag({ content: ".sv2-sidebar{display:none !important}.sv2-main{margin-left:0 !important}" }); };
/** Pin yardımcıları: F = form alanı (sağ-üst iç köşe), B = düğme (sol-üst köşe). */
const F = (sel, idx) => [sel, "tr", idx, -26, 16];
const B = (sel, idx) => [sel, "tl", idx, 4, 4];
/** Tablonun ilk n satırı dışındakileri gizler (sayfa uzunluğunu kısaltmak için). */
const firstRows = async (page, n) => { await page.addStyleTag({ content: `.sv2-table tbody tr:nth-child(n+${n + 1}){display:none !important}` }); };

exports.admin = async ({ shot, emailShot, world, sleep }) => {
  const now = Date.now();
  const H = 3600 * 1000;
  const D = 24 * H;
  const iso = (ms) => new Date(now - ms).toISOString();
  const day = (offsetDays) => new Date(now + offsetDays * D).toISOString().slice(0, 10);
  const today = day(0);

  // ---------- Ek örnek veri
  const act = (id, o) => world.seed(`v2/activities/${id}`, { activity_id: id, user_uid: o.uid, user_name: o.name, action: o.action, entity_type: o.type, entity_id: o.eid || "", entity_label: o.label || "", details: o.details || "", created_at: iso(o.age) });
  act("a4", { uid: "u_service", name: "Mehmet Kaya", action: "ticket_updated", type: "ticket", eid: "t1", label: "SUP-ORN-SD-2610-0001", details: "Ticket güncellendi", age: 50 * 60000 });
  act("a5", { uid: "u_cons1", name: "Zeynep Arslan", action: "email_failed", type: "ticket", eid: "t6", label: "SUP-ORN-FI-2610-0006", details: "ticket_message — [rate_limited] E-posta servisi yoğun, lütfen tekrar deneyin.", age: 70 * 60000 });
  act("a6", { uid: "u_root", name: "Murat Aydın", action: "user_created", type: "user", eid: "u_new", label: "Ahmet Güler", details: "ahmet.guler@ornekholding.com — Müşteri Kullanıcısı", age: 20 * H });
  act("a7", { uid: "u_root", name: "Murat Aydın", action: "company_created", type: "company", eid: "cB", label: "Demir Çelik San. A.Ş.", details: "DMR0001", age: 26 * H });
  act("a8", { uid: "u_service", name: "Mehmet Kaya", action: "created", type: "contract", eid: "k2", label: "SZL-2026-007", details: "Yeni sözleşme: SZL-2026-007", age: 30 * H });
  act("a9", { uid: "u_service", name: "Mehmet Kaya", action: "email_failed", type: "ticket", eid: "t3", label: "SUP-ORN-FI-2610-0003", details: "send_to_customer — [domain_not_verified] Gönderen alan adı Resend'de doğrulanmamış (DNS kayıtlarını kontrol edin).", age: 5 * H });
  act("a10", { uid: "u_pm", name: "Burak Şahin", action: "updated", type: "project", eid: "pr1", label: "PRJ-ORN-01", details: "Proje güncellendi: S/4HANA Geçiş Projesi", age: 3 * D });
  act("a11", { uid: "u_cons2", name: "Can Öztürk", action: "ticket_updated", type: "ticket", eid: "t4", label: "SUP-ORN-MM-2610-0004", details: "Kapanış Onayı Bekliyor", age: 5 * H });
  act("a12", { uid: "u_root", name: "Murat Aydın", action: "updated", type: "department", eid: "d2", label: "SAP Geliştirme", details: "Departman güncellendi: SAP Geliştirme", age: 4 * D });
  // t1: iki ek dosya (veri ayrı düğümde, mesajda yalnızca başvuru)
  const attData = Buffer.from("demo").toString("base64");
  world.seed("v2/ticket_attachments/t1/att1", { att_id: "att1", name: "vf01-hata-ekrani.png", type: "image/png", size: 184320, data: attData, uploader_uid: "u_cust", uploader_name: "Ayşe Demir", created_at: iso(6 * H) });
  world.seed("v2/ticket_attachments/t1/att2", { att_id: "att2", name: "islem-kaydi.pdf", type: "application/pdf", size: 96256, data: attData, uploader_uid: "u_cust", uploader_name: "Ayşe Demir", created_at: iso(6 * H) });
  world.seed("v2/ticket_messages/t1/m2/attachments", [{ id: "att1", name: "vf01-hata-ekrani.png", type: "image/png", size: 184320 }, { id: "att2", name: "islem-kaydi.pdf", type: "application/pdf", size: 96256 }]);
  // Diğer taleplere efor kayıtları (rapor ve firma eforu sekmeleri dolu görünsün)
  const eff = (tid, id, p, name, hours, note) => world.seed(`v2/ticket_efforts/${tid}/${id}`, { effort_id: id, personnel_id: p, personnel_name: name, hours, work_date: today, note, created_at: iso(2 * H), created_by_uid: "u_cons1", created_by_name: name });
  eff("t3", "e3", "p1", "Zeynep Arslan", 2, "Dönem kontrolü ve test");
  eff("t4", "e4", "p2", "Can Öztürk", 3, "Hata analizi");
  eff("t4", "e5", "p2", "Can Öztürk", 2, "Düzeltme ve transport");
  eff("t9", "e6", "p2", "Can Öztürk", 1, "KSB1 inceleme");
  eff("t8", "e7", "p1", "Zeynep Arslan", 4.5, "Onay akışı kurgusu");
  // Sözleşme ve proje örnekleri (yenileme, sona ermiş, beklemede)
  const ctr = (id, o) => world.seed(`v2/contracts/${id}`, { contract_id: id, contract_number: o.no, company_id: o.cid, company_name: o.cname, type: o.type, start_date: o.start, end_date: o.end, status: o.status, value: o.value || null, notes: o.notes || "", created_at: iso(o.age || 40 * D) });
  ctr("k3", { no: "SZL-2025-014", cid: "cA", cname: "Örnek Holding A.Ş.", type: "bakim", start: day(-345), end: day(21), status: "active", value: 180000, age: 345 * D });
  ctr("k4", { no: "SZL-2024-009", cid: "cB", cname: "Demir Çelik San. A.Ş.", type: "lisans", start: day(-700), end: day(-35), status: "active", value: 96000, age: 700 * D });
  ctr("k5", { no: "SZL-2026-011", cid: "cB", cname: "Demir Çelik San. A.Ş.", type: "proje", start: day(30), end: day(395), status: "pending", value: 240000, age: 3 * D });
  const prj = (id, o) => world.seed(`v2/projects/${id}`, { project_id: id, project_code: o.code, name: o.name, company_id: o.cid, company_name: o.cname, customer_code: o.cc, status: o.status, start_date: o.start, end_date: o.end, description: o.desc || "", manager_uid: "u_pm", manager_name: "Burak Şahin", assigned_personnel: o.team || {}, created_at: iso(o.age) });
  world.seed("v2/projects/pr1/company_name", "Örnek Holding A.Ş.");
  world.seed("v2/projects/pr1/assigned_personnel", { p1: { id: "p1", name: "Zeynep Arslan" }, p2: { id: "p2", name: "Can Öztürk" } });
  prj("pr2", { code: "PRJ-DMR-02", name: "Fiori Launchpad Yenileme", cid: "cB", cname: "Demir Çelik San. A.Ş.", cc: "DMR", status: "planning", start: day(20), end: day(150), team: { p2: { id: "p2", name: "Can Öztürk" } }, age: 5 * D });
  prj("pr3", { code: "PRJ-ORN-03", name: "Bütçe Raporlama Revizyonu", cid: "cA", cname: "Örnek Holding A.Ş.", cc: "ORN", status: "completed", start: day(-200), end: day(-30), team: { p1: { id: "p1", name: "Zeynep Arslan" } }, age: 200 * D });

  // ================================================================ 1. Başlangıç
  await shot({ guide: "admin", name: "a01-giris", as: null, url: "/support-v2/login.html", wait: "#sv2-login-form", vp: [1100, 700], scale: 2.4, target: ".sv2-auth-panel .sv2-card", pad: 14,
    before: async (page) => { await page.fill("#sv2-email", "mehmet.kaya@parla-demo.com"); await page.fill("#sv2-password", "Gecici-Sifre1"); },
    pins: { 1: ["#sv2-email", "l"], 2: ["#sv2-password", "l"], 3: ["#sv2-login-submit", "l"], 4: ["#sv2-forgot-password", "r"], 5: ["#sv2-guide-admin-open", "l"] } });

  await shot({ guide: "admin", name: "a01-genel-bakis", as: "u_root", url: "/support-v2/admin/dashboard.html", wait: ".sv2-stats-grid", vp: [1366, 1800], scale: 1.5, settle: 900,
    clip: { x: 0, y: 0, width: 1366, height: 700 },
    pins: { 1: [nav("dashboard"), "r"], 2: ["#sv2-topbar-guide", "l"], 3: ["#sv2-notif-btn", "l"], 4: [".sv2-stats-grid", "tl", 0, 6, 6], 5: [statCard("SLA Aşımı"), "tr", 0, -14, 14], 6: [sec("Ticket Tipi Dağılımı"), "tl", 0, 14, 14], 7: [sec("Son Aktiviteler"), "tl", 0, 14, 14], 8: [".sv2-topbar-user", "l"] } });

  await shot({ guide: "admin", name: "a01-is-yuku", as: "u_root", url: "/support-v2/admin/dashboard.html", wait: ".sv2-stats-grid", vp: [1366, 1800], scale: 1.5, settle: 900,
    before: async (page) => { await page.addStyleTag({ content: "#sv2-email-health,#sv2-maintenance{display:none !important}" }); await sleep(150); },
    targets: [sec("Danışman İş Yükü"), sec("Atanmamış Ticketlar")], pad: 8,
    pins: { 1: [sec("Danışman İş Yükü"), "tl", 0, 16, 16], 2: [".sv2-quick-assign", "tl", 0, -6, -6], 3: [sec("Atanmamış Ticketlar") + " a.sv2-btn", "tl", 0, -6, -6] } });

  // ================================================================ 2. Talep yönetimi
  await shot({ guide: "admin", name: "a02-liste", as: "u_service", url: "/support-v2/admin/tickets.html", wait: "#sv2-tickets-table .sv2-table", vp: [1500, 1300], scale: 1.4, settle: 700,
    before: async (page) => { await noSidebar(page); await firstRows(page, 5); await sleep(150); },
    targets: [".sv2-content > :first-child", ".sv2-content > .sv2-section"], pad: 0,
    pins: { 1: B("#sv2-new-ticket"), 2: B("#sv2-export-csv"), 3: ["#sv2-filter-chips .sv2-chip", "tl", 0, -10, -8], 4: ["#sv2-ticket-search", "tr", 0, -10, 8], 5: ["#sv2-sort-select", "tl", 0, 0, -4], 6: B("#sv2-advanced-toggle"), 7: ["#sv2-type-chips .sv2-chip", "tl", 0, -10, -8], 8: [".sv2-table thead th >> nth=9", "tl", 0, -14, -6], 9: [".sv2-approval-cb", "tl", 1, 8, -8], 10: [".sv2-delete-ticket", "r", 0, 12, 0] } });

  await shot({ guide: "admin", name: "a02-filtre", as: "u_service", url: "/support-v2/admin/tickets.html", wait: "#sv2-tickets-table .sv2-table", vp: [1500, 1300], scale: 1.6, settle: 600,
    before: async (page) => {
      await noSidebar(page);
      await page.click('#sv2-filter-chips [data-value="in_progress"]'); await page.click('#sv2-filter-chips [data-value="assigned"]');
      await page.click("#sv2-advanced-toggle"); await page.selectOption("#sv2-filter-priority", "high"); await page.selectOption("#sv2-filter-consultant", "p1");
      await page.click("#sv2-apply-advanced"); await sleep(250);
    },
    targets: [".sv2-content > .sv2-mb-1 >> nth=0", ".sv2-filter-bar", "#sv2-advanced-panel", ".sv2-content > .sv2-mb-1 >> nth=1"], pad: 22,
    hide: ["#sv2-new-ticket", "#sv2-export-csv", "#sv2-export-excel"],
    pins: { 1: ["#sv2-filter-chips .is-active", "tl", 0, -10, -8], 2: ["#sv2-ticket-search", "tr", 0, -10, 8], 3: F("#sv2-filter-sap"), 4: F("#sv2-filter-consultant"), 5: F("#sv2-filter-company"), 6: ["#sv2-filter-unassigned", "c", 0, -22, 0], 7: B("#sv2-apply-advanced"), 8: ["#sv2-type-chips .sv2-chip", "tl", 0, -10, -8] } });

  const openNew = async (page) => { await page.click("#sv2-new-ticket"); await page.waitForSelector("#sv2-create-ticket-modal.is-open .sv2-modal"); await sleep(250); };
  await shot({ guide: "admin", name: "a02-yeni-ticket", as: "u_service", url: "/support-v2/admin/tickets.html", wait: "#sv2-tickets-table .sv2-table", vp: [1100, 1250], scale: 1.6,
    before: async (page) => {
      await openNew(page);
      await page.fill("#sv2-create-company", "Örnek"); await page.waitForSelector(".sv2-ac-item"); await page.click(".sv2-ac-item >> nth=0");
      await page.selectOption("#sv2-create-user", "u_cust"); await page.selectOption("#sv2-create-type", "SUP"); await page.selectOption("#sv2-create-priority", "high"); await page.selectOption("#sv2-create-sap", "MM");
      await page.fill("#sv2-create-title", "Müşteri toplantısında bildirilen stok farkı");
      await page.fill("#sv2-create-desc", "Muhasebe ekibi ile yapılan toplantıda MB52 raporu ile fiziksel sayım arasında fark olduğu bildirildi. Hesap bakiyeleri kontrol edilecek.");
    },
    target: modal("sv2-create-ticket-modal"), pad: 6,
    pins: { 1: F("#sv2-create-type"), 2: F("#sv2-create-priority"), 3: F("#sv2-create-company"), 4: F("#sv2-create-user"), 5: F("#sv2-create-sap"), 6: F("#sv2-create-title"), 7: F("#sv2-create-desc"), 8: B("#sv2-create-save") } });

  // --- Talep ayrıntısı (u_service, t1 = işlemde, iki danışman atanmış, efor ve iç not var)
  const T1 = "/support-v2/admin/ticket-detail.html?id=t1";
  await shot({ guide: "admin", name: "a02-detay-ust", as: "u_service", url: T1, wait: ".sv2-meta-grid", vp: [1366, 3300], scale: 1.6,
    target: ".sv2-content > .sv2-section", pad: 6,
    pins: { 1: [".sv2-content > .sv2-section .sv2-type-badge", "b", 0, 0, 12], 2: [".sv2-content > .sv2-section .sv2-badge", "b", 0, 0, 12], 3: [".sv2-content > .sv2-section .sv2-priority", "b", 0, 0, 12], 4: [metaItem("SLA") + " .sv2-sla", "r", 0, -18, 0], 5: [metaItem("İlk Yanıt") + " span", "r", 0, 14, 0], 6: [metaItem("Toplam Efor") + " span", "r", 0, 14, 0] } });

  await shot({ guide: "admin", name: "a02-admin-paneli", as: "u_service", url: T1, wait: ".sv2-meta-grid", vp: [1366, 3300], scale: 1.6,
    target: ".sv2-content > .sv2-form-row > .sv2-section", pad: 4,
    pins: { 1: ["#sv2-quick-actions .sv2-btn", "tl", 0, 2, -2], 2: F("#sv2-admin-status"), 3: F("#sv2-admin-priority"), 4: [".sv2-assign-check", "tl", 0, -8, -4], 5: [".sv2-assign-primary:checked", "tl", 0, -20, -8], 6: F("#sv2-admin-status-note"), 7: B("#sv2-admin-update") } });

  const quick = async (name, as, tid) => shot({ guide: "admin", name, as, url: `/support-v2/admin/ticket-detail.html?id=${tid}`, wait: "#sv2-quick-actions", vp: [1366, 3300], scale: 2, target: "#sv2-quick-actions", pad: 10 });
  await quick("a02-hizli-acik", "u_service", "t2");
  await quick("a02-hizli-islemde", "u_service", "t1");
  await quick("a02-hizli-musteri", "u_service", "t3");
  await quick("a02-hizli-onay", "u_service", "t4");
  await quick("a02-hizli-cozuldu", "u_service", "t8");
  await quick("a02-hizli-kapandi", "u_service", "t5");

  await shot({ guide: "admin", name: "a02-durum-penceresi", as: "u_service", url: T1, wait: "#sv2-quick-actions", vp: [1100, 1000], scale: 2,
    before: async (page) => { await page.click('.sv2-quick-status[data-status="waiting_customer"]'); await page.waitForSelector("#sv2-quick-status-modal.is-open .sv2-modal"); await page.fill("#sv2-quick-note", "Düzeltmeyi test ortamına aldım. VF01 ile yeni bir fatura kesip muhasebe belgesinin oluştuğunu kontrol eder misiniz?"); await sleep(250); },
    target: modal("sv2-quick-status-modal"), pad: 8,
    pins: { 1: ["#sv2-quick-note", "tl"], 2: ["#sv2-quick-confirm", "tl"] } });

  await shot({ guide: "admin", name: "a02-efor", as: "u_service", url: T1, wait: ".sv2-meta-grid", vp: [1366, 3300], scale: 1.5,
    target: sec("Efor Kayıtları"), pad: 6,
    pins: { 1: [".sv2-effort-del", "tl", 0, -6, -4], 2: F("#sv2-effort-hours"), 3: F("#sv2-effort-date"), 4: F("#sv2-effort-note"), 5: ["#sv2-effort-add", "tl", 0, 10, 4] } });

  await shot({ guide: "admin", name: "a02-ic-not", as: "u_service", url: T1, wait: ".sv2-meta-grid", vp: [1366, 3300], scale: 1.8,
    target: sec("İç Notlar"), pad: 16,
    pins: { 1: ["#sv2-internal-notes > .sv2-section", "tl", 0, 0, 36] } });

  await shot({ guide: "admin", name: "a02-yanit", as: "u_service", url: T1, wait: ".sv2-meta-grid", vp: [1366, 3300], scale: 1.5,
    before: async (page) => { await page.addStyleTag({ content: ".sv2-timeline > li:nth-child(1){display:none !important}" }); await sleep(150); },
    target: sec("Mesajlar & Geçmiş"), pad: 6,
    pins: { 1: [tab("messages"), "tr", 0, 8, -2], 2: [tab("history"), "tr", 0, 8, -2], 3: [".sv2-timeline-item.customer .sv2-timeline-author", "tl", 0, -4, -4], 4: [".sv2-attachment", "tl", 0, -6, -6], 5: F("#sv2-reply-message"), 6: B("#sv2-reply-picker .sv2-file-btn"), 7: ["#sv2-reply-internal", "tl", 0, -8, -6], 8: ["#sv2-reply-hours", "tr", 0, 10, -10], 9: B("#sv2-reply-send") } });

  await shot({ guide: "admin", name: "a02-gecmis", as: "u_service", url: T1, wait: ".sv2-meta-grid", vp: [1366, 3300], scale: 1.8,
    before: async (page) => { await page.click(tab("history")); await sleep(250); },
    targets: ["#sv2-detail-tabs", "#sv2-tab-content"], pad: 24,
    pins: { 1: [tab("history"), "t", 0, 0, -6], 2: ["#sv2-tab-content table thead th >> nth=4", "tl", 0, 14, -8], 3: ["#sv2-tab-content table thead th >> nth=5", "tl", 0, 12, -8] } });

  await shot({ guide: "admin", name: "a02-danisman-kisitli", as: "u_cons1", url: "/support-v2/admin/ticket-detail.html?id=t2", wait: ".sv2-meta-grid", vp: [1366, 3300], scale: 1.8,
    target: ".sv2-content > .sv2-form-row", pad: 16,
    pins: { 1: [".sv2-warning-card", "tl", 0, 0, 0] } });
  await shot({ guide: "admin", name: "a02-danisman-paneli", as: "u_cons1", url: T1, wait: ".sv2-meta-grid", vp: [1366, 3300], scale: 1.8,
    target: ".sv2-content > .sv2-form-row", pad: 16,
    pins: { 1: ["#sv2-quick-actions .sv2-btn", "tr", 1, 2, 2] } });

  // ---- Bildirim zili (personel)
  await shot({ guide: "admin", name: "a05-bildirim-danisman", as: "u_cons1", url: "/support-v2/admin/dashboard.html", wait: ".sv2-stats-grid", vp: [1100, 800], scale: 2,
    before: async (page) => { await page.waitForFunction(() => !document.getElementById("sv2-notif-badge").hidden); await page.click("#sv2-notif-btn"); await page.waitForSelector("#sv2-notif-panel.is-open .sv2-notif-item"); await sleep(300); },
    target: "#sv2-notif-panel", pad: 10,
    pins: { 1: ["#sv2-notif-panel .sv2-notif-item", "tl", 0, 10, 10], 2: ["#sv2-notif-panel .sv2-notif-item", "tl", 1, 10, 10], 3: ["#sv2-notif-panel .sv2-notif-readall", "l", 0, -14, 0] } });

  // ---- E-posta örnekleri (personel/müşteri görünümü)
  const base = { portalUrl: "https://www.parlabilgiteknolojileri.net", company_name: "Örnek Holding A.Ş.", user_name: "Ayşe Demir" };
  await emailShot("admin", "a02-eposta-atama", "ticket_assigned", { ...base, event: "ticket_assigned", audience: "staff", ticket_id: "t6", ticket_number: "SUP-ORN-FI-2610-0006", title: "Ödeme programı (F110) bankaya dosya üretmiyor", status: "assigned", priority: "high", note: "SUP-ORN-FI-2610-0006 numaralı ticket size atandı." }, 700);
  await emailShot("admin", "a02-eposta-durum", "ticket_status_changed", { ...base, event: "ticket_status_changed", audience: "customer", ticket_id: "t1", ticket_number: "SUP-ORN-SD-2610-0001", title: "Fatura kesiminde muhasebe kaydı oluşmuyor", status: "in_progress", priority: "critical", note: "Talebiniz danışmanımız tarafından işleme alındı." }, 700);
  await emailShot("admin", "a02-eposta-cozuldu", "ticket_resolved", { ...base, event: "ticket_resolved", audience: "customer", ticket_id: "t8", ticket_number: "SUP-ORN-SD-2610-0008", title: "Satış siparişi onay akışı kurgusu", status: "resolved", priority: "medium", note: "Onay akışı kurgulandı ve test edildi." }, 700);
  await emailShot("admin", "a02-eposta-musteri-testi", "send_to_customer", { ...base, event: "send_to_customer", audience: "customer", ticket_id: "t3", ticket_number: "SUP-ORN-FI-2610-0003", title: "Aylık amortisman çalıştırması hata veriyor", status: "waiting_customer", priority: "high", note: "Dönem kontrol değişkenini düzelttim. Lütfen AFAB'ı kendi ortamınızda yeniden deneyip sonucu paylaşın." }, 700);
  await emailShot("admin", "a02-eposta-kapanis-onayi", "ticket_close_approval", { ...base, event: "ticket_close_approval", audience: "customer", ticket_id: "t4", ticket_number: "SUP-ORN-MM-2610-0004", title: "Stok devir hızı raporunda hatalı değerler", status: "pending_close", priority: "medium", note: "Rapordaki hesaplama düzeltmesi üretime alındı. Lütfen raporu kontrol edip kapanışı onaylayın." }, 700);
  await emailShot("admin", "a02-eposta-yeniden-acildi", "ticket_reopened", { ...base, event: "ticket_reopened", audience: "staff", ticket_id: "t7", ticket_number: "SUP-ORN-BASIS-2610-0007", title: "Fiori uygulamasında kullanıcı menüsü görünmüyor", status: "reopened", priority: "medium", note: "Yeni eklenen iki kullanıcıda kutucuklar yine boş geliyor." }, 700);

  // ================================================================ 3. Müşteri ve kullanıcı yönetimi
  await shot({ guide: "admin", name: "a03-musteriler", as: "u_service", url: "/support-v2/admin/companies.html", wait: ".sv2-table", vp: [1500, 1200], scale: 1.4,
    before: async (page) => { await noSidebar(page); },
    targets: [".sv2-content > :first-child", ".sv2-content > .sv2-section"], pad: 8,
    pins: { 1: B("#btn-new-company"), 2: F("#companies-search"), 3: ["#sv2-filter-chips .sv2-chip", "tr", 2, 18, -10], 4: [".sv2-table thead th >> nth=4", "tl", 0, -14, -6], 5: [".sv2-table tbody .sv2-btn", "tl", 0, -4, -8] } });

  await shot({ guide: "admin", name: "a03-yeni-firma", as: "u_service", url: "/support-v2/admin/companies.html", wait: ".sv2-table", vp: [1100, 1000], scale: 1.8,
    before: async (page) => { await page.click("#btn-new-company"); await page.waitForSelector("#modal-new-company.is-open .sv2-modal"); await page.fill("#nc-name", "Yıldız Lojistik A.Ş."); await page.fill("#nc-email", "bilgi@yildizlojistik.com"); await page.fill("#nc-address", "Kocaeli"); await sleep(250); },
    target: modal("modal-new-company"), pad: 6,
    pins: { 1: F("#nc-name"), 2: F("#nc-type"), 3: F("#nc-code"), 4: F("#nc-email"), 5: B("#nc-submit") } });

  await shot({ guide: "admin", name: "a03-firma-detay", as: "u_service", url: "/support-v2/admin/company-detail.html?id=cA", wait: ".sv2-stats-grid", vp: [1366, 2000], scale: 1.5,
    targets: [".sv2-content > .sv2-section >> nth=0", ".sv2-stats-grid", "#company-tabs"], pad: 18,
    pins: { 1: ["#btn-edit-company", "tl", 0, 4, 4], 2: ["#btn-toggle-company", "tl", 0, 4, 4], 3: [".sv2-stats-grid", "tl", 0, 4, 4], 4: ["#company-tabs .sv2-tab", "tl", 0, 4, -2], 5: ["#company-tabs .sv2-tab", "tl", 3, 6, -4] } });

  await shot({ guide: "admin", name: "a03-muhataplar", as: "u_service", url: "/support-v2/admin/users.html", wait: ".sv2-table", vp: [1500, 1300], scale: 1.4,
    before: async (page) => { await noSidebar(page); await firstRows(page, 3); await sleep(150); },
    targets: [".sv2-content > :first-child", ".sv2-content > .sv2-section"], pad: 8,
    pins: { 1: B("#btn-new-user"), 2: F("#users-search"), 3: ["#sv2-filter-chips .sv2-chip", "tr", 6, 18, -10], 4: [".sv2-role-badge", "tr", 0, -4, -4], 5: [".sv2-table tbody .sv2-btn", "tl", 0, -4, -8] } });

  const openUser = async (page) => { await page.click("#btn-new-user"); await page.waitForSelector("#modal-new-user.is-open .sv2-modal"); await sleep(250); };
  await shot({ guide: "admin", name: "a03-yeni-kullanici", as: "u_service", url: "/support-v2/admin/users.html", wait: ".sv2-table", vp: [1100, 1300], scale: 1.6,
    before: async (page) => {
      await openUser(page);
      await page.fill("#nu-first-name", "Elif"); await page.fill("#nu-last-name", "Karaca"); await page.fill("#nu-email", "elif.karaca@demircelik.com"); await page.fill("#nu-phone", "+90 533 111 22 77");
      await page.fill("#nu-company", "Demir"); await page.waitForSelector(".sv2-ac-item"); await page.click(".sv2-ac-item >> nth=0");
      await sleep(250);
    },
    target: modal("modal-new-user"), pad: 6,
    pins: { 1: F("#nu-first-name"), 2: F("#nu-email"), 3: F("#nu-phone"), 4: F("#nu-company"), 5: F("#nu-role"), 6: ["#nu-temp-password", "tr", 0, -52, 16], 7: B("#nu-gen-password"), 8: B("#nu-submit") } });

  await shot({ guide: "admin", name: "a03-kullanici-detay", as: "u_service", url: "/support-v2/admin/user-detail.html?uid=u_cadmin", wait: ".sv2-stats-grid", vp: [1366, 1500], scale: 1.5,
    targets: [".sv2-content > .sv2-section >> nth=0", ".sv2-stats-grid"], pad: 18,
    pins: { 1: ["#btn-edit-user", "tl", 0, 4, 4], 2: ["#btn-reset-pwd", "tl", 0, 4, 4], 3: ["#btn-toggle-active", "tl", 0, 4, 4], 4: [metaItem("Rol") + " .sv2-role-badge", "r", 0, 14, 0], 5: [".sv2-stats-grid", "tl", 0, 4, 4] } });

  await shot({ guide: "admin", name: "a03-kullanici-duzenle", as: "u_service", url: "/support-v2/admin/user-detail.html?uid=u_cust2", wait: ".sv2-stats-grid", vp: [1100, 1300], scale: 2,
    before: async (page) => { await page.click("#btn-edit-user"); await page.waitForSelector("#modal-edit-user.is-open .sv2-modal"); await page.selectOption('#edit-user-form [name="role"]', "company_admin"); await sleep(250); },
    target: modal("modal-edit-user"), pad: 6,
    pins: { 1: F('#edit-user-form [name="first_name"]'), 2: F('#edit-user-form [name="email"]'), 3: F('#edit-user-form [name="role"]'), 4: B("#edit-user-save") } });

  await shot({ guide: "admin", name: "a03-personel", as: "u_service", url: "/support-v2/admin/personnel.html", wait: ".sv2-table", vp: [1500, 1200], scale: 1.4,
    before: async (page) => { await noSidebar(page); },
    targets: [".sv2-content > :first-child", ".sv2-content > .sv2-section"], pad: 16,
    pins: { 1: B("#btn-new-personnel"), 2: F("#personnel-search"), 3: F("#dept-filter"), 4: ["#status-chips .sv2-chip", "tl", 0, 0, -6], 5: [".sv2-table thead th >> nth=5", "tl", 0, -14, -6], 6: [".sv2-table tbody .sv2-btn", "tl", 0, -4, -8] } });

  await shot({ guide: "admin", name: "a03-yeni-personel", as: "u_service", url: "/support-v2/admin/personnel.html", wait: ".sv2-table", vp: [1100, 1000], scale: 1.8,
    before: async (page) => { await page.click("#btn-new-personnel"); await page.waitForSelector("#modal-new-personnel.is-open .sv2-modal"); await page.fill("#np-first", "Elif"); await page.fill("#np-last", "Karaca"); await page.fill("#np-email", "elif.karaca@parla-demo.com"); await page.selectOption("#np-dept", "d1"); await page.fill("#np-role", "SAP MM Danışmanı"); await sleep(250); },
    target: modal("modal-new-personnel"), pad: 6,
    pins: { 1: F("#np-email"), 2: F("#np-dept"), 3: F("#np-role"), 4: B("#np-submit") } });

  // Yeni kullanıcı oluşturma akışı (listeler çekildikten sonra veriyi değiştirir)
  await shot({ guide: "admin", name: "a03-kimlik-bilgileri", as: "u_service", url: "/support-v2/admin/users.html", wait: ".sv2-table", vp: [1100, 1300], scale: 2,
    before: async (page) => {
      await openUser(page);
      await page.fill("#nu-first-name", "Elif"); await page.fill("#nu-last-name", "Karaca"); await page.fill("#nu-email", "elif.karaca@demircelik.com"); await page.fill("#nu-phone", "+90 533 111 22 77");
      await page.fill("#nu-company", "Demir"); await page.waitForSelector(".sv2-ac-item"); await page.click(".sv2-ac-item >> nth=0");
      await page.fill("#nu-temp-password", "Kx7mPq2Wn9Ta");
      await page.click("#nu-submit"); await page.waitForSelector("#modal-user-success.is-open .sv2-modal", { timeout: 8000 }); await sleep(300);
    },
    target: modal("modal-user-success"), pad: 8,
    pins: { 1: ["#cred-email", "r", 0, 30, 0], 2: ["#cred-password", "r", 0, 30, 0], 3: B("#cred-copy"), 4: B("#cred-email-btn"), 5: B("[data-close=modal-user-success].sv2-btn-primary") } });
  await emailShot("admin", "a03-eposta-kimlik", "user_credentials", { email: "elif.karaca@demircelik.com", password: "Kx7mPq2Wn9Ta", name: "Elif Karaca", portalUrl: "https://www.parlabilgiteknolojileri.net", loginUrl: "https://www.parlabilgiteknolojileri.net/support-v2/login.html" });

  // ================================================================ 4. Tanımlar
  await shot({ guide: "admin", name: "a04-sozlesmeler", as: "u_service", url: "/support-v2/admin/contracts.html", wait: ".sv2-table", vp: [1500, 1200], scale: 1.4,
    before: async (page) => { await noSidebar(page); },
    targets: [".sv2-content > :first-child", ".sv2-content > .sv2-section"], pad: 8,
    pins: { 1: B("#btn-new-contract"), 2: F("#contract-search"), 3: ["#sv2-filter-chips .sv2-chip", "tr", 4, 18, -10], 4: [".sv2-table thead th >> nth=5", "tl", 0, -14, -6], 5: [".sv2-table thead th >> nth=6", "tl", 0, -14, -6], 6: [".btn-edit", "tl", 0, -6, -4] } });

  await shot({ guide: "admin", name: "a04-sozlesme-formu", as: "u_service", url: "/support-v2/admin/contracts.html", wait: ".sv2-table", vp: [1100, 1200], scale: 1.6,
    before: async (page) => { await page.click("#btn-new-contract"); await page.waitForSelector("#contract-modal.is-open .sv2-modal"); await page.fill("#cf-number", "SZL-2026-015"); await page.selectOption("#cf-company", { label: "Örnek Holding A.Ş." }); await page.fill("#cf-start", day(0)); await page.fill("#cf-end", day(365)); await page.fill("#cf-value", "210000"); await sleep(250); },
    target: modal("contract-modal"), pad: 6,
    pins: { 1: F("#cf-number"), 2: F("#cf-type"), 3: F("#cf-company"), 4: F("#cf-start"), 5: F("#cf-end"), 6: F("#cf-status"), 7: B("#contract-save") } });

  await shot({ guide: "admin", name: "a04-projeler", as: "u_pm", url: "/support-v2/admin/projects.html", wait: ".sv2-table", vp: [1500, 1000], scale: 1.4,
    before: async (page) => { await noSidebar(page); },
    targets: [".sv2-content > :first-child", ".sv2-content > .sv2-section"], pad: 8,
    pins: { 1: B("#btn-new-project"), 2: F("#project-search"), 3: [".sv2-table thead th >> nth=6", "tl", 0, -14, -6], 4: [".sv2-table thead th >> nth=7", "tl", 0, -14, -6], 5: [".sv2-table tbody .sv2-btn", "tl", 0, -4, -8] } });

  await shot({ guide: "admin", name: "a04-departmanlar", as: "u_root", url: "/support-v2/admin/departments.html", wait: ".sv2-table", vp: [1366, 800], scale: 1.4,
    targets: [".sv2-content > .sv2-section"], pad: 6,
    pins: { 1: B("#btn-new-dept"), 2: [".dept-toggle", "tl", 0, -6, -2], 3: [".btn-edit", "tl", 0, -6, -4], 4: [".btn-delete", "tl", 0, -6, -4] } });

  await shot({ guide: "admin", name: "a04-moduller", as: "u_root", url: "/support-v2/admin/modules.html", wait: ".sv2-table", vp: [1366, 1300], scale: 1.4,
    before: async (page) => { await firstRows(page, 4); await sleep(150); },
    targets: [".sv2-content > .sv2-section"], pad: 6,
    pins: { 1: B("#btn-new-module"), 2: [".sv2-table thead th >> nth=2", "tl", 0, -14, -6], 3: [".mod-toggle", "tl", 0, -6, -2], 4: [".btn-edit", "tl", 0, -6, -4] } });

  await shot({ guide: "admin", name: "a04-destek-turleri", as: "u_root", url: "/support-v2/admin/support-types.html", wait: ".sv2-table", vp: [1366, 1300], scale: 1.4,
    before: async (page) => { await firstRows(page, 4); await sleep(150); },
    targets: [".sv2-content > .sv2-section"], pad: 6,
    pins: { 1: B("#btn-new-type"), 2: [".sv2-color-swatch", "tl", 0, -8, -8], 3: [".type-toggle", "tl", 0, -6, -2], 4: [".btn-edit", "tl", 0, -6, -4] } });

  // ================================================================ 5. Raporlar, aktivite günlüğü
  await shot({ guide: "admin", name: "a05-raporlar", as: "u_service", url: "/support-v2/admin/reports.html", wait: ".sv2-report-card", vp: [1366, 2400], scale: 1.4, settle: 800,
    before: async (page) => { await page.selectOption("#rp-preset", "3months"); await page.click("#rp-apply"); await page.addStyleTag({ content: ".sv2-report-card[data-report='consultant-effort'] tbody tr:nth-child(n+3){display:none !important}" }); await sleep(400); },
    targets: ["#report-filters", ".sv2-report-card[data-report='modules']", ".sv2-report-card[data-report='consultant-effort']"], pad: 8,
    pins: { 1: F("#rp-preset"), 2: B("#rp-apply"), 3: [".sv2-report-card[data-report='company-effort'] .btn-csv", "tl", 0, 2, 2], 4: [".sv2-report-card[data-report='company-effort'] .btn-excel", "tl", 0, 2, 2], 5: [".sv2-report-card[data-report='modules'] .sv2-pie-chart", "tl", 0, 30, 30], 6: [".sv2-report-card[data-report='consultant-effort'] .sv2-table", "tl", 0, 14, 6] } });

  await shot({ guide: "admin", name: "a05-eposta-hatalari", as: "u_service", url: "/support-v2/admin/activities.html", wait: ".sv2-table", vp: [1366, 1600], scale: 1.6,
    before: async (page) => { await page.selectOption("#f-action", "email_failed"); await sleep(300); },
    targets: [".sv2-content > .sv2-section"], pad: 6,
    pins: { 1: ["#view-toggle button", "tl", 0, -4, -4], 2: F("#f-action"), 3: F("#f-user"), 4: F("#f-entity"), 5: F("#f-from"), 6: B("#f-clear"), 7: [".sv2-table thead th >> nth=4", "tl", 0, -14, -6] } });

  // ================================================================ 6. Sistem ve bakım (e-posta servisi / veri bakımı)
  const health = (name, before, withPins) => shot({ guide: "admin", name, as: "u_root", url: "/support-v2/admin/dashboard.html", wait: "#sv2-email-health", vp: [1366, 1800], scale: 1.6, settle: 700,
    before: async (page) => { await before(page); await sleep(350); }, target: "#sv2-email-health", pad: 14,
    pins: withPins ? { 1: ["#sv2-email-diagnose", "tl", 0, 0, 0], 2: ["#sv2-email-test", "tl", 0, 0, 0] } : {} });
  await health("a06-eposta-saglikli", async () => {}, true);
  await health("a06-eposta-hata", async (page) => { world.resendFailure = { status: 403, body: { name: "validation_error", message: "The parlabilgiteknolojileri.net domain is not verified." } }; await page.click("#sv2-email-test"); await page.waitForFunction(() => /doğrulanmamış/.test(document.getElementById("sv2-email-health-status").textContent)); world.resendFailure = null; });
  // Veri bakımı: eski sürümden kalan iki iç not örneği
  world.seed("v2/ticket_messages/t2/legacy1", { message_id: "legacy1", user_id: "u_cons1", author_name: "Zeynep Arslan", author_email: "zeynep.arslan@parla-demo.com", author_role: "consultant", message: "Dahili: müşteri kodu kontrol edilecek.", is_internal: true, work_hours: 0, created_at: iso(30 * D) });
  world.seed("v2/ticket_messages/t2/legacy2", { message_id: "legacy2", user_id: "u_cons1", author_name: "Zeynep Arslan", author_email: "zeynep.arslan@parla-demo.com", author_role: "consultant", message: "Dahili: mutabakat hesabı için FI ekibine soruldu.", is_internal: true, work_hours: 0, created_at: iso(29 * D) });
  await shot({ guide: "admin", name: "a06-veri-bakimi", as: "u_root", url: "/support-v2/admin/dashboard.html", wait: "#sv2-maintenance", vp: [1366, 1800], scale: 1.6, settle: 700,
    before: async (page) => { page.once("dialog", (d) => d.accept()); await page.click("#sv2-migrate-notes"); await page.waitForFunction(() => /taşındı/.test(document.getElementById("sv2-maintenance-status").textContent)); await sleep(300); },
    target: "#sv2-maintenance", pad: 14,
    pins: { 1: ["#sv2-migrate-notes", "tl", 0, 0, 0] } });
};
