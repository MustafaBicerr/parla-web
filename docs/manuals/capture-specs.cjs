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
 * Örnek verinin bir kısmı (etkinlik günlüğü, ek dosya, ek efor kayıtları) burada world.seed ile eklenir
 * (kurallar atlanır; yalnızca bu kılavuzun çekimleri içindir, e2e tohum verisi değişmez).
 * ================================================================================================== */
const sec = (t) => `.sv2-section:has(.sv2-section-header h3:text-is("${t}"))`;
const statCard = (label) => `.sv2-stat-card:has(.sv2-stat-label:text-is("${label}"))`;
const metaItem = (label) => `.sv2-meta-item:has(label:text-is("${label}"))`;
const nav = (id) => `#sv2-sidebar .sv2-nav-item[data-page="${id}"]`;
const modal = (id) => `#${id} .sv2-modal`;
const tab = (id) => `.sv2-tab[data-tab="${id}"]`;
/** Kenar menüyü gizleyip içeriği tam genişliğe yayar (geniş tablolar için). */
const noSidebar = async (page) => { await page.addStyleTag({ content: ".sv2-sidebar{display:none !important}.sv2-main{margin-left:0 !important}" }); };
/** Tüm tablolar tek satıra sığsın diye uzun metinler kısaltılmaz; yalnızca yatay taşmayı önler. */
const IFRAME_OK = true;

exports.admin = async ({ shot, emailShot, world, sleep }) => {
  const now = Date.now();
  const H = 3600 * 1000;
  const iso = (ms) => new Date(now - ms).toISOString();
  const today = new Date(now).toISOString().slice(0, 10);

  // ---------- Ek örnek veri
  const act = (id, o) => world.seed(`v2/activities/${id}`, { activity_id: id, user_uid: o.uid, user_name: o.name, action: o.action, entity_type: o.type, entity_id: o.eid || "", entity_label: o.label || "", details: o.details || "", created_at: iso(o.age) });
  act("a4", { uid: "u_service", name: "Mehmet Kaya", action: "ticket_updated", type: "ticket", eid: "t1", label: "SUP-ORN-SD-2610-0001", details: "Ticket güncellendi", age: 50 * 60000 });
  act("a5", { uid: "u_cons1", name: "Zeynep Arslan", action: "email_failed", type: "ticket", eid: "t6", label: "SUP-ORN-FI-2610-0006", details: "ticket_message — [rate_limited] E-posta servisi yoğun, lütfen tekrar deneyin.", age: 70 * 60000 });
  act("a6", { uid: "u_root", name: "Murat Aydın", action: "user_created", type: "user", eid: "u_new", label: "Ahmet Güler", details: "ahmet.guler@ornekholding.com — Müşteri Kullanıcısı", age: 20 * H });
  act("a7", { uid: "u_root", name: "Murat Aydın", action: "company_created", type: "company", eid: "cB", label: "Demir Çelik San. A.Ş.", details: "DMR0001", age: 26 * H });
  act("a8", { uid: "u_service", name: "Mehmet Kaya", action: "created", type: "contract", eid: "k2", label: "SZL-2026-007", details: "Yeni sözleşme: SZL-2026-007", age: 30 * H });
  act("a9", { uid: "u_service", name: "Mehmet Kaya", action: "email_failed", type: "ticket", eid: "t3", label: "SUP-ORN-FI-2610-0003", details: "send_to_customer — [domain_not_verified] Gönderen alan adı Resend'de doğrulanmamış (DNS kayıtlarını kontrol edin).", age: 5 * H });
  act("a10", { uid: "u_pm", name: "Burak Şahin", action: "updated", type: "project", eid: "pr1", label: "PRJ-ORN-01", details: "Proje güncellendi: S/4HANA Geçiş Projesi", age: 3 * 24 * H });
  act("a11", { uid: "u_cons2", name: "Can Öztürk", action: "ticket_updated", type: "ticket", eid: "t4", label: "SUP-ORN-MM-2610-0004", details: "Kapanış Onayı Bekliyor", age: 5 * H });
  act("a12", { uid: "u_root", name: "Murat Aydın", action: "updated", type: "department", eid: "d2", label: "SAP Geliştirme", details: "Departman güncellendi: SAP Geliştirme", age: 4 * 24 * H });
  // t1: iki ek dosya (veri ayrı düğümde)
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

  // ================================================================ 1. Başlangıç
  await shot({ guide: "admin", name: "a01-giris", as: null, url: "/support-v2/login.html", wait: "#sv2-login-form", vp: [1100, 700], scale: 2.4, target: ".sv2-auth-panel .sv2-card", pad: 14,
    before: async (page) => { await page.fill("#sv2-email", "mehmet.kaya@parla-demo.com"); await page.fill("#sv2-password", "Gecici-Sifre1"); },
    pins: { 1: ["#sv2-email", "l"], 2: ["#sv2-password", "l"], 3: ["#sv2-login-submit", "l"], 4: ["#sv2-forgot-password", "r"] } });

  await shot({ guide: "admin", name: "a01-genel-bakis", as: "u_root", url: "/support-v2/admin/dashboard.html", wait: ".sv2-stats-grid", vp: [1366, 1800], scale: 1.5, settle: 900,
    clip: { x: 0, y: 0, width: 1366, height: 820 },
    pins: { 1: [nav("dashboard"), "r"], 2: ["#sv2-topbar-guide", "b"], 3: ["#sv2-notif-btn", "b"], 4: [".sv2-stats-grid", "tl"], 5: [statCard("SLA Aşımı"), "tr"], 6: [sec("Ticket Tipi Dağılımı"), "tl"], 7: [sec("Son Aktiviteler"), "tl"], 8: [".sv2-topbar-user", "b"] } });

  await shot({ guide: "admin", name: "a01-genel-bakis-alt", as: "u_root", url: "/support-v2/admin/dashboard.html", wait: ".sv2-stats-grid", vp: [1366, 1800], scale: 1.5, settle: 900,
    targets: [sec("Danışman İş Yükü"), "#sv2-email-health", "#sv2-maintenance", sec("Atanmamış Ticketlar")], pad: 10,
    pins: { 1: [sec("Danışman İş Yükü"), "tl"], 2: ["#sv2-email-diagnose", "l"], 3: ["#sv2-email-test", "l"], 4: ["#sv2-migrate-notes", "l"], 5: [".sv2-quick-assign", "l", 0], 6: [sec("Atanmamış Ticketlar") + " a.sv2-btn", "l"] } });

  await shot({ guide: "admin", name: "a01-atama-penceresi", as: "u_root", url: "/support-v2/admin/dashboard.html", wait: ".sv2-stats-grid", vp: [1366, 1800], scale: 2,
    before: async (page) => { await page.click(".sv2-quick-assign >> nth=0"); await page.waitForSelector("#sv2-assign-modal.is-open .sv2-modal"); await page.selectOption("#sv2-assign-personnel", "p3"); await sleep(250); },
    target: modal("sv2-assign-modal"), pad: 8,
    pins: { 1: ["#sv2-assign-personnel", "tl"], 2: ["#sv2-assign-save", "tl"] } });

  await shot({ guide: "admin", name: "a01-menu", as: "u_root", url: "/support-v2/admin/dashboard.html", wait: ".sv2-stats-grid", vp: [1100, 1000], scale: 2.4, target: "#sv2-sidebar .sv2-nav", pad: 6,
    pins: { 1: [nav("dashboard"), "r"], 2: [nav("tickets"), "r"], 3: [nav("users"), "r"], 4: [nav("companies"), "r"], 5: ["#sv2-sidebar .sv2-nav-divider >> nth=0", "r"], 6: [nav("reports"), "r"], 7: ["#sv2-sidebar .sv2-nav-guide-open >> nth=0", "r"] } });
  await shot({ guide: "admin", name: "a01-kullanici-kutusu", as: "u_service", url: "/support-v2/admin/dashboard.html", wait: ".sv2-stats-grid", vp: [1100, 1000], scale: 2.4, target: "#sv2-sidebar .sv2-sidebar-footer", pad: 0,
    pins: { 1: ["#sv2-sidebar .sv2-user-mini", "r"], 2: ["#sv2-change-password-link", "r"], 3: ["#sv2-logout-btn", "r"] } });
};
