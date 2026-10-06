/**
 * Parla BT Ticket V2 — bildirim zili.
 *
 * Bildirimler veritabanına yazılmaz; ticket hareketlerinden (public_updated_*, durum, atama, SLA) türetilir.
 * Böylece ek kural/yazma gerekmez ve dahili notlar müşteriye asla sızmaz. "Okundu" bilgisi tarayıcıda
 * (localStorage) tutulur.
 */
import ParlaDb from "./firebase-client.js";
import { PATHS } from "./auth-guard.js";
import { STATUSES, computeSla, escapeHtml, formatDateTime, formatDuration, isAdminRole, isOpenStatus } from "./ticket-utils.js";

const REFRESH_MS = 90 * 1000;
const BASELINE_MS = 48 * 3600 * 1000; // ilk kullanımda son 48 saat gösterilir
const MAX_ITEMS = 12;

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
    const id = t.id || t.ticket_id;
    if (!id) continue;
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
      else if (freshUpdate) {
        const text =
          status === STATUSES.RESOLVED ? "Talebiniz çözüldü olarak işaretlendi"
          : status === STATUSES.CLOSED ? "Talebiniz kapatıldı"
          : "Danışmanımız talebinizi güncelledi veya yanıtladı";
        picked = { ...base, kind: "update", action: false, text };
      }
    } else {
      const mine = !!myPersonnelId && t.assigned_to_id === myPersonnelId;
      const sla = isOpenStatus(status) ? computeSla(t, nowMs) : null;
      const slaBreached = !!sla && !sla.paused && (sla.response.state === "breached" || sla.resolution.state === "breached");
      if (mine && status === STATUSES.REOPENED) picked = { ...base, kind: "reopened", action: true, text: "Müşteri talebi yeniden açtı" };
      else if (mine && slaBreached) {
        const phase = sla.response.state === "breached" ? sla.response : sla.resolution;
        picked = { ...base, kind: "sla", action: true, text: `SLA hedefi aşıldı (+${formatDuration(phase.remainingMs)})` };
      } else if (mine && freshUpdate) picked = { ...base, kind: "update", action: false, text: "Müşteri yanıtladı veya talebi güncelledi" };
      else if (assigner && status === STATUSES.OPEN && !t.assigned_to_id) picked = { ...base, kind: "unassigned", action: true, text: "Atama bekliyor" };
    }

    if (picked) items.push({ ...picked, unread: true });
  }

  return items.sort((a, b) => b.at - a.at);
}

const state = { timer: null, items: [], session: null, personnelId: undefined };

async function resolvePersonnelId(session) {
  if (state.personnelId !== undefined) return state.personnelId;
  try {
    const me = await ParlaDb.findPersonnelByEmail(session.email);
    state.personnelId = me ? me.personnel_id || me.id : "";
  } catch {
    state.personnelId = "";
  }
  return state.personnelId;
}

async function loadItems(session) {
  const staff = isAdminRole(session.role);
  const tickets = staff ? await ParlaDb.getRecentTickets(80) : await ParlaDb.getTicketsForSession(session);
  const personnelId = staff ? await resolvePersonnelId(session) : "";
  const { seen, baseline } = getSeenState(session.uid);
  return deriveNotifications({ tickets, session, myPersonnelId: personnelId, seen, baseline });
}

function relativeTime(iso) {
  const diff = Date.now() - ts(iso);
  if (diff < 60000) return "az önce";
  if (diff < 3600000) return `${Math.round(diff / 60000)} dk önce`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)} sa önce`;
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
    document.body.appendChild(panel);
  }
  return panel;
}

function renderPanel() {
  const panel = ensurePanel();
  const session = state.session;
  const detailPath = isAdminRole(session.role) ? PATHS.adminTicketDetail : PATHS.customerTicketDetail;
  const shown = state.items.slice(0, MAX_ITEMS);
  const list = shown.length
    ? shown
        .map(
          (n) => `
      <a class="sv2-notif-item unread${n.action ? " is-action" : ""}" href="${detailPath}?id=${encodeURIComponent(n.ticketId)}" data-ticket="${escapeHtml(n.ticketId)}" data-at="${escapeHtml(n.atIso || "")}">
        <span class="sv2-notif-icon"><i class="fas ${KIND_ICON[n.kind] || "fa-bell"}"></i></span>
        <span class="sv2-notif-text">
          <strong>${escapeHtml(n.text)}</strong>
          <span>${escapeHtml(n.number)} · ${escapeHtml(n.title)}</span>
          <em>${escapeHtml(relativeTime(n.atIso))}</em>
        </span>
      </a>`
        )
        .join("")
    : `<div class="sv2-notif-empty"><i class="fas fa-check-circle"></i><p>Yeni bildiriminiz yok.</p></div>`;
  panel.innerHTML = `
    <div class="sv2-notif-panel-header"><span>Bildirimler</span>${state.items.some((n) => !n.action) ? '<button type="button" class="sv2-notif-readall" id="sv2-notif-readall">Tümünü okundu say</button>' : ""}</div>
    <div class="sv2-notif-panel-body">${list}</div>`;

  panel.querySelectorAll(".sv2-notif-item").forEach((a) => {
    a.addEventListener("click", () => markTicketSeen(session.uid, { id: a.dataset.ticket, public_updated_at: a.dataset.at }));
  });
  panel.querySelector("#sv2-notif-readall")?.addEventListener("click", () => {
    markAllSeen(session.uid, state.items);
    refresh();
  });
}

function updateBadge() {
  const badge = document.getElementById("sv2-notif-badge");
  if (!badge) return;
  const count = state.items.filter((n) => n.unread).length;
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? "99+" : String(count);
}

async function refresh() {
  if (!state.session) return;
  try {
    state.items = await loadItems(state.session);
  } catch {
    state.items = [];
  }
  updateBadge();
  const panel = document.getElementById("sv2-notif-panel");
  if (panel && panel.classList.contains("is-open")) renderPanel();
}

let bound = false;

/** Zil düğmesini ve paneli bağlar (renderShell her çağrıldığında güvenle tekrar çağrılabilir). */
export function initNotifications(session) {
  if (!session?.uid) return;
  state.session = session;
  if (state.timer) clearInterval(state.timer);

  // Olay delegasyonu: renderShell DOM'u yeniden çizse de zil düğmesi ve panel çalışmaya devam eder.
  if (!bound) {
    bound = true;
    document.addEventListener("click", (e) => {
      const panel = document.getElementById("sv2-notif-panel");
      if (e.target.closest && e.target.closest("#sv2-notif-btn")) {
        e.stopPropagation();
        const p = ensurePanel();
        p.classList.toggle("is-open");
        if (p.classList.contains("is-open")) renderPanel();
        return;
      }
      if (panel && panel.classList.contains("is-open") && !panel.contains(e.target)) panel.classList.remove("is-open");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.getElementById("sv2-notif-panel")?.classList.remove("is-open");
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh();
    });
  }

  updateBadge(); // yeniden çizim sonrası rozeti önceki sonuçla hemen göster
  refresh();
  state.timer = setInterval(refresh, REFRESH_MS);
}
