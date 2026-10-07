#!/usr/bin/env node
/**
 * Tüm e2e dosyalarını sırayla çalıştırır; biri başarısız olsa da kalanlar çalışır, sonunda özet basar.
 *   node tests/e2e/run-all.cjs                 # hepsi
 *   node tests/e2e/run-all.cjs --skip xss,button-crawler   # yavaş olanlar hariç
 *   node tests/e2e/run-all.cjs --only xss      # yalnız xss
 * Çıkış kodu: herhangi biri başarısızsa 1.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? String(process.argv[i + 1] || "").split(",").filter(Boolean) : [];
};
const skip = arg("--skip");
const only = arg("--only");
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".e2e.cjs")).sort()
  .filter((f) => { const n = f.replace(/\.e2e\.cjs$/, ""); return (!only.length || only.includes(n)) && !skip.includes(n); });

const summary = [];
for (const f of files) {
  const t0 = Date.now();
  console.log(`\n=== ${f} ===`);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit", timeout: 20 * 60 * 1000 });
  summary.push({ f, code: r.status === null ? "zaman aşımı" : r.status, sec: Math.round((Date.now() - t0) / 1000) });
}
console.log("\n=== ÖZET ===");
summary.forEach((s) => console.log(`${s.code === 0 ? "OK  " : "FAIL"} ${s.f} (çıkış ${s.code}, ${s.sec} sn)`));
process.exit(summary.every((s) => s.code === 0) ? 0 : 1);
