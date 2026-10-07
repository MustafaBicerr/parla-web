/**
 * Sunucu kaynaklı e-posta gönderimi (admin-users, zamanlanmış otomasyon): şablon + kota + tekilleştirme + Resend.
 * send-email.js'in istemci tetiklemeli akışıyla AYNI koruma deposunu (guard-store) ve günlük kota sayacını paylaşır:
 *   claim (tekilleştirme) → kota rezervasyonu → gönder → tamamla | iade + bırak.
 *
 * Kota (D-04 A ≈100/gün): yüksek öncelik sert sınıra (95), düşük öncelik yumuşak sınıra (80) kadar gönderilir; düşük öncelikli
 * bildirim yumuşak sınırı aşarsa gönderilmez, günlük özet kuyruğuna (`digest:<gün>`) eklenir (email-digest.mjs ertesi gün 06:00'da yollar).
 */
const { BRAND, buildEmail, truncateText, singleLine } = require("./email-templates");
const guard = require("./email-guard");
const { resendRequest, describeResendError } = require("./resend");

/**
 * @param {{
 *   store: object, limits: object, apiKey: string,
 *   type: string, data: object, to: string[],
 *   priority?: "high"|"low", idempotencyKey: string, dedupeKey?: string, requestId?: string,
 *   digestEntry?: object, now?: number
 * }} p
 * @returns {Promise<{status: "sent"|"deferred"|"duplicate"|"quota"|"failed"|"no_recipient", code?: string, id?: string|null}>}
 */
async function sendServerEmail(p) {
  const to = [...new Set((p.to || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return { status: "no_recipient" };
  const priority = p.priority || guard.priorityOf(p.type);
  const requestId = p.requestId || p.idempotencyKey;

  if (p.dedupeKey && (await guard.claimEvent(p.store, p.dedupeKey, requestId, p.now)) === "duplicate") {
    return { status: "duplicate" };
  }
  const release = async () => {
    if (p.dedupeKey) await guard.releaseEvent(p.store, p.dedupeKey);
  };

  const quota = await guard.reserveQuota(p.store, p.limits, to.length, priority, p.now);
  if (!quota.ok) {
    if (priority === "low") {
      const entry = p.digestEntry || {
        event: p.type,
        audience: p.data && p.data.audience === "customer" ? "customer" : "staff",
        ticket_number: singleLine(p.data && p.data.ticket_number).slice(0, 60),
        title: truncateText(singleLine(p.data && p.data.title), 60).text,
      };
      await guard.recordDeferred(p.store, { at: new Date(p.now == null ? Date.now() : p.now).toISOString(), ...entry }, p.now);
      if (p.dedupeKey) await guard.completeEvent(p.store, p.dedupeKey, { deferred: true });
      return { status: "deferred" };
    }
    await release();
    return { status: "quota", code: "daily_quota" };
  }

  const built = buildEmail(p.type, p.data || {});
  if (built.error) {
    await guard.refundQuota(p.store, to.length, p.now);
    await release();
    return { status: "failed", code: "template_error" };
  }

  let response;
  let data;
  try {
    ({ response, data } = await resendRequest(p.apiKey, "/emails", {
      method: "POST",
      headers: { "Idempotency-Key": String(p.idempotencyKey).slice(0, 256) },
      body: JSON.stringify({
        from: `${BRAND.fromName} <${BRAND.fromEmail}>`,
        to,
        subject: built.subject,
        html: built.html,
        text: built.text,
        reply_to: [BRAND.fromEmail],
        tags: [
          { name: "category", value: String(p.type).slice(0, 50) },
          { name: "app", value: "support-v2" },
        ],
      }),
    }));
  } catch (err) {
    await guard.refundQuota(p.store, to.length, p.now);
    await release();
    return { status: "failed", code: (err && err.code) || "email_unreachable" };
  }

  if (!response.ok) {
    const info = describeResendError(response.status, data, response);
    if (info.duplicate) {
      await guard.refundQuota(p.store, to.length, p.now);
      if (p.dedupeKey) await guard.completeEvent(p.store, p.dedupeKey);
      return { status: "duplicate" };
    }
    if (info.code === "daily_quota") await guard.saturateQuota(p.store, p.limits, p.now);
    else await guard.refundQuota(p.store, to.length, p.now);
    await release();
    return { status: "failed", code: info.code };
  }
  if (p.dedupeKey) await guard.completeEvent(p.store, p.dedupeKey);
  return { status: "sent", id: (data && data.id) || null };
}

module.exports = { sendServerEmail };
