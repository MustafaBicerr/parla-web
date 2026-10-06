/**
 * E-posta gönderim sonucunu kullanıcıya bildirir ve başarısızlıkları aktivite kaydına yazar.
 * Böylece "mail gitmiyor" durumu sessizce yutulmaz; Aktiviteler sayfasından izlenebilir.
 */
import ParlaDb from "./firebase-client.js";
import { toast } from "./ui-shell.js";

/**
 * @param {{success:boolean, message?:string, code?:string, partial?:boolean}} res
 * @param {{ eventType?: string, label?: string, ticket?: object, actor?: object, silent?: boolean }} ctx
 * @returns {Promise<boolean>} gönderim başarılı mı
 */
export async function reportEmailResult(res, ctx) {
  if (!res || res.success) return true;
  ctx = ctx || {};

  const reason = res.message || "bilinmeyen hata";
  if (!ctx.silent) {
    toast(`${ctx.label || "E-posta bildirimi"} gönderilemedi: ${reason}`, "warning");
  }

  try {
    const ticket = ctx.ticket || {};
    await ParlaDb.logActivity(
      "email_failed",
      "ticket",
      ticket.id || ticket.ticket_id || "",
      ticket.ticket_number || "",
      `${ctx.eventType || "e-posta"} — ${res.code ? `[${res.code}] ` : ""}${reason}`.slice(0, 300),
      ctx.actor || {}
    );
  } catch {
    /* kayıt başarısız olsa da kullanıcı akışı bozulmasın */
  }
  return false;
}

/** Birden çok gönderim sonucunu tek seferde raporlar; hepsi başarılıysa true döner. */
export async function reportEmailResults(results, ctx) {
  let allOk = true;
  const seen = new Set();
  for (const res of results) {
    if (res && !res.success) {
      const key = `${res.code}|${res.message}`;
      if (seen.has(key)) continue; // aynı hata için tekrar uyarı gösterme
      seen.add(key);
      allOk = (await reportEmailResult(res, ctx)) && allOk;
    }
  }
  return allOk;
}
