/** Kılavuz içeriği için yardımcılar: ekran görüntüsü figürleri (pinler JSON'dan), ortak parçalar. */
const fs = require("node:fs");
const path = require("node:path");

exports.makeLib = (guideDir) => {
  const screens = path.join(guideDir, "screens");
  const J = (n) => JSON.parse(fs.readFileSync(path.join(screens, `${n}.json`), "utf8"));
  const warnings = [];

  /**
   * fig("01-giris", { url, caption, wide|half|bare|nonum, legend:[html...], cols2, navy:[n...] })
   * Pin sayısı ile legend uzunluğu eşleşmelidir (uyarı verir).
   */
  function fig(name, o) {
    o = o || {};
    if (!fs.existsSync(path.join(screens, `${name}.png`))) throw new Error(`Ekran görüntüsü yok: ${name}`);
    const j = J(name);
    const keys = Object.keys(j.pins || {}).sort((a, b) => a - b);
    if (o.legend && o.legend.length !== keys.length) warnings.push(`${name}: ${keys.length} pin, ${o.legend.length} açıklama`);
    const pins = keys
      .map((k) => `<span class="pin${o.navy && o.navy.includes(Number(k)) ? " navy" : ""}" style="left:${j.pins[k].left}%;top:${j.pins[k].top}%">${k}</span>`)
      .join("");
    const legend = o.legend ? `<ol class="pin-legend${o.cols2 ? " cols-2" : ""}">${o.legend.map((x) => `<li>${x}</li>`).join("")}</ol>` : "";
    const cls = ["shot", o.wide && "shot--wide", o.half && "shot--half", o.bare && "shot--bare", o.nonum && "shot--nonum"].filter(Boolean).join(" ");
    return `<figure class="${cls}"${o.url ? ` data-url="${o.url}"` : ""}><img src="screens/${name}.png" alt="${(o.alt || o.caption || "").replace(/"/g, "&quot;")}">${pins}<figcaption>${o.caption || ""}</figcaption>${legend}</figure>`;
  }

  const row = (...figs) => `<div class="shot-row">${figs.join("")}</div>`;
  const tip = (html, title) => `<div class="callout tip"${title ? ` data-title="${title}"` : ""}><p>${html}</p></div>`;
  const warn = (html, title) => `<div class="callout warn"${title ? ` data-title="${title}"` : ""}><p>${html}</p></div>`;
  const info = (html, title) => `<div class="callout info"${title ? ` data-title="${title}"` : ""}><p>${html}</p></div>`;
  const danger = (html, title) => `<div class="callout danger"${title ? ` data-title="${title}"` : ""}><p>${html}</p></div>`;
  const steps = (items) => `<ol class="steps">${items.map(([h, body]) => `<li><h4>${h}</h4>${body}</li>`).join("")}</ol>`;
  const faq = (items) => `<div class="faq">${items.map(([q, a]) => `<div class="qa"><p class="q">${q}</p><div class="a">${a}</div></div>`).join("")}</div>`;
  const inThis = (items, title) => `<div class="in-this-chapter"${title ? ` data-title="${title}"` : ""}><ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul></div>`;
  const req = '<span class="req">Zorunlu</span>';
  const opt = '<span class="opt">İsteğe bağlı</span>';
  const btn = (t, v) => `<span class="ui-btn ${v || "primary"}">${t}</span>`;
  const field = (t) => `<span class="ui-field">${t}</span>`;
  const menu = (t) => `<span class="ui-menu">${t}</span>`;
  const badge = (cls, t) => `<span class="badge ${cls}">${t}</span>`;
  const prio = (cls, t) => `<span class="prio ${cls}">${t}</span>`;
  const ST = {
    open: badge("open", "Açık"), assigned: badge("assigned", "Atandı"), in_progress: badge("in_progress", "İşlemde"),
    waiting_customer: badge("waiting_customer", "Müşteri Bekleniyor"), pending_close: badge("pending_close", "Kapanış Onayı Bekliyor"),
    resolved: badge("resolved", "Çözüldü"), closed: badge("closed", "Kapandı"), reopened: badge("reopened", "Tekrar Açıldı"),
  };
  const PR = { low: prio("low", "Düşük"), medium: prio("medium", "Orta"), high: prio("high", "Yüksek"), critical: prio("critical", "Kritik") };
  return { fig, row, tip, warn, info, danger, steps, faq, inThis, req, opt, btn, field, menu, badge, prio, ST, PR, warnings };
};

exports.assemble = (parts, lib) => {
  const html = parts.map((p) => p(lib)).join("\n\n");
  if (lib.warnings.length) console.warn("UYARI:\n  " + lib.warnings.join("\n  "));
  return html;
};
