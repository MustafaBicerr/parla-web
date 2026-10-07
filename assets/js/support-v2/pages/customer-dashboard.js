/**
 * Parla BT Ticket V2 — müşteri genel bakış
 */
import ParlaDb from "../firebase-client.js";
import { getCustomerTickets } from "../notifications.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderStatsGrid,
  renderDataTable,
  renderTimeline,
  showLoading,
  handleLoadError,
  loadingStateHtml,
  renderStatusBadge,
  renderPriorityBadge,
  renderTypeBadge,
  formatDateTime,
  escapeHtml,
} from "../ui-shell.js";
import {
  SAP_MODULE_LABELS,
  STATUSES,
  OPEN_STATUSES,
  formatStatusLabel,
  formatPriorityLabel,
  getTicketKey,
  isResolvedThisMonth as isResolvedThisMonthShared,
} from "../ticket-utils.js";
import { safeText } from "../safe-utils.js";
import { initCreateTicketModal, bindNewTicketButton } from "./create-ticket-modal.js";

const app = document.getElementById("sv2-app");
let session = null;
let allTickets = [];

const ACTIVE_STATUSES = OPEN_STATUSES;

/** "Bu Ay Çözüldü": yalnızca çözüm/kapanış damgasına göre (İstanbul ayı); güncelleme zamanı sayılmaz (SEN-14). */
function isResolvedThisMonth(ticket) {
  return isResolvedThisMonthShared(ticket);
}

function ticketLink(id, number) {
  return `<a href="${PATHS.customerTicketDetail}?id=${encodeURIComponent(id)}" class="sv2-link">${escapeHtml(number || id)}</a>`;
}

function getTicketColumns() {
  return [
    {
      key: "ticket_number",
      label: "NO",
      render: (val, row) => ticketLink(row.id || row.ticket_id, val),
    },
    {
      key: "title",
      label: "KONU",
      render: (val) => escapeHtml(val || "—"),
    },
    {
      key: "ticket_type",
      label: "TİP",
      render: (val) => renderTypeBadge(val),
    },
    {
      key: "sap_module",
      label: "SAP MODÜLÜ",
      render: (val) => escapeHtml(SAP_MODULE_LABELS[val] || val || "—"),
    },
    {
      key: "priority",
      label: "ÖNCELİK",
      render: (val) => renderPriorityBadge(val),
    },
    {
      key: "status",
      label: "DURUM",
      render: (val) => renderStatusBadge(val),
    },
    {
      key: "assigned_to_name",
      label: "DANIŞMAN",
      render: (val) => escapeHtml(val || "—"),
    },
    {
      key: "created_at",
      label: "TARİH",
      render: (val) => escapeHtml(formatDateTime(val)),
    },
  ];
}

function computeStats(tickets) {
  const active = tickets.filter((t) => ACTIVE_STATUSES.includes(String(t.status).toLowerCase())).length;
  const waiting = tickets.filter(
    (t) => String(t.status).toLowerCase() === STATUSES.WAITING_CUSTOMER
  ).length;
  const resolvedMonth = tickets.filter(isResolvedThisMonth).length;
  return {
    active,
    waiting,
    resolvedMonth,
    total: tickets.length,
  };
}

function sortTicketsNewest(tickets) {
  return [...tickets].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

const ts = (iso) => (iso ? new Date(iso).getTime() || 0 : 0);

/** Geçmiş kaydı → müşterinin anlayacağı tek satır (yalnız talep sahibinin görebildiği alanlar). */
function describeHistory(h) {
  const field = safeText(h.field_changed);
  const action = safeText(h.action);
  if (action === "created") return "Talep oluşturuldu";
  if (field === "status") return `Durum: ${formatStatusLabel(safeText(h.old_value))} → ${formatStatusLabel(safeText(h.new_value))}`;
  if (field === "priority") return `Öncelik: ${formatPriorityLabel(safeText(h.old_value))} → ${formatPriorityLabel(safeText(h.new_value))}`;
  if (field === "assigned_to_name") return `Danışman atandı: ${safeText(h.new_value) || "—"}`;
  return safeText(h.note) || safeText(h.new_value) || "Güncelleme yapıldı";
}

/**
 * "Son Aktiviteler": son hareket gören taleplerin GERÇEK mesaj ve durum/atama geçmişi (MUS-18, UX-37).
 * Her kayıt için try/catch: bozuk bir kayıt akışı bozmaz.
 */
function buildActivityItems(tickets, details) {
  const items = [];
  for (const t of tickets) {
    const detail = details.get(getTicketKey(t)) || { messages: [], history: [] };
    const label = safeText(t.ticket_number);
    try {
      for (const m of detail.messages) {
        items.push({
          author: safeText(m.author_name) || "Kullanıcı",
          created_at: m.created_at,
          message: `${label} · ${safeText(m.message).slice(0, 140)}`,
          variant: m.author_role === "customer" ? "customer" : "admin",
          at: ts(m.created_at),
        });
      }
      for (const h of detail.history) {
        items.push({
          author: safeText(h.changed_by_name) || "Sistem",
          created_at: h.changed_at,
          message: `${label} · ${describeHistory(h)}`,
          variant: "admin",
          at: ts(h.changed_at),
        });
      }
    } catch (err) {
      console.warn("[Parla V2] aktivite satırı atlandı", err);
    }
  }
  const sorted = items.sort((a, b) => b.at - a.at).slice(0, 8);
  if (sorted.length) return sorted;

  // Geçmiş/mesaj okunamadıysa son hareket gören talepleri göster.
  return sortTicketsNewest(tickets)
    .slice(0, 5)
    .map((t) => ({
      author: safeText(t.assigned_to_name) || "Sistem",
      created_at: t.public_updated_at || t.updated_at || t.created_at,
      message: `${safeText(t.ticket_number)} · ${formatStatusLabel(t.status)}`,
      variant: "admin",
    }));
}

/** En son hareket gören 5 talebin mesajları + geçmişi (10 okuma; hata talep başına yutulur). */
async function loadActivityDetails(tickets) {
  const recent = [...tickets]
    .sort((a, b) => ts(b.public_updated_at || b.updated_at) - ts(a.public_updated_at || a.updated_at))
    .slice(0, 5);
  const details = new Map();
  await Promise.all(
    recent.map(async (t) => {
      const id = getTicketKey(t);
      const [messages, history] = await Promise.all([
        ParlaDb.getTicketMessages(id).catch(() => []),
        window.__PARLA_FIREBASE.db
          .get(ParlaDb.v2Ref(`ticket_history/${id}`))
          .then((snap) => ParlaDb.snapshotToArray(snap))
          .catch(() => []),
      ]);
      details.set(id, { messages, history });
    })
  );
  return { recent, details };
}

function renderPage(activity) {
  const stats = computeStats(allTickets);
  const recentTickets = sortTicketsNewest(allTickets).slice(0, 10).map((t) => ({
    ...t,
    id: t.id,
  }));

  const content = `
    ${renderStatsGrid([
      { label: "Aktif", value: stats.active, variant: "open" },
      { label: "Yanıt Bekleniyor", value: stats.waiting, variant: "waiting" },
      { label: "Bu Ay Çözüldü", value: stats.resolvedMonth, variant: "success" },
      { label: "Toplam", value: stats.total },
    ])}
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Son Talepler</h3>
        <button type="button" class="sv2-btn sv2-btn-primary sv2-btn-sm" id="sv2-new-ticket-btn">
          <i class="fas fa-plus"></i> Yeni Talep
        </button>
      </div>
      <div class="sv2-section-body" id="sv2-recent-tickets">
        ${renderDataTable({
          columns: getTicketColumns(),
          rows: recentTickets,
          emptyMessage: "Henüz talep oluşturmadınız. Yeni talep butonuna tıklayarak başlayın.",
        })}
      </div>
    </div>
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Son Aktiviteler</h3>
      </div>
      <div class="sv2-section-body">
        <div id="sv2-activity-feed">${activity ? renderTimeline(buildActivityItems(activity.recent, activity.details)) : loadingStateHtml("Aktiviteler yükleniyor…")}</div>
      </div>
    </div>`;

  renderShell(app, {
    title: "Genel Bakış",
    activePage: "dashboard",
    profile: session,
    isAdmin: false,
    content,
  });

  bindNewTicketButton("sv2-new-ticket-btn");
  bindTableRowClicks();
}

function bindTableRowClicks() {
  document.querySelectorAll("#sv2-recent-tickets .sv2-table tbody tr").forEach((row) => {
    row.style.cursor = "pointer";
    row.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      const id = row.dataset.id;
      if (id) {
        window.location.href = `${PATHS.customerTicketDetail}?id=${encodeURIComponent(id)}`;
      }
    });
  });
}

function renderLoadingShell() {
  renderShell(app, { title: "Genel Bakış", activePage: "dashboard", profile: session, isAdmin: false, content: loadingStateHtml("Genel bakış yükleniyor…") });
}

async function loadData() {
  showLoading(true);
  try {
    allTickets = await getCustomerTickets(session);
  } catch (err) {
    // Okuma hatasında "0 talep / Henüz talep oluşturmadınız" YANILTMASI yerine hata kartı (MUS-06).
    allTickets = [];
    handleLoadError(err, "Talepler yüklenemedi", { retry: loadData, activePage: "dashboard", pageTitle: "Genel Bakış", isAdmin: false });
    return;
  } finally {
    showLoading(false);
  }
  renderPage(null);
  try {
    const activity = await loadActivityDetails(allTickets);
    renderPage(activity);
  } catch (err) {
    console.warn("[Parla V2] aktivite akışı yüklenemedi", err);
    renderPage({ recent: allTickets.slice(0, 5), details: new Map() });
  }
}

async function init() {
  showLoading(true);
  try {
    session = await requireAuth({ customerOnly: true });
    renderLoadingShell();
    initCreateTicketModal(session, () => loadData());
    await loadData();
  } catch {
    /* requireAuth yönlendirir ya da hata kartını kendisi çizer */
  } finally {
    showLoading(false);
  }
}

init();
