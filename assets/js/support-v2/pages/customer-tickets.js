/**
 * Parla BT Ticket V2 — müşteri talepler listesi
 */
import { getCustomerTickets } from "../notifications.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderDataTable,
  renderFilterBar,
  bindFilterChips,
  bindSearchInput,
  showLoading,
  handleLoadError,
  loadingStateHtml,
  renderStatusBadge,
  renderPriorityBadge,
  renderTypeBadge,
  formatDateTime,
  escapeHtml,
} from "../ui-shell.js";
import { SAP_MODULE_LABELS, STATUS_LABELS, matchesSearch, formatStatusLabel, formatPriorityLabel } from "../ticket-utils.js";
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

/** İstemci tarafı sayfalama: ilk 25 satır çizilir, gerisi "Daha fazla göster" ile eklenir (MUS-19, OLC-10). */
const PAGE_SIZE = 25;
let visibleCount = PAGE_SIZE;

function isCompanyAdmin() {
  return session?.role === "company_admin";
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
    { key: "title", label: "KONU", render: (val) => escapeHtml(val || "—") },
    ...(isCompanyAdmin()
      ? [{ key: "user_name", label: "TALEP SAHİBİ", render: (val) => escapeHtml(val || "—") }]
      : []),
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

  // Türkçe karakter/İ-ı duyarsız, çok sözcüklü; listede görünen tüm sütunlar aranır (MUS-14).
  if (filters.search.trim()) {
    list = list.filter((t) =>
      matchesSearch(filters.search, [
        t.ticket_number,
        t.title,
        t.sap_module,
        SAP_MODULE_LABELS[t.sap_module],
        t.user_name,
        t.assigned_to_name,
        formatStatusLabel(t.status),
        formatPriorityLabel(t.priority),
      ])
    );
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

  filteredTickets = list.map((t) => ({ ...t, id: t.id }));
  return filteredTickets;
}

/** Hiç talebi olmayan kullanıcıya "filtre" değil "henüz talep yok" mesajı (MUS-26). */
function emptyMessage() {
  return allTickets.length === 0
    ? "Henüz talebiniz yok. Yeni Talep düğmesiyle ilk talebinizi oluşturabilirsiniz."
    : "Filtrelere uygun talep bulunamadı.";
}

/** Tablo + (gerekirse) "daha fazla göster" altbilgisi. */
function tableHtml() {
  const total = filteredTickets.length;
  const rows = filteredTickets.slice(0, visibleCount);
  const more =
    total > rows.length
      ? `<div class="sv2-load-more">
          <p class="sv2-text-muted" role="status">${total.toLocaleString("tr-TR")} talebin ${rows.length.toLocaleString("tr-TR")} tanesi gösteriliyor.</p>
          <button type="button" class="sv2-btn sv2-btn-outline" id="sv2-show-more">Daha fazla göster</button>
        </div>`
      : total > PAGE_SIZE
        ? `<p class="sv2-text-muted sv2-load-more" role="status">${total.toLocaleString("tr-TR")} talebin tamamı gösteriliyor.</p>`
        : "";
  return `${renderDataTable({ columns: getTicketColumns(), rows, emptyMessage: emptyMessage() })}${more}`;
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
        <h3>${isCompanyAdmin() ? "Firma Talepleri" : "Taleplerim"}</h3>
        <button type="button" class="sv2-btn sv2-btn-primary sv2-btn-sm" id="sv2-new-ticket-btn">
          <i class="fas fa-plus"></i> Yeni Talep
        </button>
      </div>
      <div class="sv2-section-body">
        ${renderFilterBar({
          search: {
            id: "sv2-ticket-search",
            placeholder: isCompanyAdmin() ? "Talep no, konu veya talep sahibi ara..." : "Talep no veya konu ara...",
            value: filters.search,
          },
          chips: renderStatusChips(),
          sortOptions: [
            { value: "newest", label: "En yeni", selected: filters.sort === "newest" },
            { value: "oldest", label: "En eski", selected: filters.sort === "oldest" },
            { value: "priority", label: "Öncelik", selected: filters.sort === "priority" },
          ],
        })}
        <div id="sv2-tickets-table" class="sv2-mt-1">${tableHtml()}</div>
      </div>
    </div>`;

  renderShell(app, {
    title: isCompanyAdmin() ? "Firma Talepleri" : "Taleplerim",
    activePage: "tickets",
    profile: session,
    isAdmin: false,
    content,
  });

  bindNewTicketButton("sv2-new-ticket-btn");
  bindFilterEvents();
  bindTableEvents();
}

function bindFilterEvents() {
  // Arama 200 ms gecikmeli: her tuşta tüm liste yeniden çizilmez (OLC-10).
  bindSearchInput(document.getElementById("sv2-ticket-search"), (value) => {
    filters.search = value;
    visibleCount = PAGE_SIZE;
    updateTable();
  });

  bindFilterChips("#sv2-filter-chips", (value) => {
    filters.status = value;
    visibleCount = PAGE_SIZE;
    updateTable();
  });

  document.getElementById("sv2-sort-select")?.addEventListener("change", (e) => {
    filters.sort = e.target.value;
    visibleCount = PAGE_SIZE;
    updateTable();
  });
}

function updateTable() {
  applyFilters();
  const tableWrap = document.getElementById("sv2-tickets-table");
  if (tableWrap) tableWrap.innerHTML = tableHtml();
}

/** Satır tıklaması ve "daha fazla göster" tek delegasyonla; tablo yeniden çizilince yeniden bağlamak gerekmez. */
function bindTableEvents() {
  const wrap = document.getElementById("sv2-tickets-table");
  if (!wrap || wrap.dataset.bound) return;
  wrap.dataset.bound = "1";
  wrap.addEventListener("click", (e) => {
    if (e.target.closest("#sv2-show-more")) {
      const keepFocusAt = visibleCount;
      visibleCount += PAGE_SIZE;
      updateTable();
      // Odak, yeni gelen ilk satırın bağlantısına taşınır (klavye/okuyucu bağlamı kaybolmasın).
      wrap.querySelectorAll("tbody tr")[keepFocusAt]?.querySelector("a")?.focus();
      return;
    }
    const row = e.target.closest("tbody tr");
    if (!row || e.target.closest("a, button")) return;
    const id = row.dataset.id;
    if (id) window.location.href = `${PATHS.customerTicketDetail}?id=${encodeURIComponent(id)}`;
  });
}

function pageTitle() {
  return isCompanyAdmin() ? "Firma Talepleri" : "Taleplerim";
}

function renderLoadingShell() {
  renderShell(app, { title: pageTitle(), activePage: "tickets", profile: session, isAdmin: false, content: loadingStateHtml("Talepler yükleniyor…") });
}

async function loadData() {
  showLoading(true);
  try {
    allTickets = await getCustomerTickets(session);
    renderPage();
  } catch (err) {
    // Hata durumunda da kabuk çizilir; içerikte kalıcı "Yeniden dene" kartı gösterilir (MUS-06, UX-02).
    handleLoadError(err, "Talepler yüklenemedi", { retry: loadData, activePage: "tickets", pageTitle: pageTitle(), isAdmin: false });
  } finally {
    showLoading(false);
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
