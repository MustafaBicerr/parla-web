/**
 * Firebase "Admin" katmanı (D-01 B): servis hesabıyla Realtime Database (kuralları atlar) + Firebase Auth yönetimi.
 *
 * Neden `firebase-admin` DEĞİL, hafif REST?
 *  - firebase-admin ≈ 30+ MB bağımlılık ağacı getirir (grpc/gax); Netlify function paketini şişirir, soğuk başlatmayı yavaşlatır.
 *  - Gerekenler dar bir kümedir: OAuth2 JWT (node:crypto RS256), Identity Toolkit REST (hesap oluştur/sil/devre dışı/bağlantı),
 *    RTDB REST (GET/PUT/PATCH/DELETE). Hepsi tek dosyada, `fetch` enjekte edilerek birim testlenebilir.
 *
 * Arayüz (tüm kod yalnızca bunu kullanır; testler sahte bir uygulama enjekte eder — bkz. tests/helpers/fake-admin.js):
 *   admin.projectId
 *   admin.db.get(path, { orderBy, equalTo, limitToLast, limitToFirst, shallow }) -> değer | null
 *   admin.db.set(path, value)            admin.db.update(path, patch)   // patch: göreli yollar, null = sil (çok yollu, atomik)
 *   admin.db.remove(path)                admin.db.newKey()              // push benzeri anahtar
 *   admin.auth.getUser(uid) | getUserByEmail(email) -> { uid, email, disabled } | null
 *   admin.auth.createUser({ email, password, displayName, disabled }) -> { uid, email }
 *   admin.auth.updateUser(uid, { disabled, password, displayName })
 *   admin.auth.deleteUser(uid)           admin.auth.revokeRefreshTokens(uid)
 *   admin.auth.generatePasswordResetLink(email, { continueUrl }) -> { link, oobCode }
 *   admin.auth.listUsers({ maxResults, pageToken }) -> { users: [{uid,email,disabled,createdAt}], nextPageToken }
 *
 * Yapılandırma: `FIREBASE_SERVICE_ACCOUNT` = servis hesabı JSON'u (düz metin ya da base64). YOKSA `getAdmin()` zarifçe
 * `{ ok:false, code:"not_configured" }` döner; çağıranlar bunu "özellik kapalı" olarak ele alır (hata değil).
 * Servis hesabı değerleri ASLA günlüğe/yanıta yazılmaz.
 */
const crypto = require("crypto");
const { DB_URL, PROJECT_ID } = require("./firebase-auth");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/identitytoolkit",
  "https://www.googleapis.com/auth/firebase.database",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");
const REQUEST_TIMEOUT_MS = 8000;

class AdminError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.code = code;
    this.status = status || 0;
  }
}

/** Servis hesabı JSON'unu (düz ya da base64) ayrıştırır; geçersizse null. */
function parseServiceAccount(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return null;
  const attempts = [text];
  if (!text.startsWith("{")) {
    try {
      attempts.push(Buffer.from(text, "base64").toString("utf8"));
    } catch {
      /* base64 değil */
    }
  }
  for (const candidate of attempts) {
    try {
      const json = JSON.parse(candidate);
      if (json && typeof json.client_email === "string" && typeof json.private_key === "string") {
        return {
          client_email: json.client_email,
          // Netlify ortam değişkenlerinde satır sonları "\n" metni olarak gelebilir.
          private_key: json.private_key.replace(/\\n/g, "\n"),
          project_id: String(json.project_id || PROJECT_ID),
        };
      }
    } catch {
      /* sonraki aday */
    }
  }
  return null;
}

const PUSH_CHARS = "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
let lastPushTime = 0;
let lastRandChars = [];

/** Firebase push anahtarı benzeri (kronolojik sıralı, 20 karakter). */
function newPushKey(nowMs) {
  let now = nowMs == null ? Date.now() : nowMs;
  const duplicate = now === lastPushTime;
  lastPushTime = now;
  const stamp = new Array(8);
  for (let i = 7; i >= 0; i -= 1) {
    stamp[i] = PUSH_CHARS.charAt(now % 64);
    now = Math.floor(now / 64);
  }
  let id = stamp.join("");
  if (!duplicate) {
    lastRandChars = Array.from(crypto.randomBytes(12), (b) => b % 64);
  } else {
    let i = 11;
    for (; i >= 0 && lastRandChars[i] === 63; i -= 1) lastRandChars[i] = 0;
    if (i >= 0) lastRandChars[i] += 1;
  }
  for (let i = 0; i < 12; i += 1) id += PUSH_CHARS.charAt(lastRandChars[i]);
  return id;
}

const IDENTITY_ERRORS = {
  EMAIL_EXISTS: ["email_exists", 409],
  EMAIL_NOT_FOUND: ["user_not_found", 404],
  USER_NOT_FOUND: ["user_not_found", 404],
  INVALID_EMAIL: ["invalid_email", 400],
  WEAK_PASSWORD: ["weak_password", 400],
  MISSING_PASSWORD: ["weak_password", 400],
  OPERATION_NOT_ALLOWED: ["operation_not_allowed", 403],
  TOO_MANY_ATTEMPTS_TRY_LATER: ["rate_limited", 429],
};

function identityError(status, body) {
  const raw = String((body && body.error && body.error.message) || "");
  const key = raw.split(/[ :]/)[0];
  const [code, httpStatus] = IDENTITY_ERRORS[key] || ["auth_error", status >= 400 ? status : 502];
  return new AdminError(code, `Kimlik hizmeti hatası (${key || status}).`, httpStatus);
}

/**
 * Servis hesabıyla REST tabanlı Admin uygulaması.
 * @param {{client_email: string, private_key: string, project_id: string}} sa
 * @param {{ fetchImpl?: Function, now?: () => number, dbUrl?: string }} [options]
 */
function createRestAdmin(sa, options) {
  const opts = options || {};
  const fetchImpl = opts.fetchImpl || ((...args) => fetch(...args));
  const clock = opts.now || (() => Date.now());
  const dbUrl = String(opts.dbUrl || DB_URL).replace(/\/+$/, "");
  const projectId = sa.project_id || PROJECT_ID;
  let tokenCache = { value: "", expires: 0 };
  let tokenInflight = null;

  async function fetchJson(url, init, label) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new AdminError(timedOut ? "timeout" : "unreachable", `${label} erişilemedi.`, timedOut ? 504 : 502);
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { res, data };
  }

  async function mintToken() {
    const iat = Math.floor(clock() / 1000);
    const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const head = enc({ alg: "RS256", typ: "JWT" });
    const claims = enc({ iss: sa.client_email, scope: SCOPES, aud: TOKEN_URL, iat, exp: iat + 3600 });
    const signature = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${claims}`), sa.private_key).toString("base64url");
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claims}.${signature}`,
    }).toString();
    const { res, data } = await fetchJson(
      TOKEN_URL,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
      "Google kimlik doğrulaması"
    );
    if (!res.ok || !data || !data.access_token) {
      throw new AdminError("service_account_rejected", "Servis hesabı kabul edilmedi.", 502);
    }
    tokenCache = { value: data.access_token, expires: clock() + Math.max(60, Number(data.expires_in) || 3600) * 1000 - 60000 };
    return tokenCache.value;
  }

  async function accessToken() {
    if (tokenCache.value && tokenCache.expires > clock()) return tokenCache.value;
    if (!tokenInflight) {
      tokenInflight = mintToken().finally(() => {
        tokenInflight = null;
      });
    }
    return tokenInflight;
  }

  const authHeaders = async (extra) => ({ Authorization: `Bearer ${await accessToken()}`, ...(extra || {}) });

  // ---- Realtime Database (REST; kuralları atlar) -------------------------------------------------------------
  function dbQuery(q) {
    const params = [];
    const add = (k, v) => params.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    if (q) {
      if (q.shallow) add("shallow", "true");
      if (q.orderBy) add("orderBy", JSON.stringify(q.orderBy));
      if (q.equalTo !== undefined) add("equalTo", JSON.stringify(q.equalTo));
      if (q.limitToLast) add("limitToLast", String(q.limitToLast));
      if (q.limitToFirst) add("limitToFirst", String(q.limitToFirst));
    }
    return params.length ? `?${params.join("&")}` : "";
  }

  async function dbRequest(method, path, query, body) {
    const clean = String(path).replace(/^\/+|\/+$/g, "");
    const url = `${dbUrl}/${clean}.json${dbQuery(query)}`;
    const init = { method, headers: await authHeaders(body !== undefined ? { "Content-Type": "application/json" } : null) };
    if (body !== undefined) init.body = JSON.stringify(body);
    const { res, data } = await fetchJson(url, init, "Veritabanı");
    if (!res.ok) {
      throw new AdminError("db_error", `Veritabanı hatası (HTTP ${res.status}).`, res.status === 401 || res.status === 403 ? 502 : res.status);
    }
    return data;
  }

  const db = {
    async get(path, query) {
      const value = await dbRequest("GET", path, query);
      return value === undefined ? null : value;
    },
    async set(path, value) {
      await dbRequest("PUT", path, null, value === undefined ? null : value);
    },
    async update(path, patch) {
      await dbRequest("PATCH", path, null, patch || {});
    },
    async remove(path) {
      await dbRequest("DELETE", path);
    },
    newKey() {
      return newPushKey(clock());
    },
  };

  // ---- Identity Toolkit (Admin REST) -------------------------------------------------------------------------
  const itBase = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`;

  async function identity(path, body, method) {
    const { res, data } = await fetchJson(
      `${itBase}/${path}`,
      method === "GET"
        ? { method: "GET", headers: await authHeaders() }
        : { method: "POST", headers: await authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body || {}) },
      "Kimlik hizmeti"
    );
    if (!res.ok) throw identityError(res.status, data);
    return data || {};
  }

  const toUser = (u) =>
    u && u.localId
      ? {
          uid: u.localId,
          email: String(u.email || "").toLowerCase(),
          disabled: u.disabled === true,
          createdAt: u.createdAt ? new Date(Number(u.createdAt)).toISOString() : "",
        }
      : null;

  const auth = {
    async getUser(uid) {
      const data = await identity("accounts:lookup", { localId: [uid] });
      return toUser((data.users || [])[0]);
    },
    async getUserByEmail(email) {
      const data = await identity("accounts:lookup", { email: [String(email || "").trim().toLowerCase()] });
      return toUser((data.users || [])[0]);
    },
    async createUser(input) {
      const body = { email: input.email, password: input.password, emailVerified: false, disabled: input.disabled === true };
      if (input.displayName) body.displayName = input.displayName;
      const data = await identity("accounts", body);
      return { uid: data.localId, email: String(data.email || input.email).toLowerCase() };
    },
    async updateUser(uid, patch) {
      const body = { localId: uid };
      if (patch.disabled !== undefined) body.disableUser = patch.disabled === true;
      if (patch.password) body.password = patch.password;
      if (patch.displayName !== undefined) body.displayName = patch.displayName;
      await identity("accounts:update", body);
    },
    async deleteUser(uid) {
      await identity("accounts:delete", { localId: uid });
    },
    async revokeRefreshTokens(uid) {
      await identity("accounts:update", { localId: uid, validSince: String(Math.floor(clock() / 1000)) });
    },
    async generatePasswordResetLink(email, linkOptions) {
      const body = { requestType: "PASSWORD_RESET", email: String(email || "").trim().toLowerCase(), returnOobLink: true };
      if (linkOptions && linkOptions.continueUrl) body.continueUrl = linkOptions.continueUrl;
      const data = await identity("accounts:sendOobCode", body);
      let oobCode = String(data.oobCode || "");
      if (!oobCode && data.oobLink) {
        try {
          oobCode = new URL(data.oobLink).searchParams.get("oobCode") || "";
        } catch {
          oobCode = "";
        }
      }
      return { link: String(data.oobLink || ""), oobCode };
    },
    async listUsers(listOptions) {
      const o = listOptions || {};
      const qs = [`maxResults=${Math.min(1000, Math.max(1, Number(o.maxResults) || 500))}`];
      if (o.pageToken) qs.push(`nextPageToken=${encodeURIComponent(o.pageToken)}`);
      const data = await identity(`accounts:batchGet?${qs.join("&")}`, null, "GET");
      return { users: (data.users || []).map(toUser).filter(Boolean), nextPageToken: data.nextPageToken || "" };
    },
  };

  return { projectId, db, auth };
}

let cached = null;
let injected = null;

/** Testlerde sahte Admin uygulaması enjekte eder (null: sıfırla). */
function setAdminForTests(admin) {
  injected = admin;
  cached = null;
}

/**
 * Yapılandırılmış Admin uygulaması. Servis hesabı yoksa / bozuksa `{ ok:false, code:"not_configured" }`.
 * @returns {{ ok: true, admin: object } | { ok: false, code: "not_configured" }}
 */
function getAdmin(env) {
  if (injected) return { ok: true, admin: injected };
  const e = env || process.env;
  const raw = e.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return { ok: false, code: "not_configured" };
  if (cached && cached.raw === raw) return { ok: true, admin: cached.admin };
  const sa = parseServiceAccount(raw);
  if (!sa) {
    console.error("[admin] FIREBASE_SERVICE_ACCOUNT ayrıştırılamadı (geçerli JSON ya da base64 JSON olmalı).");
    return { ok: false, code: "not_configured" };
  }
  cached = { raw, admin: createRestAdmin(sa) };
  return { ok: true, admin: cached.admin };
}

module.exports = { AdminError, parseServiceAccount, createRestAdmin, getAdmin, setAdminForTests, newPushKey };
