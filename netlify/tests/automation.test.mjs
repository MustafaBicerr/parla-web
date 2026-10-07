/**
 * Zamanlanmış otomasyon testleri (sahte Admin + sahte Resend + sahte saat): SLA %80 / aşım, müşteri bekleniyor hatırlatmaları
 * (3. ve 7. gün), kapanış onayı hatırlatması (3. gün) ve 10. gün otomatik kapanış (damgalar), atanmamış eskalasyonu,
 * kota önceliği/özet, tekilleştirme, ticket-utils sözleşmesi.
 * Çalıştırma: node --test netlify/tests/automation.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runAutomation, planTicket, RULES } from "../lib/automation.mjs";
import * as ticketUtils from "../../assets/js/support-v2/ticket-utils.js";

const require = createRequire(import.meta.url);
const { createFakeAdmin } = require("./helpers/fake-admin.js");
const { MemoryStore } = require("../lib/guard-store.js");
const guard = require("../lib/email-guard.js");

const H = 3600 * 1000;
const D = 24 * H;
const NOW = Date.parse("2026-10-07T10:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const LIMITS = guard.getLimits({}, { relaxed: false });

let resend;
let realFetch;
test.before(() => {
  realFetch = global.fetch;
});
test.after(() => {
  global.fetch = realFetch;
});
test.beforeEach(() => {
  resend = [];
  global.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.resend.com/emails")) {
      const payload = JSON.parse(init.body);
      resend.push({ payload, headers: init.headers });
      return { ok: true, status: 200, headers: { get: () => "" }, json: async () => ({ id: `m${resend.length}` }) };
    }
    throw new Error(`Beklenmeyen istek: ${url}`);
  };
});

function baseDb(tickets, history) {
  return {
    v2: {
      users: {
        "u-cust": { role: "customer", is_active: true, email: "musteri@abc.com", first_name: "Müşteri", last_name: "Kişi" },
        "u-svc": { role: "service_admin", is_active: true, email: "atayici@parla.com" },
      },
      personnel: {
        p1: { personnel_id: "p1", first_name: "Zeynep", last_name: "Arslan", email: "danisman@parla.com", is_active: true },
        p2: { personnel_id: "p2", first_name: "Baran", last_name: "Kaya", email: "baran@parla.com", is_active: true },
      },
      tickets,
      ticket_assignments: Object.fromEntries(
        Object.entries(tickets)
          .filter(([, t]) => t.assigned_to_id)
          .map(([id, t]) => [id, { [t.assigned_to_id]: { personnel_id: t.assigned_to_id, personnel_email: "stale@parla.com", is_primary: true } }])
      ),
      ticket_history: history || {},
      activities: {},
    },
  };
}

const mk = (over) => ({
  ticket_number: "SUP-ABC-FI-2610-0001",
  title: "Fatura hatası",
  ticket_type: "SUP",
  status: "in_progress",
  priority: "high",
  user_id: "u-cust",
  user_name: "Müşteri Kişi",
  company_name: "ABC A.Ş.",
  created_at: ago(30 * D),
  updated_at: ago(1 * D),
  assigned_to_id: "p1",
  assigned_to_name: "Zeynep Arslan",
  first_response_at: ago(29 * D),
  ...over,
});

async function run(db, extra) {
  const admin = createFakeAdmin(db, { now: () => NOW });
  const store = (extra && extra.store) || new MemoryStore();
  const summary = await runAutomation({
    admin,
    store,
    apiKey: "re_test",
    limits: LIMITS,
    now: NOW,
    sendDelayMs: 0,
    contact: "info@parlabilgiteknolojileri.net",
    ...(extra || {}),
  });
  return { admin, store, summary };
}

const sentTo = () => resend.flatMap((r) => r.payload.to).sort();
const tags = () => resend.map((r) => r.payload.tags[0].value);

// ------------------------------------------------------------------------------------------------ sözleşme
test("sözleşme: sunucu, ticket-utils.js'in saf API'sini kullanır (yeniden adlandırma/DOM bağımlılığı sunucuyu kırar)", () => {
  for (const name of ["computeSla", "buildSlaPatch", "computeStatusStamps", "slaWindowStartMs", "isSlaTicket", "formatDuration", "STATUSES"]) {
    assert.ok(ticketUtils[name], `ticket-utils.js ${name} dışa aktarmalı (netlify/lib/automation.mjs kullanır)`);
  }
  assert.equal(typeof globalThis.window, "undefined", "içe aktarma window gerektirmemeli");
});

// ------------------------------------------------------------------------------------------------ planlama (saf)
test("planTicket: müşteri bekleniyor hatırlatmaları 3. ve 7. günde; damga tekrarı önler; yeniden girişte tekrar", () => {
  const since = NOW - 2.9 * D;
  const t = mk({ status: "waiting_customer" });
  assert.equal(planTicket(t, { nowMs: NOW, statusSinceMs: since }).filter((n) => n.kind === "reminder").length, 0, "2,9 gün: henüz yok");

  const n3 = planTicket(t, { nowMs: NOW, statusSinceMs: NOW - 3 * D }).filter((n) => n.kind === "reminder");
  assert.equal(n3.length, 1);
  assert.equal(n3[0].type, "reminder_waiting_customer");
  assert.equal(n3[0].audience, "customer");
  assert.ok(!n3[0].staffCopy, "3. günde yalnız müşteri");
  assert.deepEqual(Object.keys(n3[0].stamps), ["reminder_wc3_at"]);

  const stamped = { ...t, reminder_wc3_at: ago(0.1 * D) };
  assert.equal(planTicket(stamped, { nowMs: NOW, statusSinceMs: NOW - 5 * D }).filter((n) => n.kind === "reminder").length, 0, "3. gün damgalı: 5. günde yok");

  const n7 = planTicket(stamped, { nowMs: NOW, statusSinceMs: NOW - 7 * D }).filter((n) => n.kind === "reminder");
  assert.equal(n7.length, 1);
  assert.equal(n7[0].staffCopy, true, "7. günde danışmana da kopya");
  assert.ok(n7[0].stamps.reminder_wc7_at);

  // her iki eşik de kaçmışsa (otomasyon kapalıydı) yalnız 7. gün gönderilir, 3. gün damgası da konur
  const missed = planTicket(t, { nowMs: NOW, statusSinceMs: NOW - 8 * D }).filter((n) => n.kind === "reminder");
  assert.equal(missed.length, 1);
  assert.deepEqual(Object.keys(missed[0].stamps).sort(), ["reminder_wc3_at", "reminder_wc7_at"]);

  // durum yeniden girildi (damga durum girişinden ESKİ): hatırlatma yeniden başlar
  const reentered = { ...t, reminder_wc3_at: ago(10 * D), reminder_wc7_at: ago(10 * D) };
  assert.equal(planTicket(reentered, { nowMs: NOW, statusSinceMs: NOW - 3.1 * D }).filter((n) => n.kind === "reminder").length, 1);
  assert.equal(planTicket(stamped, { nowMs: NOW, statusSinceMs: NOW - 100 * D }).filter((n) => n.type === "reminder_waiting_customer").length, 1, "7. gün hâlâ gönderilmedi");
});

test("planTicket: kapanış onayı — 3. gün hatırlatma (kalan gün), 10. gün otomatik kapanış; kapanış hatırlatmayı ezer", () => {
  const t = mk({ status: "pending_close" });
  assert.equal(planTicket(t, { nowMs: NOW, statusSinceMs: NOW - 2 * D }).length, 0);
  const r = planTicket(t, { nowMs: NOW, statusSinceMs: NOW - 4 * D })[0];
  assert.equal(r.type, "reminder_pending_close");
  assert.equal(r.data.days_left, 6);
  assert.ok(r.stamps.reminder_pc3_at);
  assert.equal(planTicket({ ...t, reminder_pc3_at: ago(1 * D) }, { nowMs: NOW, statusSinceMs: NOW - 5 * D }).length, 0);
  const close = planTicket({ ...t, reminder_pc3_at: ago(7 * D) }, { nowMs: NOW, statusSinceMs: NOW - RULES.pendingCloseAutoCloseDay * D });
  assert.equal(close.length, 1);
  assert.equal(close[0].autoClose, true);
  assert.equal(close[0].rank, 1);
});

test("planTicket: SLA — %80 uyarısı, aşım, duraklama yok, iç taleplerde yok, damgalı tekrar yok", () => {
  const warn = planTicket(mk({ status: "open", assigned_to_id: "", created_at: ago(3.3 * H), first_response_at: undefined }), { nowMs: NOW });
  assert.deepEqual(warn.map((n) => n.type), ["sla_warning"]);
  assert.match(warn[0].data.phase_label, /İlk yanıt/);
  assert.ok(warn[0].data.remaining_text);

  const breached = planTicket(mk({ status: "in_progress", created_at: ago(5 * H), first_response_at: undefined }), { nowMs: NOW });
  assert.deepEqual(breached.map((n) => n.type), ["sla_breached"]);
  assert.ok(breached[0].stamps.sla_alert_response_at);
  assert.ok(!breached[0].silent, "yeni aşım alarm üretir");
  const stale = planTicket(mk({ status: "in_progress", created_at: ago(5 * D), first_response_at: undefined, assigned_to_id: "" }), { nowMs: NOW, statusSinceMs: NOW });
  assert.equal(stale.find((n) => n.type === "sla_breached").silent, true, "günler önceki aşım sessizce damgalanır (ilk etkinleştirmede e-posta seli yok)");

  const done = planTicket(mk({ status: "in_progress", created_at: ago(5 * H), first_response_at: ago(4.5 * H) }), { nowMs: NOW });
  assert.equal(done.filter((n) => n.type.startsWith("sla")).length, 0, "ilk yanıt zamanında verildi; çözüm 24 sa içinde");

  const paused = planTicket(mk({ status: "waiting_customer", created_at: ago(5 * H), first_response_at: undefined }), { nowMs: NOW, statusSinceMs: NOW - 1 * H });
  assert.equal(paused.filter((n) => n.type.startsWith("sla")).length, 0, "müşteri bekleniyor: SLA duraklar");

  assert.equal(planTicket(mk({ ticket_type: "INT", status: "in_progress", created_at: ago(5 * H), first_response_at: undefined }), { nowMs: NOW }).length, 0, "SLA yalnız müşteri kaynaklı tiplerde");

  const stamped = planTicket(mk({ status: "in_progress", created_at: ago(5 * H), first_response_at: undefined, sla_alert_response_at: ago(10 * 60 * 1000) }), { nowMs: NOW });
  assert.equal(stamped.length, 0);
});

// ------------------------------------------------------------------------------------------------ SLA (uçtan uca)
test("SLA %80: atanmış danışmana gider (güncel personel adresi); damga yazılır; ikinci çalıştırma tekrarlamaz; aşımda ayrıca uyarı + ihlal damgası", async () => {
  const db = baseDb({ T1: mk({ status: "in_progress", created_at: ago(3.3 * H), first_response_at: undefined }) });
  const { admin, store } = await run(db);
  assert.deepEqual(tags(), ["sla_warning"]);
  assert.deepEqual(sentTo(), ["danisman@parla.com"], "atama kaydındaki eski kopya değil, güncel personel adresi");
  assert.ok(admin.getAt("v2/tickets/T1/sla_warn_response_at"));

  resend.length = 0;
  await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW + 10 * 60 * 1000, sendDelayMs: 0 });
  assert.equal(resend.length, 0, "aynı olay talep başına bir kez");

  // 40 dk sonra süre aşılır (4 sa hedef; created 3,3 sa önce → +0,7 sa)
  await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW + 50 * 60 * 1000, sendDelayMs: 0 });
  assert.deepEqual(tags(), ["sla_breached"]);
  assert.deepEqual(sentTo().sort(), ["danisman@parla.com", "info@parlabilgiteknolojileri.net"], "aşım: danışman + destek kutusu");
  assert.ok(admin.getAt("v2/tickets/T1/sla_alert_response_at"));
  assert.ok(admin.getAt("v2/tickets/T1/sla_response_breached_at"), "ihlal damgası sunucuda da yazılır (buildSlaPatch)");
});

test("birikmiş eski SLA aşımları e-posta üretmez, yalnız damgalanır (otomasyon yeni açıldığında kota seli olmaz)", async () => {
  const tickets = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`OLD${i}`, mk({ ticket_number: `SUP-OLD${i}`, status: "in_progress", created_at: ago((5 + i) * D), first_response_at: undefined })])
  );
  const { admin, summary } = await run(baseDb(tickets));
  assert.equal(resend.length, 0);
  assert.equal(summary.silent, 12);
  assert.ok(admin.getAt("v2/tickets/OLD3/sla_alert_response_at"));
  assert.ok(admin.getAt("v2/tickets/OLD3/sla_response_breached_at"));
});

test("atanmamış talep: SLA uyarısı destek kutusuna gider", async () => {
  const db = baseDb({ T1: mk({ status: "open", assigned_to_id: "", assigned_to_name: "", created_at: ago(3.3 * H), first_response_at: undefined }) });
  await run(db);
  assert.deepEqual(sentTo(), ["info@parlabilgiteknolojileri.net"]);
});

// ------------------------------------------------------------------------------------------------ eskalasyon
test("atanmamış eskalasyon: >4 sa → destek kutusu + Destek Atayıcılar (tek e-posta); bir kez; atanmış/yeni talep atlanır", async () => {
  const db = baseDb({
    OLD: mk({ ticket_number: "SUP-A", status: "open", assigned_to_id: "", priority: "low", created_at: ago(5 * H), first_response_at: undefined }),
    NEW: mk({ ticket_number: "SUP-B", status: "open", assigned_to_id: "", priority: "low", created_at: ago(2 * H), first_response_at: undefined }),
    ASG: mk({ ticket_number: "SUP-C", status: "assigned", priority: "low", created_at: ago(9 * H) }),
  });
  const { admin, store } = await run(db);
  assert.deepEqual(tags(), ["unassigned_escalation"]);
  assert.deepEqual(sentTo(), ["atayici@parla.com", "info@parlabilgiteknolojileri.net"]);
  assert.match(resend[0].payload.text, /4 saati aşkın/);
  assert.ok(admin.getAt("v2/tickets/OLD/reminder_unassigned_at"));
  assert.equal(admin.getAt("v2/tickets/NEW/reminder_unassigned_at"), undefined);
  resend.length = 0;
  await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW + 30 * 60 * 1000, sendDelayMs: 0 });
  assert.equal(resend.length, 0);
});

// ------------------------------------------------------------------------------------------------ hatırlatmalar (uçtan uca)
test("müşteri bekleniyor: 3. gün müşteriye; 7. gün müşteri + danışman; geçmişten durum girişi okunur", async () => {
  const history = { T1: { "-h1": { field_changed: "status", new_value: "waiting_customer", changed_at: ago(3.2 * D) } } };
  const db = baseDb({ T1: mk({ status: "waiting_customer", updated_at: ago(0.5 * D), priority: "low" }) }, history);
  const { admin, store } = await run(db);
  assert.deepEqual(tags(), ["reminder_waiting_customer"]);
  assert.deepEqual(sentTo(), ["musteri@abc.com"]);
  assert.match(resend[0].payload.text, /3 gündür/);
  assert.match(resend[0].payload.text, /customer\/ticket-detail\.html/);
  assert.ok(admin.getAt("v2/tickets/T1/reminder_wc3_at"));

  resend.length = 0;
  await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW + 2 * D, sendDelayMs: 0 });
  assert.equal(resend.length, 0, "5. gün: yeni hatırlatma yok");

  await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW + 4 * D, sendDelayMs: 0 });
  assert.equal(resend.length, 2);
  assert.deepEqual(sentTo(), ["danisman@parla.com", "musteri@abc.com"]);
  const staffMail = resend.find((r) => r.payload.to.includes("danisman@parla.com")).payload;
  assert.match(staffMail.text, /admin\/ticket-detail\.html/);
  assert.ok(admin.getAt("v2/tickets/T1/reminder_wc7_at"));
});

test("kapanış onayı: 3. gün hatırlatma (kalan gün bilgisiyle)", async () => {
  const history = { T1: { "-h1": { field_changed: "status", new_value: "pending_close", changed_at: ago(3.5 * D) } } };
  const db = baseDb({ T1: mk({ status: "pending_close", resolved_at: ago(3.5 * D) }) }, history);
  const { admin } = await run(db);
  assert.deepEqual(tags(), ["reminder_pending_close"]);
  assert.deepEqual(sentTo(), ["musteri@abc.com"]);
  assert.match(resend[0].payload.text, /7 gün sonra otomatik olarak kapatılır/);
  assert.ok(admin.getAt("v2/tickets/T1/reminder_pc3_at"));
  assert.equal(admin.getAt("v2/tickets/T1/status"), "pending_close");
});

// ------------------------------------------------------------------------------------------------ otomatik kapanış
test("10. gün otomatik kapanış: durum+damgalar+geçmiş+aktivite TEK yazım; müşteri + personel bildirimi; tekrar çalıştırma etkisiz", async () => {
  const resolvedAt = ago(10.5 * D);
  const history = { T1: { "-h1": { field_changed: "status", new_value: "pending_close", changed_at: ago(10.2 * D) } } };
  const db = baseDb(
    { T1: mk({ status: "pending_close", resolved_at: resolvedAt, reminder_pc3_at: ago(7 * D), sla_paused_since: ago(10.2 * D) }) },
    history
  );
  const { admin, store } = await run(db);
  const t = admin.getAt("v2/tickets/T1");
  assert.equal(t.status, "closed");
  assert.equal(t.closed_at, new Date(NOW).toISOString());
  assert.equal(t.closed_at_ms, NOW, "14 günlük yeniden açma penceresi için sayısal damga");
  assert.equal(t.resolved_at, resolvedAt, "çözüm damgası korunur");
  assert.equal(t.auto_close_at, new Date(NOW).toISOString());
  assert.equal(t.auto_close_by, "system");
  assert.equal(t.updated_by, "system");
  assert.equal(t.public_updated_at, new Date(NOW).toISOString(), "müşteriye görünen değişiklik");
  const histEntries = Object.values(admin.getAt("v2/ticket_history/T1"));
  const auto = histEntries.find((h) => h.changed_by_uid === "system");
  assert.equal(auto.old_value, "pending_close");
  assert.equal(auto.new_value, "closed");
  assert.equal(auto.action, "status_note");
  assert.match(auto.note, /otomatik kapatıldı/);
  const act = Object.values(admin.getAt("v2/activities"))[0];
  assert.equal(act.action, "ticket_auto_closed");
  assert.equal(act.entity_id, "T1");
  // tek atomik yazım: durum + geçmiş + aktivite aynı update çağrısında
  const updates = admin.state.calls.filter((c) => c.op === "db.update" && c.args[0] === "v2");
  const combined = updates.find((c) => Object.keys(c.args[1]).some((k) => k.startsWith("activities/")));
  assert.ok(combined && Object.keys(combined.args[1]).some((k) => k === "tickets/T1/status"));

  assert.deepEqual(tags().sort(), ["ticket_auto_closed", "ticket_auto_closed"]);
  assert.deepEqual(sentTo(), ["danisman@parla.com", "info@parlabilgiteknolojileri.net", "musteri@abc.com"]);
  const customerMail = resend.find((r) => r.payload.to.includes("musteri@abc.com")).payload;
  assert.match(customerMail.text, /otomatik olarak kapatıldı/);
  assert.match(customerMail.text, /14 gün/);

  resend.length = 0;
  const again = await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW + 30 * 60 * 1000, sendDelayMs: 0 });
  assert.equal(resend.length, 0);
  assert.equal(again.auto_closed, 0);
});

test("otomatik kapanış yarışı: müşteri son anda onayladı/yeniden açtıysa kapatılmaz", async () => {
  const history = { T1: { "-h1": { field_changed: "status", new_value: "pending_close", changed_at: ago(11 * D) } } };
  const db = baseDb({ T1: mk({ status: "pending_close", resolved_at: ago(11 * D) }) }, history);
  const admin = createFakeAdmin(db, { now: () => NOW });
  // ilk okuma (sorgu) pending_close görür; kapanıştan hemen önceki yeniden okumada müşteri yeniden açmış olur
  const realGet = admin.db.get;
  let reads = 0;
  admin.db.get = async (path, q) => {
    if (path === "v2/tickets/T1") {
      reads += 1;
      admin.setAt("v2/tickets/T1/status", "reopened");
    }
    return realGet(path, q);
  };
  const summary = await runAutomation({ admin, store: new MemoryStore(), apiKey: "re_test", limits: LIMITS, now: NOW, sendDelayMs: 0 });
  assert.ok(reads >= 1);
  assert.equal(summary.auto_closed, 0);
  assert.equal(admin.getAt("v2/tickets/T1/status"), "reopened");
  assert.equal(resend.length, 0);
});

test("iç talepler (INT) de otomatik kapanır; silinmiş talepler taranmaz", async () => {
  const history = { I1: { "-h1": { field_changed: "status", new_value: "pending_close", changed_at: ago(12 * D) } } };
  const db = baseDb(
    {
      I1: mk({ ticket_type: "INT", status: "pending_close", resolved_at: ago(12 * D), user_id: "u-cust" }),
      DEL: mk({ status: "pending_close", is_deleted: true, resolved_at: ago(12 * D) }),
    },
    history
  );
  const { admin, summary } = await run(db);
  assert.equal(admin.getAt("v2/tickets/I1/status"), "closed");
  assert.equal(admin.getAt("v2/tickets/DEL/status"), "pending_close");
  assert.equal(summary.auto_closed, 1);
});

// ------------------------------------------------------------------------------------------------ kota
test("kota önceliği: yumuşak sınır aşıldıysa hatırlatma/uyarı özete düşer, otomatik kapanış ve SLA aşımı yine gider", async () => {
  const history = {
    C1: { "-h": { field_changed: "status", new_value: "pending_close", changed_at: ago(11 * D) } },
    R1: { "-h": { field_changed: "status", new_value: "waiting_customer", changed_at: ago(4 * D) } },
  };
  const db = baseDb(
    {
      C1: mk({ ticket_number: "SUP-C1", status: "pending_close", resolved_at: ago(11 * D) }),
      R1: mk({ ticket_number: "SUP-R1", status: "waiting_customer", priority: "low" }),
      B1: mk({ ticket_number: "SUP-B1", status: "in_progress", created_at: ago(6 * H), first_response_at: undefined }),
      W1: mk({ ticket_number: "SUP-W1", status: "in_progress", priority: "medium", created_at: ago(6.6 * H), first_response_at: undefined }),
    },
    history
  );
  const store = new MemoryStore();
  await store.set(`quota:${guard.dayKey(NOW)}`, { used: 82 }); // yumuşak sınır (80) aşıldı, sert sınır (95) yakın
  const { admin } = await run(db, { store });
  // yüksek öncelikli: kapanış (2 e-posta: müşteri + personel) + SLA aşımı
  assert.ok(tags().includes("ticket_auto_closed"));
  assert.ok(tags().includes("sla_breached"));
  assert.ok(!tags().includes("reminder_waiting_customer"), "hatırlatma yumuşak sınırdan sonra gönderilmez");
  const digest = await store.get(`digest:${guard.dayKey(NOW)}`);
  assert.ok(digest.some((d) => d.event === "reminder_waiting_customer" && d.ticket_number === "SUP-R1"), "özete eklendi");
  assert.ok(admin.getAt("v2/tickets/R1/reminder_wc3_at"), "özete düşen olay damgalanır (tekrar üretilmez)");
  assert.ok(Object.keys(admin.getAt("v2/tickets/R1")).includes("reminder_wc3_at"));
});

test("sert sınır doluyken otomatik kapanış yine de YAPILIR; bildirim özete düşer (durum değişikliği e-postaya bağlı değildir)", async () => {
  const history = { C1: { "-h": { field_changed: "status", new_value: "pending_close", changed_at: ago(11 * D) } } };
  const db = baseDb({ C1: mk({ ticket_number: "SUP-C1", status: "pending_close", resolved_at: ago(11 * D) }) }, history);
  const store = new MemoryStore();
  await store.set(`quota:${guard.dayKey(NOW)}`, { used: LIMITS.dailyHard });
  const { admin } = await run(db, { store });
  assert.equal(admin.getAt("v2/tickets/C1/status"), "closed");
  assert.equal(resend.length, 0);
  const digest = await store.get(`digest:${guard.dayKey(NOW)}`);
  assert.ok(digest.some((d) => d.event === "ticket_auto_closed"));
});

test("otomasyonun günlük payı: dolunca düşük öncelikli olaylar doğrudan özete gider; yüksek öncelikliler etkilenmez", async () => {
  const history = { R1: { "-h": { field_changed: "status", new_value: "waiting_customer", changed_at: ago(4 * D) } } };
  const db = baseDb({ R1: mk({ status: "waiting_customer", priority: "low" }) }, history);
  const store = new MemoryStore();
  await store.set(`autoq:${guard.dayKey(NOW)}`, 40);
  await run(db, { store, automationDailyMax: 40 });
  assert.equal(resend.length, 0);
  assert.equal((await store.get(`digest:${guard.dayKey(NOW)}`)).length, 1);
});

test("otomasyon payı SLA aşımı e-postalarını da sınırlar (kapanış bildirimleri muaf); fazlası özete gider", async () => {
  const tickets = {};
  for (let i = 0; i < 5; i += 1) tickets[`B${i}`] = mk({ ticket_number: `SUP-B${i}`, status: "in_progress", created_at: ago(5 * H + i * 1000), first_response_at: undefined });
  tickets.C1 = mk({ ticket_number: "SUP-C1", status: "pending_close", resolved_at: ago(11 * D) });
  const history = { C1: { "-h": { field_changed: "status", new_value: "pending_close", changed_at: ago(11 * D) } } };
  const store = new MemoryStore();
  await store.set(`autoq:${guard.dayKey(NOW)}`, 36); // pay 40: yalnız 2 alıcı daha (1 e-posta × 2 alıcı)
  await run(baseDb(tickets, history), { store, automationDailyMax: 40 });
  assert.equal(tags().filter((t) => t === "ticket_auto_closed").length, 2, "kapanış bildirimleri paydan muaf");
  const breaches = tags().filter((t) => t === "sla_breached").length;
  assert.ok(breaches >= 1 && breaches < 5, `SLA aşımı payla sınırlı: ${breaches}`);
  const digest = (await store.get(`digest:${guard.dayKey(NOW)}`)) || [];
  assert.ok(digest.filter((d) => d.event === "sla_breached").length >= 1, "pay dışı kalanlar özete düştü");
});

test("çalıştırma başına üst sınır: fazlası sonraki çalıştırmaya kalır (damgalanmaz) ve öncelik sırası korunur", async () => {
  const history = Object.fromEntries(
    ["A", "B", "C"].map((k) => [k, { "-h": { field_changed: "status", new_value: "waiting_customer", changed_at: ago(4 * D) } }])
  );
  const tickets = Object.fromEntries(["A", "B", "C"].map((k, i) => [k, mk({ ticket_number: `SUP-${k}`, status: "waiting_customer", priority: "low", created_at: ago((30 - i) * D) })]));
  tickets.CLOSE = mk({ ticket_number: "SUP-CLOSE", status: "pending_close", resolved_at: ago(11 * D) });
  history.CLOSE = { "-h": { field_changed: "status", new_value: "pending_close", changed_at: ago(11 * D) } };
  const { admin, store, summary } = await run(baseDb(tickets, history), { maxPerRun: 2 });
  assert.equal(resend.length, 2);
  assert.equal(tags()[0], "ticket_auto_closed", "otomatik kapanış önce");
  assert.equal(admin.getAt("v2/tickets/CLOSE/status"), "closed");
  assert.ok(summary.skipped >= 2);
  const stamped = ["A", "B", "C"].filter((k) => admin.getAt(`v2/tickets/${k}/reminder_wc3_at`));
  assert.ok(stamped.length < 3, "sıra dışı kalanlar damgalanmadı");
  // sonraki çalıştırma kalanları tamamlar
  resend.length = 0;
  await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW + 30 * 60 * 1000, sendDelayMs: 0, maxPerRun: 10 });
  assert.equal(["A", "B", "C"].filter((k) => admin.getAt(`v2/tickets/${k}/reminder_wc3_at`)).length, 3);
});

// ------------------------------------------------------------------------------------------------ tekilleştirme / dayanıklılık
test("tekilleştirme: damga yazımı başarısız olsa bile ikinci çalıştırma aynı e-postayı tekrar göndermez", async () => {
  const history = { R1: { "-h": { field_changed: "status", new_value: "waiting_customer", changed_at: ago(4 * D) } } };
  const db = baseDb({ R1: mk({ status: "waiting_customer", priority: "low" }) }, history);
  const admin = createFakeAdmin(db, { now: () => NOW });
  admin.failures.push({ op: "db.update", times: 1, match: ([, patch]) => Object.keys(patch).some((k) => k.endsWith("reminder_wc3_at")) });
  const store = new MemoryStore();
  await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW, sendDelayMs: 0 });
  assert.equal(resend.length, 1);
  assert.equal(admin.getAt("v2/tickets/R1/reminder_wc3_at"), undefined, "damga yazılamadı");
  await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW + 30 * 60 * 1000, sendDelayMs: 0 });
  assert.equal(resend.length, 1, "claim anahtarı yinelemeyi engeller");
  assert.ok(admin.getAt("v2/tickets/R1/reminder_wc3_at"), "ikinci çalıştırmada damga tamamlanır");
});

test("e-posta hatası: damga konmaz, sonraki çalıştırmada yeniden denenir; art arda 6 başarısızlıktan sonra vazgeçilir", async () => {
  const history = { R1: { "-h": { field_changed: "status", new_value: "waiting_customer", changed_at: ago(4 * D) } } };
  const db = baseDb({ R1: mk({ status: "waiting_customer", priority: "low" }) }, history);
  global.fetch = async () => ({ ok: false, status: 500, headers: { get: () => "" }, json: async () => ({ name: "application_error" }) });
  const admin = createFakeAdmin(db, { now: () => NOW });
  const store = new MemoryStore();
  const silent = console.error;
  console.error = () => {};
  try {
    const first = await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW, sendDelayMs: 0 });
    assert.equal(first.failed, 1);
    assert.equal(admin.getAt("v2/tickets/R1/reminder_wc3_at"), undefined);
    for (let i = 0; i < 6; i += 1) await runAutomation({ admin, store, apiKey: "re_test", limits: LIMITS, now: NOW + (i + 1) * 30 * 60 * 1000, sendDelayMs: 0 });
    assert.ok(admin.getAt("v2/tickets/R1/reminder_wc3_at"), "vazgeçildi → damgalandı, sonsuz yeniden deneme yok");
  } finally {
    console.error = silent;
  }
});

test("alıcısı olmayan müşteri (profil yok/pasif): hatırlatma atlanır ve damgalanır (sonsuz yeniden planlama yok)", async () => {
  const history = { R1: { "-h": { field_changed: "status", new_value: "waiting_customer", changed_at: ago(4 * D) } } };
  const db = baseDb({ R1: mk({ status: "waiting_customer", priority: "low", user_id: "u-yok" }) }, history);
  const { admin } = await run(db);
  assert.equal(resend.length, 0);
  assert.ok(admin.getAt("v2/tickets/R1/reminder_wc3_at"));
});

test("yeniden açılan talepte yeni pencere: eski SLA/eskalasyon damgaları geçersiz sayılır", () => {
  const reopened = mk({
    status: "reopened",
    assigned_to_id: "",
    created_at: ago(30 * D),
    reopened_at: ago(5 * H),
    reminder_unassigned_at: ago(20 * D),
    sla_alert_resolution_at: ago(20 * D),
    first_response_at: ago(29 * D),
  });
  const plan = planTicket(reopened, { nowMs: NOW });
  assert.ok(plan.some((n) => n.type === "unassigned_escalation"), "yeni pencerede yeniden eskale edilir");
});

// ------------------------------------------------------------------------------------------------ zamanlanmış işlev girişi
test("ticket-automation işlevi: servis hesabı yoksa atlar; varsa çalışır ve özet döner; zamanlama 30 dk", async () => {
  const mod = await import("../functions/ticket-automation.mjs");
  const { setAdminForTests } = require("../lib/admin.js");
  assert.equal(mod.config.schedule, "*/30 * * * *");
  const saved = { sa: process.env.FIREBASE_SERVICE_ACCOUNT, key: process.env.RESEND_API_KEY };
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  process.env.RESEND_API_KEY = "re_test";
  const log = console.log;
  console.log = () => {};
  try {
    setAdminForTests(null);
    const skipped = await mod.default();
    assert.deepEqual(await skipped.json(), { skipped: "not_configured" });

    const history = { R1: { "-h": { field_changed: "status", new_value: "waiting_customer", changed_at: new Date(Date.now() - 4 * D).toISOString() } } };
    const tickets = { R1: mk({ status: "waiting_customer", priority: "low", created_at: new Date(Date.now() - 30 * D).toISOString(), updated_at: new Date(Date.now() - 4 * D).toISOString() }) };
    setAdminForTests(createFakeAdmin(baseDb(tickets, history)));
    const res = await mod.default();
    const summary = await res.json();
    assert.equal(summary.scanned, 1);
    assert.equal(summary.sent, 1);
  } finally {
    console.log = log;
    setAdminForTests(null);
    if (saved.sa !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved.sa;
    if (saved.key === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved.key;
  }
});
