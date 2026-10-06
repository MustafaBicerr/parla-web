#!/usr/bin/env node
/* ============================================================================
   Parla BT kılavuz derleyicisi
   ----------------------------------------------------------------------------
   Kullanım:
     node docs/manuals/build.cjs <kılavuz-adı> [--html-only]

   Girdi  : docs/manuals/content/<ad>/index.html   (bölümler; gövde parçası)
            docs/manuals/content/<ad>/meta.json    (başlık, sürüm, tarih, output ...)
            docs/manuals/content/<ad>/style.css    (isteğe bağlı, kılavuza özel CSS)
   Çıktı  : meta.json -> "output" yolundaki PDF (docs/manuals'a göre göreli)
            docs/manuals/.build/<ad>.html          (derlenmiş tek dosya HTML, hata ayıklama)

   Akış:
     1. theme.css + yazı tipleri (base64) + logo + kapak + içerik tek HTML'de birleşir.
     2. Chromium'da "enhance" adımı çalışır: bölüm açılışları, numaralar, içindekiler,
        ekran görüntüsü çerçeveleri, simgeler. DOM statik HTML'e serileştirilir.
     3. İçindekiler sayfa numaraları iki (veya daha çok) geçişte bulunur:
        geçiş 1: PDF üret -> PDF anahtar işaretlerinden (outline) her başlığın sayfasını oku
        geçiş 2: numaraları içindekilere yaz -> PDF'i yeniden üret -> numaralar değişmediyse bitir
     4. pdf-lib ile belge bilgisi (title/author/subject/keywords) yazılır.
     5. pdfjs ile doğrulama: Türkçe karakterler, yer imleri, sayfa sayısı.
   ============================================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = __dirname;
const NODE_MODULES = path.join(ROOT, 'node_modules');

/* ------------------------------ yardımcılar ------------------------------ */

function die(msg) {
  console.error('HATA: ' + msg);
  process.exit(1);
}
const log = (...a) => console.log('[build]', ...a);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** "Başlık\n*Vurgu* satırı" -> güvenli HTML (<br>, <em>) */
function richLine(s) {
  return esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\r?\n/g, '<br>');
}

function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml',
  })[ext] || 'application/octet-stream';
}

function dataUri(file) {
  return 'data:' + mime(file) + ';base64,' + fs.readFileSync(file).toString('base64');
}

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    '/opt/node-tools/node_modules/playwright',
    'playwright-core',
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* sıradaki */ }
  }
  die('Playwright bulunamadı. PLAYWRIGHT_PATH ortam değişkenini ayarlayın veya "npm i playwright" kurun.');
}

function chromiumPath() {
  const cands = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ].filter(Boolean);
  return cands.find((p) => fs.existsSync(p));
}

/* ------------------------------ yazı tipleri ----------------------------- */

/**
 * @fontsource paketlerinden yalnızca latin + latin-ext alt kümelerini (Türkçe için
 * latin-ext şart: ğ ş İ) okuyup woff2 dosyalarını base64 olarak @font-face içine gömer.
 */
function fontFaces() {
  const specs = [
    { pkg: 'inter', weights: [400, 500, 600, 700], styles: ['normal'] },
    { pkg: 'inter', weights: [400], styles: ['italic'] },
    { pkg: 'plus-jakarta-sans', weights: [600, 700, 800], styles: ['normal'] },
    { pkg: 'jetbrains-mono', weights: [400, 500], styles: ['normal'] },
  ];
  let css = '';
  for (const s of specs) {
    const dir = path.join(NODE_MODULES, '@fontsource', s.pkg);
    if (!fs.existsSync(dir)) die(`@fontsource/${s.pkg} yok. "npm install" çalıştırın (docs/manuals içinde).`);
    for (const w of s.weights) {
      for (const st of s.styles) {
        const file = path.join(dir, `${w}${st === 'italic' ? '-italic' : ''}.css`);
        const src = fs.readFileSync(file, 'utf8');
        const re = /\/\*\s*[\w-]+?-(latin|latin-ext)-\d+-(?:normal|italic)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
        let m;
        while ((m = re.exec(src))) {
          let block = m[2];
          const url = /url\(([^)]+?\.woff2)\)/.exec(block);
          if (!url) continue;
          const font = path.join(dir, url[1].replace(/^\.\//, ''));
          const b64 = fs.readFileSync(font).toString('base64');
          block = block
            .replace(/src:[^;]+;/, `src: url(data:font/woff2;base64,${b64}) format('woff2');`)
            .replace(/font-display:[^;]+;/, 'font-display: block;');
          css += `@font-face {${block}}\n`;
        }
      }
    }
  }
  return css;
}

/* -------------------------------- simgeler ------------------------------- */

function lucideIcon(name) {
  const file = path.join(NODE_MODULES, 'lucide-static', 'icons', name + '.svg');
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/, '');
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
  return `<svg class="ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/* ------------------------- kapak / arka kapak (HTML) --------------------- */

const COVER_ART = `
<svg class="cover-art" viewBox="0 0 210 297" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <pattern id="cv-dots" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="1.2" cy="1.2" r="0.45" fill="#fff" fill-opacity="0.26"/>
    </pattern>
    <linearGradient id="cv-or" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F37021"/><stop offset="1" stop-color="#D45F16"/>
    </linearGradient>
    <linearGradient id="cv-slab" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#162B50"/><stop offset="1" stop-color="#0F2040"/>
    </linearGradient>
  </defs>
  <rect x="96" y="0" width="114" height="104" fill="url(#cv-dots)"/>
  <polygon points="112,0 210,0 210,112" fill="url(#cv-or)"/>
  <polygon points="176,0 210,0 210,38" fill="#0A1628" fill-opacity="0.2"/>
  <polygon points="0,222 210,190 210,297 0,297" fill="url(#cv-slab)"/>
  <polygon points="0,222 210,190 210,194 0,226" fill="#F37021"/>
</svg>`;

function coverHtml(meta) {
  const items = meta.coverMeta || [
    { k: 'Sürüm', v: meta.version },
    { k: 'Tarih', v: meta.date },
    meta.audience ? { k: 'Hedef kitle', v: meta.audience } : null,
    { k: 'Hazırlayan', v: meta.author || 'Parla Bilgi Teknolojileri' },
  ].filter((x) => x && x.v);
  return `
<section class="cover" id="kapak">
  ${COVER_ART}
  <div class="cover-top">
    <div class="cover-logo"><i></i></div>
    ${meta.product ? `<div class="cover-tag">${esc(meta.product)}</div>` : ''}
  </div>
  <div class="cover-body">
    ${meta.eyebrow ? `<div class="cover-kicker">${esc(meta.eyebrow)}</div>` : ''}
    <div class="cover-title">${richLine(meta.title)}</div>
    ${meta.subtitle ? `<div class="cover-sub">${richLine(meta.subtitle)}</div>` : ''}
  </div>
  <div class="cover-meta">
    ${items.map((it) => `<div><div class="k">${esc(it.k)}</div><div class="v">${esc(it.v)}</div></div>`).join('\n    ')}
  </div>
</section>`;
}

function backCoverHtml(meta) {
  const b = meta.backCover === true ? {} : meta.backCover;
  const lines = b.lines || [];
  return `
<section class="cover cover--back" id="arka-kapak">
  ${COVER_ART}
  <div class="cover-top"><div class="cover-logo"><i></i></div></div>
  <div class="cover-body">
    <div class="cover-kicker">${esc(b.kicker || 'Destek')}</div>
    <div class="cover-title">${richLine(b.title || 'Yardıma mı ihtiyacınız var?')}</div>
    ${lines.length ? `<div class="cover-sub">${lines.map(richLine).join('<br>')}</div>` : ''}
  </div>
  <div class="cover-meta">
    <div><div class="k">Kurum</div><div class="v">Parla Bilgi Teknolojileri</div></div>
    ${meta.version ? `<div><div class="k">Sürüm</div><div class="v">${esc(meta.version)}</div></div>` : ''}
  </div>
</section>`;
}

/* ----------------------------- HTML birleştirme -------------------------- */

/** İçerikteki göreli img src / url() değerlerini data URI'ye çevirir (tek dosya HTML). */
function inlineLocalAssets(html, baseDir) {
  const missing = [];
  const fix = (u) => {
    if (/^(data:|https?:|file:|#|about:)/i.test(u)) return null;
    const file = path.resolve(baseDir, u.split('?')[0]);
    if (!fs.existsSync(file)) { missing.push(u); return null; }
    return dataUri(file);
  };
  html = html.replace(/(<(?:img|source)\b[^>]*?\ssrc=)(["'])([^"']+)\2/gi, (all, pre, q, u) => {
    const d = fix(u);
    return d ? `${pre}${q}${d}${q}` : all;
  });
  html = html.replace(/url\((["']?)([^)"']+)\1\)/gi, (all, q, u) => {
    const d = fix(u);
    return d ? `url("${d}")` : all;
  });
  return { html, missing };
}

function compose(name, meta) {
  const dir = path.join(ROOT, 'content', name);
  const indexFile = path.join(dir, 'index.html');
  if (!fs.existsSync(indexFile)) die(`İçerik bulunamadı: ${path.relative(process.cwd(), indexFile)}`);

  let body = fs.readFileSync(indexFile, 'utf8');
  const inl = inlineLocalAssets(body, dir);
  body = inl.html;
  if (inl.missing.length) console.warn('UYARI: bulunamayan görsel/dosya:', [...new Set(inl.missing)].join(', '));

  const themeCss = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8');
  const customFile = path.join(dir, 'style.css');
  const customCss = fs.existsSync(customFile) ? inlineLocalAssets(fs.readFileSync(customFile, 'utf8'), dir).html : '';

  const logoFile = path.join(ROOT, 'assets', 'logo-bt.png');
  const rootVars = `:root{
  --manual-name:${JSON.stringify(meta.header || meta.title.replace(/\r?\n/g, ' ').replace(/\*/g, ''))};
  --footer-text:${JSON.stringify(meta.footer || 'Parla Bilgi Teknolojileri · Destek Portalı')};
  --logo-url:url("${dataUri(logoFile)}");
}`;

  const hasClass = (html, cls) => new RegExp(`class=["'](?:[^"']*\\s)?${cls}(?:\\s[^"']*)?["']`).test(html);
  const hasOwnCover = hasClass(body, 'cover');
  const hasOwnToc = hasClass(body, 'toc') || hasClass(body, 'toc-page');
  const tocMeta = meta.toc === false ? null : (meta.toc || {});
  const parts = [];
  if (meta.cover !== false && !hasOwnCover) parts.push(coverHtml(meta));
  if (tocMeta && !hasOwnToc) {
    parts.push(`
<section class="toc-page" id="icindekiler">
  <h1 class="toc-heading">${esc(tocMeta.title || 'İçindekiler')}</h1>
  ${tocMeta.subtitle ? `<p class="toc-sub">${esc(tocMeta.subtitle)}</p>` : '<div style="height:8mm"></div>'}
  <nav class="toc" data-depth="${tocMeta.depth || 2}"></nav>
</section>`);
  }
  parts.push(body);
  if (meta.backCover) parts.push(backCoverHtml(meta));

  // data-ico kullanılan simgeleri topla
  const icons = {};
  const missingIcons = [];
  for (const m of (parts.join('\n')).matchAll(/data-ico="([\w-]+)"/g)) {
    if (icons[m[1]] || missingIcons.includes(m[1])) continue;
    const svg = lucideIcon(m[1]);
    if (svg) icons[m[1]] = svg; else missingIcons.push(m[1]);
  }
  if (missingIcons.length) console.warn('UYARI: bilinmeyen simge adları (lucide):', missingIcons.join(', '));

  const lang = meta.lang || 'tr';
  const html = `<!doctype html>
<html lang="${esc(lang)}"${meta.numbering === false ? ' class="no-numbering"' : ''}>
<head>
<meta charset="utf-8">
<title>${esc(meta.pdfTitle || meta.title.replace(/\r?\n/g, ' ').replace(/\*/g, ''))}</title>
<meta name="author" content="${esc(meta.author || 'Parla Bilgi Teknolojileri')}">
<style id="fonts">
${fontFaces()}
</style>
<style id="theme">
${themeCss}
</style>
<style id="vars">
${rootVars}
</style>
${customCss ? `<style id="custom">\n${customCss}\n</style>` : ''}
</head>
<body>
${parts.join('\n')}
</body>
</html>`;
  return { html, icons, meta: { tocMeta } };
}

/* ------------------------- tarayıcıda çalışan "enhance" ------------------ */
/* Bu fonksiyon page.evaluate ile sayfada çalışır; dış değişkenlere ERİŞEMEZ. */

function enhance(opts) {
  const doc = document;
  const trMap = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
  const slug = (s) => String(s).toLocaleLowerCase('tr').replace(/[çğıöşüâîû]/g, (c) => trMap[c])
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'baslik';
  const used = new Set([...doc.querySelectorAll('[id]')].map((e) => e.id));
  const uid = (base) => {
    let id = base, i = 2;
    while (used.has(id)) id = base + '-' + i++;
    used.add(id);
    return id;
  };
  const el = (tag, cls, html) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const text = (e) => e.textContent.replace(/\s+/g, ' ').trim();

  /* 0. h4-h6 başlıkları yer imine (PDF outline) girmesin: görünümü aynı kalan div.h4 olur */
  doc.querySelectorAll('h4,h5,h6').forEach((h) => {
    const d = el('div', ('h4 ' + h.className).trim(), h.innerHTML);
    if (h.id) d.id = h.id;
    h.replaceWith(d);
  });

  /* 1. simgeler */
  doc.querySelectorAll('[data-ico]').forEach((e) => {
    const svg = opts.icons[e.dataset.ico];
    if (svg) e.innerHTML = svg;
  });

  /* 2. details baskıda açık */
  doc.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));

  /* 3. ekran görüntüsü çerçevesi */
  doc.querySelectorAll('figure.shot').forEach((fig) => {
    if (fig.querySelector('.shot-window')) return;
    const img = fig.querySelector(':scope > img');
    const pins = [...fig.querySelectorAll(':scope > .pin')];
    const legend = fig.querySelector(':scope > ol.pin-legend');
    const cap = fig.querySelector(':scope > figcaption');
    const win = el('div', 'shot-window');
    if (!fig.classList.contains('shot--bare')) {
      const bar = el('div', 'shot-bar', '<i></i><i></i><i></i>');
      const url = fig.getAttribute('data-url');
      if (url) bar.appendChild(el('span', 'shot-url')).textContent = url;
      win.appendChild(bar);
    }
    const screen = el('div', 'shot-screen');
    if (img) screen.appendChild(img);
    pins.forEach((p) => screen.appendChild(p));
    win.appendChild(screen);
    fig.insertBefore(win, fig.firstChild);
    if (cap) fig.appendChild(cap);
    if (legend) fig.appendChild(legend);
    if (img && !img.getAttribute('alt')) img.setAttribute('alt', cap ? text(cap) : '');
  });

  /* 4. bölümler: numara, açılış sayfası, başlık kimlikleri */
  const chapters = [...doc.querySelectorAll('section.chapter')];
  const tocEntries = [];            // { id, level, text, num, chapter }
  const depth = opts.depth;
  chapters.forEach((sec, ci) => {
    const n = ci + 1;
    const nn = String(n).padStart(2, '0');
    let h1 = sec.querySelector(':scope > h1');
    const title = (h1 && text(h1)) || sec.getAttribute('data-title') || ('Bölüm ' + n);
    if (!h1) {
      h1 = el('h1');
      h1.textContent = title;
      sec.insertBefore(h1, sec.firstChild);
    }
    h1.id = h1.id || uid(slug(title));
    sec.id = sec.id || uid('bolum-' + slug(title));

    // h2 numaraları ve kimlikleri
    const subs = [];
    let k = 0;
    sec.querySelectorAll('h2').forEach((h2) => {
      if (!h2.classList.contains('no-num')) h2.setAttribute('data-num', n + '.' + (++k));
      h2.id = h2.id || uid(slug(text(h2)));
      if (!h2.classList.contains('no-toc')) subs.push(h2);
    });
    const h3s = [];
    if (depth >= 3) {
      sec.querySelectorAll('h3').forEach((h3) => {
        if (h3.classList.contains('no-toc')) return;
        h3.id = h3.id || uid(slug(text(h3)));
        h3s.push(h3);
      });
    } else {
      sec.querySelectorAll('h3').forEach((h3) => { h3.id = h3.id || uid(slug(text(h3))); });
    }

    tocEntries.push({ id: h1.id, level: 1, text: title, num: nn });
    if (depth >= 2) {
      const all = [...sec.querySelectorAll('h2,h3')].filter((h) => (h.tagName === 'H2' ? subs.includes(h) : h3s.includes(h)));
      all.forEach((h) => tocEntries.push({
        id: h.id, level: h.tagName === 'H2' ? 2 : 3, text: text(h), num: h.getAttribute('data-num') || '',
      }));
    }

    // açılış sayfası
    if (sec.getAttribute('data-opener') === 'false') { h1.setAttribute('data-num', nn); return; }
    let intro = sec.getAttribute('data-intro') || '';
    const lead = sec.querySelector(':scope > p.lead');
    if (!intro && lead) { intro = lead.innerHTML; lead.remove(); }
    const opener = el('div', 'chapter-opener');
    opener.innerHTML = opts.openerArt;
    const top = el('div', 'co-top', '<div class="co-logo"></div><div class="co-label"></div>');
    top.querySelector('.co-label').textContent = opts.chapterLabel + ' ' + nn;
    opener.appendChild(top);
    const main = el('div', 'co-main');
    main.appendChild(el('div', 'co-num', nn));
    main.appendChild(h1);   // h1 açılış sayfasına taşınır (PDF yer imi/TOC bu sayfayı gösterir)
    main.appendChild(el('div', 'co-rule'));
    if (intro) {
      const p = el('p', 'co-intro');
      if (sec.getAttribute('data-intro')) p.textContent = intro; else p.innerHTML = intro;
      main.appendChild(p);
    }
    opener.appendChild(main);
    if (sec.getAttribute('data-opener-toc') !== 'false' && subs.length) {
      const box = el('div', 'co-toc', '<div class="co-toc-title"></div><ol></ol>');
      box.querySelector('.co-toc-title').textContent = opts.inChapter;
      const ol = box.querySelector('ol');
      subs.slice(0, 10).forEach((h2) => {
        const li = el('li', null, '<span class="n"></span><span class="t"></span>');
        li.querySelector('.n').textContent = h2.getAttribute('data-num') || '';
        li.querySelector('.t').textContent = text(h2);
        ol.appendChild(li);
      });
      opener.appendChild(box);
    }
    opener.appendChild(el('div', 'co-foot', ''));
    sec.insertBefore(opener, sec.firstChild);
  });

  /* 5. içindekiler */
  doc.querySelectorAll('nav.toc').forEach((nav) => {
    const d = parseInt(nav.getAttribute('data-depth') || '2', 10);
    const ol = el('ol');
    tocEntries.filter((t) => t.level <= d).forEach((t) => {
      const li = el('li', 'l' + t.level);
      const a = el('a');
      a.setAttribute('href', '#' + t.id);
      const nspan = el('span', 'n'); nspan.textContent = t.level === 1 ? t.num : '';
      const tspan = el('span', 't'); tspan.textContent = t.text; if (t.num) tspan.setAttribute('data-num', t.num);
      const dots = el('span', 'dots');
      const p = el('span', 'p'); p.setAttribute('data-for', t.id); p.textContent = '00';
      a.append(nspan, tspan, dots, p);
      li.appendChild(a);
      ol.appendChild(li);
    });
    nav.innerHTML = '';
    nav.appendChild(ol);
  });

  /* 6. tüm başlıklar (PDF yer imi eşlemesi için) */
  const headings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
    id: h.id || '', tag: h.tagName, text: text(h),
  }));

  return { headings, toc: tocEntries, chapters: chapters.length };
}

/* ------------------------------ PDF işlemleri ---------------------------- */

/** Chromium bazı başlıkları yer imine iki kez yazar ("SözlükSözlük"); tekrarı temizle. */
function dedupeRepeat(title) {
  const t = String(title);
  for (let k = 4; k >= 2; k--) {
    if (t.length % k === 0) {
      const part = t.slice(0, t.length / k);
      if (part.repeat(k) === t) return part;
    }
  }
  return t;
}

const norm = (s) => String(s).normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr');

let pdfjsPromise;
function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function openPdf(buf) {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(buf), verbosity: 0, isEvalSupported: false });
  const doc = await task.promise;
  doc.__task = task;
  return doc;
}

async function closePdf(doc) {
  try { await doc.__task.destroy(); } catch (e) { /* önemsiz */ }
}

async function readOutline(doc) {
  const out = [];
  const tree = await doc.getOutline();
  if (!tree) return out;
  async function walk(items, d) {
    for (const it of items) {
      let dest = it.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      let page = null;
      if (Array.isArray(dest)) {
        const ref = dest[0];
        page = (ref && typeof ref === 'object') ? await doc.getPageIndex(ref) : ref;
      }
      out.push({ title: it.title, page: page == null ? null : page + 1, depth: d });
      if (it.items && it.items.length) await walk(it.items, d + 1);
    }
  }
  await walk(tree, 0);
  return out;
}

async function pageTexts(doc) {
  const texts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    texts.push(tc.items.map((x) => x.str).join(' '));
  }
  return texts;
}

/**
 * Başlık -> sayfa eşlemesi. Birincil kaynak PDF yer imleri (Chromium outline:true);
 * eşleşmeyen başlıklar için sayfa metninde arama yedeği.
 */
async function mapHeadingsToPages(buf, headings) {
  const doc = await openPdf(buf);
  const outline = await readOutline(doc);
  const pages = {};
  let j = 0;
  for (const o of outline) {
    const t = norm(dedupeRepeat(o.title));
    for (let i = j; i < headings.length; i++) {
      if (norm(headings[i].text) === t) {
        if (headings[i].id && o.page != null) pages[headings[i].id] = o.page;
        j = i + 1;
        break;
      }
    }
  }
  const unresolved = headings.filter((h) => h.id && pages[h.id] == null);
  let usedFallback = 0;
  if (unresolved.length) {
    const texts = (await pageTexts(doc)).map(norm);
    let from = 0;
    for (const h of headings) {
      if (!h.id) continue;
      if (pages[h.id] != null) { from = Math.max(from, pages[h.id] - 1); continue; }
      const needle = norm(h.text).slice(0, 48);
      for (let p = from; p < texts.length; p++) {
        if (texts[p].includes(needle)) { pages[h.id] = p + 1; from = p; usedFallback++; break; }
      }
    }
  }
  const numPages = doc.numPages;
  await closePdf(doc);
  return { pages, numPages, outlineCount: outline.length, usedFallback };
}

async function writeMetadata(buf, meta) {
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFDict } = require('pdf-lib');
  const pdf = await PDFDocument.load(buf, { updateMetadata: false });
  const clean = (s) => String(s).replace(/\r?\n/g, ' ').replace(/\*/g, '');
  pdf.setTitle(clean(meta.pdfTitle || meta.title));
  pdf.setAuthor(meta.author || 'Parla Bilgi Teknolojileri');
  pdf.setSubject(clean(meta.subtitle || meta.eyebrow || 'Parla BT Destek Portalı'));
  pdf.setKeywords([].concat(meta.keywords || ['Parla BT', 'Destek Portalı', 'kılavuz']));
  pdf.setCreator('Parla BT kılavuz derleyicisi (docs/manuals/build.cjs)');
  pdf.setProducer('Chromium (Skia/PDF) + pdf-lib');
  pdf.setCreationDate(new Date());
  pdf.setModificationDate(new Date());
  // yer imi başlıklarındaki Chromium tekrarlarını düzelt
  let fixedTitles = 0;
  const outlines = pdf.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  const walk = (item) => {
    while (item) {
      const t = item.lookupMaybe(PDFName.of('Title'), PDFString, PDFHexString);
      if (t) {
        const cur = t.decodeText();
        const fixed = dedupeRepeat(cur);
        if (fixed !== cur) { item.set(PDFName.of('Title'), PDFHexString.fromText(fixed)); fixedTitles++; }
      }
      const first = item.lookupMaybe(PDFName.of('First'), PDFDict);
      if (first) walk(first);
      item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
    }
  };
  if (outlines) walk(outlines.lookupMaybe(PDFName.of('First'), PDFDict));
  if (fixedTitles) log(`yer imi başlığı tekrarı düzeltildi: ${fixedTitles}`);
  const cat = pdf.catalog;
  cat.set(PDFName.of('Lang'), PDFString.of(meta.lang === 'en' ? 'en-US' : 'tr-TR'));
  cat.set(PDFName.of('ViewerPreferences'), pdf.context.obj({ DisplayDocTitle: true }));
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

/** Türkçe karakterler ve yer imleri için doğrulama. */
async function verifyPdf(buf, domText, tocChecks) {
  const doc = await openPdf(buf);
  const texts = await pageTexts(doc);
  const all = texts.join('\n');
  const outline = await readOutline(doc);
  const wanted = new Set([...domText].filter((c) => /[ÇĞİÖŞÜçğıöşü]/.test(c)));
  const missing = [...wanted].filter((c) => !all.includes(c));
  const bad = (all.match(/�/g) || []).length;
  // içindekiler doğrulaması: her satırdaki başlık gerçekten o sayfada mı?
  const squash = (s) => norm(s).replace(/\s+/g, '');   // izleme boşluğu farklarına dayanıklı
  const normTexts = texts.map(squash);
  const tocBad = [];
  for (const t of (tocChecks || [])) {
    const pg = normTexts[t.page - 1] || '';
    if (!pg.includes(squash(t.text))) tocBad.push(`${t.text} (s.${t.page})`);
  }
  const result = {
    tocChecked: (tocChecks || []).length,
    tocBad,
    pages: doc.numPages,
    outline: outline.length,
    trChars: [...wanted].join(''),
    trMissing: missing.join(''),
    replacementChars: bad,
  };
  await closePdf(doc);
  return result;
}

/* ---------------------------------- ana ---------------------------------- */

async function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith('--'));
  const htmlOnly = args.includes('--html-only');
  if (!name) {
    console.log('Kullanım: node docs/manuals/build.cjs <kılavuz-adı> [--html-only]\nÖrnek: node docs/manuals/build.cjs _sample');
    process.exit(1);
  }
  const metaFile = path.join(ROOT, 'content', name, 'meta.json');
  if (!fs.existsSync(metaFile)) die(`meta.json yok: ${metaFile}`);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  if (!meta.title) die('meta.json içinde "title" zorunlu.');
  const outFile = path.resolve(ROOT, meta.output || `out/${name}.pdf`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const buildDir = path.join(ROOT, '.build');
  fs.mkdirSync(buildDir, { recursive: true });

  const t0 = Date.now();
  const { html, icons, meta: cmeta } = compose(name, meta);
  const rawPath = path.join(buildDir, `${name}.raw.html`);
  fs.writeFileSync(rawPath, html);

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (['warning', 'error'].includes(m.type())) console.warn('[sayfa]', m.text()); });
    page.on('pageerror', (e) => console.warn('[sayfa hatası]', e.message));

    /* geçiş 0: enhance -> statik HTML */
    await page.goto(pathToFileURL(rawPath).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const openerArt = `
<svg class="co-art" viewBox="0 0 210 297" preserveAspectRatio="none" aria-hidden="true">
  <polygon points="150,0 210,0 210,34 140,34" fill="#0A1628"/>
  <polygon points="0,266 210,240 210,297 0,297" fill="#0A1628"/>
  <polygon points="0,266 210,240 210,243.4 0,269.4" fill="#F37021"/>
</svg>`;
    const info = await page.evaluate(enhance, {
      icons,
      depth: (cmeta.tocMeta && cmeta.tocMeta.depth) || 2,
      openerArt,
      chapterLabel: 'Bölüm',
      inChapter: 'Bu bölümde',
    });
    const imgInfo = await page.evaluate(async () => {
      const bad = [];
      await Promise.all([...document.images].map(async (im) => {
        try { await im.decode(); } catch (e) { /* aşağıda yakalanır */ }
        if (!im.naturalWidth) bad.push((im.getAttribute('src') || '').slice(0, 60));
      }));
      return { count: document.images.length, bad };
    });
    if (imgInfo.bad.length) console.warn('UYARI: yüklenemeyen görseller:', imgInfo.bad.join(', '));
    const domText = await page.evaluate(() => document.body.innerText);
    const staticHtml = '<!doctype html>\n' + (await page.evaluate(() => document.documentElement.outerHTML));
    const htmlPath = path.join(buildDir, `${name}.html`);
    fs.writeFileSync(htmlPath, staticHtml);
    log(`enhance: ${info.chapters} bölüm, ${info.headings.length} başlık, ${info.toc.length} içindekiler satırı, ${imgInfo.count} görsel`);
    if (htmlOnly) { log('--html-only: ' + htmlPath); return; }

    /* geçişler: PDF üret -> sayfa eşle -> TOC'ye yaz -> tekrar */
    const pdfOpts = {
      preferCSSPageSize: true, printBackground: true, outline: true, tagged: true,
      displayHeaderFooter: false,
    };
    let prevMap = null;
    let lastTocPages = null;
    let pdfBuf = null;
    let mapping = null;
    const maxPass = 5;
    for (let pass = 1; pass <= maxPass; pass++) {
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      if (prevMap) {
        await page.evaluate((m) => {
          document.querySelectorAll('.toc .p[data-for]').forEach((s) => {
            const v = m[s.getAttribute('data-for')];
            s.textContent = v == null ? '–' : String(v);
          });
        }, prevMap);
      }
      pdfBuf = await page.pdf(pdfOpts);
      mapping = await mapHeadingsToPages(pdfBuf, info.headings);
      const tocPages = {};
      info.toc.forEach((t) => { if (mapping.pages[t.id] != null) tocPages[t.id] = mapping.pages[t.id]; });
      const same = prevMap && JSON.stringify(prevMap) === JSON.stringify(tocPages);
      log(`geçiş ${pass}: ${mapping.numPages} sayfa, ${mapping.outlineCount} yer imi` +
        (mapping.usedFallback ? `, UYARI: ${mapping.usedFallback} başlık yer iminden değil metin aramasıyla bulundu (doğrulayın)` : '') +
        (same ? ' — içindekiler yakınsadı' : ''));
      if (same) break;
      if (pass === maxPass) console.warn('UYARI: içindekiler sayfa numaraları ' + maxPass + ' geçişte yakınsamadı.');
      prevMap = tocPages;
      lastTocPages = tocPages;
      if (!info.toc.length) break;        // içindekiler yoksa tek geçiş yeter
    }
    // son sürüm HTML'i (numaralar dolu) hata ayıklama için sakla
    fs.writeFileSync(path.join(buildDir, `${name}.final.html`),
      '<!doctype html>\n' + (await page.evaluate(() => document.documentElement.outerHTML)));

    const finalBuf = await writeMetadata(pdfBuf, meta);
    fs.writeFileSync(outFile, finalBuf);

    const tocChecks = info.toc.filter((t) => lastTocPages && lastTocPages[t.id] != null)
      .map((t) => ({ text: t.text, page: lastTocPages[t.id] }));
    const v = await verifyPdf(finalBuf, domText, tocChecks);
    log(`yazıldı: ${path.relative(process.cwd(), outFile)}  (${v.pages} sayfa, ${(finalBuf.length / 1024).toFixed(0)} KB, ${v.outline} yer imi)`);
    if (v.trChars) log(`Türkçe karakter denetimi: "${v.trChars}" -> ${v.trMissing ? 'EKSİK: ' + v.trMissing : 'tamam'}; U+FFFD sayısı: ${v.replacementChars}`);
    if (v.tocChecked) log(`içindekiler doğrulaması: ${v.tocChecked - v.tocBad.length}/${v.tocChecked} satır gösterdiği sayfada bulundu` + (v.tocBad.length ? ' — SORUN: ' + v.tocBad.join('; ') : ''));
    if (v.trMissing || v.replacementChars || v.tocBad.length) process.exitCode = 2;
    log(`süre: ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
  } finally {
    await browser.close();
  }
}

module.exports = { loadPlaywright, chromiumPath };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
