/**
 * Zamanlanmış talep otomasyonu (D-07 C): SLA uyarısı, müşteri hatırlatmaları, otomatik kapanış, atanmamış eskalasyonu.
 *
 * İş kuralları AYNI saf fonksiyonlardan gelir (istemci `assets/js/support-v2/ticket-utils.js`; DOM'a dokunmayan saf ES modül):
 *   computeSla (SLA muhasebesi, duraklama), buildSlaPatch (ihlal damgaları), computeStatusStamps (kapanış damgaları).
 *   Böylece sunucu ve arayüz AYNI durum/SLA hesabını kullanır; ticket-utils.js sunucu tarafından içe aktarıldığı için
 *   modül üst düzeyinde DOM/`window` kullanmamalı ve içe aktarma (import) içermemelidir (sözleşme testi: netlify/tests/automation.test.mjs).
 *
 * Kota (D-04 A ≈100 e-posta/gün) — öncelik sırası: otomatik kapanış > SLA aşımı > atanmamış eskalasyonu > SLA %80 uyarısı > hatırlatma.
 *   - Yüksek öncelik (kapanış, SLA aşımı) sert sınıra (95) kadar gönderilir; düşük öncelik yumuşak sınıra (80) ve otomasyonun
 *     kendi günlük payına (varsayılan 40) kadar. Pay/yumuşak sınır aşılınca düşük öncelikli bildirimler tek bir günlük özete
 *     (`digest:<gün>` → email-digest.mjs) eklenir; her çalıştırmada en çok `maxPerRun` e-posta gider (kalanı sonraki çalıştırmaya kalır).
 *   - Her olay talep başına bir kez: talep üzerinde `reminder_*`, `sla_*`, `auto_close_*` damgaları + koruma deposunda claim anahtarı.
 *     Yeniden açma/yeni durum girişi damgaları geçersiz kılar (damga zamanı, pencere/durum başlangıcından eskiyse yok sayılır).
 */
import {
  STATUSES,
  computeSla,
  buildSlaPatch,
  computeStatusStamps,
  slaWindowStartMs,
  isSlaTicket,
  formatDuration,
} from "../../assets/js/support-v2/ticket-utils.js";

// CJS modülleri statik içe aktarılır (esbuild bunları işlev paketine gömer; çalışma zamanı `require` gömülmez).
import guard from "./email-guard.js";
import mailer from "./mailer.js";
import recipientsLib from "./recipients.js";
import templates from "./email-templates.js";

const { sendServerEmail } = mailer;
const { createResolver } = recipientsLib;
const { BRAND, singleLine, truncateText } = templates;

const DAY_MS = 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
export const RULES = {
  slaWarnFraction: 0.8,
  waitingReminderDays: [3, 7],
  pendingCloseReminderDay: 3,
  pendingCloseAutoCloseDay: 10,
  unassignedHours: 4,
  maxFailures: 6,
  /** Çok eski SLA aşımları (ilk etkinleştirmede birikmiş) e-posta üretmez; yalnızca damgalanır. */
  staleBreachHours: 24,
};
const ACTIVE_STATUSES = [
  STATUSES.OPEN,
  STATUSES.ASSIGNED,
  STATUSES.IN_PROGRESS,
  STATUSES.WAITING_CUSTOMER,
  STATUSES.PENDING_CLOSE,
  STATUSES.REOPENED,
];
/** Daha küçük sayı = daha öncelikli. */
const RANK = { auto_close: 1, sla_breach: 2, unassigned: 3, sla_warn: 4, reminder: 5 };
const SYSTEM_NAME = "Sistem (otomatik)";

const ms = (v) => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : 0;
};
const lower = (v) => String(v || "").toLowerCase();
const iso = (n) => new Date(n).toISOString();

// -------------------------------------------------------------------------------------------------------------------
// Saf planlama (testlenebilir): bir talep için hangi bildirimler/işlemler gerekli?
// -------------------------------------------------------------------------------------------------------------------

/** Damga geçerli mi: değeri `sinceMs`'ten (pencere/durum başlangıcı) önce yazılmışsa eskidir. */
function stampValid(ticket, field, sinceMs) {
  const t = ms(ticket[field]);
  return t > 0 && t >= sinceMs;
}

/**
 * @param {object} ticket
 * @param {{ nowMs: number, statusSinceMs?: number }} env statusSinceMs: waiting_customer/pending_close durumuna giriş anı
 * @returns {Array<object>} not: { kind, rank, audiences..., stamps: {alan: değer}, ... }
 */
export function planTicket(ticket, env) {
  const nowMs = env.nowMs;
  const status = lower(ticket.status);
  const notices = [];
  const stampNow = iso(nowMs);

  // ---- SLA (yalnız müşteri kaynaklı tipler; duraklamada yok) ----
  if (isSlaTicket(ticket)) {
    const sla = computeSla(ticket, nowMs);
    if (sla && !sla.paused) {
      const wStart = slaWindowStartMs(ticket);
      const createdMs = ms(ticket.created_at);
      const phases = [
        { key: "response", label: "İlk yanıt", startMs: createdMs, since: 0, p: sla.response },
        { key: "resolution", label: "Çözüm", startMs: wStart, since: wStart, p: sla.resolution },
      ];
      const warn = [];
      const breach = [];
      for (const ph of phases) {
        if (!["pending", "breached"].includes(ph.p.state)) continue; // tamamlanmış faz
        const total = ph.p.dueMs - ph.startMs;
        const fraction = total > 0 ? (nowMs - ph.startMs) / total : 1;
        const alertField = `sla_alert_${ph.key}_at`;
        const warnField = `sla_warn_${ph.key}_at`;
        if (ph.p.state === "breached") {
          if (!stampValid(ticket, alertField, ph.since)) breach.push({ ...ph, alertField, warnField });
        } else if (fraction >= RULES.slaWarnFraction && !stampValid(ticket, warnField, ph.since)) {
          warn.push({ ...ph, alertField, warnField, remainingMs: ph.p.dueMs - nowMs });
        }
      }
      if (breach.length) {
        const stamps = {};
        breach.forEach((b) => {
          stamps[b.alertField] = stampNow;
          stamps[b.warnField] = stampNow; // aşım uyarısı varken %80 uyarısı artık anlamsız
        });
        // Aşımı çok önce olmuş talepler (otomasyon yeni açıldıysa birikmiş) yeni bir "alarm" değildir: sessizce damgalanır.
        const stale = breach.every((b) => nowMs - b.p.dueMs > RULES.staleBreachHours * HOUR_MS);
        notices.push({
          silent: stale,
          kind: "sla_breach",
          rank: RANK.sla_breach,
          type: "sla_breached",
          audience: "staff",
          toSupportAlso: true,
          data: { phase_label: breach.map((b) => b.label).join(" ve ") },
          stamps,
          claim: `sla_breach:${breach.map((b) => `${b.key}${b.since}`).join(",")}`,
          slaPatchNeeded: true,
        });
      } else if (warn.length) {
        const stamps = {};
        warn.forEach((w) => {
          stamps[w.warnField] = stampNow;
        });
        notices.push({
          kind: "sla_warn",
          rank: RANK.sla_warn,
          type: "sla_warning",
          audience: "staff",
          data: {
            phase_label: warn.map((w) => w.label).join(" ve "),
            remaining_text: formatDuration(Math.min(...warn.map((w) => w.remainingMs))),
          },
          stamps,
          claim: `sla_warn:${warn.map((w) => `${w.key}${w.since}`).join(",")}`,
        });
      }
    }
  }

  // ---- atanmamış eskalasyonu ----
  const unassigned = !String(ticket.assigned_to_id || "").trim() && !(ticket.assigned_uids && Object.keys(ticket.assigned_uids).length);
  if (isSlaTicket(ticket) && unassigned && [STATUSES.OPEN, STATUSES.REOPENED].includes(status)) {
    const since = slaWindowStartMs(ticket);
    if (since && nowMs - since >= RULES.unassignedHours * HOUR_MS && !stampValid(ticket, "reminder_unassigned_at", since)) {
      notices.push({
        kind: "unassigned",
        rank: RANK.unassigned,
        type: "unassigned_escalation",
        audience: "staff",
        recipientMode: "assigners",
        data: { hours: RULES.unassignedHours },
        stamps: { reminder_unassigned_at: stampNow },
        claim: `unassigned:${since}`,
      });
    }
  }

  // ---- müşteri bekleniyor ----
  if (status === STATUSES.WAITING_CUSTOMER) {
    const since = env.statusSinceMs || ms(ticket.public_updated_at || ticket.updated_at || ticket.created_at);
    const days = Math.floor((nowMs - since) / DAY_MS);
    const [d3, d7] = RULES.waitingReminderDays;
    const has3 = stampValid(ticket, "reminder_wc3_at", since);
    const has7 = stampValid(ticket, "reminder_wc7_at", since);
    let due = 0;
    if (days >= d7 && !has7) due = d7;
    else if (days >= d3 && !has3 && !has7) due = d3;
    if (due) {
      const stamps = { reminder_wc3_at: has3 ? ticket.reminder_wc3_at : stampNow };
      if (due === d7) stamps.reminder_wc7_at = stampNow;
      notices.push({
        kind: "reminder",
        rank: RANK.reminder,
        type: "reminder_waiting_customer",
        audience: "customer",
        data: { days },
        stamps,
        claim: `wc${due}:${since}`,
        // 7. günde ilgili danışman da bilgilendirilir (müşteriyi aramak isteyebilir)
        staffCopy: due === d7,
      });
    }
  }

  // ---- kapanış onayı bekleniyor: hatırlatma + otomatik kapanış ----
  if (status === STATUSES.PENDING_CLOSE) {
    const since = env.statusSinceMs || ms(ticket.public_updated_at || ticket.updated_at || ticket.created_at);
    const days = Math.floor((nowMs - since) / DAY_MS);
    if (days >= RULES.pendingCloseAutoCloseDay) {
      notices.push({
        kind: "auto_close",
        rank: RANK.auto_close,
        type: "ticket_auto_closed",
        audience: "customer",
        staffCopy: true,
        data: { days: RULES.pendingCloseAutoCloseDay },
        stamps: {},
        claim: `autoclose:${since}`,
        autoClose: true,
      });
    } else if (days >= RULES.pendingCloseReminderDay && !stampValid(ticket, "reminder_pc3_at", since)) {
      notices.push({
        kind: "reminder",
        rank: RANK.reminder,
        type: "reminder_pending_close",
        audience: "customer",
        data: { days, days_left: RULES.pendingCloseAutoCloseDay - days },
        stamps: { reminder_pc3_at: stampNow },
        claim: `pc3:${since}`,
      });
    }
  }
  return notices;
}

// -------------------------------------------------------------------------------------------------------------------
// Çalıştırıcı
// -------------------------------------------------------------------------------------------------------------------

async function loadActiveTickets(admin) {
  const out = new Map();
  for (const status of ACTIVE_STATUSES) {
    const rows = await admin.db.get("v2/tickets", { orderBy: "status", equalTo: status });
    for (const [id, t] of Object.entries(rows && typeof rows === "object" ? rows : {})) {
      if (t && typeof t === "object" && t.is_deleted !== true && lower(t.status) === status) out.set(id, t);
    }
  }
  return out;
}

/** Durum girişi anı: geçmişteki son `status` değişikliği (yoksa null → plan yedeği: son herkese açık hareket). */
async function statusEnteredAt(admin, ticketId, status) {
  const rows = await admin.db.get(`v2/ticket_history/${ticketId}`, { orderBy: "$key", limitToLast: 30 });
  const entries = Object.entries(rows && typeof rows === "object" ? rows : {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  for (const [, h] of entries) {
    if (h && h.field_changed === "status" && lower(h.new_value) === status) {
      const t = ms(h.changed_at);
      if (t) return t;
    }
  }
  return null;
}

function ticketData(ticket, id, ctx, audience, extra) {
  return {
    ticket_id: id,
    ticket_number: String(ticket.ticket_number || "").slice(0, 60),
    title: String(ticket.title || "").slice(0, 300),
    status: ticket.status,
    priority: ticket.priority,
    company_name: String(ticket.company_name || "").slice(0, 200),
    user_name: String(ticket.user_name || "").slice(0, 120),
    audience,
    portalUrl: ctx.siteUrl,
    privacyUrl: ctx.privacyUrl || "",
    ...(extra || {}),
  };
}

async function writeAutoClose(ctx, id, ticket, notice) {
  const { admin } = ctx;
  // Yarış koruması: son anda durumu yeniden oku (müşteri o sırada onaylamış/yeniden açmış olabilir).
  const fresh = await admin.db.get(`v2/tickets/${id}`);
  if (!fresh || lower(fresh.status) !== STATUSES.PENDING_CLOSE || fresh.is_deleted === true) return false;
  const ts = iso(ctx.nowMs);
  const patch = { status: STATUSES.CLOSED, ...computeStatusStamps(fresh, STATUSES.CLOSED, ts, {}) };
  const sla = buildSlaPatch(fresh, { status: STATUSES.CLOSED }, ts);
  if (sla) Object.assign(patch, sla);
  patch.auto_close_at = ts;
  patch.auto_close_by = "system";
  patch.updated_at = ts;
  patch.updated_by = "system";
  patch.public_updated_at = ts;
  patch.public_updated_by = "system";

  const out = {};
  for (const [k, v] of Object.entries(patch)) out[`tickets/${id}/${k}`] = v;
  const hKey = admin.db.newKey();
  const days = RULES.pendingCloseAutoCloseDay;
  out[`ticket_history/${id}/${hKey}`] = {
    history_id: hKey,
    action: "status_note",
    field_changed: "status",
    old_value: STATUSES.PENDING_CLOSE,
    new_value: STATUSES.CLOSED,
    note: `Müşteri ${days} gün içinde kapanış onayı vermediği için talep sistem tarafından otomatik kapatıldı.`,
    changed_by_uid: "system",
    changed_by_name: SYSTEM_NAME,
    changed_at: ts,
  };
  const aKey = admin.db.newKey();
  out[`activities/${aKey}`] = {
    activity_id: aKey,
    action: "ticket_auto_closed",
    entity_type: "ticket",
    entity_id: id,
    entity_label: String(fresh.ticket_number || id),
    user_uid: "system",
    user_name: SYSTEM_NAME,
    details: `${days} gün içinde onay alınamadı; otomatik kapatıldı`,
    created_at: ts,
  };
  await admin.db.update("v2", out);
  ticket.status = STATUSES.CLOSED;
  return true;
}

/**
 * Bir bildirimi gönderir (kota/özet/tekilleştirme kurallarıyla). Dönüş: sent | deferred | duplicate | skipped | failed | quota
 */
async function dispatchNotice(ctx, id, ticket, notice, to, part) {
  const priority = notice.rank <= RANK.sla_breach ? "high" : "low";
  const day = guard.dayKey(ctx.nowMs);
  const claim = `auto:${id}:${notice.claim}:${part}`;
  const digestEntry = {
    event: notice.type,
    audience: notice.audience === "customer" && part === "customer" ? "customer" : "staff",
    ticket_number: String(ticket.ticket_number || "").slice(0, 60),
    title: truncateText(singleLine(ticket.title), 60).text,
  };

  // Otomasyonun günlük payı (canlı bildirimlere ve Firebase Auth e-postalarına yer bırakır): dolunca olaylar doğrudan özete gider.
  // Otomatik kapanış bildirimi paydan muaftır (talep başına tek ve müşteriye giden tek haber).
  const countsAgainstShare = notice.rank !== RANK.auto_close;
  if (countsAgainstShare) {
    const used = (await ctx.store.get(`autoq:${day}`)) || 0;
    if (used + to.length > ctx.limits.automationDaily) {
      await guard.recordDeferred(ctx.store, { at: iso(ctx.nowMs), ...digestEntry }, ctx.nowMs);
      return "deferred";
    }
  }
  if (ctx.sentThisRun >= ctx.maxPerRun) return "skipped"; // sonraki çalıştırmaya kalır
  if (ctx.sendDelayMs && ctx.sentThisRun > 0) await new Promise((r) => setTimeout(r, ctx.sendDelayMs));

  const res = await sendServerEmail({
    store: ctx.store,
    limits: ctx.limits,
    apiKey: ctx.apiKey,
    type: notice.type,
    priority,
    to,
    data: ticketData(ticket, id, ctx, part === "customer" ? "customer" : "staff", notice.data),
    idempotencyKey: `${claim}`.slice(0, 200),
    dedupeKey: `evt:${claim}`,
    digestEntry,
    now: ctx.nowMs,
  });
  if (res.status === "sent") {
    ctx.sentThisRun += 1;
    if (countsAgainstShare) {
      await ctx.store.update(`autoq:${day}`, (cur) => ({ value: (Number(cur) || 0) + to.length, result: true }), { ttlMs: 3 * DAY_MS });
    }
    return "sent";
  }
  if (res.status === "quota" && priority === "high") {
    // Yüksek öncelikli bildirim sert kotaya takıldı: özete düşer (ertesi gün destek kutusuna iletilir).
    await guard.recordDeferred(ctx.store, { at: iso(ctx.nowMs), ...digestEntry }, ctx.nowMs);
    return "deferred";
  }
  return res.status === "failed" ? "failed" : res.status;
}
/**
 * Tüm aktif talepleri tarar ve gereken bildirim/işlemleri yapar.
 * @param {{
 *   admin: object, store: object, apiKey: string, limits?: object, siteUrl?: string, privacyUrl?: string, contact?: string,
 *   now?: number, maxPerRun?: number, automationDailyMax?: number, sendDelayMs?: number, deadlineMs?: number, env?: object
 * }} opts
 */
export async function runAutomation(opts) {
  const env = opts.env || process.env;
  const nowMs = opts.now == null ? Date.now() : opts.now;
  const limits = { ...(opts.limits || guard.getLimits(env, { relaxed: false })) };
  limits.automationDaily = opts.automationDailyMax != null ? opts.automationDailyMax : Number(env.AUTOMATION_EMAIL_DAILY_MAX) || 40;
  const ctx = {
    admin: opts.admin,
    store: opts.store,
    apiKey: opts.apiKey,
    limits,
    siteUrl: opts.siteUrl || BRAND.siteUrl,
    privacyUrl: opts.privacyUrl || "",
    nowMs,
    sentThisRun: 0,
    maxPerRun: opts.maxPerRun != null ? opts.maxPerRun : Number(env.AUTOMATION_MAX_EMAILS_PER_RUN) || 15,
    sendDelayMs: opts.sendDelayMs != null ? opts.sendDelayMs : 600,
  };
  const support = String(opts.contact || env.CONTACT_EMAIL || BRAND.fromEmail).trim().toLowerCase();
  const deadline = Date.now() + (opts.deadlineMs != null ? opts.deadlineMs : 22000);
  const resolver = createResolver(ctx.admin.db);
  const summary = { scanned: 0, notices: 0, sent: 0, deferred: 0, failed: 0, skipped: 0, auto_closed: 0, stamped: 0, duplicates: 0, silent: 0 };

  const tickets = await loadActiveTickets(ctx.admin);
  summary.scanned = tickets.size;

  // 1) planla
  const plan = [];
  for (const [id, ticket] of tickets) {
    let statusSinceMs;
    const status = lower(ticket.status);
    const worth = [STATUSES.WAITING_CUSTOMER, STATUSES.PENDING_CLOSE].includes(status);
    if (worth) {
      // Geçmiş okuması yalnızca bu iki durum için (az sayıda talep); bulunamazsa plan son herkese açık harekete düşer.
      statusSinceMs = (await statusEnteredAt(ctx.admin, id, status)) || undefined;
    }
    for (const notice of planTicket(ticket, { nowMs, statusSinceMs })) plan.push({ id, ticket, notice });
  }
  plan.sort((a, b) => a.notice.rank - b.notice.rank || ms(a.ticket.created_at) - ms(b.ticket.created_at));
  summary.notices = plan.length;

  // 2) uygula
  for (const item of plan) {
    if (Date.now() > deadline) {
      summary.skipped += 1;
      continue;
    }
    const { id, ticket, notice } = item;
    try {
      // Yeniden denemeler sonsuza dek sürmesin: art arda başarısızlık sayacı
      const failKey = `autofail:${id}:${notice.claim}`;
      const failures = (await ctx.store.get(failKey)) || 0;
      const giveUp = failures >= RULES.maxFailures;

      if (notice.silent) {
        const patch = {};
        const stamps = { ...notice.stamps };
        if (notice.slaPatchNeeded) {
          const slaPatch = buildSlaPatch(ticket, { status: ticket.status }, iso(nowMs));
          if (slaPatch) Object.assign(stamps, slaPatch);
        }
        for (const [k, v] of Object.entries(stamps)) patch[`tickets/${id}/${k}`] = v;
        await ctx.admin.db.update("v2", patch);
        Object.assign(ticket, stamps);
        summary.silent += 1;
        continue;
      }

      if (notice.autoClose) {
        const closed = await writeAutoClose(ctx, id, ticket, notice);
        if (!closed) {
          summary.skipped += 1;
          continue;
        }
        summary.auto_closed += 1;
      }

      const owner = await resolver.owner(ticket);
      const assigned = (await resolver.assigned(id, ticket)).map((a) => a.email);
      const staffTo = (extraSupport) => {
        const base = assigned.length ? assigned : [support];
        return [...new Set(extraSupport ? [...base, support] : base)];
      };
      const parts = [];
      if (notice.audience === "customer") {
        if (owner) parts.push({ part: "customer", to: [owner] });
        if (notice.staffCopy) parts.push({ part: "staff", to: staffTo(notice.type === "ticket_auto_closed") });
      } else if (notice.recipientMode === "assigners") {
        const assigners = await resolver.assigners();
        parts.push({ part: "staff", to: [...new Set([support, ...assigners])] });
      } else {
        parts.push({ part: "staff", to: staffTo(notice.toSupportAlso) });
      }

      const outcomes = [];
      for (const p of parts) outcomes.push(await dispatchNotice(ctx, id, ticket, notice, p.to, p.part));
      const primary = outcomes[0];
      summary.sent += outcomes.filter((o) => o === "sent").length;
      summary.deferred += outcomes.filter((o) => o === "deferred").length;
      summary.duplicates += outcomes.filter((o) => o === "duplicate").length;
      summary.skipped += outcomes.filter((o) => o === "skipped").length;

      const done = !parts.length || ["sent", "deferred", "duplicate"].includes(primary) || notice.autoClose;
      if (!done && primary === "failed") {
        summary.failed += 1;
        await ctx.store.set(failKey, failures + 1, { ttlMs: 3 * DAY_MS });
      }
      if (done || giveUp) {
        if (giveUp && !done) console.error("[automation] bildirim vazgeçildi (art arda başarısız)", { id, claim: notice.claim });
        const stamps = { ...notice.stamps };
        if (notice.slaPatchNeeded) {
          const slaPatch = buildSlaPatch(ticket, { status: ticket.status }, iso(nowMs));
          if (slaPatch) Object.assign(stamps, slaPatch);
        }
        if (Object.keys(stamps).length) {
          const patch = {};
          for (const [k, v] of Object.entries(stamps)) patch[`tickets/${id}/${k}`] = v;
          await ctx.admin.db.update("v2", patch);
          Object.assign(ticket, stamps);
          summary.stamped += 1;
        }
      }
    } catch (err) {
      summary.failed += 1;
      console.error("[automation] talep işlenemedi", { id, kind: notice.kind, code: err && err.code, msg: err && err.message });
    }
  }
  return summary;
}
