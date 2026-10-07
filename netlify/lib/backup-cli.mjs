/**
 * Yedeği yerel dizine yazar (GitHub Actions / elle): FIREBASE_SERVICE_ACCOUNT=... node netlify/lib/backup-cli.mjs [çıktı-dizini]
 * Süre sınırı YOK (tam yedek). Çıktı: <dizin>/<gün>/<düğüm>.json.gz + manifest.json. Servis hesabı yoksa 0 koduyla "atlandı" der.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import adminLib from "./admin.js";
import { exportDatabase } from "./backup.mjs";

const state = adminLib.getAdmin();
if (!state.ok) {
  console.log("FIREBASE_SERVICE_ACCOUNT tanımlı değil: yedek atlandı.");
  process.exit(0);
}
const outDir = process.argv[2] || "backup-out";
const { day, files, manifest } = await exportDatabase(state.admin, {});
const dir = join(outDir, day);
mkdirSync(dir, { recursive: true });
for (const f of files) writeFileSync(join(dir, f.name), f.gz);
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Yedek tamam: ${dir} — ${files.length} dosya, ${manifest.total_gz_bytes} bayt (gz)${manifest.partial ? " [KISMİ]" : ""}`);
if (manifest.partial) process.exit(1);
