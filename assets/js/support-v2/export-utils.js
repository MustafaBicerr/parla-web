/**
 * Parla BT Ticket V2 — CSV ve Excel export yardımcıları
 */
let xlsxPromise = null;

function loadXlsx() {
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    if (window.XLSX) {
      resolve(window.XLSX);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("Excel kütüphanesi yüklenemedi."));
    document.head.appendChild(script);
  });
  return xlsxPromise;
}

export function downloadCsv(filename, headers, rows, delimiter = ";") {
  const bom = "\ufeff";
  const lines = [
    headers.join(delimiter),
    ...rows.map((r) =>
      r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(delimiter)
    ),
  ];
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
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
  URL.revokeObjectURL(url);
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
