/**
 * firebase-client.js (ParlaDb) testleri — bellek içi DB ile.
 * Çalıştırma: node --test netlify/tests/client-firebase.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createMemDb, installFirebase } from "./helpers/memdb.mjs";

globalThis.window = {};
const { default: ParlaDb } = await import("../../assets/js/support-v2/firebase-client.js");

function seed() {
  const mem = createMemDb({
    v2: {
      tickets: { t1: { ticket_id: "t1", status: "open" }, t2: { ticket_id: "t2", status: "open" } },
      ticket_messages: {
        t1: {
          m1: { message_id: "m1", message: "genel", created_at: "2026-01-01T10:00:00Z" },
          m2: { message_id: "m2", message: "ESKİ iç not", created_at: "2026-01-01T11:00:00Z", is_internal: true },
        },
        t2: { m3: { message_id: "m3", message: "t2 mesajı", created_at: "2026-01-02T10:00:00Z" } },
      },
      ticket_internal_notes: { t1: { n1: { message_id: "n1", message: "yeni iç not", created_at: "2026-01-01T12:00:00Z" } } },
    },
  });
  installFirebase(mem, { uid: "u1" });
  return mem;
}

test("müşteri çağrısı iç notları (eski is_internal dahil) döndürmez", async () => {
  seed();
  const msgs = await ParlaDb.getTicketMessages("t1");
  assert.deepEqual(msgs.map((m) => m.message_id), ["m1"]);
});

test("personel çağrısı iki düğümü birleştirir ve zamana göre sıralar", async () => {
  seed();
  const msgs = await ParlaDb.getTicketMessages("t1", { includeInternal: true });
  assert.deepEqual(msgs.map((m) => m.message_id), ["m1", "m2", "n1"]);
  assert.equal(msgs.find((m) => m.message_id === "n1").is_internal, true);
});

test("iç not ayrı düğüme, genel mesaj mesaj düğümüne yazılır", async () => {
  const mem = seed();
  await ParlaDb.addTicketMessage("t1", { user_id: "u1", message: "gizli", is_internal: true });
  await ParlaDb.addTicketMessage("t1", { user_id: "u1", message: "açık", is_internal: false });
  const notes = Object.values(mem.getAt("v2/ticket_internal_notes/t1"));
  const msgs = Object.values(mem.getAt("v2/ticket_messages/t1"));
  assert.ok(notes.some((n) => n.message === "gizli" && n.is_internal === true));
  assert.ok(!msgs.some((m) => m.message === "gizli"));
  assert.ok(msgs.some((m) => m.message === "açık" && m.is_internal === false));
});

test("migrateInternalMessages eski iç notları taşır ve tekrar çalıştırılabilir", async () => {
  const mem = seed();
  const first = await ParlaDb.migrateInternalMessages();
  assert.deepEqual(first, { tickets: 1, moved: 1 });
  assert.equal(mem.getAt("v2/ticket_messages/t1/m2"), undefined);
  assert.equal(mem.getAt("v2/ticket_internal_notes/t1/m2").message, "ESKİ iç not");
  assert.ok(mem.getAt("v2/ticket_messages/t1/m1"), "genel mesaj yerinde kalır");
  const second = await ParlaDb.migrateInternalMessages();
  assert.deepEqual(second, { tickets: 0, moved: 0 });
});
