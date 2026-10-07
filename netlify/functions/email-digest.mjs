/**
 * Günlük özet (zamanlanmış işlev): günlük e-posta kotası (Resend ücretsiz ≈100/gün) dolduğu için gönderilmeyen
 * düşük öncelikli bildirimleri (bkz. lib/email-guard.js `recordDeferred`) TEK bir özet e-postasında destek kutusuna iletir.
 *
 * - Yalnızca depo (Netlify Blobs) okunur; RTDB'ye/kullanıcı token'ına ihtiyaç yoktur (servis hesabı gerekmez).
 * - Her gün 06:00 UTC (09:00 TR); yalnızca BUGÜNDEN ÖNCEKİ günlerin kayıtlarını işler.
 * - Özet e-postası yüksek öncelikli sayılır (1 e-posta kotadan düşer); kota doluysa kayıtlar korunur, ertesi gün denenir.
 */
import guardStoreLib from "../lib/guard-store.js";
import guard from "../lib/email-guard.js";
import templates from "../lib/email-templates.js";
import resendLib from "../lib/resend.js";

const { getGuardStore } = guardStoreLib;
const { buildEmail, BRAND } = templates;
const { resendRequest, describeResendError } = resendLib;

function dayLabel(days) {
  return days.length === 1 ? days[0] : `${days[0]} – ${days[days.length - 1]}`;
}

/**
 * @param {{ store: object, apiKey: string, contact: string, siteUrl?: string, privacyUrl?: string, env?: object, now?: number }} options
 * @returns {Promise<{sent: boolean, reason?: string, count?: number}>}
 */
export async function runDigest(options) {
  const { store, apiKey, contact, env, now } = options;
  const today = guard.dayKey(now);
  const keys = (await store.list("digest:")).filter((k) => k.slice("digest:".length) < today).sort();
  if (!keys.length) return { sent: false, reason: "empty" };

  const items = [];
  for (const key of keys) {
    const list = await store.get(key);
    (Array.isArray(list) ? list : []).forEach((entry) => items.push(entry));
  }
  if (!items.length) {
    await Promise.all(keys.map((k) => store.delete(k)));
    return { sent: false, reason: "empty" };
  }
  items.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const limits = guard.getLimits(env);
  const quota = await guard.reserveQuota(store, limits, 1, "high", now);
  if (!quota.ok) return { sent: false, reason: "quota", count: items.length };

  const days = keys.map((k) => k.slice("digest:".length));
  const built = buildEmail("daily_digest", {
    day: dayLabel(days),
    count: items.length,
    items,
    portalUrl: options.siteUrl || BRAND.siteUrl,
    privacyUrl: options.privacyUrl || "",
  });
  if (built.error) {
    await guard.refundQuota(store, 1, now);
    throw new Error(built.error);
  }

  const { response, data } = await resendRequest(apiKey, "/emails", {
    method: "POST",
    headers: { "Idempotency-Key": `digest:${days.join(",")}:${items.length}`.slice(0, 256) },
    body: JSON.stringify({
      from: `${BRAND.fromName} <${BRAND.fromEmail}>`,
      to: [contact],
      subject: built.subject,
      html: built.html,
      text: built.text,
      reply_to: [BRAND.fromEmail],
      tags: [
        { name: "category", value: "daily_digest" },
        { name: "app", value: "support-v2" },
      ],
    }),
  }).catch(async (err) => {
    await guard.refundQuota(store, 1, now);
    throw err;
  });

  if (!response.ok) {
    const info = describeResendError(response.status, data, response);
    if (!info.duplicate) {
      await guard.refundQuota(store, 1, now);
      return { sent: false, reason: info.code, count: items.length };
    }
  }
  await Promise.all(keys.map((k) => store.delete(k)));
  return { sent: true, count: items.length };
}

export default async function handler() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[email-digest] RESEND_API_KEY tanımlı değil.");
    return new Response("not_configured", { status: 200 });
  }
  try {
    let blobs = null;
    try {
      blobs = await import("@netlify/blobs");
    } catch {
      /* yerelde yok: bellek deposu (özet boş döner) */
    }
    const store = getGuardStore(null, { native: true, blobs });
    const result = await runDigest({
      store,
      apiKey,
      contact: String(process.env.CONTACT_EMAIL || BRAND.fromEmail).trim().toLowerCase(),
      siteUrl: process.env.SITE_URL,
      privacyUrl: process.env.PRIVACY_URL,
    });
    console.log("[email-digest]", JSON.stringify(result));
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    console.error("[email-digest] hata", { msg: err && err.message });
    return new Response("error", { status: 200 });
  }
}

export const config = { schedule: "0 6 * * *" };
