/**
 * Yedek testleri: düğüm başına sıkıştırılmış JSON, manifest, ek bütçesi, süre sınırı (kısmi), saklama süresi, not_configured.
 * Çalıştırma: node --test netlify/tests/backup.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { exportDatabase, runBackup, readBackupFile, SHARDED_NODES } from "../lib/backup.mjs";
import backupHandler from "../functions/backup-export.mjs";

const require = createRequire(import.meta.url);
const { createFakeAdmin } = require("./helpers/fake-admin.js");
const { setAdminForTests } = require("../lib/admin.js");

const NOW = Date.parse("2026-10-07T02:30:00.000Z");

function seed() {
  return {
    v2: {
      users: { u1: { email: "a@x.com", role: "customer" }, u2: { email: "b@x.com", role: "consultant" } },
      tickets: { T1: { title: "Fatura", status: "open" } },
      ticket_attachments: {
        T1: { a1: { name: "x.pdf", type: "application/pdf", size: 10, data: "A".repeat(2000), uploader_uid: "u1" } },
        T2: { a2: { name: "y.png", type: "image/png", size: 10, data: "B".repeat(2000), uploader_uid: "u1" } },
      },
      counters: { SUP: { ABC: { 2610: 5 } } },
    },
  };
}

function memBlobs() {
  const map = new Map();
  return {
    map,
    async set(key, value) {
      map.set(key, value);
    },
    async list() {
      return { blobs: [...map.keys()].map((key) => ({ key })) };
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

test("exportDatabase: her düğüm ayrı .json.gz; içerik birebir geri okunur; manifest sayıları doğru", async () => {
  const admin = createFakeAdmin(seed());
  const { day, files, manifest } = await exportDatabase(admin, { now: NOW });
  assert.equal(day, "2026-10-07");
  assert.deepEqual(files.map((f) => f.name).sort(), ["counters.json.gz", "ticket_attachments.json.gz", "tickets.json.gz", "users.json.gz"]);
  const users = readBackupFile(files.find((f) => f.name === "users.json.gz").gz);
  assert.deepEqual(users, { users: seed().v2.users });
  assert.equal(manifest.nodes.users.children, 2);
  assert.equal(manifest.nodes.ticket_attachments.children, 2);
  assert.equal(manifest.partial, false);
  assert.equal(manifest.project, "parla-bt-web");
  assert.ok(manifest.total_gz_bytes > 0);
  // büyük düğümler talep başına alt kayıt olarak okunur (tek dev yanıt yok)
  const att = readBackupFile(files.find((f) => f.name === "ticket_attachments.json.gz").gz);
  assert.equal(att.ticket_attachments.T1.a1.data.length, 2000);
  const getCalls = admin.state.calls.filter((c) => c.op === "db.get");
  const reads = getCalls.map((c) => c.args[0]);
  assert.ok(reads.includes("v2/ticket_attachments/T1") && reads.includes("v2/ticket_attachments/T2"));
  assert.ok(getCalls.filter((c) => c.args[0] === "v2/ticket_attachments").every((c) => c.args[1] && c.args[1].shallow), "ek düğümü bütün olarak okunmaz (yalnız shallow)");
  assert.ok(SHARDED_NODES.includes("ticket_internal_attachments"));
});

test("ham boyut bütçesi aşılırsa ek verisi atlanır, meta korunur (data_omitted)", async () => {
  const admin = createFakeAdmin(seed());
  const { files, manifest } = await exportDatabase(admin, { now: NOW, rawBudgetBytes: 3000 });
  const att = readBackupFile(files.find((f) => f.name === "ticket_attachments.json.gz").gz).ticket_attachments;
  assert.ok(att.T1.a1.data, "bütçe içindeki ilk ek tam");
  assert.equal(att.T2.a2.data, undefined, "bütçeyi aşan ekin verisi atlandı");
  assert.equal(att.T2.a2.data_omitted, true);
  assert.equal(att.T2.a2.name, "y.png");
  assert.equal(manifest.omitted_attachment_data, 1);
});

test("süre sınırı: aşılırsa kısmi yedek + atlanan düğümler manifestte", async () => {
  const admin = createFakeAdmin(seed());
  const realGet = admin.db.get;
  admin.db.get = async (p, q) => {
    await new Promise((r) => setTimeout(r, 25));
    return realGet(p, q);
  };
  const { manifest } = await exportDatabase(admin, { now: NOW, deadlineMs: 40 });
  assert.equal(manifest.partial, true);
  assert.ok(manifest.skipped.length >= 1);
});

test("runBackup: dosyalar + en son manifest yazılır; 14 günden eski günler silinir", async () => {
  const admin = createFakeAdmin(seed());
  const blobs = memBlobs();
  blobs.map.set("2026-09-01/users.json.gz", "eski");
  blobs.map.set("2026-09-01/manifest.json", "{}");
  blobs.map.set("2026-09-30/users.json.gz", "yakın");
  const result = await runBackup({ admin, blobStore: blobs, now: NOW, retentionDays: 14 });
  assert.equal(result.day, "2026-10-07");
  assert.equal(result.files, 4);
  assert.equal(result.partial, false);
  assert.equal(result.deleted_old, 2);
  const keys = [...blobs.map.keys()].sort();
  assert.ok(keys.includes("2026-10-07/manifest.json"));
  assert.ok(keys.includes("2026-10-07/users.json.gz"));
  assert.ok(keys.includes("2026-09-30/users.json.gz"), "saklama süresi içindeki gün korunur");
  assert.ok(!keys.some((k) => k.startsWith("2026-09-01")));
  const manifest = JSON.parse(blobs.map.get("2026-10-07/manifest.json"));
  assert.equal(manifest.nodes.tickets.children, 1);
  // ikili veri ArrayBuffer olarak yazılır (Blobs Buffer'ı değil ArrayBuffer'ı kabul eder)
  assert.ok(blobs.map.get("2026-10-07/users.json.gz") instanceof ArrayBuffer);
});

test("zamanlanmış işlev: servis hesabı yoksa atlar (hata vermez)", async () => {
  setAdminForTests(null);
  const saved = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  try {
    const res = await backupHandler();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { skipped: "not_configured" });
  } finally {
    if (saved !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = saved;
  }
});
