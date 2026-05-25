/**
 * Parla BT Ticket V2 — Firebase Realtime Database istemcisi
 */
import { nowIso, generateTicketNumber } from "./ticket-utils.js";

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

function snapshotToArray(snapshot) {
  if (!snapshot || !snapshot.exists()) return [];
  const val = snapshot.val();
  if (!val || typeof val !== "object") return [];
  return Object.keys(val).map((key) => {
    const item = val[key];
    if (item && typeof item === "object" && !item.id) {
      return { ...item, id: key };
    }
    return { id: key, ...(typeof item === "object" ? item : { value: item }) };
  });
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
    return this.getUserProfile(uid);
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
      email: data.email || "",
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
    await fb.db.update(v2Ref(`personnel/${id}`), updates);
    return this.getPersonnel(id);
  },

  async getAllTickets() {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref("tickets"));
    return snapshotToArray(snap).map((t) => ({
      ...t,
      ticket_id: t.ticket_id || t.id,
    }));
  },

  async getTicketsForUser(uid) {
    const fb = getFirebase();
    const q = fb.db.query(
      v2Ref("tickets"),
      fb.db.orderByChild("user_id"),
      fb.db.equalTo(uid)
    );
    const snap = await fb.db.get(q);
    return snapshotToArray(snap).map((t) => ({
      ...t,
      ticket_id: t.ticket_id || t.id,
    }));
  },

  async getTicketsForCompany(companyId) {
    const fb = getFirebase();
    const q = fb.db.query(
      v2Ref("tickets"),
      fb.db.orderByChild("company_id"),
      fb.db.equalTo(companyId)
    );
    const snap = await fb.db.get(q);
    return snapshotToArray(snap).map((t) => ({
      ...t,
      ticket_id: t.ticket_id || t.id,
    }));
  },

  async getPersonnelTickets(personnelId) {
    const fb = getFirebase();
    const q = fb.db.query(
      v2Ref("tickets"),
      fb.db.orderByChild("assigned_to_id"),
      fb.db.equalTo(personnelId)
    );
    const snap = await fb.db.get(q);
    return snapshotToArray(snap).map((t) => ({
      ...t,
      ticket_id: t.ticket_id || t.id,
    }));
  },

  async getTicket(id) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`tickets/${id}`));
    if (!snap.exists()) return null;
    return { ticket_id: id, id, ...snap.val() };
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

  async updateTicket(id, updates, actor) {
    const fb = getFirebase();
    const existing = await this.getTicket(id);
    if (!existing) {
      throw new Error("Ticket bulunamadı.");
    }

    const ts = nowIso();
    const af = actorFields(actor);
    const patch = { ...updates, updated_at: ts, updated_by: af.updated_by };
    delete patch.ticket_id;
    delete patch.id;

    const historyFields = ["status", "priority", "assigned_to_id", "assigned_to_name"];
    for (const field of historyFields) {
      if (patch[field] !== undefined && String(patch[field]) !== String(existing[field] || "")) {
        await this.addTicketHistory(id, {
          action: `${field}_changed`,
          field_changed: field,
          old_value: String(existing[field] || ""),
          new_value: String(patch[field] || ""),
          changed_by_uid: af.created_by,
          changed_by_name: af.created_by_name,
          changed_at: ts,
        });
      }
    }

    if (patch.status === "resolved" && !existing.resolved_at) {
      patch.resolved_at = ts;
    }
    if (patch.status === "closed" && !existing.closed_at) {
      patch.closed_at = ts;
    }

    await fb.db.update(v2Ref(`tickets/${id}`), patch);
    return this.getTicket(id);
  },

  async deleteTicket(id) {
    const fb = getFirebase();
    await fb.db.remove(v2Ref(`tickets/${id}`));
  },

  async getTicketMessages(ticketId) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`ticket_messages/${ticketId}`));
    const items = snapshotToArray(snap);
    return items
      .map((m) => ({ ...m, message_id: m.message_id || m.id }))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  },

  async addTicketMessage(ticketId, data) {
    const fb = getFirebase();
    const ts = nowIso();
    const ref = fb.db.push(v2Ref(`ticket_messages/${ticketId}`));
    const id = ref.key;
    const payload = {
      message_id: id,
      user_id: data.user_id || "",
      author_name: data.author_name || "",
      author_email: data.author_email || "",
      author_role: data.author_role || "customer",
      message: data.message || "",
      is_internal: !!data.is_internal,
      work_hours: data.work_hours || 0,
      created_at: ts,
    };
    await fb.db.set(ref, payload);

    const ticketUpdates = { updated_at: ts };
    if (data.work_hours && data.work_hours > 0) {
      const ticket = await this.getTicket(ticketId);
      if (ticket) {
        ticketUpdates.total_work_hours =
          (parseFloat(ticket.total_work_hours) || 0) + parseFloat(data.work_hours);
      }
    }
    await fb.db.update(v2Ref(`tickets/${ticketId}`), ticketUpdates);

    return { id, ...payload };
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
      value: data.value || null,
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
    await fb.db.update(v2Ref(`contracts/${id}`), updates);
    const snap = await fb.db.get(v2Ref(`contracts/${id}`));
    return snap.exists() ? { contract_id: id, id, ...snap.val() } : null;
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
      customer_code: data.customer_code || "",
      status: data.status || "planning",
      start_date: data.start_date || "",
      end_date: data.end_date || "",
      description: data.description || "",
      manager_uid: data.manager_uid || "",
      manager_name: data.manager_name || "",
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
    await fb.db.update(v2Ref(`projects/${id}`), updates);
    return this.getProject(id);
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
    const key = String(code).toUpperCase();
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
    const key = String(code).toUpperCase();
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

  async getNotifications(uid) {
    const fb = getFirebase();
    const snap = await fb.db.get(v2Ref(`notifications/${uid}`));
    const items = snapshotToArray(snap);
    return items
      .map((n) => ({ ...n, notif_id: n.notif_id || n.id }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async addNotification(uid, data) {
    const fb = getFirebase();
    const ref = fb.db.push(v2Ref(`notifications/${uid}`));
    const id = ref.key;
    const payload = {
      notif_id: id,
      type: data.type || "info",
      title: data.title || "",
      body: data.body || "",
      link: data.link || "",
      is_read: false,
      created_at: nowIso(),
    };
    await fb.db.set(ref, payload);
    return { id, ...payload };
  },

  async markNotificationRead(uid, notifId) {
    const fb = getFirebase();
    await fb.db.update(v2Ref(`notifications/${uid}/${notifId}`), {
      is_read: true,
      read_at: nowIso(),
    });
  },
};

export { ParlaDb, snapshotToArray, v2Ref, waitForFirebase };
export default ParlaDb;
