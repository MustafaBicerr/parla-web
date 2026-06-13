/**
 * Parla BT Ticket V2 — UI kabuğu, bileşenler ve yardımcılar
 */
import { PATHS, signOutUser } from "./auth-guard.js";
import {
  escapeHtml as utilEscapeHtml,
  formatDate,
  formatDateTime,
  formatStatusLabel,
  formatPriorityLabel,
  formatTicketTypeLabel,
  formatRoleLabel,
} from "./ticket-utils.js";

let toastContainer = null;
let loadingEl = null;
let confirmOverlay = null;

const ADMIN_NAV = [
  { id: "dashboard", label: "Genel Bakış", href: PATHS.adminDashboard, icon: "fa-chart-pie" },
  { id: "tickets", label: "Ticketlar", href: PATHS.adminTickets, icon: "fa-ticket-alt" },
  { id: "activities", label: "Aktiviteler", href: PATHS.adminActivities, icon: "fa-history" },
  { id: "users", label: "Muhataplar", href: PATHS.adminUsers, icon: "fa-users" },
  { id: "companies", label: "Müşteriler", href: PATHS.adminCompanies, icon: "fa-building" },
  { id: "contracts", label: "Sözleşmeler", href: PATHS.adminContracts, icon: "fa-file-contract" },
  { id: "projects", label: "Projeler", href: PATHS.adminProjects, icon: "fa-folder-open" },
  { id: "divider-mgmt", divider: true, label: "YÖNETİM" },
  { id: "departments", label: "Departmanlar", href: PATHS.adminDepartments, icon: "fa-building" },
  { id: "modules", label: "Modüller", href: PATHS.adminModules, icon: "fa-cogs" },
  { id: "personnel", label: "Danışmanlar", href: PATHS.adminPersonnel, icon: "fa-user-tie" },
  { id: "support-types", label: "Destek Türleri", href: PATHS.adminSupportTypes, icon: "fa-wrench" },
  { id: "reports", label: "Raporlar", href: PATHS.adminReports, icon: "fa-chart-bar" },
];

const CUSTOMER_NAV = [
  { id: "dashboard", label: "Genel Bakış", href: PATHS.customerDashboard, icon: "fa-chart-pie" },
  { id: "tickets", label: "Taleplerim", href: PATHS.customerTickets, icon: "fa-ticket-alt" },
  { id: "profile", label: "Profil", href: PATHS.customerProfile, icon: "fa-user" },
];

function escapeHtml(str) {
  return utilEscapeHtml(str);
}

function ensureToastContainer() {
  if (!document.getElementById("sv2-toast-container")) {
    toastContainer = document.createElement("div");
    toastContainer.id = "sv2-toast-container";
    toastContainer.className = "sv2-toast-container";
    document.body.appendChild(toastContainer);
  } else {
    toastContainer = document.getElementById("sv2-toast-container");
  }
  return toastContainer;
}

function toast(message, type) {
  type = type || "info";
  const container = ensureToastContainer();
  const el = document.createElement("div");
  el.className = `sv2-toast sv2-toast-${type}`;
  el.setAttribute("role", "alert");
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function showLoading(show) {
  if (!loadingEl) {
    loadingEl = document.createElement("div");
    loadingEl.className = "sv2-loading-overlay";
    loadingEl.innerHTML = '<div class="sv2-spinner"></div>';
    document.body.appendChild(loadingEl);
  }
  loadingEl.classList.toggle("is-visible", !!show);
}

function getInitials(profile) {
  const first = profile?.first_name || "";
  const last = profile?.last_name || "";
  const initials = (first.charAt(0) + last.charAt(0)).toUpperCase();
  return initials || (profile?.email ? profile.email.charAt(0).toUpperCase() : "?");
}

function getDisplayName(profile) {
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  return name || profile?.email || "Kullanıcı";
}

function renderSidebar(activePage, profile, isAdmin) {
  const navItems = isAdmin ? ADMIN_NAV : CUSTOMER_NAV;
  const name = getDisplayName(profile);
  const roleLabel = formatRoleLabel(profile?.role);

  let navHtml = "";
  for (const item of navItems) {
    if (item.divider) {
      navHtml += `<div class="sv2-nav-divider">${escapeHtml(item.label || "")}</div>`;
      continue;
    }
    const active = item.id === activePage ? " active" : "";
    navHtml += `
      <a href="${item.href}" class="sv2-nav-item${active}" data-page="${item.id}">
        <i class="fas ${item.icon}"></i>
        <span class="sv2-nav-label">${escapeHtml(item.label)}</span>
      </a>`;
  }

  return `
    <aside class="sv2-sidebar" id="sv2-sidebar">
      <div class="sv2-sidebar-header">
        <a href="/index.html" class="sv2-logo-link">
          <img src="/assets/img/parla-logo/parla-logo.png" alt="Parla BT" class="sv2-logo">
        </a>
        <button type="button" class="sv2-sidebar-close" id="sv2-sidebar-close" aria-label="Menüyü kapat">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <nav class="sv2-nav">${navHtml}</nav>
      <div class="sv2-sidebar-footer">
        <div class="sv2-user-mini">
          <div class="sv2-avatar">${escapeHtml(getInitials(profile))}</div>
          <div class="sv2-user-info">
            <span class="sv2-user-name">${escapeHtml(name)}</span>
            <span class="sv2-user-role">${escapeHtml(roleLabel)}</span>
          </div>
        </div>
        <button type="button" class="sv2-btn-logout" id="sv2-logout-btn">
          <i class="fas fa-sign-out-alt"></i> Çıkış Yap
        </button>
      </div>
    </aside>
    <div class="sv2-sidebar-overlay" id="sv2-sidebar-backdrop"></div>`;
}

function renderTopbar(title, profile) {
  const name = getDisplayName(profile);
  return `
    <header class="sv2-topbar">
      <div class="sv2-topbar-left">
        <button type="button" class="sv2-menu-toggle" id="sv2-menu-toggle" aria-label="Menüyü aç">
          <i class="fas fa-bars"></i>
        </button>
        <h1 class="sv2-page-title">${escapeHtml(title || "")}</h1>
      </div>
      <div class="sv2-topbar-right">
        <button type="button" class="sv2-notif-btn" id="sv2-notif-btn" aria-label="Bildirimler">
          <i class="fas fa-bell"></i>
          <span class="sv2-notif-badge" id="sv2-notif-badge" hidden>0</span>
        </button>
        <div class="sv2-topbar-user">
          <div class="sv2-avatar sv2-avatar-sm">${escapeHtml(getInitials(profile))}</div>
          <span class="sv2-topbar-name">${escapeHtml(name)}</span>
        </div>
      </div>
    </header>`;
}

function renderShell(container, options) {
  options = options || {};
  const el = typeof container === "string" ? document.querySelector(container) : container;
  if (!el) return;

  const { title, activePage, profile, isAdmin, content } = options;

  el.innerHTML = `
    <div class="sv2-app">
      ${renderSidebar(activePage, profile, isAdmin)}
      <div class="sv2-main">
        ${renderTopbar(title, profile)}
        <div class="sv2-content">${content || ""}</div>
      </div>
    </div>
    <div id="sv2-modal-root"></div>`;

  bindShellEvents(profile);
}

function bindShellEvents(profile) {
  const toggle = document.getElementById("sv2-menu-toggle");
  const sidebar = document.getElementById("sv2-sidebar");
  const backdrop = document.getElementById("sv2-sidebar-backdrop");
  const closeBtn = document.getElementById("sv2-sidebar-close");
  const logoutBtn = document.getElementById("sv2-logout-btn");

  function openSidebar() {
    sidebar?.classList.add("is-open");
    backdrop?.classList.add("is-visible");
    document.body.classList.add("sv2-sidebar-open");
  }

  function closeSidebar() {
    sidebar?.classList.remove("is-open");
    backdrop?.classList.remove("is-visible");
    document.body.classList.remove("sv2-sidebar-open");
  }

  toggle?.addEventListener("click", openSidebar);
  closeBtn?.addEventListener("click", closeSidebar);
  backdrop?.addEventListener("click", closeSidebar);

  logoutBtn?.addEventListener("click", () => {
    signOutUser().catch((err) => handleError(err, "Çıkış"));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSidebar();
  });

  if (profile?.uid) {
    bindNotificationBadge(profile.uid);
  }
}

async function bindNotificationBadge(uid) {
  try {
    const { default: ParlaDb } = await import("./firebase-client.js");
    await ParlaDb.waitForFirebase();
    const fb = window.__PARLA_FIREBASE;
    const notifRef = fb.db.ref(fb.database, `v2/notifications/${uid}`);

    fb.db.onValue(notifRef, (snap) => {
      const badge = document.getElementById("sv2-notif-badge");
      if (!badge) return;
      let unread = 0;
      if (snap.exists()) {
        const val = snap.val();
        Object.keys(val).forEach((key) => {
          if (!val[key].is_read) unread++;
        });
      }
      if (unread > 0) {
        badge.hidden = false;
        badge.textContent = unread > 99 ? "99+" : String(unread);
      } else {
        badge.hidden = true;
      }
    });
  } catch {
    /* bildirim dinleyicisi opsiyonel */
  }
}

function renderStatsGrid(cards) {
  if (!cards || !cards.length) return "";
  const items = cards
    .map(
      (c) => `
    <div class="sv2-stat-card ${c.variant || ""}">
      <div class="sv2-stat-value">${escapeHtml(String(c.value ?? "0"))}</div>
      <div class="sv2-stat-label">${escapeHtml(c.label || "")}</div>
      ${c.hint ? `<div class="sv2-stat-hint">${escapeHtml(c.hint)}</div>` : ""}
    </div>`
    )
    .join("");
  return `<div class="sv2-stats-grid">${items}</div>`;
}

function renderDataTable(options) {
  options = options || {};
  const { columns, rows, emptyMessage, pagination } = options;

  if (!rows || rows.length === 0) {
    return renderEmptyState(emptyMessage || "Kayıt bulunamadı.", "fa-inbox");
  }

  const thead = (columns || [])
    .map(
      (col) =>
        `<th${col.width ? ` style="width:${col.width}"` : ""}>${escapeHtml(col.label || col.key)}</th>`
    )
    .join("");

  const tbody = rows
    .map((row) => {
      const cells = (columns || [])
        .map((col) => {
          const raw = row[col.key];
          const cell =
            typeof col.render === "function" ? col.render(raw, row) : escapeHtml(String(raw ?? "—"));
          return `<td>${cell}</td>`;
        })
        .join("");
      return `<tr data-id="${escapeHtml(row.id || "")}">${cells}</tr>`;
    })
    .join("");

  let paginationHtml = "";
  if (pagination) {
    const { page, totalPages, total, onPageChange } = pagination;
    paginationHtml = `
      <div class="sv2-pagination">
        <span class="sv2-pagination-info">Toplam ${total ?? 0} kayıt · Sayfa ${page}/${totalPages || 1}</span>
        <div class="sv2-pagination-btns">
          <button type="button" class="sv2-btn sv2-page-prev" ${page <= 1 ? "disabled" : ""}>Önceki</button>
          <button type="button" class="sv2-btn sv2-page-next" ${page >= totalPages ? "disabled" : ""}>Sonraki</button>
        </div>
      </div>`;

    setTimeout(() => {
      document.querySelector(".sv2-page-prev")?.addEventListener("click", () => {
        if (page > 1 && onPageChange) onPageChange(page - 1);
      });
      document.querySelector(".sv2-page-next")?.addEventListener("click", () => {
        if (page < totalPages && onPageChange) onPageChange(page + 1);
      });
    }, 0);
  }

  return `
    <div class="sv2-table-wrap">
      <table class="sv2-table">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
    ${paginationHtml}`;
}

function renderFilterBar(options) {
  options = options || {};
  const { search, chips, sortOptions, advancedFilters } = options;

  let searchHtml = "";
  if (search) {
    searchHtml = `
      <div class="sv2-filter-search">
        <input type="search" id="${search.id || "sv2-search"}" placeholder="${escapeHtml(search.placeholder || "Ara...")}" value="${escapeHtml(search.value || "")}" autocomplete="off">
      </div>`;
  }

  let chipsHtml = "";
  if (chips && chips.length) {
    chipsHtml = `
      <div class="sv2-filter-chips" id="sv2-filter-chips">
        ${chips
          .map(
            (c) =>
              `<button type="button" class="sv2-chip${c.active ? " is-active" : ""}" data-value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</button>`
          )
          .join("")}
      </div>`;
  }

  let sortHtml = "";
  if (sortOptions && sortOptions.length) {
    sortHtml = `
      <div class="sv2-filter-sort">
        <select id="sv2-sort-select">
          ${sortOptions
            .map(
              (o) =>
                `<option value="${escapeHtml(o.value)}"${o.selected ? " selected" : ""}>${escapeHtml(o.label)}</option>`
            )
            .join("")}
        </select>
      </div>`;
  }

  let advancedHtml = "";
  if (advancedFilters) {
    advancedHtml = `
      <button type="button" class="sv2-btn" id="sv2-advanced-toggle">
        <i class="fas fa-filter"></i> Gelişmiş Filtre
      </button>
      <div class="sv2-advanced-panel" id="sv2-advanced-panel" hidden>${advancedFilters}</div>`;
  }

  return `
    <div class="sv2-filter-bar">
      ${searchHtml}
      ${chipsHtml}
      ${sortHtml}
      ${advancedHtml}
    </div>`;
}

function renderModal(id, options) {
  options = options || {};
  const root = document.getElementById("sv2-modal-root") || document.body;
  let overlay = document.getElementById(id);

  const html = `
    <div class="sv2-modal-overlay" id="${id}" role="dialog" aria-modal="true">
      <div class="sv2-modal">
        <div class="sv2-modal-header">
          <h3>${escapeHtml(options.title || "")}</h3>
          <button type="button" class="sv2-modal-close" data-close="${id}" aria-label="Kapat">&times;</button>
        </div>
        <div class="sv2-modal-body">${options.body || ""}</div>
        ${options.footer ? `<div class="sv2-modal-footer">${options.footer}</div>` : ""}
      </div>
    </div>`;

  if (overlay) {
    overlay.outerHTML = html;
  } else {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    root.appendChild(wrap.firstElementChild);
  }

  overlay = document.getElementById(id);
  overlay?.querySelectorAll(`[data-close="${id}"]`).forEach((btn) => {
    btn.addEventListener("click", () => closeModal(id));
  });

  if (options.closeOnBackdrop) {
    overlay?.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(id);
    });
  }
}

function openModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.add("is-open");
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.remove("is-open");
}

function renderBreadcrumb(items) {
  if (!items || !items.length) return "";
  const parts = items.map((item, i) => {
    const isLast = i === items.length - 1;
    if (isLast || !item.href) {
      return `<span class="sv2-breadcrumb-current">${escapeHtml(item.label)}</span>`;
    }
    return `<a href="${item.href}" class="sv2-breadcrumb-link">${escapeHtml(item.label)}</a>`;
  });
  return `<nav class="sv2-breadcrumb" aria-label="Breadcrumb">${parts.join('<span class="sv2-breadcrumb-sep">›</span>')}</nav>`;
}

function renderEmptyState(message, icon) {
  icon = icon || "fa-inbox";
  return `
    <div class="sv2-empty">
      <i class="fas ${icon}"></i>
      <h4>${escapeHtml(message || "Kayıt bulunamadı.")}</h4>
    </div>`;
}

function renderStatusBadge(status) {
  const key = String(status || "open").toLowerCase();
  const clsMap = {
    open: "open",
    assigned: "assigned",
    in_progress: "in-progress",
    waiting_customer: "waiting",
    resolved: "resolved",
    closed: "closed",
  };
  const cls = clsMap[key] || "open";
  return `<span class="sv2-badge sv2-badge-${cls}">${escapeHtml(formatStatusLabel(status))}</span>`;
}

function renderPriorityBadge(priority) {
  const key = String(priority || "medium").toLowerCase();
  return `<span class="sv2-priority sv2-priority-${key}">${escapeHtml(formatPriorityLabel(priority))}</span>`;
}

function renderTypeBadge(type) {
  const key = String(type || "").toUpperCase();
  return `<span class="sv2-type-badge" data-type="${escapeHtml(key)}">${escapeHtml(key)}</span>`;
}

function renderAutocomplete(inputId, items, onSelect, options) {
  options = options || {};
  const input = document.getElementById(inputId);
  if (!input) return;

  let listEl = document.getElementById(`${inputId}-ac-list`);
  if (!listEl) {
    listEl = document.createElement("div");
    listEl.id = `${inputId}-ac-list`;
    listEl.className = "sv2-autocomplete-list";
    listEl.hidden = true;
    input.parentNode.classList.add("sv2-autocomplete-wrap");
    input.parentNode.appendChild(listEl);
  }

  const minChars = options.minChars ?? 2;
  const labelKey = options.labelKey || "label";
  const valueKey = options.valueKey || "value";
  const nameKey = options.nameKey || "name";

  function closeList() {
    listEl.classList.remove("is-open");
    listEl.hidden = true;
  }

  function openList() {
    listEl.hidden = false;
    listEl.classList.add("is-open");
  }

  function getItemLabel(item) {
    return String(item[labelKey] ?? item[nameKey] ?? "");
  }

  function hasExactMatch(term) {
    const q = term.toLowerCase();
    return (items || []).some((item) => {
      const label = getItemLabel(item).toLowerCase();
      const name = String(item[nameKey] ?? "").toLowerCase();
      return label === q || name === q;
    });
  }

  function shouldOfferCreate(term) {
    if (!options.createLabel || !term) return false;
    if (options.createExactMatch !== false && hasExactMatch(term)) return false;
    return true;
  }

  function filterItems(q) {
    return (items || []).filter((item) => {
      const label = getItemLabel(item).toLowerCase();
      const name = String(item[nameKey] ?? "").toLowerCase();
      return label.includes(q) || name.includes(q);
    });
  }

  function bindItemClicks(filtered) {
    listEl.querySelectorAll(".sv2-ac-item").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        if (btn.dataset.create === "1") {
          const term = input.value.trim();
          onSelect?.({ create: true, term });
        } else {
          const selected = filtered.find(
            (i) => String(i[valueKey] ?? i.id) === btn.dataset.value
          );
          if (selected) {
            input.value = String(selected[nameKey] ?? selected[labelKey] ?? "");
            onSelect?.(selected);
          }
        }
        closeList();
      });
    });
  }

  function showList(filtered) {
    const term = input.value.trim();
    const offerCreate = shouldOfferCreate(term);

    if (!filtered.length && !offerCreate) {
      closeList();
      return;
    }

    let html = filtered
      .slice(0, options.maxItems || 10)
      .map(
        (item) =>
          `<button type="button" class="sv2-ac-item" data-value="${escapeHtml(String(item[valueKey] ?? item.id ?? ""))}">${escapeHtml(getItemLabel(item))}</button>`
      )
      .join("");

    if (offerCreate) {
      const createText = options.createLabel.replace("{term}", term);
      html += `<button type="button" class="sv2-ac-item sv2-ac-create" data-create="1"><i class="fas fa-plus"></i> ${escapeHtml(createText)}</button>`;
    }

    listEl.innerHTML = html;
    openList();
    bindItemClicks(filtered);
  }

  function refreshList() {
    const q = input.value.trim().toLowerCase();
    if (q.length < minChars) {
      closeList();
      return;
    }
    showList(filterItems(q));
  }

  input.addEventListener("input", () => {
    options.onTyping?.();
    const q = input.value.trim().toLowerCase();
    if (q.length < minChars) {
      closeList();
      return;
    }
    showList(filterItems(q));
  });

  input.addEventListener("focus", refreshList);

  input.addEventListener("blur", () => {
    setTimeout(closeList, 200);
  });
}

function bindFilterChips(container, onChange) {
  const root = typeof container === "string" ? document.querySelector(container) : container;
  if (!root) return;

  root.querySelectorAll(".sv2-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const multi = root.dataset.multi === "true";
      if (!multi) {
        root.querySelectorAll(".sv2-chip").forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
      } else {
        chip.classList.toggle("is-active");
      }
      const active = [...root.querySelectorAll(".sv2-chip.is-active")].map((c) => c.dataset.value);
      onChange?.(multi ? active : chip.dataset.value);
    });
  });
}

function renderTabs(tabs, activeId, onChange) {
  const tabId = "sv2-tabs-" + Math.random().toString(36).slice(2, 8);
  const html = `
    <div class="sv2-tabs" id="${tabId}">
      ${(tabs || [])
        .map(
          (t) =>
            `<button type="button" class="sv2-tab${t.id === activeId ? " active" : ""}" data-tab="${escapeHtml(t.id)}">${escapeHtml(t.label)}</button>`
        )
        .join("")}
    </div>`;

  setTimeout(() => {
    const el = document.getElementById(tabId);
    el?.querySelectorAll(".sv2-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        el.querySelectorAll(".sv2-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        onChange?.(btn.dataset.tab);
      });
    });
  }, 0);

  return html;
}

function renderTimeline(items) {
  if (!items || !items.length) {
    return renderEmptyState("Henüz aktivite yok.", "fa-clock");
  }

  const list = items
    .map((item) => {
      const variant = item.variant || item.author_role || "";
      return `
      <li class="sv2-timeline-item ${escapeHtml(variant)}">
        <div class="sv2-timeline-dot"></div>
        <div class="sv2-timeline-bubble">
          <div class="sv2-timeline-head">
            <span class="sv2-timeline-author">${escapeHtml(item.author || item.changed_by_name || "Sistem")}</span>
            <span class="sv2-timeline-time">${escapeHtml(formatDateTime(item.created_at || item.changed_at))}</span>
          </div>
          <div class="sv2-timeline-body">${escapeHtml(item.message || item.new_value || item.details || "")}</div>
        </div>
      </li>`;
    })
    .join("");

  return `<ul class="sv2-timeline">${list}</ul>`;
}

function renderConfirmDialog(message, onConfirm) {
  if (!confirmOverlay) {
    confirmOverlay = document.createElement("div");
    confirmOverlay.id = "sv2-confirm-overlay";
    confirmOverlay.className = "sv2-modal-overlay";
    document.body.appendChild(confirmOverlay);
  }

  confirmOverlay.innerHTML = `
    <div class="sv2-modal sv2-confirm-modal">
      <div class="sv2-modal-body">
        <p>${escapeHtml(message || "Bu işlemi onaylıyor musunuz?")}</p>
      </div>
      <div class="sv2-modal-footer">
        <button type="button" class="sv2-btn" id="sv2-confirm-cancel">İptal</button>
        <button type="button" class="sv2-btn" id="sv2-confirm-ok">Onayla</button>
      </div>
    </div>`;

  confirmOverlay.classList.add("is-open");

  const close = () => confirmOverlay.classList.remove("is-open");

  document.getElementById("sv2-confirm-cancel")?.addEventListener("click", close, { once: true });
  document.getElementById("sv2-confirm-ok")?.addEventListener(
    "click",
    () => {
      close();
      onConfirm?.();
    },
    { once: true }
  );
}

const ERROR_MESSAGES = {
  "permission-denied": "Bu işlem için yetkiniz yok.",
  "network-request-failed": "Bağlantı hatası. İnternet bağlantınızı kontrol edin.",
  not_authenticated: "Oturumunuz sona erdi. Lütfen tekrar giriş yapın.",
  profile_not_found: "Kullanıcı profili bulunamadı.",
  account_inactive: "Hesabınız aktif değil.",
};

function handleError(error, context) {
  const rawCode = error?.code || "";
  const code = String(rawCode).replace("auth/", "").toLowerCase();
  let message =
    ERROR_MESSAGES[code] ||
    ERROR_MESSAGES[rawCode] ||
    error?.message ||
    "Beklenmeyen bir hata oluştu.";

  if (String(message).toLowerCase().includes("permission_denied") || code === "permission_denied") {
    message =
      "Veritabanı erişim izni reddedildi. Firebase Console → Realtime Database → Rules bölümündeki güncel kuralları yayınladığınızdan emin olun.";
  }

  if (context) {
    message = `${context}: ${message}`;
  }

  toast(message, "error");
  console.error("[Parla V2]", context || "Hata", error);
  return message;
}

function linkTicket(id, number) {
  const num = number || id;
  return `<a href="${PATHS.adminTicketDetail}?id=${encodeURIComponent(id)}" class="sv2-link">${escapeHtml(num)}</a>`;
}

function linkUser(uid, name) {
  return `<a href="${PATHS.adminUserDetail}?uid=${encodeURIComponent(uid)}" class="sv2-link">${escapeHtml(name || uid)}</a>`;
}

function linkCompany(id, name) {
  return `<a href="${PATHS.adminCompanyDetail}?id=${encodeURIComponent(id)}" class="sv2-link">${escapeHtml(name || id)}</a>`;
}

function linkPersonnel(id, name) {
  return `<a href="${PATHS.adminPersonnelDetail}?id=${encodeURIComponent(id)}" class="sv2-link">${escapeHtml(name || id)}</a>`;
}

function linkProject(id, name) {
  return `<a href="${PATHS.adminProjectDetail}?id=${encodeURIComponent(id)}" class="sv2-link">${escapeHtml(name || id)}</a>`;
}

export {
  toast,
  showLoading,
  escapeHtml,
  renderSidebar,
  renderTopbar,
  renderShell,
  bindShellEvents,
  renderStatsGrid,
  renderDataTable,
  renderFilterBar,
  renderModal,
  openModal,
  closeModal,
  renderBreadcrumb,
  renderEmptyState,
  renderStatusBadge,
  renderPriorityBadge,
  renderTypeBadge,
  renderAutocomplete,
  bindFilterChips,
  renderTabs,
  renderTimeline,
  renderConfirmDialog,
  handleError,
  linkTicket,
  linkUser,
  linkCompany,
  linkPersonnel,
  linkProject,
  formatDate,
  formatDateTime,
  formatTicketTypeLabel,
};
