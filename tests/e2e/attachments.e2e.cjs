/**
 * E2E: dosya ekleri (talep oluştururken, yanıtta, iç not ekleri, yetkiler, sıkıştırma).
 * Çalıştırma: node tests/e2e/attachments.e2e.cjs
 */
const zlib = require("node:zlib");
const { createWorld, startServer } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const results = [];
const check = (name, ok, extra) => results.push([ok ? "PASS" : "FAIL", name, ok ? "" : extra || ""]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(80); } return false; }

/** Düzgün gradyan + hafif gürültü içeren büyük bir PNG üretir (sıkıştırılabilir). */
function bigPng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let seed = 7;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed >> 16) % 16;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255 / w + n) & 255; raw[o + 1] = (y * 255 / h + n) & 255; raw[o + 2] = ((x + y) * 127 / (w + h) + n) & 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]);
}

(async () => {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);
  try {
    const png = bigPng(2400, 1600);
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

    // 1) Müşteri: yeni talep + ekler
    const cust = await srv.session("u_cust");
    await cust.goto("/support-v2/customer/tickets.html");
    await cust.page.waitForSelector("#sv2-new-ticket-btn");
    await cust.page.click("#sv2-new-ticket-btn");
    await cust.page.waitForSelector("#sv2-create-ticket-form");
    await cust.page.selectOption("#sv2-ticket-module", "FI");
    await cust.page.fill("#sv2-ticket-title", "Ekranda hata mesajı alıyorum");
    await cust.page.fill("#sv2-ticket-description", "Ekran görüntüsü ektedir, işlem sırasında hata alıyoruz.");
    await cust.page.setInputFiles("#sv2-create-input", [{ name: "virus.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") }]);
    await cust.page.click("#sv2-create-ticket-submit");
    check("izin verilmeyen dosya türü reddedilir (talep açılmaz)", await waitFor(async () => (await cust.page.locator("#sv2-create-error").textContent()).includes("desteklenmeyen")) && Object.keys(world.valueAt("v2/tickets") || {}).length === 12);

    await cust.page.click(".sv2-file-remove");
    await cust.page.setInputFiles("#sv2-create-input", [
      { name: "ekran görüntüsü.png", mimeType: "image/png", buffer: png },
      { name: "rapor.pdf", mimeType: "application/pdf", buffer: pdf },
    ]);
    await cust.page.click("#sv2-create-ticket-submit");
    check("talep oluşturuldu", await waitFor(() => Object.keys(world.valueAt("v2/tickets") || {}).length === 13));
    const newId = Object.keys(world.valueAt("v2/tickets")).find((k) => !["t1","t2","t3","t4","t5","t6","t7","t8","t9","t10","t11","t12"].includes(k));
    check("ek mesajı oluştu ve iki ek referansı taşıyor", await waitFor(() => Object.values(world.valueAt(`v2/ticket_messages/${newId}`) || {}).some((m) => Object.values(m.attachments || {}).length === 2)));
    const atts = Object.values(world.valueAt(`v2/ticket_attachments/${newId}`) || {});
    const image = atts.find((a) => /^image\//.test(a.type));
    check("PNG istemcide JPEG'e sıkıştırıldı ve boyut sınırın altında", !!image && image.type === "image/jpeg" && image.size < png.length / 3 && image.size < 2 * 1024 * 1024 && image.name.endsWith(".jpg"), JSON.stringify(image && { type: image.type, size: image.size, orig: png.length, name: image.name }));
    check("PDF olduğu gibi saklandı", atts.some((a) => a.type === "application/pdf" && a.name === "rapor.pdf"));
    check("yükleyen kullanıcı kimliği yazıldı", atts.every((a) => a.uploader_uid === "u_cust"));

    // 2) Personel: ekleri görür ve açar
    const staff = await srv.session("u_service");
    await staff.goto(`/support-v2/admin/ticket-detail.html?id=${newId}`);
    await staff.page.waitForSelector(".sv2-attachment");
    const chips = await staff.page.locator(".sv2-attachment").allTextContents();
    check("personel talep detayında ek çiplerini görür", chips.length === 2 && chips.some((c) => c.includes("ekran görüntüsü.jpg")) && chips.some((c) => c.includes("rapor.pdf")), chips.join(" | "));
    const [popup] = await Promise.all([staff.page.waitForEvent("popup"), staff.page.locator(".sv2-attachment", { hasText: "ekran" }).first().click()]);
    await popup.waitForLoadState();
    check("görsel eki yeni sekmede (blob) açılır", /^blob:/.test(popup.url()), popup.url());
    await popup.close();

    // 3) Personel yanıtı + ek; iç not eki
    await staff.page.fill("#sv2-reply-message", "Ekran görüntüsünü aldık, inceliyoruz.");
    await staff.page.setInputFiles("#sv2-reply-input", [{ name: "analiz.csv", mimeType: "", buffer: Buffer.from("a;b\n1;2\n") }]);
    await staff.page.click("#sv2-reply-send");
    check("personel yanıtına ek eklendi (csv türü uzantıdan çözüldü)", await waitFor(() => Object.values(world.valueAt(`v2/ticket_attachments/${newId}`) || {}).some((a) => a.name === "analiz.csv" && a.type === "text/csv")));
    check("ek bilgisi e-posta bildirimine yazıldı", await waitFor(() => world.emails.some((e) => /Ekler: analiz\.csv/.test(e.html))));

    await staff.page.fill("#sv2-reply-message", "Dahili: log dosyası ekte.");
    await staff.page.check("#sv2-reply-internal");
    await staff.page.setInputFiles("#sv2-reply-input", [{ name: "sistem.log", mimeType: "text/plain", buffer: Buffer.from("ERROR 123\n") }]);
    await staff.page.click("#sv2-reply-send");
    check("iç not eki ticket_internal_attachments düğümüne yazıldı", await waitFor(() => Object.values(world.valueAt(`v2/ticket_internal_attachments/${newId}`) || {}).some((a) => a.name === "sistem.log")));
    check("iç not eki herkese açık ek düğümünde yok", !Object.values(world.valueAt(`v2/ticket_attachments/${newId}`) || {}).some((a) => a.name === "sistem.log"));

    // 4) Müşteri sayfası: yalnızca açık ekler
    await cust.goto(`/support-v2/customer/ticket-detail.html?id=${newId}`);
    await cust.page.waitForSelector(".sv2-attachment");
    const custChips = (await cust.page.locator(".sv2-attachment").allTextContents()).join(" | ");
    check("müşteri personelin açık ekini (analiz.csv) görür, iç not ekini (sistem.log) görmez", custChips.includes("analiz.csv") && !custChips.includes("sistem.log"), custChips);
    const [dl] = await Promise.all([cust.page.waitForEvent("download"), cust.page.locator(".sv2-attachment", { hasText: "analiz.csv" }).click()]);
    check("csv eki indirilir (dosya adı korunur)", dl.suggestedFilename() === "analiz.csv");

    // 5) Yetkiler
    const internalId = Object.keys(world.valueAt(`v2/ticket_internal_attachments/${newId}`))[0];
    check("müşteri iç not ekini veritabanından da okuyamaz", world.dbOp({ op: "get", path: `v2/ticket_internal_attachments/${newId}/${internalId}`, uid: "u_cust" }).error === "PERMISSION_DENIED");
    const someAtt = Object.keys(world.valueAt(`v2/ticket_attachments/${newId}`))[0];
    check("başka firmanın müşterisi ek verisini okuyamaz", world.dbOp({ op: "get", path: `v2/ticket_attachments/${newId}/${someAtt}`, uid: "u_custB" }).error === "PERMISSION_DENIED");
    check("ek listesi toplu okunamaz (personel dahil)", world.dbOp({ op: "get", path: `v2/ticket_attachments/${newId}`, uid: "u_service" }).error === "PERMISSION_DENIED");

    // 6) Boyut sınırı
    await cust.page.fill("#sv2-reply-message", "Büyük dosya denemesi.");
    await cust.page.setInputFiles("#sv2-reply-input", [{ name: "buyuk.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(2.5 * 1024 * 1024, 65) }]);
    await cust.page.click("#sv2-send-reply");
    check("2 MB üstü dosya reddedilir", await waitFor(async () => (await cust.page.locator("#sv2-reply-error").textContent()).includes("sınırını aşıyor")));
    await cust.page.setInputFiles("#sv2-reply-input", []);
    check("hatalı dosyada mesaj gönderilmedi", !Object.values(world.valueAt(`v2/ticket_messages/${newId}`) || {}).some((m) => /Büyük dosya denemesi/.test(m.message)));

    for (const [name, s] of [["cust", cust], ["staff", staff]]) check(`${name}: sayfa hatası yok`, s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
    const unexpected = world.denied.filter((d) => !/ticket_attachments\/[^/]+$/.test(d.path) && !(d.uid === "u_cust" && /internal/.test(d.path)) && !(d.uid === "u_custB") && !(d.path === "/v2/users" && d.uid !== "u_root" && d.uid !== "u_service"));
    check("beklenmeyen PERMISSION_DENIED yok", unexpected.length === 0, JSON.stringify(unexpected.slice(0, 4)));
  } finally {
    await srv.close();
  }
  results.forEach((r) => console.log(r.join(" | ")));
  console.log(`\n${results.filter((r) => r[0] === "PASS").length}/${results.length} geçti`);
  process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
