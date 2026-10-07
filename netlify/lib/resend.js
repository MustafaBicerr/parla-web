/**
 * Resend HTTP istemcisi (zaman aşımlı) + hata eşlemesi. send-email ve günlük özet işlevi ortak kullanır.
 */
const { HttpError } = require("./firebase-auth");
const { secondsToNextDay } = require("./email-guard");

const RESEND_TIMEOUT_MS = 5000;

/** İsteğe bağlı RESEND_TIMEOUT_MS ile 200–8000 ms aralığında ayarlanabilir (testler/işletme). */
function resendTimeoutMs() {
  const n = Number.parseInt(process.env.RESEND_TIMEOUT_MS, 10);
  return Number.isFinite(n) ? Math.min(8000, Math.max(200, n)) : RESEND_TIMEOUT_MS;
}

function failure(statusCode, message, code, extra) {
  const err = new HttpError(statusCode, message, code);
  if (extra) Object.assign(err, extra);
  return err;
}

async function resendRequest(apiKey, path, init) {
  let response;
  try {
    response = await fetch(`https://api.resend.com${path}`, {
      ...init,
      signal: AbortSignal.timeout(resendTimeoutMs()),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(init && init.headers),
      },
    });
  } catch (err) {
    const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
    throw failure(
      timedOut ? 504 : 502,
      "E-posta servisine ulaşılamadı.",
      timedOut ? "email_timeout" : "email_unreachable"
    );
  }
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function retryAfterFrom(response, fallback) {
  const raw = response && response.headers && response.headers.get ? response.headers.get("retry-after") : "";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3600) : fallback;
}


/**
 * Resend hata yanıtını istemciye güvenli (genel) bir hataya çevirir. Altyapı ayrıntısı `detail` içindedir ve
 * yalnızca yönetici rollerine gösterilir (bkz. handler).
 */
function describeResendError(status, data, response) {
  const name = String((data && data.name) || "");
  const message = String((data && data.message) || "");
  const generic = "E-posta şu an gönderilemiyor.";

  if (name === "daily_quota_exceeded") {
    return {
      status: 429,
      code: "daily_quota",
      message: "Günlük e-posta kotası doldu.",
      detail: "Resend günlük gönderim kotası doldu (ücretsiz plan ≈100/gün); UTC gün sonunda sıfırlanır.",
      retryAfter: secondsToNextDay(),
    };
  }
  if (name === "monthly_quota_exceeded") {
    return {
      status: 429,
      code: "monthly_quota",
      message: "Aylık e-posta kotası doldu.",
      detail: "Resend aylık gönderim kotası doldu; planı yükseltin ya da ay başını bekleyin.",
      retryAfter: 6 * 3600,
    };
  }
  if (status === 429) {
    return {
      status: 429,
      code: "rate_limited",
      message: "E-posta servisi yoğun; otomatik olarak yeniden denenecek.",
      detail: "Resend istek sınırı (saniyede 2 istek) aşıldı.",
      retryAfter: retryAfterFrom(response, 5),
    };
  }
  if (status === 409 && name === "concurrent_idempotent_requests") {
    return { status: 409, code: "concurrent_request", message: generic, detail: "Aynı istek eşzamanlı işleniyor.", retryAfter: 2 };
  }
  if (status === 409 && name === "invalid_idempotent_request") {
    // Aynı anahtar farklı içerikle yeniden kullanıldı: ilk gönderim zaten kabul edilmiştir.
    return { status: 200, code: "duplicate", message: "", detail: "", duplicate: true };
  }
  if (
    (status === 403 || name === "validation_error") &&
    /domain.*(not verified|is not verified|not found)|verify.*domain|not verified/i.test(message)
  ) {
    return {
      status: 502,
      code: "domain_not_verified",
      message: generic,
      detail: "Gönderen alan adı Resend'de doğrulanmamış (DNS kayıtlarını kontrol edin).",
    };
  }
  if (["missing_api_key", "invalid_api_key", "restricted_api_key"].includes(name) || status === 401) {
    return {
      status: 502,
      code: "invalid_api_key",
      message: generic,
      detail: "Resend API anahtarı geçersiz veya yetkisiz (Netlify ortam değişkenini kontrol edin).",
    };
  }
  if (status === 403) {
    return { status: 502, code: "forbidden", message: generic, detail: "Resend gönderimi reddetti (alan adı veya hesap yetkisi)." };
  }
  if (status === 400 || status === 422) {
    return {
      status: 400,
      code: "validation_error",
      message: "E-posta içeriği veya alıcı kabul edilmedi.",
      detail: "Resend isteği doğrulamadan geçirmedi.",
    };
  }
  return { status: 502, code: "resend_error", message: generic, detail: `Resend HTTP ${status}.` };
}

module.exports = { RESEND_TIMEOUT_MS, failure, resendRequest, describeResendError, retryAfterFrom };
