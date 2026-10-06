#!/usr/bin/env node
/**
 * SALT-OKUNUR veri tarayıcı (WP-03): CANLI Realtime Database'in JSON dışa aktarımını (Console → Realtime Database →
 * ⋮ → "JSON'u dışa aktar") dosyadan okur ve her eski kaydı YENİ `.validate` kurallarına karşı sınar.
 * Hiçbir şey canlıya yazmaz/okumaz: ağ erişimi yoktur, yalnızca verilen dosyayı okur. İsteğe bağlı çıktılar
 * (--json, --emit-backfill) yerel dosyalara yazılır; girdi dosyasının üzerine yazmayı reddeder.
 *
 * Kullanım:
 *   cd tests/rules && npm install
 *   node scan-existing-data.cjs <export.json> [--json rapor.json] [--emit-backfill göç.json] [--all] [--max N] [--rules yol]
 *
 * Çıkış kodu: 0 temiz · 1 kayıt/göç bulguları var · 2 ENGEL var (dağıtmayın).
 *
 * Bulgu sınıfları:
 *   ENGEL  Kural dağıtılırsa o kayıt artık GÜNCELLENEMEZ (örn. talebin üst düğüm .validate'i geçmiyor: durum bile
 *          değişmez) ya da sayaç artırılamaz (ticket numarası üretilemez).
 *   KAYIT  Kayıt yeni .validate'e uymuyor; yalnızca o alan/kayıt YENİDEN yazılırsa reddedilir (ör. eski geçersiz öncelik).
 *   GÖÇ    Kural/istemci beklentisi için veri göçü gerekir: assigned_uids haritası, closed_at_ms, contracts/<id>/value.
 *   BİLGİ  Bütünlük notları: yetim kayıtlar, iç notlar herkese açık düğümde, tekrar eden numara, sayaç geride...
 *
 * NOT (yöntem): kayıtlar, kuralların kendisiyle (database.rules.json + targaryen) sınanır; `.write` kuralları
 * "açık" yapılır, yalnızca `.validate` değerlendirilir. Oturuma bağlı koşullar (user_id === auth.uid vb.) kaydın
 * kendi yazarı varsayılarak sınanır; böylece yalnızca VERİ BİÇİMİ ihlalleri raporlanır.
 */
const fs = require("node:fs");
const path = require("node:path");
const targaryen = require("targaryen");

const ROLES = ["super_admin", "service_admin", "project_manager", "consultant", "customer", "arizi_customer", "company_admin"];
const ADMIN_AUTH = { uid: "__scan_admin", token: { email: "scan@scan.invalid" } };
const ADMIN_PROFILE = { role: "super_admin", is_active: true, email: "scan@scan.invalid" };
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const lc = (x) => String(x == null ? "" : x).trim().toLowerCase();

/** Her .write değerini true yapar (yalnızca .validate değerlendirilsin). */
function permissiveRules(rulesJson) {
  const clone = JSON.parse(JSON.stringify(rulesJson));
  (function walk(o) {
    for (const k of Object.keys(o)) {
      if (k === ".write") o[k] = true;
      else if (isObj(o[k])) walk(o[k]);
    }
  })(clone);
  return clone;
}

function stripNulls(v) {
  if (Array.isArray(v)) return Object.fromEntries(v.map((x, i) => [String(i), stripNulls(x)]).filter(([, x]) => x !== null && x !== undefined));
  if (isObj(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const s = stripNulls(x);
      if (s !== null && s !== undefined) out[k] = s;
    }
    return out;
  }
  return v;
}
function setIn(root, parts, value) {
  let o = root;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
  o[parts[parts.length - 1]] = value;
}

/** targaryen çıktısındaki başarısız .validate satırlarını ayrıştırır: [{path, rule}] */
function failedValidates(info) {
  const out = [];
  for (const line of String(info || "").split("\n")) {
    const m = /^(\/[^:]*): validate "(.*)"\s+=> false$/.exec(line);
    if (m) out.push({ path: m[1], rule: m[2] });
  }
  return out;
}

function scan(exportData, options) {
  const opts = Object.assign({ now: Date.now() }, options || {});
  if (!opts.rulesPath) opts.rulesPath = path.join(__dirname, "..", "..", "database.rules.json");
  const rulesJson = opts.rulesJson || JSON.parse(fs.readFileSync(opts.rulesPath, "utf8"));
  const base = targaryen.database(permissiveRules(rulesJson), {}, opts.now);
  const v2 = stripNulls(isObj(exportData && exportData.v2) ? exportData.v2 : exportData) || {};
  const users = isObj(v2.users) ? v2.users : {};
  const personnel = isObj(v2.personnel) ? v2.personnel : {};
  const tickets = isObj(v2.tickets) ? v2.tickets : {};
  const findings = []; // {cls, code, where, detail}
  const add = (cls, code, where, detail) => findings.push({ cls, code, where, detail });
  const backfill = {};
  const stats = { records: 0 };

  const profileFor = (uid, role) => ({ [uid]: { role, is_active: true, email: lc((users[uid] || {}).email) } });
  const validRole = (r) => (ROLES.includes(r) ? r : "customer");

  /** Kaydı (varsa yazarı varsayarak) yeniden yazmayı dener; başarısız .validate'leri raporlar. */
  function checkRecord(cls, code, relPath, value, auth, userMap) {
    stats.records += 1;
    const data = { users: Object.assign({}, userMap || {}, { [ADMIN_AUTH.uid]: ADMIN_PROFILE }) };
    setIn(data, relPath.split("/"), value);
    let res;
    try {
      res = base.with({ data: { v2: data } }).as(auth).write("/v2/" + relPath, value);
    } catch (e) {
      add(cls, code, relPath, `değerlendirilemedi: ${e.message}`);
      return { ok: false };
    }
    if (res.allowed) return { ok: true };
    const failed = failedValidates(res.info);
    if (!failed.length) add(cls, code, relPath, "reddedildi (ayrıntı yok)");
    for (const f of failed) {
      const rel = f.path.replace(/^\/v2\//, "");
      const val = rel === relPath ? "(kayıt düzeyi)" : JSON.stringify(valueAt(value, rel.slice(relPath.length + 1)));
      add(cls, code, rel, `${val === undefined ? "" : String(val).slice(0, 80)} ← ${f.rule.slice(0, 110)}`);
    }
    return { ok: false };
  }
  function valueAt(v, sub) {
    let o = v;
    for (const k of String(sub).split("/").filter(Boolean)) {
      if (!isObj(o) && !Array.isArray(o)) return undefined;
      o = o[k];
    }
    return o;
  }

  // ------------------------------------------------------------- tickets
  const numberSeq = new Map(); // "TYPE|CODE|YYMM" -> en yüksek sıra
  const seenNumbers = new Map();
  for (const [id, t] of Object.entries(tickets)) {
    if (!isObj(t)) {
      add("ENGEL", "ticket-biçim", `tickets/${id}`, "kayıt nesne değil");
      continue;
    }
    checkRecord("KAYIT", "ticket-validate", `tickets/${id}`, t, ADMIN_AUTH, {});
    // Kısmi güncelleme (updated_at) üst düğüm .validate'ini yeniden çalıştırır: geçmezse talep güncellenemez.
    stats.records += 1;
    const data = { users: { [ADMIN_AUTH.uid]: ADMIN_PROFILE } };
    setIn(data, ["tickets", id], t);
    let upd;
    try {
      upd = base.with({ data: { v2: data } }).as(ADMIN_AUTH).update(`/v2/tickets/${id}`, { updated_at: new Date(opts.now).toISOString() });
    } catch (e) {
      upd = { allowed: false, info: String(e.message) };
    }
    if (!upd.allowed) {
      const f = failedValidates(upd.info);
      add("ENGEL", "ticket-güncellenemez", `tickets/${id}`, `talep güncellenemez (durum/öncelik değişmez): ${f.map((x) => x.path.replace(/^\/v2\//, "")).join(", ") || "ayrıntı yok"}`);
    }
    if (Object.prototype.hasOwnProperty.call(t, "id")) add("KAYIT", "SEC-07-id-alanı", `tickets/${id}/id`, `id alanı var (=${JSON.stringify(t.id)}): anahtarı ezer`);
    if (t.ticket_id !== undefined && t.ticket_id !== id) add("KAYIT", "SEC-07-ticket_id", `tickets/${id}/ticket_id`, `ticket_id (${JSON.stringify(t.ticket_id)}) anahtarla (${id}) aynı değil`);
    if (t.ticket_number) {
      if (seenNumbers.has(t.ticket_number)) add("BİLGİ", "yinelenen-numara", `tickets/${id}`, `ticket_number ${t.ticket_number} ayrıca tickets/${seenNumbers.get(t.ticket_number)} kaydında`);
      else seenNumbers.set(t.ticket_number, id);
    }
  }
  // sayaç analizi: tür|kod|yymm başına en yüksek talep sırası
  for (const t of Object.values(tickets)) {
    if (!isObj(t)) continue;
    const m = /^([A-Z]{3})-([^-]+)-.+-(\d{4})-(\d+)$/.exec(String(t.ticket_number || ""));
    if (m) {
      const key = `${m[1]}|${m[2]}|${m[3]}`;
      numberSeq.set(key, Math.max(numberSeq.get(key) || 0, parseInt(m[4], 10)));
    }
  }

  // ------------------------------------------------------------- mesaj / iç not
  for (const [coll, label] of [["ticket_messages", "mesaj"], ["ticket_internal_notes", "iç-not"]]) {
    for (const [tid, thread] of Object.entries(isObj(v2[coll]) ? v2[coll] : {})) {
      if (!tickets[tid]) add("BİLGİ", "yetim-kayıt", `${coll}/${tid}`, `talep yok (${Object.keys(thread || {}).length} kayıt yetim; cascade/temizlik gerekir)`);
      for (const [mid, m] of Object.entries(isObj(thread) ? thread : {})) {
        if (!isObj(m)) {
          add("KAYIT", `${label}-biçim`, `${coll}/${tid}/${mid}`, "kayıt nesne değil");
          continue;
        }
        const uid = typeof m.user_id === "string" && m.user_id ? m.user_id : "__bad_uid__";
        const role = validRole(m.author_role);
        const auth = { uid, token: { email: lc(m.author_email) } };
        checkRecord("KAYIT", `${label}-validate`, `${coll}/${tid}/${mid}`, m, auth, profileFor(uid, role));
        if (coll === "ticket_messages" && m.is_internal === true) add("BİLGİ", "iç-not-herkese-açık-düğümde", `${coll}/${tid}/${mid}`, "eski iç not herkese açık düğümde (Veri Bakımı → 'İç Notları Taşı' çalıştırın)");
        if (m.message_id !== undefined && m.message_id !== mid) add("KAYIT", "SEC-08-message_id", `${coll}/${tid}/${mid}`, `message_id (${JSON.stringify(m.message_id)}) anahtarla aynı değil`);
      }
    }
  }

  // ------------------------------------------------------------- geçmiş / efor / atama / ek
  const simple = [
    ["ticket_history", "changed_by_uid", "geçmiş"],
    ["ticket_efforts", "created_by_uid", "efor"],
    ["ticket_attachments", "uploader_uid", "ek"],
    ["ticket_internal_attachments", "uploader_uid", "iç-ek"],
    ["ticket_assignments", null, "atama"],
  ];
  for (const [coll, uidField, label] of simple) {
    for (const [tid, thread] of Object.entries(isObj(v2[coll]) ? v2[coll] : {})) {
      if (!tickets[tid]) add("BİLGİ", "yetim-kayıt", `${coll}/${tid}`, `talep yok (${Object.keys(thread || {}).length} kayıt yetim${coll.includes("attachments") ? "; base64 ek verisi depolamayı şişirir" : ""})`);
      for (const [rid, r] of Object.entries(isObj(thread) ? thread : {})) {
        if (!isObj(r)) {
          add("KAYIT", `${label}-biçim`, `${coll}/${tid}/${rid}`, "kayıt nesne değil");
          continue;
        }
        const uid = uidField && typeof r[uidField] === "string" && r[uidField] ? r[uidField] : "__bad_uid__";
        checkRecord("KAYIT", `${label}-validate`, `${coll}/${tid}/${rid}`, r, { uid, token: { email: "" } }, profileFor(uid, validRole((users[uid] || {}).role)));
      }
    }
  }

  // ------------------------------------------------------------- aktiviteler
  for (const [aid, a] of Object.entries(isObj(v2.activities) ? v2.activities : {})) {
    if (!isObj(a)) {
      add("KAYIT", "aktivite-biçim", `activities/${aid}`, "kayıt nesne değil");
      continue;
    }
    const uid = typeof a.user_uid === "string" && a.user_uid ? a.user_uid : "__bad_uid__";
    const role = users[uid] && ROLES.includes(users[uid].role) ? users[uid].role : "super_admin"; // silinmiş kullanıcı: personel varsay
    checkRecord("KAYIT", "aktivite-validate", `activities/${aid}`, a, { uid, token: { email: lc((users[uid] || {}).email) } }, profileFor(uid, role));
  }

  // ------------------------------------------------------------- sayaçlar
  for (const [type, codes] of Object.entries(isObj(v2.counters) ? v2.counters : {})) {
    for (const [code, months] of Object.entries(isObj(codes) ? codes : {})) {
      for (const [yymm, val] of Object.entries(isObj(months) ? months : {})) {
        const p = `counters/${type}/${code}/${yymm}`;
        stats.records += 1;
        const data = { users: { [ADMIN_AUTH.uid]: ADMIN_PROFILE } };
        setIn(data, p.split("/"), val);
        const next = typeof val === "number" ? val + 1 : 1;
        const res = base.with({ data: { v2: data } }).as(ADMIN_AUTH).write("/v2/" + p, next);
        if (!res.allowed) add("ENGEL", "sayaç-artırılamaz", p, `bu müşteri kodu/ay için ticket numarası ÜRETİLEMEZ (kural: tür SUP|ARZ|PRJ|INT|DEV|BUG, kod [A-Za-z0-9_-]{1,20}, yymm 4 hane): ${failedValidates(res.info).map((f) => f.path).join(", ")}`);
        const seq = numberSeq.get(`${type}|${code}|${yymm}`);
        if (typeof val === "number" && seq && val < seq) add("BİLGİ", "sayaç-geride", p, `sayaç ${val}, en yüksek talep numarası ${seq}: yeni talepler yinelenen numara alabilir`);
      }
    }
  }

  // ------------------------------------------------------------- kullanıcılar / sözleşmeler
  for (const [uid, u] of Object.entries(users)) {
    if (!isObj(u)) {
      add("KAYIT", "kullanıcı-biçim", `users/${uid}`, "kayıt nesne değil");
      continue;
    }
    if (!u.role) add("BİLGİ", "profilde-rol-yok", `users/${uid}`, "role alanı yok (profilsiz sayılır: talep/sayaç yazamaz)");
    else if (!ROLES.includes(u.role)) add("KAYIT", "geçersiz-rol", `users/${uid}/role`, `rol ${JSON.stringify(u.role)} geçerli değil`);
    for (const f of ["last_login_at", "updated_at"]) if (u[f] !== undefined && (typeof u[f] !== "string" || u[f].length > 40)) add("KAYIT", "kullanıcı-damga", `users/${uid}/${f}`, `${f} dize ve ≤40 karakter olmalı`);
    if (u.must_change_password !== undefined && typeof u.must_change_password !== "boolean") add("KAYIT", "kullanıcı-boolean", `users/${uid}/must_change_password`, "boolean olmalı");
  }
  for (const [cid, c] of Object.entries(isObj(v2.contracts) ? v2.contracts : {})) {
    if (isObj(c) && c.value !== undefined) {
      add("GÖÇ", "sözleşme-bedeli", `contracts/${cid}/value`, `bedel contracts altında okunabilir (${JSON.stringify(c.value)}); contract_values/${cid} düğümüne taşınmalı (yeni kural contracts/<id>/value yazımını reddeder)`);
      if (typeof c.value === "number") {
        backfill[`contract_values/${cid}/value`] = c.value;
        backfill[`contract_values/${cid}/updated_at`] = new Date(opts.now).toISOString();
        backfill[`contracts/${cid}/value`] = null;
      } else {
        add("KAYIT", "sözleşme-bedeli-biçim", `contracts/${cid}/value`, `bedel sayı değil: ${JSON.stringify(c.value)} (elle düzeltin)`);
      }
    }
  }

  // ------------------------------------------------------------- göç: assigned_uids ve closed_at_ms
  const uidByEmail = new Map();
  for (const [uid, u] of Object.entries(users)) if (isObj(u) && u.email) uidByEmail.set(lc(u.email), uid);
  const unmappedPersonnel = new Set();
  const assignedTickets = [];
  for (const [id, t] of Object.entries(tickets)) {
    if (!isObj(t)) continue;
    const ids = new Set(Object.keys(isObj((v2.ticket_assignments || {})[id]) ? v2.ticket_assignments[id] : {}));
    if (!ids.size && t.assigned_to_id) ids.add(t.assigned_to_id);
    const have = isObj(t.assigned_uids) ? t.assigned_uids : {};
    const uids = new Set();
    for (const pid of ids) {
      const asg = ((v2.ticket_assignments || {})[id] || {})[pid] || {};
      const email = lc(asg.personnel_email || (personnel[pid] || {}).email);
      const uid = uidByEmail.get(email);
      if (uid) uids.add(uid);
      else unmappedPersonnel.add(`${pid}${email ? ` (${email})` : ""}`);
    }
    const missing = [...uids].filter((u) => have[u] !== true);
    if (missing.length) {
      assignedTickets.push(id);
      for (const u of missing) backfill[`tickets/${id}/assigned_uids/${u}`] = true;
    }
    if (String(t.status) === "closed" && typeof t.closed_at === "string" && t.closed_at_ms === undefined) {
      const ms = Date.parse(t.closed_at);
      if (Number.isFinite(ms)) {
        backfill[`tickets/${id}/closed_at_ms`] = ms;
        add("GÖÇ", "closed_at_ms", `tickets/${id}`, `kapalı talepte closed_at_ms yok (müşteri yeniden açamaz); ${t.closed_at} -> ${ms}`);
      } else add("KAYIT", "closed_at-biçim", `tickets/${id}/closed_at`, `closed_at ayrıştırılamadı: ${JSON.stringify(t.closed_at)}`);
    }
  }
  if (assignedTickets.length) add("GÖÇ", "assigned_uids", "tickets/*", `${assignedTickets.length} talepte atanmış danışmanlar için assigned_uids haritası eksik (danışmanlar bu taleplere YAZAMAZ): ${assignedTickets.slice(0, 8).join(", ")}${assignedTickets.length > 8 ? "…" : ""}`);
  for (const p of unmappedPersonnel) add("BİLGİ", "personel-kullanıcı-eşleşmedi", `personnel/${p.split(" ")[0]}`, `personel ${p} için e-posta eşleşen kullanıcı yok; assigned_uids yazılamadı`);

  // ------------------------------------------------------------- özet
  const byClass = {};
  const byCode = {};
  for (const f of findings) {
    byClass[f.cls] = (byClass[f.cls] || 0) + 1;
    const k = `${f.cls}/${f.code}`;
    byCode[k] = (byCode[k] || 0) + 1;
  }
  return { findings, byClass, byCode, backfill, stats: Object.assign(stats, { tickets: Object.keys(tickets).length, users: Object.keys(users).length }) };
}

function formatReport(result, options) {
  const o = Object.assign({ max: 5, all: false }, options || {});
  const lines = [];
  lines.push(`Taranan kayıt: ${result.stats.records} (talep: ${result.stats.tickets}, kullanıcı: ${result.stats.users})`);
  lines.push("");
  const groups = {};
  for (const f of result.findings) (groups[`${f.cls}/${f.code}`] = groups[`${f.cls}/${f.code}`] || []).push(f);
  const order = { ENGEL: 0, GÖÇ: 1, KAYIT: 2, BİLGİ: 3 };
  for (const key of Object.keys(groups).sort((a, b) => order[a.split("/")[0]] - order[b.split("/")[0]] || a.localeCompare(b))) {
    const list = groups[key];
    lines.push(`[${key}] ${list.length} bulgu`);
    for (const f of o.all ? list : list.slice(0, o.max)) lines.push(`   ${f.where}: ${f.detail}`);
    if (!o.all && list.length > o.max) lines.push(`   … ${list.length - o.max} bulgu daha (--all ile tümünü gösterin)`);
  }
  lines.push("");
  const c = result.byClass;
  lines.push(`ÖZET  ENGEL: ${c.ENGEL || 0} · GÖÇ: ${c["GÖÇ"] || 0} · KAYIT: ${c.KAYIT || 0} · BİLGİ: ${c["BİLGİ"] || 0}`);
  if (c.ENGEL) lines.push("SONUÇ: KURALLARI DAĞITMAYIN — ENGEL bulgularını önce verideki kayıtları düzelterek giderin.");
  else if (c["GÖÇ"] || c.KAYIT) lines.push("SONUÇ: dağıtım öncesi GÖÇ/KAYIT bulgularını gözden geçirin (--emit-backfill ile göç dosyası üretilebilir).");
  else lines.push("SONUÇ: temiz — eski kayıtlar yeni .validate kurallarıyla uyumlu.");
  return lines.join("\n");
}

function exitCode(result) {
  if (result.byClass.ENGEL) return 2;
  if (result.byClass["GÖÇ"] || result.byClass.KAYIT) return 1;
  return 0;
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => args.includes(name);
  const val = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const positional = args.filter((a, i) => !a.startsWith("--") && !["--json", "--emit-backfill", "--max", "--rules"].includes(args[i - 1]));
  const input = positional[0];
  if (!input || flag("--help")) {
    console.error("Kullanım: node scan-existing-data.cjs <rtdb-export.json> [--json rapor.json] [--emit-backfill göç.json] [--all] [--max N] [--rules database.rules.json]");
    return 64;
  }
  const outputs = [val("--json"), val("--emit-backfill")].filter(Boolean).map((p) => path.resolve(p));
  if (outputs.includes(path.resolve(input))) {
    console.error("Girdi dosyasının üzerine yazılamaz.");
    return 64;
  }
  const data = JSON.parse(fs.readFileSync(input, "utf8"));
  const result = scan(data, { rulesPath: val("--rules") ? path.resolve(val("--rules")) : undefined });
  console.log(formatReport(result, { all: flag("--all"), max: val("--max") ? parseInt(val("--max"), 10) : 5 }));
  if (val("--json")) fs.writeFileSync(val("--json"), JSON.stringify({ byClass: result.byClass, byCode: result.byCode, findings: result.findings }, null, 2));
  if (val("--emit-backfill")) {
    fs.writeFileSync(val("--emit-backfill"), JSON.stringify(result.backfill, null, 2));
    console.log(`Göç dosyası yazıldı: ${val("--emit-backfill")} (${Object.keys(result.backfill).length} yol). Admin SDK ile uygulayın: db.ref('v2').update(JSON.parse(...)) — Console 'İçe aktar' KULLANMAYIN (düğümü değiştirir).`);
  }
  return exitCode(result);
}

module.exports = { scan, formatReport, exitCode, permissiveRules };
if (require.main === module) {
  try {
    process.exit(main(process.argv));
  } catch (e) {
    console.error(`Hata: ${e.message}`);
    process.exit(70);
  }
}
