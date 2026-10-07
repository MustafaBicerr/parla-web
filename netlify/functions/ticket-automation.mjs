/**
 * Zamanlanmış talep otomasyonu (Netlify scheduled function; her 30 dakikada bir; yalnızca YAYINDAKİ dağıtımda çalışır).
 * SLA %80 uyarısı + aşım, müşteri bekleniyor hatırlatmaları (3. ve 7. gün), kapanış onayı hatırlatması (3. gün) ve
 * 10. günde OTOMATİK kapanış, atanmamış talep eskalasyonu (>4 sa). Kurallar/kota: lib/automation.mjs.
 *
 * Servis hesabı (FIREBASE_SERVICE_ACCOUNT) yoksa işlev hiçbir şey yapmadan çıkar (hata vermez).
 * Günlük özet: gönderilemeyen düşük öncelikli bildirimler `digest:<gün>` kuyruğuna düşer; email-digest.mjs ertesi gün 06:00 UTC'de
 * tek e-postada iletir (tek özet hattı; ayrıca bir özet işlevi YOKTUR).
 */
import guardStoreLib from "../lib/guard-store.js";
import adminLib from "../lib/admin.js";
import templates from "../lib/email-templates.js";
import { runAutomation } from "../lib/automation.mjs";

const { getGuardStore } = guardStoreLib;
const { getAdmin } = adminLib;
const { BRAND } = templates;

export default async function handler() {
  const state = getAdmin();
  if (!state.ok) {
    console.log("[ticket-automation] atlandı: FIREBASE_SERVICE_ACCOUNT yapılandırılmamış.");
    return new Response(JSON.stringify({ skipped: "not_configured" }), { status: 200 });
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[ticket-automation] RESEND_API_KEY tanımlı değil; e-posta gönderilemez.");
    return new Response(JSON.stringify({ skipped: "no_email_key" }), { status: 200 });
  }
  try {
    let blobs = null;
    try {
      blobs = await import("@netlify/blobs");
    } catch {
      /* yerelde yok: bellek deposu */
    }
    const store = getGuardStore(null, { native: true, blobs });
    const summary = await runAutomation({
      admin: state.admin,
      store,
      apiKey,
      siteUrl: process.env.SITE_URL || BRAND.siteUrl,
      privacyUrl: process.env.PRIVACY_URL,
      contact: process.env.CONTACT_EMAIL,
    });
    console.log("[ticket-automation]", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { status: 200 });
  } catch (err) {
    console.error("[ticket-automation] hata", { code: err && err.code, msg: err && err.message });
    return new Response(JSON.stringify({ error: "failed" }), { status: 200 });
  }
}

export const config = { schedule: "*/30 * * * *" };
