/**
 * Parla BT Ticket V2 — yönetim modülleri için SAF yardımcılar (tarayıcı/DOM bağımlılığı yok; birim testlenir).
 *
 *  - Sözleşme: etkin durum (TEK yer), doğrulama, firma "sözleşmeli" özeti, rozet sınıfı (YON-17/18, UX-24/25)
 *  - Proje: durum etiketleri/rozetleri, tarih doğrulaması (YON-20)
 *  - Seçici listeleri: pasif kaydı yalnız mevcut seçim olarak gösterme (YON-10/11/35)
 *  - Denormalize kopya planlayıcıları: firma/personel/departman/kullanıcı adı ve e-posta yayma (YON-04/09, SEC-21)
 *  - Hazır yanıt şablonları: değişken doldurma + doğrulama (WP-16)
 *  - Toplu işlem planlayıcıları: toplu durum / toplu atama (WP-16)
 *  - Rapor tarih aralığı (PER-39) ve atanmamış/sahipsiz talep tanımı (PER-21)
 */
import {
  STATUSES,
  STATUS_LABELS,
  ROLES,
  isOpenStatus,
  isTransitionAllowed,
  normalizeSearch,
} from "./ticket-utils.js";

/* ------------------------------------------------------------------ *
 * Tarih yardımcıları
 * ------------------------------------------------------------------ */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MIN_DATE = "2000-01-01";
export const MAX_DATE = "2100-12-31";

/** 'YYYY-MM-DD' yerel gece yarısı (saat dilimi kayması olmadan); geçersizse null. */
export function parseDateOnly(value) {
  const m = DATE_RE.exec(String(value || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** Tarih 'YYYY-MM-DD' biçiminde, gerçek bir gün ve [2000, 2100] aralığında mı? */
export function isValidDateOnly(value) {
  if (!parseDateOnly(value)) return false;
  const s = String(value).trim();
  return s >= MIN_DATE && s <= MAX_DATE;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Ayı gün taşması olmadan ekler (31 Mayıs − 3 ay = 29 Şubat/28 Şubat, 3 Mart DEĞİL). */
export function addMonthsClamped(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d;
}

/* ------------------------------------------------------------------ *
 * Sözleşme
 * ------------------------------------------------------------------ */

export const CONTRACT_TYPES = {
  yillik: "Yıllık Bakım",
  bakim: "Bakım Anlaşması",
  proje: "Proje Sözleşmesi",
  lisans: "Lisans",
  diger: "Diğer",
};

export const CONTRACT_STATUS = {
  active: "Aktif",
  expired: "Sona Ermiş",
  pending: "Beklemede",
  cancelled: "İptal",
};

export function contractTypeLabel(code) {
  const k = String(code || "");
  return Object.prototype.hasOwnProperty.call(CONTRACT_TYPES, k) ? CONTRACT_TYPES[k] : k || "—";
}

export function contractStatusLabel(status) {
  const k = String(status || "");
  return Object.prototype.hasOwnProperty.call(CONTRACT_STATUS, k) ? CONTRACT_STATUS[k] : k || "—";
}

/** Bitişe kalan gün (bugün dahil değil: bugün biten = 0); tarih yoksa/geçersizse null. */
export function contractDaysRemaining(endDate, now) {
  const end = parseDateOnly(endDate);
  if (!end) return null;
  const today = startOfDay(now || new Date());
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}

/**
 * Sözleşmenin ETKİN durumu — ekranlardaki TEK kaynak (Sözleşmeler, firma detayı, firma listesi).
 * İptal ve beklemede saklı durumdur; "sona ermiş" saklı durum ya da bitiş tarihi geçmişse; başlangıcı gelecekteyse
 * "beklemede"; aksi hâlde "aktif".
 */
export function effectiveContractStatus(contract, now) {
  const c = contract || {};
  if (c.status === "cancelled") return "cancelled";
  if (c.status === "pending") return "pending";
  const days = contractDaysRemaining(c.end_date, now);
  if (c.status === "expired" || (days !== null && days < 0)) return "expired";
  const start = parseDateOnly(c.start_date);
  if (start && start.getTime() > startOfDay(now || new Date()).getTime()) return "pending";
  return "active";
}

/** Rozet için MEVCUT CSS sınıfı (tanımsız sınıf kullanılmaz: UX-24). */
export function contractBadgeClass(effectiveStatus) {
  switch (effectiveStatus) {
    case "active":
      return "sv2-badge-resolved";
    case "expired":
      return "sv2-badge-closed";
    case "pending":
      return "sv2-badge-in_progress";
    case "cancelled":
      return "sv2-badge-priority-critical";
    default:
      return "sv2-badge-closed";
  }
}

/** Firmanın sözleşmelerinin özeti: durum sayıları + "sözleşmeli mi" (has_contract bundan türer). */
export function summarizeContracts(contracts, now) {
  const out = { total: 0, active: 0, expired: 0, pending: 0, cancelled: 0, hasActive: false, activeContractId: "" };
  for (const c of contracts || []) {
    out.total += 1;
    const s = effectiveContractStatus(c, now);
    out[s] += 1;
    if (s === "active" && !out.activeContractId) out.activeContractId = c.id || c.contract_id || "";
  }
  out.hasActive = out.active > 0;
  return out;
}

/** Firma kimliğine göre "etkin sözleşmesi var" kümesi (liste rozetleri). */
export function companiesWithActiveContract(contracts, now) {
  const set = new Set();
  for (const c of contracts || []) {
    if (c.company_id && effectiveContractStatus(c, now) === "active") set.add(c.company_id);
  }
  return set;
}

/**
 * Sözleşme formu doğrulaması. `value` alanı metin/sayı olabilir; boş = bedel yok.
 * @returns {{valid:boolean, errors:Record<string,string>, warnings:string[], value:number|null}}
 */
export function validateContractInput(input, contracts, editId, now) {
  const errors = {};
  const warnings = [];
  const number = String(input?.contract_number || "").trim();
  if (!number) errors.number = "Sözleşme numarası zorunludur.";
  else if (number.length > 60) errors.number = "Sözleşme numarası en fazla 60 karakter olabilir.";
  else {
    const dup = (contracts || []).find(
      (c) => (c.id || c.contract_id) !== editId && normalizeSearch(c.contract_number).trim() === normalizeSearch(number).trim()
    );
    if (dup) errors.number = "Bu sözleşme numarası zaten kullanılıyor.";
  }
  if (!String(input?.company_id || "").trim()) errors.company = "Firma seçin.";

  const start = String(input?.start_date || "").trim();
  const end = String(input?.end_date || "").trim();
  if (!start) errors.start = "Başlangıç tarihi zorunludur.";
  else if (!isValidDateOnly(start)) errors.start = "Başlangıç tarihi geçersiz (2000–2100 arası bir tarih girin).";
  if (!end) errors.end = "Bitiş tarihi zorunludur.";
  else if (!isValidDateOnly(end)) errors.end = "Bitiş tarihi geçersiz (2000–2100 arası bir tarih girin).";
  else if (!errors.start && end < start) errors.end = "Bitiş tarihi başlangıçtan önce olamaz.";

  let value = null;
  const rawValue = input?.value;
  if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "") {
    const n = Number(String(rawValue).replace(",", "."));
    if (!Number.isFinite(n) || n < 0) errors.value = "Değer sıfır ya da pozitif bir sayı olmalıdır.";
    else if (n > 1e12) errors.value = "Değer çok büyük.";
    else value = n;
  }

  // Aynı firmada çakışan etkin sözleşme: engel değil, uyarı
  if (!errors.start && !errors.end && input?.company_id && (input.status || "active") === "active") {
    const overlap = (contracts || []).find((c) => {
      if ((c.id || c.contract_id) === editId || c.company_id !== input.company_id) return false;
      if (effectiveContractStatus(c, now) !== "active") return false;
      return String(c.start_date || "") <= end && String(c.end_date || "") >= start;
    });
    if (overlap) warnings.push(`Aynı firmada tarihleri çakışan etkin bir sözleşme var (${overlap.contract_number || "—"}).`);
  }
  return { valid: Object.keys(errors).length === 0, errors, warnings, value };
}

/* ------------------------------------------------------------------ *
 * Proje
 * ------------------------------------------------------------------ */

export const PROJECT_STATUS = {
  planning: "Planlama",
  active: "Aktif",
  on_hold: "Beklemede",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export function projectStatusLabel(status) {
  const k = String(status || "planning");
  return Object.prototype.hasOwnProperty.call(PROJECT_STATUS, k) ? PROJECT_STATUS[k] : k;
}

/** Rozet için MEVCUT CSS sınıfı (UX-24/25). */
export function projectBadgeClass(status) {
  switch (String(status || "planning")) {
    case "active":
      return "sv2-badge-resolved";
    case "planning":
      return "sv2-badge-assigned";
    case "on_hold":
      return "sv2-badge-in_progress";
    case "completed":
      return "sv2-badge-open";
    case "cancelled":
      return "sv2-badge-priority-critical";
    default:
      return "sv2-badge-closed";
  }
}

/** Proje formu doğrulaması (ad, firma, tarihler). */
export function validateProjectInput(input) {
  const errors = {};
  const name = String(input?.name || "").trim();
  if (!name) errors.name = "Proje adı zorunludur.";
  else if (name.length > 200) errors.name = "Proje adı en fazla 200 karakter olabilir.";
  if (!String(input?.company_id || "").trim()) errors.company = "Firma seçin.";
  const start = String(input?.start_date || "").trim();
  const end = String(input?.end_date || "").trim();
  if (start && !isValidDateOnly(start)) errors.start = "Başlangıç tarihi geçersiz.";
  if (end && !isValidDateOnly(end)) errors.end = "Bitiş tarihi geçersiz.";
  if (start && end && !errors.start && !errors.end && end < start) errors.end = "Bitiş tarihi başlangıçtan önce olamaz.";
  return { valid: Object.keys(errors).length === 0, errors };
}

/** Yönetici adı yer tutucu ("Seçiniz") ya da boş ise saklanmaz. */
export function cleanManagerName(value) {
  const v = String(value || "").trim();
  return !v || /^(seçiniz|seciniz|—|-)$/i.test(v) ? "" : v;
}

/* ------------------------------------------------------------------ *
 * Seçici listeleri (pasif kayıt yalnız mevcut seçim olarak görünür)
 * ------------------------------------------------------------------ */

/**
 * Seçilebilir firmalar: aktif olanlar + (varsa) mevcut seçim pasif olsa da "(pasif)" etiketiyle.
 * @returns {Array<{id:string,name:string,label:string,inactive:boolean,company:object}>}
 */
export function selectableCompanies(companies, selectedId) {
  return (companies || [])
    .map((c) => ({ company: c, id: c.id || c.company_id, name: c.name || "", inactive: c.is_active === false }))
    .filter((o) => o.id && (!o.inactive || o.id === selectedId))
    .map((o) => ({ ...o, label: o.inactive ? `${o.name} (pasif)` : o.name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"));
}

export function selectableDepartments(departments, selectedId) {
  return (departments || [])
    .map((d) => ({ department: d, id: d.id || d.department_id, name: d.name || "", inactive: d.is_active === false }))
    .filter((o) => o.id && (!o.inactive || o.id === selectedId))
    .map((o) => ({ ...o, label: o.inactive ? `${o.name} (pasif)` : o.name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "tr"));
}

/** Ad aynı mı (büyük/küçük harf, Türkçe karakter ve boşluk duyarsız)? */
export function isDuplicateName(list, name, excludeId, idKey) {
  const key = normalizeSearch(name).replace(/\s+/g, " ").trim();
  if (!key) return false;
  return (list || []).some((item) => {
    const id = item.id || item[idKey || "department_id"];
    return id !== excludeId && normalizeSearch(item.name).replace(/\s+/g, " ").trim() === key;
  });
}

/** Modül/Destek türü kodu: yalnız A–Z, 0–9 ve alt çizgi (1–20) — Firebase anahtarı olarak güvenli. */
export function validateReferenceCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return { valid: false, code: c, error: "Kod zorunludur." };
  if (!/^[A-Z0-9_]{1,20}$/.test(c)) return { valid: false, code: c, error: "Kod yalnızca A–Z, 0–9 ve _ içerebilir (en çok 20 karakter; boşluk, nokta ve Türkçe karakter olmaz)." };
  return { valid: true, code: c, error: "" };
}

/* ------------------------------------------------------------------ *
 * Denormalize kopya planlayıcıları (YON-04/09, SEC-21)
 * Hepsi YALNIZ farklı olan kopyalar için `v2` köküne göre çok yollu güncelleme yolu üretir (idempotent).
 * Talep numarası (ticket_number) hiçbir zaman değişmez.
 * ------------------------------------------------------------------ */

const sameStr = (a, b) => String(a ?? "") === String(b ?? "");

function put(paths, path, current, desired) {
  if (!sameStr(current, desired)) paths[path] = desired;
}

/**
 * Firma adı/kodu kopyaları: users.company_name/customer_code, tickets.company_name/customer_code,
 * contracts.company_name, projects.company_name/customer_code.
 */
export function planCompanyCopies(company, related) {
  const paths = {};
  const r = related || {};
  const name = String(company?.name || "");
  const code = String(company?.customer_code || "").toUpperCase();
  for (const u of r.users || []) {
    const id = u.uid || u.id;
    put(paths, `users/${id}/company_name`, u.company_name, name);
    put(paths, `users/${id}/customer_code`, u.customer_code, code);
  }
  for (const t of r.tickets || []) {
    const id = t.ticket_id || t.id;
    put(paths, `tickets/${id}/company_name`, t.company_name, name);
    put(paths, `tickets/${id}/customer_code`, t.customer_code, code);
  }
  for (const c of r.contracts || []) {
    put(paths, `contracts/${c.contract_id || c.id}/company_name`, c.company_name, name);
  }
  for (const p of r.projects || []) {
    const id = p.project_id || p.id;
    put(paths, `projects/${id}/company_name`, p.company_name, name);
    put(paths, `projects/${id}/customer_code`, p.customer_code, code);
  }
  return paths;
}

export function personnelFullName(p) {
  return [p?.first_name, p?.last_name].filter(Boolean).join(" ");
}

/**
 * Personel adı/e-postası kopyaları:
 *  - ticket_assignments/<tid>/<pid>/personnel_name + personnel_email (pasif personelde e-posta BOŞALTILIR)
 *  - tickets/<tid>/assigned_to_name (birincil danışman)
 *  - projects: manager_name, assigned_personnel/<pid>/name
 * @param {object} person {personnel_id|id, first_name, last_name, email, is_active}
 * @param {{assignments?: Record<string, Array<object>>, tickets?: object[], projects?: object[]}} related
 */
export function planPersonnelCopies(person, related) {
  const paths = {};
  const r = related || {};
  const pid = person?.personnel_id || person?.id;
  const name = personnelFullName(person);
  const email = person?.is_active === false ? "" : String(person?.email || "").trim().toLowerCase();
  for (const [tid, list] of Object.entries(r.assignments || {})) {
    const rec = (list || []).find((a) => (a.personnel_id || a.id) === pid);
    if (!rec) continue;
    if (name) put(paths, `ticket_assignments/${tid}/${pid}/personnel_name`, rec.personnel_name, name);
    put(paths, `ticket_assignments/${tid}/${pid}/personnel_email`, String(rec.personnel_email || "").toLowerCase(), email);
  }
  for (const t of r.tickets || []) {
    if ((t.assigned_to_id || "") !== pid) continue;
    if (name) put(paths, `tickets/${t.ticket_id || t.id}/assigned_to_name`, t.assigned_to_name, name);
  }
  for (const p of r.projects || []) {
    const id = p.project_id || p.id;
    const isManager = p.manager_personnel_id === pid || (!p.manager_personnel_id && p.manager_uid === pid);
    if (isManager && name) put(paths, `projects/${id}/manager_name`, p.manager_name, name);
    const assigned = p.assigned_personnel && typeof p.assigned_personnel === "object" ? p.assigned_personnel[pid] : null;
    if (assigned && name) put(paths, `projects/${id}/assigned_personnel/${pid}/name`, assigned.name, name);
  }
  return paths;
}

/** Departman adı kopyası: personnel/<pid>/department_name. */
export function planDepartmentCopies(department, personnelList) {
  const paths = {};
  const id = department?.department_id || department?.id;
  for (const p of personnelList || []) {
    if ((p.department_id || "") !== id) continue;
    put(paths, `personnel/${p.personnel_id || p.id}/department_name`, p.department_name, department?.name || "");
  }
  return paths;
}

/** Kullanıcı adı kopyası: tickets/<id>/user_name (talebi açan kullanıcı). */
export function planUserNameCopies(uid, fullName, tickets) {
  const paths = {};
  const name = String(fullName || "").trim();
  if (!name) return paths;
  for (const t of tickets || []) {
    if ((t.user_id || "") !== uid) continue;
    put(paths, `tickets/${t.ticket_id || t.id}/user_name`, t.user_name, name);
  }
  return paths;
}

/** Çok yollu güncelleme nesnesini en çok `size` yollu parçalara böler. */
export function chunkPaths(paths, size) {
  const keys = Object.keys(paths || {});
  const n = Math.max(1, size || 300);
  const out = [];
  for (let i = 0; i < keys.length; i += n) {
    const chunk = {};
    for (const k of keys.slice(i, i + n)) chunk[k] = paths[k];
    out.push(chunk);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Hazır yanıt şablonları (WP-16)
 * ------------------------------------------------------------------ */

export const TEMPLATE_VARIABLES = [
  { key: "musteri_adi", label: "Müşteri (talep sahibi) adı", sample: "Ayşe Demir" },
  { key: "talep_no", label: "Talep numarası", sample: "SUP-ORN-FI-2610-0001" },
  { key: "danisman", label: "Yanıtı yazan personelin adı", sample: "Zeynep Arslan" },
];

export const TEMPLATE_LIMITS = { title: 200, body: 10000, category: 60 };

/** `{musteri_adi}` / `{talep_no}` / `{danisman}` değişkenlerini doldurur; bilinmeyen `{...}` olduğu gibi kalır. */
export function renderReplyTemplate(body, vars) {
  const v = vars || {};
  return String(body ?? "").replace(/\{\s*([a-z_]+)\s*\}/g, (whole, key) =>
    TEMPLATE_VARIABLES.some((t) => t.key === key) ? String(v[key] ?? "") : whole
  );
}

export function validateTemplateInput(input) {
  const errors = {};
  const title = String(input?.title || "").trim();
  const body = String(input?.body || "").trim();
  const category = String(input?.category || "").trim();
  if (!title) errors.title = "Başlık zorunludur.";
  else if (title.length > TEMPLATE_LIMITS.title) errors.title = `Başlık en fazla ${TEMPLATE_LIMITS.title} karakter olabilir.`;
  if (!body) errors.body = "Metin zorunludur.";
  else if (body.length > TEMPLATE_LIMITS.body) errors.body = `Metin en fazla ${TEMPLATE_LIMITS.body} karakter olabilir.`;
  if (category.length > TEMPLATE_LIMITS.category) errors.category = `Kategori en fazla ${TEMPLATE_LIMITS.category} karakter olabilir.`;
  let sortOrder = 0;
  const raw = input?.sort_order;
  if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100000 || !Number.isInteger(n)) errors.sort_order = "Sıra 0–100000 arasında tam sayı olmalıdır.";
    else sortOrder = n;
  }
  return { valid: Object.keys(errors).length === 0, errors, value: { title, body, category, sort_order: sortOrder } };
}

/** Şablonlar sıra numarasına, sonra başlığa (tr) göre; yalnız aktifler istenirse pasifler ayıklanır. */
export function sortTemplates(list, options) {
  const only = options?.onlyActive;
  return [...(list || [])]
    .filter((t) => !only || t.is_active !== false)
    .sort(
      (a, b) =>
        (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
        String(a.title || "").localeCompare(String(b.title || ""), "tr")
    );
}

/* ------------------------------------------------------------------ *
 * Atanmamış / sahipsiz açık talep (PER-21): pano ve liste AYNI tanımı kullanır
 * ------------------------------------------------------------------ */

/** Talebin tüm atananları: atama kayıtları; yoksa birincil danışman. */
export function ticketAssigneeIds(ticket, assignmentsByTicket) {
  const key = ticket?.ticket_id || ticket?.id;
  const list = assignmentsByTicket && assignmentsByTicket[key];
  const ids = list && list.length ? list.map((a) => a.personnel_id || a.id) : [];
  if (!ids.length && ticket?.assigned_to_id) ids.push(ticket.assigned_to_id);
  return ids;
}

/** Açık talep + (atanmamış ya da atandığı danışmanların hepsi pasif). `activeIds`: aktif personel kimlikleri kümesi. */
export function needsAssignee(ticket, assignmentsByTicket, activeIds) {
  if (!isOpenStatus(ticket?.status)) return false;
  const ids = ticketAssigneeIds(ticket, assignmentsByTicket);
  if (!ids.length) return true;
  return !!activeIds && !ids.some((pid) => activeIds.has(pid));
}

/* ------------------------------------------------------------------ *
 * Rapor tarih aralığı (PER-39)
 * ------------------------------------------------------------------ */

/**
 * @param {"week"|"month"|"3months"|"custom"} preset
 * @returns {{start: Date, end: Date, error: string}}
 */
export function resolveReportRange(preset, customFrom, customTo, now) {
  const n = now || new Date();
  const end = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59, 999);
  let start;
  let error = "";
  let rangeEnd = end;
  if (preset === "week") {
    const day = n.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start = new Date(n.getFullYear(), n.getMonth(), n.getDate() - diff);
  } else if (preset === "month") {
    start = new Date(n.getFullYear(), n.getMonth(), 1);
  } else if (preset === "3months") {
    start = startOfDay(addMonthsClamped(n, -3));
  } else {
    const from = customFrom ? parseDateOnly(customFrom) : null;
    const to = customTo ? parseDateOnly(customTo) : null;
    if (customFrom && !from) error = "Başlangıç tarihi geçersiz.";
    else if (customTo && !to) error = "Bitiş tarihi geçersiz.";
    else if (!customFrom || !customTo) error = "Özel aralık için başlangıç ve bitiş tarihlerini girin.";
    else if (to < from) error = "Bitiş tarihi başlangıç tarihinden önce olamaz.";
    start = from || new Date(0);
    if (to) rangeEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
  }
  return { start, end: rangeEnd, error };
}

/* ------------------------------------------------------------------ *
 * Toplu işlemler (WP-16)
 * ------------------------------------------------------------------ */

/** Toplu işlem yetkisi: super_admin, service_admin, project_manager (kurallardaki MANAGER). */
export function canBulkOperate(role) {
  return [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN, ROLES.PROJECT_MANAGER].includes(String(role || "").toLowerCase());
}

/** Toplu durum değişiminde müşteriye e-posta GİDEN durumlar (kota dostu: diğerleri bildirimsiz). */
export const BULK_NOTIFY_STATUSES = [STATUSES.RESOLVED, STATUSES.CLOSED];
/** Bir toplu işlemde gönderilecek en çok müşteri e-postası. */
export const BULK_NOTIFY_LIMIT = 25;
/** Toplu işlemde bir kerede seçilebilecek en çok talep (güvenlik sınırı). */
export const BULK_MAX_TICKETS = 300;

const ticketId = (t) => t?.ticket_id || t?.id;

/**
 * Toplu durum planı: izinli geçiş matrisine uyanlar `eligible`, diğerleri sebebiyle birlikte `skipped`.
 * Aynı durumdaki talepler de atlanır ("zaten ... durumunda").
 * @param {object[]} tickets
 * @param {string} target hedef durum kodu
 * @param {{role?: string}} ctx
 */
export function planBulkStatus(tickets, target, ctx) {
  const to = String(target || "").toLowerCase();
  const eligible = [];
  const skipped = [];
  for (const t of tickets || []) {
    const from = String(t.status || "open").toLowerCase();
    if (t.is_deleted === true) {
      skipped.push({ ticket: t, reason: "Arşivde (silinmiş) talep" });
    } else if (from === to) {
      skipped.push({ ticket: t, reason: `Zaten «${STATUS_LABELS[to] || to}» durumunda` });
    } else if (!isTransitionAllowed(from, to, { role: ctx?.role, actor: "staff", hasAssignee: !!t.assigned_to_id })) {
      skipped.push({ ticket: t, reason: `«${STATUS_LABELS[from] || from}» → «${STATUS_LABELS[to] || to}» geçişine izin yok` });
    } else {
      eligible.push(t);
    }
  }
  return { eligible, skipped };
}

/**
 * Toplu atama planı. `mode`: "primary" (seçilen danışman birincil olur, mevcut danışmanlar ikincil kalır) ya da
 * "replace" (yalnızca seçilen danışman kalır). Kapalı/çözülmüş/arşiv talepler ve zaten istenen durumdaki talepler atlanır.
 * @param {object[]} tickets
 * @param {object} person seçilen personel {personnel_id|id, first_name, last_name, email, uid}
 * @param {"primary"|"replace"} mode
 * @param {Record<string, Array<object>>} assignmentsByTicket
 * @param {object[]} [personnelList] mevcut atananların adı/e-postası/uid'i için
 * @returns {{eligible: Array<{ticket: object, assignments: object[]}>, skipped: Array<{ticket: object, reason: string}>}}
 */
export function planBulkAssign(tickets, person, mode, assignmentsByTicket, personnelList) {
  const pid = person?.personnel_id || person?.id;
  const byPid = new Map((personnelList || []).map((p) => [p.personnel_id || p.id, p]));
  const entry = (id, isPrimary, rec) => {
    const p = byPid.get(id) || (id === pid ? person : null);
    return {
      personnel_id: id,
      personnel_name: personnelFullName(p) || rec?.personnel_name || "",
      personnel_email: String(p?.email || rec?.personnel_email || "").trim().toLowerCase(),
      personnel_uid: p?.uid || "",
      is_primary: isPrimary,
    };
  };
  const eligible = [];
  const skipped = [];
  for (const t of tickets || []) {
    const status = String(t.status || "open").toLowerCase();
    if (t.is_deleted === true) {
      skipped.push({ ticket: t, reason: "Arşivde (silinmiş) talep" });
      continue;
    }
    if (!isOpenStatus(status)) {
      skipped.push({ ticket: t, reason: `«${STATUS_LABELS[status] || status}» talebe atama yapılmaz` });
      continue;
    }
    const current = (assignmentsByTicket && assignmentsByTicket[ticketId(t)]) || [];
    const currentList = current.length
      ? current.map((a) => ({ id: a.personnel_id || a.id, rec: a }))
      : t.assigned_to_id
        ? [{ id: t.assigned_to_id, rec: { personnel_name: t.assigned_to_name } }]
        : [];
    const currentPrimary = (current.find((a) => a.is_primary) || {}).personnel_id || t.assigned_to_id || (currentList[0] && currentList[0].id) || "";
    if (mode === "replace") {
      if (currentList.length === 1 && currentList[0].id === pid) {
        skipped.push({ ticket: t, reason: "Zaten yalnızca bu danışmana atanmış" });
        continue;
      }
      eligible.push({ ticket: t, assignments: [entry(pid, true)] });
      continue;
    }
    if (currentPrimary === pid) {
      skipped.push({ ticket: t, reason: "Bu danışman zaten birincil" });
      continue;
    }
    const others = currentList.filter((c) => c.id !== pid).map((c) => entry(c.id, false, c.rec));
    eligible.push({ ticket: t, assignments: [entry(pid, true), ...others] });
  }
  return { eligible, skipped };
}

/** Atlananların özeti: ilk `max` satır + "+N daha". */
export function describeSkipped(skipped, max) {
  const m = max || 10;
  const lines = (skipped || []).slice(0, m).map((s) => `${s.ticket?.ticket_number || ticketId(s.ticket) || "—"}: ${s.reason}`);
  if ((skipped || []).length > m) lines.push(`… ve ${(skipped || []).length - m} talep daha`);
  return lines;
}
