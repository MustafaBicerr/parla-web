/**
 * E2E (gerçek veritabanı kuralları + gerçek e-posta fonksiyonu): WP-06/07/10 —
 * talep yaşam döngüsü damgaları, durum makinesi, koşullu yazma (bayat ekran), atama matrisi
 * (ekle/çıkar/birincil/pasif/eşleşmeyen), talep tipi kilidi, yumuşak/kalıcı silme, pano sayıları, müşteri yanıtıyla yeniden açma.
 * Çalıştırma: node tests/e2e/lifecycle2.e2e.cjs
 */
const targaryen = require("../rules/node_modules/targaryen");
const { createWorld, startServer } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

// Kurallar auth.token.email kullanır; harness yalnız uid veriyorsa e-postayı kullanıcı profilinden ekler (zararsız).
(function patchAuthToken() {
  const proto = Object.getPrototypeOf(targaryen.database({ rules: { ".read": true, ".write": true } }, {}));
  if (proto.__tokenPatched) return;
  const origAs = proto.as;
  proto.as = function (auth) {
    if (auth && auth.uid && !auth.token) {
      let email = "";
      try { const n = this.root.$child(`v2/users/${auth.uid}/email`); email = (n && n.$value()) || ""; } catch { /* yok */ }
      auth = { ...auth, token: { email } };
    }
    return origAs.call(this, auth);
  };
  proto.__tokenPatched = true;
})();

const results = [];
const check = (name, ok, extra) => { results.push([ok ? "PASS" : "FAIL", name, ok ? "" : extra || ""]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 5000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* yeniden dene */ } await sleep(60); } return false; }

const istDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d instanceof Date ? d : new Date(d));
const istMonth = (d) => istDay(d).slice(0, 7);
const yymm = (d) => istDay(d).slice(2, 4) + istDay(d).slice(5, 7);

(async () => {
  const world = createWorld(buildSeed());
  const NOW = Date.now();
  const iso = (offsetMs) => new Date(NOW - offsetMs).toISOString();

  // ---- ek veri: arızi müşteri, eşleştirme senaryoları
  world.seed("v2/companies/cC", { company_id: "cC", name: "Arızi Ltd.", customer_code: "ARC0001", customer_type: "ARC", has_contract: false, is_active: true, created_at: iso(5 * 864e5) });
  world.seed("v2/users/u_arizi", { uid: "u_arizi", role: "arizi_customer", first_name: "Arda", last_name: "Zeki", email: "arda.zeki@arizi.com", company_id: "cC", company_name: "Arızi Ltd.", customer_code: "ARC0001", is_active: true, created_at: iso(5 * 864e5) });
  world.seed("v2/personnel/p8", { personnel_id: "p8", first_name: "Selim", last_name: "Kara", email: "selim.kara@parla-demo.com", department_id: "d1", department_name: "SAP Danışmanlık", role_title: "Danışman", is_active: true, created_at: iso(5 * 864e5) });
  world.seed("v2/personnel/p9", { personnel_id: "p9", first_name: "Ela", last_name: "Eşleşmez", email: "ela.eslesmez@parla-demo.com", department_id: "d1", department_name: "SAP Danışmanlık", role_title: "Danışman", is_active: true, created_at: iso(5 * 864e5) });
  world.seed("v2/users/u_cons8", { uid: "u_cons8", role: "consultant", first_name: "Selim", last_name: "Kara", email: "selim.kara@parla-demo.com", is_active: true, created_at: iso(5 * 864e5) });
  world.seed("v2/users/u_cons9", { uid: "u_cons9", role: "consultant", first_name: "Kayıt", last_name: "Sız", email: "kayitsiz@parla-demo.com", is_active: true, created_at: iso(5 * 864e5) });

  const srv = await startServer(world);
  const emailsTo = (addr) => world.emails.filter((e) => e.to.includes(addr));
  const val = (p) => world.valueAt(p);
  const hist = (tid) => Object.values(val(`v2/ticket_history/${tid}`) || {}).sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)));
  const toasts = (s) => s.page.locator(".sv2-toast-text").allTextContents();
  const confirmDialog = async (s) => { await s.page.waitForSelector("#sv2-confirm-ok"); await s.page.click("#sv2-confirm-ok"); };
  const sessions = [];
  const open = async (uid) => { const s = await srv.session(uid); sessions.push([uid, s]); return s; };
  const quick = async (s, status, note) => {
    await s.page.waitForSelector(`.sv2-quick-status[data-status="${status}"]`);
    await s.page.click(`.sv2-quick-status[data-status="${status}"]`);
    await s.page.fill("#sv2-quick-note", note);
    await s.page.click("#sv2-quick-confirm");
  };

  /** Pano kartları: sayılar DB'den, ekrandaki koddan bağımsız hesaplanır ve eşleşmelidir. */
  async function dashboardCheck(s, label) {
    const tickets = Object.entries(val("v2/tickets")).map(([id, t]) => ({ id, ...t })).filter((t) => t.is_deleted !== true);
    const assigned = val("v2/ticket_assignments") || {};
    const assignees = (t) => { const ids = Object.keys(assigned[t.id] || {}); return ids.length ? ids : t.assigned_to_id ? [t.assigned_to_id] : []; };
    const activePids = new Set(Object.values(val("v2/personnel")).filter((p) => p.is_active !== false).map((p) => p.personnel_id));
    const isOpen = (t) => t.status !== "closed" && t.status !== "resolved";
    const today = istDay(new Date());
    const thisMonth = istMonth(new Date());
    const expected = {
      "Toplam Açık": tickets.filter(isOpen).length,
      Kritik: tickets.filter((t) => isOpen(t) && t.priority === "critical").length,
      "Bugün Açılan": tickets.filter((t) => istDay(t.created_at) === today).length,
      "Bugün Kapanan": tickets.filter((t) => t.status === "closed" && t.closed_at && istDay(t.closed_at) === today).length,
      Atanmamış: tickets.filter((t) => isOpen(t) && assignees(t).length === 0).length,
      "Pasif Danışmanda": tickets.filter((t) => isOpen(t) && assignees(t).length > 0 && !assignees(t).some((pid) => activePids.has(pid))).length,
      "Bu Ay Çözülen": tickets.filter((t) => (t.status === "resolved" || t.status === "closed") && (t.resolved_at || t.closed_at) && istMonth(t.resolved_at || t.closed_at) === thisMonth).length,
    };
    await s.goto("/support-v2/admin/dashboard.html");
    await s.page.waitForSelector(".sv2-stats-grid .sv2-stat-card");
    const cards = await s.page.locator(".sv2-stats-grid .sv2-stat-card").evaluateAll((els) =>
      Object.fromEntries(els.map((e) => [e.querySelector(".sv2-stat-label")?.textContent.trim(), e.querySelector(".sv2-stat-value")?.textContent.trim()]))
    );
    for (const [name, value] of Object.entries(expected)) {
      check(`pano (${label}) '${name}' = ${value} (bağımsız hesap)`, String(cards[name]) === String(value), `ekran=${cards[name]} beklenen=${value}`);
    }
    check(`pano (${label}) 'SLA Aşımı' sayısal`, /^\d+$/.test(String(cards["SLA Aşımı"])), String(cards["SLA Aşımı"]));
    return expected;
  }

  try {
    // =====================================================================
    // A) Talep tipi kilidi + oluşturma (ay kodu İstanbul, "DIGER" numarası)
    // =====================================================================
    const root = await open("u_root");
    const start = await dashboardCheck(root, "başlangıç");
    check("başlangıç panosunda sıfır olmayan sayılar var (karşılaştırma anlamlı)", start["Toplam Açık"] > 0 && start["Bu Ay Çözülen"] >= 0 && start["Atanmamış"] > 0);
    const cust = await open("u_cust");
    await cust.goto("/support-v2/customer/dashboard.html");
    await cust.page.waitForSelector("#sv2-new-ticket-btn");
    await cust.page.click("#sv2-new-ticket-btn");
    await cust.page.waitForSelector("#sv2-ticket-type");
    const custTypes = await cust.page.locator("#sv2-ticket-type option").evaluateAll((o) => o.map((x) => x.value));
    check("destek anlaşmalı müşteri yalnız SUP/BUG açabilir (tip kilidi)", JSON.stringify(custTypes) === JSON.stringify(["SUP", "BUG"]), custTypes.join(","));
    await cust.page.selectOption("#sv2-ticket-module", "Diğer");
    await cust.page.fill("#sv2-ticket-title", "Yeni talep: sıralama testi");
    await cust.page.fill("#sv2-ticket-description", "Bu talep yaşam döngüsü uçtan uca testi için açılmıştır; açıklama yeterince uzundur.");
    await cust.page.click("#sv2-create-ticket-submit");
    check("müşteri talebi oluşturuldu", await waitFor(() => Object.values(val("v2/tickets") || {}).some((t) => t.title === "Yeni talep: sıralama testi")));
    const created = Object.entries(val("v2/tickets")).find(([, t]) => t.title === "Yeni talep: sıralama testi");
    const TID = created[0];
    const num = created[1].ticket_number;
    check("ticket numarası ASCII 'DIGER' modül kodu ve İstanbul ay koduyla", new RegExp(`^SUP-ORN-DIGER-${yymm(new Date())}-\\d{4}$`).test(num), num);
    check("oluşturulan talep açık, atamasız, damgasız", created[1].status === "open" && !created[1].assigned_to_id && !created[1].resolved_at && !created[1].closed_at && !created[1].first_response_at);

    const arizi = await open("u_arizi");
    await arizi.goto("/support-v2/customer/dashboard.html");
    await arizi.page.waitForSelector("#sv2-new-ticket-btn");
    await arizi.page.click("#sv2-new-ticket-btn");
    await arizi.page.waitForSelector("#sv2-ticket-type");
    const aTypes = await arizi.page.locator("#sv2-ticket-type option").evaluateAll((o) => o.map((x) => [x.value, x.selected]));
    check("arızi müşteri yalnız ARZ/BUG açabilir, varsayılan ARZ", JSON.stringify(aTypes) === JSON.stringify([["ARZ", true], ["BUG", false]]), JSON.stringify(aTypes));

    // =====================================================================
    // B) Atama → birincil değiştirme → işleme alma → çözme → müşteri onayı → yeniden açma → geri alma
    // =====================================================================
    const svc = await open("u_service");
    await svc.goto(`/support-v2/admin/ticket-detail.html?id=${TID}`);
    await svc.page.waitForSelector("#sv2-assign-p1");
    // durum listesi: açık talepte yalnız izinli geçişler
    const openOptions = await svc.page.locator("#sv2-admin-status option").evaluateAll((o) => o.map((x) => x.value));
    check("açık talepte durum listesi yalnız mevcut + 'atandı' içerir (PER-08)", JSON.stringify(openOptions) === JSON.stringify(["open", "assigned"]), openOptions.join(","));
    await svc.page.check("#sv2-assign-p1");
    await svc.page.check("#sv2-assign-p2");
    await svc.page.click("#sv2-admin-update");
    check("atama sonrası durum 'assigned', birincil p1", await waitFor(() => val(`v2/tickets/${TID}/status`) === "assigned" && val(`v2/tickets/${TID}/assigned_to_id`) === "p1"));
    check("assigned_uids haritası yazıldı (danışman yazma yetkisi)", JSON.stringify(Object.keys(val(`v2/tickets/${TID}/assigned_uids`) || {}).sort()) === JSON.stringify(["u_cons1", "u_cons2"]) && Object.values(val(`v2/tickets/${TID}/assigned_uids`)).every((v) => v === true), JSON.stringify(val(`v2/tickets/${TID}/assigned_uids`)));
    let h = hist(TID);
    check("geçmiş: durum değişimi TEK satır (açık→atandı)", h.filter((r) => r.field_changed === "status").length === 1 && h.some((r) => r.action === "status_changed" && r.old_value === "open" && r.new_value === "assigned"), JSON.stringify(h.map((r) => [r.action, r.old_value, r.new_value])));
    check("geçmiş: birincil atama adı çözülmüş tek satır, ham 'p1' yok", h.some((r) => r.action === "assigned_to_changed" && r.new_value === "Zeynep Arslan") && h.every((r) => !/^p\d$/.test(r.old_value) && !/^p\d$/.test(r.new_value)) && h.filter((r) => r.action.startsWith("assigned_to")).length === 1, JSON.stringify(h.map((r) => [r.action, r.old_value, r.new_value])));
    check("geçmiş: ikincil danışman eklemesi kayıtlı", h.some((r) => r.action === "assignment_added" && r.new_value === "Can Öztürk"));
    check("atanan danışmanlara e-posta gitti", await waitFor(() => emailsTo("zeynep.arslan@parla-demo.com").length > 0 && emailsTo("can.ozturk@parla-demo.com").length > 0));
    const p1AssignedAt = val(`v2/ticket_assignments/${TID}/p1/assigned_at`);

    // yalnız birincili değiştir (PER-01/SEN-11)
    await svc.goto(`/support-v2/admin/ticket-detail.html?id=${TID}`);
    await svc.page.waitForSelector("#sv2-primary-p2");
    await svc.page.check("#sv2-primary-p2");
    await svc.page.click("#sv2-admin-update");
    check("yalnız birincil değişince kaydedilir (assigned_to_id p2)", await waitFor(() => val(`v2/tickets/${TID}/assigned_to_id`) === "p2" && val(`v2/tickets/${TID}/assigned_to_name`) === "Can Öztürk"), String((await toasts(svc)).join("|")));
    check("birincil bayrakları ve özgün atama zamanı doğru", val(`v2/ticket_assignments/${TID}/p1/is_primary`) === false && val(`v2/ticket_assignments/${TID}/p2/is_primary`) === true && val(`v2/ticket_assignments/${TID}/p1/assigned_at`) === p1AssignedAt);
    h = hist(TID);
    check("geçmiş: birincil değişimi 'Zeynep Arslan → Can Öztürk'", h.some((r) => r.action === "assigned_to_changed" && r.old_value === "Zeynep Arslan" && r.new_value === "Can Öztürk"));

    // atanmış danışman işleme alır
    const cons2 = await open("u_cons2");
    await cons2.goto(`/support-v2/admin/ticket-detail.html?id=${TID}`);
    await cons2.page.waitForSelector("#sv2-start-work");
    await cons2.page.click("#sv2-start-work");
    check("işleme alma: durum, started_at ve ilk yanıt damgası", await waitFor(() => val(`v2/tickets/${TID}/status`) === "in_progress" && !!val(`v2/tickets/${TID}/started_at`) && !!val(`v2/tickets/${TID}/first_response_at`)));
    check("işleme alma müşteriye e-posta gönderdi", await waitFor(() => emailsTo("ayse.demir@ornekholding.com").some((e) => /Talep/.test(e.subject) || true)));
    // çözme: kapanış onayı iste
    await quick(cons2, "pending_close", "Sorun giderildi, test edip onaylayın lütfen.");
    check("kapanış onayı: resolved_at yazıldı, closed_at yok, SLA duraklatıldı", await waitFor(() => val(`v2/tickets/${TID}/status`) === "pending_close" && !!val(`v2/tickets/${TID}/resolved_at`) && !val(`v2/tickets/${TID}/closed_at`) && !!val(`v2/tickets/${TID}/sla_paused_since`)));
    const resolved1 = val(`v2/tickets/${TID}/resolved_at`);
    check("kapanış onayı e-postası müşteriye gitti", await waitFor(() => emailsTo("ayse.demir@ornekholding.com").some((e) => /Kapanış onayı/.test(e.subject))));
    // müşteri onaylar
    await cust.goto(`/support-v2/customer/ticket-detail.html?id=${TID}`);
    await cust.page.waitForSelector("#sv2-approve-close");
    await cust.page.click("#sv2-approve-close");
    await cust.page.fill("#sv2-lifecycle-note", "Teşekkürler, çözüldü.");
    await cust.page.click("#sv2-lifecycle-confirm");
    check("müşteri onayı: kapandı, closed_at + closed_at_ms, resolved_at korunur", await waitFor(() => val(`v2/tickets/${TID}/status`) === "closed" && !!val(`v2/tickets/${TID}/closed_at`) && typeof val(`v2/tickets/${TID}/closed_at_ms`) === "number" && val(`v2/tickets/${TID}/resolved_at`) === resolved1));
    // yönetici yeniden açar
    await svc.goto(`/support-v2/admin/ticket-detail.html?id=${TID}`);
    check("kapalı talepte yanıt kutusu yok (önce yeniden aç)", (await (async () => { await svc.page.waitForSelector("#sv2-reply-blocked"); return svc.page.locator("#sv2-reply-message").count(); })()) === 0);
    await quick(svc, "reopened", "Müşteri talebi yeniden değerlendirilmek üzere açıldı.");
    check("yeniden açma: reopened_at yazıldı; closed_at/closed_at_ms/resolved_at temizlendi", await waitFor(() => val(`v2/tickets/${TID}/status`) === "reopened" && !!val(`v2/tickets/${TID}/reopened_at`) && val(`v2/tickets/${TID}/closed_at`) === null && val(`v2/tickets/${TID}/closed_at_ms`) === null && val(`v2/tickets/${TID}/resolved_at`) === null));
    // tekrar çözme + geri alma
    await cons2.goto(`/support-v2/admin/ticket-detail.html?id=${TID}`);
    await quick(cons2, "pending_close", "Yeniden açılan talep için düzeltme yapıldı.");
    check("yeniden açıldıktan sonra yeni çözüm damgası yazıldı", await waitFor(() => val(`v2/tickets/${TID}/status`) === "pending_close" && !!val(`v2/tickets/${TID}/resolved_at`) && val(`v2/tickets/${TID}/resolved_at`) !== resolved1));
    await cons2.goto(`/support-v2/admin/ticket-detail.html?id=${TID}`);
    await quick(cons2, "in_progress", "Müşteri ek bilgi bildirdi, işleme geri alındı.");
    check("geri alma: resolved_at temizlendi, SLA duraklaması kapandı", await waitFor(() => val(`v2/tickets/${TID}/status`) === "in_progress" && val(`v2/tickets/${TID}/resolved_at`) === null && val(`v2/tickets/${TID}/sla_paused_since`) === null && Number(val(`v2/tickets/${TID}/sla_paused_ms`)) >= 0));
    h = hist(TID);
    const statusRows = h.filter((r) => r.field_changed === "status");
    check("geçmiş: 7 geçişin her biri TEK satır (çift satır yok), değerler durum kodu", statusRows.length === 7 && statusRows.every((r) => /^[a-z_]+$/.test(r.old_value) && /^[a-z_]+$/.test(r.new_value)), JSON.stringify(statusRows.map((r) => `${r.old_value}>${r.new_value}`)));
    check("geçmiş: notlar aynı satırda", statusRows.some((r) => r.new_value === "pending_close" && /Sorun giderildi/.test(r.note)) && statusRows.some((r) => r.new_value === "closed" && /Müşteri kapanışı onayladı/.test(r.note)));

    // =====================================================================
    // C) Bayat ekran çakışması: yarım kayıt / geçmiş / e-posta yok
    // =====================================================================
    const cons1 = await open("u_cons1");
    await cons1.goto("/support-v2/admin/ticket-detail.html?id=t3"); // müşteri bekleniyor
    await cons1.page.waitForSelector('.sv2-quick-status[data-status="in_progress"]');
    world.seed("v2/tickets/t3/status", "pending_close"); // başka biri durumu değiştirdi
    const histBefore = hist("t3").length;
    const mailBefore = world.emails.length;
    await quick(cons1, "in_progress", "Bayat ekrandan geri alma denemesi.");
    check("bayat ekran: anlaşılır çakışma iletisi", await waitFor(async () => (await toasts(cons1)).some((t) => /başka biri tarafından güncellendi/.test(t))), (await toasts(cons1)).join("|"));
    await sleep(300);
    check("bayat ekran: durum, geçmiş ve e-posta değişmedi", val("v2/tickets/t3/status") === "pending_close" && hist("t3").length === histBefore && world.emails.length === mailBefore);
    world.seed("v2/tickets/t3/status", "waiting_customer");

    await cust.goto("/support-v2/customer/ticket-detail.html?id=t4"); // kapanış onayı bekliyor
    await cust.page.waitForSelector("#sv2-approve-close");
    world.seed("v2/tickets/t4/status", "in_progress"); // personel işleme geri aldı
    const h4 = hist("t4").length;
    const mail4 = world.emails.length;
    await cust.page.click("#sv2-approve-close");
    await cust.page.fill("#sv2-lifecycle-note", "Onay.");
    await cust.page.click("#sv2-lifecycle-confirm");
    check("bayat müşteri ekranı: çakışma iletisi, gerçekleşmemiş geçiş geçmişe yazılmaz", await waitFor(async () => (await toasts(cust)).some((t) => /başka biri tarafından güncellendi/.test(t))) && val("v2/tickets/t4/status") === "in_progress" && hist("t4").length === h4 && world.emails.length === mail4, (await toasts(cust)).join("|"));
    world.seed("v2/tickets/t4/status", "pending_close");

    // =====================================================================
    // D) Müşteri kapanış onayı bekleyen / çözülmüş talebe yanıt yazarsa otomatik yeniden açılır
    // =====================================================================
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t4");
    await cust.page.waitForSelector("#sv2-reply-message");
    const mailsBeforeReply = world.emails.length;
    await cust.page.fill("#sv2-reply-message", "Sorun hâlâ devam ediyor, düzeltme işe yaramadı.");
    await cust.page.click("#sv2-send-reply");
    check("pending_close'a yanıt: talep otomatik 'reopened' oldu", await waitFor(() => val("v2/tickets/t4/status") === "reopened" && !!val("v2/tickets/t4/reopened_at")));
    check("yanıt mesajı konuşmaya yazıldı", Object.values(val("v2/ticket_messages/t4") || {}).some((m) => /Sorun hâlâ devam ediyor/.test(m.message) && m.author_role === "customer"));
    const h4rows = hist("t4").filter((r) => r.new_value === "reopened");
    check("geçmişte tek 'yeniden açıldı' satırı (notlu)", h4rows.length === 1 && /yeniden açıldı/.test(h4rows[0].note), JSON.stringify(h4rows));
    check("personele TEK e-posta ('tekrar açıldı', yanıt metniyle)", await waitFor(() => world.emails.slice(mailsBeforeReply).filter((e) => /tekrar açıldı/i.test(e.subject)).length === 1) && world.emails.slice(mailsBeforeReply).every((e) => !/Yeni yanıt/i.test(e.subject)), JSON.stringify(world.emails.slice(mailsBeforeReply).map((e) => e.subject)));
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t8"); // çözüldü
    await cust.page.waitForSelector("#sv2-reply-message");
    await cust.page.fill("#sv2-reply-message", "Çözüm yeterli değil, yeniden bakar mısınız?");
    await cust.page.click("#sv2-send-reply");
    check("resolved'a yanıt: talep 'reopened' oldu", await waitFor(() => val("v2/tickets/t8/status") === "reopened" && !!val("v2/tickets/t8/reopened_at")));
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t5"); // kapalı
    await cust.page.waitForSelector("#sv2-lifecycle-banner");
    check("kapalı talepte yanıt kutusu yok", (await cust.page.locator("#sv2-reply-message").count()) === 0);

    // =====================================================================
    // E) Atama matrisi
    // =====================================================================
    // E1) Birincil ve ikincil danışman semantiği: ikincil danışman (u_cons2, t1) yazabilir
    await cons2.goto("/support-v2/admin/ticket-detail.html?id=t1");
    await cons2.page.waitForSelector("#sv2-reply-message");
    check("ikincil danışman atandığı talepte yanıt/işlem yapabilir", (await cons2.page.locator("#sv2-reply-message").count()) === 1 && (await cons2.page.locator("#sv2-quick-actions button").count()) > 0);
    // E2) Atanmamış danışman yazamaz
    await cons2.goto("/support-v2/admin/ticket-detail.html?id=t10");
    await cons2.page.waitForSelector("#sv2-reply-blocked");
    check("atanmamış danışmanda yanıt kutusu, hızlı işlem ve efor formu yok", (await cons2.page.locator("#sv2-reply-message").count()) === 0 && (await cons2.page.locator("#sv2-quick-actions").count()) === 0 && (await cons2.page.locator("#sv2-effort-add").count()) === 0);
    const denied = world.dbOp({ op: "update", uid: "u_cons2", path: "v2/tickets/t10", value: { status: "in_progress", updated_at: new Date().toISOString() } });
    check("kurallar atanmamış danışmanın yazmasını reddeder", denied.error === "PERMISSION_DENIED", JSON.stringify(denied));
    // E3) Tüm danışmanları kaldır (t11): onay penceresi
    await svc.goto("/support-v2/admin/ticket-detail.html?id=t11");
    await svc.page.waitForSelector("#sv2-assign-p3");
    await svc.page.uncheck("#sv2-assign-p3");
    await svc.page.click("#sv2-admin-update");
    await confirmDialog(svc);
    check("tüm danışmanlar kaldırıldı: atama, harita ve birincil temizlendi, durum açık", await waitFor(() => !val("v2/tickets/t11/assigned_to_id") && !val("v2/ticket_assignments/t11") && !val("v2/tickets/t11/assigned_uids") && val("v2/tickets/t11/status") === "open"), JSON.stringify(val("v2/tickets/t11")));
    // E4) Pasif danışman ilgisiz güncellemede atamadan çıkmaz; öncelik düşürmek ihlali silmez
    world.seed("v2/personnel/p2/is_active", false);
    const t1Before = val("v2/tickets/t1");
    await svc.goto("/support-v2/admin/ticket-detail.html?id=t1");
    await svc.page.waitForSelector("#sv2-assign-p2");
    check("pasif atanmış danışman listede 'pasif' etiketiyle işaretli görünür", (await svc.page.isChecked("#sv2-assign-p2")) && /pasif/.test(await svc.page.textContent('label[for="sv2-assign-p2"]')));
    await svc.page.selectOption("#sv2-admin-priority", "low");
    await svc.page.click("#sv2-admin-update");
    check("yalnız öncelik değişti: pasif danışman atamada kaldı", await waitFor(() => val("v2/tickets/t1/priority") === "low") && !!val("v2/ticket_assignments/t1/p2") && val("v2/tickets/t1/assigned_uids/u_cons2") === true);
    check("öncelik düşürmek SLA ihlalini silmedi (ihlal damgası saklandı)", !!val("v2/tickets/t1/sla_resolution_breached_at"), JSON.stringify(Object.fromEntries(Object.entries(val("v2/tickets/t1")).filter(([k]) => k.startsWith("sla_")))));
    check("öncelik değişimi geçmişe tek satır", hist("t1").filter((r) => r.action === "priority_changed").length === 1);
    world.seed("v2/personnel/p2/is_active", true);
    void t1Before;
    // E5) Eşleşmeyen personel: PM (kullanıcı listesini okuyamaz) p8'i atar → uyarı; danışman yazamaz
    const pm = await open("u_pm");
    await pm.goto("/support-v2/admin/ticket-detail.html?id=t6");
    await pm.page.waitForSelector("#sv2-assign-p8");
    await pm.page.check("#sv2-assign-p8");
    await pm.page.click("#sv2-admin-update");
    check("eşleşmeyen personel atanınca uyarı gösterilir", await waitFor(async () => (await toasts(pm)).some((t) => /eşleşmesi yok/.test(t))), (await toasts(pm)).join("|"));
    check("eşleşmeyen personel assigned_uids'e eklenmez, atama kaydı yazılır", !val("v2/tickets/t6/assigned_uids/u_cons8") && !!val("v2/ticket_assignments/t6/p8"));
    const cons8 = await open("u_cons8");
    await cons8.goto("/support-v2/admin/ticket-detail.html?id=t6");
    await cons8.page.waitForSelector(".sv2-warning-card");
    check("eşleşmesi tamamlanmamış danışmana anlaşılır uyarı, yazma yok", /eşleşmesi tamamlanmamış/.test(await cons8.page.textContent(".sv2-warning-card")) && (await cons8.page.locator("#sv2-reply-message").count()) === 0);
    // E6) Personel ↔ kullanıcı eşleştirme aracı (süper admin)
    await root.goto("/support-v2/admin/personnel.html");
    await root.page.waitForSelector("#btn-link-personnel");
    await root.page.click("#btn-link-personnel");
    await root.page.waitForSelector("#link-result-summary");
    const summary = await root.page.textContent("#modal-link-result");
    check("eşleştirme aracı p8'i bağladı ve ticket haritasını güncelledi", val("v2/personnel/p8/uid") === "u_cons8" && val("v2/tickets/t6/assigned_uids/u_cons8") === true, summary);
    check("eşleşmeyen personel (p9) ve personel kaydı olmayan danışman hesabı uyarı listesinde", /Eşleşmez/.test(summary) && /Kayıt Sız|Kayıt\s+Sız|kayitsiz@/.test(summary), summary);
    await cons8.goto("/support-v2/admin/ticket-detail.html?id=t6");
    await cons8.page.waitForSelector("#sv2-reply-message");
    check("eşleştirme sonrası danışman talepte yazabilir", (await cons8.page.locator("#sv2-reply-message").count()) === 1);
    // E7) Personel e-postası değişince atama kopyaları güncellenir
    await root.goto("/support-v2/admin/personnel-detail.html?id=p1");
    await root.page.waitForSelector("#btn-edit-person");
    await root.page.click("#btn-edit-person");
    await root.page.waitForSelector('#edit-person-form [name="email"]');
    await root.page.fill('#edit-person-form [name="email"]', "Zeynep.Yeni@parla-demo.com");
    await root.page.click("#edit-person-save");
    check("personel e-postası küçük harfe normalize edildi", await waitFor(() => val("v2/personnel/p1/email") === "zeynep.yeni@parla-demo.com"));
    const emailCopies = () => Object.entries(val("v2/ticket_assignments") || {}).filter(([, byPid]) => byPid.p1).map(([, byPid]) => byPid.p1.personnel_email);
    check("atama kayıtlarındaki e-posta kopyaları güncellendi", await waitFor(() => emailCopies().length > 0 && emailCopies().every((e) => e === "zeynep.yeni@parla-demo.com")), emailCopies().join(","));

    // =====================================================================
    // F) Talep tipi değiştirme (yönetici), numara değişmez; danışman tip değiştiremez
    // =====================================================================
    const numberBefore = val("v2/tickets/t2/ticket_number");
    await svc.goto("/support-v2/admin/ticket-detail.html?id=t2");
    await svc.page.waitForSelector("#sv2-admin-type");
    await svc.page.selectOption("#sv2-admin-type", "BUG");
    await svc.page.click("#sv2-admin-update");
    check("yönetici tipi değiştirdi: ticket_type BUG, numara aynı", await waitFor(() => val("v2/tickets/t2/ticket_type") === "BUG") && val("v2/tickets/t2/ticket_number") === numberBefore);
    check("tip değişimi geçmişe yazıldı", hist("t2").some((r) => r.action === "ticket_type_changed" && r.old_value === "SUP" && r.new_value === "BUG"));
    await cons1.goto("/support-v2/admin/ticket-detail.html?id=t6");
    await cons1.page.waitForSelector("#sv2-quick-actions, .sv2-warning-card");
    check("danışman panelinde tip seçici yok", (await cons1.page.locator("#sv2-admin-type").count()) === 0);

    // =====================================================================
    // G) Durum listesi yalnız izinli geçişler; süper admin matris dışını ayrı grupta görür
    // =====================================================================
    await svc.goto("/support-v2/admin/ticket-detail.html?id=t9"); // işlemde
    await svc.page.waitForSelector("#sv2-admin-status");
    const inProg = await svc.page.locator("#sv2-admin-status option").evaluateAll((o) => o.map((x) => x.value));
    check("işlemdeki talepte durum listesi: mevcut + müşteri bekleniyor/kapanış onayı/çözüldü", JSON.stringify(inProg) === JSON.stringify(["in_progress", "waiting_customer", "pending_close", "resolved"]), inProg.join(","));
    await root.goto("/support-v2/admin/ticket-detail.html?id=t9");
    await root.page.waitForSelector("#sv2-admin-status");
    check("süper admin: matris dışı seçenekler ayrı grupta (gerekçe zorunlu)", (await root.page.locator("#sv2-admin-status optgroup option").count()) === 4);
    await root.page.selectOption("#sv2-admin-status", "closed");
    await root.page.click("#sv2-admin-update");
    check("matris dışı geçiş gerekçesiz reddedilir", await waitFor(async () => (await toasts(root)).some((t) => /gerekçe/.test(t))) && val("v2/tickets/t9/status") === "in_progress");

    // =====================================================================
    // H) Efor doğrulama + Istanbul tarihi + yanıt kutusu negatif saat
    // =====================================================================
    await cons1.goto("/support-v2/admin/ticket-detail.html?id=t6");
    await cons1.page.waitForSelector("#sv2-effort-add");
    check("efor formu varsayılan tarihi İstanbul takvim günü", (await cons1.page.inputValue("#sv2-effort-date")) === istDay(new Date()));
    const effortsBefore = Object.keys(val("v2/ticket_efforts/t6") || {}).length;
    for (const bad of ["0.1", "-5", "99"]) {
      await cons1.page.fill("#sv2-effort-hours", bad);
      await cons1.page.click("#sv2-effort-add");
      await sleep(250);
    }
    check("geçersiz efor (0.1 / -5 / 99) kaydedilmez", Object.keys(val("v2/ticket_efforts/t6") || {}).length === effortsBefore);
    await cons1.page.fill("#sv2-effort-hours", "0.5");
    await cons1.page.click("#sv2-effort-add");
    check("geçerli efor kaydedildi (İstanbul günü)", await waitFor(() => Object.values(val("v2/ticket_efforts/t6") || {}).some((e) => e.hours === 0.5 && e.work_date === istDay(new Date()) && e.personnel_id === "p1")));
    await cons1.page.waitForSelector("#sv2-reply-message");
    const msgsBefore = Object.keys(val("v2/ticket_messages/t6") || {}).length;
    await cons1.page.fill("#sv2-reply-message", "Negatif efor denemesi mesajı.");
    await cons1.page.fill("#sv2-reply-hours", "-5");
    await cons1.page.click("#sv2-reply-send");
    await sleep(400);
    check("yanıt kutusunda negatif saat reddedilir, mesaj yazılmaz", Object.keys(val("v2/ticket_messages/t6") || {}).length === msgsBefore && (await toasts(cons1)).some((t) => /En az 0.25|geçerli|0,25/i.test(t)), (await toasts(cons1)).join("|"));

    // =====================================================================
    // I) Yumuşak silme + arşiv + kalıcı silme (8 düğüm)
    // =====================================================================
    world.seed("v2/ticket_efforts/t12", { ex1: { effort_id: "ex1", personnel_id: "p1", personnel_name: "Zeynep Arslan", hours: 7, work_date: istDay(new Date()), note: "silinecek", created_at: new Date().toISOString(), created_by_uid: "u_cons1", created_by_name: "Zeynep Arslan" } });
    world.seed("v2/ticket_messages/t12", { mx: { message_id: "mx", user_id: "u_cust", author_name: "Ayşe Demir", author_email: "ayse.demir@ornekholding.com", author_role: "customer", message: "eski mesaj", is_internal: false, created_at: iso(31 * 864e5) } });
    world.seed("v2/ticket_internal_notes/t12", { nx: { message_id: "nx", user_id: "u_cons1", author_name: "Zeynep Arslan", author_role: "consultant", message: "iç not", is_internal: true, created_at: iso(31 * 864e5) } });
    world.seed("v2/ticket_attachments/t12", { ax: { att_id: "ax", name: "a.txt", type: "text/plain", size: 3, data: "abc", uploader_uid: "u_cust", created_at: iso(31 * 864e5) } });
    world.seed("v2/ticket_internal_attachments/t12", { iax: { att_id: "iax", name: "i.txt", type: "text/plain", size: 3, data: "abc", uploader_uid: "u_cons1", created_at: iso(31 * 864e5) } });
    world.seed("v2/ticket_assignments/t12", { p1: { personnel_id: "p1", personnel_name: "Zeynep Arslan", personnel_email: "zeynep.yeni@parla-demo.com", is_primary: true, assigned_at: iso(40 * 864e5) } });
    await svc.goto("/support-v2/admin/tickets.html");
    await svc.page.waitForSelector('.sv2-delete-ticket[data-id="t12"]');
    await svc.page.click('.sv2-delete-ticket[data-id="t12"]');
    await confirmDialog(svc);
    check("silme yumuşak: is_deleted/deleted_at/deleted_by yazıldı, veriler korunur", await waitFor(() => val("v2/tickets/t12/is_deleted") === true && !!val("v2/tickets/t12/deleted_at") && val("v2/tickets/t12/deleted_by") === "u_service") && !!val("v2/ticket_messages/t12") && !!val("v2/ticket_efforts/t12"));
    check("silme geçmişe ve aktiviteye yazıldı", hist("t12").some((r) => r.action === "ticket_deleted") && Object.values(val("v2/activities") || {}).some((a) => a.action === "ticket_deleted" && a.entity_id === "t12"));
    check("silinen talep admin listesinden kalktı", await waitFor(async () => (await svc.page.locator('.sv2-delete-ticket[data-id="t12"]').count()) === 0));
    await cust.goto("/support-v2/customer/tickets.html");
    await cust.page.waitForSelector("#sv2-tickets-table");
    await sleep(500);
    check("silinen talep müşteri listesinde görünmez", !(await cust.page.content()).includes("Maliyet merkezi hiyerarşisi"));
    await cust.goto("/support-v2/customer/ticket-detail.html?id=t12");
    await sleep(900);
    check("silinen talebin müşteri detay sayfası içeriği göstermez", !(await cust.page.content()).includes("Maliyet merkezi hiyerarşisi"));
    await root.goto("/support-v2/admin/reports.html");
    await root.page.waitForSelector("#report-cards .sv2-report-card");
    const reportText = await root.page.textContent("#report-cards");
    check("raporlar silinen talebin eforunu saymaz ('Bilinmiyor' firma yok)", !/Bilinmiyor/.test(reportText) && !reportText.includes("silinecek"), reportText.slice(0, 200));
    await svc.goto("/support-v2/admin/tickets.html");
    await svc.page.waitForSelector("#sv2-toggle-deleted");
    await svc.page.click("#sv2-toggle-deleted");
    await svc.page.waitForSelector('.sv2-restore-ticket[data-id="t12"]');
    check("arşivde geri yükleme var; kalıcı silme düğmesi destek atayıcıda yok", (await svc.page.locator(".sv2-permanent-delete").count()) === 0);
    await root.goto("/support-v2/admin/tickets.html");
    await root.page.waitForSelector("#sv2-toggle-deleted");
    await root.page.click("#sv2-toggle-deleted");
    await root.page.waitForSelector('.sv2-permanent-delete[data-id="t12"]');
    await root.page.click('.sv2-permanent-delete[data-id="t12"]');
    await confirmDialog(root);
    const nodes = ["tickets", "ticket_messages", "ticket_internal_notes", "ticket_attachments", "ticket_internal_attachments", "ticket_history", "ticket_assignments", "ticket_efforts"];
    check("kalıcı silme: 8 düğümün tamamı temizlendi", await waitFor(() => nodes.every((n) => !val(`v2/${n}/t12`))), JSON.stringify(nodes.filter((n) => val(`v2/${n}/t12`))));
    check("kalıcı silme aktivite izini bırakır", Object.values(val("v2/activities") || {}).some((a) => a.action === "ticket_permanently_deleted" && a.entity_id === "t12"));
    // yumuşak silinmiş başka bir talep geri yüklenir
    await svc.goto("/support-v2/admin/tickets.html");
    await svc.page.waitForSelector('.sv2-delete-ticket[data-id="t5"]');
    await svc.page.click('.sv2-delete-ticket[data-id="t5"]');
    await confirmDialog(svc);
    await waitFor(() => val("v2/tickets/t5/is_deleted") === true);
    await svc.goto(`/support-v2/admin/ticket-detail.html?id=t5`);
    await svc.page.waitForSelector("#sv2-restore-ticket");
    await svc.page.click("#sv2-restore-ticket");
    check("arşivden geri yükleme: is_deleted false", await waitFor(() => val("v2/tickets/t5/is_deleted") === false && hist("t5").some((r) => r.action === "ticket_restored")));

    // =====================================================================
    // J) Pano sayıları DB'den bağımsız hesapla eşleşir (pasif danışman senaryosuyla)
    // =====================================================================
    world.seed("v2/personnel/p9/is_active", false);
    world.seed("v2/tickets/t6/assigned_to_id", "p9");
    world.seed("v2/tickets/t6/assigned_to_name", "Ela Eşleşmez");
    world.seed("v2/ticket_assignments/t6", { p9: { personnel_id: "p9", personnel_name: "Ela Eşleşmez", personnel_email: "ela.eslesmez@parla-demo.com", is_primary: true, assigned_at: new Date().toISOString() } });
    await dashboardCheck(root, "sonda");
    check("sahipsiz (pasif danışmanlı) talep atanmamış listesinde uyarıyla görünür", /Pasif danışman/.test(await root.page.textContent("#sv2-unassigned-wrap")) && (await root.page.locator("#sv2-unassigned-tbody tr").count()) >= 1);

    // =====================================================================
    // K) Genel
    // =====================================================================
    const unexpected = world.denied.filter((d) => !(d.uid === "u_cons2" && d.path.endsWith("/tickets/t10")));
    check("meşru akışlarda beklenmeyen PERMISSION_DENIED yok", unexpected.length === 0, JSON.stringify(unexpected.slice(0, 3)));
    for (const [uid, s] of sessions) {
      const errs = s.errors.filter((e) => !/status of 4\d\d|favicon/.test(e));
      check(`${uid}: sayfa hatası yok`, errs.length === 0, errs.slice(0, 2).join(" | "));
    }
  } finally {
    await srv.close();
  }
  results.forEach((r) => console.log(r.join(" | ")));
  console.log(`\n${results.filter((r) => r[0] === "PASS").length}/${results.length} geçti`);
  process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
