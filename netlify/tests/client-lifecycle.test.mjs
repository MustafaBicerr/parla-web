/**
 * Talep yaşam döngüsü testleri (WP-06/07/10 istemci): durum makinesi, damgalar, SLA (sahte saat),
 * İstanbul saat dilimi, efor doğrulama ve updateTicket/atama/silme akışları (bellek içi DB).
 * Çalıştırma: node --test netlify/tests/client-lifecycle.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createMemDb, installFirebase } from "./helpers/memdb.mjs";

globalThis.window = {};
const U = await import("../../assets/js/support-v2/ticket-utils.js");
const { default: ParlaDb } = await import("../../assets/js/support-v2/firebase-client.js");

const H = 3600000;
const T0 = Date.parse("2026-10-05T08:00:00.000Z");
const at = (hours) => new Date(T0 + hours * H).toISOString();
const base = (o) => ({ ticket_type: "SUP", priority: "high", status: "in_progress", created_at: at(0), first_response_at: at(1), ...o });

/* ------------------------------------------------------------------ durum makinesi */

const ALL = Object.values(U.STATUSES);
const EXPECTED = {
  open: ["assigned"],
  assigned: ["in_progress", "open"],
  in_progress: ["waiting_customer", "pending_close", "resolved"],
  waiting_customer: ["in_progress", "pending_close"],
  pending_close: ["in_progress", "resolved", "closed", "reopened"],
  resolved: ["closed", "in_progress", "reopened"],
  closed: ["reopened"],
  reopened: ["in_progress", "waiting_customer", "pending_close"],
};

test("durum makinesi: tüm (from,to) çiftleri beklenen tabloyla uyumlu (personel)", () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const expected = from === to || EXPECTED[from].includes(to);
      assert.equal(U.isTransitionAllowed(from, to, { role: "super_admin" }), expected, `${from} -> ${to}`);
    }
  }
});

test("durum makinesi: danışman yalnız işlemde/müşteri bekleniyor/kapanış onayı hedeflerine geçer", () => {
  assert.deepEqual(U.allowedTransitions("in_progress", { role: "consultant" }), ["waiting_customer", "pending_close"]);
  assert.deepEqual(U.allowedTransitions("closed", { role: "consultant" }), [], "yeniden açma yöneticidedir");
  assert.deepEqual(U.allowedTransitions("pending_close", { role: "consultant" }), ["in_progress"]);
  assert.equal(U.isTransitionAllowed("in_progress", "closed", { role: "service_admin" }), false);
});

test("durum makinesi: müşteri geçişleri kurallarla aynı; atamasız açık talep işleme alınamaz", () => {
  const c = { actor: "customer" };
  assert.deepEqual(U.allowedTransitions("waiting_customer", c), ["in_progress"]);
  assert.deepEqual(U.allowedTransitions("pending_close", c), ["closed", "reopened"]);
  assert.deepEqual(U.allowedTransitions("resolved", c), ["closed", "reopened"]);
  assert.deepEqual(U.allowedTransitions("closed", c), ["reopened"]);
  assert.deepEqual(U.allowedTransitions("in_progress", c), []);
  assert.deepEqual(U.allowedTransitions("open", {}), ["assigned"], "PER-43: atamasız açık talep işlemde olamaz");
  assert.ok(U.allowedTransitions("open", { hasAssignee: true }).includes("in_progress"), "eski kayıt: danışmanı olan açık talep");
});

test("durum açılırı: süper admin için matris dışı seçenekler ayrı listelenir", () => {
  const sa = U.statusSelectOptions("in_progress", { role: "super_admin" });
  assert.deepEqual(sa.allowed, ["waiting_customer", "pending_close", "resolved"]);
  assert.deepEqual(sa.override.sort(), ["assigned", "closed", "open", "reopened"].sort());
  const svc = U.statusSelectOptions("in_progress", { role: "service_admin" });
  assert.deepEqual(svc.override, []);
});

/* ------------------------------------------------------------------ damgalar */

test("damgalar: kapanış onayına ilk geçiş resolved_at yazar, geri alınca temizler, tekrar geçişte yeniden yazar", () => {
  let t = base({});
  let s = U.computeStatusStamps(t, "pending_close", at(10));
  assert.equal(s.resolved_at, at(10));
  assert.equal(s.closed_at, undefined);
  t = { ...t, status: "pending_close", ...s };
  s = U.computeStatusStamps(t, "in_progress", at(12));
  assert.equal(s.resolved_at, null, "geri alma çözüm damgasını siler");
  t = { ...t, status: "in_progress", resolved_at: undefined };
  s = U.computeStatusStamps(t, "pending_close", at(20));
  assert.equal(s.resolved_at, at(20));
});

test("damgalar: pending_close -> resolved çözüm zamanını ezmez; kapanış closed_at + closed_at_ms yazar", () => {
  const t = base({ status: "pending_close", resolved_at: at(10) });
  assert.equal(U.computeStatusStamps(t, "resolved", at(11)).resolved_at, undefined);
  const s = U.computeStatusStamps({ ...t, status: "resolved" }, "closed", at(12));
  assert.equal(s.closed_at, at(12));
  assert.equal(s.closed_at_ms, Date.parse(at(12)));
  assert.equal(s.resolved_at, undefined, "çözüm damgası korunur");
  // doğrudan işlemden kapatma (matris dışı) çözüm damgasını da yazar
  assert.equal(U.computeStatusStamps(base({}), "closed", at(5)).resolved_at, at(5));
});

test("damgalar: yeniden açma reopened_at yazar, closed_at/resolved_at temizler; kapalıdan başka duruma geçişte closed_at silinir", () => {
  const closed = base({ status: "closed", resolved_at: at(10), closed_at: at(11), closed_at_ms: Date.parse(at(11)) });
  const s = U.computeStatusStamps(closed, "reopened", at(30));
  assert.equal(s.reopened_at, at(30));
  assert.equal(s.closed_at, null);
  assert.equal(s.closed_at_ms, null);
  assert.equal(s.resolved_at, null);
  const back = U.computeStatusStamps(closed, "in_progress", at(30)); // SEN-03: yönetici formundan "Kapandı -> işlemde"
  assert.equal(back.closed_at, null);
  assert.equal(back.resolved_at, null);
});

test("damgalar: started_at yalnız ilk işleme alınışta; müşteri yalnız izinli damgaları üretir", () => {
  assert.equal(U.computeStatusStamps(base({ status: "assigned" }), "in_progress", at(2)).started_at, at(2));
  assert.equal(U.computeStatusStamps(base({ status: "reopened", started_at: at(1) }), "in_progress", at(40)).started_at, undefined);
  const cust = U.computeStatusStamps(base({ status: "pending_close", resolved_at: at(10) }), "closed", at(12), { isCustomer: true });
  assert.deepEqual(Object.keys(cust).sort(), ["closed_at", "closed_at_ms"]);
  const reopen = U.computeStatusStamps(base({ status: "pending_close", resolved_at: at(10) }), "reopened", at(12), { isCustomer: true });
  assert.deepEqual(Object.keys(reopen), ["reopened_at"], "müşteri resolved_at yazmaz/silmez");
});

test("damgalar: aynı duruma 'geçiş' damga üretmez", () => {
  assert.deepEqual(U.computeStatusStamps(base({}), "in_progress", at(3)), {});
});

/* ------------------------------------------------------------------ SLA (sahte saat) */

test("SLA: ilk yanıt ve çözüm hedefleri, öncelik tabloları", () => {
  const t = base({ priority: "medium", first_response_at: undefined });
  assert.equal(U.computeSla(t, T0 + 7 * H).response.state, "pending");
  assert.equal(U.computeSla(t, T0 + 9 * H).response.state, "breached");
  assert.equal(U.computeSla({ ...t, first_response_at: at(1) }, T0 + 9 * H).response.state, "met");
  assert.equal(U.computeSla({ ...t, first_response_at: at(9) }, T0 + 10 * H).response.state, "late");
  assert.equal(U.computeSla({ ...t, ticket_type: "INT" }, T0), null);
});

test("SLA: müşteri bekleniyor süresi GERÇEKTEN ertelenir (kapanmış duraklama toplanır)", () => {
  // yüksek öncelik: çözüm 24 sa. 2. saatten 50. saate kadar müşteri bekleniyor (48 sa duraklama).
  const t = base({ sla_window: at(0), sla_paused_ms: 48 * H });
  const sla = U.computeSla(t, T0 + 60 * H);
  assert.equal(sla.resolution.state, "pending", "duraklama olmasa 36 saat geçmiş olurdu (aşım)");
  assert.equal(sla.resolution.remainingMs, 12 * H);
  assert.equal(U.computeSla({ ...t, sla_paused_ms: 0 }, T0 + 60 * H).resolution.state, "breached", "kontrol: duraklama yoksa aşım");
});

test("SLA: süren duraklamada kalan süre donuk kalır", () => {
  const t = base({ status: "waiting_customer", sla_window: at(0), sla_paused_since: at(2) });
  const a = U.computeSla(t, T0 + 30 * H);
  const b = U.computeSla(t, T0 + 100 * H);
  assert.equal(a.paused, true);
  assert.equal(a.resolution.remainingMs, 22 * H);
  assert.equal(b.resolution.remainingMs, 22 * H, "100. saatte de aynı");
  assert.equal(b.resolution.state, "pending");
});

test("SLA: eski kayıtta duraklama başlangıcı son herkese açık hareket zamanından kestirilir", () => {
  const t = base({ status: "waiting_customer", public_updated_at: at(10) });
  const sla = U.computeSla(t, T0 + 40 * H);
  assert.equal(sla.paused, true);
  assert.equal(sla.pausedMs, 30 * H);
  assert.equal(sla.resolution.remainingMs, (24 + 30 - 40) * H);
});

test("SLA: çözüm = kapanış onayına ilk geçiş; müşteri onayı beklerken saat işlemez, geç çözüm ihlal olarak kalır", () => {
  const inTime = base({ status: "pending_close", resolved_at: at(10), sla_window: at(0), sla_paused_since: at(10) });
  for (const hour of [11, 100, 1000]) {
    const sla = U.computeSla(inTime, T0 + hour * H);
    assert.equal(sla.resolution.state, "met", `${hour}. saatte hâlâ karşılandı`);
    assert.equal(sla.breached, false);
    assert.equal(sla.paused, true);
  }
  const late = base({ status: "pending_close", resolved_at: at(30), sla_window: at(0), sla_paused_since: at(30), sla_resolution_breached_at: at(24) });
  assert.equal(U.computeSla(late, T0 + 500 * H).resolution.state, "late");
  assert.equal(U.computeSla(late, T0 + 500 * H).breached, true);
  // müşteri onayıyla kapanınca (closed_at çok sonra) çözüm hâlâ resolved_at'a göre ölçülür
  const closed = { ...inTime, status: "closed", closed_at: at(200) };
  assert.equal(U.computeSla(closed, T0 + 300 * H).breached, false, "müşterinin onay gecikmesi personele yazılmaz");
});

test("SLA: yeniden açmada yeni pencere; eski resolved_at/closed_at yok sayılır", () => {
  const t = base({
    status: "reopened",
    resolved_at: at(10),
    closed_at: at(11),
    reopened_at: at(100),
    first_response_at: at(1),
  });
  let sla = U.computeSla(t, T0 + 110 * H);
  assert.equal(sla.resolution.state, "pending");
  assert.equal(sla.resolution.remainingMs, 14 * H, "yeni pencere: 100. saat + 24 sa");
  assert.equal(sla.active, true);
  sla = U.computeSla(t, T0 + 130 * H);
  assert.equal(sla.resolution.state, "breached");
  // eski pencereden kalan duraklama değerleri yeni pencerede sayılmaz
  const stale = { ...t, sla_window: at(0), sla_paused_ms: 40 * H };
  assert.equal(U.computeSla(stale, T0 + 110 * H).resolution.remainingMs, 14 * H);
});

test("SLA: öncelik düşürmek geriye dönük aşımı silmez (ihlal damgası)", () => {
  const critical = base({ priority: "critical", first_response_at: at(0.5) }); // çözüm hedefi 8 sa
  const nowMs = T0 + 9 * H;
  assert.equal(U.computeSla(critical, nowMs).resolution.state, "breached");
  // güncelleme anında ihlal damgalanır
  const patch = U.buildSlaPatch(critical, { priority: "low" }, new Date(nowMs).toISOString());
  assert.equal(patch.sla_resolution_breached_at, at(8));
  const after = { ...critical, priority: "low", ...patch };
  const sla = U.computeSla(after, T0 + 10 * H);
  assert.equal(sla.resolution.state, "breached", "öncelik low olsa da ihlal kalır");
  assert.equal(sla.resolution.dueMs, T0 + 8 * H);
  // kontrol: damgasız düşük öncelik aşımı siler (eski hata)
  assert.equal(U.computeSla({ ...critical, priority: "low" }, T0 + 10 * H).resolution.state, "pending");
});

test("SLA: geç ilk yanıt ihlal damgası; pencere/duraklama yazımları (buildSlaPatch)", () => {
  const t = base({ priority: "high", first_response_at: undefined }); // ilk yanıt hedefi 4 sa
  const p = U.buildSlaPatch(t, {}, at(5));
  assert.equal(p.sla_response_breached_at, at(4));

  // işlemde -> müşteri bekleniyor: duraklama başlar
  let cur = base({});
  let patch = U.buildSlaPatch(cur, { status: "waiting_customer" }, at(2));
  assert.equal(patch.sla_paused_since, at(2));
  cur = { ...cur, status: "waiting_customer", ...patch };
  // müşteri bekleniyor -> kapanış onayı: duraklama sürer (kesintisiz) ve çözüm damgası ayrıca yazılır
  patch = U.buildSlaPatch(cur, { status: "pending_close" }, at(10));
  assert.equal(patch?.sla_paused_ms, undefined, "duraklama kesintisiz sürüyor");
  cur = { ...cur, status: "pending_close", resolved_at: at(10), ...(patch || {}) };
  // kapanış onayı -> işleme geri al: 2..12 saat arası duraklama toplanır, çözüm geri alınır
  patch = U.buildSlaPatch(cur, { status: "in_progress" }, at(12));
  assert.equal(patch.sla_paused_ms, 10 * H);
  assert.equal(patch.sla_paused_since, null);
  // yeniden açma yeni pencere açar
  const reopened = U.buildSlaPatch({ ...cur, status: "closed", closed_at: at(13) }, { status: "reopened" }, at(50));
  assert.equal(reopened.sla_window, at(50));
  assert.equal(reopened.sla_paused_ms ?? 0, 0);
  assert.equal(reopened.sla_paused_since, null, "yeni pencerede eski duraklama başlangıcı kalmaz");
});

test("SLA: müşteri tarafından bitirilen duraklama bir sonraki personel yazımında kesinleşir", () => {
  const cur = base({ status: "in_progress", sla_window: at(0), sla_paused_since: at(2), public_updated_at: at(20) });
  // geçmişten bilinen gerçek bitiş 8. saat
  const exact = U.buildSlaPatch(cur, { priority: "high" }, at(30), { pauseEndIso: at(8) });
  assert.equal(exact.sla_paused_ms, 6 * H);
  assert.equal(exact.sla_paused_since, null);
  // geçmiş yoksa son herkese açık hareket zamanı kullanılır
  const approx = U.buildSlaPatch(cur, { priority: "high" }, at(30));
  assert.equal(approx.sla_paused_ms, 18 * H);
  // kesinleşmeden de gösterim aynı yaklaşık değeri kullanır
  assert.equal(U.computeSla(cur, T0 + 30 * H).pausedMs, 18 * H);
});

test("SLA: rozet metni tek kaynaktan (describeSla)", () => {
  const paused = U.describeSla(base({ status: "waiting_customer", public_updated_at: at(1) }), T0 + 3 * H);
  assert.match(paused.text, /duraklatıldı/);
  const closed = U.describeSla(base({ status: "closed", resolved_at: at(5), closed_at: at(6) }), T0 + 50 * H);
  assert.equal(closed.text, "SLA karşılandı");
  const breach = U.describeSla(base({ priority: "critical", first_response_at: at(0.5) }), T0 + 9 * H);
  assert.match(breach.text, /Çözüm aşıldı \+1 sa/);
  assert.equal(U.describeSla(base({ ticket_type: "PRJ" }), T0), null);
});

test("pano/rapor ortak tanımları: bugün kapanan yalnız closed_at'a, bu ay çözülen çözüm damgasına bakar (İstanbul)", () => {
  const now = new Date("2026-10-01T10:00:00+03:00");
  // 30 Eylül 21:30Z = 1 Ekim 00:30 İstanbul
  assert.equal(U.isClosedToday({ status: "closed", closed_at: "2026-09-30T21:30:00Z" }, now), true);
  assert.equal(U.isClosedToday({ status: "closed", closed_at: "2026-09-30T20:30:00Z" }, now), false, "İstanbul'da 30 Eylül 23:30");
  assert.equal(U.isClosedToday({ status: "in_progress", closed_at: "2026-10-01T05:00:00Z" }, now), false, "artık kapalı değil");
  assert.equal(U.isClosedToday({ status: "closed", updated_at: now.toISOString() }, now), false, "güncelleme zamanı sayılmaz");
  assert.equal(U.isResolvedThisMonth({ status: "closed", resolved_at: "2026-10-01T00:10:00+03:00" }, now), true);
  assert.equal(U.isResolvedThisMonth({ status: "closed", resolved_at: "2026-09-10T10:00:00Z", closed_at: "2026-09-12T10:00:00Z", updated_at: now.toISOString() }, now), false);
  assert.equal(U.isResolvedThisMonth({ status: "pending_close", resolved_at: "2026-10-01T05:00:00Z" }, now), false, "onay bekleyen henüz çözülmüş sayılmaz");
  const t = { status: "closed", created_at: "2026-10-01T00:00:00Z", resolved_at: "2026-10-01T10:00:00Z", closed_at: "2026-10-03T00:00:00Z" };
  assert.equal(U.resolutionDurationMs(t), 10 * H, "çözüm süresi resolved_at'e göre (müşteri onay gecikmesi hariç)");
  assert.equal(U.resolutionDurationMs({ status: "in_progress", created_at: t.created_at }), null);
});

test("customerLifecycle: sayısal 'now' kullanılır", () => {
  const closed = { status: "closed", closed_at: at(0) };
  assert.equal(U.customerLifecycle(closed, T0 + 13 * 24 * H).canReopen, true);
  assert.equal(U.customerLifecycle(closed, T0 + 15 * 24 * H).canReopen, false);
});

/* ------------------------------------------------------------------ saat dilimi / numara / efor */

test("İstanbul saat dilimi: ay kodu ve takvim günü tarayıcı/UTC'den bağımsız", () => {
  assert.equal(U.getYymm(new Date("2026-09-30T22:30:00Z")), "2610", "İstanbul 1 Ekim 01:30");
  assert.equal(U.getYymm(new Date("2026-09-30T20:59:00Z")), "2609");
  assert.equal(U.istanbulDateISO(new Date("2026-10-31T21:30:00Z")), "2026-11-01");
  assert.equal(U.istanbulMonthKey(new Date("2026-10-31T20:59:59Z")), "2026-10");
  // Farklı işlem saat dilimlerinde aynı sonuç
  for (const tz of ["UTC", "America/New_York", "Pacific/Auckland"]) {
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `globalThis.window={};const u=await import(${JSON.stringify(new URL("../../assets/js/support-v2/ticket-utils.js", import.meta.url).href)});console.log(u.getYymm(new Date("2026-09-30T22:30:00Z"))+" "+u.istanbulDateISO(new Date("2026-09-30T22:30:00Z")));`],
      { env: { ...process.env, TZ: tz }, encoding: "utf8" }
    ).trim();
    assert.equal(out, "2610 2026-10-01", tz);
  }
});

test("ticket numarasındaki modül kodu ASCII ve büyük harf ('Diğer' -> DIGER)", () => {
  assert.equal(U.ticketModuleCode("Diğer"), "DIGER");
  assert.equal(U.ticketModuleCode("diğer"), "DIGER");
  assert.equal(U.ticketModuleCode("BASIS"), "BASIS");
  assert.equal(U.ticketModuleCode("FI"), "FI");
  assert.equal(U.ticketModuleCode(""), "DIGER");
  assert.ok(/^[A-Z0-9]+$/.test(U.ticketModuleCode("İş Ğüzel Şçö")));
});

test("efor doğrulama: sınırlar, adım, tarih (İstanbul) ve not", () => {
  const now = new Date("2026-10-01T10:00:00+03:00");
  const ok = U.validateEffortInput({ hours: "1.5", workDate: "2026-10-01", note: "x" }, now);
  assert.equal(ok.valid, true);
  assert.equal(ok.hours, 1.5);
  for (const bad of [0, -5, 0.1, 0.3, 24.25, 99999, "", "abc"]) {
    assert.equal(U.validateEffortInput({ hours: bad, workDate: "2026-10-01" }, now).valid, false, `saat ${bad}`);
  }
  assert.equal(U.validateEffortInput({ hours: 24, workDate: "2026-10-01" }, now).valid, true);
  assert.equal(U.validateEffortInput({ hours: 1, workDate: "2026-10-02" }, now).valid, false, "gelecek");
  assert.equal(U.validateEffortInput({ hours: 1, workDate: "2026-08-01" }, now).valid, false, "30 günden eski");
  assert.equal(U.validateEffortInput({ hours: 1, workDate: "2026-09-01" }, now).valid, true, "tam 30 gün");
  assert.equal(U.validateEffortInput({ hours: 1, workDate: "bugün" }, now).valid, false);
  assert.equal(U.validateEffortInput({ hours: 1, workDate: "2026-10-01", note: "a".repeat(501) }, now).valid, false);
  // gece 00:30 (İstanbul) girilen efor yeni güne yazılır (varsayılan tarih)
  assert.equal(U.validateEffortInput({ hours: 1 }, new Date("2026-09-30T21:30:00Z")).workDate, "2026-10-01");
  // yanıt kutusu: boş/0 efor yok, negatif geçersiz
  assert.deepEqual(U.validateReplyHours("0"), { valid: true, hours: 0, error: "" });
  assert.equal(U.validateReplyHours("").valid, true);
  assert.equal(U.validateReplyHours("-5").valid, false);
  assert.equal(U.validateReplyHours("1.25").hours, 1.25);
});

test("talep tipi kilidi: firma tipine göre müşteri tipleri", () => {
  assert.deepEqual(U.allowedCustomerTicketTypes("CUS"), ["SUP", "BUG"]);
  assert.deepEqual(U.allowedCustomerTicketTypes("ARC"), ["ARZ", "BUG"]);
  assert.equal(U.defaultCustomerTicketType("ARC"), "ARZ");
  assert.equal(U.resolveCustomerType("arizi_customer", "CUS"), "ARC");
  assert.equal(U.resolveCustomerType("company_admin", "ARC"), "ARC");
  assert.equal(U.resolveCustomerType("customer", undefined), "CUS");
});

test("personel eşleşmesi: önce uid, yoksa e-posta; durum kodu/etiketi normalize", () => {
  const list = [
    { id: "p1", email: "a@x.com", uid: "u1" },
    { id: "p2", email: "b@x.com" },
  ];
  assert.equal(U.findPersonnelForSession(list, { uid: "u1", email: "farkli@x.com" }).id, "p1");
  assert.equal(U.findPersonnelForSession(list, { uid: "u9", email: "B@X.com" }).id, "p2");
  assert.equal(U.findPersonnelForSession(list, { uid: "u9", email: "yok@x.com" }), null);
  assert.equal(U.normalizeStatusCode("Kapanış Onayı Bekliyor"), "pending_close");
  assert.equal(U.normalizeStatusCode("in_progress"), "in_progress");
});

/* ------------------------------------------------------------------ updateTicket / atama / silme (bellek içi DB) */

function seedDb(extra) {
  const mem = createMemDb({
    v2: {
      users: {},
      personnel: {
        p1: { personnel_id: "p1", first_name: "Zeynep", last_name: "Arslan", email: "zeynep@x.com", uid: "u_c1", is_active: true },
        p2: { personnel_id: "p2", first_name: "Can", last_name: "Öztürk", email: "can@x.com", uid: "u_c2", is_active: true },
        p3: { personnel_id: "p3", first_name: "Eşsiz", last_name: "Kişi", email: "essiz@x.com", is_active: true },
      },
      tickets: {
        t1: {
          ticket_id: "t1", ticket_number: "SUP-ORN-FI-2610-0001", ticket_type: "SUP", priority: "high", status: "open",
          title: "x", user_id: "uc", created_at: at(0), updated_at: at(0), assigned_to_id: "", assigned_to_name: "",
        },
      },
      ticket_assignments: {},
      ...(extra || {}),
    },
  });
  installFirebase(mem, { uid: "u_admin" });
  return mem;
}
const actor = { uid: "u_admin", name: "Yönetici", role: "service_admin" };
const historyRows = (mem, id = "t1") => Object.values(mem.getAt(`v2/ticket_history/${id}`) || {});

test("updateTicket: durum değişimi TEK geçmiş satırı (kod + not), damgalar ve aktivite aynı atomik yazımda", async () => {
  // notlu geçişin action'ı "status_note" (e-posta fonksiyonu notu bu kayıttan okur), notsuzunki "status_changed"
  const mem = seedDb();
  mem.setAt("v2/tickets/t1/status", "assigned");
  mem.setAt("v2/tickets/t1/assigned_to_id", "p1");
  const report = {};
  await ParlaDb.updateTicket("t1", { status: "in_progress" }, actor, { expectedStatus: "assigned", note: "İşleme alındı notu", activity: { action: "ticket_updated" }, report });
  const t = mem.getAt("v2/tickets/t1");
  assert.equal(t.status, "in_progress");
  assert.ok(t.started_at, "started_at yazıldı");
  assert.ok(t.first_response_at, "müşteriye iletilen notla ilk yanıt");
  const rows = historyRows(mem);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].action, rows[0].field_changed, rows[0].old_value, rows[0].new_value, rows[0].note], ["status_note", "status", "assigned", "in_progress", "İşleme alındı notu"]);
  assert.equal(report.statusHistoryId, rows[0].history_id, "e-posta için history_id döner");
  const updates = mem.state.log.filter((l) => l[0] === "update");
  assert.equal(updates.length, 1, "tek çok yollu update");
  assert.ok(updates[0][2].some((k) => k.startsWith("tickets/t1/")) && updates[0][2].some((k) => k.startsWith("ticket_history/t1/")) && updates[0][2].some((k) => k.startsWith("activities/")));
  assert.equal(Object.values(mem.getAt("v2/activities"))[0].details, "Durum: Atandı → İşlemde");
});

test("updateTicket: bayat ekran (expectedStatus) çakışma hatası verir; yarım kayıt/geçmiş yazılmaz", async () => {
  const mem = seedDb();
  mem.setAt("v2/tickets/t1/status", "in_progress");
  mem.setAt("v2/tickets/t1/assigned_to_id", "p1");
  const before = JSON.stringify(mem.state.tree);
  await assert.rejects(
    () => ParlaDb.updateTicket("t1", { status: "pending_close" }, actor, { expectedStatus: "assigned", note: "bayat ekran notu" }),
    (err) => err.code === "status_conflict" && /başka biri tarafından güncellendi/.test(err.message)
  );
  assert.equal(JSON.stringify(mem.state.tree), before, "veritabanı değişmedi");
});

test("updateTicket: izinsiz geçiş reddedilir; süper admin yalnız gerekçeyle matris dışına çıkabilir", async () => {
  const mem = seedDb();
  mem.setAt("v2/tickets/t1/status", "closed");
  await assert.rejects(() => ParlaDb.updateTicket("t1", { status: "in_progress" }, actor), (e) => e.code === "invalid_transition");
  const sa = { ...actor, role: "super_admin" };
  await assert.rejects(() => ParlaDb.updateTicket("t1", { status: "in_progress" }, sa, { force: true }), (e) => e.code === "note_required");
  await ParlaDb.updateTicket("t1", { status: "in_progress" }, sa, { force: true, note: "Hatalı kapatıldı, yeniden işleme alınıyor" });
  assert.equal(mem.getAt("v2/tickets/t1/status"), "in_progress");
  assert.equal(mem.getAt("v2/tickets/t1/closed_at"), undefined);
});

test("updateTicket: çözme -> müşteri onayı -> yeniden açma -> geri alma damga zinciri", async () => {
  const mem = seedDb();
  mem.setAt("v2/tickets/t1", { ...mem.getAt("v2/tickets/t1"), status: "in_progress", assigned_to_id: "p1", first_response_at: at(1) });
  const staff = { uid: "u_c1", name: "Zeynep", role: "consultant" };
  const customer = { uid: "uc", name: "Müşteri", role: "customer" };
  await ParlaDb.updateTicket("t1", { status: "pending_close" }, staff, { note: "Düzeltme yapıldı, onaylayın." });
  let t = mem.getAt("v2/tickets/t1");
  assert.ok(t.resolved_at && !t.closed_at);
  assert.ok(t.sla_paused_since, "kapanış onayı beklerken SLA durur");
  await ParlaDb.updateTicket("t1", { status: "closed" }, customer, { note: "Onaylıyorum" });
  t = mem.getAt("v2/tickets/t1");
  assert.ok(t.closed_at && t.closed_at_ms);
  const resolved = t.resolved_at;
  assert.ok(resolved);
  await ParlaDb.updateTicket("t1", { status: "reopened" }, { ...actor }, { note: "Yönetici yeniden açtı" });
  t = mem.getAt("v2/tickets/t1");
  assert.ok(t.reopened_at);
  assert.equal(t.closed_at, undefined);
  assert.equal(t.closed_at_ms, undefined);
  assert.equal(t.resolved_at, undefined);
  await ParlaDb.updateTicket("t1", { status: "pending_close" }, staff, { note: "Tekrar çözüldü, onaylayın" });
  t = mem.getAt("v2/tickets/t1");
  assert.ok(t.resolved_at && t.resolved_at !== resolved, "yeni pencerede yeni çözüm damgası");
  await ParlaDb.updateTicket("t1", { status: "in_progress" }, staff, { note: "Çözüm geri alındı" });
  t = mem.getAt("v2/tickets/t1");
  assert.equal(t.resolved_at, undefined, "geri alma çözüm damgasını siler");
  assert.equal(t.sla_paused_since, undefined);
  const rows = historyRows(mem).filter((r) => r.field_changed === "status");
  assert.equal(rows.length, 5, "5 geçişin her biri TEK satır");
  assert.ok(rows.every((r) => ["status_note", "status_changed"].includes(r.action) && /^[a-z_]+$/.test(r.old_value) && /^[a-z_]+$/.test(r.new_value)), "eski/yeni değerler durum kodu");
});

test("müşteri çağrısı personel damgası yazmaz (kurallara uygun alan kümesi)", async () => {
  const mem = seedDb();
  mem.setAt("v2/tickets/t1", { ...mem.getAt("v2/tickets/t1"), status: "pending_close", assigned_to_id: "p1" });
  await ParlaDb.updateTicket("t1", { status: "closed" }, { uid: "uc", name: "M", role: "customer" }, { note: "tamam" });
  const touched = mem.state.log.filter((l) => l[0] === "update").flatMap((l) => l[2]).filter((k) => k.startsWith("tickets/t1/")).map((k) => k.split("/")[2]);
  const allowed = ["status", "closed_at", "closed_at_ms", "updated_at", "updated_by", "public_updated_at", "public_updated_by"];
  assert.ok(touched.every((k) => allowed.includes(k)), touched.join(","));
});

test("atama: birincil değişimi, ikincil ekleme/çıkarma tek satır + adlar; assigned_uids haritası; tümünü kaldırma", async () => {
  const mem = seedDb();
  const list = (primary, ids) => ids.map((id) => ({ personnel_id: id, is_primary: id === primary }));
  const report = {};
  await ParlaDb.assignConsultants("t1", list("p1", ["p1", "p2"]), actor, { report });
  let t = mem.getAt("v2/tickets/t1");
  assert.equal(t.status, "assigned");
  assert.deepEqual([t.assigned_to_id, t.assigned_to_name], ["p1", "Zeynep Arslan"]);
  assert.deepEqual(t.assigned_uids, { u_c1: true, u_c2: true });
  assert.deepEqual(report.newlyAssignedIds.sort(), ["p1", "p2"]);
  assert.equal(mem.getAt("v2/ticket_assignments/t1/p1").personnel_email, "zeynep@x.com");
  const assignedAt = mem.getAt("v2/ticket_assignments/t1/p1").assigned_at;

  // yalnız birincil değişir (PER-01)
  await ParlaDb.assignConsultants("t1", list("p2", ["p1", "p2"]), actor);
  t = mem.getAt("v2/tickets/t1");
  assert.deepEqual([t.assigned_to_id, t.assigned_to_name], ["p2", "Can Öztürk"]);
  assert.equal(mem.getAt("v2/ticket_assignments/t1/p1").is_primary, false);
  assert.equal(mem.getAt("v2/ticket_assignments/t1/p2").is_primary, true);
  assert.equal(mem.getAt("v2/ticket_assignments/t1/p1").assigned_at, assignedAt, "özgün atama zamanı korunur");
  const primaryRow = historyRows(mem).find((r) => r.action === "assigned_to_changed" && r.new_value === "Can Öztürk");
  assert.ok(primaryRow && primaryRow.old_value === "Zeynep Arslan", "adı çözülmüş tek satır");
  assert.ok(historyRows(mem).every((r) => !/^p\d$/.test(r.old_value) && !/^p\d$/.test(r.new_value)), "ham personel kimliği geçmişe yazılmaz");

  // ikincil çıkarma + uid haritası
  await ParlaDb.assignConsultants("t1", list("p2", ["p2"]), actor);
  t = mem.getAt("v2/tickets/t1");
  assert.deepEqual(t.assigned_uids, { u_c2: true });
  assert.equal(mem.getAt("v2/ticket_assignments/t1/p1"), undefined);
  assert.ok(historyRows(mem).some((r) => r.action === "assignment_removed" && r.old_value === "Zeynep Arslan"));

  // eşleşmeyen personel (uid yok): uyarı listesi
  const rep2 = {};
  await ParlaDb.assignConsultants("t1", list("p2", ["p2", "p3"]), actor, { report: rep2 });
  assert.deepEqual(rep2.unmatched, ["Eşsiz Kişi"]);
  assert.deepEqual(mem.getAt("v2/tickets/t1").assigned_uids, { u_c2: true });

  // tüm danışmanlar kaldırılır (PER-12): atama + harita + birincil temizlenir, "atandı" durumu açığa döner
  await ParlaDb.assignConsultants("t1", [], actor);
  t = mem.getAt("v2/tickets/t1");
  assert.equal(t.assigned_to_id, "");
  assert.equal(t.status, "open", "atandı durumu açığa döner");
  assert.deepEqual(t.assigned_uids || {}, {});
  assert.deepEqual(mem.getAt("v2/ticket_assignments/t1") || {}, {});
});

test("atama: pasif danışman ilgisiz güncellemede atamadan çıkmaz; eski kayıt (atama düğümü yok) sanal öğe ile birincil korunur", async () => {
  const mem = seedDb();
  mem.setAt("v2/personnel/p2/is_active", false);
  await ParlaDb.assignConsultants("t1", [{ personnel_id: "p1", is_primary: true }, { personnel_id: "p2", is_primary: false }], actor);
  // öncelik değişimi atama listesini içermez -> atamalar aynen kalır
  await ParlaDb.updateTicket("t1", { priority: "critical" }, actor, { expectedStatus: "assigned" });
  assert.ok(mem.getAt("v2/ticket_assignments/t1/p2"), "pasif danışman atamada kaldı");

  // eski tek danışman kaydı
  mem.setAt("v2/tickets/t9", { ticket_id: "t9", ticket_type: "SUP", status: "in_progress", created_at: at(0), assigned_to_id: "p1", assigned_to_name: "Zeynep Arslan", assigned_at: at(1) });
  const items = await ParlaDb.getTicketAssignments("t9");
  assert.equal(items.length, 1);
  assert.equal(items[0].virtual, true);
  await ParlaDb.backfillAssignmentEmails("t9", items, await ParlaDb.getAllPersonnel());
  const rec = mem.getAt("v2/ticket_assignments/t9/p1");
  assert.deepEqual([rec.personnel_name, rec.is_primary, rec.assigned_at, rec.personnel_email], ["Zeynep Arslan", true, at(1), "zeynep@x.com"], "tam kayıt (— — 0 satırı yok)");
});

test("yumuşak silme: is_deleted + geçmiş/aktivite; listeler gizler; geri yükleme; kalıcı silme 8 düğümü temizler", async () => {
  const mem = seedDb({
    ticket_messages: { t1: { m1: { message: "a" } } },
    ticket_internal_notes: { t1: { n1: { message: "b" } } },
    ticket_attachments: { t1: { a1: { data: "x" } } },
    ticket_internal_attachments: { t1: { a2: { data: "y" } } },
    ticket_history: { t1: { h1: { action: "created" } } },
    ticket_assignments: { t1: { p1: { personnel_id: "p1" } } },
    ticket_efforts: { t1: { e1: { hours: 1, personnel_id: "p1" } } },
    ticket_attachment_stats: { t1: { count: 1, bytes: 10 } },
  });
  mem.setAt("v2/tickets/t2", { ...mem.getAt("v2/tickets/t1"), ticket_id: "t2", user_id: "uc" });
  await ParlaDb.deleteTicket("t1", actor, { reason: "test" });
  const t = mem.getAt("v2/tickets/t1");
  assert.deepEqual([t.is_deleted, t.deleted_by], [true, "u_admin"]);
  assert.ok(t.deleted_at);
  assert.ok(historyRows(mem).some((r) => r.action === "ticket_deleted"));
  assert.ok(Object.values(mem.getAt("v2/activities")).some((a) => a.action === "ticket_deleted"));
  assert.deepEqual((await ParlaDb.getAllTickets()).map((x) => x.id), ["t2"], "listeler silinmişi gizler");
  assert.deepEqual((await ParlaDb.getAllTickets({ onlyDeleted: true })).map((x) => x.id), ["t1"]);
  assert.deepEqual((await ParlaDb.getTicketsForUser("uc")).map((x) => x.id), ["t2"], "müşteri sayfaları da gizler");
  await assert.rejects(() => ParlaDb.updateTicket("t1", { priority: "low" }, actor), (e) => e.code === "ticket_deleted");

  await ParlaDb.restoreTicket("t1", actor);
  assert.equal(mem.getAt("v2/tickets/t1/is_deleted"), false);
  assert.equal((await ParlaDb.getAllTickets()).length, 2);

  await ParlaDb.permanentlyDeleteTicket("t1", { ...actor, role: "super_admin" });
  for (const node of ["tickets", "ticket_messages", "ticket_internal_notes", "ticket_attachments", "ticket_internal_attachments", "ticket_history", "ticket_assignments", "ticket_efforts", "ticket_attachment_stats"]) {
    assert.equal(mem.getAt(`v2/${node}/t1`), undefined, node);
  }
  assert.ok(mem.getAt("v2/tickets/t2"), "diğer talep etkilenmez");
  assert.ok(Object.values(mem.getAt("v2/activities")).some((a) => a.action === "ticket_permanently_deleted"), "denetim izi kalır");
});

test("efor: doğrulama + atomik toplam; silme geçmişe iz bırakır", async () => {
  const mem = seedDb();
  await assert.rejects(() => ParlaDb.addTicketEffort("t1", { personnel_id: "p1", hours: -5 }, actor), (e) => e.code === "invalid_effort");
  await assert.rejects(() => ParlaDb.addTicketEffort("t1", { personnel_id: "p1", hours: 99999 }, actor), (e) => e.code === "invalid_effort");
  const e1 = await ParlaDb.addTicketEffort("t1", { personnel_id: "p1", personnel_name: "Zeynep", hours: 1.5, note: "iş" }, actor);
  assert.equal(e1.work_date, U.istanbulDateISO(new Date()), "varsayılan gün İstanbul takvimi");
  await ParlaDb.addTicketEffort("t1", { personnel_id: "p1", hours: 2 }, actor);
  assert.equal(mem.getAt("v2/tickets/t1/total_work_hours"), 3.5);
  await ParlaDb.deleteTicketEffort("t1", e1.id, actor);
  assert.equal(mem.getAt("v2/tickets/t1/total_work_hours"), 2);
  assert.ok(historyRows(mem).some((r) => r.action === "effort_deleted"));
  // mesajla birlikte negatif efor reddedilir, mesaj yazılmaz
  await assert.rejects(() => ParlaDb.addTicketMessage("t1", { user_id: "u_admin", author_role: "service_admin", message: "x", work_hours: -5 }), (e) => e.code === "invalid_effort");
  assert.equal(mem.getAt("v2/ticket_messages/t1"), undefined);
});

test("mesaj: ilk yanıt yalnız personelin herkese açık iletisiyle; mesaj + talep alanları tek atomik yazım", async () => {
  const mem = seedDb();
  await ParlaDb.addTicketMessage("t1", { user_id: "u_admin", author_role: "service_admin", message: "iç", is_internal: true });
  assert.equal(mem.getAt("v2/tickets/t1/first_response_at"), undefined, "iç not ilk yanıt değil");
  await ParlaDb.addTicketMessage("t1", { user_id: "uc", author_role: "customer", message: "müşteri" });
  assert.equal(mem.getAt("v2/tickets/t1/first_response_at"), undefined, "müşteri mesajı ilk yanıt değil");
  const before = mem.state.log.length;
  await ParlaDb.addTicketMessage("t1", { user_id: "u_admin", author_role: "service_admin", message: "açık" });
  assert.ok(mem.getAt("v2/tickets/t1/first_response_at"));
  const writes = mem.state.log.slice(before).filter((l) => l[0] === "update" || l[0] === "set");
  assert.equal(writes.length, 1, "tek yazım");
  assert.ok(writes[0][2].some((k) => k.startsWith("ticket_messages/t1/")) && writes[0][2].some((k) => k === "tickets/t1/first_response_at"));
});

test("personel e-postası değişince atama kopyaları çok yollu güncellenir; eşleştirme aracı uid ve assigned_uids doldurur", async () => {
  const mem = seedDb();
  mem.setAt("v2/users", {
    u_c1: { uid: "u_c1", role: "consultant", email: "zeynep@x.com" },
    u_c3: { uid: "u_c3", role: "consultant", email: "essiz@x.com" },
    u_c4: { uid: "u_c4", role: "consultant", email: "kayitsiz@x.com" },
    uc: { uid: "uc", role: "customer", email: "musteri@x.com" },
  });
  // proje yöneticisi uid'i kullanıcılardan çözemez (kullanıcı listesini okuyamaz): p3 eşleşmeyen olarak kalır
  await ParlaDb.assignConsultants("t1", [{ personnel_id: "p1", is_primary: true }, { personnel_id: "p3" }], { ...actor, role: "project_manager" });
  assert.equal(mem.getAt("v2/personnel/p3/uid"), undefined);
  assert.deepEqual(mem.getAt("v2/tickets/t1/assigned_uids"), { u_c1: true });
  const n = await ParlaDb.updatePersonnelEmailCopies("p1", "Zeynep.Yeni@X.com");
  assert.equal(n, 1);
  assert.equal(mem.getAt("v2/ticket_assignments/t1/p1/personnel_email"), "zeynep.yeni@x.com");

  const dry = await ParlaDb.linkPersonnelUsers({ dryRun: true });
  assert.equal(mem.getAt("v2/personnel/p3/uid"), undefined, "dryRun yazmaz");
  assert.deepEqual(dry.linked.map((l) => l.personnel_id), ["p3"], "p3 eşleşir");
  const report = await ParlaDb.linkPersonnelUsers();
  assert.deepEqual(report.linked.map((l) => l.personnel_id), ["p3"]);
  assert.equal(report.alreadyLinked, 1, "p1 zaten bağlı");
  assert.deepEqual(report.unmatchedPersonnel.map((p) => p.personnel_id), ["p2"], "p2'nin kullanıcı hesabı yok: uyarı listesi");
  assert.equal(mem.getAt("v2/personnel/p3/uid"), "u_c3");
  assert.equal(mem.getAt("v2/tickets/t1/assigned_uids/u_c3"), true, "atama haritası tamamlandı");
  assert.deepEqual(report.staffWithoutPersonnel.map((s) => s.uid), ["u_c4"], "personel kaydı olmayan danışman hesabı uyarısı");
});
