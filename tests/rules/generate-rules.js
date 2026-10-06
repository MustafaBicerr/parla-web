/**
 * database.rules.json KAYNAĞI. Kuralları burada düzenleyin, sonra:
 *   node tests/rules/generate-rules.js        (database.rules.json'u yeniden üretir)
 *   cd tests/rules && npm test               (kuralları ve JSON'un güncelliğini doğrular)
 */
const ROLE = "root.child('v2/users').child(auth.uid).child('role').val()";
const is = (r) => `${ROLE} === '${r}'`;
const SUPER = is("super_admin");
const ADMIN = `(${SUPER} || ${is("service_admin")})`;
const STAFF = `(${SUPER} || ${is("service_admin")} || ${is("consultant")} || ${is("project_manager")})`;
const ME = "root.child('v2/users').child(auth.uid)";
const MY_COMPANY = `${ME}.child('company_id').val()`;
const MY_COMPANY_SET = `${ME}.child('company_id').exists() && ${MY_COMPANY} !== ''`;
// Açık kayıtla oluşturulmuş ama yönetici tarafından profili açılmamış hesapları dışarıda bırakır.
const HAS_PROFILE = `${ME}.child('role').exists() && ${ME}.child('is_active').val() !== false`;
const TICKET = (id) => `root.child('v2/tickets').child(${id})`;
const OWNER = (id) => `${TICKET(id)}.child('user_id').val() === auth.uid`;
const AUTH = "auth != null";
const and = (...p) => p.filter(Boolean).join(" && ");

const VALID_ROLES = ["super_admin", "service_admin", "project_manager", "consultant", "customer", "arizi_customer", "company_admin"]
  .map((r) => `newData.val() === '${r}'`).join(" || ");

const rules = {
  rules: {
    ".read": false,
    ".write": false,
    v2: {
      users: {
        ".read": `${AUTH} && ${ADMIN}`,
        ".indexOn": ["email", "company_id", "role"],
        $uid: {
          ".read": `${AUTH} && (auth.uid === $uid || ${ADMIN})`,
          // Profilin tamamı yalnızca yöneticilerce yazılır; kullanıcı yalnızca aşağıdaki alanları yazabilir.
          ".write": `${AUTH} && ${ADMIN}`,
          role: {
            ".validate": `newData.isString() && (${VALID_ROLES}) && (newData.val() !== 'super_admin' || data.val() === 'super_admin' || ${SUPER})`,
          },
          last_login_at: { ".write": `${AUTH} && auth.uid === $uid`, ".validate": "newData.isString()" },
          updated_at: { ".write": `${AUTH} && auth.uid === $uid`, ".validate": "newData.isString()" },
          must_change_password: { ".write": `${AUTH} && auth.uid === $uid && newData.val() === false` },
        },
      },
      tickets: {
        ".read": `${AUTH} && (${STAFF} || (query.orderByChild == 'user_id' && query.equalTo == auth.uid) || (query.orderByChild == 'company_id' && ${MY_COMPANY_SET} && query.equalTo == ${MY_COMPANY}))`,
        ".indexOn": ["user_id", "company_id", "assigned_to_id", "status", "created_at", "ticket_type"],
        $ticketId: {
          ".read": `${AUTH} && (data.child('user_id').val() === auth.uid || ${STAFF})`,
          // Personel serbest yazar (silme yalnızca admin). Müşteri yalnızca kendi adına, 'open' durumda ve
          // kendi firmasıyla ticket OLUŞTURABİLİR; sonrasında yalnızca aşağıdaki alanları güncelleyebilir.
          ".write": `${AUTH} && ((!newData.exists() && ${ADMIN}) || (newData.exists() && ${STAFF}) || (!data.exists() && newData.child('user_id').val() === auth.uid && newData.child('status').val() === 'open' && (newData.child('assigned_to_id').val() === '' || !newData.child('assigned_to_id').exists()) && (newData.child('company_id').val() === ${MY_COMPANY} || (newData.child('company_id').val() === '' && !${ME}.child('company_id').exists()))))`,
          status: {
            ".write": `${AUTH} && data.parent().child('user_id').val() === auth.uid && data.val() === 'waiting_customer' && newData.val() === 'in_progress'`,
          },
          updated_at: { ".write": `${AUTH} && data.parent().child('user_id').val() === auth.uid` },
          updated_by: { ".write": `${AUTH} && data.parent().child('user_id').val() === auth.uid` },
        },
      },
      ticket_messages: {
        $ticketId: {
          ".read": `${AUTH} && (${STAFF} || ${OWNER("$ticketId")})`,
          // Mesajlar yalnızca eklenir (düzenleme/silme yok); silme moderasyonu yalnızca super_admin.
          $messageId: {
            ".write": `${AUTH} && ((!data.exists() && newData.exists() && (${STAFF} || ${OWNER("$ticketId")})) || ${SUPER})`,
            // İç notlar yalnızca ticket_internal_notes düğümüne yazılır (eski/önbellekteki istemciler dahil).
            ".validate": "newData.hasChildren(['message', 'created_at', 'user_id']) && newData.child('user_id').val() === auth.uid && newData.child('message').isString() && newData.child('message').val().length <= 10000 && newData.child('is_internal').val() !== true",
          },
        },
      },
      // Dahili notlar: yalnızca personel okur/yazar; yalnızca eklenir (silme: super_admin).
      ticket_internal_notes: {
        $ticketId: {
          ".read": `${AUTH} && ${STAFF}`,
          $noteId: {
            ".write": `${AUTH} && ((!data.exists() && newData.exists() && ${STAFF}) || ${SUPER})`,
            ".validate": "newData.hasChildren(['message', 'created_at', 'user_id']) && newData.child('message').isString() && newData.child('message').val().length <= 10000",
          },
        },
      },
      ticket_history: {
        $ticketId: {
          ".read": `${AUTH} && (${STAFF} || ${OWNER("$ticketId")})`,
          $historyId: {
            ".write": `${AUTH} && ((!data.exists() && newData.exists() && (${STAFF} || ${OWNER("$ticketId")})) || ${SUPER})`,
          },
        },
      },
      ticket_assignments: {
        ".read": `${AUTH} && ${STAFF}`,
        $ticketId: {
          ".read": `${AUTH} && (${STAFF} || ${OWNER("$ticketId")})`,
          ".write": `${AUTH} && ${STAFF}`,
        },
      },
      ticket_efforts: {
        ".read": `${AUTH} && ${STAFF}`,
        $ticketId: {
          ".read": `${AUTH} && ${STAFF}`,
          ".indexOn": ["work_date", "personnel_id", "created_at"],
          $effortId: {
            ".read": `${AUTH} && ${STAFF}`,
            ".write": `${AUTH} && ${STAFF}`,
          },
        },
      },
      companies: {
        ".read": `${AUTH} && ${STAFF}`,
        ".indexOn": ["name", "customer_code", "customer_type"],
        ".write": `${AUTH} && ${ADMIN}`,
        $companyId: {
          // Müşteri yalnızca kendi firmasının kaydını okuyabilir.
          ".read": `${AUTH} && (${STAFF} || (${MY_COMPANY_SET} && ${MY_COMPANY} === $companyId))`,
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
      contracts: {
        ".read": `${AUTH} && ${STAFF}`,
        ".indexOn": ["company_id", "status", "end_date"],
        ".write": `${AUTH} && ${ADMIN}`,
        $contractId: {
          ".read": `${AUTH} && ${STAFF}`,
          ".write": `${AUTH} && ${ADMIN}`,
        },
      },
      projects: {
        ".read": `${AUTH} && ${STAFF}`,
        ".indexOn": ["company_id", "status", "project_code"],
        ".write": `${AUTH} && (${ADMIN} || ${is("project_manager")})`,
        $projectId: {
          ".read": `${AUTH} && ${STAFF}`,
          ".write": `${AUTH} && (${ADMIN} || ${is("project_manager")})`,
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
      activities: {
        ".read": `${AUTH} && ${STAFF}`,
        ".indexOn": ["created_at", "entity_type", "user_uid"],
        // Yalnızca ekleme: kayıtlar ezilemez/silinemez, liste toptan silinemez.
        $actId: {
          ".read": `${AUTH} && ${STAFF}`,
          ".write": `${AUTH} && ${HAS_PROFILE} && !data.exists() && newData.exists()`,
        },
      },
      counters: {
        ".read": AUTH,
        // Ticket numarası üretimi (transaction) için giriş yapmış herkes artırabilir; yalnızca sayı kabul edilir.
        $type: { $code: { $yymm: { ".write": `${AUTH} && ${HAS_PROFILE}`, ".validate": "newData.isNumber() && newData.val() >= 1" } } },
      },
      notifications: {
        $uid: {
          ".read": `${AUTH} && auth.uid === $uid`,
          ".write": `${AUTH} && (auth.uid === $uid || ${STAFF})`,
        },
      },
    },
  },
};
const output = JSON.stringify(rules, null, 2) + "\n";
if (require.main === module) {
  const target = process.argv[2] || require("path").join(__dirname, "..", "..", "database.rules.json");
  require("fs").writeFileSync(target, output);
}
module.exports = { rules, output };
