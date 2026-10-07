/**
 * Alıcı çözümleme (sunucu tarafı): talep sahibi, atanmış danışmanlar, Destek Atayıcılar.
 *
 * `db` arayüzü: `get(path, query?) -> değer | null` (erişim reddi/yoksa null döner).
 *  - Zamanlanmış işlevler/admin-users: servis hesabı (kuralları atlar) → `admin.db`.
 *  - send-email: çağıranın token'ı → `tokenDb(token)` (kurallar geçerli; erişilemeyen düğüm null).
 *
 * Kurallar:
 *  - Talep sahibinin adresi KULLANICI PROFİLİNDEN gelir (`ticket.user_email` müşteri kontrollüdür; yalnızca profil yoksa güvenilmez → boş).
 *  - Danışman adresi `personnel/<id>` kaydından (güncel); atama kaydındaki kopya (`personnel_email`) yedek. Pasif personel atlanır.
 *  - Atama kaydı yoksa `assigned_to_id` yedeği kullanılır (EML-16).
 *  - "Destek Atayıcı" = aktif `service_admin` kullanıcıları (yoksa aktif `super_admin`).
 */
const { rtdbGet } = require("./firebase-auth");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function normEmail(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function validEmail(email) {
  return email.length > 0 && email.length <= 254 && EMAIL_RE.test(email);
}

/** Kullanıcının token'ıyla okuyan `db` (reddedilen düğüm → null; ağ/5xx hatası yukarı fırlar). */
function tokenDb(token, fetchImpl) {
  return {
    async get(path, query) {
      const q = {};
      if (query) {
        if (query.orderBy) q.orderBy = JSON.stringify(query.orderBy);
        if (query.equalTo !== undefined) q.equalTo = JSON.stringify(query.equalTo);
        if (query.limitToLast) q.limitToLast = query.limitToLast;
        if (query.shallow) q.shallow = "true";
      }
      try {
        return await rtdbGet(path, token, { query: q, fetchImpl });
      } catch (err) {
        if (err && err.code === "db_denied") return null;
        throw err;
      }
    },
  };
}

/** `primary.get` hata verirse (ağ/yetki) `secondary.get`'e düşer: Admin yapılandırılmamış/arızalıysa çağıranın token'ıyla okunur. */
function withFallback(primary, secondary) {
  if (!primary) return secondary;
  return {
    async get(path, query) {
      try {
        return await primary.get(path, query);
      } catch {
        return secondary.get(path, query);
      }
    },
  };
}

/** @param {{get: Function}} db */
function createResolver(db) {
  let personnelCache = null;
  let assignersCache = null;
  const userCache = new Map();

  async function personnelMap() {
    if (!personnelCache) {
      const all = await db.get("v2/personnel");
      personnelCache = all && typeof all === "object" ? all : {};
    }
    return personnelCache;
  }

  async function userProfile(uid) {
    if (!uid) return null;
    if (!userCache.has(uid)) userCache.set(uid, await db.get(`v2/users/${uid}`));
    return userCache.get(uid);
  }

  return {
    /** Talep sahibinin adresi (profil); yoksa/geçersizse "". */
    async owner(ticket) {
      const profile = await userProfile(ticket && ticket.user_id);
      const email = normEmail(profile && profile.email);
      if (profile && profile.is_active !== false && validEmail(email)) return email;
      return "";
    },

    /**
     * Atanmış danışmanlar: [{ pid, name, email, uid, primary }] — e-postası geçerli ve aktif olanlar.
     * `ticket_assignments/<id>` yoksa `assigned_to_id` yedeği.
     */
    async assigned(ticketId, ticket) {
      const records = (await db.get(`v2/ticket_assignments/${ticketId}`)) || {};
      let list = Object.entries(records)
        .filter(([, r]) => r && typeof r === "object")
        .map(([pid, r]) => ({ pid: r.personnel_id || pid, rec: r, primary: r.is_primary === true }));
      if (!list.length && ticket && ticket.assigned_to_id) {
        list = [{ pid: String(ticket.assigned_to_id), rec: { personnel_name: ticket.assigned_to_name || "" }, primary: true }];
      }
      if (!list.length) return [];
      const people = await personnelMap();
      const seen = new Set();
      const out = [];
      for (const item of list) {
        const p = people[item.pid] || null;
        if (p && p.is_active === false) continue;
        const email = normEmail((p && p.email) || item.rec.personnel_email);
        if (!validEmail(email) || seen.has(email)) continue;
        seen.add(email);
        const name = (p && [p.first_name, p.last_name].filter(Boolean).join(" ")) || item.rec.personnel_name || "";
        out.push({
          pid: item.pid,
          name,
          email,
          // Atama kaydındaki (eskiyebilen) kopya adres: eski adrese yönelen istekler güncel adrese eşlenir (YON-04).
          recordEmail: normEmail(item.rec.personnel_email),
          uid: (p && p.uid) || item.rec.personnel_uid || "",
          primary: item.primary,
        });
      }
      return out;
    },

    /** Destek Atayıcı adresleri (aktif service_admin; yoksa aktif super_admin). */
    async assigners() {
      if (assignersCache) return assignersCache;
      const byRole = async (role) => {
        const users = await db.get("v2/users", { orderBy: "role", equalTo: role });
        return Object.values(users && typeof users === "object" ? users : {})
          .filter((u) => u && u.role === role && u.is_active !== false) // sorgu yok sayılsa da rolü yeniden süz
          .map((u) => normEmail(u.email))
          .filter(validEmail);
      };
      let emails = await byRole("service_admin");
      if (!emails.length) emails = await byRole("super_admin");
      assignersCache = [...new Set(emails)];
      return assignersCache;
    },

    /** Personel kayıtları (pid → kayıt); yönetim amaçlı. */
    personnelMap,
  };
}

module.exports = { createResolver, tokenDb, withFallback, normEmail, validEmail };
