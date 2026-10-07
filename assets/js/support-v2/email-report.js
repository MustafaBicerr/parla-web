/**
 * E-posta gönderim sonucunu kullanıcıya bildirir ve başarısızlıkları aktivite kaydına yazar.
 * Böylece "mail gitmiyor" durumu sessizce yutulmaz; Aktiviteler sayfasından izlenebilir.
 *
 * Kullanıcıya (müşteri dahil) YALNIZCA sade, teknik olmayan metin gösterilir (altyapı adı, anahtar, DNS vb. yok).
 * Teknik ayrıntı (kod, HTTP durumu, kuyruğa alındı mı, alıcı sayısı, kısmi başarı) aktivite kaydına yazılır;
 * sunucunun `detail` alanı yalnızca yönetici rollerine döner ve yalnızca onlara gösterilir.
 */
import ParlaDb from "./firebase-client.js";
import { toast } from "./ui-shell.js";
import { emailFailureMessage, emailFailureDetails } from "./email-service.js";

export { emailFailureMessage, emailFailureDetails };

/**
 * @param {{success:boolean, message?:string, code?:string, partial?:boolean, queued?:boolean, status?:number}} res
 * @param {{ eventType?: string, label?: string, ticket?: object, actor?: object, silent?: boolean }} ctx
 * @returns {Promise<boolean>} gönderim başarılı mı
 */
export async function reportEmailResult(res, ctx) {
  if (!res || res.success) return true;
  ctx = ctx || {};

  if (!ctx.silent) {
    toast(emailFailureMessage(res, ctx.label), "warning");
  }

  try {
    const ticket = ctx.ticket || {};
    await ParlaDb.logActivity(
      "email_failed",
      "ticket",
      ticket.id || ticket.ticket_id || "",
      ticket.ticket_number || "",
      emailFailureDetails(res, ctx),
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
