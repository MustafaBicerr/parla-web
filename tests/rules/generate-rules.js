/**
 * database.rules.json KAYNAĞI. Kuralları burada düzenleyin, sonra:
 *   node tests/rules/generate-rules.js        (database.rules.json'u yeniden üretir)
 *   cd tests/rules && npm test               (kuralları ve JSON'un güncelliğini doğrular)
 *
 * WP-03 (denetim raporu) sertleştirme paketi — özet:
 *  - ACTIVE: pasif (is_active=false) hesap hiçbir rolün yetkisini kullanamaz; HAS_PROFILE: profilsiz hesap
 *    talep/ek/mesaj yazamaz. Kendi profilini okuma açık kalır (istemci pasifliği görebilsin).
 *  - tickets/mesaj/not/geçmiş/efor/atama/ek/aktivite/sayaç için .validate: izinli alan listesi dışındaki her alan
 *    reddedilir ($other), uzunluk/enum/ISO biçimi, kimlik bağlama (user_uid === auth.uid, message_id === anahtar...).
 *  - Danışman (consultant) YAZMA yetkisi talebin `assigned_uids/<uid>: true` haritasına bağlıdır (D-08 A); okuma geniştir.
 *  - Silme (D-05 B): ticket düğümünü tamamen silme + cascade yalnızca super_admin; service_admin `is_deleted` ile
 *    yumuşak siler. Sözleşme bedelleri contract_values/<id> düğümünde tutulur ve yalnızca super_admin/service_admin tarafından okunur (D-08 A).
 *  - Müşteri: kapalı talebi yalnızca `closed_at_ms` + 14 gün içinde yeniden açar (SEN-40); kapalı/silinmiş talebe
 *    mesaj/ek yazamaz; talep türü kilidi (D-09 B): CUS -> SUP/BUG, ARC/arızı -> ARZ/BUG.
 *  - Yeni düğümler: reply_templates (okuma STAFF, yazma ADMIN); system_state / ops yalnız sunucu (istemciye kapalı);
 *    notifications kapalı.
 *
 * NOT: Kural dili ISO tarih dizesini sayıya çeviremez; bu yüzden "sunucu saatine yakınlık" ve "14 gün" denetimleri
 * sayısal (ms) alanlarla yapılır (closed_at_ms). ISO alanlar yalnızca biçim + yıl aralığı (2020–2049) ile sınırlanır.
 */

// --------------------------------------------------------------------------- yardımcılar
const ME = "root.child('v2/users').child(auth.uid)";
// Pasif hesap hiçbir rol yetkisi alamaz: tüm rol ifadeleri ACTIVE ile birleşir.
const ACTIVE = `${ME}.child('is_active').val() !== false`;
const ROLE = `${ME}.child('role').val()`;
const anyOf = (...roles) => `(${ACTIVE} && (${roles.map((r) => `${ROLE} === '${r}'`).join(" || ")}))`;
const is = (r) => anyOf(r);
const SUPER = is("super_admin");
const ADMIN = anyOf("super_admin", "service_admin");
const MANAGER = anyOf("super_admin", "service_admin", "project_manager");
const CONSULTANT = is("consultant");
const STAFF = anyOf("super_admin", "service_admin", "project_manager", "consultant");
const COMPANY_ADMIN = is("company_admin");
const CUSTOMER = anyOf("customer", "company_admin", "arizi_customer");

const MY_COMPANY = `${ME}.child('company_id').val()`;
const MY_COMPANY_SET = `(${ME}.child('company_id').exists() && ${MY_COMPANY} !== '')`;
// Açık kayıtla oluşturulmuş ama yönetici tarafından profili açılmamış (ya da pasif) hesapları dışarıda bırakır.
const HAS_PROFILE = `(${ME}.child('role').exists() && ${ACTIVE})`;
const TICKET = (id) => `root.child('v2/tickets').child(${id})`;
// Ticket'ın tarafı: AKTİF profili olan talep sahibi VEYA aynı firmanın firma yöneticisi.
const PARTY = (node) =>
  `(${HAS_PROFILE} && (${node}.child('user_id').val() === auth.uid || (${COMPANY_ADMIN} && ${MY_COMPANY_SET} && ${node}.child('company_id').val() === ${MY_COMPANY})))`;
const NOT_DELETED = (node) => `${node}.child('is_deleted').val() !== true`;
const PARTY_LIVE = (node) => `(${PARTY(node)} && ${NOT_DELETED(node)})`;
const OWNER = (id) => PARTY(TICKET(id));
// Müşteri yazımı yalnızca silinmemiş VE kapanmamış talepte (mesaj/ek).
const CUST_OPEN = (id) => `(${TICKET(id)}.child('status').val() !== 'closed' && ${NOT_DELETED(TICKET(id))})`;
// Danışman yazma yetkisi: talebe atanmış olmak (assigned_uids/<uid> === true). Yöneticiler (super/service/PM) serbest.
const CONS_ASSIGNED = (node) => `(${CONSULTANT} && ${node}.child('assigned_uids').child(auth.uid).val() === true)`;
const STAFF_WRITE = (id) => `(${MANAGER} || ${CONS_ASSIGNED(TICKET(id))})`;
// Talebi oluşturan personel, oluşturma sırasındaki geçmiş kaydını yazabilir (atama yapılmadan önce).
const HISTORY_WRITER = (id) => `(${STAFF_WRITE(id)} || (${STAFF} && ${TICKET(id)}.child('created_by').val() === auth.uid))`;
const AUTH = "auth != null";
const SUPER_DELETE = `${AUTH} && ${SUPER} && !newData.exists()`; // cascade silme: yalnızca super_admin, yalnızca null yazımı

const ROLES = ["super_admin", "service_admin", "project_manager", "consultant", "customer", "arizi_customer", "company_admin"];
const VALID_ROLES = ROLES.map((r) => `newData.val() === '${r}'`).join(" || ");
const STATUSES = ["open", "assigned", "in_progress", "waiting_customer", "pending_close", "resolved", "closed", "reopened"];
const PRIORITIES = ["low", "medium", "high", "critical"];
const TICKET_TYPES = ["SUP", "ARZ", "PRJ", "INT", "DEV", "BUG"];
const REOPEN_WINDOW_MS = 14 * 24 * 3600 * 1000;
const NEAR_NOW_MS = 10 * 60 * 1000; // sayısal damgalarda sunucu saatine izin verilen sapma

// ISO-8601 (yıl 2020–2049). Kural dili sayıya çeviremediği için yalnızca biçim denetlenir.
const ISO_RE = "^20[2-4][0-9]-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9](\\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$";
const TICKET_NUMBER_RE = `^[A-Z]{3}-[A-Za-z0-9_]{1,20}-[^<>"'&]{1,40}-[0-9]{4}-[0-9]{4,}$`;

const v = {
  str: (max) => `newData.isString() && newData.val().length <= ${max}`,
  bool: "newData.isBoolean()",
  iso: `newData.isString() && newData.val().matches(/${ISO_RE}/)`,
  enum: (list) => `newData.isString() && newData.val().matches(/^(${list.join("|")})$/)`,
  num: (min, max) => `newData.isNumber() && newData.val() >= ${min} && newData.val() <= ${max}`,
  // Yazılan sayısal damga sunucu saatine yakın olmalı (değişmeyen eski değer korunur).
  nearNow: `newData.isNumber() && (newData.val() === data.val() || (newData.val() <= now + ${NEAR_NOW_MS} && newData.val() >= now - ${NEAR_NOW_MS}))`,
};
const f = (expr) => ({ ".validate": expr });
/** İzinli alan listesi: tanımsız her alan reddedilir. */
const fields = (spec, extra) => Object.assign({}, spec, extra || {}, { $other: { ".validate": false } });
const present = (name) => `newData.child('${name}').exists()`;
const optional = (name, expr) => `(!${present(name)} || (${expr}))`;
const nd = (name) => `newData.child('${name}')`;

// --------------------------------------------------------------------------- tickets
const TICKET_FIELD_SPEC = {
  ticket_id: f(v.str(64)),
  ticket_number: f(`newData.isString() && newData.val().matches(/${TICKET_NUMBER_RE}/)`),
  ticket_type: f(v.enum(TICKET_TYPES)),
  customer_code: f(v.str(30)),
  company_id: f(v.str(128)),
  company_name: f(v.str(200)),
  user_id: f(v.str(128)),
  user_name: f(v.str(200)),
  user_email: f(v.str(254)),
  title: f(v.str(200)),
  description: f(v.str(10000)),
  priority: f(v.enum(PRIORITIES)),
  sap_module: f(v.str(30)),
  status: f(v.enum(STATUSES)),
  assigned_to_id: f(v.str(64)),
  assigned_to_name: f(v.str(200)),
  assigned_at: f(v.iso),
  started_at: f(v.iso),
  attachment_url: f(`newData.isString() && newData.val().length <= 2000 && (newData.val() === '' || newData.val().matches(/^https?:\\/\\//i))`),
  total_work_hours: f(v.num(0, 100000)),
  project_id: f(v.str(64)),
  sequence_number: f(v.num(0, 99999999)),
  created_at: f(v.iso),
  created_by: f(v.str(128)),
  updated_at: f(v.iso),
  updated_by: f(v.str(128)),
  public_updated_at: f(v.iso),
  public_updated_by: f(v.str(128)),
  first_response_at: f(v.iso),
  resolved_at: f(v.iso),
  closed_at: f(v.iso),
  reopened_at: f(v.iso),
  is_approved: f(v.bool),
  // SLA damgaları (istemci hesaplar; D-06 B): biçim burada, müşterinin yazabileceği yönler ticketChildren() içinde sınırlanır.
  sla_window: f(v.iso),
  sla_paused_ms: f(v.num(0, 31536000000)),
  sla_paused_since: f(v.iso),
  sla_response_breached_at: f(v.iso),
  sla_resolution_breached_at: f(v.iso),
  // Sayısal kapanış damgası (ms): 14 günlük yeniden açma penceresi için (kural dili ISO dizeyi sayıya çeviremez).
  closed_at_ms: f(v.nearNow),
  // Yumuşak silme (D-05 B): yalnızca ADMIN yazar; değişmeyen eski değer korunur.
  is_deleted: f(`newData.isBoolean() && (${ADMIN} || newData.val() === data.val())`),
  deleted_at: f(`newData.isString() && newData.val().matches(/${ISO_RE}/) && (${ADMIN} || newData.val() === data.val())`),
  deleted_by: f(`newData.isString() && newData.val().length <= 128 && (${ADMIN} || newData.val() === data.val())`),
  // Atanmış kullanıcı haritası (D-08): { <uid>: true }
  assigned_uids: {
    ".validate": "newData.hasChildren()",
    $uid: { ".validate": "$uid.matches(/^[A-Za-z0-9_-]{1,128}$/) && newData.val() === true" },
  },
};

// Müşterinin (talep sahibi/firma yöneticisi) yaşam döngüsü yazımları + atanmış danışmanın yazabildiği alanlar.
const closedLike = (node) => `(${node}.child('status').val() === 'pending_close' || ${node}.child('status').val() === 'resolved' || ${node}.child('status').val() === 'closed')`;
const pendingLike = (node) => `(${node}.child('status').val() === 'pending_close' || ${node}.child('status').val() === 'resolved')`;
const parentOf = "data.parent()";
const custWrite = (cond) => `${AUTH} && (${PARTY_LIVE(parentOf)} && (${cond}))`;
const consWrite = `${CONS_ASSIGNED(parentOf)}`;
const either = (custCond) => `${AUTH} && ((${PARTY_LIVE(parentOf)} && (${custCond})) || ${consWrite})`;
const consOnly = `${AUTH} && ${consWrite}`;
const REOPEN_WINDOW = `(${parentOf}.child('closed_at_ms').isNumber() && ${parentOf}.child('closed_at_ms').val() + ${REOPEN_WINDOW_MS} >= now)`;
const CLEARING_ON_REOPEN = `(!newData.exists() && newData.parent().child('status').val() === 'reopened')`;

const ticketChildren = () => {
  const spec = {};
  for (const [name, rule] of Object.entries(TICKET_FIELD_SPEC)) spec[name] = rule;
  // Müşteri: durum geçişleri
  spec.status = Object.assign({}, spec.status, {
    ".write": either(
      `(data.val() === 'waiting_customer' && newData.val() === 'in_progress') || (${"(data.val() === 'pending_close' || data.val() === 'resolved')"} && newData.val() === 'closed') || (${"(data.val() === 'pending_close' || data.val() === 'resolved')"} && newData.val() === 'reopened') || (data.val() === 'closed' && newData.val() === 'reopened' && ${REOPEN_WINDOW})`
    ),
  });
  spec.closed_at = Object.assign({}, spec.closed_at, {
    ".write": either(`(${pendingLike(parentOf)} && newData.isString()) || (${closedLike(parentOf)} && ${CLEARING_ON_REOPEN})`),
  });
  spec.closed_at_ms = Object.assign({}, spec.closed_at_ms, {
    ".write": either(`(${pendingLike(parentOf)} && newData.isNumber()) || (${closedLike(parentOf)} && ${CLEARING_ON_REOPEN})`),
  });
  spec.reopened_at = Object.assign({}, spec.reopened_at, {
    ".write": either(`${closedLike(parentOf)} && newData.isString()`),
  });
  for (const name of ["updated_at", "updated_by", "public_updated_at", "public_updated_by"]) {
    spec[name] = Object.assign({}, spec[name], { ".write": either("true") });
  }
  // SLA damgaları: müşteri tarayıcısı da yazar (durum geçişi/yanıt sırasında); yalnızca güvenli yönlere izin verilir.
  const reopening = "newData.parent().child('status').val() === 'reopened'";
  spec.sla_window = Object.assign({}, spec.sla_window, { ".write": either(reopening) }); // yeni pencere yalnızca yeniden açmada
  spec.sla_paused_ms = Object.assign({}, spec.sla_paused_ms, { ".write": either(`(!data.exists() || newData.val() >= data.val() || ${reopening})`) }); // yalnızca artar (yeni pencerede sıfırlanır)
  spec.sla_paused_since = Object.assign({}, spec.sla_paused_since, { ".write": either("true") });
  spec.sla_response_breached_at = Object.assign({}, spec.sla_response_breached_at, { ".write": either("(!data.exists() && newData.exists())") }); // yalnızca bir kez, silinemez
  spec.sla_resolution_breached_at = Object.assign({}, spec.sla_resolution_breached_at, { ".write": either(`((!data.exists() && newData.exists()) || (!newData.exists() && ${reopening}))`) });
  // Yalnızca atanmış danışmanın ek olarak yazabildiği alanlar
  for (const name of ["started_at", "resolved_at", "first_response_at", "total_work_hours", "is_approved"]) {
    spec[name] = Object.assign({}, spec[name], { ".write": consOnly });
  }
  return spec;
};

// Gelecekteki SLA/hatırlatma damgaları için ayrılmış alan aileleri (yalnızca personel; sınırlı skaler değer).
const TICKET_STAFF_EXTRA = "^(sla_|reminder_|pause_|auto_close_)[a-z0-9_]{1,40}$";

const CREATE_FORBIDDEN_FIELDS = ["first_response_at", "resolved_at", "closed_at", "closed_at_ms", "reopened_at", "started_at", "is_approved", "assigned_at", "assigned_uids", "is_deleted", "deleted_at", "deleted_by"];
const ARIZI_LIKE = `(${ROLE} === 'arizi_customer' || (${MY_COMPANY_SET} && root.child('v2/companies').child(${MY_COMPANY}).child('customer_type').val() === 'ARC'))`;
// Müşteri talep oluşturma: kendi adına, 'open', kendi firmasıyla, e-postası oturumla aynı, personel alanları boş, tür kilidi (D-09 B).
const CUSTOMER_CREATE = [
  "!data.exists()",
  CUSTOMER,
  HAS_PROFILE,
  `${nd("user_id")}.val() === auth.uid`,
  `${nd("created_by")}.val() === auth.uid`,
  `${nd("status")}.val() === 'open'`,
  `(${nd("assigned_to_id")}.val() === '' || !${present("assigned_to_id")})`,
  `${nd("company_id")}.isString()`,
  `(${nd("company_id")}.val() === ${MY_COMPANY} || (${nd("company_id")}.val() === '' && !${ME}.child('company_id').exists()))`,
  `${nd("user_email")}.val().toLowerCase() === auth.token.email.toLowerCase()`,
  ...CREATE_FORBIDDEN_FIELDS.map((n) => `!${present(n)}`),
  `(${nd("assigned_to_name")}.val() === '' || !${present("assigned_to_name")})`,
  `(${nd("total_work_hours")}.val() === 0 || !${present("total_work_hours")})`,
  `(${nd("project_id")}.val() === '' || !${present("project_id")})`,
  // pasife alınmış firmanın kullanıcıları yeni talep açamaz (SEC-24)
  `(!${MY_COMPANY_SET} || root.child('v2/companies').child(${MY_COMPANY}).child('is_active').val() !== false)`,
  `((${ARIZI_LIKE} && ${nd("ticket_type")}.val().matches(/^(ARZ|BUG)$/)) || (!${ARIZI_LIKE} && ${nd("ticket_type")}.val().matches(/^(SUP|BUG)$/)))`,
  // silinmiş bir talebin yetim verisini devralmayı engelle (SEC-11)
  "!root.child('v2/ticket_messages').child($ticketId).exists()",
].join(" && ");

const TICKET_WRITE = [
  // tamamen silme (cascade): yalnızca super_admin
  `(!newData.exists() && ${SUPER})`,
  // yönetici roller (super/service/PM): serbest; ancak yumuşak silme alanlarına yalnızca ADMIN dokunur
  `(newData.exists() && ${MANAGER} && (${ADMIN} || (${nd("is_deleted")}.val() === data.child('is_deleted').val() && ${nd("deleted_at")}.val() === data.child('deleted_at').val() && ${nd("deleted_by")}.val() === data.child('deleted_by').val())))`,
  // danışman: yalnızca YENİ talep oluşturabilir; mevcut talepte alan bazlı (assigned_uids) yetki aşağıdadır
  `(!data.exists() && newData.exists() && ${CONSULTANT})`,
  `(${CUSTOMER_CREATE})`,
].join(" || ");

// --------------------------------------------------------------------------- alt düğümler
const ATT_TYPES =
  "^(image\\/(png|jpeg|gif|webp)|application\\/pdf|text\\/(plain|csv)|application\\/zip|application\\/msword|application\\/vnd\\.ms-(excel|powerpoint)|application\\/vnd\\.openxmlformats-officedocument\\.(wordprocessingml\\.document|spreadsheetml\\.sheet|presentationml\\.presentation))$";
const ATT_MAX_DATA = 3000000;
const ATT_MAX_SIZE = 2200000;
const ATT_BAD_NAME = "\\.(exe|bat|cmd|com|js|vbs|scr|msi|jar|ps1|html?|svg|xhtml)$";
// Talep başına ek kotası (adet/toplam bayt): ticket_attachment_stats sayacıyla AYNI çok-yollu update içinde güncellenmelidir.
const ATT_QUOTA_COUNT = 30;
const ATT_QUOTA_BYTES = 40 * 1024 * 1024;

const attachmentNode = (readExpr, writeExpr, quota) => {
  const stats = "newData.parent().parent().parent().child('ticket_attachment_stats').child($ticketId)";
  const oldStats = "root.child('v2/ticket_attachment_stats').child($ticketId)";
  const quotaExpr = quota
    ? ` && ${stats}.child('count').val() === (${oldStats}.child('count').exists() ? ${oldStats}.child('count').val() : 0) + 1 && ${stats}.child('bytes').val() === (${oldStats}.child('bytes').exists() ? ${oldStats}.child('bytes').val() : 0) + newData.child('size').val()`
    : "";
  return {
    ".read": readExpr,
    ".write": writeExpr,
    ".validate":
      `newData.hasChildren(['name', 'type', 'size', 'data', 'uploader_uid']) && newData.child('uploader_uid').val() === auth.uid && (!newData.child('att_id').exists() || newData.child('att_id').val() === $attId) && newData.child('name').isString() && newData.child('name').val().length >= 1 && newData.child('name').val().length <= 200 && !newData.child('name').val().matches(/${ATT_BAD_NAME}/i) && newData.child('data').isString() && newData.child('data').val().length <= ${ATT_MAX_DATA} && newData.child('size').isNumber() && newData.child('size').val() >= 0 && newData.child('size').val() <= ${ATT_MAX_SIZE} && newData.child('data').val().length <= newData.child('size').val() * 1.4 + 16 && newData.child('type').isString() && newData.child('type').val().matches(/${ATT_TYPES}/)` + quotaExpr,
    ...fields({
      att_id: f(v.str(64)),
      name: {},
      type: {},
      size: {},
      data: {},
      uploader_uid: {},
      uploader_name: f(v.str(200)),
      created_at: f(v.iso),
    }),
  };
};

// Mesajdaki ek referansları (veri ayrı düğümlerde): en çok 3.
const MESSAGE_ATTACHMENT_REFS = {
  ".validate": "newData.hasChildren() && !newData.child('3').exists()",
  $i: Object.assign(
    { ".validate": "$i.matches(/^[0-2]$/) && newData.hasChildren(['id', 'name', 'type', 'size'])" },
    fields({ id: f(v.str(64)), name: f(v.str(200)), type: f(v.str(100)), size: f(v.num(0, 100000000)) })
  ),
};
const MESSAGE_FIELDS = {
  message_id: f(v.str(64)),
  user_id: f(v.str(128)),
  author_name: f(v.str(200)),
  author_email: f(v.str(254)),
  author_role: f(v.str(30)),
  message: f(v.str(10000)),
  is_internal: f(v.bool),
  work_hours: f(v.num(0, 1000)),
  created_at: f(v.iso),
  attachments: MESSAGE_ATTACHMENT_REFS,
};
const emailBound = `(!${present("author_email")} || ${nd("author_email")}.val() === '' || ${nd("author_email")}.val().toLowerCase() === auth.token.email.toLowerCase())`;

const MESSAGE_VALIDATE = [
  "newData.hasChildren(['message', 'created_at', 'user_id', 'message_id', 'author_role'])",
  `${nd("user_id")}.val() === auth.uid`,
  `${nd("message_id")}.val() === $messageId`,
  `${nd("is_internal")}.val() !== true`,
  // müşteri tarafı yalnızca 'customer' ya da kendi rolüyle; personel kendi rolüyle yazar (taklit yok)
  `((${nd("author_role")}.val() === 'customer' && !${STAFF}) || ${nd("author_role")}.val() === ${ROLE})`,
  emailBound,
  `(!${present("work_hours")} || ${nd("work_hours")}.val() === 0 || ${STAFF})`,
].join(" && ");

const NOTE_VALIDATE = [
  "newData.hasChildren(['message', 'created_at', 'user_id', 'message_id'])",
  `(${nd("user_id")}.val() === auth.uid || ${SUPER})`,
  `${nd("message_id")}.val() === $noteId`,
  `(${SUPER} || ${nd("author_role")}.val() === ${ROLE})`,
  `(${SUPER} || ${emailBound})`,
].join(" && ");

const HISTORY_VALIDATE = [
  "newData.hasChildren(['action', 'changed_at', 'changed_by_uid'])",
  `${nd("changed_by_uid")}.val() === auth.uid`,
  `(!${present("history_id")} || ${nd("history_id")}.val() === $historyId)`,
].join(" && ");

const EFFORT_VALIDATE = [
  "newData.hasChildren(['hours', 'created_at', 'created_by_uid'])",
  `${nd("created_by_uid")}.val() === auth.uid`,
  `(!${present("effort_id")} || ${nd("effort_id")}.val() === $effortId)`,
].join(" && ");

const ACTIVITY_CUSTOMER_ACTIONS = "ticket_created|ticket_message|ticket_closed|ticket_reopened|email_failed";
const ACTIVITY_VALIDATE = [
  "newData.hasChildren(['action', 'created_at', 'user_uid'])",
  `${nd("user_uid")}.val() === auth.uid`,
  `(!${present("activity_id")} || ${nd("activity_id")}.val() === $actId)`,
  // personel için biçimli tür; müşteri için yalnızca kendi olay türleri
  `${nd("action")}.val().matches(/^[a-z][a-z_]{0,59}$/)`,
  `(${STAFF} || ${nd("action")}.val().matches(/^(${ACTIVITY_CUSTOMER_ACTIONS})$/))`,
].join(" && ");

const COUNTER_NEXT = "newData.val() === (data.exists() ? data.val() + 1 : 1)";
const COUNTER_WRITE = [
  AUTH,
  HAS_PROFILE,
  `(${STAFF} || ((($type.matches(/^(ARZ|BUG)$/) && ${ARIZI_LIKE}) || ($type.matches(/^(SUP|BUG)$/) && !${ARIZI_LIKE})) && (${ME}.child('customer_code').val() === $code || (${MY_COMPANY_SET} && root.child('v2/companies').child(${MY_COMPANY}).child('customer_code').val() === $code))))`,
].join(" && ");

const buildRules = (opts) => {
  const options = Object.assign({ attachmentQuota: false }, opts || {});
  return {
    rules: {
      ".read": false,
      ".write": false,
      v2: {
        users: {
          ".read": `${AUTH} && ${ADMIN}`,
          ".indexOn": ["email", "company_id", "role"],
          $uid: {
            ".read": `${AUTH} && (auth.uid === $uid || ${ADMIN})`,
            // Profilin tamamı yalnızca yöneticilerce yazılır (kullanıcı yalnızca aşağıdaki alanları yazabilir).
            //  - service_admin, super_admin profiline dokunamaz/silemez/düşüremez ve super_admin atayamaz (SEC-09, YON-05).
            //  - Hiç kimse kendi rolünü / aktifliğini / firmasını değiştiremez (kendini kilitleme: YON-06).
            ".write": `${AUTH} && (${SUPER} || (${ADMIN} && data.child('role').val() !== 'super_admin' && newData.child('role').val() !== 'super_admin')) && (auth.uid !== $uid || (newData.child('role').val() === data.child('role').val() && newData.child('is_active').val() === data.child('is_active').val() && newData.child('company_id').val() === data.child('company_id').val() && (newData.child('must_change_password').val() === data.child('must_change_password').val() || newData.child('must_change_password').val() === false)))`,
            role: {
              ".validate": `newData.isString() && (${VALID_ROLES}) && (newData.val() !== 'super_admin' || data.val() === 'super_admin' || ${SUPER})`,
            },
            last_login_at: { ".write": `${AUTH} && auth.uid === $uid && ${HAS_PROFILE}`, ".validate": v.str(40) },
            updated_at: { ".write": `${AUTH} && auth.uid === $uid && ${HAS_PROFILE}`, ".validate": v.str(40) },
            must_change_password: { ".write": `${AUTH} && auth.uid === $uid && newData.val() === false`, ".validate": v.bool },
          },
        },
        tickets: {
          ".read": `${AUTH} && (${STAFF} || (${HAS_PROFILE} && query.orderByChild == 'user_id' && query.equalTo == auth.uid) || (query.orderByChild == 'company_id' && ${COMPANY_ADMIN} && ${MY_COMPANY_SET} && query.equalTo == ${MY_COMPANY}))`,
          ".indexOn": ["user_id", "company_id", "assigned_to_id", "status", "created_at", "updated_at", "ticket_type", "project_id", "resolved_at", "closed_at", "ticket_number"],
          $ticketId: {
            ".read": `${AUTH} && (${PARTY("data")} || ${STAFF})`,
            // Yönetici roller serbest yazar; tamamen silme yalnızca super_admin (service_admin `is_deleted` ile yumuşak siler).
            // Danışman yalnızca yeni talep açabilir; mevcut talepte yalnızca atandığı talebin aşağıdaki alanlarını yazar.
            // Müşteri yalnızca kendi adına, 'open' durumda, kendi firmasıyla ve kendi e-postasıyla talep OLUŞTURABİLİR;
            // sonrasında yalnızca yaşam döngüsü alanlarını (aşağıda) güncelleyebilir.
            ".write": `${AUTH} && (${TICKET_WRITE})`,
            ".validate": `newData.hasChildren(${JSON.stringify(["user_id", "title", "status", "priority", "ticket_type", "ticket_number", "created_at", "updated_at"]).replace(/"/g, "'")}) && !newData.child('id').exists() && (!newData.child('ticket_id').exists() || newData.child('ticket_id').val() === $ticketId)`,
            ...ticketChildren(),
            // Yalnızca personelin yazabildiği, ayrılmış alan aileleri (SLA/hatırlatma damgaları; skaler ve sınırlı)
            $other: {
              ".write": `${AUTH} && $other.matches(/${TICKET_STAFF_EXTRA}/) && ${CONS_ASSIGNED(parentOf)}`,
              ".validate": `$other.matches(/${TICKET_STAFF_EXTRA}/) && ${STAFF} && ((newData.isString() && newData.val().length <= 100) || newData.isNumber() || newData.isBoolean())`,
            },
          },
        },
        ticket_messages: {
          $ticketId: {
            ".read": `${AUTH} && (${STAFF} || ${OWNER("$ticketId")})`,
            ".write": SUPER_DELETE,
            // Mesajlar yalnızca eklenir (düzenleme/silme yok); silme moderasyonu yalnızca super_admin.
            // Müşteri yalnızca silinmemiş/kapanmamış talebe; danışman yalnızca atandığı talebe yazar.
            $messageId: {
              ".write": `${AUTH} && ((!data.exists() && newData.exists() && (${STAFF_WRITE("$ticketId")} || (${OWNER("$ticketId")} && ${CUST_OPEN("$ticketId")}))) || ${SUPER})`,
              // İç notlar yalnızca ticket_internal_notes düğümüne yazılır (eski/önbellekteki istemciler dahil).
              ".validate": MESSAGE_VALIDATE,
              ...fields(MESSAGE_FIELDS),
            },
          },
        },
        // Dahili notlar: yalnızca personel okur; yalnızca atanmış danışman/yönetici yazar; yalnızca eklenir (silme: super_admin).
        ticket_internal_notes: {
          $ticketId: {
            ".read": `${AUTH} && ${STAFF}`,
            ".write": SUPER_DELETE,
            $noteId: {
              ".write": `${AUTH} && ((!data.exists() && newData.exists() && ${STAFF_WRITE("$ticketId")}) || ${SUPER})`,
              ".validate": NOTE_VALIDATE,
              ...fields(MESSAGE_FIELDS),
            },
          },
        },
        // Dosya ekleri: ek verisi (base64) mesajlardan ayrı düğümlerde tutulur; liste okuma yoktur (yalnızca kimliği
        // bilinen ek okunur). Yalnızca eklenir. İç notların ekleri yalnızca personele açıktır.
        ticket_attachments: {
          $ticketId: {
            ".write": SUPER_DELETE,
            $attId: attachmentNode(
              `${AUTH} && (${STAFF} || ${OWNER("$ticketId")})`,
              `${AUTH} && ((!data.exists() && newData.exists() && (${STAFF_WRITE("$ticketId")} || (${OWNER("$ticketId")} && ${CUST_OPEN("$ticketId")}))) || ${SUPER})`,
              options.attachmentQuota
            ),
          },
        },
        ticket_internal_attachments: {
          $ticketId: {
            ".write": SUPER_DELETE,
            $attId: attachmentNode(
              `${AUTH} && ${STAFF}`,
              `${AUTH} && ((!data.exists() && newData.exists() && ${STAFF_WRITE("$ticketId")}) || ${SUPER})`,
              options.attachmentQuota
            ),
          },
        },
        // Talep başına ek sayacı (kota): adet + toplam bayt. Kota modu açıkken ek yazımı bu sayacı AYNI update'te +1/+size artırmalıdır.
        ticket_attachment_stats: {
          $ticketId: {
            ".read": `${AUTH} && (${STAFF} || ${OWNER("$ticketId")})`,
            ".write": `${AUTH} && (${SUPER} || (newData.exists() && (${STAFF_WRITE("$ticketId")} || (${OWNER("$ticketId")} && ${CUST_OPEN("$ticketId")}))))`,
            ".validate": "newData.hasChildren(['count', 'bytes'])",
            // Sayaçlar yalnızca artabilir (ek silinemediği için); azaltarak kota sıfırlanamaz (super_admin hariç).
            count: f(`${v.num(0, ATT_QUOTA_COUNT)} && (${SUPER} || !data.exists() || newData.val() >= data.val())`),
            bytes: f(`${v.num(0, ATT_QUOTA_BYTES)} && (${SUPER} || !data.exists() || newData.val() >= data.val())`),
            $other: { ".validate": false },
          },
        },
        ticket_history: {
          $ticketId: {
            ".read": `${AUTH} && (${STAFF} || ${OWNER("$ticketId")})`,
            ".write": SUPER_DELETE,
            $historyId: {
              ".write": `${AUTH} && ((!data.exists() && newData.exists() && (${HISTORY_WRITER("$ticketId")} || (${OWNER("$ticketId")} && ${NOT_DELETED(TICKET("$ticketId"))}))) || ${SUPER})`,
              // Geçmiş kaydını yazan oturumun kendisi olmalı (changed_by_uid taklidi engeli).
              ".validate": HISTORY_VALIDATE,
              ...fields({
                history_id: f(v.str(64)),
                action: f("newData.isString() && newData.val().length >= 1 && newData.val().length <= 80"),
                field_changed: f(v.str(60)),
                old_value: f(v.str(1000)),
                new_value: f(v.str(1000)),
                changed_by_uid: f(v.str(128)),
                changed_by_name: f(v.str(200)),
                changed_at: f(v.iso),
                note: f(v.str(5000)),
              }),
            },
          },
        },
        ticket_assignments: {
          ".read": `${AUTH} && ${STAFF}`,
          $ticketId: {
            ".read": `${AUTH} && (${STAFF} || ${OWNER("$ticketId")})`,
            // Atamayı yalnızca yönetici roller (super/service/PM) değiştirir.
            ".write": `${AUTH} && ${MANAGER}`,
            $personnelId: {
              ".validate": "newData.hasChildren(['personnel_id']) && newData.child('personnel_id').val() === $personnelId",
              ...fields({
                personnel_id: f(v.str(64)),
                personnel_name: f(v.str(200)),
                personnel_email: f(v.str(254)),
                is_primary: f(v.bool),
                assigned_at: f(v.iso),
                assigned_by_uid: f(v.str(128)),
                assigned_by_name: f(v.str(200)),
              }),
            },
          },
        },
        ticket_efforts: {
          ".read": `${AUTH} && ${STAFF}`,
          $ticketId: {
            ".read": `${AUTH} && ${STAFF}`,
            ".write": SUPER_DELETE,
            ".indexOn": ["work_date", "personnel_id", "created_at"],
            $effortId: {
              ".read": `${AUTH} && ${STAFF}`,
              // Yöneticiler serbest; danışman yalnızca atandığı talebe efor ekler ve yalnızca kendi kaydını siler.
              ".write": `${AUTH} && (${MANAGER} || (${CONSULTANT} && ${TICKET("$ticketId")}.child('assigned_uids').child(auth.uid).val() === true && ((newData.exists() && !data.exists()) || (!newData.exists() && data.child('created_by_uid').val() === auth.uid))))`,
              ".validate": EFFORT_VALIDATE,
              ...fields({
                effort_id: f(v.str(64)),
                personnel_id: f(v.str(64)),
                personnel_name: f(v.str(200)),
                hours: f("newData.isNumber() && newData.val() > 0 && newData.val() <= 1000"),
                work_date: f("newData.isString() && newData.val().matches(/^20[0-9]{2}-[01][0-9]-[0-3][0-9]$/)"),
                note: f(v.str(2000)),
                created_at: f(v.iso),
                created_by_uid: f(v.str(128)),
                created_by_name: f(v.str(200)),
              }),
            },
          },
        },
        companies: {
          ".read": `${AUTH} && ${STAFF}`,
          ".indexOn": ["name", "customer_code", "customer_type"],
          ".write": `${AUTH} && ${ADMIN}`,
          $companyId: {
            // Müşteri yalnızca kendi firmasının kaydını okuyabilir.
            ".read": `${AUTH} && (${STAFF} || (${HAS_PROFILE} && ${MY_COMPANY_SET} && ${MY_COMPANY} === $companyId))`,
            ".write": `${AUTH} && ${ADMIN}`,
          },
        },
        personnel: {
          ".read": `${AUTH} && ${STAFF}`,
          ".indexOn": ["email", "department_id", "is_active"],
          ".write": `${AUTH} && ${ADMIN}`,
          $personnelId: {
            ".read": `${AUTH} && ${STAFF}`,
            ".write": `${AUTH} && ${ADMIN}`,
          },
        },
        // Sözleşme meta verisi personele açık; BEDEL (value) ise yalnızca contract_values/<id> düğümünde (ADMIN) tutulur (D-08 A).
        // contracts/<id>/value artık YAZILAMAZ (eski kayıtlardaki değerler göçle contract_values'a taşınmalı; null yazımı serbest).
        contracts: {
          ".read": `${AUTH} && ${STAFF}`,
          ".indexOn": ["company_id", "status", "end_date"],
          ".write": `${AUTH} && ${ADMIN}`,
          $contractId: {
            ".read": `${AUTH} && ${STAFF}`,
            ".write": `${AUTH} && ${ADMIN}`,
            value: { ".validate": false },
          },
        },
        contract_values: {
          ".read": `${AUTH} && ${ADMIN}`,
          $contractId: {
            ".read": `${AUTH} && ${ADMIN}`,
            ".write": `${AUTH} && ${ADMIN}`,
            ".validate": "newData.hasChildren(['value'])",
            ...fields({
              value: f("newData.isNumber() && newData.val() >= 0 && newData.val() <= 1000000000000"),
              currency: f("newData.isString() && newData.val().matches(/^[A-Z]{3}$/)"),
              updated_at: f(v.iso),
              updated_by: f(v.str(128)),
            }),
          },
        },
        projects: {
          ".read": `${AUTH} && ${STAFF}`,
          ".indexOn": ["company_id", "status", "project_code"],
          ".write": `${AUTH} && ${MANAGER}`,
          $projectId: {
            ".read": `${AUTH} && ${STAFF}`,
            ".write": `${AUTH} && ${MANAGER}`,
          },
        },
        departments: {
          ".read": AUTH,
          ".write": `${AUTH} && ${SUPER}`,
          $departmentId: { ".read": AUTH, ".write": `${AUTH} && ${SUPER}` },
        },
        sap_modules: {
          ".read": AUTH,
          ".write": `${AUTH} && ${SUPER}`,
          $moduleId: { ".read": AUTH, ".write": `${AUTH} && ${SUPER}` },
        },
        support_types: {
          ".read": AUTH,
          ".write": `${AUTH} && ${SUPER}`,
          $typeId: { ".read": AUTH, ".write": `${AUTH} && ${SUPER}` },
        },
        // Hazır yanıt şablonları (WP-16): okuma personel, yazma yöneticiler (super/service).
        reply_templates: {
          ".read": `${AUTH} && ${STAFF}`,
          ".indexOn": ["category", "is_active"],
          $templateId: {
            ".write": `${AUTH} && ${ADMIN}`,
            ".validate": "newData.hasChildren(['title', 'body'])",
            ...fields({
              template_id: f(v.str(64)),
              title: f("newData.isString() && newData.val().length >= 1 && newData.val().length <= 200"),
              body: f("newData.isString() && newData.val().length >= 1 && newData.val().length <= 10000"),
              category: f(v.str(60)),
              is_active: f(v.bool),
              sort_order: f(v.num(0, 100000)),
              created_at: f(v.iso),
              created_by: f(v.str(128)),
              updated_at: f(v.iso),
              updated_by: f(v.str(128)),
            }),
          },
        },
        activities: {
          ".read": `${AUTH} && ${STAFF}`,
          ".indexOn": ["created_at", "entity_type", "entity_id", "user_uid"],
          // Yalnızca ekleme: kayıtlar ezilemez/silinemez, liste toptan silinemez.
          $actId: {
            ".read": `${AUTH} && ${STAFF}`,
            ".write": `${AUTH} && ${HAS_PROFILE} && !data.exists() && newData.exists()`,
            // Kullanıcı kimliği oturumla aynı; alanlar yalnızca dize ve sınırlı (panoyu çökerten/şişiren kayıt yazılamaz).
            ".validate": ACTIVITY_VALIDATE,
            ...fields({
              activity_id: f(v.str(64)),
              action: {},
              entity_type: f(v.str(40)),
              entity_id: f(v.str(128)),
              entity_label: f(v.str(300)),
              user_uid: {},
              user_name: f(v.str(200)),
              details: f(v.str(1000)),
              created_at: f(v.iso),
            }),
          },
        },
        // Ticket numarası üretimi (transaction): yalnızca +1 artış (ADMIN hariç); müşteri yalnızca kendi müşteri kodu/türleri.
        counters: {
          ".read": `${AUTH} && ${HAS_PROFILE}`,
          $type: {
            $code: {
              $yymm: {
                ".write": COUNTER_WRITE,
                ".validate": `$type.matches(/^(${TICKET_TYPES.join("|")})$/) && $code.matches(/^[A-Za-z0-9_-]{1,20}$/) && $yymm.matches(/^[0-9]{4}$/) && newData.isNumber() && newData.val() >= 1 && newData.val() <= 99999999 && (${ADMIN} || ${COUNTER_NEXT})`,
              },
            },
          },
        },
        // Arayüz kullanmıyor (zil türetilmiş); kapalı.
        notifications: { ".read": false, ".write": false },
        // Yalnızca sunucu (Admin SDK kuralları atlar): istemciye kapalı.
        system_state: { ".read": false, ".write": false },
        ops: { ".read": false, ".write": false },
      },
    },
  };
};

const rules = buildRules();
const output = JSON.stringify(rules, null, 2) + "\n";
if (require.main === module) {
  const target = process.argv[2] || require("path").join(__dirname, "..", "..", "database.rules.json");
  require("fs").writeFileSync(target, output);
}
module.exports = { rules, output, buildRules, constants: { REOPEN_WINDOW_MS, NEAR_NOW_MS, ATT_QUOTA_COUNT, ATT_QUOTA_BYTES, TICKET_STAFF_EXTRA, ATT_MAX_DATA, ATT_MAX_SIZE } };
