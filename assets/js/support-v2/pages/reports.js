/**
 * Parla BT Ticket V2 — Raporlar (admin)
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth } from "../auth-guard.js";
import {
  renderShell,
  renderDataTable,
  showLoading,
  handleError,
  escapeHtml,
  formatTicketTypeLabel,
  renderEmptyState,
} from "../ui-shell.js";
import { SAP_MODULE_LABELS, formatPriorityLabel } from "../ticket-utils.js";

const PIE_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
];

let session = null;
let allTickets = [];
let allCompanies = [];
let allPersonnel = [];
let datePreset = "month";
let customFrom = "";
let customTo = "";

async function init() {
  try {
    showLoading(true);
    session = await requireAuth({ adminOnly: true });
    renderShell("#sv2-app", {
      title: "Raporlar",
      activePage: "reports",
      profile: session,
      isAdmin: true,
      content: `
        <div class="sv2-section">
          <div class="sv2-section-header">
            <h3>Raporlar</h3>
          </div>
          <div class="sv2-section-body">
            <div class="sv2-filters" id="report-filters">
              <div class="sv2-form-group">
                <label for="rp-preset">Tarih Aralığı</label>
                <select id="rp-preset">
                  <option value="week">Bu Hafta</option>
                  <option value="month" selected>Bu Ay</option>
                  <option value="3months">Son 3 Ay</option>
                  <option value="custom">Özel</option>
                </select>
              </div>
              <div class="sv2-form-group" id="rp-custom-from-wrap" hidden>
                <label for="rp-from">Başlangıç</label>
                <input type="date" id="rp-from">
              </div>
              <div class="sv2-form-group" id="rp-custom-to-wrap" hidden>
                <label for="rp-to">Bitiş</label>
                <input type="date" id="rp-to">
              </div>
              <button type="button" class="sv2-btn sv2-btn-primary" id="rp-apply">Uygula</button>
            </div>
            <div class="sv2-report-grid" id="report-cards"></div>
          </div>
        </div>`,
    });
    bindEvents();
    try {
      await loadData();
    } catch (err) {
      handleError(err, "Veriler yüklenemedi");
    }
    renderReports();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin") {
      handleError(err, "Sayfa yüklenemedi");
    }
  } finally {
    showLoading(false);
  }
}

init();

async function loadData() {
  [allTickets, allCompanies, allPersonnel] = await Promise.all([
    ParlaDb.getAllTickets(),
    ParlaDb.getAllCompanies(),
    ParlaDb.getAllPersonnel(),
  ]);
}

function bindEvents() {
  document.getElementById("rp-preset")?.addEventListener("change", (e) => {
    const custom = e.target.value === "custom";
    document.getElementById("rp-custom-from-wrap").hidden = !custom;
    document.getElementById("rp-custom-to-wrap").hidden = !custom;
  });
  document.getElementById("rp-apply")?.addEventListener("click", () => {
    datePreset = document.getElementById("rp-preset")?.value || "month";
    customFrom = document.getElementById("rp-from")?.value || "";
    customTo = document.getElementById("rp-to")?.value || "";
    renderReports();
  });
}

function getDateRange() {
  const now = new Date();
  let start;
  let end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (datePreset === "week") {
    start = new Date(now);
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
  } else if (datePreset === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (datePreset === "3months") {
    start = new Date(now);
    start.setMonth(start.getMonth() - 3);
    start.setHours(0, 0, 0, 0);
  } else {
    start = customFrom ? new Date(customFrom) : new Date(0);
    start.setHours(0, 0, 0, 0);
    if (customTo) {
      end = new Date(customTo);
      end.setHours(23, 59, 59, 999);
    }
  }
  return { start, end };
}

function filteredTickets() {
  const { start, end } = getDateRange();
  return allTickets.filter((t) => {
    const d = new Date(t.created_at);
    return d >= start && d <= end;
  });
}

function groupCount(items, keyFn) {
  const map = {};
  for (const item of items) {
    const key = keyFn(item) || "Diğer";
    map[key] = (map[key] || 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function renderBarChart(data, maxHeight) {
  if (!data.length) return `<p style="color:var(--sv2-gray-500);text-align:center">Veri yok</p>`;
  const max = Math.max(...data.map((d) => d[1]), 1);
  const h = maxHeight || 200;
  return `<div class="sv2-bar-chart">
    ${data
      .map(([label, value]) => {
        const pct = Math.round((value / max) * 100);
        return `<div class="sv2-bar">
          <span class="sv2-bar-value">${value}</span>
          <div class="sv2-bar-fill" style="height:${Math.max(4, (pct / 100) * h)}px"></div>
          <span class="sv2-bar-label">${escapeHtml(label)}</span>
        </div>`;
      })
      .join("")}
  </div>`;
}

function renderPieChart(data) {
  if (!data.length) return `<p style="color:var(--sv2-gray-500);text-align:center">Veri yok</p>`;
  const total = data.reduce((s, d) => s + d[1], 0);
  let acc = 0;
  const stops = data.map(([_, value], i) => {
    const pct = (value / total) * 100;
    const start = acc;
    acc += pct;
    return `${PIE_COLORS[i % PIE_COLORS.length]} ${start}% ${acc}%`;
  });
  const legend = data
    .map(
      ([label, value], i) =>
        `<div class="sv2-pie-legend-item">
          <span class="sv2-pie-swatch" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>
          ${escapeHtml(label)} (${value})
        </div>`
    )
    .join("");
  return `
    <div class="sv2-pie-chart" style="background:conic-gradient(${stops.join(", ")})"></div>
    <div class="sv2-pie-legend">${legend}</div>`;
}

function downloadCsv(filename, headers, rows) {
  const bom = "\ufeff";
  const lines = [
    headers.join(";"),
    ...rows.map((r) =>
      r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")
    ),
  ];
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function reportCard(id, title, bodyHtml) {
  return `
    <div class="sv2-report-card" data-report="${id}">
      <div class="sv2-report-card-header">
        <h4>${escapeHtml(title)}</h4>
        <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-outline btn-csv" data-report="${id}">
          <i class="fas fa-download"></i> CSV
        </button>
      </div>
      <div class="sv2-report-card-body">${bodyHtml}</div>
    </div>`;
}

function resolutionHours(ticket) {
  if (!ticket.resolved_at || !ticket.created_at) return null;
  const ms = new Date(ticket.resolved_at) - new Date(ticket.created_at);
  return ms > 0 ? ms / (1000 * 60 * 60) : null;
}

function renderReports() {
  const el = document.getElementById("report-cards");
  if (!el) return;

  const tickets = filteredTickets();
  const noDataBanner =
    allTickets.length === 0
      ? renderEmptyState(
          "Henüz ticket kaydı yok. Raporlar ticket oluşturuldukça dolacaktır.",
          "fa-chart-bar"
        )
      : tickets.length === 0
        ? renderEmptyState("Seçilen tarih aralığında ticket bulunamadı.", "fa-calendar")
        : "";

  // 1. Modül bazlı dağılım
  const moduleData = groupCount(tickets, (t) => {
    const mod = t.sap_module || "Diğer";
    return SAP_MODULE_LABELS[mod] ? `${mod} — ${SAP_MODULE_LABELS[mod]}` : mod;
  });

  // 2. Tip bazlı dağılım
  const typeData = groupCount(tickets, (t) =>
    formatTicketTypeLabel(t.ticket_type || "SUP")
  );

  // 3. Danışman performansı
  const consultantStats = {};
  for (const p of allPersonnel) {
    const id = p.id || p.personnel_id;
    consultantStats[id] = {
      name: `${p.first_name || ""} ${p.last_name || ""}`.trim(),
      assigned: 0,
      resolved: 0,
      totalHours: 0,
      resolvedCount: 0,
    };
  }
  for (const t of tickets) {
    const id = t.assigned_to_id;
    if (!id || !consultantStats[id]) continue;
    consultantStats[id].assigned++;
    if (["resolved", "closed"].includes(String(t.status || "").toLowerCase())) {
      consultantStats[id].resolved++;
      const hrs = resolutionHours(t);
      if (hrs !== null) {
        consultantStats[id].totalHours += hrs;
        consultantStats[id].resolvedCount++;
      }
    }
  }
  const consultantRows = Object.values(consultantStats)
    .filter((c) => c.assigned > 0)
    .sort((a, b) => b.resolved - a.resolved);

  const consultantTable = renderDataTable({
    columns: [
      { key: "name", label: "DANIŞMAN" },
      { key: "assigned", label: "ATANAN" },
      { key: "resolved", label: "ÇÖZÜLEN" },
      {
        key: "avg",
        label: "ORT. SÜRE (SAAT)",
        render: (_, row) => {
          if (!row.resolvedCount) return "—";
          return (row.totalHours / row.resolvedCount).toFixed(1);
        },
      },
    ],
    rows: consultantRows.map((r, i) => ({ ...r, id: String(i) })),
    emptyMessage: "Danışman verisi yok.",
  });

  // 4. En aktif firmalar top 10
  const companyData = groupCount(tickets, (t) => t.company_name || "Bilinmiyor").slice(0, 10);

  // 5. Arızi müşteri istatistikleri
  const arzTickets = tickets.filter((t) => String(t.ticket_type || "").toUpperCase() === "ARZ");
  const arcCompanies = allCompanies.filter((c) => String(c.customer_type || "").toUpperCase() === "ARC");
  const arzStats = [
    ["Toplam ARZ Ticket", arzTickets.length],
    ["Açık ARZ", arzTickets.filter((t) => !["closed", "resolved"].includes(String(t.status).toLowerCase())).length],
    ["Arızi Müşteri (ARC)", arcCompanies.length],
    ["Ort. Çözüm (saat)", (() => {
      const hrs = arzTickets.map(resolutionHours).filter((h) => h !== null);
      return hrs.length ? (hrs.reduce((a, b) => a + b, 0) / hrs.length).toFixed(1) : "—";
    })()],
  ];

  // 6. Aylık trend (6 months)
  const monthLabels = [];
  const monthCounts = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
    monthLabels.push(label);
    const count = allTickets.filter((t) => {
      const td = new Date(t.created_at);
      return td.getFullYear() === d.getFullYear() && td.getMonth() === d.getMonth();
    }).length;
    monthCounts.push(count);
  }
  const trendData = monthLabels.map((l, i) => [l, monthCounts[i]]);

  // 7. Çözüm süreleri by priority
  const priorityMap = {};
  for (const t of tickets) {
    const pri = String(t.priority || "medium").toLowerCase();
    const hrs = resolutionHours(t);
    if (hrs === null) continue;
    if (!priorityMap[pri]) priorityMap[pri] = { total: 0, count: 0 };
    priorityMap[pri].total += hrs;
    priorityMap[pri].count++;
  }
  const priorityData = Object.entries(priorityMap)
    .map(([k, v]) => [formatPriorityLabel(k), Math.round(v.total / v.count)])
    .sort((a, b) => b[1] - a[1]);

  el.innerHTML =
    noDataBanner +
    reportCard("modules", "Modül Bazlı Dağılım", renderPieChart(moduleData)) +
    reportCard("types", "Tip Bazlı Dağılım", renderPieChart(typeData)) +
    reportCard("consultants", "Danışman Performansı", consultantTable) +
    reportCard("companies", "En Aktif Firmalar (Top 10)", renderBarChart(companyData)) +
    reportCard(
      "arz",
      "Arızi Müşteri İstatistikleri",
      `<div class="sv2-stats-grid">${arzStats
        .map(
          ([label, val]) =>
            `<div class="sv2-stat-card"><div class="sv2-stat-value">${escapeHtml(String(val))}</div><div class="sv2-stat-label">${escapeHtml(label)}</div></div>`
        )
        .join("")}</div>`
    ) +
    reportCard("trend", "Aylık Trend (6 Ay)", renderBarChart(trendData)) +
    reportCard("priority", "Çözüm Süreleri (Öncelik)", renderBarChart(priorityData));

  el.querySelectorAll(".btn-csv").forEach((btn) => {
    btn.addEventListener("click", () => exportReport(btn.dataset.report, {
      moduleData,
      typeData,
      consultantRows,
      companyData,
      arzStats,
      trendData,
      priorityData,
    }));
  });
}

function exportReport(id, data) {
  const ts = new Date().toISOString().slice(0, 10);
  switch (id) {
    case "modules":
      downloadCsv(`modul-dagilim-${ts}.csv`, ["Modül", "Adet"], data.moduleData);
      break;
    case "types":
      downloadCsv(`tip-dagilim-${ts}.csv`, ["Tip", "Adet"], data.typeData);
      break;
    case "consultants":
      downloadCsv(
        `danisman-performans-${ts}.csv`,
        ["Danışman", "Atanan", "Çözülen", "Ort.Süre(sa)"],
        data.consultantRows.map((r) => [
          r.name,
          r.assigned,
          r.resolved,
          r.resolvedCount ? (r.totalHours / r.resolvedCount).toFixed(1) : "—",
        ])
      );
      break;
    case "companies":
      downloadCsv(`aktif-firmalar-${ts}.csv`, ["Firma", "Ticket"], data.companyData);
      break;
    case "arz":
      downloadCsv(`arizi-istatistik-${ts}.csv`, ["Metrik", "Değer"], data.arzStats);
      break;
    case "trend":
      downloadCsv(`aylik-trend-${ts}.csv`, ["Ay", "Ticket"], data.trendData);
      break;
    case "priority":
      downloadCsv(`cozum-sureleri-${ts}.csv`, ["Öncelik", "Ort.Saat"], data.priorityData);
      break;
    default:
      break;
  }
}
