/**
 * CSP Report-Only ihlal raporu alıcısı (netlify.toml: /api/csp-report). Yalnızca kısaltılmış, sorgu parametresi
 * içermeyen alanları function günlüğüne yazar (oobCode/token sızmasın); 1–2 haftalık izleme için yeterlidir.
 * Kimlik doğrulama yoktur (tarayıcı raporları kimlik taşımaz): gövde ≤ 8 KB, yanıt her zaman 204, yalnızca log.
 */
const MAX_BODY = 8 * 1024;

/** URL'den sorgu/parça kısmını atar; URL değilse (ör. "inline", "eval") olduğu gibi kısaltır. */
function stripUrl(value) {
  const text = String(value == null ? "" : value).slice(0, 300);
  return text.replace(/[?#].*$/, "");
}

function pick(report) {
  const r = report && typeof report === "object" ? report : {};
  return {
    document: stripUrl(r["document-uri"] || r.documentURL),
    blocked: stripUrl(r["blocked-uri"] || r.blockedURL),
    directive: String(r["violated-directive"] || r.effectiveDirective || "").slice(0, 80),
    source: stripUrl(r["source-file"] || r.sourceFile),
    line: Number(r["line-number"] || r.lineNumber) || 0,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 204, body: "" };
  const raw = String(event.body || "");
  if (raw.length > MAX_BODY) return { statusCode: 204, body: "" };
  try {
    const json = JSON.parse(raw);
    // report-uri: { "csp-report": {...} } ; Reporting API (report-to): [{ type: "csp-violation", body: {...} }]
    const reports = Array.isArray(json) ? json.map((j) => j && j.body) : [json && (json["csp-report"] || json)];
    reports.slice(0, 5).forEach((report) => console.warn("[csp-report]", JSON.stringify(pick(report))));
  } catch {
    /* geçersiz gövde: yok say */
  }
  return { statusCode: 204, body: "" };
};

exports._internals = { pick, stripUrl };
