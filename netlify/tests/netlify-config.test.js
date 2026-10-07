/**
 * netlify.toml / 404.html / .env.example denetimleri (WP-01 hızlı kalkan + ALT-07 başlıklar + ALT-21):
 *  - yayın dışı yollar force-404; site/portal/PDF/api yolları açık;
 *  - git'te izlenen HER kök girdi ya yayın listesinde ya da 404 kuralıyla kapalı olmalı (kapalı liste bekçisi);
 *  - güvenlik başlıkları, CSP Report-Only yalnızca portal HTML'lerinde (PDF'lerde değil), noindex, Node 22.
 * Çalıştırma: node --test netlify/tests/netlify-config.test.js
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const tomlText = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");

/** Bu dosyanın biçimine yetecek küçük TOML ayrıştırıcı: [table], [[array.of.tables]], key = "str" | 'str' | 123 | true. */
function parseToml(text) {
  const out = { redirects: [], headers: [] };
  let cur = out;
  let headerEntry = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let m = /^\[\[(\w+)\]\]$/.exec(line);
    if (m) {
      const entry = m[1] === "headers" ? { values: {} } : {};
      out[m[1]].push(entry);
      cur = entry;
      headerEntry = m[1] === "headers" ? entry : null;
      continue;
    }
    m = /^\[([\w."-]+)\]$/.exec(line);
    if (m) {
      const parts = m[1].replace(/"/g, "").split(".");
      if (parts[0] === "headers" && parts[1] === "values" && headerEntry) {
        cur = headerEntry.values;
      } else {
        cur = out;
        parts.forEach((p) => {
          cur[p] = cur[p] || {};
          cur = cur[p];
        });
        headerEntry = null;
      }
      continue;
    }
    m = /^([\w-]+)\s*=\s*(.+)$/.exec(line);
    if (m) {
      let v = m[2].trim();
      if (/^".*"$/.test(v)) v = v.slice(1, -1);
      else if (/^'.*'$/.test(v)) v = v.slice(1, -1);
      else if (v === "true" || v === "false") v = v === "true";
      else if (/^\d+$/.test(v)) v = Number(v);
      cur[m[1]] = v;
    }
  }
  return out;
}

const cfg = parseToml(tomlText);

/** Netlify yönlendirme eşleşmesi (yalnızca sondaki splat): ilk eşleşen kural. */
function matchRedirect(urlPath) {
  return cfg.redirects.find((r) => (r.from.endsWith("/*") ? urlPath === r.from.slice(0, -2) || urlPath.startsWith(r.from.slice(0, -1)) : urlPath === r.from));
}
function matchHeaders(urlPath) {
  return cfg.headers.filter((h) => (h.for.endsWith("/*") ? urlPath.startsWith(h.for.slice(0, -1)) || urlPath === h.for.slice(0, -2) : urlPath === h.for));
}
function headerValue(urlPath, name) {
  return matchHeaders(urlPath).map((h) => h.values[name]).filter(Boolean);
}

const is404 = (p) => {
  const r = matchRedirect(p);
  return Boolean(r && r.status === 404 && r.force === true && r.to === "/404.html");
};

test("yayın dışı yollar force=true ile 404.html'e yönlenir (ALT-02 EK-1 seti)", () => {
  const blocked = [
    "/docs", "/docs/ticket-system-analysis.md", "/docs/manuals/content/admin/index.html", "/tests/e2e/seed.cjs", "/tests/rules/generate-rules.js",
    "/netlify/functions/send-email.js", "/netlify/lib/email-templates.js", "/netlify/tests/send-email.test.js", "/.github/workflows/ci.yml",
    "/.cursor/settings.json", "/temp.json", "/yedek_kod.gs", "/project-hierarchy.txt", "/database.rules.json", "/firebase.json", "/.firebaserc",
    "/.env.example", "/netlify.toml", "/CLAUDE.md", "/README.md", "/package.json", "/package-lock.json", "/.gitignore", "/.DS_Store",
    "/assets/.DS_Store", "/assets/img/.DS_Store", "/pages/.DS_Store", "/support-v2/.DS_Store", "/.git/config", "/.env",
  ];
  const missing = blocked.filter((p) => !is404(p));
  assert.deepEqual(missing, [], `404 ile kapatılmamış yollar: ${missing.join(", ")}`);
});

test("site, portal, PDF kılavuzlar, API ve yönlendirmeler AÇIK kalır", () => {
  const open = [
    "/", "/index.html", "/pages/blog.html", "/components/header.html", "/assets/js/support-v2/email-service.js", "/assets/css/support-v2.css",
    "/robots.txt", "/sitemap.xml", "/404.html", "/support-v2/login.html", "/support-v2/auth-action.html", "/support-v2/admin/dashboard.html",
    "/support-v2/customer/dashboard.html", "/support-v2/docs/Kullanici-Kilavuzu.pdf", "/support-v2/docs/Sistem-Adminleri-Kullanim-Kilavuzu.pdf",
    "/.netlify/functions/send-email",
  ];
  const wrongly = open.filter((p) => is404(p));
  assert.deepEqual(wrongly, [], `yanlışlıkla kapatılan: ${wrongly.join(", ")}`);
  assert.equal(matchRedirect("/api/send-email").to, "/.netlify/functions/send-email");
  assert.equal(matchRedirect("/api/send-email").status, 200);
  assert.equal(matchRedirect("/api/csp-report").to, "/.netlify/functions/csp-report");
  assert.equal(matchRedirect("/support").to, "/support-v2/login.html");
  assert.equal(matchRedirect("/support/anything").status, 301);
  assert.equal(matchRedirect("/support-v2").status, 302);
});

test("kapalı liste bekçisi: git'te izlenen her kök girdi yayın listesinde ya da 404 kuralıyla kapalı olmalı", (t) => {
  let files;
  try {
    files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    t.skip("git yok");
    return;
  }
  const published = new Set(["index.html", "404.html", "components", "pages", "assets", "support-v2", "robots.txt", "sitemap.xml", "LICENSE", "favicon.ico"]);
  const roots = [...new Set(files.map((f) => f.split("/")[0]))];
  const exposed = roots.filter((r) => {
    if (published.has(r)) return false;
    const isDir = files.some((f) => f.startsWith(`${r}/`));
    return !is404(isDir ? `/${r}/x` : `/${r}`);
  });
  assert.deepEqual(
    exposed,
    [],
    `Kök dizine yeni dosya/klasör eklenmiş ve yayına açık kalıyor: ${exposed.join(", ")} — netlify.toml'a force-404 kuralı ekleyin (ya da yayın listesine alın).`
  );
});

test("güvenlik başlıkları: tüm site + CSP Report-Only yalnızca portal HTML'lerinde + noindex + Node 22", () => {
  ["/index.html", "/support-v2/login.html", "/support-v2/docs/Kullanici-Kilavuzu.pdf"].forEach((p) => {
    assert.ok(headerValue(p, "X-Content-Type-Options").includes("nosniff"), p);
    assert.ok(headerValue(p, "Referrer-Policy").length, p);
    assert.match(headerValue(p, "Permissions-Policy")[0], /camera=\(\)/, p);
    assert.ok(headerValue(p, "X-Frame-Options").includes("SAMEORIGIN"), p);
  });
  const portal = ["/support-v2/login.html", "/support-v2/auth-action.html", "/support-v2/change-password.html", "/support-v2/admin/tickets.html", "/support-v2/customer/dashboard.html"];
  portal.forEach((p) => {
    const csp = headerValue(p, "Content-Security-Policy-Report-Only");
    assert.equal(csp.length, 1, `${p}: CSP Report-Only`);
    assert.match(csp[0], /default-src 'self'/);
    assert.match(csp[0], /frame-ancestors 'none'/);
    assert.match(csp[0], /report-uri \/api\/csp-report/);
    assert.equal(headerValue(p, "Content-Security-Policy").length, 0, "henüz zorunlu CSP yok (önce Report-Only)");
    assert.ok(headerValue(p, "X-Robots-Tag").some((v) => /noindex/.test(v)), `${p}: noindex`);
  });
  ["/index.html", "/pages/blog.html", "/support-v2/docs/Kullanici-Kilavuzu.pdf"].forEach((p) => {
    assert.equal(headerValue(p, "Content-Security-Policy-Report-Only").length, 0, `${p}: CSP burada olmamalı`);
  });
  assert.ok(headerValue("/support-v2/docs/Kullanici-Kilavuzu.pdf", "X-Robots-Tag").some((v) => /noindex/.test(v)), "PDF noindex");
  assert.equal(headerValue("/index.html", "X-Robots-Tag").length, 0, "ana site indekslenebilir kalır");
  assert.equal(cfg.build.environment.NODE_VERSION, "22");
});

test("mevcut önbellek başlıkları korunur", () => {
  ["/assets/js/support-v2/pages/login.js", "/assets/css/support-v2.css", "/assets/js/firebase-init.js", "/assets/js/site-config.js", "/support-v2/docs/Kullanici-Kilavuzu.pdf"].forEach((p) => {
    assert.ok(headerValue(p, "Cache-Control").includes("no-cache, must-revalidate"), p);
  });
});

test("uzun önbellek (WP-15): vendor ve görseller modest max-age; özet adı yokken immutable yok; no-cache yollarıyla çakışmaz", () => {
  const long = [
    ["/assets/vendor/fontawesome/fa-subset.css", /max-age=86400/],
    ["/assets/vendor/fontawesome/fa-solid-subset.woff2", /max-age=86400/],
    ["/assets/img/parla-logo/parla-logo-320.png", /max-age=604800/],
    ["/assets/img/favicon/favicon.svg", /max-age=604800/],
    ["/favicon.ico", /max-age=604800/],
  ];
  long.forEach(([p, re]) => {
    const vals = headerValue(p, "Cache-Control");
    assert.equal(vals.length, 1, `${p}: tek Cache-Control kuralı olmalı (çakışma yok): ${JSON.stringify(vals)}`);
    assert.match(vals[0], re, p);
    assert.doesNotMatch(vals[0], /immutable/, `${p}: özetsiz dosya adında immutable kullanılmaz`);
    assert.match(vals[0], /^public/, p);
  });
  // Uygulama kodu ve PDF'ler hâlâ no-cache (çakışma yok)
  ["/assets/js/support-v2/pages/login.js", "/assets/css/support-v2.css", "/support-v2/docs/Kullanici-Kilavuzu.pdf"].forEach((p) => {
    assert.deepEqual(headerValue(p, "Cache-Control"), ["no-cache, must-revalidate"], p);
  });
});

test("yapılandırma: functions dizini, esbuild, send-email bağımlılığı (Blobs) ve .env.example değişken adları", () => {
  assert.equal(cfg.build.publish, ".");
  assert.equal(cfg.build.functions, "netlify/functions");
  assert.equal(cfg.functions.node_bundler, "esbuild");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "netlify/functions/package.json"), "utf8"));
  assert.ok(pkg.dependencies["@netlify/blobs"]);
  const env = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  ["RESEND_API_KEY", "SITE_URL", "CONTACT_EMAIL", "ALLOWED_ORIGINS", "DAILY_EMAIL_SOFT_LIMIT", "DAILY_EMAIL_HARD_LIMIT", "RATE_CUSTOMER_PER_MIN", "FIREBASE_SERVICE_ACCOUNT", "PRIVACY_URL"].forEach((name) => {
    assert.match(env, new RegExp(`^#?\\s*${name}=`, "m"), `.env.example: ${name}`);
  });
  assert.doesNotMatch(env, /^RESEND_API_KEY=\S+/m, "gerçek anahtar yazılmamalı");
});

test("404.html: noindex, Türkçe, ana sayfa + portal bağlantıları", () => {
  const html = fs.readFileSync(path.join(ROOT, "404.html"), "utf8");
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<html lang="tr">/);
  assert.match(html, /href="\/index\.html"/);
  assert.match(html, /href="\/support-v2\/login\.html"/);
  assert.match(html, /name="viewport"/);
});
