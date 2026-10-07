/**
 * Parla BT Ticket V2 — sabitler ve yardımcı fonksiyonlar
 */

export const ROLES = {
  SUPER_ADMIN: "super_admin",
  SERVICE_ADMIN: "service_admin",
  PROJECT_MANAGER: "project_manager",
  CONSULTANT: "consultant",
  COMPANY_ADMIN: "company_admin",
  CUSTOMER: "customer",
  ARIZI_CUSTOMER: "arizi_customer",
};

export const ROLE_LABELS = {
  super_admin: "Süper Admin",
  service_admin: "Destek Atayıcı",
  project_manager: "Proje Yöneticisi",
  consultant: "Danışman",
  company_admin: "Firma Yöneticisi",
  customer: "Müşteri Kullanıcısı",
  arizi_customer: "Arızi Müşteri",
};

export const ADMIN_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.SERVICE_ADMIN,
  ROLES.PROJECT_MANAGER,
  ROLES.CONSULTANT,
];

export const CUSTOMER_ROLES = [ROLES.COMPANY_ADMIN, ROLES.CUSTOMER, ROLES.ARIZI_CUSTOMER];

export const TICKET_TYPES = {
  SUP: "SUP",
  ARZ: "ARZ",
  PRJ: "PRJ",
  INT: "INT",
  DEV: "DEV",
  BUG: "BUG",
};

export const TICKET_TYPE_LABELS = {
  SUP: "Destek Anlaşmalı Talep",
  ARZ: "Arızi Talep",
  PRJ: "Proje Taskı",
  INT: "İç Task",
  DEV: "Geliştirme Taskı",
  BUG: "Hata / Problem Kaydı",
};

export const PRIORITIES = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

export const PRIORITY_LABELS = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};

export const STATUSES = {
  OPEN: "open",
  ASSIGNED: "assigned",
  IN_PROGRESS: "in_progress",
  WAITING_CUSTOMER: "waiting_customer",
  PENDING_CLOSE: "pending_close",
  RESOLVED: "resolved",
  CLOSED: "closed",
  REOPENED: "reopened",
};

export const STATUS_LABELS = {
  open: "Açık",
  assigned: "Atandı",
  in_progress: "İşlemde",
  waiting_customer: "Müşteri Bekleniyor",
  pending_close: "Kapanış Onayı Bekliyor",
  resolved: "Çözüldü",
  closed: "Kapandı",
  reopened: "Yeniden Açıldı",
};

export function isOpenStatus(status) {
  const s = String(status || "").toLowerCase();
  return s !== "closed" && s !== "resolved";
}

/** Açık sayılan tüm durumlar (atandı, kapanış onayı bekliyor, tekrar açıldı dahil). */
export const OPEN_STATUSES = Object.values(STATUSES).filter(isOpenStatus);

/** Yumuşak silinmiş (arşivlenmiş) talep mi? Liste/pano/rapor/zil/müşteri sayfaları bunları gizler. */
export function isDeletedTicket(ticket) {
  return !!ticket && ticket.is_deleted === true;
}

/** Silinmişleri ayıklar (tek yer: tüm sayfalar aynı süzgeci kullanır). */
export function liveTickets(tickets) {
  return (tickets || []).filter((t) => !isDeletedTicket(t));
}

/* ------------------------------------------------------------------ *
 * Zaman dilimi (Europe/Istanbul) yardımcıları
 * Ticket numarası ay kodu, efor tarihi, "bugün/bu ay" sayaçları tarayıcının
 * ya da UTC saat dilimine değil, işin yapıldığı saat dilimine göre hesaplanır.
 * ------------------------------------------------------------------ */
export const APP_TIME_ZONE = "Europe/Istanbul";

let istanbulFormatter = null;

/** Verilen anın İstanbul takvimindeki yıl/ay/gün değerleri. */
export function istanbulParts(date) {
  const d = date instanceof Date ? date : date == null ? new Date() : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  if (!istanbulFormatter) {
    istanbulFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: APP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const out = {};
  for (const part of istanbulFormatter.formatToParts(d)) {
    if (part.type === "year" || part.type === "month" || part.type === "day") out[part.type] = part.value;
  }
  return { year: out.year, month: out.month, day: out.day };
}

/** "2026-10-31" (İstanbul takvim günü). */
export function istanbulDateISO(date) {
  const p = istanbulParts(date);
  return p ? `${p.year}-${p.month}-${p.day}` : "";
}

/** "2026-10" (İstanbul takvim ayı). */
export function istanbulMonthKey(date) {
  const p = istanbulParts(date);
  return p ? `${p.year}-${p.month}` : "";
}

export function isSameIstanbulDay(value, now) {
  if (!value) return false;
  const a = istanbulDateISO(new Date(value));
  return !!a && a === istanbulDateISO(now == null ? new Date() : now);
}

export function isSameIstanbulMonth(value, now) {
  if (!value) return false;
  const a = istanbulMonthKey(new Date(value));
  return !!a && a === istanbulMonthKey(now == null ? new Date() : now);
}

/* ------------------------------------------------------------------ *
 * Durum makinesi
 * ------------------------------------------------------------------ */

/**
 * Personelin uygulayabileceği izinli geçişler.
 * açık → atandı → işlemde ↔ müşteri bekleniyor → kapanış onayı bekliyor → çözüldü → kapandı; kapandı → yeniden açıldı.
 * Geri alma geçişleri (işleme geri al, çözümü geri al, atamayı kaldırma) açıkça tanımlıdır.
 */
export const STATUS_TRANSITIONS = {
  [STATUSES.OPEN]: [STATUSES.ASSIGNED],
  [STATUSES.ASSIGNED]: [STATUSES.IN_PROGRESS, STATUSES.OPEN],
  [STATUSES.IN_PROGRESS]: [STATUSES.WAITING_CUSTOMER, STATUSES.PENDING_CLOSE, STATUSES.RESOLVED],
  [STATUSES.WAITING_CUSTOMER]: [STATUSES.IN_PROGRESS, STATUSES.PENDING_CLOSE],
  [STATUSES.PENDING_CLOSE]: [STATUSES.IN_PROGRESS, STATUSES.RESOLVED, STATUSES.CLOSED, STATUSES.REOPENED],
  [STATUSES.RESOLVED]: [STATUSES.CLOSED, STATUSES.IN_PROGRESS, STATUSES.REOPENED],
  [STATUSES.CLOSED]: [STATUSES.REOPENED],
  [STATUSES.REOPENED]: [STATUSES.IN_PROGRESS, STATUSES.WAITING_CUSTOMER, STATUSES.PENDING_CLOSE],
};

/** Müşterinin (talep sahibi / firma yöneticisi) yapabildiği geçişler (kurallarla aynı). */
export const CUSTOMER_STATUS_TRANSITIONS = {
  [STATUSES.WAITING_CUSTOMER]: [STATUSES.IN_PROGRESS],
  [STATUSES.PENDING_CLOSE]: [STATUSES.CLOSED, STATUSES.REOPENED],
  [STATUSES.RESOLVED]: [STATUSES.CLOSED, STATUSES.REOPENED],
  [STATUSES.CLOSED]: [STATUSES.REOPENED],
};

/** Danışmanın kendi başına uygulayabileceği hedef durumlar (kapatma/yeniden açma yöneticidedir). */
export const CONSULTANT_STATUS_TARGETS = [
  STATUSES.IN_PROGRESS,
  STATUSES.WAITING_CUSTOMER,
  STATUSES.PENDING_CLOSE,
];

const lower = (v) => String(v || "").toLowerCase();

/**
 * `from` durumundan geçilebilecek durumlar.
 * @param {{role?: string, hasAssignee?: boolean, actor?: "staff"|"customer"}} [opts]
 *  - actor "customer": müşteri geçişleri
 *  - hasAssignee: eski kayıtlarda danışmanı olup durumu "açık" kalmış talep doğrudan işleme alınabilir
 */
export function allowedTransitions(from, opts) {
  const o = opts || {};
  const f = lower(from);
  if (o.actor === "customer") return [...(CUSTOMER_STATUS_TRANSITIONS[f] || [])];
  let list = [...(STATUS_TRANSITIONS[f] || [])];
  if (f === STATUSES.OPEN && o.hasAssignee) list.push(STATUSES.IN_PROGRESS);
  if (lower(o.role) === ROLES.CONSULTANT) list = list.filter((s) => CONSULTANT_STATUS_TARGETS.includes(s));
  return list;
}

/** Aynı durumda kalmak her zaman geçerlidir. */
export function isTransitionAllowed(from, to, opts) {
  if (lower(from) === lower(to)) return true;
  return allowedTransitions(from, opts).includes(lower(to));
}

/**
 * Durum açılırı için seçenekler: izinli geçişler + (yalnız süper admin için) matris dışı kalanlar.
 * @returns {{current: string, allowed: string[], override: string[]}}
 */
export function statusSelectOptions(from, opts) {
  const o = opts || {};
  const current = lower(from);
  const allowed = allowedTransitions(current, o);
  const override =
    lower(o.role) === ROLES.SUPER_ADMIN
      ? Object.values(STATUSES).filter((s) => s !== current && !allowed.includes(s))
      : [];
  return { current, allowed, override };
}

/* ------------------------------------------------------------------ *
 * Damgalar (resolved_at / closed_at / reopened_at / started_at) — TEK yer
 * ------------------------------------------------------------------ */

const RESOLVING_STATUSES = [STATUSES.PENDING_CLOSE, STATUSES.RESOLVED];
const DONE_STATUSES = [STATUSES.PENDING_CLOSE, STATUSES.RESOLVED, STATUSES.CLOSED];
/** SLA saatinin durduğu durumlar (müşteri bekleniyor / müşteri onayı bekleniyor). */
export const SLA_PAUSING_STATUSES = [STATUSES.WAITING_CUSTOMER, STATUSES.PENDING_CLOSE];

const ms = (iso) => {
  if (iso == null || iso === "") return 0;
  const n = typeof iso === "number" ? iso : new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
};

/** Mevcut SLA penceresinin başlangıcı: yaratılış ya da son yeniden açılış. */
export function slaWindowStartMs(ticket) {
  const created = ms(ticket?.created_at);
  const reopened = ms(ticket?.reopened_at);
  return reopened > created ? reopened : created;
}

function slaWindowIso(ticket) {
  const created = ms(ticket?.created_at);
  const reopened = ms(ticket?.reopened_at);
  return reopened > created ? ticket.reopened_at : ticket?.created_at || "";
}

function resolvedInCurrentWindow(ticket) {
  const r = ms(ticket?.resolved_at);
  return r > 0 && r >= slaWindowStartMs(ticket);
}

/**
 * Durum geçişinin yazacağı/temizleyeceği damgalar. `null` değeri alanı siler.
 *  - resolved_at: kapanış onayı bekliyor/çözüldüye ilk geçiş; bu durumlara/kapandıya gitmeyen hedefte temizlenir
 *  - closed_at (+ closed_at_ms): kapandıya geçişte yazılır, başka hedefte temizlenir
 *  - reopened_at: her yeniden açılışta yazılır (yeni SLA penceresi)
 *  - started_at: ilk işleme alınışta
 * Müşteri çağrısında (isCustomer) yalnızca kuralların izin verdiği damgalar (closed_at, reopened_at) üretilir;
 * süresi geçmiş resolved_at hesapta (pencere başlangıcına göre) yok sayılır.
 */
export function computeStatusStamps(existing, toStatus, ts, options) {
  const o = options || {};
  const from = lower(existing?.status);
  const to = lower(toStatus);
  const patch = {};
  if (!to || to === from) return patch;

  if (!o.isCustomer) {
    if (to === STATUSES.IN_PROGRESS && !existing?.started_at) patch.started_at = ts;
    if (RESOLVING_STATUSES.includes(to) || to === STATUSES.CLOSED) {
      if (!resolvedInCurrentWindow(existing)) patch.resolved_at = ts;
    } else if (existing?.resolved_at) {
      patch.resolved_at = null;
    }
  }
  if (to === STATUSES.CLOSED) {
    patch.closed_at = ts;
    // Sayısal kapanış damgası: veritabanı kuralları müşterinin 14 günlük yeniden açma penceresini bununla denetler.
    patch.closed_at_ms = ms(ts) || Date.now();
  } else {
    if (existing?.closed_at) patch.closed_at = null;
    if (existing?.closed_at_ms != null) patch.closed_at_ms = null;
  }
  if (to === STATUSES.REOPENED) patch.reopened_at = ts;
  return patch;
}

/* ------------------------------------------------------------------ *
 * SLA (D-06 B): 7/24, duraklatma gerçek, çözüm = kapanış onayına ilk geçiş,
 * ihlal damgası saklanır, yeniden açmada yeni pencere.
 * ------------------------------------------------------------------ */

/**
 * SLA hedefleri (takvim saati). Yalnızca müşteri kaynaklı talep tiplerine uygulanır.
 * "Müşteri Bekleniyor" ve "Kapanış Onayı Bekliyor" durumlarında saat gerçekten durur.
 */
export const SLA_TARGETS_HOURS = {
  critical: { response: 1, resolution: 8 },
  high: { response: 4, resolution: 24 },
  medium: { response: 8, resolution: 72 },
  low: { response: 24, resolution: 120 },
};
export const SLA_TICKET_TYPES = ["SUP", "ARZ", "BUG"];

export function isSlaTicket(ticket) {
  return !!ticket && SLA_TICKET_TYPES.includes(String(ticket.ticket_type || "SUP").toUpperCase());
}

/**
 * SLA muhasebesi talep üzerinde düz `sla_*` alanlarında saklanır (veritabanı kuralları bu ön ekli skaler alanlara
 * yalnızca personel yazımına izin verir): sla_window, sla_paused_ms, sla_paused_since,
 * sla_response_breached_at, sla_resolution_breached_at.
 */
const SLA_FIELD_NAMES = {
  window: "sla_window",
  paused_ms: "sla_paused_ms",
  paused_since: "sla_paused_since",
  response_breached_at: "sla_response_breached_at",
  resolution_breached_at: "sla_resolution_breached_at",
};

function slaStore(ticket) {
  const out = {};
  for (const [key, field] of Object.entries(SLA_FIELD_NAMES)) {
    if (ticket && ticket[field] != null && ticket[field] !== "") out[key] = ticket[field];
  }
  return out;
}

function withSlaStore(ticket, store) {
  const out = { ...ticket };
  for (const [key, field] of Object.entries(SLA_FIELD_NAMES)) out[field] = store[key] == null ? null : store[key];
  return out;
}

/** Saklanan SLA muhasebesi geçerli pencereye mi ait? (yeniden açmadan kalan eski değerler yok sayılır) */
function slaStoreValid(ticket) {
  const sla = slaStore(ticket);
  const wStart = slaWindowStartMs(ticket);
  if (sla.window) return ms(sla.window) === wStart;
  return wStart === ms(ticket?.created_at);
}

function slaPhase(dueMs, doneMs, nowMs, stampMs) {
  const stamped = stampMs > 0;
  const effDueMs = stamped ? Math.min(dueMs, stampMs) : dueMs;
  if (doneMs) {
    return { state: stamped || doneMs > dueMs ? "late" : "met", dueMs: effDueMs, doneMs, remainingMs: effDueMs - doneMs, stamped };
  }
  const remainingMs = effDueMs - nowMs;
  return { state: stamped || remainingMs < 0 ? "breached" : "pending", dueMs: effDueMs, remainingMs, stamped };
}

/**
 * Talebin SLA durumu. null: SLA uygulanmaz (iç/proje talepleri).
 * state: pending | breached | met | late
 *  - paused: saat şu an duruyor (müşteri bekleniyor / kapanış onayı bekliyor)
 *  - breached: herhangi bir hedef aşıldı (geç tamamlananlar ve saklı ihlal damgaları dahil)
 *  - active: hâlâ süren (bitmemiş) bir hedef var
 */
export function computeSla(ticket, now) {
  if (!isSlaTicket(ticket)) return null;
  const target = SLA_TARGETS_HOURS[lower(ticket.priority || "medium")] || SLA_TARGETS_HOURS.medium;
  const createdMs = ms(ticket.created_at);
  if (!createdMs) return null;
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.now();
  const status = lower(ticket.status);
  const wStart = slaWindowStartMs(ticket);
  const sla = slaStore(ticket);
  const valid = slaStoreValid(ticket);
  const pubMs = ms(ticket.public_updated_at || ticket.updated_at);
  const pausing = SLA_PAUSING_STATUSES.includes(status);

  // Duraklatma muhasebesi: kapanmış duraklar + (varsa) süren durak.
  let closedPauseMs = valid ? Math.max(0, Number(sla.paused_ms) || 0) : 0;
  let sinceMs = valid ? ms(sla.paused_since) : 0;
  let currentPauseMs = 0;
  if (pausing) {
    if (!sinceMs) sinceMs = Math.min(nowMs, Math.max(pubMs, wStart)); // eski kayıt: son herkese açık hareket
    currentPauseMs = Math.max(0, nowMs - sinceMs);
  } else if (sinceMs) {
    // Duraklamayı müşteri bitirdi (yanıtladı/yeniden açtı) ve henüz bir personel yazımıyla kesinleşmedi.
    const endMs = Math.min(nowMs, Math.max(pubMs, sinceMs));
    closedPauseMs += Math.max(0, endMs - sinceMs);
  }

  // Çözüm: kapanış onayı bekliyor / çözüldü / kapandı durumunda ve bu penceredeki damgayla.
  let resolvedMs = 0;
  if (DONE_STATUSES.includes(status)) {
    const r = ms(ticket.resolved_at);
    const c = ms(ticket.closed_at);
    resolvedMs = r >= wStart && r > 0 ? r : c >= wStart && c > 0 ? c : 0;
    if (!resolvedMs) resolvedMs = status === STATUSES.PENDING_CLOSE ? sinceMs || pubMs || nowMs : ms(ticket.updated_at) || nowMs;
  }

  // İlk yanıt: kapanış/onay aşamasına gelmiş ama yanıt damgası olmayan eski kayıtlar çözüm anında yanıtlanmış sayılır.
  let firstMs = ms(ticket.first_response_at);
  if (!firstMs && resolvedMs) firstMs = resolvedMs;

  const responseDue = createdMs + target.response * 3600000 + (firstMs ? 0 : closedPauseMs + currentPauseMs);
  const resolutionDue = wStart + target.resolution * 3600000 + closedPauseMs + (resolvedMs ? 0 : currentPauseMs);

  const response = slaPhase(responseDue, firstMs || 0, nowMs, ms(sla.response_breached_at));
  const resolution = slaPhase(resolutionDue, resolvedMs || 0, nowMs, valid ? ms(sla.resolution_breached_at) : 0);
  const breached = ["breached", "late"].includes(response.state) || ["breached", "late"].includes(resolution.state);
  const active = ["pending", "breached"].includes(response.state) || ["pending", "breached"].includes(resolution.state);
  return { response, resolution, target, breached, active, paused: pausing, pausedMs: closedPauseMs + currentPauseMs, windowStartMs: wStart };
}

/**
 * Bir yazımdan önce gerçekleşmiş (ya da bu yazımla gerçekleşecek) ihlalleri saklanacak damgalara çevirir.
 * Öncelik düşürmek geriye dönük aşımı silmesin diye her personel yazımında çağrılır.
 * @returns {{response_breached_at?: string, resolution_breached_at?: string}}
 */
export function collectSlaBreachStamps(ticket, nowMs) {
  const sla = computeSla(ticket, nowMs);
  if (!sla) return {};
  const out = {};
  if (["breached", "late"].includes(sla.response.state) && !sla.response.stamped) {
    out.response_breached_at = new Date(sla.response.dueMs).toISOString();
  }
  if (["breached", "late"].includes(sla.resolution.state) && !sla.resolution.stamped) {
    out.resolution_breached_at = new Date(sla.resolution.dueMs).toISOString();
  }
  return out;
}

/**
 * Bir personel yazımı sonrası değişecek düz `sla_*` alanları (değişmiyorsa undefined; null = alanı sil).
 * @param {object} existing mevcut talep
 * @param {{status?: string}} patch uygulanacak alanlar
 * @param {string} tsIso yazım zamanı
 * @param {{pauseEndIso?: string}} [options] müşteri tarafından bitirilmiş duraklamanın bilinen bitişi
 */
export function buildSlaPatch(existing, patch, tsIso, options) {
  if (!isSlaTicket(existing)) return undefined;
  const o = options || {};
  const nowMs = ms(tsIso);
  const from = lower(existing.status);
  const to = patch && patch.status !== undefined ? lower(patch.status) : from;
  const prev = slaStore(existing);
  const valid = slaStoreValid(existing);
  const wIso = slaWindowIso(existing);
  const wStart = slaWindowStartMs(existing);

  const next = {
    window: wIso,
    paused_ms: valid ? Math.max(0, Number(prev.paused_ms) || 0) : 0,
    paused_since: valid && prev.paused_since ? prev.paused_since : null,
    response_breached_at: prev.response_breached_at || null,
    resolution_breached_at: valid ? prev.resolution_breached_at || null : null,
  };

  const wasPausing = SLA_PAUSING_STATUSES.includes(from);
  const pubMs = ms(existing.public_updated_at || existing.updated_at);
  if (wasPausing && !next.paused_since) {
    next.paused_since = new Date(Math.min(nowMs, Math.max(pubMs, wStart))).toISOString();
  } else if (!wasPausing && next.paused_since) {
    // Müşteri duraklamayı bitirmişti: bitişi geçmişten (varsa) ya da son herkese açık hareketten al.
    const since = ms(next.paused_since);
    const endMs = Math.min(nowMs, Math.max(ms(o.pauseEndIso) || pubMs, since));
    next.paused_ms += Math.max(0, endMs - since);
    next.paused_since = null;
  }

  // Bu yazımdan önceki ihlalleri (eski öncelik/hedefle) sakla.
  Object.assign(next, collectSlaBreachStamps(withSlaStore(existing, next), nowMs));

  if (to !== from) {
    if (to === STATUSES.REOPENED) {
      // Yeni pencere: duraklama ve çözüm ihlali sıfırlanır (ilk yanıt ihlali talebe aittir).
      next.window = tsIso;
      next.paused_ms = 0;
      next.paused_since = null;
      next.resolution_breached_at = null;
    } else {
      const toPausing = SLA_PAUSING_STATUSES.includes(to);
      if (next.paused_since && !toPausing) {
        next.paused_ms += Math.max(0, nowMs - ms(next.paused_since));
        next.paused_since = null;
      } else if (!next.paused_since && toPausing) {
        next.paused_since = tsIso;
      }
      // Çözüme (kapanış onayı) bu yazımla geçiliyorsa geç kalındıysa ihlali sakla.
      if (RESOLVING_STATUSES.includes(to) || to === STATUSES.CLOSED) {
        const after = {
          ...withSlaStore(existing, next),
          status: to,
          resolved_at: resolvedInCurrentWindow(existing) ? existing.resolved_at : tsIso,
        };
        Object.assign(next, collectSlaBreachStamps(after, nowMs));
      }
    }
  }

  // Yalnızca değişen alanlar (düz sla_* adlarıyla) döner; null değeri alanı siler.
  const base = { ...prev };
  if (valid && !base.window) base.window = wIso;
  const out = {};
  for (const [key, field] of Object.entries(SLA_FIELD_NAMES)) {
    const a = key === "paused_ms" ? Number(base[key]) || 0 : base[key] ?? null;
    const b = key === "paused_ms" ? Number(next[key]) || 0 : next[key] ?? null;
    if (a !== b) out[field] = b;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * SLA rozeti için tek metin kaynağı (pano, liste, zil aynı hesabı kullanır).
 * @returns {null | {cls: string, icon: string, text: string, title: string}}
 */
export function describeSla(ticket, now) {
  const sla = computeSla(ticket, now);
  if (!sla) return null;
  const status = lower(ticket.status);
  if (status === STATUSES.CLOSED || status === STATUSES.RESOLVED) {
    return sla.breached
      ? { cls: "late", icon: "fa-exclamation-circle", text: "SLA aşıldı", title: "Hedef süreler aşılarak tamamlandı" }
      : { cls: "met", icon: "fa-check-circle", text: "SLA karşılandı", title: "Hedef sürelerde tamamlandı" };
  }
  // Müşteri yanıtı/onayı beklenirken süre işlemez: rozet "duraklatıldı" der (önceden aşılmışsa bu da belirtilir).
  if (sla.paused) {
    const waiting = status === STATUSES.PENDING_CLOSE ? "Müşteri onayı bekleniyor" : "Müşteri yanıtı bekleniyor";
    return {
      cls: "paused",
      icon: "fa-pause-circle",
      text: sla.breached ? "SLA duraklatıldı (aşıldı)" : "SLA duraklatıldı",
      title: `${waiting}; süre işlemiyor${sla.breached ? ". Hedef süre duraklamadan önce aşılmıştı." : ""}`,
    };
  }
  const phaseKey = ["pending", "breached"].includes(sla.response.state) ? "response" : "resolution";
  const phase = sla[phaseKey];
  const label = phaseKey === "response" ? "İlk yanıt" : "Çözüm";
  const hours = sla.target[phaseKey];
  if (phase.state === "breached") {
    return { cls: "breach", icon: "fa-exclamation-triangle", text: `${label} aşıldı +${formatDuration(phase.remainingMs)}`, title: `${label} hedefi ${hours} saat` };
  }
  if (sla.breached) {
    return { cls: "late", icon: "fa-exclamation-circle", text: "SLA aşıldı", title: "Bir hedef süre aşılarak tamamlandı" };
  }
  if (phase.state === "met") {
    return { cls: "met", icon: "fa-check-circle", text: `${label} karşılandı`, title: `${label} hedefi ${hours} saat` };
  }
  const totalMs = hours * 3600000;
  const warn = phase.remainingMs / totalMs < 0.25;
  return { cls: warn ? "warn" : "ok", icon: "fa-stopwatch", text: `${label}: ${formatDuration(phase.remainingMs)} kaldı`, title: `${label} hedefi ${hours} saat` };
}

/** Çözümün tamamlandığı an (bu penceredeki resolved_at, yoksa closed_at); yoksa 0. Pano/rapor/liste ortak tanımı. */
export function resolutionEndMs(ticket) {
  const wStart = slaWindowStartMs(ticket);
  const r = ms(ticket?.resolved_at);
  const c = ms(ticket?.closed_at);
  if (r > 0 && r >= wStart) return r;
  if (c > 0 && c >= wStart) return c;
  return 0;
}

/** Yaratılıştan çözüme geçen süre (ms); çözülmemişse null. */
export function resolutionDurationMs(ticket) {
  const status = lower(ticket?.status);
  if (!["resolved", "closed"].includes(status)) return null;
  const end = resolutionEndMs(ticket);
  const start = ms(ticket?.created_at);
  return end && start && end >= start ? end - start : null;
}

/** "Bugün Kapanan": durumu kapalı ve closed_at bugün (İstanbul). Güncelleme zamanına bakılmaz. */
export function isClosedToday(ticket, now) {
  return lower(ticket?.status) === STATUSES.CLOSED && isSameIstanbulDay(ticket?.closed_at, now);
}

/** "Bu Ay Çözülen/Çözüldü": çözüldü ya da kapandı durumunda ve çözüm damgası bu ay (İstanbul). */
export function isResolvedThisMonth(ticket, now) {
  if (!["resolved", "closed"].includes(lower(ticket?.status))) return false;
  const end = resolutionEndMs(ticket);
  return !!end && isSameIstanbulMonth(end, now);
}

/** Müşterinin kapanmış/çözülmüş talebi yeniden açabileceği süre (gün). */
export const REOPEN_WINDOW_DAYS = 14;

/**
 * Müşteri tarafı yaşam döngüsü eylemleri.
 * - Onayla: kapanış onayı bekleyen veya çözüldü durumundaki talep kapatılır.
 * - Yeniden aç: kapanış onayı/çözüldü talepler her zaman, kapalı talepler REOPEN_WINDOW_DAYS içinde.
 */
export function customerLifecycle(ticket, now) {
  const status = String(ticket?.status || "").toLowerCase();
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.now();
  const canApprove = status === STATUSES.PENDING_CLOSE || status === STATUSES.RESOLVED;
  let canReopen = canApprove;
  if (status === STATUSES.CLOSED) {
    const closedAt = new Date(ticket.closed_at || ticket.updated_at || 0).getTime();
    canReopen = closedAt > 0 && nowMs - closedAt <= REOPEN_WINDOW_DAYS * 24 * 3600 * 1000;
  }
  return { status, canApprove, canReopen };
}

/** "2 sa 15 dk" biçiminde süre (negatifse mutlak değer). */
export function formatDuration(ms) {
  const abs = Math.abs(ms);
  const totalMin = Math.round(abs / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} gün${h ? ` ${h} sa` : ""}`;
  if (h > 0) return `${h} sa${m ? ` ${m} dk` : ""}`;
  return `${m} dk`;
}

/* ------------------------------------------------------------------ *
 * Efor doğrulaması (K-PER-9 A): 0,25–24 saat, 0,25 adım, son 30 gün, not ≤ 500
 * ------------------------------------------------------------------ */
export const EFFORT_LIMITS = { minHours: 0.25, maxHours: 24, stepHours: 0.25, maxBackfillDays: 30, maxNoteLength: 500 };

function shiftIsoDate(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Efor girdisini doğrular.
 * @returns {{valid: boolean, errors: Record<string,string>, hours: number, workDate: string, note: string}}
 */
export function validateEffortInput(input, now) {
  const errors = {};
  const raw = input?.hours;
  const hours = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (raw === "" || raw == null || !Number.isFinite(hours)) {
    errors.hours = "Saat değeri girin.";
  } else if (hours < EFFORT_LIMITS.minHours) {
    errors.hours = `En az ${EFFORT_LIMITS.minHours} saat girilebilir.`;
  } else if (hours > EFFORT_LIMITS.maxHours) {
    errors.hours = `Tek kayıtta en fazla ${EFFORT_LIMITS.maxHours} saat girilebilir.`;
  } else if (Math.abs(hours / EFFORT_LIMITS.stepHours - Math.round(hours / EFFORT_LIMITS.stepHours)) > 1e-9) {
    errors.hours = "Saat 0,25 (15 dk) katları olarak girilmelidir.";
  }

  const today = istanbulDateISO(now == null ? new Date() : now);
  const workDate = String(input?.workDate || "").trim() || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || Number.isNaN(new Date(`${workDate}T00:00:00Z`).getTime())) {
    errors.work_date = "Geçerli bir tarih girin.";
  } else if (workDate > today) {
    errors.work_date = "Efor tarihi gelecekte olamaz.";
  } else if (workDate < shiftIsoDate(today, -EFFORT_LIMITS.maxBackfillDays)) {
    errors.work_date = `Efor en fazla ${EFFORT_LIMITS.maxBackfillDays} gün geriye dönük girilebilir.`;
  }

  const note = String(input?.note || "").trim();
  if (note.length > EFFORT_LIMITS.maxNoteLength) errors.note = `Not en fazla ${EFFORT_LIMITS.maxNoteLength} karakter olabilir.`;

  return { valid: Object.keys(errors).length === 0, errors, hours, workDate, note };
}

/** Yanıt kutusundaki efor alanı: boş/0 = efor yok; aksi hâlde efor kurallarına uymalı. */
export function validateReplyHours(raw) {
  const str = String(raw ?? "").trim();
  if (str === "") return { valid: true, hours: 0, error: "" };
  const hours = Number(str.replace(",", "."));
  if (!Number.isFinite(hours)) return { valid: false, hours: 0, error: "Efor için geçerli bir sayı girin." };
  if (hours === 0) return { valid: true, hours: 0, error: "" };
  const res = validateEffortInput({ hours, workDate: "" });
  return res.errors.hours ? { valid: false, hours: 0, error: res.errors.hours } : { valid: true, hours, error: "" };
}

export const SAP_MODULES = [
  "FI",
  "CO",
  "MM",
  "SD",
  "PP",
  "WM",
  "HR",
  "BASIS",
  "ABAP",
  "Diğer",
];

export const SAP_MODULE_LABELS = {
  FI: "Finansal Muhasebe",
  CO: "Yönetim Muhasebesi",
  MM: "Malzeme Yönetimi",
  SD: "Satış ve Dağıtım",
  PP: "Üretim Planlama",
  WM: "Depo Yönetimi",
  HR: "İnsan Kaynakları",
  BASIS: "Sistem Yönetimi",
  ABAP: "Geliştirme",
  Diğer: "Diğer",
};

export const CUSTOMER_TYPES = {
  CUS: "Destek Anlaşmalı Müşteri",
  ARC: "Arızi Müşteri",
};

/**
 * Talep tipi kilidi (D-09 B): müşteri yalnızca kendi firma tipine uygun tipleri açabilir.
 * Yönetici talep açarken ve açılmış talebin tipini değiştirirken tüm tipleri kullanabilir.
 */
export const CUSTOMER_TICKET_TYPES_BY_CUSTOMER_TYPE = {
  CUS: [TICKET_TYPES.SUP, TICKET_TYPES.BUG],
  ARC: [TICKET_TYPES.ARZ, TICKET_TYPES.BUG],
};

/** Müşterinin firma tipi: arızi müşteri rolü ya da firma kaydındaki customer_type; varsayılan CUS. */
export function resolveCustomerType(role, companyType) {
  if (String(role || "").toLowerCase() === ROLES.ARIZI_CUSTOMER) return "ARC";
  const t = String(companyType || "").toUpperCase();
  return t === "ARC" ? "ARC" : "CUS";
}

export function allowedCustomerTicketTypes(customerType) {
  return [...(CUSTOMER_TICKET_TYPES_BY_CUSTOMER_TYPE[String(customerType || "CUS").toUpperCase()] || CUSTOMER_TICKET_TYPES_BY_CUSTOMER_TYPE.CUS)];
}

export function defaultCustomerTicketType(customerType) {
  return allowedCustomerTicketTypes(customerType)[0];
}

const TEMP_PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

/**
 * YYMM formatında ay/yıl (ör. 2605 = Mayıs 2026). Ay sınırı Europe/Istanbul'a göre hesaplanır:
 * tarayıcı saat diliminden bağımsız olarak aynı anda açılan talepler aynı ay sayacına düşer.
 */
export function getYymm(date) {
  const p = istanbulParts(date instanceof Date ? date : new Date());
  return String(p.year).slice(-2) + p.month;
}

const ASCII_FOLD = { İ: "I", I: "I", ı: "I", i: "I", Ğ: "G", ğ: "G", Ş: "S", ş: "S", Ç: "C", ç: "C", Ö: "O", ö: "O", Ü: "U", ü: "U" };

/** Ticket numarasındaki modül kodu: büyük harf ve ASCII ("Diğer" → "DIGER", Türkçe harf içermez). */
export function ticketModuleCode(module) {
  const folded = String(module || "Diğer").replace(/[İıĞğŞşÇçÖöÜü]/g, (c) => ASCII_FOLD[c] || c);
  return folded.toUpperCase().replace(/[^A-Z0-9]/g, "") || "DIGER";
}

/**
 * Ticket numarası üretir: {TIP}-{MÜŞTERİ}-{MODÜL}-{YYMM}-{SIRA}
 */
export async function generateTicketNumber(dbApi, type, customerCode, module) {
  if (!dbApi || !dbApi.ref || !dbApi.runTransaction) {
    throw new Error("Firebase veritabanı API'si kullanılamıyor.");
  }

  const ticketType = String(type || "").toUpperCase();
  const code = String(customerCode || "").toUpperCase();
  const mod = ticketModuleCode(module);
  const yymm = getYymm();

  if (!ticketType || !code) {
    throw new Error("Talep tipi ve müşteri kodu zorunludur.");
  }
  if (/[.#$[\]/\s]/.test(code)) {
    throw new Error("Müşteri kodu geçersiz karakter içeriyor (nokta, eğik çizgi, boşluk vb. kullanılamaz).");
  }

  const fb = window.__PARLA_FIREBASE;
  if (!fb || !fb.database) {
    throw new Error("Firebase henüz başlatılmadı.");
  }

  const counterPath = `v2/counters/${ticketType}/${code}/${yymm}`;
  const counterRef = dbApi.ref(fb.database, counterPath);

  const result = await dbApi.runTransaction(counterRef, (current) => {
    if (current === null || current === undefined) {
      return 1;
    }
    const num = typeof current === "number" ? current : parseInt(current, 10);
    return (Number.isNaN(num) ? 0 : num) + 1;
  });

  if (!result.committed) {
    throw new Error("Talep numarası üretilemedi. Lütfen yeniden deneyin.");
  }

  const sequence = result.snapshot.val();
  const padded = String(sequence).padStart(4, "0");
  return `${ticketType}-${code}-${mod}-${yymm}-${padded}`;
}

export function formatTicketTypeLabel(code) {
  const key = String(code || "").toUpperCase();
  const label = TICKET_TYPE_LABELS[key];
  return label ? `${key} — ${label}` : key || "—";
}

export function formatPriorityLabel(priority) {
  const key = String(priority || "").toLowerCase();
  return PRIORITY_LABELS[key] || priority || "—";
}

/** Durum kodunu ya da (eski kayıtlardaki) Türkçe etiketini kod'a çevirir; bilinmiyorsa küçük harfli girdiyi döner. */
export function normalizeStatusCode(value) {
  const raw = String(value || "").trim();
  const low = raw.toLowerCase();
  if (STATUS_LABELS[low]) return low;
  const hit = Object.entries(STATUS_LABELS).find(([, label]) => label.toLocaleLowerCase("tr") === raw.toLocaleLowerCase("tr"));
  return hit ? hit[0] : low;
}

/**
 * Oturumdaki kullanıcının personel kaydı: önce açık kimlik bağı (personnel.uid), yoksa e-posta (yedek).
 * @returns {object|null}
 */
export function findPersonnelForSession(personnelList, session) {
  const list = personnelList || [];
  if (session?.uid) {
    const byUid = list.find((p) => p.uid && p.uid === session.uid);
    if (byUid) return byUid;
  }
  const email = String(session?.email || "").trim().toLowerCase();
  if (!email) return null;
  return list.find((p) => String(p.email || "").trim().toLowerCase() === email) || null;
}

export function formatStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  return STATUS_LABELS[key] || status || "—";
}

export function formatSapModuleLabel(code) {
  const key = String(code || "");
  const label = SAP_MODULE_LABELS[key];
  return label ? `${key} — ${label}` : key || "—";
}

export function formatRoleLabel(role) {
  const key = String(role || "").toLowerCase();
  return ROLE_LABELS[key] || role || "—";
}

/** Firebase RTDB tickets/{key} — her zaman snapshot push key (id) kullan */
export function getTicketKey(ticketOrId) {
  if (!ticketOrId) return "";
  if (typeof ticketOrId === "string") return ticketOrId;
  return ticketOrId.id || ticketOrId.ticket_id || "";
}

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(String(role || "").toLowerCase());
}

export function isCustomerRole(role) {
  return CUSTOMER_ROLES.includes(String(role || "").toLowerCase());
}

/** [0, max) aralığında kriptografik rastgele tamsayı (kalıntı yanlılığı yok: reddetme örneklemesi). */
function secureRandomInt(max) {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new Error("Güvenli rastgele sayı üreteci kullanılamıyor; geçici şifre üretilemedi.");
  }
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let x;
  do {
    cryptoObj.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

/**
 * 12 karakterlik geçici şifre (en az bir büyük harf, küçük harf, rakam). `crypto.getRandomValues` + Fisher–Yates karıştırma
 * (SEC-31, ALT-28: `Math.random` kullanılmaz).
 */
export function generateTempPassword(length) {
  const len = Math.max(8, length || 12);
  const pick = (set) => set[secureRandomInt(set.length)];
  const chars = [pick("ABCDEFGHJKLMNPQRSTUVWXYZ"), pick("abcdefghijkmnopqrstuvwxyz"), pick("23456789")];
  while (chars.length < len) chars.push(pick(TEMP_PASSWORD_CHARS));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Arama için normalize: küçük harf (tr), noktasız ı -> i, aksan/diakritik temizliği (Öztürk -> ozturk). */
export function normalizeSearch(value) {
  return String(value == null ? "" : value)
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Boşlukla ayrılmış her arama sözcüğü alanların birleşiminde geçiyorsa true döner. */
export function matchesSearch(query, fields) {
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = normalizeSearch((fields || []).filter((v) => v != null && v !== "").join(" "));
  return tokens.every((token) => haystack.includes(token));
}

export function nowIso() {
  return new Date().toISOString();
}

// Intl biçimleyicileri bir kez kurulur (her çağrıda yeni kurmak ≈50× yavaştır; OLC-12). Çıktı biçimi değişmez.
let dateFormatter = null;
let dateTimeFormatter = null;

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  if (!dateFormatter) {
    dateFormatter = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  return dateFormatter.format(d);
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  if (!dateTimeFormatter) {
    dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return dateTimeFormatter.format(d);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
