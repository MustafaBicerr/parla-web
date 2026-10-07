/**
 * Günlük RTDB yedeği (Netlify scheduled function; 02:30 UTC ≈ 05:30 TR; yalnızca YAYINDAKİ dağıtımda çalışır).
 * `v2` düğümünü servis hesabıyla okur, düğüm başına sıkıştırılmış JSON üretir ve Netlify Blobs'a (`db-backups`) yazar; 14 günden eskileri siler.
 * Servis hesabı (FIREBASE_SERVICE_ACCOUNT) yoksa hiçbir şey yapmadan çıkar. Ayrıntı ve sınırlar: lib/backup.mjs.
 * Tam (süresiz) yedek + artifact: .github/workflows/backup.yml. Sentry/uptime (D-14) bu işlevin kapsamı DIŞINDADIR (ayrı kurulum).
 */
import adminLib from "../lib/admin.js";
import { runBackup } from "../lib/backup.mjs";

const { getAdmin } = adminLib;

export default async function handler() {
  const state = getAdmin();
  if (!state.ok) {
    console.log("[backup-export] atlandı: FIREBASE_SERVICE_ACCOUNT yapılandırılmamış.");
    return new Response(JSON.stringify({ skipped: "not_configured" }), { status: 200 });
  }
  try {
    const { getStore } = await import("@netlify/blobs");
    const blobStore = getStore({ name: "db-backups", consistency: "strong" });
    const result = await runBackup({
      admin: state.admin,
      blobStore,
      retentionDays: Number(process.env.BACKUP_RETENTION_DAYS) || 14,
      deadlineMs: 24000,
    });
    console.log("[backup-export]", JSON.stringify(result));
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    console.error("[backup-export] hata", { code: err && err.code, msg: err && err.message });
    return new Response(JSON.stringify({ error: "failed" }), { status: 200 });
  }
}

export const config = { schedule: "30 2 * * *" };
