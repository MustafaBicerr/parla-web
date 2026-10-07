// Sözleşme testi (WP-15, ALT-27): e2e harness'ın Firebase taklidi (tests/e2e/harness.cjs BROWSER_STUB) gerçek
// assets/js/firebase-init.js'in `window.__PARLA_FIREBASE` yüzeyiyle uyumlu kalmalı. Gerçek firebase-init.js e2e'de çalışmaz
// (taklit edilir); yüzey kayması burada yakalanır. Ayrıca istemci kodunun kullandığı db/authFn adları gerçek yüzeyde var olmalı.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const real = fs.readFileSync(path.join(ROOT, "assets/js/firebase-init.js"), "utf8");
const harness = fs.readFileSync(path.join(ROOT, "tests/e2e/harness.cjs"), "utf8");
const stub = harness.slice(harness.indexOf("const BROWSER_STUB"), harness.indexOf("async function startServer"));

function block(text, key, from = 0) {
  const start = text.indexOf(`${key}: {`, from);
  assert.ok(start >= 0, `${key} bloğu bulunamadı`);
  let depth = 0;
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(text.indexOf("{", start) + 1, i);
  }
  throw new Error(`${key} bloğu kapanmıyor`);
}

const realApi = text => text.slice(text.indexOf("const firebaseApi"));
const realKeys = (key) => block(realApi(real), key).split(",").map((s) => s.trim()).filter(Boolean);
// Taklitte anahtarlar `ad:` biçimindedir; iç içe nesneler (ör. EmailAuthProvider) tek düzeyde ele alınır.
const stubKeys = (key) => {
  const body = block(stub, key);
  const names = new Set();
  let depth = 0;
  for (const m of body.matchAll(/[{}]|(?:^|[\s,])([A-Za-z_]\w*):\s*(?=[^\s])/g)) {
    if (m[0] === "{") depth++;
    else if (m[0] === "}") depth--;
    else if (depth === 0) names.add(m[1]);
  }
  return names;
};

// Taklitte bilinçli olarak olmayanlar: ilgili akışlar e2e'de uçtan uca denenmez (kayıt/eylem bağlantıları).
const KNOWN_MISSING = { db: [], authFn: ["createUserWithEmailAndPassword", "checkActionCode", "applyActionCode"] };

for (const key of ["db", "authFn"]) {
  test(`harness taklidi: ${key} anahtarları gerçek firebase-init.js'de var`, () => {
    const realSet = new Set(realKeys(key));
    const extra = [...stubKeys(key)].filter((k) => !realSet.has(k));
    assert.deepEqual(extra, [], `Taklitte olup gerçek API'de olmayan ${key} adları (yazım hatası ya da kaldırılmış API): ${extra.join(", ")}`);
  });
  test(`harness taklidi: gerçek ${key} adlarının hepsi taklitte var ya da bilinçli eksik listesinde`, () => {
    const stubSet = stubKeys(key);
    const missing = realKeys(key).filter((k) => !stubSet.has(k) && !KNOWN_MISSING[key].includes(k));
    assert.deepEqual(missing, [], `Gerçek API'de olup taklitte olmayan ${key} adları — harness'a ekleyin ya da KNOWN_MISSING'e gerekçeyle yazın: ${missing.join(", ")}`);
  });
}

test("istemci kodu yalnızca gerçek firebase-init.js yüzeyindeki db/authFn adlarını kullanır", () => {
  const realDb = new Set(realKeys("db"));
  const realAuth = new Set(realKeys("authFn"));
  const bad = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) {
        const text = fs.readFileSync(p, "utf8");
        for (const m of text.matchAll(/\b(?:fb|firebase|__PARLA_FIREBASE)\.(db|authFn)\.(\w+)/g)) {
          const set = m[1] === "db" ? realDb : realAuth;
          if (!set.has(m[2])) bad.push(`${path.relative(ROOT, p)}: ${m[1]}.${m[2]}`);
        }
      }
    }
  };
  walk(path.join(ROOT, "assets/js/support-v2"));
  assert.deepEqual(bad, [], `Gerçek API'de olmayan çağrılar: ${bad.join("; ")}`);
});
