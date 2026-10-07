/**
 * send-email fonksiyonu testleri için ortak düzenek: test anahtarı + x509 sertifikası, sahte Google sertifikaları,
 * kurallara benzer erişim denetimli sahte RTDB, Resend yakalama ve istek yardımcıları. Bağımlılık: openssl.
 */
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROJECT = "parla-bt-web";
const KID = "fixture-kid";
const ORIGIN = "https://www.parlabilgiteknolojileri.net";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parla-fixture-"));
execFileSync(
  "openssl",
  ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(tmp, "k.pem"), "-out", path.join(tmp, "c.pem"), "-days", "2", "-subj", "/CN=test"],
  { stdio: "ignore" }
);
const privateKey = fs.readFileSync(path.join(tmp, "k.pem"), "utf8");
const certPem = fs.readFileSync(path.join(tmp, "c.pem"), "utf8");

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function makeToken(overrides, kid) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "RS256", kid: kid || KID, typ: "JWT" });
  const payload = b64({
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    sub: "uid-staff",
    email: "staff@example.com",
    iat: now - 10,
    exp: now + 3600,
    ...overrides,
  });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

function response(status, data, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (headers || {})[String(k).toLowerCase()] || "" },
    json: async () => data,
  };
}

/** Kullanıcı kimlik → token e-postası (token'larda e-posta bulunur) */
const TOKENS = {
  staff: () => makeToken({ sub: "uid-staff", email: "staff@example.com" }),
  consultant: () => makeToken({ sub: "uid-cons", email: "danisman@parla.com" }),
  customer: () => makeToken({ sub: "uid-cust", email: "musteri@abc.com" }),
  customer2: () => makeToken({ sub: "uid-cust2", email: "kotu@abc.com" }),
};

function seedDb() {
  const iso = new Date().toISOString();
  return {
    v2: {
      users: {
        "uid-staff": { role: "super_admin", is_active: true, email: "staff@example.com", first_name: "Ali", last_name: "Veli" },
        "uid-cons": { role: "consultant", is_active: true, email: "danisman@parla.com", first_name: "Zeynep", last_name: "Arslan" },
        "uid-cust": { role: "customer", is_active: true, email: "musteri@abc.com", first_name: "Müşteri", last_name: "Kişi", company_id: "c1" },
        "uid-cust2": { role: "customer", is_active: true, email: "kotu@abc.com", company_id: "c2" },
        "uid-off": { role: "super_admin", is_active: false, email: "off@example.com" },
      },
      tickets: {
        T1: {
          ticket_number: "SUP-ABC-FI-2610-0001",
          title: "Fatura hatası",
          description: "Fatura kesilirken hata alıyorum.",
          status: "open",
          priority: "high",
          company_name: "ABC A.Ş.",
          user_id: "uid-cust",
          user_name: "Müşteri Kişi",
          user_email: "musteri@abc.com",
          created_at: iso,
        },
        // Kötü niyetli müşteri talebi: user_email başkasının adresi
        EVIL: {
          ticket_number: "SUP-EVL-FI-2610-0002",
          title: "Hesabınız askıya alındı",
          description: "Aşağıdaki bağlantıdan şifrenizi doğrulayın.",
          status: "open",
          priority: "medium",
          user_id: "uid-cust2",
          user_name: "Kötü Niyetli",
          user_email: "kurban@baska-firma.example",
          created_at: iso,
        },
      },
      ticket_assignments: {
        T1: { p1: { personnel_id: "p1", personnel_email: "Danisman@Parla.com", is_primary: true } },
      },
      personnel: {
        p1: { email: "danisman@parla.com", is_active: true },
        p2: { email: "eski@parla.com", is_active: false },
        p3: { email: "baska@parla.com", is_active: true },
      },
      ticket_messages: { T1: {}, EVIL: {} },
      ticket_history: { T1: {}, EVIL: {} },
    },
  };
}

function createFixture() {
  const state = {
    db: seedDb(),
    resendCalls: [],
    resendResponder: () => response(200, { id: "email-id-1" }),
    rtdbUrls: [],
    certFetches: 0,
  };

  /** Kural benzetimi: müşteri yalnızca kendi talebini/mesajlarını/atamalarını okur; personel listesi yalnızca personele açık. */
  function allowedRead(sub, p) {
    const role = String((state.db.v2.users[sub] || {}).role || "");
    const staff = ["super_admin", "service_admin", "project_manager", "consultant"].includes(role);
    if (staff) return true;
    const m = /^v2\/(tickets|ticket_assignments|ticket_messages|ticket_history)\/([^/]+)/.exec(p);
    if (m) {
      const t = state.db.v2.tickets[m[2]];
      return Boolean(t && t.user_id === sub);
    }
    if (p === `v2/users/${sub}` || p.startsWith(`v2/users/${sub}/`)) return true;
    return false;
  }

  state.install = () => {
    global.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("securetoken@system.gserviceaccount.com")) {
        state.certFetches += 1;
        return response(200, { [KID]: certPem }, { "cache-control": "max-age=3600" });
      }
      if (u.includes("firebasedatabase.app")) {
        const m = /\.app\/(.+)\.json\?auth=([^&]*)/.exec(u);
        const p = m[1];
        state.rtdbUrls.push(u);
        const token = decodeURIComponent(m[2]);
        const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
        if (!allowedRead(sub, p)) return response(401, { error: "Permission denied" });
        const node = p.split("/").reduce((acc, k) => (acc == null ? acc : acc[k]), state.db);
        return response(200, node === undefined ? null : node);
      }
      if (u.startsWith("https://api.resend.com/emails")) {
        if (init && init.signal && init.signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        const payload = JSON.parse(init.body);
        state.resendCalls.push({ payload, headers: init.headers });
        return state.resendResponder(payload, init);
      }
      if (u.startsWith("https://api.resend.com/domains")) {
        return response(200, { data: [{ name: "parlabilgiteknolojileri.net", status: "verified" }] });
      }
      throw new Error(`Beklenmeyen istek: ${u}`);
    };
  };

  state.reset = () => {
    state.db = seedDb();
    state.resendCalls = [];
    state.rtdbUrls = [];
    state.certFetches = 0;
    state.resendResponder = () => response(200, { id: "email-id-1" });
  };

  return state;
}

function post(handler, body, token, headers) {
  return handler({
    httpMethod: "POST",
    headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    body: JSON.stringify(body),
  });
}

/** Geçici ortam değişkenleri; geri alma işlevi döner. */
function withEnv(vars) {
  const saved = {};
  Object.keys(vars).forEach((k) => {
    saved[k] = process.env[k];
    if (vars[k] == null) delete process.env[k];
    else process.env[k] = vars[k];
  });
  return () => {
    Object.keys(saved).forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  };
}

module.exports = { PROJECT, KID, ORIGIN, makeToken, b64, response, TOKENS, createFixture, post, withEnv, certPem, privateKey };
