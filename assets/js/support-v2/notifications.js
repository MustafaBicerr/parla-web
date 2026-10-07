/**
 * Parla BT Ticket V2 — bildirim zili.
 *
 * Bildirimler veritabanına yazılmaz; ticket hareketlerinden (public_updated_*, durum, atama, SLA) türetilir.
 * Böylece ek kural/yazma gerekmez ve dahili notlar müşteriye asla sızmaz. "Okundu" bilgisi tarayıcıda
 * (localStorage) tutulur.
 *
 * Ağ yükü (WP-13; OLC-01/02, PER-05, varsayılan karar 4):
 *  - Yoklama yalnız sayfa açılışında bir kez ve GÖRÜNÜR sekmede 5 dakikada bir yapılır; gizli sekme yoklamaz.
 *    `renderShell` yeniden çizimi (sayfalama, filtre, yanıt sonrası) ağa gitmez, yalnız rozeti yeniden boyar.
 *  - Personel eylem bildirimleri (atama bekliyor, SLA aşımı, yeniden açıldı) "son 80 talep" penceresinden değil,
 *    HEDEFLİ sorgulardan türetilir: durumu açık/atandı/işlemde/yeniden açıldı olan talepler. Eski ama hâlâ
 *    eylem bekleyen talepler zilden düşmez (N=200 kapalı talep sonrasında da). Kapalı geçmiş indirilmez.
 *    Birincil + ikincil danışman: "benim talebim" `assigned_uids` haritasından ya da `assigned_to_id`'den bulunur.
 *  - "Güncelleme" bildirimi için yalnız son RECENT_N güncellenen talep okunur (`getRecentTickets`).
 *  - Sonuç sessionStorage'da kısa süre (1 dk) önbelleklenir: sayfadan sayfaya geçiş yeniden indirmez; süre dolunca
 *    önce TEK talep okuyan "değişti mi?" yoklaması (`updated_at` son değer) yapılır, değişmediyse liste yeniden indirilmez
 *    (SLA aşımı zamanla değiştiğinden bildirimler önbellekteki taleplerle yerelde yeniden hesaplanır).
 *  - Müşteri tarafında sayfa ile zil aynı okumayı paylaşır (`getCustomerTickets`): panoda 3, taleplerde 2 okuma → 1 (OLC-07).
 */
import ParlaDb from "./firebase-client.js";
import { PATHS } from "./auth-guard.js";
import {
  STATUSES,
  computeSla,
  escapeHtml,
  formatDateTime,
  formatDuration,
  getTicketKey,
  isAdminRole,
  isDeletedTicket,
  isOpenStatus,
} from "./ticket-utils.js";

// Test dikişi: `window.__SV2_BELL_POLL_MS` (yalnız e2e) yoklama aralığını kısaltır; diğer süreler orantılı kalır.
const POLL_MS = Number(typeof window !== "undefined" && window.__SV2_BELL_POLL_MS) > 0 ? Number(window.__SV2_BELL_POLL_MS) : 5 * 60 * 1000; // görünür sekmede yoklama aralığı
const CACHE_FRESH_MS = POLL_MS / 5; // bu süre içinde ağ okuması yapılmaz (5 dk → 1 dk)
const FULL_RELOAD_MS = POLL_MS * 6; // "değişmedi" yoklaması olsa da en geç bu sürede tam yenileme (5 dk → 30 dk)
const RECENT_N = 20; // "güncelleme" bildirimi için okunan son talep sayısı
const BASELINE_MS = 48 * 3600 * 1000; // ilk kullanımda son 48 saat gösterilir
const MAX_ITEMS = 50; // panelde ve rozette aynı sayı (MUS-28); fazlası "+N" satırı
/** Salt okunur yapılandırma (testler ve belgeler için). */
export const BELL_CONFIG = { pollMs: POLL_MS, cacheFreshMs: CACHE_FRESH_MS, fullReloadMs: FULL_RELOAD_MS, recentN: RECENT_N, maxItems: MAX_ITEMS };
const ACTIVE_STATUSES = [STATUSES.OPEN, STATUSES.ASSIGNED, STATUSES.IN_PROGRESS, STATUSES.REOPENED]; // SLA işleyen durumlar

const ts = (iso) => (iso ? new Date(iso).getTime() || 0 : 0);

function storageKey(kind, uid) {
  return `sv2_${kind}_${uid}`;
}

function readJson(key, fallback) {
  try {
    const raw = window.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* depolama kapalı */
  }
}

export function getSeenState(uid, now) {
  let baseline = Number(readJson(storageKey("seen_baseline", uid), 0));
  if (!baseline) {
    baseline = (now || Date.now()) - BASELINE_MS;
    writeJson(storageKey("seen_baseline", uid), baseline);
  }
  return { seen: readJson(storageKey("seen", uid), {}), baseline };
}

/** Bir talebin (en son herkese açık hareketine kadar) okunduğunu işaretler. */
export function markTicketSeen(uid, ticket) {
  if (!uid || !ticket) return;
  const id = ticket.id || ticket.ticket_id;
  if (!id) return;
  const seen = readJson(storageKey("seen", uid), {});
  seen[id] = ticket.public_updated_at || ticket.updated_at || new Date().toISOString();
  writeJson(storageKey("seen", uid), seen);
}

function markAllSeen(uid, items) {
  const seen = readJson(storageKey("seen", uid), {});
  items.forEach((item) => {
    if (!item.action) seen[item.ticketId] = item.atIso;
  });
  writeJson(storageKey("seen", uid), seen);
}

/** Güncelleme metni: kimin yaptığına göre doğru atıf (SEN-33). */
function updateText({ t, uid, status, staff }) {
  const by = t.public_updated_by;
  if (staff) {
    if (by && by === t.user_id) return "Müşteri yanıtladı veya talebi güncelledi";
    if (by && t.assigned_uids && t.assigned_uids[by] === true) return "Başka bir danışman talebi güncelledi";
    return "Talep güncellendi";
  }
  // Müşteri tarafı: firma yöneticisi, meslektaşlarının işlemlerini ayrı görür.
  const colleague = by && by === t.user_id && t.user_id !== uid;
  if (status === STATUSES.RESOLVED) return colleague ? "Firma çalışanınızın talebi çözüldü olarak işaretlendi" : "Talebiniz çözüldü olarak işaretlendi";
  if (status === STATUSES.CLOSED) return colleague ? "Firma çalışanınız talebi kapattı" : "Talebiniz kapatıldı";
  if (colleague) return `${t.user_name || "Firma çalışanınız"} talebi güncelledi veya yanıtladı`;
  return "Danışmanımız talebinizi güncelledi veya yanıtladı";
}

/**
 * Saf türetme fonksiyonu.
 * @returns {Array<{ticketId, number, title, text, kind, action, unread, at, atIso}>} yeniden eskiye
 */
export function deriveNotifications({ tickets, session, myPersonnelId, seen, baseline, now }) {
  const uid = session.uid;
  const nowMs = now || Date.now();
  const staff = isAdminRole(session.role);
  const assigner = ["super_admin", "service_admin", "project_manager"].includes(session.role);
  const items = [];

  for (const t of tickets || []) {
    try {
      const id = t.id || t.ticket_id;
      if (!id || isDeletedTicket(t)) continue;
      const status = String(t.status || "").toLowerCase();
      const lastIso = t.public_updated_at || t.updated_at || t.created_at;
      const lastMs = ts(lastIso);
      const lastByOther = !!t.public_updated_by && t.public_updated_by !== uid;
      const seenMs = Math.max(ts(seen?.[id]), baseline || 0);
      const freshUpdate = lastByOther && lastMs > seenMs;
      const base = { ticketId: id, number: t.ticket_number || id, title: t.title || "", at: lastMs, atIso: lastIso };
      let picked = null;

      if (!staff) {
        if (status === STATUSES.PENDING_CLOSE) picked = { ...base, kind: "close", action: true, text: "Kapanış onayınız bekleniyor" };
        else if (status === STATUSES.WAITING_CUSTOMER) picked = { ...base, kind: "reply", action: true, text: "Danışmanımız yanıtınızı bekliyor" };
        else if (freshUpdate) picked = { ...base, kind: "update", action: false, text: updateText({ t, uid, status, staff: false }) };
      } else {
        // "Benim talebim": birincil VEYA ikincil atanan (assigned_uids haritası ikincil danışmanı da kapsar; PER-22, PER-32).
        const mine = (!!myPersonnelId && t.assigned_to_id === myPersonnelId) || t.assigned_uids?.[uid] === true;
        const sla = isOpenStatus(status) ? computeSla(t, nowMs) : null;
        // Zil yalnız personelin yapacağı işi bildirir: müşteri yanıtı/onayı beklenirken (SLA duraklatılmış) uyarı üretilmez.
        // (Aşım damgası talepte saklanır; pano ve raporlar onu saymaya devam eder.)
        const slaBreached = !!sla && !sla.paused && (sla.response.state === "breached" || sla.resolution.state === "breached");
        if (mine && status === STATUSES.REOPENED) picked = { ...base, kind: "reopened", action: true, text: "Müşteri talebi yeniden açtı" };
        else if (mine && slaBreached) {
          const phase = sla.response.state === "breached" ? sla.response : sla.resolution;
          picked = { ...base, kind: "sla", action: true, text: `SLA hedefi aşıldı (+${formatDuration(phase.remainingMs)})` };
        } else if (mine && freshUpdate) picked = { ...base, kind: "update", action: false, text: updateText({ t, uid, status, staff: true }) };
        else if (assigner && status === STATUSES.OPEN && !t.assigned_to_id) picked = { ...base, kind: "unassigned", action: true, text: "Atama bekliyor" };
      }

      if (picked) items.push({ ...picked, unread: true });
    } catch (err) {
      // Zehirli/bozuk bir talep kaydı tüm bildirim listesini düşürmesin.
      console.warn("[Parla V2] bildirim türetilemedi", err);
    }
  }

  return items.sort((a, b) => b.at - a.at);
}

const state = {
  timer: null,
  items: [],
  tickets: [],
  session: null,
  personnelId: undefined,
  lastRefreshAt: 0,
  announced: -1,
  loaded: false,
  refreshing: null,
};

// ─── Önbellek (sessionStorage, 1 dk) ──────────────────────────────────────────────────────────────

function cacheKey(uid) {
  return `sv2_bell_cache_${uid}`;
}

function slim(t) {
  const copy = { ...t };
  delete copy.description; // bildirim türetmek için gerekmeyen ağır alanlar
  delete copy.attachment_url;
  return copy;
}

function readCache(uid) {
  try {
    const raw = window.sessionStorage?.getItem(cacheKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(uid, tickets, maxUpdated) {
  try {
    window.sessionStorage?.setItem(cacheKey(uid), JSON.stringify({ at: Date.now(), maxUpdated, tickets: tickets.map(slim) }));
  } catch {
    /* depolama dolu/kapalı: önbelleksiz çalışır */
  }
}

// ─── Okumalar ─────────────────────────────────────────────────────────────────────────────────────

async function queryTickets(child, value) {
  const fb = window.__PARLA_FIREBASE;
  const q = fb.db.query(ParlaDb.v2Ref("tickets"), fb.db.orderByChild(child), fb.db.equalTo(value));
  const snap = await fb.db.get(q);
  return ParlaDb.snapshotToArray(snap)
    .map((t) => ({ ...t, ticket_id: getTicketKey(t) }))
    .filter((t) => !isDeletedTicket(t));
}

async function resolvePersonnelId(session) {
  if (state.personnelId !== undefined) return state.personnelId;
  const key = `sv2_bell_pid_${session.uid}`;
  try {
    const cached = window.sessionStorage?.getItem(key);
    if (cached !== null && cached !== undefined) {
      state.personnelId = cached === "-" ? "" : cached;
      return state.personnelId;
    }
  } catch {
    /* depolama kapalı */
  }
  let pid = "";
  try {
    // Tüm personel listesi yerine e-posta indeksli sorgu; bulunamazsa (eski büyük/küçük harfli kayıt) tek seferlik yedek.
    const email = String(session.email || "").trim().toLowerCase();
    if (email) {
      const fb = window.__PARLA_FIREBASE;
      const snap = await fb.db.get(fb.db.query(ParlaDb.v2Ref("personnel"), fb.db.orderByChild("email"), fb.db.equalTo(email)));
      const list = ParlaDb.snapshotToArray(snap);
      const hit = list.find((p) => p.uid === session.uid) || list.find((p) => !p.uid);
      if (hit) pid = hit.personnel_id || hit.id;
    }
    if (!pid) {
      const me = await ParlaDb.findPersonnelForSession(session);
      pid = me ? me.personnel_id || me.id : "";
    }
  } catch {
    state.personnelId = "";
    return ""; // geçici hata: önbelleğe alınmaz, sonraki sayfada yeniden denenir
  }
  state.personnelId = pid;
  try {
    window.sessionStorage?.setItem(key, pid || "-");
  } catch {
    /* depolama kapalı */
  }
  return pid;
}

/** Personel: eylem bekleyen talepler (hedefli sorgular) + son güncellenenler (yalnız "güncelleme" için). */
async function loadStaffTickets() {
  const jobs = [ParlaDb.getRecentTickets(RECENT_N), ...ACTIVE_STATUSES.map((s) => queryTickets("status", s))];
  const results = await Promise.all(jobs);
  const byId = new Map();
  for (const list of results) for (const t of list) byId.set(getTicketKey(t), t);
  const recent = results[0];
  const maxUpdated = recent.reduce((m, t) => (String(t.updated_at || "") > m ? String(t.updated_at) : m), "");
  return { tickets: [...byId.values()], maxUpdated };
}

/** "Değişti mi?" yoklaması: en son güncellenen TEK talep. */
async function probeLatestUpdate() {
  const list = await ParlaDb.getRecentTickets(1);
  return list.length ? String(list[0].updated_at || "") : "";
}

// Müşteri: sayfa ile zil aynı okumayı paylaşır; son liste zile otomatik yansır (OLC-07, MUS-19).
let customerInflight = null;

/**
 * Müşteri talep listesi. Eşzamanlı çağrılar tek ağ okumasında birleşir; her tamamlanan okuma zili de günceller.
 * Sayfalar `ParlaDb.getTicketsForSession` yerine bunu çağırmalıdır.
 */
export function getCustomerTickets(session) {
  if (customerInflight && customerInflight.uid === session.uid) return customerInflight.promise;
  const promise = ParlaDb.getTicketsForSession(session)
    .then((list) => {
      applyCustomerTickets(session, list);
      return list;
    })
    .finally(() => {
      if (customerInflight && customerInflight.promise === promise) customerInflight = null;
    });
  customerInflight = { uid: session.uid, promise };
  return promise;
}

function applyCustomerTickets(session, list) {
  writeCache(session.uid, list, "");
  if (state.session && state.session.uid === session.uid) {
    state.tickets = list;
    state.lastRefreshAt = Date.now();
    rebuild();
  }
}

// ─── Türetme / çizim ──────────────────────────────────────────────────────────────────────────────

function rebuild() {
  const session = state.session;
  if (!session) return;
  const { seen, baseline } = getSeenState(session.uid);
  state.items = deriveNotifications({ tickets: state.tickets, session, myPersonnelId: state.personnelId || "", seen, baseline });
  const first = !state.loaded;
  state.loaded = true;
  updateBadge(first);
  const panel = document.getElementById("sv2-notif-panel");
  if (panel && panel.classList.contains("is-open")) renderPanel();
}

/** "az önce / x dk / x sa önce": sınırda yuvarlama yapılmaz (59,7 dk → 59 dk; SEN-34). */
export function relativeTime(iso, nowMs) {
  const diff = (nowMs || Date.now()) - ts(iso);
  if (diff < 60000) return "az önce";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} dk önce`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} sa önce`;
  return formatDateTime(iso);
}

const KIND_ICON = { close: "fa-clipboard-check", reply: "fa-user-clock", update: "fa-comment-dots", reopened: "fa-undo", sla: "fa-stopwatch", unassigned: "fa-user-plus" };

function ensurePanel() {
  let panel = document.getElementById("sv2-notif-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "sv2-notif-panel";
    panel.className = "sv2-notif-panel sv2-notif-panel--fixed";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Bildirimler");
    panel.tabIndex = -1;
    document.body.appendChild(panel);
  }
  return panel;
}

function ensureLiveRegion() {
  let live = document.getElementById("sv2-notif-live");
  if (!live) {
    live = document.createElement("div");
    live.id = "sv2-notif-live";
    live.className = "sv2-sr-only";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    document.body.appendChild(live);
  }
  return live;
}

function renderPanel() {
  const panel = ensurePanel();
  const session = state.session;
  const detailPath = isAdminRole(session.role) ? PATHS.adminTicketDetail : PATHS.customerTicketDetail;
  const shown = state.items.slice(0, MAX_ITEMS);
  const extra = state.items.length - shown.length;
  const now = Date.now();
  const list = shown.length
    ? shown
        .map(
          (n) => `
      <a class="sv2-notif-item unread${n.action ? " is-action" : ""}" href="${detailPath}?id=${encodeURIComponent(n.ticketId)}" data-ticket="${escapeHtml(n.ticketId)}" data-at="${escapeHtml(n.atIso || "")}">
        <span class="sv2-notif-icon" aria-hidden="true"><i class="fas ${KIND_ICON[n.kind] || "fa-bell"}"></i></span>
        <span class="sv2-notif-text">
          <strong>${escapeHtml(n.text)}</strong>
          <span>${escapeHtml(n.number)} · ${escapeHtml(n.title)}</span>
          <em>${escapeHtml(relativeTime(n.atIso, now))}</em>
        </span>
      </a>`
        )
        .join("") +
      (extra > 0 ? `<p class="sv2-notif-more">+${extra} bildirim daha. Tüm talepleri listeden görebilirsiniz.</p>` : "")
    : `<div class="sv2-notif-empty"><i class="fas fa-check-circle" aria-hidden="true"></i><p>Yeni bildiriminiz yok.</p></div>`;
  panel.innerHTML = `
    <div class="sv2-notif-panel-header"><span>Bildirimler</span>${state.items.some((n) => !n.action) ? '<button type="button" class="sv2-notif-readall" id="sv2-notif-readall">Tümünü okundu say</button>' : ""}</div>
    <div class="sv2-notif-panel-body">${list}</div>`;

  panel.querySelectorAll(".sv2-notif-item").forEach((a) => {
    a.addEventListener("click", () => markTicketSeen(session.uid, { id: a.dataset.ticket, public_updated_at: a.dataset.at }));
  });
  panel.querySelector("#sv2-notif-readall")?.addEventListener("click", () => {
    markAllSeen(session.uid, state.items);
    rebuild(); // yoklama değil: yalnız yerel yeniden hesap
  });
}

function updateBadge(silent) {
  const count = state.items.filter((n) => n.unread).length;
  const badge = document.getElementById("sv2-notif-badge");
  if (badge) {
    badge.hidden = count === 0;
    badge.textContent = count > MAX_ITEMS ? `${MAX_ITEMS}+` : String(count);
  }
  const btn = document.getElementById("sv2-notif-btn");
  if (btn) {
    btn.setAttribute("aria-label", count ? `Bildirimler, ${count > MAX_ITEMS ? `${MAX_ITEMS}+` : count} okunmamış` : "Bildirimler");
    btn.setAttribute("aria-expanded", document.getElementById("sv2-notif-panel")?.classList.contains("is-open") ? "true" : "false");
  }
  // Ekran okuyucu: yalnız ilk yükleme sonrasındaki artış duyurulur (her sayfada tekrar okunmaz).
  if (state.loaded && !silent && state.announced >= 0 && count > state.announced) ensureLiveRegion().textContent = `${count} okunmamış bildirim`;
  if (state.loaded) state.announced = count;
}

function setPanelOpen(open, { restoreFocus = false } = {}) {
  const panel = ensurePanel();
  panel.classList.toggle("is-open", open);
  const btn = document.getElementById("sv2-notif-btn");
  btn?.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    renderPanel();
    try {
      (panel.querySelector(".sv2-notif-item, .sv2-notif-readall") || panel).focus({ preventScroll: true });
    } catch {
      /* odaklanamadı */
    }
  } else if (restoreFocus) {
    try {
      btn?.focus({ preventScroll: true });
    } catch {
      /* odak geri verilemedi */
    }
  }
}

// ─── Yenileme ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Bildirimleri günceller. `force` değilse önce önbelleğe (2 dk), sonra (personel) tek talepli değişiklik yoklamasına
 * bakar; ağır okuma yalnız gerektiğinde yapılır.
 */
async function refresh({ force = false } = {}) {
  const session = state.session;
  if (!session) return;
  if (state.refreshing) return state.refreshing;
  state.refreshing = (async () => {
    const staff = isAdminRole(session.role);
    const cached = readCache(session.uid);
    const age = cached ? Date.now() - cached.at : Infinity;
    try {
      if (staff) state.personnelId = await resolvePersonnelId(session);
      if (!force && cached && age < CACHE_FRESH_MS) {
        state.tickets = cached.tickets;
      } else if (!force && staff && cached && age < FULL_RELOAD_MS && (await probeLatestUpdate()) === cached.maxUpdated) {
        state.tickets = cached.tickets; // değişen yok: indirme yok, SLA zamanla yeniden hesaplanır
      } else if (staff) {
        const { tickets, maxUpdated } = await loadStaffTickets();
        state.tickets = tickets;
        writeCache(session.uid, tickets, maxUpdated);
      } else {
        state.tickets = await getCustomerTickets(session);
      }
    } catch {
      state.tickets = cached ? cached.tickets : [];
    }
    state.lastRefreshAt = Date.now();
    rebuild();
  })().finally(() => {
    state.refreshing = null;
  });
  return state.refreshing;
}

let bound = false;

/**
 * Zil düğmesini ve paneli bağlar. İDEMPOTENT: renderShell/sayfa yeniden çizimi her çağırdığında güvenle
 * tekrar çağrılabilir — aynı kullanıcı için ikinci bir zamanlayıcı ya da gereksiz DB yoklaması başlatmaz,
 * yalnız rozeti yeniden boyar (PER-46, OLC-01, OLC-11).
 */
export function initNotifications(session) {
  if (!session?.uid) return;
  const sameUser = state.session && state.session.uid === session.uid;
  state.session = session;

  // Olay delegasyonu: renderShell DOM'u yeniden çizse de zil düğmesi ve panel çalışmaya devam eder.
  if (!bound) {
    bound = true;
    document.addEventListener("click", (e) => {
      const panel = document.getElementById("sv2-notif-panel");
      if (e.target.closest && e.target.closest("#sv2-notif-btn")) {
        e.stopPropagation();
        setPanelOpen(!ensurePanel().classList.contains("is-open"));
        return;
      }
      if (panel && panel.classList.contains("is-open") && !panel.contains(e.target)) setPanelOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      const panel = document.getElementById("sv2-notif-panel");
      if (e.key === "Escape" && panel?.classList.contains("is-open")) setPanelOpen(false, { restoreFocus: true });
    });
    document.addEventListener("focusin", (e) => {
      const panel = document.getElementById("sv2-notif-panel");
      if (panel?.classList.contains("is-open") && !panel.contains(e.target) && !e.target.closest?.("#sv2-notif-btn")) setPanelOpen(false);
    });
    // Sekme tekrar görünür olduğunda yalnız son yoklamadan beri POLL_MS geçtiyse yenilenir (gizliyken yoklama yok).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.session && Date.now() - state.lastRefreshAt >= POLL_MS) refresh();
    });
  }

  updateBadge(); // yeniden çizim sonrası rozeti önceki sonuçla hemen göster
  if (sameUser && state.timer) return; // zaten çalışıyor: yeniden yoklama/zamanlayıcı yok

  if (state.timer) clearInterval(state.timer);
  refresh();
  state.timer = setInterval(() => {
    if (document.visibilityState === "hidden") return; // arka plandaki sekme DB'yi yormasın
    refresh({ force: false });
  }, POLL_MS);
}
