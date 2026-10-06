/**
 * Yetki matrisi işlemleri: her işlem tüm aktörler (helpers.ACTORS) için çalıştırılır.
 * Denetçi A'nın "150 işlem × 16 aktör" matrisinin kalıcı karşılığı (17 aktör: ek olarak atanmamış danışman).
 * Beklenen sonuç tablosu matrix.test.js içindeki EXPECT nesnesindedir.
 *
 * Her işlem GERÇEKÇİ ve GEÇERLİ bir yük gönderir; böylece reddin nedeni "yük bozuk" değil "yetki/kural" olur.
 */
const H = require("./helpers.js");
const { ISO, T0, D, isoAt, att, newTicketPayload, message, historyEntry, effort, activity } = H;

const OPS = [];
const op = (id, group, name, fn) => OPS.push({ id, group, name, fn });
// a: auth nesnesi (token.email dahil) ya da null; uid: a ? a.uid : "x"
const uidOf = (a) => (a ? a.uid : "x");
const R = (p, opts) => (d, a) => d.as(a).read(p, opts);
const W = (p, val) => (d, a) => d.as(a).write(p, typeof val === "function" ? val(a) : val);
const U = (p, val) => (d, a) => d.as(a).update(p, typeof val === "function" ? val(a) : val);
const q = (orderByChild, equalTo, extra) => ({ query: Object.assign({ orderByChild, equalTo }, extra || {}) });
const roleLabel = (a) => (a ? H.roleOf(a.uid) : "");
const big = (n) => "A".repeat(n);

// ================================================================= OKUMA
op("R01", "read", "users/<self> (getUserProfile)", (d, a) => d.as(a).read(`/v2/users/${uidOf(a)}`));
op("R02", "read", "users/u_root (başkasının profili)", R("/v2/users/u_root"));
op("R03", "read", "users/u_cust (u_cust kendi profilini okur; başkaları okuyamaz)", R("/v2/users/u_cust"));
op("R04", "read", "users (liste, getAllUsers)", R("/v2/users"));
op("R05", "read", "companies (liste)", R("/v2/companies"));
op("R06", "read", "companies/cA", R("/v2/companies/cA"));
op("R07", "read", "companies/cB", R("/v2/companies/cB"));
op("R08", "read", "personnel (liste)", R("/v2/personnel"));
op("R09", "read", "contracts (liste; bedel içermez)", R("/v2/contracts"));
op("R10", "read", "contract_values/k1/value (sözleşme bedeli)", R("/v2/contract_values/k1/value"));
op("R45", "read", "contract_values (liste)", R("/v2/contract_values"));
op("R11", "read", "projects (liste)", R("/v2/projects"));
op("R12", "read", "departments (liste)", R("/v2/departments"));
op("R13", "read", "sap_modules (liste)", R("/v2/sap_modules"));
op("R14", "read", "support_types (liste)", R("/v2/support_types"));
op("R15", "read", "reply_templates (liste)", R("/v2/reply_templates"));
op("R16", "read", "tickets (tümü, getAllTickets)", R("/v2/tickets"));
op("R17", "read", "tickets by user_id=<self>", (d, a) => d.as(a).read("/v2/tickets", q("user_id", uidOf(a))));
op("R18", "read", "tickets by user_id=u_cust (yalnız u_cust kendi sorgusu; diğerleri başkasınınkini sorgular)", R("/v2/tickets", q("user_id", "u_cust")));
op("R19", "read", "tickets by company_id=cA", R("/v2/tickets", q("company_id", "cA")));
op("R20", "read", "tickets by company_id=cB", R("/v2/tickets", q("company_id", "cB")));
op("R21", "read", "tickets by company_id='' (arızi havuzu)", R("/v2/tickets", q("company_id", "")));
op("R22", "read", "tickets by assigned_to_id=p1", R("/v2/tickets", q("assigned_to_id", "p1")));
op("R23", "read", "tickets updated_at+limitToLast(80) (zil)", R("/v2/tickets", { query: { orderByChild: "updated_at", limitToLast: 80 } }));
op("R24", "read", "tickets/t1 (u_cust'un talebi)", R("/v2/tickets/t1"));
op("R25", "read", "tickets/t9 (u_cust2'nin talebi, aynı firma)", R("/v2/tickets/t9"));
op("R26", "read", "tickets/t10 (cB talebi)", R("/v2/tickets/t10"));
op("R27", "read", "tickets/t11 (arızi talebi)", R("/v2/tickets/t11"));
op("R28", "read", "ticket_messages/t1", R("/v2/ticket_messages/t1"));
op("R29", "read", "ticket_messages/t10", R("/v2/ticket_messages/t10"));
op("R30", "read", "ticket_internal_notes/t1", R("/v2/ticket_internal_notes/t1"));
op("R31", "read", "ticket_attachments/t1/a1", R("/v2/ticket_attachments/t1/a1"));
op("R32", "read", "ticket_attachments/t1 (liste)", R("/v2/ticket_attachments/t1"));
op("R33", "read", "ticket_internal_attachments/t1/i1", R("/v2/ticket_internal_attachments/t1/i1"));
op("R34", "read", "ticket_history/t1", R("/v2/ticket_history/t1"));
op("R35", "read", "ticket_assignments/t1", R("/v2/ticket_assignments/t1"));
op("R36", "read", "ticket_assignments (tümü)", R("/v2/ticket_assignments"));
op("R37", "read", "ticket_efforts/t1", R("/v2/ticket_efforts/t1"));
op("R38", "read", "ticket_efforts (tümü)", R("/v2/ticket_efforts"));
op("R39", "read", "activities (liste)", R("/v2/activities"));
op("R40", "read", "counters (tümü)", R("/v2/counters"));
op("R41", "read", "notifications/u_cust", R("/v2/notifications/u_cust"));
op("R42", "read", "system_state", R("/v2/system_state"));
op("R43", "read", "ops", R("/v2/ops"));
op("R44", "read", "kök /", R("/"));

// ================================================================= YAZMA: users
const selfPath = (a, suffix) => `/v2/users/${uidOf(a)}${suffix || ""}`;
op("U01", "write-users", "users/<self> tam profil yaz (role=super_admin)", (d, a) => d.as(a).write(selfPath(a), { role: "super_admin", is_active: true, email: "x@x.com" }));
op("U02", "write-users", "users/<self> {last_login_at, updated_at} (girişte)", (d, a) => d.as(a).update(selfPath(a), { last_login_at: ISO, updated_at: ISO }));
op("U03", "write-users", "users/<self>/must_change_password=false", (d, a) => d.as(a).write(selfPath(a, "/must_change_password"), false));
op("U04", "write-users", "users/<self>/must_change_password=true", (d, a) => d.as(a).write(selfPath(a, "/must_change_password"), true));
op("U05", "write-users", "users/<self>/is_active=true (kendini aktifleştir)", (d, a) => d.as(a).write(selfPath(a, "/is_active"), true));
op("U06", "write-users", "users/<self>/role=super_admin", (d, a) => d.as(a).write(selfPath(a, "/role"), "super_admin"));
op("U07", "write-users", "users/<self>/company_id=cB", (d, a) => d.as(a).write(selfPath(a, "/company_id"), "cB"));
op("U08", "write-users", "users/<self>/last_login_at = 5MB dize", (d, a) => d.as(a).write(selfPath(a, "/last_login_at"), big(5 * 1024 * 1024)));
op("U09", "write-users", "users/<self> {is_active:false} (kendini pasifleştir)", (d, a) => d.as(a).update(selfPath(a), { is_active: false }));
op("U10", "write-users", "users/new_x yeni müşteri profili", W("/v2/users/new_x", { role: "customer", company_id: "cA", is_active: true, email: "n@x.com" }));
op("U11", "write-users", "users/new_x yeni super_admin profili", W("/v2/users/new_x", { role: "super_admin", is_active: true, email: "n@x.com" }));
op("U12", "write-users", "users/new_x yeni service_admin profili", W("/v2/users/new_x", { role: "service_admin", is_active: true, email: "n@x.com" }));
op("U13", "write-users", "users/u_root {is_active:false} (super_admin'i pasifleştir)", U("/v2/users/u_root", { is_active: false }));
op("U14", "write-users", "users/u_root {role:'customer'} (super_admin'i düşür)", U("/v2/users/u_root", { role: "customer" }));
op("U15", "write-users", "users/u_root = null (super_admin profilini sil)", W("/v2/users/u_root", null));
op("U16", "write-users", "users/u_root {email} (super_admin e-postası)", U("/v2/users/u_root", { email: "x@evil.com" }));
op("U17", "write-users", "users/u_cust {role:'service_admin'}", U("/v2/users/u_cust", { role: "service_admin" }));
op("U18", "write-users", "users/u_cust {company_id:'cB'}", U("/v2/users/u_cust", { company_id: "cB" }));
op("U19", "write-users", "users/u_cust {is_active:false}", U("/v2/users/u_cust", { is_active: false }));
op("U20", "write-users", "users/u_cons {role:'project_manager'} (yönetici rol verme)", U("/v2/users/u_cons", { role: "project_manager" }));

// ================================================================= YAZMA: tickets
const create = (over, uidFn) => (d, a) => d.as(a).write("/v2/tickets/n1", newTicketPayload(uidFn ? uidFn(a) : uidOf(a), over));
op("T01", "write-tickets", "tickets/n1 oluştur (müşteri normal; kendi firması)", (d, a) => {
  // her aktör kendi firması/kodu/e-postasıyla gönderir; arızi kendi türüyle (ARZ)
  const arizi = roleLabel(a) === "arizi_customer";
  return d.as(a).write("/v2/tickets/n1", newTicketPayload(uidOf(a), arizi ? { ticket_type: "ARZ", ticket_number: "ARZ-ARZ0001-FI-2610-0099" } : {}));
});
op("T02", "write-tickets", "tickets/n1 oluştur SUP (kendi firması; arızi için tür kilidi)", create({}));
op("T03", "write-tickets", "tickets/n1 oluştur ARZ (sözleşmeli müşteri için tür kilidi)", create({ ticket_type: "ARZ", ticket_number: "ARZ-ORN-FI-2610-0099" }));
op("T04", "write-tickets", "tickets/n1 oluştur INT (iç görev; müşteri açamaz)", create({ ticket_type: "INT", ticket_number: "INT-ORN-FI-2610-0099" }));
op("T05", "write-tickets", "tickets/n1 oluştur company_id ALANI YOK", (d, a) => {
  const t = newTicketPayload(uidOf(a));
  delete t.company_id;
  return d.as(a).write("/v2/tickets/n1", t);
});
op("T06", "write-tickets", "tickets/n1 oluştur başka firma (cB)", create({ company_id: "cB" }));
op("T07", "write-tickets", "tickets/n1 oluştur başka kullanıcı adına", create({ user_id: "u_cust2", created_by: "u_cust2" }));
op("T08", "write-tickets", "tickets/n1 oluştur status=closed", create({ status: "closed" }));
op("T09", "write-tickets", "tickets/n1 oluştur assigned_to_id=p1", create({ assigned_to_id: "p1" }));
op("T10", "write-tickets", "tickets/n1 oluştur user_email=başkası (e-posta taklidi)", create({ user_email: "kurban@baska.com" }));
op("T11", "write-tickets", "tickets/n1 oluştur priority=XSS dizesi", create({ priority: '"><img src=x onerror=alert(1)>' }));
op("T12", "write-tickets", "tickets/n1 oluştur first_response_at/resolved_at/is_approved (SLA sahteciliği)", create({ first_response_at: ISO, resolved_at: ISO, is_approved: true }));
op("T13", "write-tickets", "tickets/n1 oluştur created_at=2000 (geçmiş tarih)", create({ created_at: "2000-01-01T00:00:00Z" }));
op("T14", "write-tickets", "tickets/n1 oluştur total_work_hours=999 / assigned_to_name", create({ total_work_hours: 999, assigned_to_name: "Zeynep Arslan" }));
op("T15", "write-tickets", "tickets/n1 oluştur id alanı (confused deputy)", create({ id: "t10" }));
op("T16", "write-tickets", "tickets/n1 oluştur ticket_id≠anahtar", create({ ticket_id: "t10" }));
op("T17", "write-tickets", "tickets/n1 oluştur 3MB title", create({ title: big(3 * 1024 * 1024) }));
op("T18", "write-tickets", "tickets/n1 oluştur description 10001 karakter", create({ description: big(10001) }));
op("T19", "write-tickets", "tickets/n1 oluştur ekstra düğüm (junk 3MB)", create({ junk: { a: big(3 * 1024 * 1024) } }));
op("T20", "write-tickets", "tickets/n1 oluştur ticket_number biçimsiz", create({ ticket_number: "<script>alert(1)</script>" }));
op("T21", "write-tickets", "tickets/n1 oluştur attachment_url=javascript:", create({ attachment_url: "javascript:alert(1)" }));
op("T22", "write-tickets", "tickets/n1 oluştur assigned_uids kendine (danışman yetkisi talebi)", create({ assigned_uids: { x: true } }));
op("T23", "write-tickets", "tickets/n1 oluştur is_deleted=true", create({ is_deleted: true }));
op("T24", "write-tickets", "tickets/t14 üzerine (silinmiş anahtar) oluştur", (d, a) => d.as(a).write("/v2/tickets/t14", newTicketPayload(uidOf(a), { ticket_id: "t14" })));
op("T25", "write-tickets", "tickets/t1/priority='low' (sahibi)", W("/v2/tickets/t1/priority", "low"));
op("T26", "write-tickets", "tickets/t1/assigned_to_id='p9'", W("/v2/tickets/t1/assigned_to_id", "p9"));
op("T27", "write-tickets", "tickets/t1/title", W("/v2/tickets/t1/title", "yeni başlık"));
op("T28", "write-tickets", "tickets/t1/first_response_at", W("/v2/tickets/t1/first_response_at", ISO));
op("T29", "write-tickets", "tickets/t1/updated_at (geçerli ISO)", W("/v2/tickets/t1/updated_at", ISO));
op("T30", "write-tickets", "tickets/t1/updated_at='9999' (sıralama kurcalama)", W("/v2/tickets/t1/updated_at", "9999"));
op("T31", "write-tickets", "tickets/t1/updated_by = 3MB", W("/v2/tickets/t1/updated_by", big(3 * 1024 * 1024)));
op("T32", "write-tickets", "tickets/t9/updated_at (aynı firma, farklı kullanıcı)", W("/v2/tickets/t9/updated_at", ISO));
op("T33", "write-tickets", "tickets/t3 müşteri bekleniyor→işlemde", U("/v2/tickets/t3", { status: "in_progress", updated_at: ISO, updated_by: "x", public_updated_at: ISO, public_updated_by: "x" }));
op("T34", "write-tickets", "tickets/t4 kapanış onayı (status=closed, closed_at, closed_at_ms)", U("/v2/tickets/t4", { status: "closed", closed_at: ISO, closed_at_ms: T0, updated_at: ISO }));
op("T35", "write-tickets", "tickets/t5 yeniden aç (10 gün önce kapanmış)", U("/v2/tickets/t5", { status: "reopened", reopened_at: ISO, closed_at: null, closed_at_ms: null, updated_at: ISO }));
op("T36", "write-tickets", "tickets/t12 yeniden aç (40 gün önce kapanmış)", U("/v2/tickets/t12", { status: "reopened", reopened_at: ISO, closed_at: null, closed_at_ms: null, updated_at: ISO }));
op("T37", "write-tickets", "tickets/t13 yeniden aç (closed_at_ms yok: eski kayıt)", U("/v2/tickets/t13", { status: "reopened", reopened_at: ISO, closed_at: null, updated_at: ISO }));
op("T38", "write-tickets", "tickets/t7 yeniden aç (çözüldü → reopened)", U("/v2/tickets/t7", { status: "reopened", reopened_at: ISO, updated_at: ISO }));
op("T39", "write-tickets", "tickets/t1 {status:pending_close,...} (işlemde → onay iste)", U("/v2/tickets/t1", { status: "pending_close", updated_at: ISO, updated_by: "x", public_updated_at: ISO, public_updated_by: "x" }));
op("T40", "write-tickets", "tickets/t2 {status:in_progress,priority:low,assigned_to_id} (atanmamış talebi güncelle)", U("/v2/tickets/t2", { status: "in_progress", priority: "low", assigned_to_id: "p1" }));
op("T41", "write-tickets", "tickets/t10 {priority:'low'} (başka firmaya)", U("/v2/tickets/t10", { priority: "low" }));
op("T42", "write-tickets", "tickets/t2 = null (tamamen sil, cascade)", W("/v2/tickets/t2", null));
op("T43", "write-tickets", "tickets/t2 yumuşak sil (is_deleted, deleted_at, deleted_by)", (d, a) => d.as(a).update("/v2/tickets/t2", { is_deleted: true, deleted_at: ISO, deleted_by: uidOf(a) }));
op("T44", "write-tickets", "tickets/t14 geri yükle (is_deleted=null)", U("/v2/tickets/t14", { is_deleted: null, deleted_at: null, deleted_by: null }));
op("T45", "write-tickets", "tickets/t2/is_approved=true (ONAY kutusu)", W("/v2/tickets/t2/is_approved", true));
op("T46", "write-tickets", "tickets/t1/is_approved=true (atanmış talep)", W("/v2/tickets/t1/is_approved", true));
op("T47", "write-tickets", "tickets/t1/ticket_number değiştir", W("/v2/tickets/t1/ticket_number", "SUP-ORN-FI-2610-0001"));
op("T48", "write-tickets", "tickets/t2/assigned_uids/<self>=true (kendini ata)", (d, a) => d.as(a).write(`/v2/tickets/t2/assigned_uids/${uidOf(a)}`, true));
op("T49", "write-tickets", "tickets/t2/assigned_uids/u_cons=true (yönetici atar)", W("/v2/tickets/t2/assigned_uids/u_cons", true));
op("T50", "write-tickets", "tickets/t1/id='t10' (id alanı ezme)", W("/v2/tickets/t1/id", "t10"));
op("T51", "write-tickets", "tickets/t1/status='closed' (müşteri keyfi kapatma)", W("/v2/tickets/t1/status", "closed"));
op("T52", "write-tickets", "tickets/t1/sla_response_breached_at (SLA damgası)", W("/v2/tickets/t1/sla_response_breached_at", ISO));
op("T55", "write-tickets", "tickets/t3 müşteri yanıtı: işlemde + sla_paused_since=null + sla_paused_ms artar (duraklamayı bitir)", U("/v2/tickets/t3", { status: "in_progress", sla_paused_since: null, sla_paused_ms: 90000000, updated_at: ISO }));
op("T56", "write-tickets", "tickets/t3/sla_paused_ms = 0 (duraklama süresini azalt/sıfırla)", W("/v2/tickets/t3/sla_paused_ms", 0));
op("T57", "write-tickets", "tickets/t1/sla_window = şimdi (yeniden açma dışında yeni SLA penceresi)", W("/v2/tickets/t1/sla_window", ISO));
op("T58", "write-tickets", "tickets/t3/sla_response_breached_at silme (ihlal damgasını temizle)", W("/v2/tickets/t3/sla_response_breached_at", null));
op("T59", "write-tickets", "tickets/t5 yeniden aç + sla_window/sla_resolution_breached_at (yeni pencere)", U("/v2/tickets/t5", { status: "reopened", reopened_at: ISO, closed_at: null, closed_at_ms: null, sla_window: ISO, sla_resolution_breached_at: null, updated_at: ISO }));
op("T53", "write-tickets", "tickets/t1/started_at (işleme alma damgası)", W("/v2/tickets/t1/started_at", ISO));
op("T54", "write-tickets", "tickets/t1/total_work_hours (efor toplamı)", W("/v2/tickets/t1/total_work_hours", 4.5));

// ================================================================= YAZMA: mesajlar / notlar
const msg = (a, over) => message(uidOf(a), "mz", over);
op("M01", "write-msg", "ticket_messages/t1/mz (t1'e mesaj; açık talep, danışman atanmış)", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a)));
op("M02", "write-msg", "ticket_messages/t2/mz (t2'ye mesaj; atanmamış talep)", (d, a) => d.as(a).write("/v2/ticket_messages/t2/mz", msg(a)));
op("M03", "write-msg", "ticket_messages/t10/mz (cB firmasının talebine)", (d, a) => d.as(a).write("/v2/ticket_messages/t10/mz", msg(a)));
op("M04", "write-msg", "ticket_messages/t5/mz (kapalı talebe)", (d, a) => d.as(a).write("/v2/ticket_messages/t5/mz", msg(a)));
op("M05", "write-msg", "ticket_messages/t4/mz (kapanış onayı bekleyen talebe)", (d, a) => d.as(a).write("/v2/ticket_messages/t4/mz", msg(a)));
op("M06", "write-msg", "ticket_messages/t14/mz (silinmiş talebe)", (d, a) => d.as(a).write("/v2/ticket_messages/t14/mz", msg(a)));
op("M07", "write-msg", "ticket_messages/t1/mz user_id=u_cons (taklit; yalnız u_cons için kendi uid'i)", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { user_id: "u_cons" })));
op("M08", "write-msg", "ticket_messages/t1/mz author_role='super_admin' (rol taklidi; yalnız root için kendi rolü)", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { author_role: "super_admin" })));
op("M09", "write-msg", "ticket_messages/t1/mz author_role=CSS sınıfı enjeksiyonu", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { author_role: "sv2-modal-overlay is-open" })));
op("M10", "write-msg", "ticket_messages/t1/mz author_email=başkası", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { author_email: "murat@parla-demo.com" })));
op("M11", "write-msg", "ticket_messages/t1/mz message_id=m2 (kimlik çakışması)", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { message_id: "m2" })));
op("M12", "write-msg", "ticket_messages/t1/mz is_internal=true", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { is_internal: true })));
op("M13", "write-msg", "ticket_messages/t1/mz message 10001 karakter", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { message: big(10001) })));
op("M14", "write-msg", "ticket_messages/t1/mz work_hours=XSS + ekstra 3MB alan", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { work_hours: "<img src=x onerror=alert(1)>", big: big(3 * 1024 * 1024) })));
op("M15", "write-msg", "ticket_messages/t1/mz work_hours=2 (efor saati)", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { work_hours: 2 })));
op("M16", "write-msg", "ticket_messages/t1/mz 4 ek referansı", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { attachments: [0, 1, 2, 3].map((i) => ({ id: "a" + i, name: "x.png", type: "image/png", size: 10 })) })));
op("M17", "write-msg", "ticket_messages/t1/mz 2 ek referansı", (d, a) => d.as(a).write("/v2/ticket_messages/t1/mz", msg(a, { attachments: [0, 1].map((i) => ({ id: "a" + i, name: "x.png", type: "image/png", size: 10 })) })));
op("M18", "write-msg", "ticket_messages/t1/m1/message düzenle", W("/v2/ticket_messages/t1/m1/message", "değişti"));
op("M19", "write-msg", "ticket_messages/t1/m1 = null (mesaj sil)", W("/v2/ticket_messages/t1/m1", null));
op("M20", "write-msg", "ticket_messages/t1 = null (konu sil)", W("/v2/ticket_messages/t1", null));
op("N01", "write-msg", "ticket_internal_notes/t1/nz (atanmış talebe iç not)", (d, a) => d.as(a).write("/v2/ticket_internal_notes/t1/nz", message(uidOf(a), "nz", { is_internal: true })));
op("N02", "write-msg", "ticket_internal_notes/t2/nz (atanmamış talebe iç not)", (d, a) => d.as(a).write("/v2/ticket_internal_notes/t2/nz", message(uidOf(a), "nz", { is_internal: true })));
op("N03", "write-msg", "ticket_internal_notes/t1/nz work_hours=XSS (staff→staff XSS)", (d, a) => d.as(a).write("/v2/ticket_internal_notes/t1/nz", message(uidOf(a), "nz", { is_internal: true, work_hours: "<b>x</b>" })));
op("N04", "write-msg", "ticket_internal_notes/t1/nz message_id≠anahtar", (d, a) => d.as(a).write("/v2/ticket_internal_notes/t1/nz", message(uidOf(a), "baska", { is_internal: true })));
op("N05", "write-msg", "ticket_internal_notes/t1/n0 = null (iç not sil)", W("/v2/ticket_internal_notes/t1/n0", null));

// ================================================================= YAZMA: ekler
const A = (a, over) => att(uidOf(a), Object.assign({ att_id: "az" }, over || {}));
op("A01", "write-att", "ticket_attachments/t1/az (açık talebe, normal PNG)", (d, a) => d.as(a).write("/v2/ticket_attachments/t1/az", A(a)));
op("A02", "write-att", "ticket_attachments/t2/az (atanmamış talebe)", (d, a) => d.as(a).write("/v2/ticket_attachments/t2/az", A(a)));
op("A03", "write-att", "ticket_attachments/t10/az (başka firma)", (d, a) => d.as(a).write("/v2/ticket_attachments/t10/az", A(a)));
op("A04", "write-att", "ticket_attachments/t5/az (kapalı talebe)", (d, a) => d.as(a).write("/v2/ticket_attachments/t5/az", A(a)));
op("A05", "write-att", "ticket_attachments/t1/az uploader_uid=u_root (taklit; yalnız root için kendi uid'i)", (d, a) => d.as(a).write("/v2/ticket_attachments/t1/az", A(a, { uploader_uid: "u_root" })));
op("A06", "write-att", "ticket_attachments/t1/az type=image/svg+xml", (d, a) => d.as(a).write("/v2/ticket_attachments/t1/az", A(a, { type: "image/svg+xml", name: "x.svg" })));
op("A07", "write-att", "ticket_attachments/t1/az type=application/vnd.pwg-xhtml-print+xml", (d, a) => d.as(a).write("/v2/ticket_attachments/t1/az", A(a, { type: "application/vnd.pwg-xhtml-print+xml", name: "x.xhtml" })));
op("A08", "write-att", "ticket_attachments/t1/az portable-executable x.exe", (d, a) => d.as(a).write("/v2/ticket_attachments/t1/az", A(a, { type: "application/vnd.microsoft.portable-executable", name: "x.exe" })));
op("A09", "write-att", "ticket_attachments/t1/az data=3.000.000 karakter", (d, a) => d.as(a).write("/v2/ticket_attachments/t1/az", A(a, { data: big(3000000), size: 2200000 })));
op("A10", "write-att", "ticket_attachments/t1/az data HTML / size yalan", (d, a) => d.as(a).write("/v2/ticket_attachments/t1/az", A(a, { data: "<html><script>alert(1)</script>", size: 1 })));
op("A11", "write-att", "ticket_attachments/t1/az ekstra alan 3MB", (d, a) => d.as(a).write("/v2/ticket_attachments/t1/az", A(a, { extra: big(3 * 1024 * 1024) })));
op("A12", "write-att", "ticket_attachments/t1/az att_id≠anahtar", (d, a) => d.as(a).write("/v2/ticket_attachments/t1/az", A(a, { att_id: "baska" })));
op("A13", "write-att", "ticket_attachments/t1/az name=rapor.pdf.exe (çift uzantı)", (d, a) => d.as(a).write("/v2/ticket_attachments/t1/az", A(a, { type: "application/pdf", name: "rapor.pdf.exe" })));
op("A14", "write-att", "ticket_internal_attachments/t1/iz (atanmış talebe iç ek)", (d, a) => d.as(a).write("/v2/ticket_internal_attachments/t1/iz", A(a, { att_id: "iz" })));
op("A15", "write-att", "ticket_attachments/t1/a1 = null (ek sil)", W("/v2/ticket_attachments/t1/a1", null));
op("A16", "write-att", "ticket_attachment_stats/t1 {count,bytes} (kota sayacı)", W("/v2/ticket_attachment_stats/t1", { count: 1, bytes: 1000 }));

// ================================================================= YAZMA: geçmiş / atama / efor
const Hh = (a, over) => historyEntry(uidOf(a), "hz", over);
op("H01", "write-hist", "ticket_history/t1/hz (kendi uid'iyle)", (d, a) => d.as(a).write("/v2/ticket_history/t1/hz", Hh(a)));
op("H02", "write-hist", "ticket_history/t1/hz changed_by_uid=u_root (taklit; yalnız root için kendi uid'i)", (d, a) => d.as(a).write("/v2/ticket_history/t1/hz", Hh(a, { changed_by_uid: "u_root" })));
op("H03", "write-hist", "ticket_history/t10/hz (cB firması)", (d, a) => d.as(a).write("/v2/ticket_history/t10/hz", Hh(a)));
op("H04", "write-hist", "ticket_history/t1/hz action=5 (sayı; Geçmiş sekmesini çökertir)", (d, a) => d.as(a).write("/v2/ticket_history/t1/hz", Hh(a, { action: 5, field_changed: 7 })));
op("H05", "write-hist", "ticket_history/t14/hz (silinmiş talep)", (d, a) => d.as(a).write("/v2/ticket_history/t14/hz", Hh(a)));
op("H06", "write-hist", "ticket_history/t1/h1 = null (geçmiş sil)", W("/v2/ticket_history/t1/h1", null));
op("H07", "write-hist", "ticket_history/t1/hz ekstra alan 3MB", (d, a) => d.as(a).write("/v2/ticket_history/t1/hz", Hh(a, { pad: big(3 * 1024 * 1024) })));
op("G01", "write-assign", "ticket_assignments/t1 set (atama yaz)", W("/v2/ticket_assignments/t1", { p1: { personnel_id: "p1", personnel_name: "Z", personnel_email: "z@parla-demo.com", is_primary: true, assigned_at: ISO } }));
op("G02", "write-assign", "ticket_assignments/t1/p9 (ikincil atama ekle)", W("/v2/ticket_assignments/t1/p9", { personnel_id: "p9", personnel_name: "P9", personnel_email: "p9@parla-demo.com", is_primary: false, assigned_at: ISO }));
op("G03", "write-assign", "ticket_assignments/t1/p9 personnel_id≠anahtar", W("/v2/ticket_assignments/t1/p9", { personnel_id: "p8" }));
const E = (a, over) => effort(uidOf(a), "ez", over);
op("E01", "write-effort", "ticket_efforts/t1/ez (atanmış talebe efor)", (d, a) => d.as(a).write("/v2/ticket_efforts/t1/ez", E(a)));
op("E02", "write-effort", "ticket_efforts/t2/ez (atanmamış talebe efor)", (d, a) => d.as(a).write("/v2/ticket_efforts/t2/ez", E(a)));
op("E03", "write-effort", "ticket_efforts/t1/ez created_by_uid=u_root (taklit; yalnız root için kendi uid'i)", (d, a) => d.as(a).write("/v2/ticket_efforts/t1/ez", E(a, { created_by_uid: "u_root" })));
op("E04", "write-effort", "ticket_efforts/t1/ez hours=XSS", (d, a) => d.as(a).write("/v2/ticket_efforts/t1/ez", E(a, { hours: "<img src=x onerror=alert(1)>" })));
op("E05", "write-effort", "ticket_efforts/t1/e1 = null (başkasının/kendi eforunu sil)", W("/v2/ticket_efforts/t1/e1", null));

// ================================================================= YAZMA: activities / counters / notifications
const ACT = (a, over) => activity(uidOf(a), "az", over);
op("C01", "write-misc", "activities/az (normal)", (d, a) => d.as(a).write("/v2/activities/az", ACT(a)));
op("C02", "write-misc", "activities/az user_uid=u_root, action=ticket_deleted (taklit; yalnız root için kendi uid'i)", (d, a) => d.as(a).write("/v2/activities/az", ACT(a, { user_uid: "u_root", user_name: "Murat Aydın", action: "ticket_deleted" })));
op("C03", "write-misc", "activities/az action=123 (sayı; panoyu çökertir)", (d, a) => d.as(a).write("/v2/activities/az", ACT(a, { action: 123, details: 456 })));
op("C04", "write-misc", "activities/az action=ticket_deleted (müşteri türü dışı)", (d, a) => d.as(a).write("/v2/activities/az", ACT(a, { action: "ticket_deleted" })));
op("C05", "write-misc", "activities/az details 1001 karakter", (d, a) => d.as(a).write("/v2/activities/az", ACT(a, { details: big(1001) })));
op("C06", "write-misc", "activities/az ekstra alan 3MB", (d, a) => d.as(a).write("/v2/activities/az", ACT(a, { pad: big(3 * 1024 * 1024) })));
op("C07", "write-misc", "activities/a1 = null (kayıt sil)", W("/v2/activities/a1", null));
op("C08", "write-misc", "activities/a1/action düzenle", W("/v2/activities/a1/action", "x"));
op("C09", "write-misc", "activities = null (toptan sil)", W("/v2/activities", null));
op("K01", "write-counter", "counters/SUP/ORN/2610 = 13 (normal +1)", W("/v2/counters/SUP/ORN/2610", 13));
op("K02", "write-counter", "counters/SUP/ORN/2610 = 1 (sıfırla)", W("/v2/counters/SUP/ORN/2610", 1));
op("K03", "write-counter", "counters/SUP/ORN/2610 = 1.5", W("/v2/counters/SUP/ORN/2610", 1.5));
op("K04", "write-counter", "counters/SUP/ORN/2610 = 99999 (numara atlat)", W("/v2/counters/SUP/ORN/2610", 99999));
op("K05", "write-counter", "counters/SUP/YENI/2610 = 1 (uydurma müşteri kodu)", W("/v2/counters/SUP/YENI/2610", 1));
op("K06", "write-counter", "counters/INT/ORN/2610 = 1 (iç görev sayacı)", W("/v2/counters/INT/ORN/2610", 1));
op("K07", "write-counter", "counters/SUP/DMR/2610 = 11 (başka firmanın sayacı)", W("/v2/counters/SUP/DMR/2610", 11));
op("K08", "write-counter", "counters = null (toptan sil)", W("/v2/counters", null));
op("K09", "write-counter", "counters/SUP/ORN/2610 = 500 (bakım düzeltmesi)", W("/v2/counters/SUP/ORN/2610", 500));
op("K10", "write-counter", "counters/ARZ/ARZ0001/2610 = 2 (arızi müşterinin sayacı)", W("/v2/counters/ARZ/ARZ0001/2610", 2));
op("B01", "write-misc", "notifications/u_cust/nz (bildirim yaz)", W("/v2/notifications/u_cust/nz", { title: "spam" }));
op("B02", "write-misc", "notifications/<self>/nz", (d, a) => d.as(a).write(`/v2/notifications/${uidOf(a)}/nz`, { title: "x" }));
op("B03", "write-misc", "system_state/x (sunucu düğümü)", W("/v2/system_state/x", { a: 1 }));
op("B04", "write-misc", "ops/x (sunucu düğümü)", W("/v2/ops/x", { a: 1 }));

// ================================================================= YAZMA: ana veri
op("D01", "write-master", "companies/cC oluştur", W("/v2/companies/cC", { name: "C", customer_code: "CUS0009" }));
op("D02", "write-master", "companies/cA/name değiştir", W("/v2/companies/cA/name", "Yeni Ad"));
op("D03", "write-master", "personnel/p9 oluştur", W("/v2/personnel/p9", { email: "p9@x.com", first_name: "P" }));
op("D04", "write-master", "contracts/k9 oluştur (bedel içermez)", W("/v2/contracts/k9", { status: "active", company_id: "cA" }));
op("D05", "write-master", "contracts/k9 oluştur (value=1: bedel artık contracts altına yazılamaz)", W("/v2/contracts/k9", { status: "active", value: 1 }));
op("D13", "write-master", "contract_values/k9 yaz (geçerli bedel)", W("/v2/contract_values/k9", { value: 5000, currency: "TRY", updated_at: ISO, updated_by: "x" }));
op("D14", "write-master", "contract_values/k9 yaz (value=XSS dizesi)", W("/v2/contract_values/k9", { value: '"><img src=x onerror=alert(1)>' }));
op("D15", "write-master", "contract_values/k9 yaz (ekstra alan)", W("/v2/contract_values/k9", { value: 1, pad: "x" }));
op("D16", "write-master", "contracts/k1/value = null (eski bedel alanını temizle: göç)", W("/v2/contracts/k1/value", null));
op("D06", "write-master", "projects/pr9 oluştur", W("/v2/projects/pr9", { status: "planning" }));
op("D07", "write-master", "departments/d9 oluştur", W("/v2/departments/d9", { name: "D" }));
op("D08", "write-master", "sap_modules/FI/is_active=false (toggle)", W("/v2/sap_modules/FI/is_active", false));
op("D09", "write-master", "support_types/SUP/is_active=false (toggle)", W("/v2/support_types/SUP/is_active", false));
op("D10", "write-master", "reply_templates/rt2 oluştur (geçerli)", W("/v2/reply_templates/rt2", { template_id: "rt2", title: "Kapanış", body: "Merhaba {musteri_adi}", is_active: true, created_at: ISO }));
op("D11", "write-master", "reply_templates/rt2 gövde 10001 karakter", W("/v2/reply_templates/rt2", { title: "x", body: big(10001) }));
op("D12", "write-master", "reply_templates/rt1 = null (şablon sil)", W("/v2/reply_templates/rt1", null));

// ================================================================= cascade (çok-yollu) silme
const CASCADE = {};
for (const n of ["tickets", "ticket_messages", "ticket_internal_notes", "ticket_attachments", "ticket_internal_attachments", "ticket_history", "ticket_assignments", "ticket_efforts", "ticket_attachment_stats"]) CASCADE[`${n}/t1`] = null;
op("X01", "write-cascade", "v2 çok-yollu update: t1 + 8 bağlı düğüm = null (kalıcı sil)", U("/v2", CASCADE));

/** Tüm işlemleri tüm aktörler için çalıştırır -> { opId: [izinli aktör etiketleri] } */
function computeMatrix(db) {
  const out = {};
  const detail = {};
  for (const o of OPS) {
    out[o.id] = [];
    detail[o.id] = {};
    for (const [label, uid] of H.ACTORS) {
      let r;
      try {
        r = o.fn(db, H.authOf(uid));
      } catch (e) {
        r = { allowed: false, info: "HATA: " + e.message };
      }
      detail[o.id][label] = r;
      if (r.allowed) out[o.id].push(label);
    }
  }
  return { allowed: out, detail };
}

module.exports = { OPS, computeMatrix, CASCADE };
