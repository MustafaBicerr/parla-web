/**
 * Parla BT Ticket V2 — aktivite günlüğü etiketleri (Türkçe; Aktiviteler sayfası ve pano ortak kullanır).
 * Tüm yardımcılar zehirli kayda dayanıklıdır: değer dize değilse boş dizeye çevrilir (SEC-02, PER-30, UX-14).
 */
import { safeText } from "./safe-utils.js";

export const ACTION_LABELS = {
  created: "Oluşturuldu",
  updated: "Güncellendi",
  deleted: "Silindi",
  status_changed: "Durum Değişti",
  assigned: "Atandı",
  login: "Giriş",
  ticket_created: "Talep Oluşturuldu",
  ticket_updated: "Talep Güncellendi",
  ticket_assigned: "Talep Atandı",
  ticket_deleted: "Talep Silindi",
  ticket_restored: "Talep Geri Yüklendi",
  ticket_permanently_deleted: "Talep Kalıcı Silindi",
  ticket_closed: "Talep Kapatıldı",
  ticket_reopened: "Talep Yeniden Açıldı",
  ticket_message: "Yeni Mesaj",
  user_created: "Kullanıcı Oluşturuldu",
  user_updated: "Kullanıcı Güncellendi",
  user_deactivated: "Kullanıcı Pasife Alındı",
  user_activated: "Kullanıcı Aktifleştirildi",
  user_repaired: "Yetim Hesap Onarıldı",
  user_password_reset: "Şifre Belirleme Bağlantısı Gönderildi",
  ticket_auto_closed: "Talep Otomatik Kapatıldı",
  company_created: "Firma Oluşturuldu",
  company_updated: "Firma Güncellendi",
  company_deactivated: "Firma Pasife Alındı",
  company_activated: "Firma Aktifleştirildi",
  personnel_created: "Danışman Oluşturuldu",
  personnel_updated: "Danışman Güncellendi",
  personnel_deactivated: "Danışman Pasife Alındı",
  personnel_activated: "Danışman Aktifleştirildi",
  email_failed: "E-posta Gönderilemedi",
  ticket_bulk_assigned: "Toplu Atama",
  ticket_bulk_status: "Toplu Durum Değişikliği",
};

export const ENTITY_LABELS = {
  ticket: "Talep",
  user: "Kullanıcı",
  company: "Firma",
  contract: "Sözleşme",
  project: "Proje",
  personnel: "Danışman",
  department: "Departman",
  sap_module: "Modül",
  support_type: "Destek Türü",
  reply_template: "Hazır Yanıt",
  bulk: "Toplu İşlem",
};

/** Bilinmeyen kodlar ham `snake_case` yerine okunur biçimde ("some_event" → "Some event"). */
function humanize(code) {
  const t = code.replace(/_+/g, " ").trim();
  return t ? t.charAt(0).toLocaleUpperCase("tr") + t.slice(1) : "";
}

export function formatActivityAction(action) {
  const code = safeText(action);
  if (!code) return "—";
  return Object.prototype.hasOwnProperty.call(ACTION_LABELS, code) ? ACTION_LABELS[code] : humanize(code);
}

export function formatActivityEntity(type) {
  const code = safeText(type);
  if (!code) return "—";
  return Object.prototype.hasOwnProperty.call(ENTITY_LABELS, code) ? ENTITY_LABELS[code] : humanize(code);
}

/** Silme eylemi mi (varlık artık yok; bağlantı verilmez, "tehlike" stili). */
export function isDeleteAction(action) {
  const code = safeText(action);
  return code === "deleted" || code.endsWith("_deleted");
}

/** Pano akışı için tek satır özet: "Etiket: varlık — ayrıntı". */
export function describeActivity(activity) {
  const a = activity || {};
  const label = safeText(a.entity_label) || safeText(a.entity_id);
  const details = safeText(a.details);
  const prefix = formatActivityAction(a.action);
  return details ? `${prefix}: ${label} — ${details}` : `${prefix}: ${label}`;
}

/** Pano simgesi (yalnız sabit sınıf adları döner). */
export function activityIconClass(action) {
  const code = safeText(action);
  if (code.includes("ticket")) return "fa-ticket-alt";
  if (code.includes("user")) return "fa-user";
  if (code.includes("company")) return "fa-building";
  if (code.includes("personnel")) return "fa-user-tie";
  return "fa-circle";
}
