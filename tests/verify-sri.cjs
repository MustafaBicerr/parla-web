#!/usr/bin/env node
/**
 * phone-utils.js içindeki intl-tel-input SRI özetlerini, npm kayıt defterindeki paketten (npm pack) yeniden hesaplayıp
 * karşılaştırır. Ağ gerekir; ağ yoksa --offline ile yalnızca biçim denetlenir.
 *   node tests/verify-sri.cjs [--offline]
 * Sürüm/özet yenileme adımları: docs/runbook.md "SRI özetlerini yenileme".
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const src = fs.readFileSync(path.join(__dirname, "..", "assets/js/support-v2/phone-utils.js"), "utf8");
const version = (/intl-tel-input@([0-9.]+)\/build\//.exec(src) || [])[1];
const css = (/ITI_CSS_SRI\s*=\s*"(sha384-[^"]+)"/.exec(src) || [])[1];
const js = (/ITI_JS_SRI\s*=\s*"(sha384-[^"]+)"/.exec(src) || [])[1];
if (!version || !css || !js) { console.error("phone-utils.js: sürüm ya da SRI sabitleri bulunamadı."); process.exit(1); }
if (!/^sha384-[A-Za-z0-9+/]{64}$/.test(css) || !/^sha384-[A-Za-z0-9+/]{64}$/.test(js)) { console.error("SRI biçimi geçersiz."); process.exit(1); }
if (process.argv.includes("--offline")) { console.log(`biçim tamam (intl-tel-input@${version})`); process.exit(0); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sri-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npm, ["pack", `intl-tel-input@${version}`, "--silent", "--pack-destination", dir], { cwd: dir, stdio: ["ignore", "pipe", "inherit"] });
const tgz = fs.readdirSync(dir).find((f) => f.endsWith(".tgz"));
execFileSync("tar", ["xzf", path.join(dir, tgz), "-C", dir]);
const hash = (f) => "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(path.join(dir, "package", f))).digest("base64");
const expected = { "build/css/intlTelInput.css": css, "build/js/intlTelInput.min.js": js };
let bad = 0;
for (const [f, want] of Object.entries(expected)) {
  const got = hash(f);
  const ok = got === want;
  if (!ok) bad += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${f}${ok ? "" : `\n  beklenen ${want}\n  hesaplanan ${got}`}`);
}
process.exit(bad ? 1 : 0);
