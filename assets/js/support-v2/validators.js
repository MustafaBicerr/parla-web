/**
 * Parla BT Ticket V2 — form doğrulama (Türkçe hata mesajları)
 */

import { ROLES, TICKET_TYPES, PRIORITIES, SAP_MODULES } from "./ticket-utils.js";

const MIN_PASSWORD_LENGTH = 8;

export function email(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function phone(value) {
  const v = String(value || "").replace(/[\s()-]/g, "");
  if (v.startsWith("+")) {
    return v.length >= 11 && /^\+[\d]+$/.test(v);
  }
  return v.length >= 10 && /^[\d]+$/.test(v);
}

export function password(value) {
  const v = String(value || "");
  if (v.length < MIN_PASSWORD_LENGTH) return false;
  if (!/[A-Z]/.test(v)) return false;
  if (!/[0-9]/.test(v)) return false;
  return true;
}

export function required(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return !Number.isNaN(value);
  return String(value).trim().length > 0;
}

export function url(value) {
  if (!required(value)) return true;
  try {
    const u = new URL(String(value).trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function minLength(value, min) {
  return String(value || "").trim().length >= (min || 0);
}

function fieldError(errors, field, message) {
  errors[field] = message;
}

/**
 * @returns {{ valid: boolean, errors: Record<string, string> }}
 */
export function validateUserForm(data) {
  const errors = {};
  const d = data || {};

  if (!required(d.first_name)) {
    fieldError(errors, "first_name", "Ad alanı zorunludur.");
  }

  if (!required(d.last_name)) {
    fieldError(errors, "last_name", "Soyad alanı zorunludur.");
  }

  if (!required(d.email)) {
    fieldError(errors, "email", "E-posta adresi zorunludur.");
  } else if (!email(d.email)) {
    fieldError(errors, "email", "Geçerli bir e-posta adresi giriniz.");
  }

  if (!required(d.phone)) {
    fieldError(errors, "phone", "Telefon numarası zorunludur.");
  } else if (!phone(d.phone)) {
    fieldError(errors, "phone", "Geçerli bir telefon numarası giriniz (en az 10 hane).");
  }

  if (!required(d.role)) {
    fieldError(errors, "role", "Kullanıcı rolü seçiniz.");
  } else {
    const validRoles = Object.values(ROLES);
    if (!validRoles.includes(d.role)) {
      fieldError(errors, "role", "Geçersiz kullanıcı rolü.");
    }
  }

  if (
    (d.role === ROLES.CUSTOMER || d.role === ROLES.ARIZI_CUSTOMER) &&
    !required(d.company_id)
  ) {
    fieldError(errors, "company_id", "Müşteri kullanıcıları için firma seçimi zorunludur.");
  }

  if (d.temp_password !== undefined && d.temp_password !== null && d.temp_password !== "") {
    if (!password(d.temp_password)) {
      fieldError(
        errors,
        "temp_password",
        "Şifre en az 8 karakter, 1 büyük harf ve 1 rakam içermelidir."
      );
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * @returns {{ valid: boolean, errors: Record<string, string> }}
 */
export function validateTicketForm(data) {
  const errors = {};
  const d = data || {};

  const validTypes = Object.values(TICKET_TYPES);
  if (!required(d.ticket_type)) {
    fieldError(errors, "ticket_type", "Talep tipi seçiniz.");
  } else if (!validTypes.includes(String(d.ticket_type).toUpperCase())) {
    fieldError(errors, "ticket_type", "Geçersiz talep tipi.");
  }

  const validPriorities = Object.values(PRIORITIES);
  if (!required(d.priority)) {
    fieldError(errors, "priority", "Öncelik seçiniz.");
  } else if (!validPriorities.includes(String(d.priority).toLowerCase())) {
    fieldError(errors, "priority", "Geçersiz öncelik değeri.");
  }

  if (!required(d.sap_module)) {
    fieldError(errors, "sap_module", "SAP modülü seçiniz.");
  } else if (!SAP_MODULES.includes(d.sap_module)) {
    fieldError(errors, "sap_module", "Geçersiz SAP modülü.");
  }

  if (!required(d.title)) {
    fieldError(errors, "title", "Talep başlığını giriniz.");
  } else if (!minLength(d.title, 5)) {
    fieldError(errors, "title", "Talep başlığını giriniz (en az 5 karakter).");
  } else if (String(d.title).length > 100) {
    fieldError(errors, "title", "Talep başlığı en fazla 100 karakter olabilir.");
  }

  if (!required(d.description)) {
    fieldError(errors, "description", "Açıklama alanı zorunludur.");
  } else if (!minLength(d.description, 20)) {
    fieldError(
      errors,
      "description",
      "Açıklamanızı daha ayrıntılı yazın (en az 20 karakter). Sorunun adımlarını ve beklentinizi belirtin."
    );
  }

  if (d.attachment_url && !url(d.attachment_url)) {
    fieldError(
      errors,
      "attachment_url",
      "Geçerli bir URL giriniz (http veya https ile başlamalı)."
    );
  }

  if (d.status_note !== undefined && d.status_note !== null && d.status_note !== "") {
    if (!minLength(d.status_note, 10)) {
      fieldError(
        errors,
        "status_note",
        "Statü değişiklik notu en az 10 karakter olmalıdır."
      );
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * @returns {{ valid: boolean, errors: Record<string, string> }}
 */
export function validatePersonnelForm(data) {
  const errors = {};
  const d = data || {};

  if (!required(d.first_name)) {
    fieldError(errors, "first_name", "Ad alanı zorunludur.");
  }

  if (!required(d.last_name)) {
    fieldError(errors, "last_name", "Soyad alanı zorunludur.");
  }

  if (!required(d.email)) {
    fieldError(errors, "email", "E-posta adresi zorunludur.");
  } else if (!email(d.email)) {
    fieldError(errors, "email", "Geçerli bir e-posta adresi giriniz.");
  }

  if (d.phone && !phone(d.phone)) {
    fieldError(errors, "phone", "Geçerli bir telefon numarası giriniz.");
  }

  if (!required(d.department_id)) {
    fieldError(errors, "department_id", "Departman seçiniz.");
  }

  if (!required(d.role_title)) {
    fieldError(errors, "role_title", "Rol ünvanı giriniz (ör. Danışman, IT Uzmanı).");
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * @returns {{ valid: boolean, errors: Record<string, string> }}
 */
export function validateCompanyForm(data) {
  const errors = {};
  const d = data || {};

  if (!required(d.name)) {
    fieldError(errors, "name", "Firma adı zorunludur.");
  } else if (!minLength(d.name, 2)) {
    fieldError(errors, "name", "Firma adı en az 2 karakter olmalıdır.");
  }

  if (!required(d.customer_code)) {
    fieldError(errors, "customer_code", "Müşteri kodu zorunludur.");
  } else if (!/^[A-Z]{3}\d{4}$/.test(String(d.customer_code).toUpperCase())) {
    fieldError(errors, "customer_code", "Müşteri kodu CUS0001 formatında olmalıdır.");
  }

  if (!required(d.customer_type)) {
    fieldError(errors, "customer_type", "Müşteri tipi seçiniz.");
  } else if (!["CUS", "ARC"].includes(String(d.customer_type).toUpperCase())) {
    fieldError(errors, "customer_type", "Müşteri tipi CUS veya ARC olmalıdır.");
  }

  if (d.primary_contact_email && !email(d.primary_contact_email)) {
    fieldError(errors, "primary_contact_email", "Geçerli bir e-posta adresi giriniz.");
  }

  if (d.phone && !phone(d.phone)) {
    fieldError(errors, "phone", "Geçerli bir telefon numarası giriniz.");
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
