/**
 * Parla BT Ticket V2 — müşteri talepler listesi
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderDataTable,
  renderFilterBar,
  bindFilterChips,
  showLoading,
  handleError,
  renderStatusBadge,
  renderPriorityBadge,
  renderTypeBadge,
  formatDateTime,
  escapeHtml,
} from "../ui-shell.js";
import { SAP_MODULE_LABELS, STATUS_LABELS } from "../ticket-utils.js";
import { initCreateTicketModal, bindNewTicketButton } from "./create-ticket-modal.js";

const app = document.getElementById("sv2-app");
let session = null;
let allTickets = [];
let filteredTickets = [];

let filters = {
  status: "all",
  search: "",
  sort: "newest",
};

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
    { key: "title", label: "KONU", render: (val) => escapeHtml(val || "—") },
    { key: "ticket_type", label: "TİP", render: (val) => renderTypeBadge(val) },
    {
      key: "sap_module",
      label: "SAP MODÜLÜ",
      render: (val) => escapeHtml(SAP_MODULE_LABELS[val] || val || "—"),
    },
    { key: "priority", label: "ÖNCELİK", render: (val) => renderPriorityBadge(val) },
    { key: "status", label: "DURUM", render: (val) => renderStatusBadge(val) },
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

function applyFilters() {
  let list = [...allTickets];

  if (filters.status !== "all") {
    list = list.filter((t) => String(t.status).toLowerCase() === filters.status);
  }

  const q = filters.search.trim().toLowerCase();
  if (q) {
    list = list.filter((t) => {
      const num = String(t.ticket_number || "").toLowerCase();
      const title = String(t.title || "").toLowerCase();
      const module = String(t.sap_module || "").toLowerCase();
      return num.includes(q) || title.includes(q) || module.includes(q);
    });
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

  list.sort((a, b) => {
    if (filters.sort === "oldest") {
      return new Date(a.created_at) - new Date(b.created_at);
    }
    if (filters.sort === "priority") {
      const pa = priorityOrder[String(a.priority).toLowerCase()] ?? 9;
      const pb = priorityOrder[String(b.priority).toLowerCase()] ?? 9;
      if (pa !== pb) return pa - pb;
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });

  filteredTickets = list.map((t) => ({ ...t, id: t.id || t.ticket_id }));
  return filteredTickets;
}

function renderStatusChips() {
  const chips = [{ value: "all", label: "Tümü", active: filters.status === "all" }];
  Object.entries(STATUS_LABELS).forEach(([value, label]) => {
    chips.push({ value, label, active: filters.status === value });
  });
  return chips;
}

function renderPage() {
  applyFilters();

  const content = `
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Taleplerim</h3>
        <button type="button" class="sv2-btn sv2-btn-primary sv2-btn-sm" id="sv2-new-ticket-btn">
          <i class="fas fa-plus"></i> Yeni Talep
        </button>
      </div>
      <div class="sv2-section-body">
        ${renderFilterBar({
          search: {
            id: "sv2-ticket-search",
            placeholder: "Talep no veya konu ara...",
            value: filters.search,
          },
          chips: renderStatusChips(),
          sortOptions: [
            { value: "newest", label: "En yeni", selected: filters.sort === "newest" },
            { value: "oldest", label: "En eski", selected: filters.sort === "oldest" },
            { value: "priority", label: "Öncelik", selected: filters.sort === "priority" },
          ],
        })}
        <div id="sv2-tickets-table" style="margin-top:1rem">
          ${renderDataTable({
            columns: getTicketColumns(),
            rows: filteredTickets,
            emptyMessage: "Filtrelere uygun talep bulunamadı.",
          })}
        </div>
      </div>
    </div>`;

  renderShell(app, {
    title: "Taleplerim",
    activePage: "tickets",
    profile: session,
    isAdmin: false,
    content,
  });

  bindNewTicketButton("sv2-new-ticket-btn");
  bindFilterEvents();
  bindTableRowClicks();
}

function bindFilterEvents() {
  const searchInput = document.getElementById("sv2-ticket-search");
  searchInput?.addEventListener("input", () => {
    filters.search = searchInput.value;
    updateTable();
  });

  bindFilterChips("#sv2-filter-chips", (value) => {
    filters.status = value;
    updateTable();
  });

  document.getElementById("sv2-sort-select")?.addEventListener("change", (e) => {
    filters.sort = e.target.value;
    updateTable();
  });
}

function updateTable() {
  applyFilters();
  const tableWrap = document.getElementById("sv2-tickets-table");
  if (tableWrap) {
    tableWrap.innerHTML = renderDataTable({
      columns: getTicketColumns(),
      rows: filteredTickets,
      emptyMessage: "Filtrelere uygun talep bulunamadı.",
    });
    bindTableRowClicks();
  }
}

function bindTableRowClicks() {
  document.querySelectorAll("#sv2-tickets-table .sv2-table tbody tr").forEach((row) => {
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
    renderPage();
  } catch (err) {
    handleError(err, "Talepler yüklenemedi");
  } finally {
    showLoading(false);
  }
}

async function init() {
  showLoading(true);
  try {
    session = await requireAuth({ customerOnly: true });
    await loadData();
    initCreateTicketModal(session, () => loadData());
  } catch {
    /* requireAuth yönlendirir */
  } finally {
    showLoading(false);
  }
}

init();
