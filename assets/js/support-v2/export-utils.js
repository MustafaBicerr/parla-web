/**
 * Parla BT Ticket V2 — CSV ve Excel export yardımcıları
 *
 * TEK KAYNAK: tüm CSV dışa aktarmaları `buildCsv`/`downloadCsv` üzerinden yapılır (ayraç `;`,
 * UTF-8 BOM; tr-TR Excel'de sütunlar doğru ayrılır) ve formül enjeksiyonu nötrlenir (SEC-15, ALT-08, SEN-20, PER-06, PER-24).
 */

/** Excel kütüphanesi: sabit sürüm, yükleme doğrulaması ve zaman aşımı (PER-23). */
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const XLSX_INTEGRITY = "sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw"; // SRI (sabit sürüm dosyası)
const XLSX_TIMEOUT_MS = 15000;
let xlsxPromise = null;

function xlsxReady() {
  return typeof window !== "undefined" && window.XLSX && window.XLSX.utils && typeof window.XLSX.writeFile === "function";
}

function loadXlsx() {
  if (xlsxReady()) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;

  const attempt = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let done = false;
    const fail = (message) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script.remove();
      reject(new Error(message));
    };
    const timer = setTimeout(
      () => fail("Excel kütüphanesi zamanında yüklenemedi. Bağlantınızı kontrol edin ya da CSV olarak indirin."),
      Number(window.__SV2_XLSX_TIMEOUT_MS) > 0 ? Number(window.__SV2_XLSX_TIMEOUT_MS) : XLSX_TIMEOUT_MS
    );
    script.src = XLSX_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.integrity = XLSX_INTEGRITY;
    script.onload = () => {
      if (done) return;
      if (!xlsxReady()) return fail("Excel kütüphanesi eksik yüklendi. Lütfen tekrar deneyin ya da CSV olarak indirin.");
      done = true;
      clearTimeout(timer);
      resolve(window.XLSX);
    };
    script.onerror = () => fail("Excel kütüphanesi yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin ya da CSV olarak indirin.");
    document.head.appendChild(script);
  });

  // Başarısız deneme önbelleğe alınmaz: bağlantı düzelince yeniden denenebilir.
  xlsxPromise = attempt.catch((err) => {
    xlsxPromise = null;
    throw err;
  });
  return xlsxPromise;
}

/**
 * CSV hücresini güvenli hale getirir: `=`, `+`, `-`, `@`, sekme ya da CR ile başlayan değerler Excel/Sheets'te
 * formül sayılır → başına `'` eklenir; ardından ayraç/tırnak/satır sonu için tırnaklanır.
 * Sayılar (ör. -5) olduğu gibi yazılır; yalnız METİN değerleri nötrlenir.
 */
export function csvCell(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  let s = value === null || value === undefined ? "" : typeof value === "object" ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Başlık + satırlardan CSV metni (BOM'suz). */
export function buildCsv(headers, rows, delimiter = ";") {
  const lines = [(headers || []).map(csvCell).join(delimiter), ...(rows || []).map((r) => (r || []).map(csvCell).join(delimiter))];
  return lines.join("\r\n");
}

export function downloadCsv(filename, headers, rows, delimiter = ";") {
  const bom = "﻿";
  const blob = new Blob([bom + buildCsv(headers, rows, delimiter)], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export async function downloadExcel(filename, sheets) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets || []) {
    const data = [sheet.headers || [], ...(sheet.rows || [])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, (sheet.name || "Sayfa1").slice(0, 31));
  }

  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function monthOptions(count = 12) {
  const options = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
    options.push({ value, label });
  }
  return options;
}

export function filterEffortsByMonth(efforts, month) {
  if (!month) return efforts || [];
  return (efforts || []).filter((e) => String(e.work_date || "").startsWith(month));
}
