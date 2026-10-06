/**
 * Parla BT Ticket V2 — sayfa bazlı erişim kontrolü.
 *
 * `requirePage(anahtar, seçenekler)` oturumu doğrular (requireAuth) ve sayfaya özel rol
 * kısıtını uygular. Rol kısıtları database.rules.json ile uyumlu tutulmalıdır: bir sayfa
 * yalnızca kuralların okumaya izin verdiği roller için açılır.
 */
import { requireAuth } from "./auth-guard.js";
import { ROLES } from "./ticket-utils.js";

/** Sayfa anahtarı -> izin verilen roller (tanımsız sayfalar yalnızca requireAuth seçeneklerine tabidir). */
export const PAGE_ROLES = {
  // Kullanıcı listesi (v2/users) yalnızca bu roller tarafından okunabilir.
  adminUsers: [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN],
};

export async function requirePage(pageKey, options) {
  const roles = PAGE_ROLES[pageKey];
  return requireAuth({ ...(options || {}), ...(roles ? { roles } : {}) });
}

/**
 * Alan bazlı yazma yetkisi (database.rules.json ile aynı): yalnızca arayüzde gereksiz düğmeleri gizler;
 * asıl yetkilendirme kurallardadır.
 *  - admin:   firma, personel, sözleşme  -> super_admin, service_admin
 *  - project: proje                      -> super_admin, service_admin, project_manager
 *  - super:   departman, modül, destek türü -> super_admin
 */
const WRITE_ROLES = {
  admin: [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN],
  project: [ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN, ROLES.PROJECT_MANAGER],
  super: [ROLES.SUPER_ADMIN],
};

export function canWrite(session, area) {
  const role = String(session?.role || "").toLowerCase();
  return (WRITE_ROLES[area] || []).includes(role);
}
