/**
 * Firebase ID token doğrulama + Realtime Database REST erişimi (Admin SDK yok).
 *
 * - Token, Google'ın yayınladığı x509 sertifikalarıyla yerelde doğrulanır
 *   (API anahtarı veya ek bağımlılık gerekmez).
 * - Veritabanı okumaları kullanıcının KENDİ token'ı ile yapılır; böylece
 *   database.rules.json kuralları sunucu tarafında da geçerli olur.
 */
const crypto = require("crypto");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "parla-bt-web";
const DB_URL = (
  process.env.FIREBASE_DATABASE_URL ||
  "https://parla-bt-web-default-rtdb.europe-west1.firebasedatabase.app"
).replace(/\/+$/, "");
const CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const CLOCK_SKEW_SEC = 300;

class HttpError extends Error {
  constructor(statusCode, message, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || "";
  }
}

let certCache = { certs: null, expires: 0 };

function resetCertCache() {
  certCache = { certs: null, expires: 0 };
}

async function fetchCerts(fetchImpl, force) {
  const now = Date.now();
  if (!force && certCache.certs && certCache.expires > now) return certCache.certs;

  let res;
  try {
    res = await fetchImpl(CERTS_URL);
  } catch {
    throw new HttpError(503, "Kimlik doğrulama anahtarları alınamadı.", "certs_unreachable");
  }
  if (!res.ok) {
    throw new HttpError(503, "Kimlik doğrulama anahtarları alınamadı.", "certs_unreachable");
  }
  const certs = await res.json();
  const cacheControl = (res.headers && res.headers.get && res.headers.get("cache-control")) || "";
  const match = /max-age=(\d+)/.exec(cacheControl);
  const ttlMs = Math.min((match ? Number(match[1]) : 3600) * 1000, 6 * 3600 * 1000);
  certCache = { certs, expires: now + ttlMs };
  return certs;
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

/**
 * @returns {Promise<{uid: string, email: string, claims: object}>}
 */
async function verifyIdToken(token, options) {
  const fetchImpl = (options && options.fetchImpl) || fetch;
  const nowSec = Math.floor(((options && options.now) || Date.now()) / 1000);

  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new HttpError(401, "Oturum doğrulanamadı.", "bad_token");

  let header;
  let payload;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    throw new HttpError(401, "Oturum doğrulanamadı.", "bad_token");
  }

  if (header.alg !== "RS256" || !header.kid) {
    throw new HttpError(401, "Oturum doğrulanamadı.", "bad_token");
  }

  let certs = await fetchCerts(fetchImpl, false);
  if (!certs[header.kid]) certs = await fetchCerts(fetchImpl, true);
  const cert = certs[header.kid];
  if (!cert) throw new HttpError(401, "Oturum doğrulanamadı.", "unknown_kid");

  let valid = false;
  try {
    valid = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      crypto.createPublicKey(cert),
      Buffer.from(parts[2], "base64url")
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new HttpError(401, "Oturum doğrulanamadı.", "bad_signature");

  if (
    payload.aud !== PROJECT_ID ||
    payload.iss !== `https://securetoken.google.com/${PROJECT_ID}` ||
    !payload.sub ||
    typeof payload.sub !== "string" ||
    payload.exp <= nowSec ||
    payload.iat > nowSec + CLOCK_SKEW_SEC
  ) {
    throw new HttpError(401, "Oturum süresi dolmuş veya geçersiz. Sayfayı yenileyin.", "bad_claims");
  }

  return { uid: payload.sub, email: String(payload.email || "").toLowerCase(), claims: payload };
}

/** Firebase push key / uid benzeri güvenli anahtar mı? (path enjeksiyonunu engeller) */
function isSafeKey(value) {
  return /^[A-Za-z0-9_-]{6,128}$/.test(String(value || ""));
}

/**
 * RTDB REST GET — kullanıcının token'ı ile.
 * @returns {Promise<any|null>} 404/boş düğüm için null
 */
async function rtdbGet(path, token, options) {
  const fetchImpl = (options && options.fetchImpl) || fetch;
  const clean = String(path).replace(/^\/+|\/+$/g, "");
  const url = `${DB_URL}/${clean}.json?auth=${encodeURIComponent(token)}`;

  let res;
  try {
    res = await fetchImpl(url);
  } catch {
    throw new HttpError(503, "Veritabanına ulaşılamadı.", "db_unreachable");
  }
  if (res.status === 401 || res.status === 403) {
    throw new HttpError(403, "Bu kayda erişim yetkiniz yok.", "db_denied");
  }
  if (!res.ok) {
    throw new HttpError(502, "Veritabanı okunamadı.", "db_error");
  }
  return res.json();
}

module.exports = {
  HttpError,
  PROJECT_ID,
  DB_URL,
  verifyIdToken,
  rtdbGet,
  isSafeKey,
  resetCertCache,
};
