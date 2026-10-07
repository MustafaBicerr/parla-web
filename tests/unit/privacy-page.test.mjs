// Gizlilik/KVKK sayfası (support-v2/privacy.html) taslak bekçisi (WP-15, D-13 A):
// taslak uyarısı, noindex, bağlı CSS'in varlığı, harici betik olmaması ve belgelerle tutarlılık.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = fs.readFileSync(path.join(ROOT, "support-v2/privacy.html"), "utf8");

test("privacy.html: Türkçe, noindex, viewport, başlık biçimi, simge", () => {
  assert.match(html, /<html lang="tr">/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /<title>[^|<]+ \| Parla BT Destek<\/title>/);
  assert.match(html, /rel="icon"/);
  assert.match(html, /<main[ >]/);
  assert.match(html, /<h1>/);
});

test("privacy.html: 'taslak — hukuk danışmanı onayı gerekir' uyarısı görünür; onaylanana kadar kalmalı", () => {
  assert.match(html, /Taslak — hukuk danışmanı onayı gerekir/);
  assert.match(html, /sv2-legal-draft/);
});

test("privacy.html: betik yok, bağlı CSS dosyaları var, giriş sayfasına dönüş bağlantısı", () => {
  assert.doesNotMatch(html, /<script/i);
  for (const m of html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1])), m[1]);
  assert.match(html, /href="\/support-v2\/login\.html"/);
  assert.match(html, /mailto:info@parlabilgiteknolojileri\.net/);
});

test("kvkk.md ve runbook.md varlık/çapraz bağlantı", () => {
  for (const f of ["docs/kvkk.md", "docs/runbook.md", "docs/monitoring.md"]) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  const kvkk = fs.readFileSync(path.join(ROOT, "docs/kvkk.md"), "utf8");
  assert.match(kvkk, /hukuk danışmanı onayı gerekir/i);
  assert.match(kvkk, /support-v2\/privacy\.html/);
});
