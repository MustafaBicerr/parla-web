/**
 * WP-05 + D-07 C yeni e-posta tipleri: atama kapsamı (talep sizden alındı, danışman atandı, kritik öncelik) ve zamanlanmış otomasyon
 * (SLA uyarısı/aşımı, hatırlatmalar, otomatik kapanış, eskalasyon) + şifre belirleme bağlantısı e-postaları.
 * Çalıştırma: node --test netlify/tests/email-templates-wp05.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildEmail, TEMPLATE_TYPES } = require("../lib/email-templates.js");
const guard = require("../lib/email-guard.js");

const base = { ticket_id: "T1", ticket_number: "SUP-ABC-FI-2610-0001", title: "Fatura hatası", status: "in_progress", priority: "high", company_name: "ABC", user_name: "Ayşe", portalUrl: "https://www.parlabilgiteknolojileri.net" };
const staffUrl = /admin\/ticket-detail\.html\?id=T1/;
const customerUrl = /customer\/ticket-detail\.html\?id=T1/;

test("yeni tipler şablon listesinde", () => {
  for (const t of ["ticket_unassigned", "consultant_assigned", "ticket_priority_critical", "sla_warning", "sla_breached", "reminder_waiting_customer", "reminder_pending_close", "ticket_auto_closed", "unassigned_escalation", "password_reset_admin"]) {
    assert.ok(TEMPLATE_TYPES.includes(t), t);
  }
});

test("personele giden tek kitleli tipler yönetim sayfasına bağlanır; müşteri tipleri müşteri sayfasına", () => {
  for (const t of ["ticket_unassigned", "ticket_priority_critical", "sla_warning", "sla_breached", "unassigned_escalation"]) {
    const b = buildEmail(t, base);
    assert.match(b.html, staffUrl, t);
    assert.match(b.text, staffUrl, t);
  }
  for (const t of ["consultant_assigned", "reminder_pending_close"]) {
    assert.match(buildEmail(t, base).html, customerUrl, t);
  }
});

test("kitleli tipler: hatırlatma ve otomatik kapanış müşteri/personel metni ve bağlantısı ayrışır", () => {
  const cust = buildEmail("reminder_waiting_customer", { ...base, audience: "customer", days: 3 });
  assert.match(cust.html, customerUrl);
  assert.match(cust.text, /3 gündür sizden gelecek bilgiyi bekliyor/);
  const staff = buildEmail("reminder_waiting_customer", { ...base, audience: "staff", days: 7 });
  assert.match(staff.html, staffUrl);
  assert.match(staff.text, /7 gündür müşteri yanıtı bekliyor/);
  const autoCust = buildEmail("ticket_auto_closed", { ...base, audience: "customer", days: 10 });
  assert.match(autoCust.text, /10 gün içinde onay\/yanıt alınamadığı için otomatik olarak kapatıldı/);
  assert.match(autoCust.text, /14 gün içinde portaldan yeniden açabilirsiniz/);
  assert.match(buildEmail("ticket_auto_closed", { ...base, audience: "staff", days: 10 }).html, staffUrl);
});

test("kapanış onayı hatırlatması kalan günü söyler; SLA e-postaları aşama ve kalan süreyi gösterir", () => {
  const r = buildEmail("reminder_pending_close", { ...base, days: 3, days_left: 7 });
  assert.match(r.text, /7 gün sonra otomatik olarak kapatılır/);
  const w = buildEmail("sla_warning", { ...base, phase_label: "İlk yanıt", remaining_text: "45 dk" });
  assert.match(w.subject, /^SLA uyarısı · SUP-ABC-FI-2610-0001/);
  assert.match(w.text, /İlk yanıt hedef süresinin %80'i doldu \(kalan: 45 dk\)/);
  const b = buildEmail("sla_breached", { ...base, phase_label: "İlk yanıt ve çözüm" });
  assert.match(b.text, /İlk yanıt ve çözüm hedef süresi aşıldı/);
});

test("atama e-postaları: eski danışman yeni sorumluyu görür; müşteri danışman adını görür; kritik öncelikte 1 saat hedefi", () => {
  assert.match(buildEmail("ticket_unassigned", { ...base, assignee_name: "Baran Kaya" }).text, /yeni sorumlu: Baran Kaya/);
  assert.doesNotMatch(buildEmail("ticket_unassigned", base).text, /yeni sorumlu/);
  assert.match(buildEmail("consultant_assigned", { ...base, assignee_name: "Baran Kaya" }).text, /Baran Kaya adlı danışmanımıza atandı/);
  assert.match(buildEmail("ticket_priority_critical", base).text, /1 saat/);
});

test("ek satırlar (extraRows) güvenli basılır ve sınırlıdır", () => {
  const b = buildEmail("sla_warning", { ...base, extraRows: [["Aşama", "<b>İlk yanıt</b>"], ["", "boş etiket atlanır"], ...Array.from({ length: 10 }, (_, i) => [`K${i}`, `V${i}`])] });
  assert.doesNotMatch(b.html, /<b>İlk yanıt<\/b>/);
  assert.match(b.html, /&lt;b&gt;İlk yanıt&lt;\/b&gt;/);
  assert.ok(!b.text.includes("boş etiket"));
  assert.ok(!/K9/.test(b.text), "en çok 6 ek satır");
});

test("user_credentials: bağlantı varsa metin bağlantıyı tarif eder ve düğme 'Şifremi belirle'; parola ASLA yok", () => {
  const withLink = buildEmail("user_credentials", { email: "a@b.com", name: "Ali", password: "Gizli123x", setPasswordUrl: "https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html?mode=resetPassword&oobCode=XYZ" });
  assert.match(withLink.text, /aşağıdaki düğmeyle şifrenizi kendiniz belirleyebilirsiniz/);
  assert.match(withLink.text, /Şifremi belirle: https:\/\/www\.parlabilgiteknolojileri\.net\/support-v2\/auth-action\.html\?mode=resetPassword&oobCode=XYZ/);
  assert.ok(!(withLink.html + withLink.text).includes("Gizli123x"));
  const without = buildEmail("user_credentials", { email: "a@b.com" });
  assert.match(without.text, /adresinize ayrıca bir “şifre belirleme” bağlantısı gönderilir/);
});

test("password_reset_admin: bağlantı düğmesi + 'beklemiyorsanız' uyarısı; http/javascript bağlantısı kabul edilmez", () => {
  const ok = buildEmail("password_reset_admin", { email: "a@b.com", name: "Ali", setPasswordUrl: "https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html?mode=resetPassword&oobCode=Q" });
  assert.match(ok.subject, /şifre belirleme bağlantınız/);
  assert.match(ok.html, /oobCode=Q/);
  assert.match(ok.text, /beklemiyorsanız/);
  const bad = buildEmail("password_reset_admin", { email: "a@b.com", setPasswordUrl: "javascript:alert(1)" });
  assert.doesNotMatch(bad.html, /javascript:/);
});

test("öncelik sınıfları: kritik yükselme, otomatik kapanış, SLA aşımı yüksek; hatırlatma/uyarı/atama bilgisi düşük", () => {
  for (const t of ["ticket_priority_critical", "ticket_auto_closed", "sla_breached", "password_reset_admin"]) assert.equal(guard.priorityOf(t), "high", t);
  for (const t of ["sla_warning", "reminder_waiting_customer", "reminder_pending_close", "unassigned_escalation", "ticket_unassigned", "consultant_assigned"]) assert.equal(guard.priorityOf(t), "low", t);
});
