/** Sistem Adminleri Kılavuzu'na özgü yardımcılar (rol rozetleri, yetki matrisi hücreleri). */
const fs = require("node:fs");
const path = require("node:path");
const ROLES = {
  sa: { label: "Süper Admin", key: "super_admin" },
  da: { label: "Destek Atayıcı", key: "service_admin" },
  pm: { label: "Proje Yöneticisi", key: "project_manager" },
  dn: { label: "Danışman", key: "consultant" },
};
module.exports = (L) => {
  const rb = (c) => `<span class="rb ${c}">${ROLES[c].label}</span>`;
  /** who("sa","da") → "Kimler yapabilir" şeridi. who() = dört rol. */
  const who = (...codes) => {
    const list = codes.length ? codes : ["sa", "da", "pm", "dn"];
    return `<p class="perm"><span class="lbl">Kimler yapabilir</span>${list.map(rb).join("")}</p>`;
  };
  const mk = (k) => `<span class="mk ${k}"></span>`;
  /** row("Özellik", "yyny", "açıklama") — sırayla SA, DA, PM, DN; y=var, n=yok, p=kısmen */
  const row = (label, marks, note) =>
    `<tr><td>${label}${note ? `<small>${note}</small>` : ""}</td>${marks.split("").map((m) => `<td>${mk(m)}</td>`).join("")}</tr>`;
  const grp = (t) => `<tr class="grp"><td colspan="5">${t}</td></tr>`;
  const head = `<thead><tr><th>Özellik</th>${["sa", "da", "pm", "dn"].map((c) => `<th>${rb(c)}<small>${ROLES[c].key}</small></th>`).join("")}</tr></thead>`;
  const legend = `<div class="matrix-legend"><span>${mk("y")} Yapabilir</span><span>${mk("p")} Kısmen / koşullu (satır notuna bakın)</span><span>${mk("n")} Yapamaz</span></div>`;
  const code = (t) => `<code>${t}</code>`;
  /**
   * side("a02-admin-paneli", { caption, legend:[...], body:"<html>", lc:"83mm", bare, url })
   * Soldaki görsel (pinli) + sağdaki açıklama listesi ve ek içerik. Dikey/dar görseller için yer kazandırır.
   */
  const side = (name, o) => {
    o = o || {};
    const j = JSON.parse(fs.readFileSync(path.join(__dirname, "screens", `${name}.json`), "utf8"));
    const n = Object.keys(j.pins || {}).length;
    if (o.legend && o.legend.length !== n) L.warnings.push(`${name}: ${n} pin, ${o.legend.length} açıklama`);
    const figHtml = L.fig(name, { caption: o.caption || "", bare: o.bare !== false, nonum: o.nonum, url: o.url });
    const legend = o.legend ? `<ol class="pin-legend">${o.legend.map((x) => `<li>${x}</li>`).join("")}</ol>` : "";
    return `<div class="shot-row side"${o.lc ? ` style="--lc:${o.lc}"` : ""}>${figHtml}<div class="side-body">${legend}${o.body || ""}</div></div>`;
  };
  return { rb, side, who, mk, mrow: row, mgrp: grp, mhead: head, mlegend: legend, code, ROLES };
};
