/**
 * Yetki matrisi + "reddedilmeli" probe testleri (WP-03; denetim A, SEC-01…SEC-40 ve diğer alan raporları).
 * Çalıştırma: cd tests/rules && npm test   (RULES_FILE=... ile başka kural dosyası denenebilir)
 *
 * 1) MATRİS: matrix-ops.js içindeki her işlem 17 aktör için çalıştırılır; beklenen sonuç aşağıdaki EXPECT
 *    tablosunda AÇIKÇA yazılıdır (işlem kimliği -> izin verilen aktörler). Bir kuralı değiştirdiğinizde bu tablo
 *    bilinçli olarak güncellenmelidir; test, beklenmeyen her hücre farkını (açılan ya da kapanan) raporlar.
 *    Aktörler: anon (oturumsuz), noprofile (Auth hesabı var, profil yok), root=super_admin, service=service_admin,
 *    pm=project_manager, cons=ATANMIŞ danışman (t1/t3/t4/t6), cons2=hiçbir talebe atanmamış danışman,
 *    cust/cust2/cadmin (firma A), custB (firma B), arizi (arızi müşteri), new (zorunlu şifre değişimi),
 *    inactCons/inactCust/inactSvc (is_active=false), nocomp (company_id alanı yok).
 * 2) DEĞİŞMEZLER: oturumsuz/profilsiz/pasif hesap yazamaz; müşteri iç veriye erişemez vb. (tüm işlemler üzerinde).
 * 3) PROBE'LAR: her .validate için "reddedilmeli" testleri; her probe önce GEÇERLİ kontrol yükünü doğrular.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers.js");
const { buildRules, constants } = require("./generate-rules.js");
const { OPS, computeMatrix } = require("./matrix-ops.js");
const { ISO, T0, D, isoAt, att, newTicketPayload, message, historyEntry, effort, activity } = H;

// Beklenen sonuç tablosu: işlem kimliği -> izin verilen aktörler (boş: kimse). Kaynak: matrix-ops.js
const EXPECT = {

  // ---- read
  R01: "noprofile root service pm cons cons2 cust cust2 cadmin custB arizi new inactCons inactCust inactSvc nocomp", // users/<self> (getUserProfile)
  R02: "root service", // users/u_root (başkasının profili)
  R03: "root service cust", // users/u_cust (u_cust kendi profilini okur; başkaları okuyamaz)
  R04: "root service", // users (liste, getAllUsers)
  R05: "root service pm cons cons2", // companies (liste)
  R06: "root service pm cons cons2 cust cust2 cadmin new", // companies/cA
  R07: "root service pm cons cons2 custB", // companies/cB
  R08: "root service pm cons cons2", // personnel (liste)
  R09: "root service pm cons cons2", // contracts (liste; bedel içermez)
  R10: "root service", // contract_values/k1/value (sözleşme bedeli)
  R45: "root service", // contract_values (liste)
  R11: "root service pm cons cons2", // projects (liste)
  R12: "noprofile root service pm cons cons2 cust cust2 cadmin custB arizi new inactCons inactCust inactSvc nocomp", // departments (liste)
  R13: "noprofile root service pm cons cons2 cust cust2 cadmin custB arizi new inactCons inactCust inactSvc nocomp", // sap_modules (liste)
  R14: "noprofile root service pm cons cons2 cust cust2 cadmin custB arizi new inactCons inactCust inactSvc nocomp", // support_types (liste)
  R15: "root service pm cons cons2", // reply_templates (liste)
  R16: "root service pm cons cons2", // tickets (tümü, getAllTickets)
  R17: "root service pm cons cons2 cust cust2 cadmin custB arizi new nocomp", // tickets by user_id=<self>
  R18: "root service pm cons cons2 cust", // tickets by user_id=u_cust (yalnız u_cust kendi sorgusu; diğerleri başkasınınkini sorgular)
  R19: "root service pm cons cons2 cadmin", // tickets by company_id=cA
  R20: "root service pm cons cons2", // tickets by company_id=cB
  R21: "root service pm cons cons2", // tickets by company_id='' (arızi havuzu)
  R22: "root service pm cons cons2", // tickets by assigned_to_id=p1
  R23: "root service pm cons cons2", // tickets updated_at+limitToLast(80) (zil)
  R24: "root service pm cons cons2 cust cadmin", // tickets/t1 (u_cust'un talebi)
  R25: "root service pm cons cons2 cust2 cadmin", // tickets/t9 (u_cust2'nin talebi, aynı firma)
  R26: "root service pm cons cons2 custB", // tickets/t10 (cB talebi)
  R27: "root service pm cons cons2 arizi", // tickets/t11 (arızi talebi)
  R28: "root service pm cons cons2 cust cadmin", // ticket_messages/t1
  R29: "root service pm cons cons2 custB", // ticket_messages/t10
  R30: "root service pm cons cons2", // ticket_internal_notes/t1
  R31: "root service pm cons cons2 cust cadmin", // ticket_attachments/t1/a1
  R32: "", // ticket_attachments/t1 (liste)
  R33: "root service pm cons cons2", // ticket_internal_attachments/t1/i1
  R34: "root service pm cons cons2 cust cadmin", // ticket_history/t1
  R35: "root service pm cons cons2 cust cadmin", // ticket_assignments/t1
  R36: "root service pm cons cons2", // ticket_assignments (tümü)
  R37: "root service pm cons cons2", // ticket_efforts/t1
  R38: "root service pm cons cons2", // ticket_efforts (tümü)
  R39: "root service pm cons cons2", // activities (liste)
  R40: "root service pm cons cons2 cust cust2 cadmin custB arizi new nocomp", // counters (tümü)
  R41: "", // notifications/u_cust
  R42: "", // system_state
  R43: "", // ops
  R44: "", // kök /

  // ---- write-users
  U01: "root", // users/<self> tam profil yaz (role=super_admin)
  U02: "root service pm cons cons2 cust cust2 cadmin custB arizi new nocomp", // users/<self> {last_login_at, updated_at} (girişte)
  U03: "noprofile root service pm cons cons2 cust cust2 cadmin custB arizi new inactCons inactCust inactSvc nocomp", // users/<self>/must_change_password=false
  U04: "", // users/<self>/must_change_password=true
  U05: "root service", // users/<self>/is_active=true (kendini aktifleştir)
  U06: "root", // users/<self>/role=super_admin
  U07: "", // users/<self>/company_id=cB
  U08: "", // users/<self>/last_login_at = 5MB dize
  U09: "", // users/<self> {is_active:false} (kendini pasifleştir)
  U10: "root service", // users/new_x yeni müşteri profili
  U11: "root", // users/new_x yeni super_admin profili
  U12: "root service", // users/new_x yeni service_admin profili
  U13: "", // users/u_root {is_active:false} (super_admin'i pasifleştir)
  U14: "", // users/u_root {role:'customer'} (super_admin'i düşür)
  U15: "", // users/u_root = null (super_admin profilini sil)
  U16: "root", // users/u_root {email} (super_admin e-postası)
  U17: "root service", // users/u_cust {role:'service_admin'}
  U18: "root service", // users/u_cust {company_id:'cB'}
  U19: "root service", // users/u_cust {is_active:false}
  U20: "root service", // users/u_cons {role:'project_manager'} (yönetici rol verme)

  // ---- write-tickets
  T01: "root service pm cons cons2 cust cust2 cadmin custB arizi new nocomp", // tickets/n1 oluştur (müşteri normal; kendi firması)
  T02: "root service pm cons cons2 cust cust2 cadmin custB new nocomp", // tickets/n1 oluştur SUP (kendi firması; arızi için tür kilidi)
  T03: "root service pm cons cons2 arizi", // tickets/n1 oluştur ARZ (sözleşmeli müşteri için tür kilidi)
  T04: "root service pm cons cons2", // tickets/n1 oluştur INT (iç görev; müşteri açamaz)
  T05: "root service pm cons cons2", // tickets/n1 oluştur company_id ALANI YOK
  T06: "root service pm cons cons2 custB", // tickets/n1 oluştur başka firma (cB)
  T07: "root service pm cons cons2 cust2", // tickets/n1 oluştur başka kullanıcı adına
  T08: "root service pm cons cons2", // tickets/n1 oluştur status=closed
  T09: "root service pm cons cons2", // tickets/n1 oluştur assigned_to_id=p1
  T10: "root service pm cons cons2", // tickets/n1 oluştur user_email=başkası (e-posta taklidi)
  T11: "", // tickets/n1 oluştur priority=XSS dizesi
  T12: "root service pm cons cons2", // tickets/n1 oluştur first_response_at/resolved_at/is_approved (SLA sahteciliği)
  T13: "", // tickets/n1 oluştur created_at=2000 (geçmiş tarih)
  T14: "root service pm cons cons2", // tickets/n1 oluştur total_work_hours=999 / assigned_to_name
  T15: "", // tickets/n1 oluştur id alanı (confused deputy)
  T16: "", // tickets/n1 oluştur ticket_id≠anahtar
  T17: "", // tickets/n1 oluştur 3MB title
  T18: "", // tickets/n1 oluştur description 10001 karakter
  T19: "", // tickets/n1 oluştur ekstra düğüm (junk 3MB)
  T20: "", // tickets/n1 oluştur ticket_number biçimsiz
  T21: "", // tickets/n1 oluştur attachment_url=javascript:
  T22: "root service pm cons cons2", // tickets/n1 oluştur assigned_uids kendine (danışman yetkisi talebi)
  T23: "root service", // tickets/n1 oluştur is_deleted=true
  T24: "root service", // tickets/t14 üzerine (silinmiş anahtar) oluştur
  T25: "root service pm", // tickets/t1/priority='low' (sahibi)
  T26: "root service pm", // tickets/t1/assigned_to_id='p9'
  T27: "root service pm", // tickets/t1/title
  T28: "root service pm cons", // tickets/t1/first_response_at
  T29: "root service pm cons cust cadmin", // tickets/t1/updated_at (geçerli ISO)
  T30: "", // tickets/t1/updated_at='9999' (sıralama kurcalama)
  T31: "", // tickets/t1/updated_by = 3MB
  T32: "root service pm cust2 cadmin", // tickets/t9/updated_at (aynı firma, farklı kullanıcı)
  T33: "root service pm cons cust cadmin", // tickets/t3 müşteri bekleniyor→işlemde
  T34: "root service pm cons cust cadmin", // tickets/t4 kapanış onayı (status=closed, closed_at, closed_at_ms)
  T35: "root service pm cust cadmin", // tickets/t5 yeniden aç (10 gün önce kapanmış)
  T36: "root service pm", // tickets/t12 yeniden aç (40 gün önce kapanmış)
  T37: "root service pm", // tickets/t13 yeniden aç (closed_at_ms yok: eski kayıt)
  T38: "root service pm cust cadmin", // tickets/t7 yeniden aç (çözüldü → reopened)
  T39: "root service pm cons", // tickets/t1 {status:pending_close,...} (işlemde → onay iste)
  T40: "root service pm", // tickets/t2 {status:in_progress,priority:low,assigned_to_id} (atanmamış talebi güncelle)
  T41: "root service pm", // tickets/t10 {priority:'low'} (başka firmaya)
  T42: "root", // tickets/t2 = null (tamamen sil, cascade)
  T43: "root service", // tickets/t2 yumuşak sil (is_deleted, deleted_at, deleted_by)
  T44: "root service", // tickets/t14 geri yükle (is_deleted=null)
  T45: "root service pm", // tickets/t2/is_approved=true (ONAY kutusu)
  T46: "root service pm cons", // tickets/t1/is_approved=true (atanmış talep)
  T47: "root service pm", // tickets/t1/ticket_number değiştir
  T48: "root service pm", // tickets/t2/assigned_uids/<self>=true (kendini ata)
  T49: "root service pm", // tickets/t2/assigned_uids/u_cons=true (yönetici atar)
  T50: "", // tickets/t1/id='t10' (id alanı ezme)
  T51: "root service pm cons", // tickets/t1/status='closed' (müşteri keyfi kapatma)
  T52: "root service pm cons cust cadmin", // tickets/t1/sla_response_breached_at (SLA damgası)
  T55: "root service pm cons cust cadmin", // tickets/t3 müşteri yanıtı: işlemde + sla_paused_since=null + sla_paused_ms artar (duraklamayı bitir)
  T56: "root service pm cons", // tickets/t3/sla_paused_ms = 0 (duraklama süresini azalt/sıfırla)
  T57: "root service pm cons", // tickets/t1/sla_window = şimdi (yeniden açma dışında yeni SLA penceresi)
  T58: "root service pm cons", // tickets/t3/sla_response_breached_at silme (ihlal damgasını temizle)
  T59: "root service pm cust cadmin", // tickets/t5 yeniden aç + sla_window/sla_resolution_breached_at (yeni pencere)
  T53: "root service pm cons", // tickets/t1/started_at (işleme alma damgası)
  T54: "root service pm cons", // tickets/t1/total_work_hours (efor toplamı)

  // ---- write-msg
  M01: "root service pm cons cust cadmin", // ticket_messages/t1/mz (t1'e mesaj; açık talep, danışman atanmış)
  M02: "root service pm cust cadmin", // ticket_messages/t2/mz (t2'ye mesaj; atanmamış talep)
  M03: "root service pm custB", // ticket_messages/t10/mz (cB firmasının talebine)
  M04: "root service pm", // ticket_messages/t5/mz (kapalı talebe)
  M05: "root service pm cons cust cadmin", // ticket_messages/t4/mz (kapanış onayı bekleyen talebe)
  M06: "root service pm", // ticket_messages/t14/mz (silinmiş talebe)
  M07: "cons", // ticket_messages/t1/mz user_id=u_cons (taklit; yalnız u_cons için kendi uid'i)
  M08: "root", // ticket_messages/t1/mz author_role='super_admin' (rol taklidi; yalnız root için kendi rolü)
  M09: "", // ticket_messages/t1/mz author_role=CSS sınıfı enjeksiyonu
  M10: "", // ticket_messages/t1/mz author_email=başkası
  M11: "", // ticket_messages/t1/mz message_id=m2 (kimlik çakışması)
  M12: "", // ticket_messages/t1/mz is_internal=true
  M13: "", // ticket_messages/t1/mz message 10001 karakter
  M14: "", // ticket_messages/t1/mz work_hours=XSS + ekstra 3MB alan
  M15: "root service pm cons", // ticket_messages/t1/mz work_hours=2 (efor saati)
  M16: "", // ticket_messages/t1/mz 4 ek referansı
  M17: "root service pm cons cust cadmin", // ticket_messages/t1/mz 2 ek referansı
  M18: "", // ticket_messages/t1/m1/message düzenle
  M19: "root", // ticket_messages/t1/m1 = null (mesaj sil)
  M20: "root", // ticket_messages/t1 = null (konu sil)
  N01: "root service pm cons", // ticket_internal_notes/t1/nz (atanmış talebe iç not)
  N02: "root service pm", // ticket_internal_notes/t2/nz (atanmamış talebe iç not)
  N03: "", // ticket_internal_notes/t1/nz work_hours=XSS (staff→staff XSS)
  N04: "", // ticket_internal_notes/t1/nz message_id≠anahtar
  N05: "root", // ticket_internal_notes/t1/n0 = null (iç not sil)

  // ---- write-att
  A01: "root service pm cons cust cadmin", // ticket_attachments/t1/az (açık talebe, normal PNG)
  A02: "root service pm cust cadmin", // ticket_attachments/t2/az (atanmamış talebe)
  A03: "root service pm custB", // ticket_attachments/t10/az (başka firma)
  A04: "root service pm", // ticket_attachments/t5/az (kapalı talebe)
  A05: "root", // ticket_attachments/t1/az uploader_uid=u_root (taklit; yalnız root için kendi uid'i)
  A06: "", // ticket_attachments/t1/az type=image/svg+xml
  A07: "", // ticket_attachments/t1/az type=application/vnd.pwg-xhtml-print+xml
  A08: "", // ticket_attachments/t1/az portable-executable x.exe
  A09: "root service pm cons cust cadmin", // ticket_attachments/t1/az data=3.000.000 karakter
  A10: "", // ticket_attachments/t1/az data HTML / size yalan
  A11: "", // ticket_attachments/t1/az ekstra alan 3MB
  A12: "", // ticket_attachments/t1/az att_id≠anahtar
  A13: "", // ticket_attachments/t1/az name=rapor.pdf.exe (çift uzantı)
  A14: "root service pm cons", // ticket_internal_attachments/t1/iz (atanmış talebe iç ek)
  A15: "root", // ticket_attachments/t1/a1 = null (ek sil)
  A16: "root service pm cons cust cadmin", // ticket_attachment_stats/t1 {count,bytes} (kota sayacı)

  // ---- write-hist
  H01: "root service pm cons cust cadmin", // ticket_history/t1/hz (kendi uid'iyle)
  H02: "root", // ticket_history/t1/hz changed_by_uid=u_root (taklit; yalnız root için kendi uid'i)
  H03: "root service pm custB", // ticket_history/t10/hz (cB firması)
  H04: "", // ticket_history/t1/hz action=5 (sayı; Geçmiş sekmesini çökertir)
  H05: "root service pm", // ticket_history/t14/hz (silinmiş talep)
  H06: "root", // ticket_history/t1/h1 = null (geçmiş sil)
  H07: "", // ticket_history/t1/hz ekstra alan 3MB

  // ---- write-assign
  G01: "root service pm", // ticket_assignments/t1 set (atama yaz)
  G02: "root service pm", // ticket_assignments/t1/p9 (ikincil atama ekle)
  G03: "", // ticket_assignments/t1/p9 personnel_id≠anahtar

  // ---- write-effort
  E01: "root service pm cons", // ticket_efforts/t1/ez (atanmış talebe efor)
  E02: "root service pm", // ticket_efforts/t2/ez (atanmamış talebe efor)
  E03: "root", // ticket_efforts/t1/ez created_by_uid=u_root (taklit; yalnız root için kendi uid'i)
  E04: "", // ticket_efforts/t1/ez hours=XSS
  E05: "root service pm cons", // ticket_efforts/t1/e1 = null (başkasının/kendi eforunu sil)

  // ---- write-misc
  C01: "root service pm cons cons2 cust cust2 cadmin custB arizi new nocomp", // activities/az (normal)
  C02: "root", // activities/az user_uid=u_root, action=ticket_deleted (taklit; yalnız root için kendi uid'i)
  C03: "", // activities/az action=123 (sayı; panoyu çökertir)
  C04: "root service pm cons cons2", // activities/az action=ticket_deleted (müşteri türü dışı)
  C05: "", // activities/az details 1001 karakter
  C06: "", // activities/az ekstra alan 3MB
  C07: "", // activities/a1 = null (kayıt sil)
  C08: "", // activities/a1/action düzenle
  C09: "", // activities = null (toptan sil)

  // ---- write-counter
  K01: "root service pm cons cons2 cust cust2 cadmin new", // counters/SUP/ORN/2610 = 13 (normal +1)
  K02: "root service", // counters/SUP/ORN/2610 = 1 (sıfırla)
  K03: "root service", // counters/SUP/ORN/2610 = 1.5
  K04: "root service", // counters/SUP/ORN/2610 = 99999 (numara atlat)
  K05: "root service pm cons cons2", // counters/SUP/YENI/2610 = 1 (uydurma müşteri kodu)
  K06: "root service pm cons cons2", // counters/INT/ORN/2610 = 1 (iç görev sayacı)
  K07: "root service pm cons cons2 custB", // counters/SUP/DMR/2610 = 11 (başka firmanın sayacı)
  K08: "", // counters = null (toptan sil)
  K09: "root service", // counters/SUP/ORN/2610 = 500 (bakım düzeltmesi)
  K10: "root service pm cons cons2 arizi", // counters/ARZ/ARZ0001/2610 = 2 (arızi müşterinin sayacı)

  // ---- write-misc
  B01: "", // notifications/u_cust/nz (bildirim yaz)
  B02: "", // notifications/<self>/nz
  B03: "", // system_state/x (sunucu düğümü)
  B04: "", // ops/x (sunucu düğümü)

  // ---- write-master
  D01: "root service", // companies/cC oluştur
  D02: "root service", // companies/cA/name değiştir
  D03: "root service", // personnel/p9 oluştur
  D04: "root service", // contracts/k9 oluştur (bedel içermez)
  D05: "", // contracts/k9 oluştur (value=1: bedel artık contracts altına yazılamaz)
  D13: "root service", // contract_values/k9 yaz (geçerli bedel)
  D14: "", // contract_values/k9 yaz (value=XSS dizesi)
  D15: "", // contract_values/k9 yaz (ekstra alan)
  D16: "root service", // contracts/k1/value = null (eski bedel alanını temizle: göç)
  D06: "root service pm", // projects/pr9 oluştur
  D07: "root", // departments/d9 oluştur
  D08: "root", // sap_modules/FI/is_active=false (toggle)
  D09: "root", // support_types/SUP/is_active=false (toggle)
  D10: "root service", // reply_templates/rt2 oluştur (geçerli)
  D11: "", // reply_templates/rt2 gövde 10001 karakter
  D12: "root service", // reply_templates/rt1 = null (şablon sil)

  // ---- write-cascade
  X01: "root", // v2 çok-yollu update: t1 + 8 bağlı düğüm = null (kalıcı sil)
};

const ACTOR_LABELS = H.ACTORS.map((a) => a[0]);
const db = H.makeDb();
const matrix = computeMatrix(db);

test(`matris: ${OPS.length} işlem × ${H.ACTORS.length} aktör beklenen tabloyla birebir aynı`, () => {
  const diffs = [];
  for (const o of OPS) {
    assert.ok(o.id in EXPECT, `EXPECT tablosunda ${o.id} (${o.name}) yok`);
    const want = EXPECT[o.id].split(" ").filter(Boolean).sort();
    const got = matrix.allowed[o.id].slice().sort();
    for (const label of want) assert.ok(ACTOR_LABELS.includes(label), `${o.id}: bilinmeyen aktör ${label}`);
    const opened = got.filter((x) => !want.includes(x));
    const closed = want.filter((x) => !got.includes(x));
    if (opened.length || closed.length) diffs.push(`${o.id} ${o.name}\n    BEKLENMEDİK İZİN: ${opened.join(", ") || "-"}   BEKLENMEDİK RED: ${closed.join(", ") || "-"}`);
  }
  for (const id of Object.keys(EXPECT)) assert.ok(OPS.some((o) => o.id === id), `EXPECT'te fazladan işlem: ${id}`);
  assert.deepEqual(diffs, [], `\n${diffs.join("\n")}`);
});

test("matris: en az 150 işlem ve en az 16 aktör (kabul ölçütü)", () => {
  assert.ok(OPS.length >= 150, `işlem sayısı ${OPS.length}`);
  assert.ok(H.ACTORS.length >= 16, `aktör sayısı ${H.ACTORS.length}`);
});

// ------------------------------------------------------------------ değişmezler (tüm işlemler üzerinde)
// Verinin kendisi (referans listeleri) ya da kullanıcının kendi kaydı olan istisnalar:
const AUTH_ONLY_OK = new Set(["R01", "R12", "R13", "R14", "U03"]); // kendi profil okuma, referans verileri, must_change_password=false
test("değişmez: oturumsuz hesap hiçbir işlemi yapamaz", () => {
  for (const o of OPS) assert.ok(!matrix.allowed[o.id].includes("anon"), `anon ${o.id} ${o.name}`);
});
test("değişmez: profilsiz ve pasif hesaplar yalnızca istisna işlemleri yapabilir (SEC-04/05, MUS-03/04, YON-01)", () => {
  for (const label of ["noprofile", "inactCons", "inactCust", "inactSvc"]) {
    for (const o of OPS) {
      if (AUTH_ONLY_OK.has(o.id)) continue;
      assert.ok(!matrix.allowed[o.id].includes(label), `${label} ${o.id} ${o.name} yapamamalı`);
    }
  }
});
test("değişmez: müşteri rolleri iç veriye (iç not/ek/efor/aktivite/sözleşme/kullanıcı listesi/personel) erişemez", () => {
  const internal = ["R04", "R08", "R09", "R10", "R30", "R33", "R37", "R38", "R39", "R15", "N01", "N02", "A14", "E01", "E02", "G01", "G02", "T42", "T43", "X01"];
  for (const label of ["cust", "cust2", "cadmin", "custB", "arizi", "new", "nocomp"]) {
    for (const id of internal) assert.ok(!matrix.allowed[id].includes(label), `${label} ${id}`);
  }
});
test("değişmez [D-08]: sözleşme bedeli (contract_values) yalnızca root/service tarafından okunur/yazılır; contracts altına bedel yazılamaz", () => {
  for (const id of ["R10", "R45", "D13"]) assert.equal(EXPECT[id], "root service", id);
  assert.equal(EXPECT.D05, "", "contracts/<id>/value yazımı kimseye açık değil");
  for (const label of ["pm", "cons", "cons2", "cust", "cadmin", "arizi", "inactSvc"]) {
    for (const id of ["R10", "R45", "D13"]) assert.ok(!matrix.allowed[id].includes(label), `${label} ${id}`);
  }
});
test("değişmez: danışman yazma işlemleri atama ile sınırlı (atanmamış danışman hiçbir talebe yazamaz)", () => {
  const writes = ["T25", "T26", "T27", "T28", "T29", "T32", "T33", "T34", "T39", "T40", "T45", "T46", "T51", "T52", "T53", "T54", "M01", "M02", "M05", "N01", "N02", "A01", "A02", "A14", "H01", "E01", "E02", "E05"];
  for (const id of writes) assert.ok(!matrix.allowed[id].includes("cons2"), `cons2 ${id} yazamamalı`);
  for (const id of ["T40", "T45", "M02", "N02", "A02", "E02", "T26", "T27", "T25"]) assert.ok(!matrix.allowed[id].includes("cons"), `cons atanmadığı talebe/yasak alana yazamamalı: ${id}`);
});
test("değişmez: hiçbir rol mesaj/not/ek/geçmiş/aktivite kaydını düzenleyip silemez (yalnızca root moderasyon / cascade)", () => {
  for (const id of ["M18", "M19", "M20", "N05", "A15", "H06", "C07", "C08", "C09"]) {
    for (const label of ACTOR_LABELS) {
      if (label === "root" && ["M19", "M20", "N05", "A15", "H06"].includes(id)) continue;
      assert.ok(!matrix.allowed[id].includes(label), `${label} ${id}`);
    }
  }
});

// ------------------------------------------------------------------ yardımcılar (probe'lar)
const as = (uid, d) => (d || db).as(H.authOf(uid));
const withData = (mutate) => {
  const d = H.buildData();
  mutate(d.v2);
  return H.makeDb(d);
};
const allowed = (res, msg) => assert.equal(res.allowed, true, `${msg || "izin verilmeliydi (kontrol yükü)"}\n${res.info}`);
const denied = (res, msg) => assert.equal(res.allowed, false, `${msg || "reddedilmeliydi"} (izin verildi)`);
/** Önce geçerli kontrol yükü kabul edilir, sonra her bozuk varyant reddedilir. */
function probe(label, run, base, variants) {
  allowed(run(base), `${label}: kontrol yükü`);
  for (const [name, over] of Object.entries(variants)) {
    const payload = typeof over === "function" ? over(JSON.parse(JSON.stringify(base))) : { ...base, ...over };
    denied(run(payload), `${label}: ${name}`);
  }
}
const big = (n) => "A".repeat(n);

// ------------------------------------------------------------------ SEC-01/13/07/06 + OLC-03 + ALT-06: tickets .validate
test("[SEC-01/SEC-13/OLC-03/ALT-06] tickets oluşturma: alan doğrulamaları (enum, uzunluk, biçim, ekstra alan)", () => {
  const base = newTicketPayload("u_cust");
  probe("müşteri talebi", (p) => as("u_cust").write("/v2/tickets/n1", p), base, {
    "priority XSS": { priority: '"><img src=x onerror=alert(1)>' },
    "priority geçersiz değer": { priority: "acil" },
    "ticket_type geçersiz": { ticket_type: "NOPE" },
    "status geçersiz": { status: "open2" },
    "title 201 karakter": { title: big(201) },
    "title 3 MB": { title: big(3 * 1024 * 1024) },
    "description 10001 karakter": { description: big(10001) },
    "ticket_number biçimsiz": { ticket_number: "x" },
    "ticket_number XSS": { ticket_number: "SUP-ORN-<img>-2610-0001" },
    "created_at biçimsiz": { created_at: "dün" },
    "created_at yıl 2000": { created_at: "2000-01-01T00:00:00Z" },
    "created_at yıl 9999": { created_at: "9999-01-01T00:00:00Z" },
    "updated_at biçimsiz": { updated_at: "1999" },
    "ekstra düğüm": { junk: { a: big(1000) } },
    "ekstra skaler alan": { pad: "x" },
    "attachment_url javascript:": { attachment_url: "javascript:alert(1)" },
    "attachment_url data:": { attachment_url: "data:text/html,<script>alert(1)</script>" },
    "attachment_url 2001 karakter": { attachment_url: "https://x.com/" + big(2000) },
    "sap_module 31 karakter": { sap_module: big(31) },
    "user_name 201 karakter": { user_name: big(201) },
    "total_work_hours negatif/dize": { total_work_hours: "999" },
    "ticket_id ≠ anahtar": { ticket_id: "t10" },
  });
  allowed(as("u_cust").write("/v2/tickets/n1", { ...base, attachment_url: "https://drive.example.com/x" }));
  allowed(as("u_cust").write("/v2/tickets/n1", { ...base, title: big(200), description: big(10000) }));
});

test("[SEC-01] tickets: yazma yolları da doğrulanır (personel dahil priority/status/ticket_type/title)", () => {
  for (const u of ["u_root", "u_service", "u_pm"]) {
    allowed(as(u).write("/v2/tickets/t2/priority", "critical"), `${u} geçerli öncelik`);
    denied(as(u).write("/v2/tickets/t2/priority", '"><img src=x onerror=alert(1)>'), `${u} priority XSS`);
    denied(as(u).write("/v2/tickets/t2/status", "silindi"), `${u} geçersiz status`);
    denied(as(u).write("/v2/tickets/t2/ticket_type", "X"));
    denied(as(u).write("/v2/tickets/t2/title", big(201)));
    denied(as(u).write("/v2/tickets/t2/description", big(10001)));
    denied(as(u).write("/v2/tickets/t2/ticket_number", "SUP-1"));
    denied(as(u).write("/v2/tickets/t2/company_name", big(201)));
    denied(as(u).write("/v2/tickets/t2/updated_at", "bugün"));
    denied(as(u).write("/v2/tickets/t2/is_approved", "true"));
  }
  denied(as("u_cons").write("/v2/tickets/t1/status", "closed2"), "danışman geçersiz durum");
});

test("[SEC-07] tickets: id alanı hiçbir rolle yazılamaz; ticket_id anahtarla aynı olmalı", () => {
  for (const u of ["u_root", "u_service", "u_pm", "u_cons", "u_cust"]) {
    denied(as(u).write("/v2/tickets/t1/id", "t10"), `${u} id alanı`);
  }
  denied(as("u_root").write("/v2/tickets/n9", newTicketPayload("u_cust", { ticket_id: "n9", id: "t10" })), "id alanlı talep (root)");
  denied(as("u_root").write("/v2/tickets/n9", newTicketPayload("u_cust", { ticket_id: "t10" })), "ticket_id ≠ anahtar (root)");
  denied(as("u_root").update("/v2/tickets/t1", { ticket_id: "t10" }));
  allowed(as("u_root").write("/v2/tickets/n9", newTicketPayload("u_cust", { ticket_id: "n9" })));
});

test("[SEC-06] user_email müşterinin oturum e-postasıyla aynı olmalı (e-posta rölesi/taklit engeli)", () => {
  const base = newTicketPayload("u_cust");
  probe("müşteri", (p) => as("u_cust").write("/v2/tickets/n1", p), base, {
    "kurban e-postası": { user_email: "kurban.kisi@baska-firma.example" },
    "kendi e-postası + ek alan": { user_email: "cust@ornek-a.com,kurban@x.com" },
    "boş e-posta": { user_email: "" },
  });
  allowed(as("u_cust").write("/v2/tickets/n1", { ...base, user_email: "Cust@Ornek-A.com" }), "büyük/küçük harf fark etmez");
  denied(as("u_cust").write("/v2/tickets/n1", (({ user_email, ...r }) => r)(base)), "user_email hiç yok");
  // oturumda e-posta yoksa (token.email eksik) müşteri talep açamaz
  denied(db.as({ uid: "u_cust" }).write("/v2/tickets/n1", base), "auth.token.email olmayan oturum");
  // personel başkası adına açarken e-postayı serbestçe yazabilir (müşteri adına talep)
  allowed(as("u_service").write("/v2/tickets/n1", { ...base, user_email: "baska@musteri.com" }));
});

test("[SEC-13/PER-02] müşteri talep açarken personel/SLA alanlarını yazamaz", () => {
  const base = newTicketPayload("u_cust");
  for (const [name, over] of Object.entries({
    first_response_at: { first_response_at: ISO },
    resolved_at: { resolved_at: ISO },
    closed_at: { closed_at: ISO },
    closed_at_ms: { closed_at_ms: T0 },
    reopened_at: { reopened_at: ISO },
    started_at: { started_at: ISO },
    assigned_at: { assigned_at: ISO },
    is_approved: { is_approved: true },
    assigned_to_name: { assigned_to_name: "Zeynep Arslan" },
    assigned_to_id: { assigned_to_id: "p1" },
    total_work_hours: { total_work_hours: 999 },
    assigned_uids: { assigned_uids: { u_cust: true } },
    is_deleted: { is_deleted: false },
    project_id: { project_id: "pr1" },
    sla_alanı: { sla_x: "y" },
  })) {
    denied(as("u_cust").write("/v2/tickets/n1", { ...base, ...over }), name);
  }
  allowed(as("u_cust").write("/v2/tickets/n1", base));
});

test("[SEC-19/SEN-26/MUS-17] müşteri updated_*/public_updated_* alanlarına yalnızca ISO/≤128 dize yazar", () => {
  allowed(as("u_cust").update("/v2/tickets/t1", { updated_at: ISO, updated_by: "u_cust", public_updated_at: ISO, public_updated_by: "u_cust" }));
  denied(as("u_cust").write("/v2/tickets/t1/updated_by", big(129)));
  denied(as("u_cust").write("/v2/tickets/t1/public_updated_at", "9999"));
  denied(as("u_cust").write("/v2/tickets/t1/updated_at", 12345));
});

// ------------------------------------------------------------------ SEC-08/02/10: mesaj, not, geçmiş, efor
test("[SEC-08] mesaj: message_id anahtarla aynı, author_role/author_email/user_id oturuma bağlı", () => {
  const base = message("u_cust", "mz");
  probe("müşteri mesajı", (p) => as("u_cust").write("/v2/ticket_messages/t1/mz", p), base, {
    "message_id çakışması (personel mesajının kimliği)": { message_id: "m2" },
    "message_id yok": (p) => (delete p.message_id, p),
    "user_id taklidi": { user_id: "u_cons" },
    "author_role=super_admin": { author_role: "super_admin" },
    "author_role=consultant": { author_role: "consultant" },
    "author_role CSS enjeksiyonu": { author_role: "sv2-modal-overlay is-open" },
    "author_role yok": (p) => (delete p.author_role, p),
    "author_email taklidi": { author_email: "murat.aydin@parla-demo.com" },
    "is_internal=true": { is_internal: true },
    "message 10001 karakter": { message: big(10001) },
    "message sayı": { message: 5 },
    "created_at biçimsiz": { created_at: "x" },
    "work_hours (müşteri efor yazamaz)": { work_hours: 5 },
    "ekstra alan": { pad: big(100) },
    "ek referansı 4 adet": { attachments: [0, 1, 2, 3].map((i) => ({ id: "a" + i, name: "x.png", type: "image/png", size: 10 })) },
    "ek referansı ekstra alanlı": { attachments: [{ id: "a", name: "x.png", type: "image/png", size: 10, pad: "x" }] },
  });
  allowed(as("u_cust").write("/v2/ticket_messages/t1/mz", { ...base, author_email: "" }), "boş author_email kabul");
  allowed(as("u_cust").write("/v2/ticket_messages/t1/mz", { ...base, message: big(10000) }));
  // personel kendi rolüyle yazar; 'customer' rolüyle yazamaz
  const staff = message("u_cons", "mz");
  probe("danışman mesajı", (p) => as("u_cons").write("/v2/ticket_messages/t1/mz", p), staff, {
    "author_role='customer' (personel müşteri gibi görünemez)": { author_role: "customer" },
    "author_role başka rol": { author_role: "super_admin" },
    "work_hours negatif": { work_hours: -1 },
    "work_hours 1001": { work_hours: 1001 },
  });
  allowed(as("u_cons").write("/v2/ticket_messages/t1/mz", { ...staff, work_hours: 2.5 }));
  allowed(as("u_cadmin").write("/v2/ticket_messages/t1/mz", message("u_cadmin", "mz", { author_role: "company_admin" })), "firma yöneticisi kendi rolüyle");
});

test("[SEC-10] iç not: message_id/user_id/author_role bağlı; work_hours yalnızca sayı; ekstra alan yok", () => {
  const base = message("u_cons", "nz", { is_internal: true });
  probe("iç not", (p) => as("u_cons").write("/v2/ticket_internal_notes/t1/nz", p), base, {
    "work_hours XSS": { work_hours: "<img src=x onerror=alert(1)>" },
    "work_hours dize sayı": { work_hours: "2" },
    "message_id ≠ anahtar": { message_id: "n0" },
    "user_id taklidi": { user_id: "u_root" },
    "author_role taklidi": { author_role: "super_admin" },
    "author_email taklidi": { author_email: "baska@x.com" },
    "message 10001 karakter": { message: big(10001) },
    "ekstra alan": { pad: "x" },
    "created_at biçimsiz": { created_at: "x" },
  });
  // super_admin taşıma (migrateInternalMessages): başka yazarın iç notunu taşıyabilir
  allowed(as("u_root").write("/v2/ticket_internal_notes/t1/nm", message("u_cons", "nm", { is_internal: true })), "super_admin taşıma");
  denied(as("u_service").write("/v2/ticket_internal_notes/t1/nm", message("u_cons", "nm", { is_internal: true })), "service_admin başkası adına taşıyamaz");
});

test("[SEC-02/SEC-08] geçmiş: changed_by_uid oturumla aynı; action dize ≤80; alanlar sınırlı", () => {
  const base = historyEntry("u_cust", "hz");
  probe("geçmiş", (p) => as("u_cust").write("/v2/ticket_history/t1/hz", p), base, {
    "changed_by_uid taklidi": { changed_by_uid: "u_root" },
    "changed_by_uid yok": (p) => (delete p.changed_by_uid, p),
    "action sayı (Geçmiş sekmesini çökertir)": { action: 5 },
    "field_changed sayı": { field_changed: 7 },
    "action 81 karakter": { action: big(81) },
    "action boş": { action: "" },
    "old_value 1001 karakter": { old_value: big(1001) },
    "note 5001 karakter": { note: big(5001) },
    "changed_at biçimsiz": { changed_at: "x" },
    "history_id ≠ anahtar": { history_id: "h1" },
    "ekstra alan 3MB": { pad: big(3 * 1024 * 1024) },
  });
});

test("[SEC-02] efor: hours sayı >0, created_by_uid oturumla aynı, work_date biçimli; ekstra alan yok", () => {
  const base = effort("u_cons", "ez");
  probe("efor", (p) => as("u_cons").write("/v2/ticket_efforts/t1/ez", p), base, {
    "hours XSS": { hours: "<img src=x onerror=alert(1)>" },
    "hours 0": { hours: 0 },
    "hours negatif": { hours: -2 },
    "hours 1001": { hours: 1001 },
    "created_by_uid taklidi": { created_by_uid: "u_root" },
    "work_date biçimsiz": { work_date: "bugün" },
    "note 2001 karakter": { note: big(2001) },
    "ekstra alan": { pad: "x" },
    "effort_id ≠ anahtar": { effort_id: "e1" },
  });
});

test("atama kayıtları: personnel_id anahtarla aynı; alanlar sınırlı", () => {
  const base = { personnel_id: "p9", personnel_name: "P9", personnel_email: "p9@parla-demo.com", is_primary: false, assigned_at: ISO, assigned_by_uid: "u_service", assigned_by_name: "Mehmet" };
  probe("atama", (p) => as("u_service").write("/v2/ticket_assignments/t1/p9", p), base, {
    "personnel_id ≠ anahtar": { personnel_id: "p1" },
    "is_primary dize": { is_primary: "evet" },
    "personnel_email 255 karakter": { personnel_email: big(255) },
    "ekstra alan": { pad: "x" },
    "assigned_at biçimsiz": { assigned_at: "x" },
  });
});

test("[SEC-02/EML-22/PER-02] aktivite: user_uid oturumla aynı; action biçimli; müşteri yalnız kendi olay türleri; alanlar sınırlı", () => {
  const base = activity("u_cust", "az");
  probe("müşteri aktivitesi", (p) => as("u_cust").write("/v2/activities/az", p), base, {
    "user_uid taklidi": { user_uid: "u_root", user_name: "Murat Aydın" },
    "user_uid boş (actor'suz çağrı)": { user_uid: "" },
    "action sayı": { action: 123 },
    "action nesne 3MB": { action: { a: big(3 * 1024 * 1024) } },
    "action müşteri listesi dışı (ticket_deleted)": { action: "ticket_deleted" },
    "action büyük harf/biçimsiz": { action: "TICKET MESSAGE" },
    "details sayı": { details: 456 },
    "details 1001 karakter": { details: big(1001) },
    "entity_label 301 karakter": { entity_label: big(301) },
    "created_at yok": (p) => (delete p.created_at, p),
    "activity_id ≠ anahtar": { activity_id: "a1" },
    "ekstra alan": { pad: "x" },
  });
  for (const action of ["ticket_created", "ticket_message", "ticket_closed", "ticket_reopened", "email_failed"]) {
    allowed(as("u_cust").write("/v2/activities/az", { ...base, action }), `müşteri ${action}`);
  }
  allowed(as("u_service").write("/v2/activities/az", activity("u_service", "az", { action: "ticket_deleted" })), "personel ticket_deleted");
  denied(as("u_service").write("/v2/activities/az", activity("u_root", "az", { action: "ticket_deleted" })), "personel de taklit edemez");
  denied(as("u_service").write("/v2/activities/~zz", activity("u_service", "~zz", { action: 1 })), "anahtar ~zz + sayı action");
});

// ------------------------------------------------------------------ SEC-14/YON-28/SEN-26: counters
test("[SEC-14/YON-28/SEN-26/PER-02] sayaç: yalnızca +1; müşteri yalnızca kendi kodu/türleri; yeniden başlatma yok", () => {
  const w = (uid, p, v) => as(uid).write(`/v2/counters/${p}`, v);
  allowed(w("u_cust", "SUP/ORN/2610", 13));
  denied(w("u_cust", "SUP/ORN/2610", 1), "azaltma/sıfırlama");
  denied(w("u_cust", "SUP/ORN/2610", 14), "atlama (+2)");
  denied(w("u_cust", "SUP/ORN/2610", 12), "aynı değer");
  denied(w("u_cust", "SUP/ORN/2610", 13.5));
  denied(w("u_cust", "SUP/ORN/2610", 1e21));
  denied(w("u_cust", "SUP/ORN/2610", "13"));
  denied(w("u_cust", "SUP/ORN/2610", true));
  allowed(w("u_cust", "SUP/ORN/2611", 1), "yeni ay 1'den başlar");
  denied(w("u_cust", "SUP/ORN/2611", 2), "yeni ay 2'den başlayamaz");
  denied(w("u_cust", "SUP/ORN/26100", 1), "yymm biçimi");
  denied(w("u_cust", "SUP/ORN/abcd", 1));
  denied(w("u_cust", "SUP/ORN!/2611", 1), "kod biçimi");
  denied(w("u_cust", "XXX/ORN/2611", 1), "tür biçimi");
  denied(w("u_cust", "SUP/YENI/2610", 1), "uydurma müşteri kodu");
  denied(w("u_cust", "SUP/DMR/2610", 11), "başka firmanın sayacı");
  denied(w("u_cust", "INT/ORN/2611", 1), "müşteri INT numarası üretemez");
  denied(w("u_cust", "PRJ/ORN/2611", 1));
  allowed(w("u_cust", "BUG/ORN/2611", 1));
  denied(w("u_arizi", "SUP/ARZ0001/2611", 1), "arızi müşteri de müşteri türleri içindedir ama bu işlem kendi kodu için ARZ/BUG");
});

// ------------------------------------------------------------------ SEC-17: ek sınırları
test("[SEC-17] ek: tür beyaz listesi, ad, boyut/data tutarlılığı, uploader_uid, ekstra alan", () => {
  const base = att("u_cust", { att_id: "az" });
  probe("müşteri eki", (p) => as("u_cust").write("/v2/ticket_attachments/t1/az", p), base, {
    "uploader_uid taklidi": { uploader_uid: "u_root" },
    "svg": { type: "image/svg+xml", name: "x.svg" },
    "html": { type: "text/html", name: "x.html" },
    "xhtml (vnd joker)": { type: "application/vnd.pwg-xhtml-print+xml", name: "x.xhtml" },
    "portable-executable": { type: "application/vnd.microsoft.portable-executable", name: "x.exe" },
    "x-msdownload": { type: "application/x-msdownload", name: "x.exe" },
    "javascript türü": { type: "application/javascript", name: "x.js" },
    "ad .exe": { name: "rapor.pdf.exe", type: "application/pdf" },
    "ad .html": { name: "x.html", type: "application/pdf" },
    "ad .svg büyük harf": { name: "X.SVG", type: "image/png" },
    "ad boş": { name: "" },
    "ad 201 karakter": { name: big(201) + ".png" },
    "size 2.2 MB üstü": { size: 2200001, data: "AAAA" },
    "size negatif": { size: -1 },
    "size dize": { size: "1000" },
    "data 3.000.001 karakter": { data: big(3000001), size: 2200000 },
    "size yalan (data size ile uyumsuz)": { size: 1, data: big(1000) },
    "data dize değil": { data: { a: 1 } },
    "ekstra alan (10 MB pad)": { pad: big(10 * 1024 * 1024) },
    "att_id ≠ anahtar": { att_id: "a1" },
    "created_at biçimsiz": { created_at: "x" },
    "uploader_name 201 karakter": { uploader_name: big(201) },
  });
  for (const [type, name] of [["image/png", "a.png"], ["image/jpeg", "a.jpg"], ["image/gif", "a.gif"], ["image/webp", "a.webp"], ["application/pdf", "a.pdf"], ["text/plain", "a.txt"], ["text/csv", "a.csv"], ["application/zip", "a.zip"], ["application/msword", "a.doc"], ["application/vnd.ms-excel", "a.xls"], ["application/vnd.ms-powerpoint", "a.ppt"], ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"], ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx"], ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "a.pptx"]]) {
    allowed(as("u_cust").write("/v2/ticket_attachments/t1/az", { ...base, type, name }), `${type} izinli`);
  }
  allowed(as("u_cust").write("/v2/ticket_attachments/t1/az", { ...base, data: big(3000000), size: 2200000 }), "sınır değerleri");
});

test("[SEC-17] iç not eki: aynı doğrulamalar; yalnızca atanmış danışman/yönetici", () => {
  const base = att("u_cons", { att_id: "iz" });
  probe("iç ek", (p) => as("u_cons").write("/v2/ticket_internal_attachments/t1/iz", p), base, {
    "uploader_uid taklidi": { uploader_uid: "u_root" },
    "xhtml": { type: "application/vnd.pwg-xhtml-print+xml", name: "x.xhtml" },
    "ekstra alan": { pad: "x" },
    "size yalan": { size: 1, data: big(1000) },
  });
});

test("[SEC-17] talep başına ek kotası: kota modu açıkken ek + sayaç AYNI çok-yollu update'te artmalı; sayaç azaltılamaz", () => {
  const quotaRules = buildRules({ attachmentQuota: true });
  const withStats = (stats) => {
    const d = H.buildData();
    if (stats) d.v2.ticket_attachment_stats = { t1: stats };
    return H.targaryen.database(quotaRules, d);
  };
  const a = (uid, id, size) => att(uid, { att_id: id, size, data: big(size) });
  const up = (d, uid, node, id, size, stats) =>
    d.as(H.authOf(uid)).update("/v2", { [`${node}/t1/${id}`]: a(uid, id, size), ...(stats ? { "ticket_attachment_stats/t1": stats } : {}) });
  const fresh = withStats(null);
  denied(fresh.as(H.authOf("u_cust")).write("/v2/ticket_attachments/t1/q1", a("u_cust", "q1", 100)), "sayaçsız tek yollu ek");
  denied(up(fresh, "u_cust", "ticket_attachments", "q1", 100, null), "sayaçsız çok-yollu ek");
  allowed(up(fresh, "u_cust", "ticket_attachments", "q1", 100, { count: 1, bytes: 100 }), "ek + sayaç (0 -> 1, 0 -> 100)");
  allowed(up(fresh, "u_cons", "ticket_internal_attachments", "q1", 100, { count: 1, bytes: 100 }), "iç ek + sayaç (atanmış danışman)");
  denied(up(fresh, "u_cust", "ticket_attachments", "q1", 100, { count: 2, bytes: 100 }), "sayaç +2");
  denied(up(fresh, "u_cust", "ticket_attachments", "q1", 100, { count: 1, bytes: 50 }), "bayt uyumsuz");
  denied(up(fresh, "u_cust", "ticket_attachments", "q1", 100, { count: 0, bytes: 100 }), "sayaç artmadı");
  const mid = withStats({ count: 5, bytes: 5000 });
  allowed(up(mid, "u_cust", "ticket_attachments", "q1", 100, { count: 6, bytes: 5100 }), "5 -> 6");
  denied(up(mid, "u_cust", "ticket_attachments", "q1", 100, { count: 1, bytes: 100 }), "sayacı geri alarak kota sıfırlama");
  denied(mid.as(H.authOf("u_cust")).write("/v2/ticket_attachment_stats/t1", { count: 0, bytes: 0 }), "sayaç sıfırlama");
  denied(mid.as(H.authOf("u_cust")).write("/v2/ticket_attachment_stats/t1/count", 4), "sayaç azaltma");
  allowed(mid.as(H.authOf("u_root")).write("/v2/ticket_attachment_stats/t1", { count: 0, bytes: 0 }), "super_admin sıfırlayabilir (bakım)");
  const full = withStats({ count: constants.ATT_QUOTA_COUNT, bytes: 1000 });
  denied(up(full, "u_cust", "ticket_attachments", "q1", 100, { count: constants.ATT_QUOTA_COUNT + 1, bytes: 1100 }), "adet kotası dolu");
  const heavy = withStats({ count: 3, bytes: constants.ATT_QUOTA_BYTES - 50 });
  denied(up(heavy, "u_cust", "ticket_attachments", "q1", 100, { count: 4, bytes: constants.ATT_QUOTA_BYTES + 50 }), "bayt kotası dolu");
  denied(fresh.as(H.authOf("u_cust2")).update("/v2", { "ticket_attachments/t1/q1": a("u_cust2", "q1", 100), "ticket_attachment_stats/t1": { count: 1, bytes: 100 } }), "başkasının talebi");
});

test("ek kotası varsayılan olarak KAPALI (kural paketi istemci sayaç yazana kadar tek yollu ek yazımına izin verir)", () => {
  allowed(as("u_cust").write("/v2/ticket_attachments/t1/q9", att("u_cust", { att_id: "q9" })));
});

// ------------------------------------------------------------------ SEC-04/05/YON-01/MUS-03/04: hesap durumu zincirleri
test("[SEC-05/MUS-04] profilsiz hesap zinciri: talep + ek + mesaj + geçmiş + aktivite + sayaç + profil + bildirim hepsi reddedilir", () => {
  const g = "u_noprofile";
  denied(as(g).write("/v2/tickets/ng", newTicketPayload(g, { ticket_id: "ng", company_id: "" })));
  denied(as(g).write("/v2/ticket_attachments/t1/ga", att(g, { att_id: "ga" })));
  denied(as(g).write("/v2/ticket_messages/t1/gm", message(g, "gm")));
  denied(as(g).write("/v2/ticket_history/t1/gh", historyEntry(g, "gh")));
  denied(as(g).write("/v2/activities/gx", activity(g, "gx")));
  denied(as(g).write("/v2/counters/SUP/ORN/2610", 13));
  denied(as(g).write(`/v2/users/${g}`, { role: "customer", is_active: true }));
  denied(as(g).write(`/v2/users/${g}/last_login_at`, ISO));
  denied(as(g).write(`/v2/notifications/${g}/n`, { title: "x" }));
});

test("[SEC-04/YON-01] pasif personel: okuma/yazma/atama/efor/iç not/sözleşme/silme hiçbiri çalışmaz; pasif service_admin kullanıcı yönetemez", () => {
  for (const uid of ["u_inact_cons", "u_inact_svc"]) {
    for (const path of ["/v2/tickets", "/v2/tickets/t1", "/v2/contracts", "/v2/personnel", "/v2/companies", "/v2/activities", "/v2/ticket_internal_notes/t1", "/v2/ticket_efforts/t1", "/v2/counters", "/v2/reply_templates", "/v2/ticket_assignments/t1"]) {
      denied(as(uid).read(path), `${uid} ${path}`);
    }
    denied(as(uid).update("/v2/tickets/t1", { priority: "low" }));
    denied(as(uid).write("/v2/ticket_assignments/t1/p9", { personnel_id: "p9" }));
    denied(as(uid).write("/v2/ticket_efforts/t1/ez", effort(uid, "ez")));
    denied(as(uid).write("/v2/ticket_internal_notes/t1/nz", message(uid, "nz", { is_internal: true })));
    denied(as(uid).write("/v2/users/u_cust/is_active", false));
    denied(as(uid).write("/v2/users/new9", { role: "customer", is_active: true }));
    denied(as(uid).write("/v2/reply_templates/rt9", { title: "x", body: "y" }));
  }
});

test("[SEC-24] pasife alınmış firmanın kullanıcıları yeni talep açamaz; diğer firmalar etkilenmez", () => {
  const d = withData((v2) => {
    v2.companies.cA.is_active = false;
  });
  denied(as("u_cust", d).write("/v2/tickets/n1", newTicketPayload("u_cust")), "firma A pasif");
  denied(as("u_cadmin", d).write("/v2/tickets/n1", newTicketPayload("u_cadmin")));
  allowed(as("u_custB", d).write("/v2/tickets/n1", newTicketPayload("u_custB")), "firma B aktif");
  allowed(as("u_service", d).write("/v2/tickets/n1", newTicketPayload("u_cust")), "personel pasif firma adına açabilir");
  allowed(as("u_cust").write("/v2/tickets/n1", newTicketPayload("u_cust")), "kontrol: aktif firma");
});

// ------------------------------------------------------------------ SEC-09/YON-05/06
test("[SEC-09/YON-05/YON-06] kullanıcı yönetimi: service_admin super_admin'e dokunamaz; kimse kendini kilitleyemez", () => {
  const attacks = [
    ["is_active=false", (u) => as(u).update("/v2/users/u_root", { is_active: false })],
    ["role=customer", (u) => as(u).update("/v2/users/u_root", { role: "customer" })],
    ["email", (u) => as(u).update("/v2/users/u_root", { email: "x@evil.com" })],
    ["profil sil", (u) => as(u).write("/v2/users/u_root", null)],
    ["profil üzerine yaz", (u) => as(u).write("/v2/users/u_root", { role: "service_admin", is_active: true })],
    ["alan: role", (u) => as(u).write("/v2/users/u_root/role", "consultant")],
  ];
  for (const [name, run] of attacks) {
    denied(run("u_service"), `service_admin: ${name}`);
    denied(run("u_pm"), `PM: ${name}`);
    denied(run("u_cust"), `müşteri: ${name}`);
  }
  allowed(as("u_root2").update("/v2/users/u_root", { email: "yeni@parla-demo.com" }), "başka super_admin");
  allowed(as("u_service").update("/v2/users/u_cust", { is_active: false }), "service_admin müşteriyi pasifleştirebilir");
  allowed(as("u_service").write("/v2/users/new1", { role: "consultant", is_active: true }), "service_admin danışman oluşturabilir");
  denied(as("u_service").write("/v2/users/new1", { role: "super_admin", is_active: true }), "super_admin atayamaz");
  denied(as("u_service").write("/v2/users/u_cust/role", "super_admin"), "alan bazlı super_admin atama");
  denied(as("u_service").update("/v2/users/u_cust", { role: "super_admin" }));
  // kendini kilitleme
  for (const u of ["u_root", "u_service"]) {
    denied(as(u).update(`/v2/users/${u}`, { is_active: false }), `${u} kendini pasifleştiremez`);
    denied(as(u).update(`/v2/users/${u}`, { role: "customer" }), `${u} kendini düşüremez`);
    denied(as(u).write(`/v2/users/${u}`, null), `${u} kendini silemez`);
    denied(as(u).update(`/v2/users/${u}`, { company_id: "cA" }), `${u} kendi firmasını değiştiremez`);
    denied(as(u).write(`/v2/users/${u}/must_change_password`, true));
    allowed(as(u).update(`/v2/users/${u}`, { last_login_at: ISO, updated_at: ISO }), `${u} girişte last_login_at yazabilir`);
  }
});

// ------------------------------------------------------------------ SEC-11/D-05: silme politikası
test("[SEC-11/D-05] silme: yetim veri bırakan tekil silme yok; cascade yalnızca super_admin; yumuşak silme ADMIN", () => {
  for (const u of ["u_service", "u_pm", "u_cons", "u_cust", "u_cadmin", "u_inact_svc"]) {
    denied(as(u).write("/v2/tickets/t1", null), `${u} tickets/t1 = null`);
    denied(as(u).update("/v2", { "tickets/t1": null }), `${u} update tickets/t1`);
    denied(as(u).update("/v2", { "tickets/t1": null, "ticket_messages/t1": null }), `${u} kısmi cascade`);
  }
  allowed(as("u_root").write("/v2/tickets/t1", null), "super_admin tekil (yetim bırakır; istemci cascade kullanmalı)");
  allowed(as("u_service").update("/v2/tickets/t1", { is_deleted: true, deleted_at: ISO, deleted_by: "u_service" }), "service_admin yumuşak siler");
  denied(as("u_service").update("/v2/tickets/t1", { is_deleted: true, deleted_at: "dün", deleted_by: "u_service" }), "deleted_at ISO olmalı");
  denied(as("u_service").update("/v2/tickets/t1", { is_deleted: "true" }));
});

// ------------------------------------------------------------------ SEC-19/PER-07/SEN-07/MUS-17/SEN-40
test("[SEN-07/PER-07/SEC-19] atanmamış danışman 'müşteri sayfası' yolu dahil hiçbir talebe yazamaz (kural düzeyi)", () => {
  // SEN-07: personel customer/ticket-detail.html üzerinden öncelik/danışman/durum yazmaya çalışır
  for (const [name, run] of Object.entries({
    "öncelik": () => as("u_cons").write("/v2/tickets/t10/priority", "low"),
    "danışman": () => as("u_cons").write("/v2/tickets/t10/assigned_to_id", "p1"),
    "durum+closed_at": () => as("u_cons").update("/v2/tickets/t10", { status: "closed", closed_at: ISO }),
    "assigned_uids": () => as("u_cons").write("/v2/tickets/t10/assigned_uids/u_cons", true),
    "mesaj": () => as("u_cons").write("/v2/ticket_messages/t10/mx", message("u_cons", "mx")),
    "atama": () => as("u_cons").write("/v2/ticket_assignments/t10/p1", { personnel_id: "p1" }),
    "efor": () => as("u_cons").write("/v2/ticket_efforts/t10/ex", effort("u_cons", "ex")),
  })) denied(run(), `u_cons t10: ${name}`);
  // aynı işlemler atanmış talepte (t1) yalnızca alan bazlı serbest
  allowed(as("u_cons").update("/v2/tickets/t1", { status: "closed", closed_at: ISO, updated_at: ISO }));
  denied(as("u_cons").write("/v2/tickets/t1/assigned_uids/u_cons2", true));
  denied(as("u_cons").write("/v2/tickets/t1/assigned_to_id", "p9"));
});

test("[MUS-17/SEN-40] 14 gün yeniden açma kuralı sunucu saatiyle: 13 gün evet, 15 gün hayır; closed_at_ms sahteciliği yok", () => {
  const closed = withData((v2) => Object.assign(v2.tickets.t1, { status: "closed", closed_at: ISO, closed_at_ms: T0 }));
  const reopen = { status: "reopened", reopened_at: ISO, closed_at: null, closed_at_ms: null };
  allowed(closed.as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen, { now: T0 + 13 * D }));
  allowed(closed.as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen, { now: T0 + 14 * D }), "tam 14 gün");
  denied(closed.as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen, { now: T0 + 14 * D + 1000 }), "14 gün + 1 sn");
  denied(closed.as(H.authOf("u_cust")).update("/v2/tickets/t1", reopen, { now: T0 + 15 * D }));
  denied(closed.as(H.authOf("u_cust")).update("/v2/tickets/t1", { status: "reopened", reopened_at: ISO, closed_at_ms: T0 + 20 * D }, { now: T0 + 20 * D }), "closed_at_ms'i ileri alarak sınırı kaydırma (temizlemeden güncelleme)");
  // müşteri kapatırken closed_at_ms'i geçmişe/geleceğe çekemez
  const pc = withData((v2) => Object.assign(v2.tickets.t1, { status: "pending_close" }));
  denied(pc.as(H.authOf("u_cust")).update("/v2/tickets/t1", { status: "closed", closed_at: ISO, closed_at_ms: T0 + 3600 * 1000 }), "1 saat ileri");
  denied(pc.as(H.authOf("u_cust")).update("/v2/tickets/t1", { status: "closed", closed_at: ISO, closed_at_ms: "şimdi" }));
  allowed(pc.as(H.authOf("u_cust")).update("/v2/tickets/t1", { status: "closed", closed_at: ISO, closed_at_ms: T0 + 60 * 1000 }), "1 dk sapma kabul");
});

test("[MUS-31] uzunluk sınırları: mesaj 10.000, açıklama 10.000, başlık 200 karakter", () => {
  allowed(as("u_cust").write("/v2/ticket_messages/t1/mz", message("u_cust", "mz", { message: big(10000) })));
  denied(as("u_cust").write("/v2/ticket_messages/t1/mz", message("u_cust", "mz", { message: big(10001) })));
  allowed(as("u_cust").write("/v2/tickets/n1", newTicketPayload("u_cust", { description: big(10000), title: big(200) })));
  denied(as("u_cust").write("/v2/tickets/n1", newTicketPayload("u_cust", { description: big(10001) })));
  denied(as("u_cust").write("/v2/tickets/n1", newTicketPayload("u_cust", { title: big(201) })));
});

// ------------------------------------------------------------------ bildirim/sunucu düğümleri, indeksler, sözleşme
test("[SEC-37] notifications kapalı; counters.read profil gerektirir; sunucu düğümleri (system_state/ops) istemciye kapalı", () => {
  for (const [label] of H.ACTORS) {
    const uid = H.ACTORS.find((a) => a[0] === label)[1];
    denied(as(uid).read("/v2/notifications/u_cust"), `${label} notifications okuma`);
    denied(as(uid).write("/v2/notifications/u_cust/x", { a: 1 }), `${label} notifications yazma`);
    denied(as(uid).read("/v2/system_state"));
    denied(as(uid).write("/v2/system_state/x", 1));
    denied(as(uid).read("/v2/ops"));
    denied(as(uid).write("/v2/ops/x", 1));
  }
  denied(as("u_noprofile").read("/v2/counters"));
  allowed(as("u_cust").read("/v2/counters"));
});

test("[OLC] .indexOn: tickets (project_id, resolved_at, closed_at, ticket_number dahil), activities (entity_id dahil)", () => {
  const v2 = H.rules.rules.v2;
  for (const f of ["user_id", "company_id", "assigned_to_id", "status", "created_at", "updated_at", "ticket_type", "project_id", "resolved_at", "closed_at", "ticket_number"]) {
    assert.ok(v2.tickets[".indexOn"].includes(f), `tickets .indexOn ${f}`);
  }
  for (const f of ["created_at", "entity_type", "entity_id", "user_uid"]) assert.ok(v2.activities[".indexOn"].includes(f), `activities .indexOn ${f}`);
  // istemcinin kullandığı sorgular indeksli: user_id, company_id, assigned_to_id, updated_at
  for (const f of ["user_id", "company_id", "assigned_to_id", "updated_at"]) assert.ok(v2.tickets[".indexOn"].includes(f));
});

test("[ALT-19/EML-22] gerçek istemci yük şekilleri geçer: createTicket + geçmiş + aktivite + mesaj(+ek referansı) + sayaç (müşteri akışı)", () => {
  // firebase-client.js createTicket / addTicketHistory / logActivity / addTicketMessage ile aynı alan kümeleri
  const t = newTicketPayload("u_cust", { ticket_id: "nx", ticket_number: "SUP-ORN-DİĞER-2610-0014", sap_module: "Diğer" });
  allowed(as("u_cust").write("/v2/counters/SUP/ORN/2610", 13));
  allowed(as("u_cust").write("/v2/tickets/nx", t));
  const d = withData((v2) => {
    v2.tickets.nx = t;
  });
  allowed(as("u_cust", d).write("/v2/ticket_history/nx/h1", historyEntry("u_cust", "h1", { action: "created", field_changed: "ticket", old_value: "", new_value: t.ticket_number })));
  allowed(as("u_cust", d).write("/v2/activities/a9", activity("u_cust", "a9", { action: "ticket_created", entity_id: "nx", entity_label: t.ticket_number, details: t.title })));
  allowed(as("u_cust", d).write("/v2/ticket_attachments/nx/at1", att("u_cust", { att_id: "at1" })));
  allowed(as("u_cust", d).write("/v2/ticket_messages/nx/m1", message("u_cust", "m1", { attachments: [{ id: "at1", name: "ekran.png", type: "image/png", size: 1000 }] })));
  allowed(as("u_cust", d).update("/v2/tickets/nx", { updated_at: ISO, updated_by: "u_cust", public_updated_at: ISO, public_updated_by: "u_cust" }));
});
