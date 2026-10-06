/**
 * Bildirim türetme + SLA hesabı testleri (saf fonksiyonlar).
 * Çalıştırma: node --test netlify/tests/client-notifications.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = {};
const { deriveNotifications } = await import("../../assets/js/support-v2/notifications.js");
const { computeSla, formatDuration, customerLifecycle } = await import("../../assets/js/support-v2/ticket-utils.js");

const NOW = Date.parse("2026-10-06T12:00:00Z");
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();
const t = (id, o) => ({ id, ticket_number: `N-${id}`, title: `Talep ${id}`, ticket_type: "SUP", priority: "medium", created_at: iso(30), ...o });

const customer = { uid: "c1", role: "customer" };
const consultant = { uid: "s1", role: "consultant", email: "s@x.com" };
const service = { uid: "s2", role: "service_admin" };

test("müşteri: kapanış onayı ve yanıt bekleyen talepler her zaman 'eylem' olarak listelenir", () => {
  const items = deriveNotifications({
    tickets: [t("1", { status: "pending_close", public_updated_at: iso(5), public_updated_by: "s1" }), t("2", { status: "waiting_customer", public_updated_at: iso(3), public_updated_by: "s1" }), t("3", { status: "in_progress", public_updated_by: "c1", public_updated_at: iso(1) })],
    session: customer, seen: { "1": iso(1), "2": iso(1) }, baseline: NOW - 48 * 3600000, now: NOW,
  });
  assert.deepEqual(items.map((i) => [i.ticketId, i.kind, i.action]), [["2", "reply", true], ["1", "close", true]]);
});

test("müşteri: personelin yeni hareketi bildirim olur, görüldükten sonra kaybolur, kendi hareketi bildirim olmaz", () => {
  const ticket = t("4", { status: "in_progress", public_updated_at: iso(2), public_updated_by: "s1" });
  const base = { session: customer, baseline: NOW - 48 * 3600000, now: NOW };
  assert.equal(deriveNotifications({ ...base, tickets: [ticket], seen: {} }).length, 1);
  assert.equal(deriveNotifications({ ...base, tickets: [ticket], seen: { "4": iso(1) } }).length, 0, "okundu");
  assert.equal(deriveNotifications({ ...base, tickets: [{ ...ticket, public_updated_by: "c1" }], seen: {} }).length, 0, "kendi hareketi");
  assert.equal(deriveNotifications({ ...base, tickets: [{ ...ticket, public_updated_at: iso(72) }], seen: {} }).length, 0, "48 saatten eski (baseline)");
});

test("personel: yeniden açılan, SLA aşılan ve müşteri yanıtı olan kendi talepleri; atanmamışlar yalnızca atayıcılara", () => {
  const tickets = [
    t("a", { status: "reopened", assigned_to_id: "p1", public_updated_at: iso(1), public_updated_by: "c1" }),
    t("b", { status: "in_progress", assigned_to_id: "p1", priority: "critical", created_at: iso(10), first_response_at: iso(9.5), public_updated_at: iso(6), public_updated_by: "s1" }),
    t("c", { status: "in_progress", assigned_to_id: "p1", first_response_at: iso(29), public_updated_at: iso(2), public_updated_by: "c1" }),
    t("d", { status: "open", assigned_to_id: "", public_updated_at: iso(1), public_updated_by: "c9" }),
    t("e", { status: "in_progress", assigned_to_id: "p2", public_updated_at: iso(1), public_updated_by: "c1" }),
  ];
  const mine = deriveNotifications({ tickets, session: consultant, myPersonnelId: "p1", seen: {}, baseline: NOW - 48 * 3600000, now: NOW });
  assert.deepEqual(mine.map((i) => [i.ticketId, i.kind]).sort(), [["a", "reopened"], ["b", "sla"], ["c", "update"]]);
  const admin = deriveNotifications({ tickets, session: service, myPersonnelId: "", seen: {}, baseline: NOW - 48 * 3600000, now: NOW });
  assert.deepEqual(admin.map((i) => [i.ticketId, i.kind]), [["d", "unassigned"]]);
});

test("SLA: öncelik hedefleri, duraklatma ve karşılanma", () => {
  const base = { ticket_type: "SUP", priority: "high", created_at: iso(5), status: "in_progress" };
  const breached = computeSla(base, NOW);
  assert.equal(breached.response.state, "breached", "yüksek öncelik: 4 sa ilk yanıt, 5 saattir yanıtsız");
  assert.equal(breached.resolution.state, "pending");
  assert.equal(computeSla({ ...base, first_response_at: iso(4) }, NOW).response.state, "met");
  assert.equal(computeSla({ ...base, first_response_at: iso(0.5) }, NOW).response.state, "late");
  assert.equal(computeSla({ ...base, status: "waiting_customer" }, NOW).paused, true);
  assert.equal(computeSla({ ...base, ticket_type: "INT" }, NOW), null, "iç talepte SLA yok");
  const done = computeSla({ ...base, status: "closed", first_response_at: iso(4.5), resolved_at: iso(1), closed_at: iso(1) }, NOW);
  assert.equal(done.breached, false);
  assert.equal(formatDuration(135 * 60000), "2 sa 15 dk");
  assert.equal(formatDuration(-26 * 3600000), "1 gün 2 sa");
});

test("müşteri yaşam döngüsü: onay, yeniden açma ve 14 günlük pencere", () => {
  assert.deepEqual(customerLifecycle({ status: "pending_close" }, new Date(NOW)), { status: "pending_close", canApprove: true, canReopen: true });
  assert.equal(customerLifecycle({ status: "in_progress" }, new Date(NOW)).canApprove, false);
  assert.equal(customerLifecycle({ status: "closed", closed_at: iso(24 * 10) }, new Date(NOW)).canReopen, true);
  assert.equal(customerLifecycle({ status: "closed", closed_at: iso(24 * 20) }, new Date(NOW)).canReopen, false);
});
