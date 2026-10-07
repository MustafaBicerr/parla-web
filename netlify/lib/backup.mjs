/**
 * Günlük RTDB yedeği (D-14 A): `v2` düğümünü okuyup düğüm başına sıkıştırılmış JSON dosyaları üretir.
 *
 * Çıktı (bir yedek = bir gün):  <gün>/<düğüm>.json.gz  +  <gün>/manifest.json
 *   - her dosya `{ "<düğüm>": <değer> }` içerir (geri yükleme: PUT v2/<düğüm> ya da `admin.db.update('v2', {...})`)
 *   - büyük düğümler (ek dosyalar: base64 veri) talep başına alt kayıt olarak okunur; toplam ham boyut bütçesi aşılırsa
 *     ek `data` alanı atlanır (`data_omitted: true`) — meta veriler korunur.
 *   - süre sınırı aşılırsa yedek `partial: true` + `skipped` ile biter (Netlify zamanlanmış işlev ≈30 sn sınırı). TAM yedek için
 *     sınırsız süreli GitHub Actions işi (.github/workflows/backup.yml → backup-cli.mjs) kullanılır.
 * Yedek kişisel veri içerir: Netlify Blobs özel depodadır; GitHub artifact için DEPO ÖZEL olmalı (D-02 A) ve tercihen şifrelenir.
 */
import { gzipSync, gunzipSync } from "node:zlib";

/** Alt kayıt bazında okunan, büyük olabilecek düğümler. */
export const SHARDED_NODES = ["ticket_attachments", "ticket_internal_attachments"];
const DEFAULT_RAW_BUDGET = 150 * 1024 * 1024;

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

function rawSize(value) {
  return Buffer.byteLength(JSON.stringify(value === undefined ? null : value));
}

/**
 * @param {object} admin netlify/lib/admin.js arayüzü
 * @param {{ now?: number, deadlineMs?: number, rawBudgetBytes?: number }} [options]
 * @returns {Promise<{ day: string, files: Array<{name: string, gz: Buffer, raw: number}>, manifest: object }>}
 */
export async function exportDatabase(admin, options) {
  const o = options || {};
  const now = o.now == null ? Date.now() : o.now;
  const day = dayOf(now);
  const budget = o.rawBudgetBytes != null ? o.rawBudgetBytes : DEFAULT_RAW_BUDGET;
  const deadline = o.deadlineMs ? Date.now() + o.deadlineMs : Infinity;

  const top = (await admin.db.get("v2", { shallow: true })) || {};
  const names = Object.keys(top).sort((a, b) => SHARDED_NODES.includes(a) - SHARDED_NODES.includes(b) || (a < b ? -1 : 1));
  const files = [];
  const manifest = { version: 1, project: admin.projectId, created_at: new Date(now).toISOString(), day, nodes: {}, partial: false, skipped: [], omitted_attachment_data: 0 };
  let rawTotal = 0;

  for (const name of names) {
    if (Date.now() > deadline) {
      manifest.partial = true;
      manifest.skipped.push(name);
      continue;
    }
    let value;
    let omitted = 0;
    if (SHARDED_NODES.includes(name)) {
      value = {};
      const keys = Object.keys((await admin.db.get(`v2/${name}`, { shallow: true })) || {});
      for (const key of keys) {
        if (Date.now() > deadline) {
          manifest.partial = true;
          manifest.skipped.push(`${name}/${key}`);
          continue;
        }
        const child = await admin.db.get(`v2/${name}/${key}`);
        if (child == null) continue;
        const size = rawSize(child);
        if (rawTotal + size > budget) {
          // Bütçe aşıldı: ek verisi (base64) atlanır, meta veriler korunur.
          const stripped = {};
          for (const [attId, att] of Object.entries(child)) {
            if (att && typeof att === "object") {
              const { data, ...meta } = att;
              stripped[attId] = { ...meta, data_omitted: true };
              omitted += data ? 1 : 0;
            } else stripped[attId] = att;
          }
          value[key] = stripped;
          rawTotal += rawSize(stripped);
        } else {
          value[key] = child;
          rawTotal += size;
        }
      }
    } else {
      value = await admin.db.get(`v2/${name}`);
      rawTotal += rawSize(value);
    }
    const json = JSON.stringify({ [name]: value === undefined ? null : value });
    const gz = gzipSync(Buffer.from(json), { level: 9 });
    files.push({ name: `${name}.json.gz`, gz, raw: Buffer.byteLength(json) });
    manifest.nodes[name] = {
      children: value && typeof value === "object" ? Object.keys(value).length : value == null ? 0 : 1,
      raw_bytes: Buffer.byteLength(json),
      gz_bytes: gz.length,
    };
    manifest.omitted_attachment_data += omitted;
  }
  manifest.total_raw_bytes = rawTotal;
  manifest.total_gz_bytes = files.reduce((n, f) => n + f.gz.length, 0);
  return { day, files, manifest };
}

/** Yedek dosyasını geri okur (doğrulama/geri yükleme yardımcıları ve testler için). */
export function readBackupFile(gz) {
  return JSON.parse(gunzipSync(gz).toString("utf8"));
}

const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

/**
 * Yedeği Blobs benzeri depoya yazar ve eskileri siler.
 * @param {{ set: Function, list: Function, delete: Function }} blobStore  (Netlify Blobs `getStore()` arayüzü)
 */
export async function runBackup({ admin, blobStore, now, retentionDays, deadlineMs, rawBudgetBytes }) {
  const keep = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 14;
  const { day, files, manifest } = await exportDatabase(admin, { now, deadlineMs, rawBudgetBytes });
  for (const f of files) await blobStore.set(`${day}/${f.name}`, toArrayBuffer(f.gz));
  // Manifest EN SON yazılır: manifest'i olan gün "tamamlanmış" sayılır.
  await blobStore.set(`${day}/manifest.json`, JSON.stringify(manifest));

  // Saklama süresi: gün klasörü eşikten eskiyse sil.
  const cutoff = dayOf((now == null ? Date.now() : now) - keep * 24 * 3600 * 1000);
  const listing = await blobStore.list({});
  let deleted = 0;
  for (const blob of listing.blobs || []) {
    const d = String(blob.key).split("/")[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) {
      await blobStore.delete(blob.key);
      deleted += 1;
    }
  }
  return { day, files: files.length, partial: manifest.partial, skipped: manifest.skipped, total_gz_bytes: manifest.total_gz_bytes, deleted_old: deleted };
}
