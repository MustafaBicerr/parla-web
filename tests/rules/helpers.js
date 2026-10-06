/**
 * tests/rules ortak yardımcıları: bağımsız (e2e'den bağımsız) örnek veri, aktörler ve yetki sarmalayıcıları.
 * Kullananlar: database-rules.test.js, matrix.test.js. RULES_FILE ile başka bir kural dosyası denenebilir.
 */
const path = require("node:path");
const targaryen = require("targaryen");

const rulesPath = process.env.RULES_FILE || path.join(__dirname, "..", "..", "database.rules.json");
const rules = require(rulesPath);

const H = 3600 * 1000;
const D = 24 * H;
const T0 = Date.now();
const isoAt = (offsetMs) => new Date(T0 - (offsetMs || 0)).toISOString();
const ISO = isoAt(0);

// ----------------------------------------------------------------------------- kullanıcılar
const users = {
  u_root: { role: "super_admin", is_active: true, email: "root@parla-demo.com" },
  u_root2: { role: "super_admin", is_active: true, email: "root2@parla-demo.com" },
  u_service: { role: "service_admin", is_active: true, email: "service@parla-demo.com" },
  u_pm: { role: "project_manager", is_active: true, email: "pm@parla-demo.com" },
  u_cons: { role: "consultant", is_active: true, email: "cons@parla-demo.com" }, // t1/t6 atanmış
  u_cons2: { role: "consultant", is_active: true, email: "cons2@parla-demo.com" }, // hiçbir talebe atanmamış
  u_cust: { role: "customer", company_id: "cA", company_name: "Örnek A", customer_code: "ORN", is_active: true, email: "cust@ornek-a.com", last_login_at: isoAt(5 * H) },
  u_cust2: { role: "customer", company_id: "cA", company_name: "Örnek A", customer_code: "ORN", is_active: true, email: "cust2@ornek-a.com" },
  u_cadmin: { role: "company_admin", company_id: "cA", company_name: "Örnek A", customer_code: "ORN", is_active: true, email: "cadmin@ornek-a.com" },
  u_cadminB: { role: "company_admin", company_id: "cB", company_name: "Demir B", customer_code: "DMR", is_active: true, email: "cadminb@demir-b.com" },
  u_custB: { role: "customer", company_id: "cB", company_name: "Demir B", customer_code: "DMR", is_active: true, email: "custb@demir-b.com" },
  u_arizi: { role: "arizi_customer", company_id: "", customer_code: "ARZ0001", is_active: true, email: "arizi@ariz.com" },
  u_new: { role: "customer", company_id: "cA", company_name: "Örnek A", customer_code: "ORN", is_active: true, must_change_password: true, email: "new@ornek-a.com" },
  u_inact_cons: { role: "consultant", is_active: false, email: "eski-cons@parla-demo.com" },
  u_inact_cust: { role: "customer", company_id: "cA", company_name: "Örnek A", customer_code: "ORN", is_active: false, email: "pasif@ornek-a.com" },
  u_inact_svc: { role: "service_admin", is_active: false, email: "eski-svc@parla-demo.com" },
  u_nocomp: { role: "customer", is_active: true, email: "nocomp@x.com" }, // company_id alanı hiç yok
};
const noProfileEmail = "ghost@x.com"; // Auth hesabı var ama v2/users/<uid> yok (açık kayıt)

// ----------------------------------------------------------------------------- aktörler (matris sütunları)
const ACTORS = [
  ["anon", null],
  ["noprofile", "u_noprofile"],
  ["root", "u_root"],
  ["service", "u_service"],
  ["pm", "u_pm"],
  ["cons", "u_cons"],
  ["cons2", "u_cons2"],
  ["cust", "u_cust"],
  ["cust2", "u_cust2"],
  ["cadmin", "u_cadmin"],
  ["custB", "u_custB"],
  ["arizi", "u_arizi"],
  ["new", "u_new"],
  ["inactCons", "u_inact_cons"],
  ["inactCust", "u_inact_cust"],
  ["inactSvc", "u_inact_svc"],
  ["nocomp", "u_nocomp"],
];
const emailOf = (uid) => (uid === "u_noprofile" ? noProfileEmail : String((users[uid] || {}).email || "")).toLowerCase();
/** Oturum nesnesi: gerçek Firebase'de olduğu gibi auth.token.email içerir. */
const authOf = (uid) => (uid ? { uid, token: { email: emailOf(uid) } } : null);
const isStaffUid = (uid) => ["super_admin", "service_admin", "project_manager", "consultant"].includes((users[uid] || {}).role);
const roleOf = (uid) => (users[uid] || {}).role || "";

// ----------------------------------------------------------------------------- talepler
let seq = 0;
function ticket(id, over) {
  seq += 1;
  const o = over || {};
  const base = {
    ticket_id: id,
    ticket_number: `SUP-ORN-FI-2610-${String(seq).padStart(4, "0")}`,
    ticket_type: "SUP",
    customer_code: "ORN",
    company_id: "cA",
    company_name: "Örnek A",
    user_id: "u_cust",
    user_name: "Ayşe Demir",
    user_email: "cust@ornek-a.com",
    title: "Örnek talep " + id,
    description: "Açıklama " + id,
    priority: "medium",
    sap_module: "FI",
    status: "open",
    assigned_to_id: "",
    assigned_to_name: "",
    attachment_url: "",
    total_work_hours: 0,
    project_id: "",
    sequence_number: seq,
    created_at: isoAt(3 * D),
    created_by: "u_cust",
    updated_at: isoAt(2 * D),
    updated_by: "u_cust",
  };
  return Object.assign(base, o);
}

function buildData() {
  seq = 0;
  const tickets = {
    t1: ticket("t1", { status: "in_progress", priority: "high", assigned_to_id: "p1", assigned_to_name: "P1", assigned_uids: { u_cons: true }, started_at: isoAt(2 * D) }),
    t2: ticket("t2", { status: "open" }),
    t3: ticket("t3", { status: "waiting_customer", assigned_to_id: "p1", assigned_uids: { u_cons: true }, sla_paused_since: isoAt(1 * D), sla_paused_ms: 1000, sla_response_breached_at: isoAt(2 * D) }),
    t4: ticket("t4", { status: "pending_close", assigned_to_id: "p1", assigned_uids: { u_cons: true }, resolved_at: isoAt(1 * D) }),
    t5: ticket("t5", { status: "closed", closed_at: isoAt(10 * D), closed_at_ms: T0 - 10 * D, resolved_at: isoAt(11 * D) }),
    t6: ticket("t6", { status: "assigned", assigned_to_id: "p1", assigned_uids: { u_cons: true } }),
    t7: ticket("t7", { status: "resolved", resolved_at: isoAt(1 * D) }),
    t9: ticket("t9", { user_id: "u_cust2", user_name: "Kemal", user_email: "cust2@ornek-a.com", created_by: "u_cust2", updated_by: "u_cust2" }),
    t10: ticket("t10", { company_id: "cB", company_name: "Demir B", customer_code: "DMR", user_id: "u_custB", user_email: "custb@demir-b.com", created_by: "u_custB", updated_by: "u_custB", ticket_number: "SUP-DMR-PP-2610-0010", sap_module: "PP" }),
    t11: ticket("t11", { ticket_type: "ARZ", ticket_number: "ARZ-ARZ0001-BASIS-2610-0011", customer_code: "ARZ0001", company_id: "", company_name: "", user_id: "u_arizi", user_email: "arizi@ariz.com", created_by: "u_arizi", updated_by: "u_arizi" }),
    t12: ticket("t12", { status: "closed", closed_at: isoAt(40 * D), closed_at_ms: T0 - 40 * D }),
    t13: ticket("t13", { status: "closed", closed_at: isoAt(5 * D) }), // eski kayıt: closed_at_ms yok
    t14: ticket("t14", { is_deleted: true, deleted_at: isoAt(1 * D), deleted_by: "u_service" }),
  };
  const msg = (id, uid, role, over) =>
    Object.assign({ message_id: id, user_id: uid, author_name: "X", author_email: emailOf(uid), author_role: role, message: "Merhaba " + id, is_internal: false, work_hours: 0, created_at: isoAt(1 * H) }, over || {});
  return {
    v2: {
      users: JSON.parse(JSON.stringify(users)),
      tickets,
      ticket_messages: { t1: { m1: msg("m1", "u_cust", "customer"), m2: msg("m2", "u_cons", "consultant") } },
      ticket_internal_notes: { t1: { n0: msg("n0", "u_cons", "consultant", { is_internal: true }) } },
      ticket_history: { t1: { h1: { history_id: "h1", action: "created", field_changed: "ticket", new_value: "SUP-ORN-FI-2610-0001", changed_by_uid: "u_cust", changed_by_name: "Ayşe", changed_at: isoAt(3 * D) } } },
      ticket_assignments: { t1: { p1: { personnel_id: "p1", personnel_name: "P1", personnel_email: "p1@parla-demo.com", is_primary: true, assigned_at: isoAt(2 * D) } } },
      ticket_efforts: { t1: { e1: { effort_id: "e1", personnel_id: "p1", personnel_name: "P1", hours: 1, work_date: isoAt(1 * D).slice(0, 10), note: "x", created_at: isoAt(1 * D), created_by_uid: "u_cons", created_by_name: "Cons" } } },
      ticket_attachments: { t1: { a1: att("u_cust", { att_id: "a1" }) } },
      ticket_internal_attachments: { t1: { i1: att("u_cons", { att_id: "i1" }) } },
      companies: { cA: { company_id: "cA", name: "Örnek A", customer_code: "ORN", customer_type: "CUS", is_active: true }, cB: { company_id: "cB", name: "Demir B", customer_code: "DMR", customer_type: "CUS", is_active: true } },
      personnel: { p1: { personnel_id: "p1", email: "cons@parla-demo.com", is_active: true } },
      contracts: { k1: { contract_id: "k1", company_id: "cA", status: "active" } },
      contract_values: { k1: { value: 100000, currency: "TRY" } },
      projects: { pr1: { project_id: "pr1", company_id: "cA", status: "active" } },
      activities: { a1: { activity_id: "a1", action: "ticket_created", user_uid: "u_cust", created_at: isoAt(1 * H) } },
      counters: { SUP: { ORN: { 2610: 12 }, DMR: { 2610: 10 } }, ARZ: { ARZ0001: { 2610: 1 } } },
      departments: { d1: { name: "D" } },
      sap_modules: { FI: { code: "FI" } },
      support_types: { SUP: { code: "SUP" } },
      reply_templates: { rt1: { template_id: "rt1", title: "Selam", body: "Merhaba {musteri_adi}", is_active: true } },
    },
  };
}

/** Geçerli bir ek yükü (varsayılan: PNG). */
function att(uid, over) {
  return Object.assign({ att_id: "a1", name: "ekran.png", type: "image/png", size: 1000, data: "AAAA", uploader_uid: uid, uploader_name: "X", created_at: ISO }, over || {});
}

/** targaryen veri tabanı; data verilmezse varsayılan örnek veri. */
function makeDb(data, r) {
  return targaryen.database(r || rules, data || buildData());
}

/** Müşteri talep yükü (oluşturma): kendi firması/kodu ile geçerli. */
function newTicketPayload(uid, over) {
  const p = users[uid] || {};
  return Object.assign(
    {
      ticket_id: "n1",
      ticket_number: "SUP-ORN-FI-2610-0099",
      ticket_type: "SUP",
      customer_code: p.customer_code || "",
      company_id: p.company_id || "",
      company_name: p.company_name || "",
      user_id: uid,
      user_name: "Ayşe Demir",
      user_email: emailOf(uid),
      title: "Yeni talep",
      description: "Açıklama",
      priority: "medium",
      sap_module: "FI",
      status: "open",
      assigned_to_id: "",
      assigned_to_name: "",
      attachment_url: "",
      total_work_hours: 0,
      project_id: "",
      sequence_number: 99,
      created_at: ISO,
      created_by: uid,
      updated_at: ISO,
      updated_by: uid,
    },
    over || {}
  );
}

const message = (uid, id, over) =>
  Object.assign(
    { message_id: id, user_id: uid, author_name: "X", author_email: emailOf(uid), author_role: isStaffUid(uid) ? roleOf(uid) : "customer", message: "merhaba", is_internal: false, work_hours: 0, created_at: ISO },
    over || {}
  );
const historyEntry = (uid, id, over) =>
  Object.assign({ history_id: id, action: "status_changed", field_changed: "status", old_value: "open", new_value: "in_progress", changed_by_uid: uid, changed_by_name: "X", changed_at: ISO, note: "" }, over || {});
const effort = (uid, id, over) =>
  Object.assign({ effort_id: id, personnel_id: "p1", personnel_name: "P1", hours: 1, work_date: ISO.slice(0, 10), note: "", created_at: ISO, created_by_uid: uid, created_by_name: "X" }, over || {});
const activity = (uid, id, over) =>
  Object.assign({ activity_id: id, action: "ticket_message", entity_type: "ticket", entity_id: "t1", entity_label: "SUP-ORN-FI-2610-0001", user_uid: uid, user_name: "X", details: "d", created_at: ISO }, over || {});

module.exports = {
  rules, rulesPath, targaryen, T0, H, D, ISO, isoAt, users, ACTORS, emailOf, authOf, isStaffUid, roleOf,
  buildData, makeDb, att, ticket, newTicketPayload, message, historyEntry, effort, activity,
};
