/**
 * Parla BT Ticket V2 — müşteri genel bakış
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderStatsGrid,
  renderDataTable,
  renderTimeline,
  showLoading,
  handleError,
  renderStatusBadge,
  renderPriorityBadge,
  renderTypeBadge,
  formatDateTime,
  escapeHtml,
} from "../ui-shell.js";
import { SAP_MODULE_LABELS, STATUSES } from "../ticket-utils.js";
import { initCreateTicketModal, bindNewTicketButton } from "./create-ticket-modal.js";

const app = document.getElementById("sv2-app");
let session = null;
let allTickets = [];

const ACTIVE_STATUSES = ["open", "in_progress", "waiting_customer"];

function isThisMonth(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function isResolvedThisMonth(ticket) {
  const status = String(ticket.status || "").toLowerCase();
  if (status !== STATUSES.RESOLVED && status !== STATUSES.CLOSED) return false;
  return (
    isThisMonth(ticket.resolved_at) ||
    isThisMonth(ticket.closed_at) ||
    isThisMonth(ticket.updated_at)
  );
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

function buildActivityItems(tickets, activities) {
  const ticketActivities = activities
    .filter((a) => a.user_uid === session.uid)
    .slice(0, 10)
    .map((a) => ({
      author: a.user_name || "Siz",
      created_at: a.created_at,
      message: a.details || a.entity_label || a.action,
      variant: "customer",
    }));

  if (ticketActivities.length) return ticketActivities;

  return sortTicketsNewest(tickets)
    .slice(0, 5)
    .map((t) => ({
      author: t.user_name || "Siz",
      created_at: t.updated_at || t.created_at,
      message: `${t.ticket_number} — ${t.title}`,
      variant: "customer",
    }));
}

function renderPage(activities) {
  const stats = computeStats(allTickets);
  const recentTickets = sortTicketsNewest(allTickets).slice(0, 10).map((t) => ({
    ...t,
    id: t.id || t.ticket_id,
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
        ${renderTimeline(buildActivityItems(allTickets, activities))}
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

async function loadData() {
  showLoading(true);
  try {
    allTickets = await ParlaDb.getTicketsForUser(session.uid);
  } catch (err) {
    handleError(err, "Talepler yüklenemedi");
    allTickets = [];
  } finally {
    showLoading(false);
  }
  renderPage([]);
}

async function init() {
  showLoading(true);
  try {
    session = await requireAuth({ customerOnly: true });
    renderPage([]);
    await loadData();
    initCreateTicketModal(session, () => loadData());
  } catch {
    /* requireAuth yönlendirir */
  } finally {
    showLoading(false);
  }
}

init();
