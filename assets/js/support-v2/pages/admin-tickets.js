/**
 * Parla BT Ticket V2 — Admin Ticket Listesi
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderDataTable,
  renderFilterBar,
  renderModal,
  openModal,
  closeModal,
  renderConfirmDialog,
  renderStatusBadge,
  renderPriorityBadge,
  renderAutocomplete,
  toast,
  showLoading,
  handleError,
  linkTicket,
  linkCompany,
  linkPersonnel,
  formatDate,
  formatDateTime,
  formatTicketTypeLabel,
  escapeHtml,
} from "../ui-shell.js";
import {
  STATUSES,
  STATUS_LABELS,
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  SAP_MODULES,
  SAP_MODULE_LABELS,
  formatStatusLabel,
  formatPriorityLabel,
  getTicketKey,
} from "../ticket-utils.js";
import { validateTicketForm } from "../validators.js";
import ParlaEmailService from "../email-service.js";
import { downloadExcel } from "../export-utils.js";

const ADMIN_ROLES = ["super_admin", "service_admin", "project_manager", "consultant"];
const PAGE_SIZE = 25;

let session = null;
let allTickets = [];
let allCompanies = [];
let allPersonnel = [];
let allUsers = [];
let selectedCompany = null;

const state = {
  search: "",
  statusFilters: [],
  typeFilters: [],
  sapModule: "",
  priority: "",
  consultantId: "",
  companyId: "",
  companyLabel: "",
  dateFrom: "",
  dateTo: "",
  unassignedOnly: false,
  sort: "created_desc",
  page: 1,
};

function actorPayload() {
  return {
    uid: session.uid,
    name: [session.first_name, session.last_name].filter(Boolean).join(" ") || session.email,
    email: session.email,
  };
}

function suggestNextCode(type) {
  const prefix = String(type || "CUS").toUpperCase();
  const nums = allCompanies
    .filter((c) => String(c.customer_code || "").startsWith(prefix))
    .map((c) => parseInt(String(c.customer_code).slice(3), 10) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

function isOpenStatus(status) {
  const s = String(status || "").toLowerCase();
  return s !== "closed" && s !== "resolved";
}

function ticketSearchText(t) {
  return [
    t.ticket_number,
    t.title,
    t.company_name,
    t.user_name,
    t.assigned_to_name,
    t.customer_code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterTickets(tickets) {
  let list = [...tickets];

  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    list = list.filter((t) => ticketSearchText(t).includes(q));
  }

  if (state.statusFilters.length) {
    list = list.filter((t) => state.statusFilters.includes(String(t.status).toLowerCase()));
  }

  if (state.typeFilters.length) {
    list = list.filter((t) =>
      state.typeFilters.includes(String(t.ticket_type || "").toUpperCase())
    );
  }

  if (state.sapModule) {
    list = list.filter((t) => t.sap_module === state.sapModule);
  }

  if (state.priority) {
    list = list.filter((t) => String(t.priority).toLowerCase() === state.priority);
  }

  if (state.consultantId) {
    list = list.filter((t) => t.assigned_to_id === state.consultantId);
  }

  if (state.companyId) {
    list = list.filter((t) => t.company_id === state.companyId);
  }

  if (state.unassignedOnly) {
    list = list.filter((t) => !t.assigned_to_id);
  }

  if (state.dateFrom) {
    const from = new Date(state.dateFrom);
    from.setHours(0, 0, 0, 0);
    list = list.filter((t) => new Date(t.created_at) >= from);
  }

  if (state.dateTo) {
    const to = new Date(state.dateTo);
    to.setHours(23, 59, 59, 999);
    list = list.filter((t) => new Date(t.created_at) <= to);
  }

  switch (state.sort) {
    case "created_asc":
      list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      break;
    case "priority_desc":
      list.sort((a, b) => {
        const order = { critical: 4, high: 3, medium: 2, low: 1 };
        return (order[b.priority] || 0) - (order[a.priority] || 0);
      });
      break;
    case "status_asc":
      list.sort((a, b) => formatStatusLabel(a.status).localeCompare(formatStatusLabel(b.status), "tr"));
      break;
    case "number_asc":
      list.sort((a, b) => String(a.ticket_number).localeCompare(String(b.ticket_number), "tr"));
      break;
    case "created_desc":
    default:
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  return list;
}

function paginate(list) {
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(state.page, totalPages);
  const start = (page - 1) * PAGE_SIZE;
  return {
    rows: list.slice(start, start + PAGE_SIZE),
    page,
    totalPages,
    total,
  };
}

function statusChips() {
  return Object.values(STATUSES).map((s) => ({
    value: s,
    label: STATUS_LABELS[s] || s,
    active: state.statusFilters.includes(s),
  }));
}

function typeChips() {
  return Object.values(TICKET_TYPES).map((t) => ({
    value: t,
    label: t,
    active: state.typeFilters.includes(t),
  }));
}

function advancedFiltersHtml() {
  const consultantOpts = allPersonnel
    .filter((p) => p.is_active !== false)
    .map((p) => {
      const id = p.personnel_id || p.id;
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
      const sel = state.consultantId === id ? " selected" : "";
      return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(name)}</option>`;
    })
    .join("");

  const sapOpts = SAP_MODULES.map((m) => {
    const sel = state.sapModule === m ? " selected" : "";
    const label = SAP_MODULE_LABELS[m] || m;
    return `<option value="${escapeHtml(m)}"${sel}>${escapeHtml(label)}</option>`;
  }).join("");

  const priOpts = Object.values(PRIORITIES)
    .map((p) => {
      const sel = state.priority === p ? " selected" : "";
      return `<option value="${escapeHtml(p)}"${sel}>${escapeHtml(PRIORITY_LABELS[p])}</option>`;
    })
    .join("");

  return `
    <div class="sv2-filters">
      <div class="sv2-form-group">
        <label for="sv2-filter-sap">SAP Modülü</label>
        <select id="sv2-filter-sap"><option value="">Tümü</option>${sapOpts}</select>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-filter-priority">Öncelik</label>
        <select id="sv2-filter-priority"><option value="">Tümü</option>${priOpts}</select>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-filter-consultant">Danışman</label>
        <select id="sv2-filter-consultant"><option value="">Tümü</option>${consultantOpts}</select>
      </div>
      <div class="sv2-form-group sv2-autocomplete-wrap">
        <label for="sv2-filter-company">Firma</label>
        <input type="text" id="sv2-filter-company" placeholder="Firma ara..." value="${escapeHtml(state.companyLabel)}" autocomplete="off">
        <input type="hidden" id="sv2-filter-company-id" value="${escapeHtml(state.companyId)}">
      </div>
      <div class="sv2-form-group">
        <label for="sv2-filter-date-from">Başlangıç</label>
        <input type="date" id="sv2-filter-date-from" value="${escapeHtml(state.dateFrom)}">
      </div>
      <div class="sv2-form-group">
        <label for="sv2-filter-date-to">Bitiş</label>
        <input type="date" id="sv2-filter-date-to" value="${escapeHtml(state.dateTo)}">
      </div>
      <div class="sv2-form-group">
        <label>&nbsp;</label>
        <label style="display:flex;align-items:center;gap:0.5rem;font-weight:500;cursor:pointer">
          <input type="checkbox" id="sv2-filter-unassigned" ${state.unassignedOnly ? "checked" : ""}>
          Sadece atanmamış
        </label>
      </div>
      <div class="sv2-form-group">
        <label>&nbsp;</label>
        <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-apply-advanced">Uygula</button>
      </div>
    </div>`;
}

function buildTableRows(tickets) {
  return tickets.map((t) => {
    const id = getTicketKey(t);
    return {
      id,
      ticket_number: t.ticket_number,
      title: t.title,
      customer_code: t.customer_code || "—",
      company_name: t.company_name,
      company_id: t.company_id,
      assigned_to_name: t.assigned_to_name,
      assigned_to_id: t.assigned_to_id,
      total_work_hours: (parseFloat(t.total_work_hours) || 0).toFixed(1),
      is_approved: !!t.is_approved,
      created_at: t.created_at,
      status: t.status,
      _raw: t,
    };
  });
}

function renderTableSection(paged) {
  const columns = [
    {
      key: "ticket_number",
      label: "NO",
      render: (v, row) => linkTicket(row.id, v),
    },
    { key: "title", label: "KONU" },
    { key: "customer_code", label: "MÜŞTERİ NO" },
    {
      key: "company_name",
      label: "MÜŞTERİ UNVAN",
      render: (v, row) =>
        row.company_id ? linkCompany(row.company_id, v) : escapeHtml(v || "—"),
    },
    {
      key: "assigned_to_name",
      label: "DANIŞMAN",
      render: (v, row) =>
        row.assigned_to_id
          ? linkPersonnel(row.assigned_to_id, v || "—")
          : '<span class="sv2-text-muted">Atanmadı</span>',
    },
    { key: "total_work_hours", label: "EFOR" },
    {
      key: "is_approved",
      label: "ONAY",
      render: (v, row) =>
        `<input type="checkbox" class="sv2-approval-cb" data-id="${escapeHtml(row.id)}" ${v ? "checked" : ""} title="Onay">`,
    },
    {
      key: "created_at",
      label: "TARİH",
      render: (v) => escapeHtml(formatDate(v)),
    },
    {
      key: "status",
      label: "DURUM",
      render: (v) => renderStatusBadge(v),
    },
    {
      key: "actions",
      label: "İŞLEMLER",
      render: (_, row) => `
        <a href="${PATHS.adminTicketDetail}?id=${encodeURIComponent(row.id)}" class="sv2-btn sv2-btn-sm sv2-btn-outline">Düzenle</a>
        <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-danger sv2-delete-ticket" data-id="${escapeHtml(row.id)}" data-number="${escapeHtml(row.ticket_number)}">Sil</button>`,
    },
  ];

  return renderDataTable({
    columns,
    rows: buildTableRows(paged.rows),
    emptyMessage: "Filtrelere uygun ticket bulunamadı.",
    pagination: {
      page: paged.page,
      totalPages: paged.totalPages,
      total: paged.total,
      onPageChange: (p) => {
        state.page = p;
        renderPage();
      },
    },
  });
}

function buildPageContent(paged) {
  return `
    <div class="sv2-section-header" style="border:none;padding:0 0 1rem;background:transparent">
      <div></div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-new-ticket"><i class="fas fa-plus"></i> Yeni Ticket</button>
        <button type="button" class="sv2-btn sv2-btn-secondary" id="sv2-export-csv"><i class="fas fa-file-csv"></i> CSV Dışa Aktar</button>
        <button type="button" class="sv2-btn sv2-btn-secondary" id="sv2-export-excel"><i class="fas fa-file-excel"></i> Excel Dışa Aktar</button>
      </div>
    </div>
    <div class="sv2-mb-1">
      <span class="sv2-text-muted" style="font-size:0.8125rem;font-weight:600">DURUM:</span>
      <div class="sv2-filter-chips" id="sv2-filter-chips" data-multi="true" style="display:inline-flex;margin-left:0.5rem;flex-wrap:wrap">
        ${statusChips()
          .map(
            (c) =>
              `<button type="button" class="sv2-chip${c.active ? " active is-active" : ""}" data-value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</button>`
          )
          .join("")}
      </div>
    </div>
    ${renderFilterBar({
      search: {
        id: "sv2-ticket-search",
        placeholder: "Ticket no, konu, firma, kullanıcı, danışman...",
        value: state.search,
      },
      chips: [],
      sortOptions: [
        { value: "created_desc", label: "En Yeni", selected: state.sort === "created_desc" },
        { value: "created_asc", label: "En Eski", selected: state.sort === "created_asc" },
        { value: "priority_desc", label: "Öncelik (Yüksek)", selected: state.sort === "priority_desc" },
        { value: "status_asc", label: "Durum", selected: state.sort === "status_asc" },
        { value: "number_asc", label: "Ticket No", selected: state.sort === "number_asc" },
      ],
      advancedFilters: advancedFiltersHtml(),
    })}
    <div class="sv2-mb-1">
      <span class="sv2-text-muted" style="font-size:0.8125rem;font-weight:600">TİP:</span>
      <div class="sv2-filter-chips" id="sv2-type-chips" data-multi="true" style="display:inline-flex;margin-left:0.5rem;flex-wrap:wrap">
        ${typeChips()
          .map(
            (c) =>
              `<button type="button" class="sv2-chip${c.active ? " active is-active" : ""}" data-value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</button>`
          )
          .join("")}
      </div>
    </div>
    <div class="sv2-section">
      <div class="sv2-section-body" id="sv2-tickets-table">${renderTableSection(paged)}</div>
    </div>
    <div id="sv2-search-ac-root"></div>`;
}

function bindChipGroup(rootId, multi, onUpdate) {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.querySelectorAll(".sv2-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (multi) {
        chip.classList.toggle("active");
        chip.classList.toggle("is-active");
        const active = [...root.querySelectorAll(".sv2-chip.active")].map((c) => c.dataset.value);
        onUpdate(active);
      } else {
        root.querySelectorAll(".sv2-chip").forEach((c) => {
          c.classList.remove("active", "is-active");
        });
        chip.classList.add("active", "is-active");
        onUpdate([chip.dataset.value]);
      }
    });
  });
}

function bindSearchAutocomplete() {
  const input = document.getElementById("sv2-ticket-search");
  if (!input) return;

  let listEl = document.getElementById("sv2-ticket-search-ac");
  if (!listEl) {
    listEl = document.createElement("div");
    listEl.id = "sv2-ticket-search-ac";
    listEl.className = "sv2-autocomplete-list";
    listEl.hidden = true;
    input.parentNode.classList.add("sv2-autocomplete-wrap");
    input.parentNode.appendChild(listEl);
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    state.search = input.value;
    if (q.length < 2) {
      listEl.hidden = true;
      state.page = 1;
      renderTableOnly();
      return;
    }

    const matches = allTickets
      .filter((t) => ticketSearchText(t).includes(q))
      .slice(0, 8);

    if (!matches.length) {
      listEl.hidden = true;
      state.page = 1;
      renderTableOnly();
      return;
    }

    listEl.innerHTML = matches
      .map(
        (t) => `
      <button type="button" class="sv2-ac-item" data-value="${escapeHtml(getTicketKey(t))}">
        <strong>${escapeHtml(t.ticket_number)}</strong> — ${escapeHtml(t.title || "")}
        <div class="sv2-autocomplete-meta">${escapeHtml(t.company_name || "")}</div>
      </button>`
      )
      .join("");
    listEl.hidden = false;

    listEl.querySelectorAll(".sv2-ac-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ticket = allTickets.find((t) => getTicketKey(t) === btn.dataset.value);
        if (ticket) {
          input.value = ticket.ticket_number;
          state.search = ticket.ticket_number;
        }
        listEl.hidden = true;
        state.page = 1;
        renderTableOnly();
      });
    });

    state.page = 1;
    renderTableOnly();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      listEl.hidden = true;
      state.page = 1;
      renderTableOnly();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      listEl.hidden = true;
    }, 200);
  });
}

function bindEvents() {
  bindChipGroup("sv2-filter-chips", true, (values) => {
    state.statusFilters = values;
    state.page = 1;
    renderTableOnly();
  });

  bindChipGroup("sv2-type-chips", true, (values) => {
    state.typeFilters = values;
    state.page = 1;
    renderTableOnly();
  });

  document.getElementById("sv2-sort-select")?.addEventListener("change", (e) => {
    state.sort = e.target.value;
    state.page = 1;
    renderTableOnly();
  });

  document.getElementById("sv2-advanced-toggle")?.addEventListener("click", () => {
    const panel = document.getElementById("sv2-advanced-panel");
    if (panel) panel.hidden = !panel.hidden;
  });

  document.getElementById("sv2-apply-advanced")?.addEventListener("click", () => {
    state.sapModule = document.getElementById("sv2-filter-sap")?.value || "";
    state.priority = document.getElementById("sv2-filter-priority")?.value || "";
    state.consultantId = document.getElementById("sv2-filter-consultant")?.value || "";
    state.companyId = document.getElementById("sv2-filter-company-id")?.value || "";
    state.companyLabel = document.getElementById("sv2-filter-company")?.value || "";
    state.dateFrom = document.getElementById("sv2-filter-date-from")?.value || "";
    state.dateTo = document.getElementById("sv2-filter-date-to")?.value || "";
    state.unassignedOnly = !!document.getElementById("sv2-filter-unassigned")?.checked;
    state.page = 1;
    renderTableOnly();
  });

  bindSearchAutocomplete();

  renderAutocomplete(
    "sv2-filter-company",
    allCompanies.map((c) => ({
      id: c.company_id || c.id,
      label: `${c.name} (${c.customer_code || ""})`,
      name: c.name,
    })),
    (selected) => {
      if (selected?.id) {
        document.getElementById("sv2-filter-company-id").value = selected.id;
        state.companyId = selected.id;
        state.companyLabel = selected.name || selected.label;
      }
    },
    { minChars: 1, labelKey: "label", valueKey: "id" }
  );

  document.getElementById("sv2-new-ticket")?.addEventListener("click", openCreateModal);
  document.getElementById("sv2-export-csv")?.addEventListener("click", exportCsv);
  document.getElementById("sv2-export-excel")?.addEventListener("click", exportExcel);
  bindTableActions();
}

function bindTableActions() {
  document.querySelectorAll(".sv2-approval-cb").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const id = cb.dataset.id;
      showLoading(true);
      try {
        await ParlaDb.updateTicket(id, { is_approved: cb.checked }, session);
        const t = allTickets.find((x) => getTicketKey(x) === id);
        if (t) t.is_approved = cb.checked;
        toast(cb.checked ? "Ticket onaylandı." : "Onay kaldırıldı.", "success");
      } catch (err) {
        cb.checked = !cb.checked;
        handleError(err, "Onay");
      } finally {
        showLoading(false);
      }
    });
  });

  document.querySelectorAll(".sv2-delete-ticket").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const number = btn.dataset.number;
      renderConfirmDialog(
        `"${number}" numaralı ticket kalıcı olarak silinecek. Devam etmek istiyor musunuz?`,
        async () => {
          showLoading(true);
          try {
            await ParlaDb.deleteTicket(id);
            await ParlaDb.logActivity(
              "ticket_deleted",
              "ticket",
              id,
              number,
              "Admin listesinden silindi",
              session
            );
            allTickets = allTickets.filter((t) => getTicketKey(t) !== id);
            toast("Ticket silindi.", "success");
            renderTableOnly();
          } catch (err) {
            handleError(err, "Silme");
          } finally {
            showLoading(false);
          }
        }
      );
    });
  });
}

function renderTableOnly() {
  const filtered = filterTickets(allTickets);
  const paged = paginate(filtered);
  const wrap = document.getElementById("sv2-tickets-table");
  if (wrap) {
    wrap.innerHTML = renderTableSection(paged);
    bindTableActions();
  }
}

function renderPage() {
  const filtered = filterTickets(allTickets);
  const paged = paginate(filtered);

  renderShell("#sv2-app", {
    title: "Ticketlar",
    activePage: "tickets",
    profile: session,
    isAdmin: true,
    content: buildPageContent(paged),
  });

  bindEvents();
}

function exportCsv() {
  const filtered = filterTickets(allTickets);
  if (!filtered.length) {
    toast("Dışa aktarılacak kayıt yok.", "error");
    return;
  }

  const headers = [
    "NO",
    "KONU",
    "MÜŞTERİ NO",
    "MÜŞTERİ UNVAN",
    "DANIŞMAN",
    "EFOR",
    "ONAY",
    "TARİH",
    "DURUM",
    "ÖNCELİK",
    "TİP",
    "SAP MODÜL",
  ];

  const escapeCsv = (v) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [
    headers.join(","),
    ...filtered.map((t) =>
      [
        t.ticket_number,
        t.title,
        t.customer_code,
        t.company_name,
        t.assigned_to_name,
        t.total_work_hours,
        t.is_approved ? "Evet" : "Hayır",
        formatDate(t.created_at),
        formatStatusLabel(t.status),
        formatPriorityLabel(t.priority),
        t.ticket_type,
        t.sap_module,
      ]
        .map(escapeCsv)
        .join(",")
    ),
  ];

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `parla-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${filtered.length} kayıt CSV olarak indirildi.`, "success");
}

async function exportExcel() {
  const filtered = filterTickets(allTickets);
  if (!filtered.length) {
    toast("Dışa aktarılacak kayıt yok.", "error");
    return;
  }

  showLoading(true);
  try {
    await downloadExcel(`parla-tickets-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        name: "Ticketlar",
        headers: [
          "NO",
          "KONU",
          "MÜŞTERİ NO",
          "MÜŞTERİ UNVAN",
          "DANIŞMAN",
          "EFOR",
          "ONAY",
          "TARİH",
          "DURUM",
          "ÖNCELİK",
          "TİP",
          "SAP MODÜL",
        ],
        rows: filtered.map((t) => [
          t.ticket_number,
          t.title,
          t.customer_code,
          t.company_name,
          t.assigned_to_name,
          t.total_work_hours,
          t.is_approved ? "Evet" : "Hayır",
          formatDate(t.created_at),
          formatStatusLabel(t.status),
          formatPriorityLabel(t.priority),
          t.ticket_type,
          t.sap_module,
        ]),
      },
    ]);
    toast(`${filtered.length} kayıt Excel olarak indirildi.`, "success");
  } catch (err) {
    handleError(err, "Excel export");
  } finally {
    showLoading(false);
  }
}

function openCreateModal() {
  selectedCompany = null;
  const typeOpts = Object.values(TICKET_TYPES)
    .map(
      (t) =>
        `<option value="${t}">${escapeHtml(formatTicketTypeLabel(t))}</option>`
    )
    .join("");

  const priOpts = Object.values(PRIORITIES)
    .map((p) => `<option value="${p}">${escapeHtml(PRIORITY_LABELS[p])}</option>`)
    .join("");

  const sapOpts = SAP_MODULES.map(
    (m) => `<option value="${escapeHtml(m)}">${escapeHtml(SAP_MODULE_LABELS[m] || m)}</option>`
  ).join("");

  const userOpts = allUsers
    .filter((u) => u.is_active !== false)
    .map((u) => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
      return `<option value="${escapeHtml(u.uid)}" data-company="${escapeHtml(u.company_id || "")}" data-code="${escapeHtml(u.customer_code || "")}" data-company-name="${escapeHtml(u.company_name || "")}">${escapeHtml(name)} (${escapeHtml(u.email || "")})</option>`;
    })
    .join("");

  renderModal("sv2-create-ticket-modal", {
    title: "Yeni Ticket Oluştur",
    body: `
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="sv2-create-type">Talep Tipi *</label>
          <select id="sv2-create-type">${typeOpts}</select>
        </div>
        <div class="sv2-form-group">
          <label for="sv2-create-priority">Öncelik *</label>
          <select id="sv2-create-priority">${priOpts}</select>
        </div>
      </div>
      <div class="sv2-form-row">
        <div class="sv2-form-group sv2-autocomplete-wrap">
          <label for="sv2-create-company">Firma *</label>
          <input type="text" id="sv2-create-company" placeholder="Firma ara..." autocomplete="off">
          <input type="hidden" id="sv2-create-company-id">
          <input type="hidden" id="sv2-create-customer-code">
        </div>
        <div class="sv2-form-group">
          <label for="sv2-create-user">Muhatap</label>
          <select id="sv2-create-user"><option value="">— Seçiniz —</option>${userOpts}</select>
        </div>
      </div>
      <div id="sv2-create-new-company-fields" hidden>
        <div class="sv2-form-row">
          <div class="sv2-form-group">
            <label for="sv2-create-company-type">Müşteri Tipi</label>
            <select id="sv2-create-company-type">
              <option value="CUS">CUS — Destek Anlaşmalı</option>
              <option value="ARC">ARC — Arızi Müşteri</option>
            </select>
          </div>
          <div class="sv2-form-group">
            <label for="sv2-create-company-code">Müşteri Kodu</label>
            <input type="text" id="sv2-create-company-code" placeholder="CUS0001">
          </div>
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-create-sap">SAP Modülü *</label>
        <select id="sv2-create-sap">${sapOpts}</select>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-create-title">Konu *</label>
        <input type="text" id="sv2-create-title" maxlength="100" placeholder="Ticket başlığı">
      </div>
      <div class="sv2-form-group">
        <label for="sv2-create-desc">Açıklama *</label>
        <textarea id="sv2-create-desc" rows="4" placeholder="Detaylı açıklama (en az 20 karakter)"></textarea>
      </div>
      <div id="sv2-create-errors" class="sv2-form-error" style="display:none"></div>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="sv2-create-ticket-modal">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-create-save">Oluştur</button>`,
  });

  openModal("sv2-create-ticket-modal");

  renderAutocomplete(
    "sv2-create-company",
    allCompanies.map((c) => ({
      id: c.company_id || c.id,
      label: `${c.name} (${c.customer_code || ""})`,
      name: c.name,
      customer_code: c.customer_code,
    })),
    (item) => {
      const newFields = document.getElementById("sv2-create-new-company-fields");
      if (item?.create) {
        selectedCompany = { create: true, name: item.term };
        document.getElementById("sv2-create-company-id").value = "";
        document.getElementById("sv2-create-customer-code").value = "";
        newFields.hidden = false;
        const type = document.getElementById("sv2-create-company-type").value;
        document.getElementById("sv2-create-company-code").value = suggestNextCode(type);
        return;
      }
      selectedCompany = item;
      document.getElementById("sv2-create-company-id").value = item?.id || "";
      document.getElementById("sv2-create-customer-code").value = item?.customer_code || "";
      document.getElementById("sv2-create-company").value = item?.name || item?.label || "";
      newFields.hidden = true;

      const userSelect = document.getElementById("sv2-create-user");
      if (userSelect) {
        [...userSelect.options].forEach((opt) => {
          if (!opt.value) return;
          opt.hidden = opt.dataset.company && opt.dataset.company !== item.id;
        });
      }
    },
    {
      minChars: 1,
      labelKey: "label",
      valueKey: "id",
      nameKey: "name",
      createLabel: '"{term}" — Yeni firma kaydet',
      onTyping: () => {
        selectedCompany = null;
        document.getElementById("sv2-create-company-id").value = "";
        document.getElementById("sv2-create-customer-code").value = "";
        document.getElementById("sv2-create-new-company-fields").hidden = true;
      },
    }
  );

  document.getElementById("sv2-create-company-type")?.addEventListener("change", (e) => {
    document.getElementById("sv2-create-company-code").value = suggestNextCode(e.target.value);
  });

  document.getElementById("sv2-create-user")?.addEventListener("change", (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt?.dataset.company) {
      document.getElementById("sv2-create-company-id").value = opt.dataset.company;
      document.getElementById("sv2-create-customer-code").value = opt.dataset.code || "";
      document.getElementById("sv2-create-company").value = opt.dataset.companyName || "";
    }
  });

  document.getElementById("sv2-create-save")?.addEventListener("click", saveNewTicket);
}

async function saveNewTicket() {
  let companyId = document.getElementById("sv2-create-company-id")?.value;
  let companyName = document.getElementById("sv2-create-company")?.value?.trim();
  let customerCode = document.getElementById("sv2-create-customer-code")?.value;
  const userId = document.getElementById("sv2-create-user")?.value;
  const user = allUsers.find((u) => u.uid === userId);

  const formData = {
    ticket_type: document.getElementById("sv2-create-type")?.value,
    priority: document.getElementById("sv2-create-priority")?.value,
    sap_module: document.getElementById("sv2-create-sap")?.value,
    title: document.getElementById("sv2-create-title")?.value,
    description: document.getElementById("sv2-create-desc")?.value,
  };

  const validation = validateTicketForm(formData);
  const errEl = document.getElementById("sv2-create-errors");

  if (!companyId && !selectedCompany?.create) {
    validation.valid = false;
    validation.errors.company_id = "Firma seçimi zorunludur. Listeden seçin veya yeni firma kaydedin.";
  }

  if (!validation.valid) {
    if (errEl) {
      errEl.style.display = "block";
      errEl.innerHTML = Object.values(validation.errors)
        .map((m) => `<div>${escapeHtml(m)}</div>`)
        .join("");
    }
    return;
  }

  showLoading(true);
  try {
    if (!companyId && selectedCompany?.create) {
      const type = document.getElementById("sv2-create-company-type")?.value || "CUS";
      const code =
        document.getElementById("sv2-create-company-code")?.value.trim() || suggestNextCode(type);
      const company = await ParlaDb.createCompany({
        name: companyName,
        customer_code: code,
        customer_type: type,
        created_by: session.uid,
        updated_by: session.uid,
      });
      companyId = company.id;
      companyName = company.name;
      customerCode = company.customer_code;
      allCompanies.push(company);
      await ParlaDb.logActivity(
        "company_created",
        "company",
        company.id,
        company.name,
        "Ticket oluşturma sırasında yeni firma eklendi",
        session
      );
    }

    const ticket = await ParlaDb.createTicket(
      {
        ...formData,
        company_id: companyId,
        company_name: companyName,
        customer_code: customerCode,
        user_id: userId || session.uid,
        user_name: user
          ? [user.first_name, user.last_name].filter(Boolean).join(" ")
          : actorPayload().name,
        user_email: user?.email || session.email,
        status: "open",
      },
      session
    );

    await ParlaDb.logActivity(
      "ticket_created",
      "ticket",
      ticket.id,
      ticket.ticket_number,
      companyName,
      session
    );

    const notifyEmail = user?.email || session.email;
    if (notifyEmail) {
      await ParlaEmailService.notifyTicketEvent("ticket_created", notifyEmail, ticket, {
        note: "Yeni destek talebi oluşturuldu.",
      });
    }

    allTickets.unshift(ticket);
    toast("Ticket oluşturuldu.", "success");
    closeModal("sv2-create-ticket-modal");
    state.page = 1;
    renderPage();
  } catch (err) {
    handleError(err, "Oluşturma");
  } finally {
    showLoading(false);
  }
}

async function loadData() {
  showLoading(true);
  try {
    const [tickets, companies, personnel, users] = await Promise.all([
      ParlaDb.getAllTickets(),
      ParlaDb.getAllCompanies(),
      ParlaDb.getAllPersonnel(),
      ParlaDb.getAllUsers(),
    ]);
    allTickets = tickets;
    allCompanies = companies;
    allPersonnel = personnel;
    allUsers = users;

    const params = new URLSearchParams(window.location.search);
    if (params.get("filter") === "unassigned") {
      state.unassignedOnly = true;
    }

    renderPage();
  } catch (err) {
    handleError(err, "Ticketlar");
  } finally {
    showLoading(false);
  }
}

async function init() {
  try {
    session = await requireAuth({
      adminOnly: true,
      roles: ADMIN_ROLES,
    });
    await loadData();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin" && err.message !== "role_denied") {
      handleError(err, "Oturum");
    }
  }
}

init();
