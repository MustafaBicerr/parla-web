// Font Awesome yerel alt kümesi: portal kaynaklarında kullanılan her `fa-*` simgesi alt küme CSS'inde bulunmalı.
// Eksik simge görünmez olur (kutu/boşluk). Yeni simge eklendiğinde:
//   python3 assets/vendor/fontawesome/build-subset.py   (bkz. dosyanın başı)
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = fs.readFileSync(path.join(ROOT, "assets/vendor/fontawesome/fa-subset.css"), "utf8");
const defined = new Set([...css.matchAll(/\.(fa-[a-z0-9-]+)(?:::before)?\s*[{,]/g)].map((m) => m[1]));
const UTILITY = new Set(["fa-spin", "fa-fw", "fa-subset", "fa-solid-subset"]); // son ikisi dosya adı (<link href>)

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("portal kaynaklarındaki tüm fa-* simgeleri yerel alt kümede var", () => {
  const files = [...walk(path.join(ROOT, "assets/js/support-v2")), ...walk(path.join(ROOT, "support-v2"))];
  const used = new Map();
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/\b(fa-[a-z0-9-]+)\b/g)) if (!used.has(m[1])) used.set(m[1], path.relative(ROOT, f));
  }
  const missing = [...used].filter(([c]) => !defined.has(c) && !UTILITY.has(c));
  assert.deepEqual(missing, [], "alt kümede olmayan simgeler (build-subset.py çalıştırın): " + JSON.stringify(missing));
});

test("alt küme CSS'i font-display: swap kullanır ve yerel yazı tipine işaret eder", () => {
  assert.match(css, /font-display:\s*swap/);
  assert.match(css, /url\("fa-solid-subset\.woff2"\)/);
  assert.ok(fs.existsSync(path.join(ROOT, "assets/vendor/fontawesome/fa-solid-subset.woff2")));
});
