/**
 * E-posta şablonları testleri: tüm tip × kitle × düşmanca girdi (kaçış), düz metin alternatifi, konu temizliği,
 * etiket eşitliği (portal ↔ e-posta), kesme, bağlantı güvenliği, istemci uyumluluk işaretleri.
 * Çalıştırma: node --test netlify/tests/email-templates.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const T = require("../lib/email-templates.js");
const { buildEmail, TEMPLATE_TYPES, STATUS_LABELS, PRIORITY_LABELS, truncateText, cleanSubject, TRUNCATION_SUFFIX } = T;

const realistic = {
  ticket_id: "-OabCdEfGhIjKlMnOpQr",
  ticket_number: "SUP-ORN-SD-2610-0001",
  title: "Fatura kesiminde muhasebe kaydı oluşmuyor",
  status: "in_progress",
  priority: "critical",
  company_name: "Örnek Holding A.Ş.",
  user_name: "Ayşe Demir",
  note: "Merhaba Ayşe Hanım,\nVKOA kaydı düzeltildi — lütfen test edin.\n\nTeşekkürler 🙏",
  author_name: "Mehmet Kaya",
  at: "2026-10-06T10:00:00.000Z",
  portalUrl: "https://www.parlabilgiteknolojileri.net",
};

const LS = String.fromCharCode(0x2028); // satır ayırıcı
const RLO = String.fromCharCode(0x202e); // sağdan-sola geçersiz kılma

const hostile = {
  ticket_id: "-O<script>alert(1)</script>",
  ticket_number: `SUP-<img src=x onerror=alert(1)>\r\nBcc: evil@evil.com${LS}X-Injected: 1`,
  title: "<script>alert('x')</script> \"quoted\" & <b>bold</b> </td></tr></table><h1>PHISH</h1>",
  status: "<b>in_progress</b>",
  priority: "javascript:alert(1)",
  company_name: 'Evil" onmouseover="alert(1)',
  user_name: '<a href="https://evil.example">Tıkla</a>',
  note: '<a href="https://evil.example/login">Oturumunuz sona erdi, tıklayın</a>\nhttps://evil.example/phish\r\nSecond line <script>1</script>' + RLO + "gnp.exe",
  author_name: "<img src=x onerror=alert(2)>",
  at: "<script>",
  portalUrl: "javascript:alert(1)",
  privacyUrl: "javascript:alert(3)",
  name: "<i>Ad</i>",
  email: "<b>x</b>@y.com",
  password: "<script>alert(1)</script>\"'&",
  loginUrl: "javascript:alert(1)",
  setPasswordUrl: "javascript:alert(4)",
  day: "<b>2026</b>",
  count: "<x>",
  items: [{ event: "<script>", audience: "staff", ticket_number: "<img>", title: "<script>" }],
};

function contentOf(html) {
  return html.replace(/<head>[\s\S]*<\/head>/, "");
}

test("her tip × kitle × düşmanca girdi: ham HTML enjeksiyonu yok, bağlantılar güvenli, konu tek satır", () => {
  for (const type of TEMPLATE_TYPES) {
    for (const audience of ["customer", "staff"]) {
      const b = buildEmail(type, { ...hostile, audience });
      assert.ok(!b.error, `${type}: ${b.error}`);
      const label = `${type}/${audience}`;
      const body = contentOf(b.html);
      assert.doesNotMatch(body, /<script/i, `${label}: ham <script>`);
      assert.doesNotMatch(body, /<img src=x/i, `${label}: ham <img onerror>`);
      assert.doesNotMatch(body, /<a href="https:\/\/evil/i, `${label}: sahte bağlantı`);
      assert.doesNotMatch(body, /href="javascript:/i, `${label}: javascript: href`);
      assert.doesNotMatch(body, /onmouseover="alert/i, `${label}: nitelik enjeksiyonu`);
      assert.doesNotMatch(body, /<h1>PHISH/i, `${label}: tablo kırma`);
      assert.doesNotMatch(b.subject, /[\r\n\u2028\u2029]/, `${label}: konu çok satırlı`);
      assert.ok(Array.from(b.subject).length <= 150, `${label}: konu uzun`);
      assert.doesNotMatch(b.subject, /Bcc:.*\n/);
      assert.doesNotMatch(b.html + b.text, new RegExp(`[${String.fromCharCode(0x202a)}-${RLO}]`), `${label}: bidi karakteri`);
      // tüm href'ler https (ya da geliştirmede localhost)
      (b.html.match(/href="([^"]*)"/g) || []).forEach((h) => assert.match(h, /^href="https:\/\/[^"]+"$/, `${label}: ${h}`));
    }
  }
});

test("her tip için düz metin alternatifi var ve başlık + bağlantı + altbilgi içerir", () => {
  for (const type of TEMPLATE_TYPES) {
    for (const audience of ["customer", "staff"]) {
      const b = buildEmail(type, { ...realistic, audience, email: "yeni@x.com", name: "Yeni", day: "2026-10-05", count: 1, items: [] });
      assert.ok(b.text && b.text.length > 80, `${type}: text boş`);
      assert.match(b.text, /yanıtlamayın|beklemiyorsanız/, `${type}: yanıt notu`);
      assert.match(b.text, /KVKK/, `${type}: KVKK satırı`);
      assert.doesNotMatch(b.text, /<[a-z][^>]*>/i, `${type}: düz metinde HTML etiketi`);
      if (/ticket|send_to/.test(type)) assert.match(b.text, /https:\/\/www\.parlabilgiteknolojileri\.net\/support-v2\/(admin|customer)\/ticket-detail\.html\?id=/, type);
    }
  }
});

test("[EML-07] user_credentials: parola YOK; düz metin kullanıcı adı + giriş bağlantısı + 'şifre belirleme' yönergesi içerir", () => {
  const b = buildEmail("user_credentials", { email: "yeni@ornekholding.com", name: "Yeni Kişi", password: "Gecici#123-ASLA", portalUrl: realistic.portalUrl });
  assert.doesNotMatch(b.html + b.text, /Gecici#123|ASLA/);
  assert.match(b.text, /yeni@ornekholding\.com/);
  assert.match(b.text, /support-v2\/login\.html/);
  assert.match(b.text, /şifre belirleme/i);
  assert.match(b.text, /Şifremi Unuttum/);
  assert.match(b.text, /hiçbir zaman şifre istemez/);
  assert.match(b.html, /Yeni Kişi/);
  // Sunucu ileride güvenli bir şifre belirleme bağlantısı üretirse (yalnızca https) düğme o olur
  const withLink = buildEmail("user_credentials", { email: "a@b.com", setPasswordUrl: "https://parla-bt-web.firebaseapp.com/__/auth/action?oobCode=abc" });
  assert.match(withLink.text, /Şifremi belirle: https:\/\/parla-bt-web\.firebaseapp\.com/);
});

test("[EML-24] konu: CR/LF/denetim karakteri temizlenir, 150 karakterle sınırlanır, başlığın ilk 40 karakteri eklenir", () => {
  const s = cleanSubject(`Yeni\r\nBcc: x@y.com\t${"A".repeat(500)}`);
  assert.doesNotMatch(s, /[\r\n\t]/);
  assert.ok(Array.from(s).length <= 150);
  const b = buildEmail("ticket_message", { ...realistic, title: "Çok uzun bir başlık ".repeat(10), audience: "staff" });
  assert.match(b.subject, /^Yeni yanıt · SUP-ORN-SD-2610-0001 · Çok uzun bir başlık/);
  assert.ok(Array.from(b.subject).length <= 150);
  assert.equal(cleanSubject(""), "Parla BT");
});

test("[EML-25] durum/öncelik etiketleri portal (ticket-utils.js) ile birebir aynı", async () => {
  globalThis.window = globalThis.window || {};
  const utils = await import("../../assets/js/support-v2/ticket-utils.js");
  assert.deepEqual(STATUS_LABELS, utils.STATUS_LABELS, "durum etiketleri portalla uyuşmuyor");
  const portalPriority = utils.PRIORITY_LABELS;
  if (portalPriority) assert.deepEqual(PRIORITY_LABELS, portalPriority, "öncelik etiketleri portalla uyuşmuyor");
  const b = buildEmail("ticket_status_changed", { ...realistic, status: "waiting_customer", audience: "customer" });
  assert.match(b.html, /Müşteri Bekleniyor/);
  assert.doesNotMatch(b.html, /Müşteri Testinde|Yeni \/ Atama Bekliyor|Danışmana Atandı/);
});

test("[EML-25] kitleye göre metin: danışmana 'Talebiniz çözüldü' denmez; müşteriye personel metni gitmez", () => {
  const staff = buildEmail("ticket_resolved", { ...realistic, audience: "staff" });
  const customer = buildEmail("ticket_resolved", { ...realistic, audience: "customer" });
  assert.doesNotMatch(staff.text, /Talebiniz/);
  assert.match(customer.text, /Talebiniz çözüldü/);
  const startedStaff = buildEmail("ticket_status_changed", { ...realistic, audience: "staff" });
  assert.doesNotMatch(startedStaff.text, /Talebinizin/);
  assert.match(buildEmail("ticket_reopened", { ...realistic, audience: "customer" }).text, /Talebiniz tekrar açıldı/);
  assert.match(buildEmail("ticket_reopened", { ...realistic, audience: "staff" }).text, /Talep tekrar açıldı/);
});

test("[EML-19] uzun boşluksuz metin taşmaz: word-break/overflow-wrap + table-layout:fixed + max-width", () => {
  const long = "https://ornek.com/" + "a".repeat(400);
  const b = buildEmail("ticket_message", { ...realistic, title: "A".repeat(300), note: long, audience: "staff" });
  assert.match(b.html, /overflow-wrap:anywhere/);
  assert.match(b.html, /word-break:break-word/);
  assert.match(b.html, /table-layout:fixed/);
  assert.match(b.html, /max-width:600px/);
  assert.match(b.html, /width:100%;max-width:600px/);
  assert.match(b.html, /@media only screen and \(max-width:620px\)/);
});

test("[EML-29] preheader (mso-hide + dolgu), Outlook VML düğmesi, düz bağlantı yedeği, yeterli kontrast", () => {
  const b = buildEmail("ticket_message", { ...realistic, audience: "customer" });
  assert.match(b.html, /mso-hide:all/);
  assert.match(b.html, /(&zwnj;&nbsp;){20,}/, "preheader dolgusu");
  assert.match(b.html, /<v:roundrect[^>]*href="https:\/\/www\.parlabilgiteknolojileri\.net\/support-v2\/customer\/ticket-detail\.html\?id=/);
  assert.match(b.html, /<!--\[if !mso\]><!-- -->/);
  assert.match(b.html, /Düğme çalışmıyorsa/);
  assert.doesNotMatch(b.html, /#9CA3AF/i, "düşük kontrastlı altbilgi rengi kalmamalı");
  assert.match(b.html, /<title>Talebinize yeni yanıt geldi<\/title>/);
});

test("[EML-35] KVKK altbilgisi, yanıt vermeyin notu; geçerli PRIVACY_URL bağlantısı; yazan + tarih (Europe/Istanbul)", () => {
  const b = buildEmail("ticket_message", { ...realistic, audience: "customer", privacyUrl: "https://www.parlabilgiteknolojileri.net/kvkk.html" });
  assert.match(b.html, /6698 sayılı KVKK/);
  assert.match(b.html, /Lütfen bu e-postayı yanıtlamayın; yanıtınız talebe eklenmez/);
  assert.match(b.html, /href="https:\/\/www\.parlabilgiteknolojileri\.net\/kvkk\.html"[^>]*>Aydınlatma metni/);
  assert.match(b.text, /Yazan: Mehmet Kaya · 6 Eki 2026 13:00/, "10:00Z = 13:00 İstanbul");
  const noLink = buildEmail("ticket_message", { ...realistic, audience: "customer" });
  assert.match(noLink.html, /info@parlabilgiteknolojileri\.net adresine yazabilirsiniz/);
});

test("[SEN-31] kesme: kod noktası/grapheme bazlı, emoji ve bileşik emoji bölünmez, 'devamı portalda' eklenir", () => {
  const family = "👨‍👩‍👧‍👦"; // ZWJ dizisi
  const cut = truncateText(`${"a".repeat(499)}${family}${family}`, 500);
  assert.equal(cut.truncated, true);
  assert.equal(cut.text, "a".repeat(499) + family, "bileşik emoji tek birim");
  assert.equal(truncateText("kısa", 500).truncated, false);
  const emoji = truncateText("😀".repeat(600), 500);
  assert.equal(Array.from(emoji.text).length, 500);
  const b = buildEmail("ticket_message", { ...realistic, note: `${"x".repeat(499)}😀😀 son`, audience: "staff" });
  assert.match(b.text, new RegExp(`😀${TRUNCATION_SUFFIX.replace(/[().]/g, "\\$&")}`));
  assert.doesNotMatch(b.html + b.text, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  assert.doesNotMatch(buildEmail("ticket_message", { ...realistic, note: "kısa not", audience: "staff" }).text, /devamı portalda/);
});

test("bağlantı kökü: yalnızca https origin (geliştirmede http://localhost); kimlik bilgili/şemasız/javascript marka adresine düşer", () => {
  for (const bad of ["javascript:alert(1)", "//evil.com", "ftp://x.com", "https://u:p@evil.com", "", "not a url", "http://evil.com"]) {
    const b = buildEmail("ticket_message", { ...realistic, portalUrl: bad, audience: "staff" });
    assert.match(b.text, /^.*https:\/\/www\.parlabilgiteknolojileri\.net\/support-v2\/admin\/ticket-detail\.html\?id=/m, bad);
    assert.doesNotMatch(b.html + b.text, /evil\.com/, bad);
  }
  assert.match(buildEmail("ticket_message", { ...realistic, portalUrl: "https://destek.parla.com/yol", audience: "staff" }).text, /https:\/\/destek\.parla\.com\/support-v2\/admin/);
  assert.match(buildEmail("ticket_message", { ...realistic, portalUrl: "http://localhost:8888", audience: "staff" }).text, /http:\/\/localhost:8888\/support-v2/);
});

test("ticket_id URL'de kodlanır; eksik alanlarla (yalnızca ticket_id) tüm tipler üretilir", () => {
  const b = buildEmail("ticket_message", { ticket_id: "a b/c?d", audience: "staff" });
  assert.match(b.html, /ticket-detail\.html\?id=a%20b%2Fc%3Fd/);
  for (const type of TEMPLATE_TYPES) {
    const r = buildEmail(type, { ticket_id: "T1", audience: "customer" });
    assert.ok(!r.error && r.subject && r.html && r.text, type);
  }
});

test("ölü şablonlar kaldırıldı; bilinmeyen tip hata döner; yanıt adresi sabit", () => {
  assert.equal(buildEmail("contact_form", {}).error, "Bilinmeyen e-posta tipi.");
  assert.equal(buildEmail("career_form", {}).error, "Bilinmeyen e-posta tipi.");
  assert.equal(buildEmail("ticket_message", { ...realistic, replyTo: "evil@evil.com", audience: "staff" }).replyTo, "info@parlabilgiteknolojileri.net");
});

test("günlük özet şablonu: gün, adet ve kalemler (kaçışlı)", () => {
  const b = buildEmail("daily_digest", {
    day: "2026-10-05",
    count: 2,
    items: [
      { event: "ticket_message", audience: "customer", ticket_number: "SUP-1", title: "Başlık <b>1</b>" },
      { event: "ticket_status_changed", audience: "staff", ticket_number: "SUP-2", title: "İkinci" },
    ],
  });
  assert.match(b.subject, /günlük özet \(2026-10-05\)/);
  assert.match(b.text, /Yeni yanıt \(müşteriye\): SUP-1 · Başlık <b>1<\/b>/);
  assert.match(b.html, /Başlık &lt;b&gt;1&lt;\/b&gt;/);
  assert.match(b.html, /2 bildirim/);
});
