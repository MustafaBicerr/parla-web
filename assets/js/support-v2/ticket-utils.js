/**
 * Parla BT Ticket V2 — sabitler ve yardımcı fonksiyonlar
 */

export const ROLES = {
  SUPER_ADMIN: "super_admin",
  SERVICE_ADMIN: "service_admin",
  PROJECT_MANAGER: "project_manager",
  CONSULTANT: "consultant",
  CUSTOMER: "customer",
  ARIZI_CUSTOMER: "arizi_customer",
};

export const ROLE_LABELS = {
  super_admin: "Süper Admin",
  service_admin: "Destek Atayıcı",
  project_manager: "Proje Yöneticisi",
  consultant: "Danışman",
  customer: "Müşteri Kullanıcısı",
  arizi_customer: "Arızi Müşteri",
};

export const ADMIN_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.SERVICE_ADMIN,
  ROLES.PROJECT_MANAGER,
  ROLES.CONSULTANT,
];

export const CUSTOMER_ROLES = [ROLES.CUSTOMER, ROLES.ARIZI_CUSTOMER];

export const TICKET_TYPES = {
  SUP: "SUP",
  ARZ: "ARZ",
  PRJ: "PRJ",
  INT: "INT",
  DEV: "DEV",
  BUG: "BUG",
};

export const TICKET_TYPE_LABELS = {
  SUP: "Destek Anlaşmalı Talep",
  ARZ: "Arızi Talep",
  PRJ: "Proje Taskı",
  INT: "İç Task",
  DEV: "Geliştirme Taskı",
  BUG: "Hata / Problem Kaydı",
};

export const PRIORITIES = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

export const PRIORITY_LABELS = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};

export const STATUSES = {
  OPEN: "open",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  WAITING_CUSTOMER: "waiting_customer",
  RESOLVED: "resolved",
  CLOSED: "closed",
};

export const STATUS_LABELS = {
  open: "Açık",
  assigned: "Atandı",
  in_progress: "İşlemde",
  waiting_customer: "Müşteri Bekleniyor",
  resolved: "Çözüldü",
  closed: "Kapandı",
};

export function isOpenStatus(status) {
  const s = String(status || "").toLowerCase();
  return s !== "closed" && s !== "resolved";
}

export const SAP_MODULES = [
  "FI",
  "CO",
  "MM",
  "SD",
  "PP",
  "WM",
  "HR",
  "BASIS",
  "ABAP",
  "Diğer",
];

export const SAP_MODULE_LABELS = {
  FI: "Finansal Muhasebe",
  CO: "Yönetim Muhasebesi",
  MM: "Malzeme Yönetimi",
  SD: "Satış ve Dağıtım",
  PP: "Üretim Planlama",
  WM: "Depo Yönetimi",
  HR: "İnsan Kaynakları",
  BASIS: "Sistem Yönetimi",
  ABAP: "Geliştirme",
  Diğer: "Diğer",
};

export const CUSTOMER_TYPES = {
  CUS: "Destek Anlaşmalı Müşteri",
  ARC: "Arızi Müşteri",
};

const TEMP_PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

/**
 * YYMM formatında ay/yıl (ör. 2605 = Mayıs 2026)
 */
export function getYymm(date) {
  const d = date instanceof Date ? date : new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return yy + mm;
}

/**
 * Ticket numarası üretir: {TIP}-{MÜŞTERİ}-{MODÜL}-{YYMM}-{SIRA}
 */
export async function generateTicketNumber(dbApi, type, customerCode, module) {
  if (!dbApi || !dbApi.ref || !dbApi.runTransaction) {
    throw new Error("Firebase veritabanı API'si kullanılamıyor.");
  }

  const ticketType = String(type || "").toUpperCase();
  const code = String(customerCode || "").toUpperCase();
  const mod = String(module || "Diğer").toUpperCase();
  const yymm = getYymm();

  if (!ticketType || !code) {
    throw new Error("Ticket tipi ve müşteri kodu zorunludur.");
  }

  const fb = window.__PARLA_FIREBASE;
  if (!fb || !fb.database) {
    throw new Error("Firebase henüz başlatılmadı.");
  }

  const counterPath = `v2/counters/${ticketType}/${code}/${yymm}`;
  const counterRef = dbApi.ref(fb.database, counterPath);

  const result = await dbApi.runTransaction(counterRef, (current) => {
    if (current === null || current === undefined) {
      return 1;
    }
    const num = typeof current === "number" ? current : parseInt(current, 10);
    return (Number.isNaN(num) ? 0 : num) + 1;
  });

  if (!result.committed) {
    throw new Error("Ticket numarası üretilemedi. Lütfen tekrar deneyin.");
  }

  const sequence = result.snapshot.val();
  const padded = String(sequence).padStart(4, "0");
  return `${ticketType}-${code}-${mod}-${yymm}-${padded}`;
}

export function formatTicketTypeLabel(code) {
  const key = String(code || "").toUpperCase();
  const label = TICKET_TYPE_LABELS[key];
  return label ? `${key} — ${label}` : key || "—";
}

export function formatPriorityLabel(priority) {
  const key = String(priority || "").toLowerCase();
  return PRIORITY_LABELS[key] || priority || "—";
}

export function formatStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  return STATUS_LABELS[key] || status || "—";
}

export function formatSapModuleLabel(code) {
  const key = String(code || "");
  const label = SAP_MODULE_LABELS[key];
  return label ? `${key} — ${label}` : key || "—";
}

export function formatRoleLabel(role) {
  const key = String(role || "").toLowerCase();
  return ROLE_LABELS[key] || role || "—";
}

/** Firebase RTDB tickets/{key} — her zaman snapshot push key (id) kullan */
export function getTicketKey(ticketOrId) {
  if (!ticketOrId) return "";
  if (typeof ticketOrId === "string") return ticketOrId;
  return ticketOrId.id || ticketOrId.ticket_id || "";
}

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(String(role || "").toLowerCase());
}

export function isCustomerRole(role) {
  return CUSTOMER_ROLES.includes(String(role || "").toLowerCase());
}

/**
 * 12 karakterlik geçici şifre (büyük harf, küçük harf, rakam içerir)
 */
export function generateTempPassword(length) {
  const len = length || 12;
  const chars = TEMP_PASSWORD_CHARS;
  let password = "";

  password += "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)];
  password += "abcdefghijkmnopqrstuvwxyz"[Math.floor(Math.random() * 24)];
  password += "23456789"[Math.floor(Math.random() * 8)];

  for (let i = password.length; i < len; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }

  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

export function nowIso() {
  return new Date().toISOString();
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
