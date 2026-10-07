/**
 * Uçtan uca test altyapısı (Playwright + gerçek kurallar + gerçek e-posta fonksiyonu).
 *
 *  - Statik sunucu repo kökünü yayınlar.
 *  - Tarayıcıdaki firebase-init.js yerine, çağrıları Node'a (exposeFunction) ileten bir Firebase taklidi konur.
 *    Node tarafında veritabanı targaryen ile database.rules.json kurallarını UYGULAYARAK çalışır
 *    (yetkisiz okuma/yazma PERMISSION_DENIED döner).
 *  - /api/send-email isteği gerçek netlify/functions/send-email.js koduna yönlenir; Google sertifikaları,
 *    RTDB REST ve Resend çağrıları world içinde taklit edilir (gönderilen e-postalar world.emails'e düşer).
 *
 * Gereksinimler: Playwright + Chromium (`cd tests/e2e && npm ci`; ya da PLAYWRIGHT_PATH), `cd tests/rules && npm ci`, openssl.
 *
 * Bilinen sınırlar (WP-15, SEN-27/ALT-27 düzeltmeleri sonrası):
 *  - Anonim (oturumsuz) işlemler artık GERÇEKTEN auth=null ile değerlendirilir (targaryen `as(null)` önceki yazanın yetkisini
 *    korurdu; `viewAs()` bunu aşar). Her yazım sonrası depo yetkisiz duruma döner.
 *  - `runTransaction` Node tarafında atomik "karşılaştır-ve-yaz" (cas) ile çalışır; çakışmada gerçek Firebase gibi yeniden dener.
 *  - `signOut` oturumu gerçekten kapatır (sonraki sayfa yüklemeleri ve veritabanı işlemleri oturumsuz olur).
 *  - Same-origin 4xx/5xx yanıtları (404 veren CSS/görsel/PDF dahil; `/api/*` hariç) `errors` listesine düşer.
 *  - Gerçek `assets/js/firebase-init.js` testte ÇALIŞMAZ (taklit edilir); API yüzeyi uyumu `tests/unit/firebase-init-contract.test.mjs` ile korunur.
 *  - Sunucu tarafı sorgu türleri: yalnızca orderByChild+equalTo ve limitToLast desteklenir (limitToFirst/startAt/endAt yok).
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const PROJECT = "parla-bt-web";
const KID = "e2e-kid";

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright", "/opt/node-tools/node_modules/playwright"].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* sonraki */ }
  }
  throw new Error("Playwright bulunamadı (PLAYWRIGHT_PATH ayarlayın).");
}
const { isDeepStrictEqual } = require("node:util");
const targaryen = require(path.join(ROOT, "tests", "rules", "node_modules", "targaryen"));

/**
 * Veritabanının verilen yetkiyle görünümü. targaryen `db.as(null)` yetkiyi SIFIRLAMAZ (`with()` null auth'u yok sayıp son yazanın
 * yetkisini korur); bu yüzden auth=null için yeni bir Database örneği kurulur.
 */
function viewAs(db, auth) {
  const Database = db.constructor;
  return new Database({ rules: db.rules, data: db.root, auth: auth || null, debug: db.debug });
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".json": "application/json", ".woff2": "font/woff2" };

function makeKeys() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parla-e2e-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "2", "-subj", "/CN=e2e"], { stdio: "ignore" });
  return { privateKey: fs.readFileSync(keyPath, "utf8"), cert: fs.readFileSync(certPath, "utf8") };
}

function b64(obj) { return Buffer.from(JSON.stringify(obj)).toString("base64url"); }

function createWorld(seedData, options) {
  options = options || {};
  const keys = makeKeys();
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "database.rules.json"), "utf8"));
  const world = {
    db: targaryen.database(rules, seedData || {}),
    rules,
    emails: [],
    denied: [],
    resendFailure: null,
    /** `signInWithEmailAndPassword` taklidinin kabul ettiği parola. */
    password: "Parla-e2e-1",
    enforceRules: options.enforceRules !== false,
    keys,
    mintToken(uid) {
      const profile = this.valueAt(`v2/users/${uid}`) || {};
      const now = Math.floor(Date.now() / 1000);
      const header = b64({ alg: "RS256", kid: KID, typ: "JWT" });
      const payload = b64({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, email: String(profile.email || "").toLowerCase(), iat: now - 5, exp: now + 3600 });
      const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.privateKey).toString("base64url");
      return `${header}.${payload}.${sig}`;
    },
    valueAt(p) {
      const node = this.db.root.$child(String(p).replace(/^\/+/, ""));
      return node ? node.$value() : null;
    },
    /** Kural kontrolü olmadan veri yazar (test hazırlığı). */
    seed(p, value) {
      const res = this.db.with({ rules: { rules: { ".read": true, ".write": true } } }).write(p, value);
      this.db = viewAs(res.newDatabase.with({ rules: { rules: this.rules.rules } }), null);
    },
    dbOp(op) {
      const auth = op.uid ? { uid: op.uid, token: { email: String((this.valueAt(`v2/users/${op.uid}`) || {}).email || "").toLowerCase() } } : null;
      const db = this.enforceRules ? this.db : this.db.with({ rules: { rules: { ".read": true, ".write": true } } });
      const as = viewAs(db, auth);
      const path_ = "/" + String(op.path || "").replace(/^\/+/, "");
      const deny = (res) => {
        const info = String(res.info || "").split("\n").slice(0, 3).join(" ");
        this.denied.push({ op: op.op, path: path_, uid: op.uid, info });
        return { error: "PERMISSION_DENIED", info };
      };
      const commit = (res) => {
        // Depo her zaman "yetkisiz" duruma döner: sonraki işlem kendi auth'unu açıkça belirtir.
        this.db = viewAs(res.newDatabase.with({ rules: { rules: this.rules.rules } }), null);
        return { ok: true };
      };
      if (op.op === "get") {
        const res = as.read(path_, op.q ? { query: op.q } : undefined);
        if (!res.allowed) return deny(res);
        let val = this.valueAt(path_);
        if (op.q && val && typeof val === "object") {
          let entries = Object.entries(val);
          if (op.q.orderByChild !== undefined && op.q.equalTo !== undefined) {
            entries = entries.filter(([, item]) => item && item[op.q.orderByChild] === op.q.equalTo);
          }
          if (op.q.limitToLast) {
            if (op.q.orderByChild !== undefined) entries.sort((a, b) => String(a[1] && a[1][op.q.orderByChild] != null ? a[1][op.q.orderByChild] : "").localeCompare(String(b[1] && b[1][op.q.orderByChild] != null ? b[1][op.q.orderByChild] : "")));
            entries = entries.slice(-op.q.limitToLast);
          }
          val = Object.fromEntries(entries);
        }
        return { val: val === undefined ? null : val };
      }
      if (op.op === "set") {
        const res = as.write(path_, op.value === undefined ? null : op.value);
        return res.allowed ? commit(res) : deny(res);
      }
      if (op.op === "update") {
        const res = as.update(path_, op.value);
        return res.allowed ? commit(res) : deny(res);
      }
      if (op.op === "remove") {
        const res = as.write(path_, null);
        return res.allowed ? commit(res) : deny(res);
      }
      if (op.op === "cas") {
        // Atomik karşılaştır-ve-yaz (runTransaction): bu işlev eşzamanlı olduğundan iki işlem araya giremez.
        const cur = this.valueAt(path_);
        const curVal = cur === undefined ? null : cur;
        if (!isDeepStrictEqual(curVal, op.expected === undefined ? null : op.expected)) return { conflict: true, val: curVal };
        const res = as.write(path_, op.value === undefined ? null : op.value);
        return res.allowed ? commit(res) : deny(res);
      }
      return { error: "BAD_OP" };
    },
  };
  return world;
}

/** Netlify function'ı world'e bağlı sahte ağ ile çalıştırır. */
async function callEmailFunction(world, req) {
  process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_e2e";
  const { resetCertCache } = require(path.join(ROOT, "netlify", "lib", "firebase-auth.js"));
  resetCertCache();
  const realFetch = global.fetch;
  const json = (status, data, headers) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => (headers || {})[k.toLowerCase()] || "" }, json: async () => data });
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("securetoken@system.gserviceaccount.com")) return json(200, { [KID]: world.keys.cert }, { "cache-control": "max-age=3600" });
    if (u.includes("firebasedatabase.app")) {
      const m = /\.app\/(.+)\.json\?auth=(.*)$/.exec(u);
      const token = decodeURIComponent(m[2]);
      const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
      const res = world.db.as({ uid: sub, token: { email: String((world.valueAt(`v2/users/${sub}`) || {}).email || "").toLowerCase() } }).read("/" + m[1]);
      if (!res.allowed) return json(401, { error: "Permission denied" });
      const val = world.valueAt(m[1]);
      return json(200, val === undefined ? null : val);
    }
    if (u.startsWith("https://api.resend.com/emails")) {
      const payload = JSON.parse(init.body);
      if (world.resendFailure) return json(world.resendFailure.status, world.resendFailure.body);
      world.emails.push({ ...payload, idempotency: init.headers["Idempotency-Key"] });
      return json(200, { id: `e2e-${world.emails.length}` });
    }
    if (u.startsWith("https://api.resend.com/domains")) return json(200, { data: [{ name: "parlabilgiteknolojileri.net", status: "verified" }] });
    return realFetch(url, init);
  };
  try {
    const { handler } = require(path.join(ROOT, "netlify", "functions", "send-email.js"));
    return await handler(req);
  } finally {
    global.fetch = realFetch;
  }
}

const BROWSER_STUB = (uid, email) => `
let curUid = ${JSON.stringify(uid)};
const email = ${JSON.stringify(email || "")};
const call = (op) => window.__dbOp(Object.assign({ uid: curUid }, op));
const unwrap = async (p) => {
  const r = await p;
  if (r && r.error) { const e = new Error(r.error + ": " + (r.info || "")); e.code = r.error; throw e; }
  return r;
};
let seq = 0;
const snap = (v) => ({ exists: () => v != null, val: () => v });
const makeUser = (u) => (u ? { uid: u, email, getIdToken: async () => window.__mintToken(u) } : null);
let authUser = makeUser(curUid);
const listeners = new Set();
const authError = (code) => { const e = new Error(code); e.code = code; return e; };
window.__PARLA_FIREBASE = {
  database: {}, app: { options: {} }, analytics: null,
  auth: { get currentUser() { return authUser; } },
  authFn: {
    onAuthStateChanged: (a, cb) => { listeners.add(cb); setTimeout(() => { if (listeners.has(cb)) cb(authUser); }, 0); return () => listeners.delete(cb); },
    signOut: async () => {
      await window.__signOut();
      curUid = null; authUser = null;
      listeners.forEach((cb) => cb(null));
    },
    signInWithEmailAndPassword: async (a, mail, pass) => {
      const r = await window.__signIn(String(mail || ""), String(pass || ""));
      if (r.error) throw authError(r.error);
      curUid = r.uid; authUser = { uid: r.uid, email: r.email, getIdToken: async () => window.__mintToken(r.uid) };
      listeners.forEach((cb) => cb(authUser));
      return { user: authUser };
    },
    sendPasswordResetEmail: async () => {},
    verifyPasswordResetCode: async () => "ayse.demir@ornekholding.com",
    confirmPasswordReset: async () => {},
    EmailAuthProvider: { credential: (e, p) => ({ e, p }) },
    reauthenticateWithCredential: async () => {},
    updatePassword: async () => {},
  },
  db: {
    ref: (d, p) => ({ path: String(p).replace(/^\\/+|\\/+$/g, "") }),
    push: (r) => { seq += 1; const key = "-N" + Date.now().toString(36) + String(seq).padStart(3, "0"); return { path: r.path + "/" + key, key }; },
    set: async (r, v) => { await unwrap(call({ op: "set", path: r.path, value: v === undefined ? null : v })); },
    update: async (r, v) => { await unwrap(call({ op: "update", path: r.path, value: v })); },
    remove: async (r) => { await unwrap(call({ op: "remove", path: r.path })); },
    get: async (r) => { const res = await unwrap(call({ op: "get", path: r.path, q: r.q })); return snap(res.val); },
    query: (r, ...parts) => ({ path: r.path, q: Object.assign({}, r.q, ...parts) }),
    orderByChild: (f) => ({ orderByChild: f }),
    equalTo: (v) => ({ equalTo: v }),
    limitToLast: (n) => ({ limitToLast: n }),
    onValue: () => () => {}, off: () => {},
    // Gerçek Firebase gibi iyimser çalışır; oku, işlevi uygula, koşullu yaz (Node tarafında atomik karşılaştır-ve-yaz), çakışmada yeniden dene.
    runTransaction: async (r, fn) => {
      for (let attempt = 0; attempt < 25; attempt++) {
        const cur = await unwrap(call({ op: "get", path: r.path }));
        const curVal = cur.val === undefined ? null : cur.val;
        const next = fn(curVal);
        if (next === undefined) return { committed: false, snapshot: snap(curVal) };
        const res = await unwrap(call({ op: "cas", path: r.path, expected: curVal, value: next }));
        if (res && res.conflict) continue;
        return { committed: true, snapshot: snap(next) };
      }
      const e = new Error("maxretry"); e.code = "maxretry"; throw e;
    },
  },
};`;

async function startServer(world, options) {
  options = options || {};
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const p = path.join(ROOT, url);
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = loadPlaywright();
  const exe = options.executablePath || process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, args: ["--no-sandbox"] });

  /** uid olarak oturum açmış (ya da anonim) yeni bir tarayıcı bağlamı + sayfa. */
  async function session(uid, ctxOptions) {
    const context = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, locale: "tr-TR", timezoneId: "Europe/Istanbul" }, ctxOptions || {}));
    // Oturum durumu bağlam düzeyindedir: signOut/signIn sonrası yeni sayfa yüklemeleri de aynı kimlikle açılır.
    const state = { uid: uid || null };
    await context.exposeFunction("__dbOp", (op) => world.dbOp(op));
    await context.exposeFunction("__mintToken", (u) => world.mintToken(u));
    await context.exposeFunction("__signOut", () => { state.uid = null; });
    await context.exposeFunction("__signIn", (mail, pass) => {
      const users = world.valueAt("v2/users") || {};
      const found = Object.entries(users).find(([, p]) => p && String(p.email || "").toLowerCase() === String(mail).trim().toLowerCase());
      if (!found || pass !== world.password) return { error: "auth/invalid-credential" };
      if (found[1].is_active === false) return { error: "auth/user-disabled" };
      state.uid = found[0];
      return { uid: found[0], email: String(found[1].email || "").toLowerCase() };
    });
    // SRI: sahte CDN betikleri gerçek özetle eşleşmez; `integrity` ayarlanması KAYDEDİLİR (data-sri-requested) ama uygulanmaz.
    await context.addInitScript(() => {
      for (const C of [HTMLScriptElement, HTMLLinkElement]) {
        Object.defineProperty(C.prototype, "integrity", {
          configurable: true,
          get() { return this.getAttribute("data-sri-requested") || ""; },
          set(v) { this.setAttribute("data-sri-requested", String(v)); },
        });
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_TUNNEL|net::ERR/.test(m.text())) errors.push("console: " + m.text().slice(0, 300)); });
    // Same-origin 4xx/5xx (404 veren CSS/görsel/PDF dahil) sayfa hatası sayılır (ALT-27).
    page.on("response", (r) => {
      try {
        const u = new URL(r.url());
        // /api/* yanıtları (ör. bilerek tetiklenen 429/502) uygulama düzeyi sonuçtur ve testlerce açıkça denetlenir; yalnız statik kaynaklar sayılır.
        if (u.origin === base && r.status() >= 400 && !u.pathname.startsWith("/api/") && !(options.allowStatus || []).includes(u.pathname)) errors.push(`http ${r.status()}: ${u.pathname}`);
      } catch { /* geçersiz URL */ }
    });
    page.on("requestfailed", (r) => {
      try {
        const u = new URL(r.url());
        if (u.origin === base && !/ERR_ABORTED/.test(String(r.failure() && r.failure().errorText))) errors.push(`istek başarısız: ${u.pathname}`);
      } catch { /* geçersiz URL */ }
    });
    await page.route("**/firebase-init.js", (r) => {
      const mail = state.uid ? String((world.valueAt(`v2/users/${state.uid}`) || {}).email || "").toLowerCase() : "";
      return r.fulfill({ contentType: "text/javascript", body: BROWSER_STUB(state.uid, mail) });
    });
    await page.route(/gstatic\.com\/firebasejs\/.*\/firebase-app\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "export const initializeApp=(o,n)=>({n});export const deleteApp=async()=>{};" }));
    await page.route(/gstatic\.com\/firebasejs\/.*\/firebase-auth\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "export const getAuth=()=>({});export const createUserWithEmailAndPassword=async(a,e)=>({user:{uid:'new-'+Date.now(),email:e}});" }));
    if (options.fontAwesomeDir) {
      // İkon yazı tipi yerelden sunulur (ekran görüntüleri için gerçekçi görünüm).
      await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/[^/]+\/css\/all\.min\.css/, (r) => r.fulfill({ contentType: "text/css", body: fs.readFileSync(path.join(options.fontAwesomeDir, "css", "all.min.css")) }));
      await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/[^/]+\/webfonts\/([^?]+)/, (r) => {
        const file = path.join(options.fontAwesomeDir, "webfonts", decodeURIComponent(/webfonts\/([^?]+)/.exec(r.request().url())[1]));
        if (fs.existsSync(file)) return r.fulfill({ contentType: "font/woff2", body: fs.readFileSync(file) });
        return r.fulfill({ status: 404, body: "" });
      });
    }
    await page.route(/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net.*\.css|cdnjs\.cloudflare\.com(?!\/ajax\/libs\/font-awesome)/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
    if (!options.fontAwesomeDir) await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome/, (r) => r.fulfill({ contentType: "text/css", body: "" }));
    // CDN betikleri: genel → intl-tel-input taklidi; xlsx → küçük XLSX taklidi (Playwright'ta SON kayıtlı rota önce eşleşir, bu yüzden xlsx sonda).
    await page.route(/cdn\.jsdelivr\.net.*\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.intlTelInput=(e)=>({isValidNumber:()=>true,getNumber:()=>'+905301112233',getSelectedCountryData:()=>({dialCode:'90'}),setNumber:()=>{}});" }));
    await page.route(/cdn\.jsdelivr\.net.*xlsx.*\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: "window.XLSX={utils:{book_new:()=>({sheets:[]}),aoa_to_sheet:(d)=>({d}),json_to_sheet:(d)=>({d}),book_append_sheet:(wb,ws,n)=>wb.sheets.push([n,ws])},writeFile:(wb,name)=>{(window.__xlsxWrites=window.__xlsxWrites||[]).push(name)}};" }));
    await page.route("**/api/send-email", async (route) => {
      const req = route.request();
      const result = await callEmailFunction(world, {
        httpMethod: req.method(),
        headers: Object.assign({ origin: base }, req.headers()),
        body: req.postData() || "",
      });
      await route.fulfill({ status: result.statusCode, headers: result.headers, body: result.body });
    });
    return { context, page, errors, state, goto: (p) => page.goto(base + p), base };
  }

  return { base, browser, session, close: async () => { await browser.close(); server.close(); } };
}

module.exports = { createWorld, startServer, ROOT, callEmailFunction };
