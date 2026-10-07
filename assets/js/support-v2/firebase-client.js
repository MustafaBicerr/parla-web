/**
 * Parla BT Ticket V2 — Firebase Realtime Database istemcisi
 */
import {
  nowIso,
  generateTicketNumber,
  getTicketKey,
  isCustomerRole,
  isAdminRole,
  isDeletedTicket,
  isTransitionAllowed,
  computeStatusStamps,
  buildSlaPatch,
  validateEffortInput,
  istanbulDateISO,
  formatStatusLabel,
  formatPriorityLabel,
  normalizeStatusCode,
  findPersonnelForSession,
  SLA_PAUSING_STATUSES,
  OPEN_STATUSES,
} from "./ticket-utils.js";
import {
  planCompanyCopies,
  planPersonnelCopies,
  planDepartmentCopies,
  planUserNameCopies,
  chunkPaths,
  summarizeContracts,
  personnelFullName,
  cleanManagerName,
} from "./entity-utils.js";

const V2_PREFIX = "v2";

function getFirebase() {
  const fb = window.__PARLA_FIREBASE;
  if (!fb || !fb.database || !fb.db) {
    throw new Error("Firebase henüz başlatılmadı.");
  }
  return fb;
}

function v2Ref(path) {
  const fb = getFirebase();
  const clean = String(path || "").replace(/^\/+/, "");
  const fullPath = clean.startsWith(`${V2_PREFIX}/`) ? clean : `${V2_PREFIX}/${clean}`;
  return fb.db.ref(fb.database, fullPath);
}

/** Kod taşıyan anlaşılır hata (arayüz iletiyi olduğu gibi gösterir; kod ayrım için kullanılır). */
function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** `v2` kökü: çok yollu (atomik) güncellemeler bu referansa göre yazılır. */
function rootV2Ref() {
  const fb = getFirebase();
  return fb.db.ref(fb.database, V2_PREFIX);
}

/** Yeni bir alt kayıt anahtarı üretir (ağ çağrısı yok). */
function newChildKey(path) {
  const fb = getFirebase();
  return fb.db.push(v2Ref(path)).key;
}

const lc = (v) => String(v || "").toLowerCase();

/** İzin hatası mı (kural reddi)? */
function isPermissionDenied(err) {
  return /permission[_ ]denied|permission/i.test(String(err?.code || "") + " " + String(err?.message || ""));
}

function snapshotToArray(snapshot) {
  if (!snapshot || !snapshot.exists()) return [];
  const val = snapshot.val();
  if (!val || typeof val !== "object") return [];
  // SEC-07: DB anahtarı her zaman esastır; kayıt içindeki `id` alanı (kullanıcı kontrollü) anahtarı ezemez.
  return Object.keys(val).map((key) => {
    const item = val[key];
    if (item && typeof item === "object") {
      return { ...item, id: key };
    }
    return { value: item, id: key };
  });
}

/** İndeksli alan sorgusu (orderByChild + equalTo): { ...kayıt, id } dizisi. Silinmiş talepler dahil HAM sonuç. */
async function queryByChild(path, field, value) {
  const fb = getFirebase();
  const q = fb.db.query(v2Ref(path), fb.db.orderByChild(field), fb.db.equalTo(value));
  return snapshotToArray(await fb.db.get(q));
}

/** Yazım yollarını en çok 300'lük parçalara bölüp sırayla `v2` köküne yazar. @returns {number} yazılan yol sayısı */
async function commitPaths(paths) {
  const fb = getFirebase();
  const chunks = chunkPaths(paths, 300);
  for (const chunk of chunks) await fb.db.update(rootV2Ref(), chunk);
  return Object.keys(paths).length;
}

function actorFields(actor) {
  const uid = actor?.uid || actor?.user_uid || "";
  const name =
    actor?.name ||
    actor?.user_name ||
    [actor?.first_name, actor?.last_name].filter(Boolean).join(" ") ||
    "";
  return {
    created_by: uid,
    updated_by: uid,
    created_by_name: name,
    updated_by_name: name,
  };
}

function waitForFirebase(timeoutMs) {
  const maxWait = timeoutMs || 15000;
  return new Promise((resolve, reject) => {
    if (window.__PARLA_FIREBASE?.database) {
      resolve(window.__PARLA_FIREBASE);
      return;
    }

    const start = Date.now();
    const timer = setInterval(() => {
      if (window.__PARLA_FIREBASE?.database) {
        clearInterval(timer);
        resolve(window.__PARLA_FIREBASE);
      } else if (Date.now() - start > maxWait) {
        clearInterval(timer);
        reject(new Error("Firebase başlatılamadı. Sayfayı yenileyin."));
      }
    }, 50);
  });
}

async function pushWithId(collectionPath, data) {
  const fb = getFirebase();
  const listRef = v2Ref(collectionPath);
  const newRef = fb.db.push(listRef);
  const id = newRef.key;
  const payload = {
    ...data,
    created_at: data.created_at || nowIso(),
    updated_at: data.updated_at || nowIso(),
  };
  await fb.db.set(newRef, payload);
  return { id, ...payload };
}

const PERMANENT_DELETE_NODES = [
  "tickets",
  "ticket_messages",
  "ticket_internal_notes",
  "ticket_attachments",
  "ticket_internal_attachments",
  "ticket_history",
  "ticket_assignments",
  "ticket_efforts",
];

const STAFF_USER_ROLES = ["super_admin", "service_admin", "project_manager", "consultant"];

/** Aktivite/geçmiş özeti: "Durum: İşlemde → Kapanış Onayı Bekliyor; Öncelik: …". */
function summarizeEntries(entries) {
  const parts = [];
  for (const e of entries || []) {
    if (e.field_changed === "status") parts.push(`Durum: ${formatStatusLabel(e.old_value)} → ${formatStatusLabel(e.new_value)}`);
    else if (e.field_changed === "priority") parts.push(`Öncelik: ${formatPriorityLabel(e.old_value)} → ${formatPriorityLabel(e.new_value)}`);
    else if (e.field_changed === "ticket_type") parts.push(`Tip: ${e.old_value || "—"} → ${e.new_value || "—"}`);
    else if (e.field_changed === "assigned_to_name") parts.push(`Danışman: ${e.old_value || "—"} → ${e.new_value || "—"}`);
    else if (e.action === "assignment_added") parts.push(`Danışman eklendi: ${e.new_value}`);
    else if (e.action === "assignment_removed") parts.push(`Danışman çıkarıldı: ${e.old_value}`);
  }
  return parts.join("; ") || "Talep güncellendi";
}

/**
 * Duraklamayı müşteri bitirdiyse (yanıt yazdı) gerçek bitiş anı: geçmişteki en son "duraklayan durumdan çıkış" kaydı.
 * @returns {Promise<string|undefined>}
 */
async function customerPauseEnd(api, ticketId, existing) {
  try {
    const history = await api.getTicketHistory(ticketId); // yeniden eskiye
    const since = new Date(existing.sla_paused_since).getTime() || 0;
    for (const h of history) {
      if (h.field_changed !== "status") continue;
      const from = normalizeStatusCode(h.old_value);
      const to = normalizeStatusCode(h.new_value);
      const at = new Date(h.changed_at).getTime() || 0;
      if (SLA_PAUSING_STATUSES.includes(from) && !SLA_PAUSING_STATUSES.includes(to) && at >= since) return h.changed_at;
    }
  } catch {
    /* geçmiş okunamadı: son herkese açık hareket zamanına düşülür */
  }
  return undefined;
}

/**
 * Danışman atamasının fark tabanlı planı: yalnız eklenen/çıkarılan/değişen kayıtlar yazılır
 * (eşzamanlı yönetici değişiklikleri tümden ezilmez), `assigned_uids` haritası güncellenir (D-08),
 * birincil değişimi ve ikincil ekleme/çıkarma TEK satırlık, adı çözülmüş geçmiş kayıtlarıdır.
 */
async function planAssignments(api, existing, desiredInput, ts, af, actor, personnelCache) {
  const fb = getFirebase();
  const id = getTicketKey(existing);
  const desired = [];
  const seen = new Set();
  for (const a of desiredInput || []) {
    const pid = a.personnel_id || a.id;
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    desired.push({
      pid,
      name: a.personnel_name || a.name || "",
      email: String(a.personnel_email || a.email || "").trim().toLowerCase(),
      uid: a.personnel_uid || a.uid || "",
      is_primary: !!a.is_primary,
    });
  }
  let primarySeen = false;
  for (const d of desired) {
    if (d.is_primary && primarySeen) d.is_primary = false;
    if (d.is_primary) primarySeen = true;
  }
  if (desired.length && !primarySeen) desired[0].is_primary = true;

  const snap = await fb.db.get(v2Ref(`ticket_assignments/${id}`));
  const current = new Map(snapshotToArray(snap).map((a) => [a.id, a]));
  const legacy = !current.size && existing.assigned_to_id ? { pid: existing.assigned_to_id, name: existing.assigned_to_name || "" } : null;

  // Personel kayıtlarından ad/e-posta/uid tamamla
  let personnel = [];
  if (desired.some((d) => !d.uid || !d.email || !d.name)) personnel = personnelCache || (await api.getAllPersonnel());
  const byPid = new Map(personnel.map((p) => [p.personnel_id || p.id, p]));
  for (const d of desired) {
    const p = byPid.get(d.pid);
    if (!p) continue;
    if (!d.name) d.name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    if (!d.email) d.email = String(p.email || "").trim().toLowerCase();
    if (!d.uid && p.uid) d.uid = p.uid;
  }
  const paths = {};

  // Yönetici rolleri için uid'i e-postayla kullanıcılardan çöz ve personel kaydına yaz (kendi kendini onarır).
  const missingUid = desired.filter((d) => !d.uid);
  if (missingUid.length && ["super_admin", "service_admin"].includes(lc(actor?.role))) {
    try {
      const users = await api.getAllUsers();
      for (const d of missingUid) {
        const match = d.email && users.find((u) => STAFF_USER_ROLES.includes(lc(u.role)) && String(u.email || "").trim().toLowerCase() === d.email);
        if (match) {
          d.uid = match.uid || match.id;
          paths[`personnel/${d.pid}/uid`] = d.uid;
        }
      }
    } catch {
      /* kullanıcı listesi okunamadı: eşleşmeyenler uyarı olarak döner */
    }
  }
  const unmatched = desired.filter((d) => !d.uid).map((d) => d.name || d.pid);

  // ticket_assignments (yalnız fark)
  const newlyAssignedIds = [];
  const entries = [];
  for (const d of desired) {
    const had = current.get(d.pid);
    if (!had) {
      if (!(legacy && legacy.pid === d.pid)) newlyAssignedIds.push(d.pid);
      paths[`ticket_assignments/${id}/${d.pid}`] = {
        personnel_id: d.pid,
        personnel_name: d.name,
        // Müşteri tarafı personel listesini okuyamaz; bildirim adresi atama kaydında tutulur.
        personnel_email: d.email,
        is_primary: d.is_primary,
        assigned_at: legacy && legacy.pid === d.pid ? existing.assigned_at || ts : ts,
        assigned_by_uid: af.created_by,
        assigned_by_name: af.created_by_name,
      };
    } else {
      if (!!had.is_primary !== d.is_primary) paths[`ticket_assignments/${id}/${d.pid}/is_primary`] = d.is_primary;
      if (d.name && d.name !== had.personnel_name) paths[`ticket_assignments/${id}/${d.pid}/personnel_name`] = d.name;
      if (d.email && d.email !== String(had.personnel_email || "").toLowerCase()) paths[`ticket_assignments/${id}/${d.pid}/personnel_email`] = d.email;
    }
  }
  const removedIds = [];
  for (const [pid, rec] of current) {
    if (!seen.has(pid)) {
      removedIds.push(pid);
      paths[`ticket_assignments/${id}/${pid}`] = null;
      rec.__removed = true;
    }
  }

  // assigned_uids haritası (D-08: danışman yazması bu haritaya bağlıdır)
  const targetUids = new Set(desired.filter((d) => d.uid).map((d) => d.uid));
  const existingUids = existing.assigned_uids && typeof existing.assigned_uids === "object" ? Object.keys(existing.assigned_uids) : [];
  for (const uid of targetUids) if (!existingUids.includes(uid)) paths[`tickets/${id}/assigned_uids/${uid}`] = true;
  for (const uid of existingUids) if (!targetUids.has(uid)) paths[`tickets/${id}/assigned_uids/${uid}`] = null;

  // Talep alanları + geçmiş
  const primary = desired.find((d) => d.is_primary) || null;
  const primaryId = primary ? primary.pid : "";
  const oldPrimaryId = String(existing.assigned_to_id || "");
  const oldPrimaryName = String(existing.assigned_to_name || "") || (legacy ? legacy.name : "");
  const patch = {};
  const primaryChanged = primaryId !== oldPrimaryId;
  if (primaryChanged || (primary && primary.name && primary.name !== existing.assigned_to_name)) {
    patch.assigned_to_id = primaryId;
    patch.assigned_to_name = primary ? primary.name : "";
  }
  if (primaryChanged) patch.assigned_at = primaryId ? ts : null;
  const status = lc(existing.status) || "open";
  if (desired.length && status === "open") patch.status = "assigned";
  if (!desired.length && status === "assigned") patch.status = "open";

  if (primaryChanged) {
    entries.push({
      action: "assigned_to_changed",
      field_changed: "assigned_to_name",
      old_value: oldPrimaryName,
      new_value: primary ? primary.name : "",
    });
  }
  for (const d of desired) {
    if (current.has(d.pid) || d.pid === primaryId) continue;
    if (legacy && legacy.pid === d.pid) continue;
    entries.push({ action: "assignment_added", field_changed: "assignment", old_value: "", new_value: d.name || d.pid });
  }
  for (const [pid, rec] of current) {
    if (!rec.__removed || pid === oldPrimaryId) continue;
    entries.push({ action: "assignment_removed", field_changed: "assignment", old_value: rec.personnel_name || pid, new_value: "" });
  }

  return { patch, paths, entries, primaryId, newlyAssignedIds, removedIds, unmatched };
}

const ParlaDb = {
  waitForFirebase,
  v2Ref,
  snapshotToArray,

  getCurrentUser() {
    const fb = getFirebase();
    return fb.auth.currentUser;
  },

  async getUserProfile(uid) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`users/${uid}`));
    if (!snap.exists()) return null;
    return { uid, ...snap.val() };
  },

  async getAllUsers() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("users"));
    return snapshotToArray(snap).map((u) => ({
      ...u,
      uid: u.uid || u.id,
    }));
  },

  async createUserProfile(uid, data) {
    const fb = getFirebase();
    const ts = nowIso();
    const payload = {
      uid,
      email: data.email || "",
      first_name: data.first_name || "",
      last_name: data.last_name || "",
      phone: data.phone || "",
      role: data.role || "customer",
      company_id: data.company_id || "",
      company_name: data.company_name || "",
      customer_code: data.customer_code || "",
      is_active: data.is_active !== false,
      must_change_password: !!data.must_change_password,
      last_login_at: data.last_login_at || null,
      created_at: ts,
      created_by: data.created_by || "",
      updated_at: ts,
      updated_by: data.updated_by || "",
    };
    await fb.db.set(v2Ref(`users/${uid}`), payload);
    return payload;
  },

  async updateUserProfile(uid, data) {
    const fb = getFirebase();
    const updates = {
      ...data,
      updated_at: nowIso(),
    };
    delete updates.uid;
    await fb.db.update(v2Ref(`users/${uid}`), updates);
    const profile = await this.getUserProfile(uid);
    // Ad değiştiyse talepler üzerindeki `user_name` kopyaları yayılır (SEC-21); en iyi çaba, kayıt güncellemesini bozmaz.
    if (profile && ("first_name" in data || "last_name" in data)) {
      try {
        await this.syncUserCopies(uid, personnelFullName(profile));
      } catch {
        /* yetki/ağ hatası: kopyalar sonraki düzenlemede eşitlenir */
      }
    }
    return profile;
  },

  /**
   * Kullanıcının talepler üzerindeki ad kopyasını (`tickets.user_name`) eşitler (yalnız farklı olanlar yazılır).
   * @returns {Promise<number>} güncellenen talep sayısı
   */
  async syncUserCopies(uid, fullName) {
    const tickets = await queryByChild("tickets", "user_id", uid);
    const paths = planUserNameCopies(uid, fullName, tickets);
    await commitPaths(paths);
    return Object.keys(paths).length;
  },

  async getAllCompanies() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("companies"));
    return snapshotToArray(snap).map((c) => ({
      ...c,
      company_id: c.company_id || c.id,
    }));
  },

  async getCompany(id) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`companies/${id}`));
    if (!snap.exists()) return null;
    return { company_id: id, id, ...snap.val() };
  },

  async createCompany(data) {
    const fb = getFirebase();
    const ts = nowIso();
    const ref = fb.db.push(v2Ref("companies"));
    const id = ref.key;
    const payload = {
      company_id: id,
      name: data.name || "",
      customer_code: String(data.customer_code || "").toUpperCase(),
      customer_type: data.customer_type || "CUS",
      has_contract: !!data.has_contract,
      contract_id: data.contract_id || "",
      primary_contact_email: data.primary_contact_email || "",
      phone: data.phone || "",
      address: data.address || "",
      is_active: data.is_active !== false,
      created_at: ts,
      created_by: data.created_by || "",
      updated_at: ts,
      updated_by: data.updated_by || "",
    };
    await fb.db.set(ref, payload);
    return { id, ...payload };
  },

  async updateCompany(id, data) {
    const fb = getFirebase();
    const updates = { ...data, updated_at: nowIso() };
    delete updates.company_id;
    delete updates.id;
    await fb.db.update(v2Ref(`companies/${id}`), updates);
    return this.getCompany(id);
  },

  /**
   * Firma kaydını günceller ve ad/kod KOPYALARINI yayar (YON-09, SEC-21): kullanıcılar, talepler, sözleşmeler, projeler.
   * Talep numarası değişmez. Kopya yayma idempotenttir (yalnız farklı olanlar yazılır); parçalar hâlinde yazıldığı için
   * kısmi başarısızlıkta `failed` doludur ve aynı çağrı tekrar edilebilir.
   * @returns {Promise<{company: object, synced: {users:number,tickets:number,contracts:number,projects:number}, failed: string}>}
   */
  async updateCompanyAndSync(id, data) {
    const company = await this.updateCompany(id, data);
    let synced = { users: 0, tickets: 0, contracts: 0, projects: 0 };
    let failed = "";
    if (company && (data.name !== undefined || data.customer_code !== undefined)) {
      try {
        synced = await this.syncCompanyCopies(id, company);
      } catch (err) {
        failed = String(err?.message || err || "bilinmeyen hata");
      }
    }
    return { company, synced, failed };
  },

  /** Firma ad/kod kopyalarını (users, tickets, contracts, projects) firma kaydıyla eşitler. */
  async syncCompanyCopies(companyId, companyRecord) {
    const company = companyRecord || (await this.getCompany(companyId));
    const synced = { users: 0, tickets: 0, contracts: 0, projects: 0 };
    if (!company) return synced;
    const safe = (p) => p.catch((err) => (isPermissionDenied(err) ? [] : Promise.reject(err)));
    const [users, tickets, contracts, projects] = await Promise.all([
      safe(queryByChild("users", "company_id", companyId)),
      queryByChild("tickets", "company_id", companyId),
      queryByChild("contracts", "company_id", companyId),
      queryByChild("projects", "company_id", companyId),
    ]);
    const paths = planCompanyCopies({ ...company, name: company.name, customer_code: company.customer_code }, { users, tickets, contracts, projects });
    const touched = { users: new Set(), tickets: new Set(), contracts: new Set(), projects: new Set() };
    for (const k of Object.keys(paths)) {
      const [node, rowId] = k.split("/");
      if (touched[node]) touched[node].add(rowId);
    }
    for (const node of Object.keys(touched)) synced[node] = touched[node].size;
    await commitPaths(paths);
    return synced;
  },

  /** Talep sayıları (toplam/açık) — yalnız verilen firmalar için indeksli sorgularla (tüm koleksiyon indirilmez). */
  async getTicketCountsForCompanies(companyIds) {
    const out = {};
    const ids = [...new Set(companyIds || [])];
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        const list = (await queryByChild("tickets", "company_id", id)).filter((t) => !isDeletedTicket(t));
        out[id] = { total: list.length, open: list.filter((t) => OPEN_STATUSES.includes(lc(t.status))).length };
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
    return out;
  },

  /** Açık (kapanmamış/çözülmemiş) talepler: durum bazlı indeksli sorgular; tüm koleksiyon indirilmez. */
  async getOpenTickets() {
    const lists = await Promise.all(OPEN_STATUSES.map((s) => queryByChild("tickets", "status", s)));
    return lists
      .flat()
      .map((t) => ({ ...t, ticket_id: getTicketKey(t) }))
      .filter((t) => !isDeletedTicket(t));
  },

  /** Firmaya bağlı kullanıcılar (yalnız super/service okuyabilir; `company_id` indeksi). */
  async getUsersByCompany(companyId) {
    return (await queryByChild("users", "company_id", companyId)).map((u) => ({ ...u, uid: u.uid || u.id }));
  },

  async getContractsByCompany(companyId) {
    return (await queryByChild("contracts", "company_id", companyId)).map((c) => ({ ...c, contract_id: c.contract_id || c.id }));
  },

  async getProjectsByCompany(companyId) {
    return (await queryByChild("projects", "company_id", companyId)).map((p) => ({ ...p, project_id: p.project_id || p.id }));
  },

  /** Bir projeye bağlı talepler (`project_id` indeksi; silinmişler hariç). */
  async getTicketsByProject(projectId) {
    const list = await queryByChild("tickets", "project_id", projectId);
    return list.map((t) => ({ ...t, ticket_id: getTicketKey(t) })).filter((t) => !isDeletedTicket(t));
  },

  async searchCompanies(term) {
    const q = String(term || "").trim().toLowerCase();
    const all = await this.getAllCompanies();
    if (!q) return all.filter((c) => c.is_active !== false);
    return all.filter((c) => {
      const name = String(c.name || "").toLowerCase();
      const code = String(c.customer_code || "").toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  },

  async getAllPersonnel() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("personnel"));
    return snapshotToArray(snap).map((p) => ({
      ...p,
      personnel_id: p.personnel_id || p.id,
    }));
  },

  async getPersonnel(id) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`personnel/${id}`));
    if (!snap.exists()) return null;
    return { personnel_id: id, id, ...snap.val() };
  },

  async createPersonnel(data) {
    const fb = getFirebase();
    const ts = nowIso();
    const ref = fb.db.push(v2Ref("personnel"));
    const id = ref.key;
    const payload = {
      personnel_id: id,
      first_name: data.first_name || "",
      last_name: data.last_name || "",
      // E-posta küçük harfe normalize edilir; uid kullanıcı hesabıyla açık kimlik bağıdır (yoksa boş).
      email: String(data.email || "").trim().toLowerCase(),
      uid: data.uid || "",
      phone: data.phone || "",
      department_id: data.department_id || "",
      department_name: data.department_name || "",
      role_title: data.role_title || "",
      is_active: data.is_active !== false,
      created_at: ts,
      created_by: data.created_by || "",
      updated_at: ts,
      updated_by: data.updated_by || "",
    };
    await fb.db.set(ref, payload);
    return { id, ...payload };
  },

  async updatePersonnel(id, data) {
    const fb = getFirebase();
    const updates = { ...data, updated_at: nowIso() };
    delete updates.personnel_id;
    delete updates.id;
    if (updates.email !== undefined) updates.email = String(updates.email || "").trim().toLowerCase();
    await fb.db.update(v2Ref(`personnel/${id}`), updates);
    return this.getPersonnel(id);
  },

  /**
   * Personel kaydını günceller ve kopyaları yayar (YON-04/09): ad → `assigned_to_name`, atama kayıtlarındaki ad,
   * projelerdeki yönetici/atanan adı; e-posta → atama kayıtlarındaki `personnel_email` (müşteri yanıtı doğru adrese gitsin);
   * PASİFE alınınca e-posta kopyaları BOŞALTILIR, yeniden aktifleşince geri yazılır.
   * @returns {Promise<{person: object, synced: number, failed: string}>}
   */
  async updatePersonnelAndSync(id, data) {
    const person = await this.updatePersonnel(id, data);
    let synced = 0;
    let failed = "";
    if (person) {
      try {
        synced = await this.syncPersonnelCopies(id, person);
      } catch (err) {
        failed = String(err?.message || err || "bilinmeyen hata");
      }
    }
    return { person, synced, failed };
  },

  /** Personel ad/e-posta kopyalarını eşitler (idempotent). @returns {Promise<number>} yazılan yol sayısı */
  async syncPersonnelCopies(personnelId, personRecord) {
    const person = personRecord || (await this.getPersonnel(personnelId));
    if (!person) return 0;
    const [assignments, tickets, projects] = await Promise.all([
      this.getAllAssignments(),
      queryByChild("tickets", "assigned_to_id", personnelId),
      this.getAllProjects(),
    ]);
    const paths = planPersonnelCopies({ ...person, personnel_id: personnelId }, { assignments, tickets, projects });
    return commitPaths(paths);
  },

  /**
   * Yalnız e-posta kopyaları (atama kayıtlarındaki `personnel_email`): personel e-postası değişince müşteri yanıtı doğru
   * adrese gitsin (YON-04). `newEmail` verilirse personel kaydındaki değer yerine o kullanılır; pasif personelde boşaltılır.
   * @returns {Promise<number>} güncellenen atama kaydı sayısı
   */
  async updatePersonnelEmailCopies(personnelId, newEmail) {
    const person = await this.getPersonnel(personnelId);
    if (!person) return 0;
    const record = newEmail !== undefined ? { ...person, email: String(newEmail || "").trim().toLowerCase() } : person;
    const assignments = await this.getAllAssignments();
    const paths = planPersonnelCopies({ ...record, personnel_id: personnelId }, { assignments });
    for (const k of Object.keys(paths)) if (!k.endsWith("/personnel_email")) delete paths[k];
    return commitPaths(paths);
  },

  /**
   * Tüm talepler (personel). Yumuşak silinmiş (arşiv) talepler varsayılan olarak dışarıda bırakılır:
   * liste/pano/rapor/zil aynı süzgeci kullanır. `includeDeleted` hepsini, `onlyDeleted` yalnız arşivi döndürür.
   */
  async getAllTickets(options) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("tickets"));
    const all = snapshotToArray(snap).map((t) => ({
      ...t,
      ticket_id: getTicketKey(t),
    }));
    if (options?.includeDeleted) return all;
    if (options?.onlyDeleted) return all.filter(isDeletedTicket);
    return all.filter((t) => !isDeletedTicket(t));
  },

  async getTicketsForUser(uid) {
    const fb = getFirebase();
    const q = fb.db.query(
      v2Ref("tickets"),
      fb.db.orderByChild("user_id"),
      fb.db.equalTo(uid)
    );
    const snap = await fb.db.get(q);
    return snapshotToArray(snap)
      .map((t) => ({
        ...t,
        ticket_id: getTicketKey(t),
      }))
      .filter((t) => !isDeletedTicket(t));
  },

  async getTicketsForCompany(companyId) {
    const fb = getFirebase();
    const q = fb.db.query(
      v2Ref("tickets"),
      fb.db.orderByChild("company_id"),
      fb.db.equalTo(companyId)
    );
    const snap = await fb.db.get(q);
    return snapshotToArray(snap)
      .map((t) => ({
        ...t,
        ticket_id: getTicketKey(t),
      }))
      .filter((t) => !isDeletedTicket(t));
  },

  /** Son güncellenen n talep (personel; bildirim zili için). */
  async getRecentTickets(n) {
    const fb = getFirebase();
    const q = fb.db.query(v2Ref("tickets"), fb.db.orderByChild("updated_at"), fb.db.limitToLast(n || 50));
    const snap = await fb.db.get(q);
    return snapshotToArray(snap)
      .map((t) => ({ ...t, ticket_id: getTicketKey(t) }))
      .filter((t) => !isDeletedTicket(t));
  },

  /** Müşteri tarafı liste: firma yöneticisi firmanın tüm talepleri, diğerleri yalnızca kendi talepleri. */
  async getTicketsForSession(session) {
    if (session?.role === "company_admin" && session.company_id) {
      return this.getTicketsForCompany(session.company_id);
    }
    return this.getTicketsForUser(session.uid);
  },

  async getPersonnelTickets(personnelId) {
    const fb = getFirebase();
    const q = fb.db.query(
      v2Ref("tickets"),
      fb.db.orderByChild("assigned_to_id"),
      fb.db.equalTo(personnelId)
    );
    const snap = await fb.db.get(q);
    return snapshotToArray(snap)
      .map((t) => ({
        ...t,
        ticket_id: getTicketKey(t),
      }))
      .filter((t) => !isDeletedTicket(t));
  },

  async getTicket(id) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`tickets/${id}`));
    if (!snap.exists()) return null;
    // SEC-07: anahtar kayıttaki id/ticket_id alanlarını ezer (tersi değil).
    return { ...snap.val(), ticket_id: id, id };
  },

  async createTicket(data, actor) {
    const fb = getFirebase();
    const ts = nowIso();
    const af = actorFields(actor);
    const ticketType = String(data.ticket_type || "SUP").toUpperCase();
    const customerCode = String(data.customer_code || "").toUpperCase();
    const sapModule = data.sap_module || "Diğer";

    const ticketNumber = await generateTicketNumber(
      fb.db,
      ticketType,
      customerCode,
      sapModule
    );

    const parts = ticketNumber.split("-");
    const sequenceNumber = parseInt(parts[parts.length - 1], 10) || 0;

    const ref = fb.db.push(v2Ref("tickets"));
    const id = ref.key;

    const payload = {
      ticket_id: id,
      ticket_number: ticketNumber,
      ticket_type: ticketType,
      customer_code: customerCode,
      company_id: data.company_id || "",
      company_name: data.company_name || "",
      user_id: data.user_id || af.created_by,
      user_name: data.user_name || af.created_by_name,
      user_email: data.user_email || "",
      title: data.title || "",
      priority: data.priority || "medium",
      sap_module: sapModule,
      description: data.description || "",
      status: data.status || "open",
      assigned_to_id: data.assigned_to_id || "",
      assigned_to_name: data.assigned_to_name || "",
      assigned_at: data.assigned_at || null,
      started_at: data.started_at || null,
      attachment_url: data.attachment_url || "",
      total_work_hours: data.total_work_hours || 0,
      project_id: data.project_id || "",
      sequence_number: sequenceNumber,
      created_at: ts,
      created_by: af.created_by,
      updated_at: ts,
      updated_by: af.updated_by,
      resolved_at: null,
      closed_at: null,
    };

    await fb.db.set(ref, payload);

    await this.addTicketHistory(id, {
      action: "created",
      field_changed: "ticket",
      old_value: "",
      new_value: ticketNumber,
      changed_by_uid: af.created_by,
      changed_by_name: af.created_by_name,
      changed_at: ts,
    });

    return { id, ...payload };
  },

  /**
   * Talebi günceller. TÜM durum/damga/SLA/geçmiş/atama mantığı burada, tek çok yollu (atomik) `update` ile yazılır:
   * talep alanları + geçmiş satırları + (isteğe bağlı) aktivite aynı çağrıda gider; bir parça reddedilirse hiçbiri yazılmaz.
   *
   * @param {string} id
   * @param {object} updates değişecek talep alanları (status, priority, ticket_type, ...)
   * @param {object} actor oturum (uid, name/first_name, role)
   * @param {{
   *   expectedStatus?: string,   koşullu yazma: ekrandaki durum gerçek durumla uyuşmuyorsa "status_conflict" hatası
   *   note?: string,             durum değişikliği notu (aynı geçmiş satırına yazılır; müşteriye giden ilk personel iletisidir)
   *   assignments?: Array,       istenen danışman listesi (fark tabanlı atama; assigned_uids haritası dahil)
   *   force?: boolean,           yalnız süper admin: matris dışı geçiş
   *   silent?: boolean,          updated_at/public_updated_at dokunulmaz (ör. iç onay işareti)
   *   activity?: {action?: string, details?: string},  aynı atomik yazımda aktivite kaydı
   *   extraPaths?: object,       v2 köküne göre ek yollar (örn. başka düğümler)
   *   report?: object            doldurulur: newlyAssignedIds, removedIds, unmatched, statusHistoryId (e-posta için history_id)
   *   collect?: {paths?: object} verilirse YAZILMAZ: üretilen çok yollu güncelleme `collect.paths`'e konur (toplu işlem)
   *   personnel?: object[]       atama planı için önceden okunmuş personel listesi (toplu işlemde tekrar okumayı önler)
   * }} [options]
   */
  async updateTicket(id, updates, actor, options) {
    const fb = getFirebase();
    const opts = options || {};
    const existing = await this.getTicket(id);
    if (!existing) {
      throw makeError("Talep bulunamadı.", "not_found");
    }
    if (isDeletedTicket(existing) && !opts.allowDeleted) {
      throw makeError("Bu talep silinmiş (arşivde). Düzenlemek için önce geri yükleyin.", "ticket_deleted");
    }

    const fromStatus = lc(existing.status) || "open";
    if (opts.expectedStatus !== undefined && lc(opts.expectedStatus) !== fromStatus) {
      throw makeError(
        `Bu talep başka biri tarafından güncellendi (durum şu anda «${formatStatusLabel(fromStatus)}»). Sayfayı yenileyip işlemi tekrar deneyin.`,
        "status_conflict"
      );
    }

    const role = lc(actor?.role) || lc((actor?.uid && (await this.getUserProfile(actor.uid))?.role) || "");
    const customerActor = isCustomerRole(role);
    const ts = nowIso();
    const af = actorFields(actor);
    const patch = { ...(updates || {}) };
    delete patch.ticket_id;
    delete patch.id;
    const entries = [];
    const pathsOut = {};

    // --- danışman ataması (fark tabanlı)
    let plan = null;
    if (opts.assignments) {
      plan = await planAssignments(this, existing, opts.assignments, ts, af, actor, opts.personnel);
      for (const [k, v] of Object.entries(plan.patch)) {
        if (k === "status" && patch.status !== undefined) continue; // açıkça verilen durum atamadan önceliklidir
        if (patch[k] === undefined) patch[k] = v;
      }
      Object.assign(pathsOut, plan.paths);
      entries.push(...plan.entries);
      if (opts.report) {
        opts.report.newlyAssignedIds = plan.newlyAssignedIds;
        opts.report.removedIds = plan.removedIds;
        opts.report.unmatched = plan.unmatched;
      }
    } else if (
      !opts.skipAssignmentHistory &&
      ((patch.assigned_to_name !== undefined && String(patch.assigned_to_name || "") !== String(existing.assigned_to_name || "")) ||
        (patch.assigned_to_id !== undefined && String(patch.assigned_to_id || "") !== String(existing.assigned_to_id || "")))
    ) {
      // Tek satır, danışman adı çözülmüş (ham kimlik gösterilmez).
      entries.push({
        action: "assigned_to_changed",
        field_changed: "assigned_to_name",
        old_value: String(existing.assigned_to_name || ""),
        new_value: String(patch.assigned_to_name ?? existing.assigned_to_name ?? ""),
      });
    }

    // --- durum geçişi doğrulaması
    const nextStatus = patch.status !== undefined ? lc(patch.status) : fromStatus;
    const statusChanged = nextStatus !== fromStatus;
    if (statusChanged) {
      const hasAssignee = !!(plan ? plan.primaryId : existing.assigned_to_id);
      const allowed = isTransitionAllowed(fromStatus, nextStatus, {
        role,
        actor: customerActor ? "customer" : "staff",
        hasAssignee,
      });
      if (!allowed && !(opts.force && role === "super_admin")) {
        throw makeError(
          `«${formatStatusLabel(fromStatus)}» durumundan «${formatStatusLabel(nextStatus)}» durumuna geçiş yapılamaz.`,
          "invalid_transition"
        );
      }
      if (opts.force && role === "super_admin" && !allowed && !String(opts.note || "").trim()) {
        throw makeError("Matris dışı durum geçişi için gerekçe zorunludur.", "note_required");
      }
    }

    // --- damgalar (tek yer)
    if (statusChanged) {
      Object.assign(patch, computeStatusStamps(existing, nextStatus, ts, { isCustomer: customerActor }));
      // İlk yanıt: müşteriye giden ilk personel iletisi (herkese açık mesaj ya da müşteriye iletilen durum notu).
      if (!customerActor && String(opts.note || "").trim() && !existing.first_response_at) {
        patch.first_response_at = ts;
      }
    }

    // --- SLA muhasebesi (yalnız personel yazar)
    if (!customerActor) {
      let pauseEndIso;
      if (existing.sla_paused_since && !SLA_PAUSING_STATUSES.includes(fromStatus)) {
        pauseEndIso = await customerPauseEnd(this, id, existing);
      }
      const slaPatch = buildSlaPatch(existing, { ...patch, status: nextStatus }, ts, { pauseEndIso });
      if (slaPatch) Object.assign(patch, slaPatch);
    }

    // --- geçmiş: değişiklik başına TEK satır
    const who = { changed_by_uid: af.created_by, changed_by_name: af.created_by_name, changed_at: ts };
    const note = String(opts.note || "").trim();
    const fieldEntries = [];
    if (statusChanged) {
      // Durum değişimi TEK satırdır: notlu geçişin `action` değeri "status_note" (e-posta fonksiyonu notu bu kayıttan
      // okur), notsuz geçişinki "status_changed". Eski/yeni değerler her zaman durum KODUDUR.
      fieldEntries.push({
        action: note ? "status_note" : "status_changed",
        field_changed: "status",
        old_value: fromStatus,
        new_value: nextStatus,
        note,
        __status: true,
      });
    }
    if (patch.priority !== undefined && lc(patch.priority) !== lc(existing.priority)) {
      fieldEntries.push({ action: "priority_changed", field_changed: "priority", old_value: lc(existing.priority), new_value: lc(patch.priority) });
    }
    if (patch.ticket_type !== undefined && String(patch.ticket_type) !== String(existing.ticket_type || "")) {
      fieldEntries.push({
        action: "ticket_type_changed",
        field_changed: "ticket_type",
        old_value: String(existing.ticket_type || ""),
        new_value: String(patch.ticket_type),
      });
    }
    entries.unshift(...fieldEntries);
    if (note && !statusChanged && entries.length) entries[0].note = note;
    for (const e of opts.extraHistory || []) entries.push(e);

    // --- müşteriye görünen değişiklik: bildirim zili "son herkese açık hareket" alanlarından türetilir
    const customerVisible =
      statusChanged ||
      (patch.priority !== undefined && lc(patch.priority) !== lc(existing.priority)) ||
      (patch.assigned_to_id !== undefined && String(patch.assigned_to_id || "") !== String(existing.assigned_to_id || "")) ||
      (patch.assigned_to_name !== undefined && String(patch.assigned_to_name || "") !== String(existing.assigned_to_name || ""));

    const out = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) out[`tickets/${id}/${k}`] = v;
    }
    if (!opts.silent) {
      out[`tickets/${id}/updated_at`] = ts;
      out[`tickets/${id}/updated_by`] = af.updated_by;
      if (customerVisible) {
        out[`tickets/${id}/public_updated_at`] = ts;
        out[`tickets/${id}/public_updated_by`] = af.updated_by;
      }
    }
    for (const e of entries) {
      const key = newChildKey(`ticket_history/${id}`);
      if (e.__status && opts.report) opts.report.statusHistoryId = key;
      out[`ticket_history/${id}/${key}`] = {
        history_id: key,
        action: e.action || "updated",
        field_changed: e.field_changed || "",
        old_value: String(e.old_value ?? "").slice(0, 1000),
        new_value: String(e.new_value ?? "").slice(0, 1000),
        note: String(e.note || "").slice(0, 5000),
        ...who,
      };
    }
    if (opts.activity) {
      const key = newChildKey("activities");
      out[`activities/${key}`] = {
        activity_id: key,
        action: opts.activity.action || "ticket_updated",
        entity_type: "ticket",
        entity_id: id,
        entity_label: existing.ticket_number || id,
        user_uid: af.created_by,
        user_name: af.created_by_name,
        details: String(opts.activity.details ?? summarizeEntries(entries)).slice(0, 1000),
        created_at: ts,
      };
    }
    Object.assign(out, pathsOut, opts.extraPaths || {});

    // Toplu işlem: yazmadan yalnız yolları toplar (bkz. bulkUpdateTickets); dönen değer yazıldığında oluşacak talep özetidir.
    if (opts.collect) {
      opts.collect.paths = out;
      const merged = { ...existing, ticket_id: id, id };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      if (!opts.silent) merged.updated_at = ts;
      return merged;
    }

    await fb.db.update(rootV2Ref(), out);
    return this.getTicket(id);
  },

  /**
   * Yumuşak silme (D-05 B): talep arşive alınır (`is_deleted`), veriler korunur. Liste/pano/rapor/zil/müşteri
   * sayfaları gizler. Yalnızca yönetici roller (süper admin, destek atayıcı) çağırmalıdır.
   */
  async deleteTicket(id, actor, options) {
    const fb = getFirebase();
    const existing = await this.getTicket(id);
    if (!existing) throw makeError("Talep bulunamadı.", "not_found");
    if (isDeletedTicket(existing)) return existing;
    const ts = nowIso();
    const af = actorFields(actor);
    const out = {
      [`tickets/${id}/is_deleted`]: true,
      [`tickets/${id}/deleted_at`]: ts,
      [`tickets/${id}/deleted_by`]: af.created_by,
    };
    const hKey = newChildKey(`ticket_history/${id}`);
    out[`ticket_history/${id}/${hKey}`] = {
      history_id: hKey,
      action: "ticket_deleted",
      field_changed: "is_deleted",
      old_value: "false",
      new_value: "true",
      note: String(options?.reason || "Arşive alındı (yumuşak silme)").slice(0, 5000),
      changed_by_uid: af.created_by,
      changed_by_name: af.created_by_name,
      changed_at: ts,
    };
    const aKey = newChildKey("activities");
    out[`activities/${aKey}`] = {
      activity_id: aKey,
      action: "ticket_deleted",
      entity_type: "ticket",
      entity_id: id,
      entity_label: existing.ticket_number || id,
      user_uid: af.created_by,
      user_name: af.created_by_name,
      details: String(options?.reason || "Arşive alındı").slice(0, 1000),
      created_at: ts,
    };
    await fb.db.update(rootV2Ref(), out);
    return this.getTicket(id);
  },

  /** Arşive alınmış (yumuşak silinmiş) talebi geri yükler. */
  async restoreTicket(id, actor) {
    const fb = getFirebase();
    const existing = await this.getTicket(id);
    if (!existing) throw makeError("Talep bulunamadı.", "not_found");
    const ts = nowIso();
    const af = actorFields(actor);
    const hKey = newChildKey(`ticket_history/${id}`);
    const aKey = newChildKey("activities");
    await fb.db.update(rootV2Ref(), {
      [`tickets/${id}/is_deleted`]: false,
      [`tickets/${id}/deleted_at`]: null,
      [`tickets/${id}/deleted_by`]: null,
      [`ticket_history/${id}/${hKey}`]: {
        history_id: hKey,
        action: "ticket_restored",
        field_changed: "is_deleted",
        old_value: "true",
        new_value: "false",
        note: "Arşivden geri yüklendi",
        changed_by_uid: af.created_by,
        changed_by_name: af.created_by_name,
        changed_at: ts,
      },
      [`activities/${aKey}`]: {
        activity_id: aKey,
        action: "ticket_restored",
        entity_type: "ticket",
        entity_id: id,
        entity_label: existing.ticket_number || id,
        user_uid: af.created_by,
        user_name: af.created_by_name,
        details: "Arşivden geri yüklendi",
        created_at: ts,
      },
    });
    return this.getTicket(id);
  },

  /**
   * Kalıcı silme (yalnız süper admin): talep ve bağlı 8 düğüm tek çok yollu yazımla null'lanır
   * (tickets, ticket_messages, ticket_internal_notes, ticket_attachments, ticket_internal_attachments,
   * ticket_history, ticket_assignments, ticket_efforts) + varsa ek kota sayacı. Geri dönüşsüzdür.
   * Aktivite kaydı kalır (denetim izi).
   */
  async permanentlyDeleteTicket(id, actor) {
    const fb = getFirebase();
    const existing = await this.getTicket(id);
    const af = actorFields(actor);
    const base = {};
    for (const node of PERMANENT_DELETE_NODES) base[`${node}/${id}`] = null;
    const aKey = newChildKey("activities");
    base[`activities/${aKey}`] = {
      activity_id: aKey,
      action: "ticket_permanently_deleted",
      entity_type: "ticket",
      entity_id: id,
      entity_label: existing?.ticket_number || id,
      user_uid: af.created_by,
      user_name: af.created_by_name,
      details: "Kalıcı olarak silindi (tüm bağlı kayıtlarla birlikte)",
      created_at: nowIso(),
    };
    try {
      await fb.db.update(rootV2Ref(), { ...base, [`ticket_attachment_stats/${id}`]: null });
    } catch (err) {
      if (!isPermissionDenied(err)) throw err;
      await fb.db.update(rootV2Ref(), base); // ek kota düğümü tanımlı değilse
    }
  },

  /**
   * Talep mesajları. İç notlar ayrı düğümde (ticket_internal_notes, yalnızca personel) tutulur;
   * `includeInternal` yalnızca personel için kullanılmalıdır. Müşteri çağrılarında eski
   * (ayrılmadan önce yazılmış) is_internal kayıtları da güvenlik için ayıklanır.
   */
  async getTicketMessages(ticketId, options) {
    const includeInternal = !!(options && options.includeInternal);
    const fb = getFirebase();
    const reads = [fb.db.get(v2Ref(`ticket_messages/${ticketId}`))];
    if (includeInternal) {
      reads.push(fb.db.get(v2Ref(`ticket_internal_notes/${ticketId}`)).catch(() => null));
    }
    const [publicSnap, internalSnap] = await Promise.all(reads);

    const byId = new Map();
    // SEC-07: mesaj kimliği DB anahtarıdır (kayıttaki message_id/id alanı güvenilmez).
    snapshotToArray(publicSnap).forEach((m) => byId.set(m.id, m));
    if (internalSnap) {
      snapshotToArray(internalSnap).forEach((m) =>
        byId.set(m.id, { ...m, is_internal: true })
      );
    }

    return [...byId.values()]
      .filter((m) => includeInternal || !m.is_internal)
      .map((m) => ({
        ...m,
        message_id: m.id,
        // RTDB dizileri nesneye çevirebilir: her zaman dizi olarak sun
        attachments: m.attachments ? (Array.isArray(m.attachments) ? m.attachments : Object.values(m.attachments)) : [],
      }))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  },

  /**
   * (super_admin) Eski is_internal mesajlarını ticket_messages'tan ticket_internal_notes'a taşır.
   * @returns {Promise<{tickets: number, moved: number}>}
   */
  async migrateInternalMessages(options) {
    const fb = getFirebase();
    const tickets = await this.getAllTickets({ includeDeleted: true });
    const onProgress = options && typeof options.onProgress === "function" ? options.onProgress : null;
    let moved = 0;
    let touched = 0;
    let done = 0;
    // N+1 yerine 15'li paralel gruplar (OLC-14): her talep için mesaj okunur, iç mesajlar tek çok yollu yazımla taşınır.
    const migrateOne = async (ticket) => {
      const tid = getTicketKey(ticket);
      const snap = await fb.db.get(v2Ref(`ticket_messages/${tid}`));
      const internal = snapshotToArray(snap).filter((m) => m.is_internal === true);
      if (internal.length) {
        const out = {};
        for (const m of internal) {
          const key = m.message_id || m.id;
          const { id: _drop, ...payload } = m;
          out[`ticket_internal_notes/${tid}/${key}`] = { ...payload, message_id: key, is_internal: true };
          out[`ticket_messages/${tid}/${key}`] = null;
        }
        await fb.db.update(rootV2Ref(), out);
        touched += 1;
        moved += internal.length;
      }
      done += 1;
      if (onProgress) onProgress(done, tickets.length);
    };
    for (let i = 0; i < tickets.length; i += 15) {
      await Promise.all(tickets.slice(i, i + 15).map(migrateOne));
    }
    return { tickets: touched, moved };
  },

  /**
   * Yarım kalan ek yüklemesinin temizliği (SEN-38): mesaj yazılamazsa yüklenen ekler yetim kalmasın.
   * Kurallar ek silmeyi yalnız süper admin'e verir; diğer rollerde reddedilir ve sessizce atlanır (ek yetim kalır).
   * @returns {Promise<number>} silinen ek sayısı
   */
  async removeUploadedAttachments(ticketId, refs, internal) {
    const fb = getFirebase();
    const list = (refs || []).filter((r) => r && r.id);
    if (!list.length) return 0;
    const node = internal ? "ticket_internal_attachments" : "ticket_attachments";
    const out = {};
    for (const r of list) out[`${node}/${ticketId}/${r.id}`] = null;
    try {
      await fb.db.update(rootV2Ref(), out);
      return list.length;
    } catch {
      return 0;
    }
  },

  async addTicketMessage(ticketId, data) {
    const fb = getFirebase();
    const ts = nowIso();
    const workHours = Number(data.work_hours) || 0;
    if (workHours !== 0) {
      const check = validateEffortInput({ hours: workHours, workDate: "" });
      if (check.errors.hours) throw makeError(check.errors.hours, "invalid_effort");
    }
    // İç notlar müşterinin okuyamadığı ayrı düğüme yazılır.
    const collection = data.is_internal ? "ticket_internal_notes" : "ticket_messages";
    const ref = fb.db.push(v2Ref(`${collection}/${ticketId}`));
    const id = ref.key;
    const payload = {
      message_id: id,
      user_id: data.user_id || "",
      author_name: data.author_name || "",
      author_email: data.author_email || "",
      author_role: data.author_role || "customer",
      message: data.message || "",
      is_internal: !!data.is_internal,
      work_hours: workHours,
      created_at: ts,
    };
    // Ek referansları (veri ayrı düğümlerde: bkz. attachments.js)
    const attachments = (Array.isArray(data.attachments) ? data.attachments : [])
      .slice(0, 3)
      .map((a) => ({ id: String(a.id), name: String(a.name).slice(0, 200), type: String(a.type), size: Number(a.size) || 0 }));
    if (attachments.length) payload.attachments = attachments;

    // Talep üzerindeki "son hareket" alanları. Dahili notlar yalnızca updated_at'i değiştirir;
    // herkese açık mesajlar ayrıca public_updated_* ve (personel için) ilk yanıt zamanını yazar.
    const isStaffAuthor = !["customer", "company_admin", "arizi_customer"].includes(
      String(payload.author_role || "").toLowerCase()
    );
    const ticketPatch = { updated_at: ts, updated_by: payload.user_id };
    if (!payload.is_internal) {
      ticketPatch.public_updated_at = ts;
      ticketPatch.public_updated_by = payload.user_id;
    }
    if (isStaffAuthor) {
      // İlk yanıt: müşteriye giden ilk personel iletisi (iç not sayılmaz). Geç kalındıysa ihlal damgası saklanır.
      const existing = await this.getTicket(ticketId);
      if (existing && !payload.is_internal && !existing.first_response_at) ticketPatch.first_response_at = ts;
      const slaPatch = existing ? buildSlaPatch(existing, {}, ts) : undefined;
      if (slaPatch) Object.assign(ticketPatch, slaPatch);
    }
    // Mesaj + talep alanları TEK atomik yazım: biri reddedilirse yarım kayıt kalmaz.
    const out = { [`${collection}/${ticketId}/${id}`]: payload };
    for (const [k, v] of Object.entries(ticketPatch)) out[`tickets/${ticketId}/${k}`] = v;
    await fb.db.update(rootV2Ref(), out);

    if (data.work_hours && parseFloat(data.work_hours) > 0) {
      let personnelId = data.personnel_id || "";
      let personnelName = data.personnel_name || data.author_name || "";
      if (!personnelId && data.author_email) {
        const person = await this.findPersonnelByEmail(data.author_email);
        if (person) {
          personnelId = person.personnel_id || person.id;
          personnelName =
            [person.first_name, person.last_name].filter(Boolean).join(" ") || personnelName;
        }
      }
      await this.addTicketEffort(
        ticketId,
        {
          personnel_id: personnelId,
          personnel_name: personnelName,
          hours: parseFloat(data.work_hours),
          work_date: istanbulDateISO(),
          note: data.message ? `Mesaj: ${String(data.message).slice(0, 120)}` : "",
        },
        { uid: data.user_id, name: data.author_name, email: data.author_email }
      );
    }

    return { id, ...payload };
  },

  /**
   * Aynı e-posta adresinin hem personel hem müşteri olarak kullanılmasını engeller.
   * @returns {Promise<string>} çakışma varsa kullanıcıya gösterilecek mesaj, yoksa ""
   */
  async emailHasConflictingRole(email, role) {
    const e = String(email || "").trim().toLowerCase();
    if (!e) return "";
    const wantsCustomer = isCustomerRole(role);

    const personnel = await this.findPersonnelByEmail(e);
    if (personnel && wantsCustomer) {
      return "Bu e-posta adresi bir danışman (personel) kaydına ait; müşteri kullanıcısı olarak eklenemez.";
    }

    const users = await this.getAllUsers();
    const existing = users.find((u) => String(u.email || "").trim().toLowerCase() === e);
    if (existing) {
      if (isCustomerRole(existing.role) !== wantsCustomer) {
        return `Bu e-posta adresi farklı türde bir kullanıcıya (${existing.role}) ait.`;
      }
    }
    return "";
  },

  async findPersonnelByEmail(email) {
    const q = String(email || "").trim().toLowerCase();
    if (!q) return null;
    const all = await this.getAllPersonnel();
    return (
      all.find((p) => String(p.email || "").trim().toLowerCase() === q) || null
    );
  },

  /** Oturumdaki personelin kaydı: önce `uid` bağı, yoksa e-posta (yedek). */
  async findPersonnelForSession(session) {
    const all = await this.getAllPersonnel();
    return findPersonnelForSession(all, session);
  },

  /**
   * "Personel ↔ kullanıcı eşleştir" (yalnız süper admin / destek atayıcı): e-posta eşleşmesiyle `personnel.uid` doldurur,
   * mevcut atamalar için talepteki `assigned_uids` haritasını tamamlar (D-08: danışman yazması bu haritaya bağlıdır).
   * Eşleşmeyen personeli ve personel kaydı olmayan danışman/proje yöneticisi kullanıcılarını uyarı listesi olarak döner.
   * @param {{dryRun?: boolean}} [options]
   */
  async linkPersonnelUsers(options) {
    const fb = getFirebase();
    const [users, personnel, assignments, tickets] = await Promise.all([
      this.getAllUsers(),
      this.getAllPersonnel(),
      this.getAllAssignments(),
      this.getAllTickets({ includeDeleted: true }),
    ]);
    const emailOf = (v) => String(v || "").trim().toLowerCase();
    const staffUsers = users.filter((u) => STAFF_USER_ROLES.includes(lc(u.role)));
    const userUids = new Set(users.map((u) => u.uid || u.id));
    const report = { linked: [], alreadyLinked: 0, unmatchedPersonnel: [], staffWithoutPersonnel: [], conflicts: [], ticketsUpdated: 0 };
    const paths = {};
    const uidByPid = {};

    for (const p of personnel) {
      const pid = p.personnel_id || p.id;
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || pid;
      if (p.uid && userUids.has(p.uid)) {
        report.alreadyLinked += 1;
        uidByPid[pid] = p.uid;
        continue;
      }
      const email = emailOf(p.email);
      const matches = email ? staffUsers.filter((u) => emailOf(u.email) === email) : [];
      if (matches.length === 1) {
        const uid = matches[0].uid || matches[0].id;
        uidByPid[pid] = uid;
        paths[`personnel/${pid}/uid`] = uid;
        report.linked.push({ personnel_id: pid, name, email, uid });
      } else if (matches.length > 1) {
        report.conflicts.push({ personnel_id: pid, name, email });
      } else {
        report.unmatchedPersonnel.push({ personnel_id: pid, name, email: p.email || "", active: p.is_active !== false });
      }
    }

    const linkedUids = new Set(Object.values(uidByPid));
    for (const u of staffUsers) {
      const uid = u.uid || u.id;
      if (["consultant", "project_manager"].includes(lc(u.role)) && !linkedUids.has(uid)) {
        report.staffWithoutPersonnel.push({ uid, name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email, email: u.email || "", role: u.role });
      }
    }

    for (const t of tickets) {
      const tid = getTicketKey(t);
      const list = assignments[tid] || (t.assigned_to_id ? [{ personnel_id: t.assigned_to_id }] : []);
      const have = t.assigned_uids && typeof t.assigned_uids === "object" ? t.assigned_uids : {};
      let touched = false;
      for (const a of list) {
        const uid = uidByPid[a.personnel_id];
        if (uid && have[uid] !== true) {
          paths[`tickets/${tid}/assigned_uids/${uid}`] = true;
          touched = true;
        }
      }
      if (touched) report.ticketsUpdated += 1;
    }

    if (!options?.dryRun) {
      const keys = Object.keys(paths);
      for (let i = 0; i < keys.length; i += 300) {
        const chunk = {};
        for (const k of keys.slice(i, i + 300)) chunk[k] = paths[k];
        await fb.db.update(rootV2Ref(), chunk);
      }
    }
    return report;
  },

  async getTicketAssignments(ticketId) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`ticket_assignments/${ticketId}`));
    let items = snapshotToArray(snap).map((a) => ({
      ...a,
      personnel_id: a.id,
    }));

    if (!items.length) {
      // Atama kaydı olmayan eski talep: birincil danışmandan sanal öğe (veritabanında karşılığı yoktur).
      const ticket = await this.getTicket(ticketId);
      if (ticket?.assigned_to_id) {
        items = [
          {
            id: ticket.assigned_to_id,
            personnel_id: ticket.assigned_to_id,
            personnel_name: ticket.assigned_to_name || "",
            is_primary: true,
            assigned_at: ticket.assigned_at || ticket.updated_at,
            virtual: true,
          },
        ];
      }
    }

    return items.sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary) || (a.personnel_name || "").localeCompare(b.personnel_name || "", "tr")
    );
  },

  /**
   * Tüm taleplerin atamaları (personel): { <ticketId>: [{personnel_id, is_primary, ...}] }.
   * Liste filtresi, pano iş yükü ve personel sayaçları ikincil danışmanları da saymak için kullanır.
   */
  async getAllAssignments() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("ticket_assignments"));
    const out = {};
    if (!snap.exists()) return out;
    const val = snap.val() || {};
    for (const tid of Object.keys(val)) {
      const node = val[tid];
      if (!node || typeof node !== "object") continue;
      out[tid] = Object.keys(node).map((pid) => ({ ...node[pid], personnel_id: pid, id: pid }));
    }
    return out;
  },

  /** Danışman listesini ister duruma getirir (ekle/çıkar/birincil/kaldır) — updateTicket'in fark tabanlı atama kısayolu. */
  async assignConsultants(ticketId, assignments, actor, options) {
    return this.updateTicket(ticketId, {}, actor, { ...(options || {}), assignments: assignments || [] });
  },

  /**
   * Eski atama kayıtlarını tamamlar (en iyi çaba; yalnız yönetici roller yazabilir):
   *  - gerçek kayıtta eksik personel e-postası doldurulur,
   *  - atama düğümü olmayan eski talepte sanal birincil danışman TAM kayıt olarak yazılır
   *    (yalnız e-posta içeren eksik kayıt "— — 0" satırı üretmesin).
   */
  async backfillAssignmentEmails(ticketId, assignments, personnel) {
    const fb = getFirebase();
    const byId = new Map((personnel || []).map((p) => [p.personnel_id || p.id, p]));
    const updates = {};
    for (const a of assignments || []) {
      const pid = a.personnel_id || a.id;
      const person = byId.get(pid);
      // Pasif personelin adresi atama kopyasına yazılmaz (ona müşteri yanıtı gitmesin; YON-04).
      const email = person?.is_active === false ? "" : String(person?.email || "").trim().toLowerCase();
      if (!pid) continue;
      if (a.virtual) {
        updates[`ticket_assignments/${ticketId}/${pid}`] = {
          personnel_id: pid,
          personnel_name: a.personnel_name || [person?.first_name, person?.last_name].filter(Boolean).join(" "),
          personnel_email: email,
          is_primary: true,
          assigned_at: a.assigned_at || nowIso(),
        };
        if (person?.uid) updates[`tickets/${ticketId}/assigned_uids/${person.uid}`] = true;
      } else if (email && !a.personnel_email) {
        updates[`ticket_assignments/${ticketId}/${pid}/personnel_email`] = email;
      }
    }
    if (!Object.keys(updates).length) return false;
    await fb.db.update(rootV2Ref(), updates);
    return true;
  },

  async getTicketEfforts(ticketId) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`ticket_efforts/${ticketId}`));
    return snapshotToArray(snap)
      .map((e) => ({ ...e, effort_id: e.effort_id || e.id }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async recalculateTicketEffort(ticketId) {
    const efforts = await this.getTicketEfforts(ticketId);
    const total = efforts.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
    const fb = getFirebase();
    await fb.db.update(v2Ref(`tickets/${ticketId}`), {
      total_work_hours: Math.round(total * 100) / 100,
    });
    return total;
  },

  /**
   * Efor ekler (K-PER-9 A): 0,25–24 saat, 0,25 adım, son 30 gün, İstanbul takvim günü.
   * Efor kaydı + toplam saat + son güncelleme TEK atomik yazımdır.
   */
  async addTicketEffort(ticketId, data, actor) {
    const fb = getFirebase();
    const ts = nowIso();
    const af = actorFields(actor);
    const check = validateEffortInput({ hours: data.hours, workDate: data.work_date, note: data.note });
    if (!check.valid) throw makeError(Object.values(check.errors)[0], "invalid_effort");
    const id = newChildKey(`ticket_efforts/${ticketId}`);

    const payload = {
      effort_id: id,
      personnel_id: data.personnel_id || "",
      personnel_name: data.personnel_name || af.created_by_name || "",
      hours: check.hours,
      work_date: check.workDate,
      note: check.note,
      created_at: ts,
      created_by_uid: af.created_by,
      created_by_name: af.created_by_name,
    };
    const existingEfforts = await this.getTicketEfforts(ticketId);
    const total = existingEfforts.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0) + check.hours;
    await fb.db.update(rootV2Ref(), {
      [`ticket_efforts/${ticketId}/${id}`]: payload,
      [`tickets/${ticketId}/total_work_hours`]: Math.round(total * 100) / 100,
      [`tickets/${ticketId}/updated_at`]: ts,
    });
    return { id, ...payload };
  },

  /**
   * Efor kaydını siler; toplam saat ve izlenebilir bir geçmiş satırı aynı atomik yazımda gider.
   * (Kimin silebileceği arayüz + kurallarla sınırlıdır.)
   */
  async deleteTicketEffort(ticketId, effortId, actor) {
    const fb = getFirebase();
    const efforts = await this.getTicketEfforts(ticketId);
    const target = efforts.find((e) => (e.effort_id || e.id) === effortId);
    const rest = efforts.filter((e) => (e.effort_id || e.id) !== effortId);
    const total = rest.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);
    const out = {
      [`ticket_efforts/${ticketId}/${effortId}`]: null,
      [`tickets/${ticketId}/total_work_hours`]: Math.round(total * 100) / 100,
    };
    if (actor && target) {
      const af = actorFields(actor);
      const hKey = newChildKey(`ticket_history/${ticketId}`);
      out[`ticket_history/${ticketId}/${hKey}`] = {
        history_id: hKey,
        action: "effort_deleted",
        field_changed: "effort",
        old_value: `${target.hours} saat — ${target.personnel_name || "—"} (${target.work_date || "—"})`,
        new_value: "",
        note: String(target.note || "").slice(0, 500),
        changed_by_uid: af.created_by,
        changed_by_name: af.created_by_name,
        changed_at: nowIso(),
      };
    }
    await fb.db.update(rootV2Ref(), out);
  },

  async getAllTicketEfforts() {
    const fb = getFirebase();
    try {
      const snap = await fb.db.get(v2Ref("ticket_efforts"));
      if (!snap.exists()) return [];
      const val = snap.val();
      const items = [];
      for (const ticketId of Object.keys(val || {})) {
        for (const effortId of Object.keys(val[ticketId] || {})) {
          items.push({
            id: effortId,
            effort_id: effortId,
            ticket_id: ticketId,
            ...val[ticketId][effortId],
          });
        }
      }
      return items;
    } catch (err) {
      const code = String(err?.code || err?.message || "").toLowerCase();
      if (!code.includes("permission")) throw err;

      const tickets = await this.getAllTickets();
      const batches = await Promise.all(
        tickets.map((t) => {
          const tid = getTicketKey(t);
          return tid ? this.getTicketEfforts(tid) : Promise.resolve([]);
        })
      );
      return batches.flat().map((e) => ({
        ...e,
        ticket_id: e.ticket_id || e.id,
      }));
    }
  },

  async addTicketHistory(ticketId, entry) {
    const fb = getFirebase();
    const ref = fb.db.push(v2Ref(`ticket_history/${ticketId}`));
    const id = ref.key;
    const payload = {
      history_id: id,
      action: entry.action || "updated",
      field_changed: entry.field_changed || "",
      old_value: entry.old_value || "",
      new_value: entry.new_value || "",
      changed_by_uid: entry.changed_by_uid || "",
      changed_by_name: entry.changed_by_name || "",
      changed_at: entry.changed_at || nowIso(),
      note: entry.note || "",
    };
    await fb.db.set(ref, payload);
    return { id, ...payload };
  },

  async getTicketHistory(ticketId) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`ticket_history/${ticketId}`));
    const items = snapshotToArray(snap);
    return items
      .map((h) => ({ ...h, history_id: h.history_id || h.id }))
      .sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
  },

  async logActivity(action, entityType, entityId, entityLabel, details, actor) {
    const fb = getFirebase();
    const ref = fb.db.push(v2Ref("activities"));
    const id = ref.key;
    const af = actorFields(actor);
    const payload = {
      activity_id: id,
      action: action || "",
      entity_type: entityType || "",
      entity_id: entityId || "",
      entity_label: entityLabel || "",
      user_uid: af.created_by,
      user_name: af.created_by_name,
      details: details || "",
      created_at: nowIso(),
    };
    await fb.db.set(ref, payload);
    return { id, ...payload };
  },

  async getActivities(limit) {
    const fb = getFirebase();
    const listRef = v2Ref("activities");
    let snap;
    if (limit) {
      const q = fb.db.query(listRef, fb.db.limitToLast(limit));
      snap = await fb.db.get(q);
    } else {
      snap = await fb.db.get(listRef);
    }
    const items = snapshotToArray(snap);
    return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  /**
   * Aktiviteleri sunucuda süzerek getirir (`entity_id` / `user_uid` gibi indeksli alanlar): detay sayfaları son N kayıttan
   * istemci tarafında süzmek yerine ilgili kayıtları doğrudan okur (OLC-09). En yeni önce.
   */
  async getActivitiesByField(field, value, limit) {
    const fb = getFirebase();
    const parts = [fb.db.orderByChild(field), fb.db.equalTo(value)];
    if (limit) parts.push(fb.db.limitToLast(limit));
    const snap = await fb.db.get(fb.db.query(v2Ref("activities"), ...parts));
    return snapshotToArray(snap).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async getAllContracts() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("contracts"));
    return snapshotToArray(snap).map((c) => ({
      ...c,
      contract_id: c.contract_id || c.id,
    }));
  },

  async createContract(data) {
    const fb = getFirebase();
    const ts = nowIso();
    const ref = fb.db.push(v2Ref("contracts"));
    const id = ref.key;
    const payload = {
      contract_id: id,
      contract_number: data.contract_number || "",
      company_id: data.company_id || "",
      company_name: data.company_name || "",
      type: data.type || "yillik",
      start_date: data.start_date || "",
      end_date: data.end_date || "",
      status: data.status || "active",
      // Bedel `contracts` altında TUTULMAZ (kural: contracts/<id>/value yazılamaz); bkz. contract_values / saveContract.
      notes: data.notes || "",
      created_at: ts,
      created_by: data.created_by || "",
      updated_at: ts,
      updated_by: data.updated_by || "",
    };
    await fb.db.set(ref, payload);
    return { id, ...payload };
  },

  async updateContract(id, data) {
    const fb = getFirebase();
    const updates = { ...data, updated_at: nowIso() };
    delete updates.contract_id;
    delete updates.id;
    delete updates.value; // bedel yalnızca contract_values düğümünde (saveContract)
    await fb.db.update(v2Ref(`contracts/${id}`), updates);
    const snap = await fb.db.get(v2Ref(`contracts/${id}`));
    return snap.exists() ? { contract_id: id, id, ...snap.val() } : null;
  },

  /**
   * Sözleşme bedelleri `contract_values/<id>` (yalnız super/service okur-yazar; PM/danışman GÖRMEZ).
   * @returns {Promise<Record<string, {value:number, currency?:string}>>}
   */
  async getContractValues() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("contract_values"));
    return snap.exists() ? snap.val() || {} : {};
  },

  /**
   * Sözleşmeyi kaydeder: sözleşme alanları + bedel (`contract_values`) + eski `contracts/<id>/value` temizliği +
   * firmanın `has_contract`/`contract_id` bayrağı (sözleşmelerden TÜRETİLİR; eski firma da yeniden hesaplanır)
   * TEK atomik çok yollu yazımdır.
   * @param {{id?: string, data: object, value: number|null, canWriteValue?: boolean, actor: object}} input
   */
  async saveContract(input) {
    const fb = getFirebase();
    const ts = nowIso();
    const af = actorFields(input.actor);
    const data = input.data || {};
    const isEdit = !!input.id;
    const id = input.id || newChildKey("contracts");
    const existingSnap = isEdit ? await fb.db.get(v2Ref(`contracts/${id}`)) : null;
    const previous = existingSnap && existingSnap.exists() ? existingSnap.val() : null;
    if (isEdit && !previous) throw makeError("Sözleşme bulunamadı.", "not_found");

    const fields = {
      contract_number: data.contract_number || "",
      company_id: data.company_id || "",
      company_name: data.company_name || "",
      type: data.type || "yillik",
      start_date: data.start_date || "",
      end_date: data.end_date || "",
      status: data.status || "active",
      notes: data.notes || "",
      updated_at: ts,
      updated_by: af.updated_by,
    };
    const out = {};
    const merged = { ...(previous || {}), ...fields, contract_id: id, id };
    if (isEdit) {
      for (const [k, v] of Object.entries(fields)) out[`contracts/${id}/${k}`] = v;
      if (previous && previous.value !== undefined) out[`contracts/${id}/value`] = null; // eski kayıttaki bedeli kaldır (göç)
    } else {
      out[`contracts/${id}`] = { contract_id: id, ...fields, created_at: ts, created_by: af.created_by };
      merged.created_at = ts;
    }
    if (input.canWriteValue !== false) {
      out[`contract_values/${id}`] =
        input.value === null || input.value === undefined
          ? null
          : { value: input.value, currency: "TRY", updated_at: ts, updated_by: af.updated_by };
    }

    // Firma bayrakları: etkilenen firmalar (yeni + eski) sözleşmelerinden yeniden türetilir.
    const affected = new Set([fields.company_id]);
    if (previous && previous.company_id && previous.company_id !== fields.company_id) affected.add(previous.company_id);
    for (const companyId of affected) {
      if (!companyId) continue;
      const list = (await queryByChild("contracts", "company_id", companyId)).filter((c) => c.id !== id);
      if (companyId === fields.company_id) list.push(merged);
      const summary = summarizeContracts(list);
      out[`companies/${companyId}/has_contract`] = summary.hasActive;
      out[`companies/${companyId}/contract_id`] = summary.activeContractId || "";
    }
    await fb.db.update(rootV2Ref(), out);
    return { id, ...merged };
  },

  async getAllProjects() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("projects"));
    return snapshotToArray(snap).map((p) => ({
      ...p,
      project_id: p.project_id || p.id,
    }));
  },

  async getProject(id) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`projects/${id}`));
    if (!snap.exists()) return null;
    return { project_id: id, id, ...snap.val() };
  },

  async createProject(data) {
    const fb = getFirebase();
    const ts = nowIso();
    const ref = fb.db.push(v2Ref("projects"));
    const id = ref.key;
    const payload = {
      project_id: id,
      project_code: data.project_code || "",
      name: data.name || "",
      company_id: data.company_id || "",
      company_name: data.company_name || "",
      customer_code: data.customer_code || "",
      status: data.status || "planning",
      start_date: data.start_date || "",
      end_date: data.end_date || "",
      description: data.description || "",
      // Yönetici: kullanıcı kimliği (manager_uid; personel kaydına bağlıysa) + personel kimliği + ad. "Seçiniz" kaydedilmez.
      manager_uid: data.manager_uid || "",
      manager_personnel_id: data.manager_personnel_id || "",
      manager_name: cleanManagerName(data.manager_name),
      assigned_personnel: data.assigned_personnel || {},
      created_at: ts,
      created_by: data.created_by || "",
      updated_at: ts,
      updated_by: data.updated_by || "",
    };
    await fb.db.set(ref, payload);
    return { id, ...payload };
  },

  async updateProject(id, data) {
    const fb = getFirebase();
    const updates = { ...data, updated_at: nowIso() };
    delete updates.project_id;
    delete updates.id;
    if (updates.manager_name !== undefined) updates.manager_name = cleanManagerName(updates.manager_name);
    await fb.db.update(v2Ref(`projects/${id}`), updates);
    return this.getProject(id);
  },

  /**
   * Bir sonraki proje kodu (PRJ0001…). Mevcut kodların en büyüğü + 1; yazmadan hemen önce indeksli sorguyla
   * çakışma yeniden denetlenir (eşzamanlı iki yönetici aynı kodu almasın; YON-20).
   */
  async generateProjectCode() {
    const projects = await this.getAllProjects();
    let max = 0;
    for (const p of projects) {
      const m = String(p.project_code || "").match(/^PRJ(\d+)$/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    let next = max + 1;
    for (let i = 0; i < 20; i += 1, next += 1) {
      const code = `PRJ${String(next).padStart(4, "0")}`;
      const dup = await queryByChild("projects", "project_code", code);
      if (!dup.length) return code;
    }
    return `PRJ${String(next).padStart(4, "0")}`;
  },

  async getAllDepartments() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("departments"));
    return snapshotToArray(snap).map((d) => ({
      ...d,
      department_id: d.department_id || d.id,
    }));
  },

  async createDepartment(data) {
    return pushWithId("departments", {
      name: data.name || "",
      description: data.description || "",
      is_active: data.is_active !== false,
      created_by: data.created_by || "",
      updated_by: data.updated_by || "",
    });
  },

  async updateDepartment(id, data) {
    const fb = getFirebase();
    const updates = { ...data, updated_at: nowIso() };
    delete updates.department_id;
    delete updates.id;
    await fb.db.update(v2Ref(`departments/${id}`), updates);
    const snap = await fb.db.get(v2Ref(`departments/${id}`));
    return snap.exists() ? { department_id: id, id, ...snap.val() } : null;
  },

  /** Departmanı KALICI siler (yalnız super_admin; personeli olmayan departman için arayüz sunar). */
  async deleteDepartment(id) {
    const fb = getFirebase();
    await fb.db.remove(v2Ref(`departments/${id}`));
  },

  /** Departmanı günceller; ad değiştiyse personel kayıtlarındaki `department_name` kopyaları yayılır (YON-09). */
  async updateDepartmentAndSync(id, data) {
    const department = await this.updateDepartment(id, data);
    let synced = 0;
    let failed = "";
    if (department && data.name !== undefined) {
      try {
        const personnel = await queryByChild("personnel", "department_id", id);
        synced = await commitPaths(planDepartmentCopies({ ...department, department_id: id }, personnel.map((p) => ({ ...p, personnel_id: p.id }))));
      } catch (err) {
        failed = String(err?.message || err || "bilinmeyen hata");
      }
    }
    return { department, synced, failed };
  },

  async getAllSapModules() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("sap_modules"));
    return snapshotToArray(snap).map((m) => ({
      ...m,
      module_code: m.module_code || m.code || m.id,
    }));
  },

  async createSapModule(data) {
    const fb = getFirebase();
    const code = String(data.code || data.module_code || "").toUpperCase();
    const ts = nowIso();
    const payload = {
      code,
      module_code: code,
      name: data.name || "",
      is_active: data.is_active !== false,
      ticket_count: data.ticket_count || 0,
      created_at: ts,
      updated_at: ts,
    };
    await fb.db.set(v2Ref(`sap_modules/${code}`), payload);
    return { id: code, ...payload };
  },

  async updateSapModule(code, data) {
    const fb = getFirebase();
    const key = String(code); // anahtar olduğu gibi kullanılır: büyük harfe çevirmek eski/küçük harfli kayıtlarda hayalet kayıt doğurur (YON-23)
    const updates = { ...data, updated_at: nowIso() };
    await fb.db.update(v2Ref(`sap_modules/${key}`), updates);
    const snap = await fb.db.get(v2Ref(`sap_modules/${key}`));
    return snap.exists() ? { module_code: key, id: key, ...snap.val() } : null;
  },

  async seedSapModulesIfEmpty() {
    const existing = await this.getAllSapModules();
    if (existing.length > 0) return existing;

    const defaults = [
      { code: "FI", name: "Finansal Muhasebe" },
      { code: "CO", name: "Yönetim Muhasebesi" },
      { code: "MM", name: "Malzeme Yönetimi" },
      { code: "SD", name: "Satış ve Dağıtım" },
      { code: "PP", name: "Üretim Planlama" },
      { code: "WM", name: "Depo Yönetimi" },
      { code: "HR", name: "İnsan Kaynakları" },
      { code: "BASIS", name: "Sistem Yönetimi" },
      { code: "ABAP", name: "Geliştirme" },
      { code: "Diğer", name: "Diğer" },
    ];

    const created = [];
    for (const mod of defaults) {
      created.push(await this.createSapModule(mod));
    }
    return created;
  },

  async getAllSupportTypes() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("support_types"));
    return snapshotToArray(snap).map((t) => ({
      ...t,
      type_code: t.type_code || t.code || t.id,
    }));
  },

  async createSupportType(data) {
    const fb = getFirebase();
    const code = String(data.code || data.type_code || "").toUpperCase();
    const ts = nowIso();
    const payload = {
      code,
      type_code: code,
      name: data.name || "",
      description: data.description || "",
      color: data.color || "#0070f2",
      is_active: data.is_active !== false,
      created_at: ts,
      updated_at: ts,
    };
    await fb.db.set(v2Ref(`support_types/${code}`), payload);
    return { id: code, ...payload };
  },

  async updateSupportType(code, data) {
    const fb = getFirebase();
    const key = String(code); // bkz. updateSapModule (hayalet kayıt önleme)
    const updates = { ...data, updated_at: nowIso() };
    await fb.db.update(v2Ref(`support_types/${key}`), updates);
    const snap = await fb.db.get(v2Ref(`support_types/${key}`));
    return snap.exists() ? { type_code: key, id: key, ...snap.val() } : null;
  },

  async seedSupportTypesIfEmpty() {
    const existing = await this.getAllSupportTypes();
    if (existing.length > 0) return existing;

    const defaults = [
      { code: "SUP", name: "Destek Anlaşmalı Talep", color: "#0070f2" },
      { code: "ARZ", name: "Arızi Talep", color: "#c47a00" },
      { code: "PRJ", name: "Proje Taskı", color: "#0d7d4d" },
      { code: "INT", name: "İç Task", color: "#6b7280" },
      { code: "DEV", name: "Geliştirme Taskı", color: "#7c3aed" },
      { code: "BUG", name: "Hata / Problem Kaydı", color: "#c41e3a" },
    ];

    const created = [];
    for (const t of defaults) {
      created.push(await this.createSupportType(t));
    }
    return created;
  },

  /* ---------------------------------------------------------------- *
   * Hazır yanıt şablonları (WP-16): okuma personel, yazma yöneticiler (super/service)
   * ---------------------------------------------------------------- */

  async getAllReplyTemplates() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("reply_templates"));
    return snapshotToArray(snap).map((t) => ({ ...t, template_id: t.id }));
  },

  async createReplyTemplate(data, actor) {
    const fb = getFirebase();
    const ts = nowIso();
    const af = actorFields(actor);
    const ref = fb.db.push(v2Ref("reply_templates"));
    const payload = {
      template_id: ref.key,
      title: String(data.title || "").trim(),
      body: String(data.body || "").trim(),
      category: String(data.category || "").trim(),
      is_active: data.is_active !== false,
      sort_order: Number(data.sort_order) || 0,
      created_at: ts,
      created_by: af.created_by,
      updated_at: ts,
      updated_by: af.updated_by,
    };
    await fb.db.set(ref, payload);
    return { id: ref.key, ...payload };
  },

  async updateReplyTemplate(id, data, actor) {
    const fb = getFirebase();
    const af = actorFields(actor);
    const updates = { updated_at: nowIso(), updated_by: af.updated_by };
    if (data.title !== undefined) updates.title = String(data.title).trim();
    if (data.body !== undefined) updates.body = String(data.body).trim();
    if (data.category !== undefined) updates.category = String(data.category).trim();
    if (data.is_active !== undefined) updates.is_active = !!data.is_active;
    if (data.sort_order !== undefined) updates.sort_order = Number(data.sort_order) || 0;
    await fb.db.update(v2Ref(`reply_templates/${id}`), updates);
    return updates;
  },

  async deleteReplyTemplate(id) {
    const fb = getFirebase();
    await fb.db.remove(v2Ref(`reply_templates/${id}`));
  },

  /* ---------------------------------------------------------------- *
   * Toplu talep güncelleme (WP-16)
   * ---------------------------------------------------------------- */

  /**
   * Toplu talep güncelleme: her talebin yolları `updateTicket` (collect modu) ile ÜRETİLİR — durum matrisi, damgalar,
   * SLA, geçmiş satırları ve atama haritası tek yerden gelir — ve 20'şer talepte TEK atomik çok yollu `update` ile
   * yazılır. Bir parça kural/çakışma nedeniyle reddedilirse o parçadaki talepler tek tek denenir; başarısızlar `error` ile döner.
   * Özet aktivite kaydını çağıran yazar (tek kayıt).
   * @param {Array<{id: string, updates?: object, options?: object}>} items
   * @param {object} actor oturum
   * @param {{personnel?: object[]}} [options]
   * @returns {Promise<Array<{id: string, ok: boolean, ticket?: object, report?: object, error?: Error}>>} items sırasıyla
   */
  async bulkUpdateTickets(items, actor, options) {
    const fb = getFirebase();
    const opts = options || {};
    const planned = [];
    const results = new Map();
    let cursor = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        const collect = {};
        const report = {};
        try {
          const ticket = await this.updateTicket(item.id, item.updates || {}, actor, {
            ...(item.options || {}),
            collect,
            report,
            personnel: opts.personnel,
          });
          planned.push({ id: item.id, paths: collect.paths || {}, ticket, report });
        } catch (error) {
          results.set(item.id, { id: item.id, ok: false, error });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, items.length) }, worker));

    const BATCH = 20;
    for (let i = 0; i < planned.length; i += BATCH) {
      const chunk = planned.slice(i, i + BATCH);
      try {
        await fb.db.update(rootV2Ref(), Object.assign({}, ...chunk.map((c) => c.paths)));
        for (const c of chunk) results.set(c.id, { id: c.id, ok: true, ticket: c.ticket, report: c.report });
      } catch {
        for (const c of chunk) {
          try {
            await fb.db.update(rootV2Ref(), c.paths);
            results.set(c.id, { id: c.id, ok: true, ticket: c.ticket, report: c.report });
          } catch (error) {
            results.set(c.id, { id: c.id, ok: false, error });
          }
        }
      }
    }
    return items.map((it) => results.get(it.id) || { id: it.id, ok: false, error: new Error("İşlenemedi") });
  },
};

export { ParlaDb, snapshotToArray, v2Ref, waitForFirebase };
export default ParlaDb;
