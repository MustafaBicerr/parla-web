/**
 * Uçtan uca testler ve kılavuz ekran görüntüleri için örnek (demo) veri.
 * Tüm kişi/firma adları ve e-postalar KURGUSALDIR.
 */
const H = 3600 * 1000;
const D = 24 * H;

function buildSeed(now) {
  now = now || Date.now();
  const iso = (offsetMs) => new Date(now - offsetMs).toISOString();

  const users = {
    u_root: { uid: "u_root", role: "super_admin", first_name: "Murat", last_name: "Aydın", email: "murat.aydin@parla-demo.com", phone: "+905301112200", is_active: true, created_at: iso(120 * D), last_login_at: iso(1 * H) },
    u_service: { uid: "u_service", role: "service_admin", first_name: "Mehmet", last_name: "Kaya", email: "mehmet.kaya@parla-demo.com", phone: "+905301112201", is_active: true, created_at: iso(110 * D), last_login_at: iso(3 * H) },
    u_pm: { uid: "u_pm", role: "project_manager", first_name: "Burak", last_name: "Şahin", email: "burak.sahin@parla-demo.com", phone: "+905301112202", is_active: true, created_at: iso(100 * D) },
    u_cons1: { uid: "u_cons1", role: "consultant", first_name: "Zeynep", last_name: "Arslan", email: "zeynep.arslan@parla-demo.com", phone: "+905301112203", is_active: true, created_at: iso(100 * D), last_login_at: iso(2 * H) },
    u_cons2: { uid: "u_cons2", role: "consultant", first_name: "Can", last_name: "Öztürk", email: "can.ozturk@parla-demo.com", phone: "+905301112204", is_active: true, created_at: iso(90 * D) },
    u_cust: { uid: "u_cust", role: "customer", first_name: "Ayşe", last_name: "Demir", email: "ayse.demir@ornekholding.com", phone: "+905321112233", company_id: "cA", company_name: "Örnek Holding A.Ş.", customer_code: "ORN", is_active: true, created_at: iso(60 * D), last_login_at: iso(5 * H) },
    u_cust2: { uid: "u_cust2", role: "customer", first_name: "Kemal", last_name: "Yurt", email: "kemal.yurt@ornekholding.com", phone: "+905321112244", company_id: "cA", company_name: "Örnek Holding A.Ş.", customer_code: "ORN", is_active: true, created_at: iso(55 * D) },
    u_cadmin: { uid: "u_cadmin", role: "company_admin", first_name: "Selin", last_name: "Yıldız", email: "selin.yildiz@ornekholding.com", phone: "+905321112255", company_id: "cA", company_name: "Örnek Holding A.Ş.", customer_code: "ORN", is_active: true, created_at: iso(58 * D) },
    u_custB: { uid: "u_custB", role: "customer", first_name: "Deniz", last_name: "Koç", email: "deniz.koc@demircelik.com", phone: "+905331112266", company_id: "cB", company_name: "Demir Çelik San. A.Ş.", customer_code: "DMR", is_active: true, created_at: iso(40 * D) },
  };

  const companies = {
    cA: { company_id: "cA", name: "Örnek Holding A.Ş.", customer_code: "ORN", customer_type: "CUS", has_contract: true, contract_id: "k1", primary_contact_email: "selin.yildiz@ornekholding.com", phone: "+902121112200", address: "İstanbul", is_active: true, created_at: iso(70 * D) },
    cB: { company_id: "cB", name: "Demir Çelik San. A.Ş.", customer_code: "DMR", customer_type: "CUS", has_contract: true, contract_id: "k2", primary_contact_email: "deniz.koc@demircelik.com", phone: "+903121112200", address: "Ankara", is_active: true, created_at: iso(50 * D) },
  };

  const departments = {
    d1: { department_id: "d1", name: "SAP Danışmanlık", description: "Finans ve lojistik modülleri", is_active: true, created_at: iso(100 * D) },
    d2: { department_id: "d2", name: "SAP Geliştirme", description: "ABAP ve Fiori geliştirme", is_active: true, created_at: iso(100 * D) },
  };

  const personnel = {
    p1: { personnel_id: "p1", first_name: "Zeynep", last_name: "Arslan", email: "zeynep.arslan@parla-demo.com", phone: "+905301112203", department_id: "d1", department_name: "SAP Danışmanlık", role_title: "Kıdemli SAP FI Danışmanı", is_active: true, created_at: iso(100 * D) },
    p2: { personnel_id: "p2", first_name: "Can", last_name: "Öztürk", email: "can.ozturk@parla-demo.com", phone: "+905301112204", department_id: "d2", department_name: "SAP Geliştirme", role_title: "ABAP Geliştirici", is_active: true, created_at: iso(90 * D) },
    p3: { personnel_id: "p3", first_name: "Mehmet", last_name: "Kaya", email: "mehmet.kaya@parla-demo.com", phone: "+905301112201", department_id: "d1", department_name: "SAP Danışmanlık", role_title: "Destek Koordinatörü", is_active: true, created_at: iso(110 * D) },
  };

  const contracts = {
    k1: { contract_id: "k1", contract_number: "SZL-2026-001", company_id: "cA", company_name: "Örnek Holding A.Ş.", type: "yillik", start_date: "2026-01-01", end_date: "2026-12-31", status: "active", notes: "Yıllık SAP destek sözleşmesi", created_at: iso(80 * D) },
    k2: { contract_id: "k2", contract_number: "SZL-2026-007", company_id: "cB", company_name: "Demir Çelik San. A.Ş.", type: "yillik", start_date: "2026-03-01", end_date: "2027-02-28", status: "active", notes: "", created_at: iso(60 * D) },
  };

  const projects = {
    pr1: { project_id: "pr1", project_code: "PRJ-ORN-01", name: "S/4HANA Geçiş Projesi", company_id: "cA", customer_code: "ORN", status: "active", start_date: "2026-05-01", end_date: "2027-03-31", description: "ECC'den S/4HANA'ya geçiş", manager_uid: "u_pm", manager_name: "Burak Şahin", created_at: iso(120 * D) },
  };

  const sap_modules = Object.fromEntries(
    [["FI", "Finansal Muhasebe"], ["CO", "Yönetim Muhasebesi"], ["MM", "Malzeme Yönetimi"], ["SD", "Satış ve Dağıtım"], ["PP", "Üretim Planlama"], ["WM", "Depo Yönetimi"], ["HR", "İnsan Kaynakları"], ["BASIS", "Sistem Yönetimi"], ["ABAP", "Geliştirme"], ["Diğer", "Diğer"]]
      .map(([code, name]) => [code, { code, module_code: code, name, is_active: true, created_at: iso(100 * D) }])
  );
  const support_types = Object.fromEntries(
    [["SUP", "Destek Anlaşmalı Talep", "#0070f2"], ["ARZ", "Arızi Talep", "#c47a00"], ["PRJ", "Proje Taskı", "#0d7d4d"], ["INT", "İç Task", "#6b7280"], ["DEV", "Geliştirme Taskı", "#7c3aed"], ["BUG", "Hata / Problem Kaydı", "#c41e3a"]]
      .map(([code, name, color]) => [code, { code, type_code: code, name, color, is_active: true, created_at: iso(100 * D) }])
  );

  const mk = (id, n, o) => ({
    ticket_id: id,
    ticket_number: `SUP-ORN-${o.module || "FI"}-2610-${String(n).padStart(4, "0")}`,
    ticket_type: o.type || "SUP",
    customer_code: o.code || "ORN",
    company_id: o.company_id || "cA",
    company_name: o.company_name || "Örnek Holding A.Ş.",
    user_id: o.user_id || "u_cust",
    user_name: o.user_name || "Ayşe Demir",
    user_email: o.user_email || "ayse.demir@ornekholding.com",
    title: o.title,
    description: o.description,
    priority: o.priority || "medium",
    sap_module: o.module || "FI",
    status: o.status,
    assigned_to_id: o.assigned || "",
    assigned_to_name: o.assigned_name || "",
    assigned_at: o.assigned ? iso(o.age - 2 * H) : null,
    started_at: o.started ? iso(o.age - 3 * H) : null,
    attachment_url: "",
    total_work_hours: o.hours || 0,
    project_id: "",
    sequence_number: n,
    created_at: iso(o.age),
    created_by: o.user_id || "u_cust",
    updated_at: iso(o.updated != null ? o.updated : o.age),
    updated_by: o.updated_by || o.user_id || "u_cust",
    public_updated_at: iso(o.updated != null ? o.updated : o.age),
    public_updated_by: o.updated_by || o.user_id || "u_cust",
    first_response_at: o.first_response ? iso(o.age - o.first_response) : null,
    resolved_at: o.resolved_at ? iso(o.resolved_at) : null,
    closed_at: o.closed_at ? iso(o.closed_at) : null,
  });
  const clean = (t) => Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null));

  const tickets = {
    t1: clean(mk("t1", 1, { title: "Fatura kesiminde muhasebe kaydı oluşmuyor", description: "SD faturası kesildiğinde FI muhasebe belgesi oluşmuyor. VF01 işleminde 'Muhasebe belgesi oluşturulamadı' uyarısı alıyoruz. Dün akşamdan beri tüm faturalarda aynı durum var.", priority: "critical", module: "SD", status: "in_progress", assigned: "p1", assigned_name: "Zeynep Arslan", started: true, age: 9 * H, updated: 1 * H, updated_by: "u_cons1", first_response: 7 * H, hours: 3.5 })),
    t2: clean(mk("t2", 2, { title: "Yeni satıcı hesabı açılamıyor (XK01)", description: "Yeni tedarikçi tanımlarken XK01 işleminde mutabakat hesabı alanı seçilemiyor.", priority: "high", module: "MM", status: "open", age: 3 * H, updated: 3 * H })),
    t3: clean(mk("t3", 3, { title: "Aylık amortisman çalıştırması hata veriyor", description: "AFAB çalıştırması 'Dönem kapalı' hatası ile duruyor. Dönem kontrolünü yaptık, açık görünüyor.", priority: "high", module: "FI", status: "waiting_customer", assigned: "p1", assigned_name: "Zeynep Arslan", started: true, age: 3 * D, updated: 4 * H, updated_by: "u_cons1", first_response: 2 * H, hours: 2 })),
    t4: clean(mk("t4", 4, { title: "Stok devir hızı raporunda hatalı değerler", description: "MC.9 raporunda geçen ayın stok devir hızı gerçekle uyuşmuyor.", priority: "medium", module: "MM", status: "pending_close", assigned: "p2", assigned_name: "Can Öztürk", started: true, age: 6 * D, updated: 5 * H, updated_by: "u_cons2", first_response: 3 * H, hours: 5, resolved_at: 5 * H })),
    t5: clean(mk("t5", 5, { title: "Kullanıcı yetki rolü güncellemesi", description: "Muhasebe ekibine yeni bir rol eklenmesi gerekiyor.", priority: "low", module: "BASIS", status: "closed", assigned: "p3", assigned_name: "Mehmet Kaya", started: true, age: 14 * D, updated: 10 * D, updated_by: "u_cust", first_response: 4 * H, hours: 1.5, resolved_at: 11 * D, closed_at: 10 * D })),
    t6: clean(mk("t6", 6, { title: "Ödeme programı (F110) bankaya dosya üretmiyor", description: "F110 çalıştırması başarılı görünüyor fakat banka dosyası üretilmiyor.", priority: "high", module: "FI", status: "assigned", assigned: "p1", assigned_name: "Zeynep Arslan", age: 2 * H, updated: 90 * 60 * 1000 })),
    t7: clean(mk("t7", 7, { title: "Fiori uygulamasında kullanıcı menüsü görünmüyor", description: "Yeni kullanıcıların Fiori launchpad ekranında kutucuklar boş geliyor.", priority: "medium", module: "BASIS", status: "reopened", assigned: "p2", assigned_name: "Can Öztürk", started: true, age: 20 * D, updated: 2 * H, updated_by: "u_cust", first_response: 5 * H, hours: 4, resolved_at: 6 * D })),
    t8: clean(mk("t8", 8, { title: "Satış siparişi onay akışı kurgusu", description: "100.000 TL üzeri siparişler için onay akışı kurgulanması talebi.", priority: "medium", module: "SD", status: "resolved", assigned: "p1", assigned_name: "Zeynep Arslan", started: true, age: 9 * D, updated: 1 * D, updated_by: "u_cons1", first_response: 6 * H, hours: 8, resolved_at: 1 * D })),
    t9: clean(mk("t9", 9, { title: "Bütçe raporu CO dönemi seçimi", description: "KSB1 raporunda dönem aralığı seçilemiyor.", priority: "low", module: "CO", status: "in_progress", assigned: "p2", assigned_name: "Can Öztürk", started: true, age: 4 * D, updated: 8 * H, updated_by: "u_cons2", first_response: 5 * H, hours: 1, user_id: "u_cust2", user_name: "Kemal Yurt", user_email: "kemal.yurt@ornekholding.com" })),
    t10: clean(mk("t10", 10, { code: "DMR", company_id: "cB", company_name: "Demir Çelik San. A.Ş.", user_id: "u_custB", user_name: "Deniz Koç", user_email: "deniz.koc@demircelik.com", title: "Üretim siparişi kapatılamıyor", description: "CO88 ile üretim siparişi toplu kapatma hata veriyor.", priority: "high", module: "PP", status: "open", age: 28 * H, updated: 28 * H })),
    t11: clean(mk("t11", 11, { type: "ARZ", title: "Arızi: Sistem erişimi yavaşladı", description: "Sabahtan beri SAP GUI girişleri çok yavaş.", priority: "critical", module: "BASIS", status: "assigned", assigned: "p3", assigned_name: "Mehmet Kaya", age: 1 * H, updated: 40 * 60 * 1000 })),
    t12: clean(mk("t12", 12, { title: "Maliyet merkezi hiyerarşisi güncellemesi", description: "Yeni organizasyon yapısına göre maliyet merkezi gruplarının güncellenmesi.", priority: "medium", module: "CO", status: "closed", assigned: "p1", assigned_name: "Zeynep Arslan", started: true, age: 40 * D, updated: 30 * D, first_response: 3 * H, hours: 6, resolved_at: 31 * D, closed_at: 30 * D })),
  };

  const msg = (id, ticket, o) => ({ message_id: id, user_id: o.uid, author_name: o.name, author_email: o.email, author_role: o.role, message: o.text, is_internal: false, work_hours: o.hours || 0, created_at: iso(o.age) });
  const ticket_messages = {
    t1: {
      m1: msg("m1", "t1", { uid: "u_cons1", name: "Zeynep Arslan", email: "zeynep.arslan@parla-demo.com", role: "consultant", text: "Merhaba Ayşe Hanım, konuyu inceliyorum. FI tarafında hesap belirleme kayıtlarını kontrol ediyorum; mümkünse VF01'de aldığınız hata mesajının ekran görüntüsünü paylaşır mısınız?", age: 7 * H }),
      m2: msg("m2", "t1", { uid: "u_cust", name: "Ayşe Demir", email: "ayse.demir@ornekholding.com", role: "customer", text: "Merhaba, hata mesajı: 'Muhasebe belgesi oluşturulamadı, hesap belirleme eksik (VKOA)'. Tüm satış organizasyonlarında aynı sorun var.", age: 6 * H }),
      m3: msg("m3", "t1", { uid: "u_cons1", name: "Zeynep Arslan", email: "zeynep.arslan@parla-demo.com", role: "consultant", text: "Teşekkürler. VKOA hesap belirleme tablosunda dünkü transport sonrası bir kayıt silinmiş görünüyor. Düzeltmeyi hazırlıyorum, kısa süre içinde test için size döneceğim.", age: 1 * H, hours: 1.5 }),
    },
    t3: {
      m4: msg("m4", "t3", { uid: "u_cons1", name: "Zeynep Arslan", email: "zeynep.arslan@parla-demo.com", role: "consultant", text: "Dönem kontrol değişkenini düzelttim. AFAB'ı test ortamında çalıştırdım; lütfen kendi ortamınızda yeniden deneyip sonucu paylaşır mısınız?", age: 4 * H }),
    },
    t4: {
      m5: msg("m5", "t4", { uid: "u_cons2", name: "Can Öztürk", email: "can.ozturk@parla-demo.com", role: "consultant", text: "Rapordaki hesaplama mantığındaki hatayı düzelttim ve transport'u üretime aldım. Kapanış onayınızı bekliyoruz.", age: 5 * H }),
    },
    t7: {
      m6: msg("m6", "t7", { uid: "u_cust", name: "Ayşe Demir", email: "ayse.demir@ornekholding.com", role: "customer", text: "Yeniden açma gerekçesi: Yeni eklenen iki kullanıcıda kutucuklar yine boş geliyor.", age: 2 * H }),
    },
  };
  const ticket_internal_notes = {
    t1: { n1: { message_id: "n1", user_id: "u_cons1", author_name: "Zeynep Arslan", author_email: "zeynep.arslan@parla-demo.com", author_role: "consultant", message: "Dahili: VKOA kaydı DEV'den PRD'ye taşınırken atlanmış, transport TR-4711 ile düzeltilecek.", is_internal: true, work_hours: 0, created_at: iso(2 * H) } },
  };

  const hist = (id, o) => ({ history_id: id, action: o.action || "status_changed", field_changed: o.field || "status", old_value: o.old || "", new_value: o.new || "", changed_by_uid: o.uid, changed_by_name: o.name, changed_at: iso(o.age), note: o.note || "" });
  const ticket_history = {
    t1: {
      h1: hist("h1", { action: "created", field: "ticket", new: "SUP-ORN-SD-2610-0001", uid: "u_cust", name: "Ayşe Demir", age: 9 * H }),
      h2: hist("h2", { action: "assigned_to_name_changed", field: "assigned_to_name", old: "", new: "Zeynep Arslan", uid: "u_service", name: "Mehmet Kaya", age: 8 * H }),
      h3: hist("h3", { old: "assigned", new: "in_progress", uid: "u_cons1", name: "Zeynep Arslan", age: 7 * H }),
    },
    t4: {
      h4: hist("h4", { old: "in_progress", new: "pending_close", uid: "u_cons2", name: "Can Öztürk", age: 5 * H, action: "status_note", note: "Hesaplama düzeltmesi üretime alındı, kapanış onayı isteniyor." }),
    },
  };
  const ticket_assignments = {
    t1: { p1: { personnel_id: "p1", personnel_name: "Zeynep Arslan", personnel_email: "zeynep.arslan@parla-demo.com", is_primary: true, assigned_at: iso(8 * H) }, p2: { personnel_id: "p2", personnel_name: "Can Öztürk", personnel_email: "can.ozturk@parla-demo.com", is_primary: false, assigned_at: iso(8 * H) } },
    t3: { p1: { personnel_id: "p1", personnel_name: "Zeynep Arslan", personnel_email: "zeynep.arslan@parla-demo.com", is_primary: true, assigned_at: iso(3 * D) } },
    t4: { p2: { personnel_id: "p2", personnel_name: "Can Öztürk", personnel_email: "can.ozturk@parla-demo.com", is_primary: true, assigned_at: iso(6 * D) } },
    t6: { p1: { personnel_id: "p1", personnel_name: "Zeynep Arslan", personnel_email: "zeynep.arslan@parla-demo.com", is_primary: true, assigned_at: iso(2 * H) } },
    t7: { p2: { personnel_id: "p2", personnel_name: "Can Öztürk", personnel_email: "can.ozturk@parla-demo.com", is_primary: true, assigned_at: iso(20 * D) } },
    t8: { p1: { personnel_id: "p1", personnel_name: "Zeynep Arslan", personnel_email: "zeynep.arslan@parla-demo.com", is_primary: true, assigned_at: iso(9 * D) } },
    t9: { p2: { personnel_id: "p2", personnel_name: "Can Öztürk", personnel_email: "can.ozturk@parla-demo.com", is_primary: true, assigned_at: iso(4 * D) } },
    t11: { p3: { personnel_id: "p3", personnel_name: "Mehmet Kaya", personnel_email: "mehmet.kaya@parla-demo.com", is_primary: true, assigned_at: iso(1 * H) } },
  };
  const ticket_efforts = {
    t1: {
      e1: { effort_id: "e1", personnel_id: "p1", personnel_name: "Zeynep Arslan", hours: 2, work_date: new Date(now).toISOString().slice(0, 10), note: "VKOA analizi", created_at: iso(3 * H), created_by_uid: "u_cons1", created_by_name: "Zeynep Arslan" },
      e2: { effort_id: "e2", personnel_id: "p1", personnel_name: "Zeynep Arslan", hours: 1.5, work_date: new Date(now).toISOString().slice(0, 10), note: "Mesaj: düzeltme hazırlığı", created_at: iso(1 * H), created_by_uid: "u_cons1", created_by_name: "Zeynep Arslan" },
    },
  };
  const activities = {
    a1: { activity_id: "a1", action: "ticket_created", entity_type: "ticket", entity_id: "t2", entity_label: "SUP-ORN-MM-2610-0002", user_uid: "u_cust", user_name: "Ayşe Demir", details: "Yeni satıcı hesabı açılamıyor (XK01)", created_at: iso(3 * H) },
    a2: { activity_id: "a2", action: "ticket_message", entity_type: "ticket", entity_id: "t1", entity_label: "SUP-ORN-SD-2610-0001", user_uid: "u_cons1", user_name: "Zeynep Arslan", details: "Yeni yanıt", created_at: iso(1 * H) },
    a3: { activity_id: "a3", action: "ticket_assigned", entity_type: "ticket", entity_id: "t6", entity_label: "SUP-ORN-FI-2610-0006", user_uid: "u_service", user_name: "Mehmet Kaya", details: "Zeynep Arslan atandı", created_at: iso(2 * H) },
  };
  const counters = { SUP: { ORN: { "2610": 12 }, DMR: { "2610": 10 } }, ARZ: { ORN: { "2610": 11 } } };

  return { v2: { users, companies, departments, personnel, contracts, projects, sap_modules, support_types, tickets, ticket_messages, ticket_internal_notes, ticket_history, ticket_assignments, ticket_efforts, activities, counters, notifications: {} } };
}

module.exports = { buildSeed };
