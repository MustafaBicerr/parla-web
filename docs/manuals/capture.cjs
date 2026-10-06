#!/usr/bin/env node
/* ============================================================================
   Ekran görüntüsü yardımcısı (kılavuzlar için)
   ----------------------------------------------------------------------------
   Kullanım:
     node docs/manuals/capture.cjs <url> <cikti.png> [seçenekler]

   <url> "/" ile başlıyorsa repo kökü yerel olarak sunulur (ör. /support-v2/login.html).
   Seçenekler:
     --w 1440 --h 900        görünüm alanı (CSS px)            [1440x900]
     --scale 1.5             cihaz piksel oranı                 [1.5]
     --selector "<css>"      yalnızca bu öğeyi çek (kırpma)
     --wait "<css>"          bu öğe görünene kadar bekle
     --wait-timeout 30000    --wait için üst süre (ms)          [30000]
     --fill "<css>=<değer>"  alan doldur (birden çok kez verilebilir)
     --click "<css>"         tıkla (birden çok kez verilebilir)
     --delay 300             çekimden önce ek bekleme (ms)      [300]
     --allow-external        dış sitelere (CDN vb.) isteklere izin ver
                             (varsayılan: engellenir; çevrimdışı ortamda takılmayı önler)
   ============================================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadPlaywright, chromiumPath } = require('./build.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function parseArgs(argv) {
  const pos = []; const opt = { fill: [], click: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (k === 'allow-external') { opt.allowExternal = true; continue; }
    const v = argv[++i];
    if (k === 'fill' || k === 'click') opt[k].push(v); else opt[k] = v;
  }
  return { pos, opt };
}

(async () => {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  if (pos.length < 2) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 22).join('\n')); process.exit(1); }
  let [url, out] = pos;
  let server = null; let port = 0;
  if (url.startsWith('/')) {
    server = http.createServer((req, res) => {
      const f = path.join(REPO_ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!f.startsWith(REPO_ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('yok'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
    url = `http://127.0.0.1:${port}${url}`;
  }
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: +(opt.w || 1440), height: +(opt.h || 900) },
      deviceScaleFactor: +(opt.scale || 1.5), locale: 'tr-TR',
    });
    const page = await ctx.newPage();
    if (!opt.allowExternal) {
      await page.route('**/*', (r) => {
        const u = r.request().url();
        return /^(https?:\/\/(127\.0\.0\.1|localhost)|data:|blob:)/.test(u) ? r.continue() : r.abort();
      });
    }
    await page.goto(url, { waitUntil: 'load' });
    if (opt.wait) await page.waitForSelector(opt.wait, { timeout: +(opt['wait-timeout'] || 30000) });
    for (const f of opt.fill) { const i = f.indexOf('='); await page.fill(f.slice(0, i), f.slice(i + 1)); }
    for (const c of opt.click) await page.click(c);
    await page.waitForTimeout(+(opt.delay || 300));
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    if (opt.selector) await (await page.waitForSelector(opt.selector)).screenshot({ path: out });
    else await page.screenshot({ path: out });
    const dim = await page.evaluate(() => `${innerWidth}x${innerHeight}`);
    console.log(`yazıldı: ${out} (görünüm ${dim}, oran ${opt.scale || 1.5})`);
  } finally {
    await browser.close();
    if (server) server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
