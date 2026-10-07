/**
 * Parla BT Ticket V2 — UI kabuğu, bileşenler ve yardımcılar
 */
import { PATHS, signOutUser, getLastSession } from "./auth-guard.js";
import { PAGE_ROLES } from "./access-control.js";
import {
  escapeHtml as utilEscapeHtml,
  formatDate,
  formatDateTime,
  formatStatusLabel,
  formatPriorityLabel,
  formatTicketTypeLabel,
  formatRoleLabel,
  describeSla,
  isAdminRole,
  normalizeSearch,
} from "./ticket-utils.js";
import { PRIORITY_TOKENS, safeClass, safeText, safeToken } from "./safe-utils.js";
import {
  classifyError,
  errorStateHtml,
  renderErrorState,
  loadingStateHtml,
  withInflight,
  withTimeout,
  isPermissionError,
} from "./ui-states.js";
import { trapTab, focusFirstIn, installA11yEnhancer } from "./a11y.js";

installA11yEnhancer();

let toastContainer = null;
let loadingEl = null;
let loadingTimer = null;
let confirmOverlay = null;
let currentProfile = null;

const ADMIN_NAV = [
  { id: "dashboard", label: "Genel Bakış", href: PATHS.adminDashboard, icon: "fa-chart-pie" },
  { id: "tickets", label: "Talepler", href: PATHS.adminTickets, icon: "fa-ticket-alt" },
  { id: "activities", label: "Aktiviteler", href: PATHS.adminActivities, icon: "fa-history" },
  { id: "users", label: "Kullanıcılar", href: PATHS.adminUsers, icon: "fa-users" },
  { id: "companies", label: "Müşteriler", href: PATHS.adminCompanies, icon: "fa-building" },
  { id: "contracts", label: "Sözleşmeler", href: PATHS.adminContracts, icon: "fa-file-contract" },
  { id: "projects", label: "Projeler", href: PATHS.adminProjects, icon: "fa-folder-open" },
  { id: "divider-mgmt", divider: true, label: "Yönetim" },
  { id: "departments", label: "Departmanlar", href: PATHS.adminDepartments, icon: "fa-building" },
  { id: "modules", label: "Modüller", href: PATHS.adminModules, icon: "fa-cogs" },
  { id: "personnel", label: "Danışmanlar", href: PATHS.adminPersonnel, icon: "fa-user-tie" },
  { id: "support-types", label: "Destek Türleri", href: PATHS.adminSupportTypes, icon: "fa-wrench" },
  { id: "reply-templates", label: "Hazır Yanıtlar", href: "/support-v2/admin/reply-templates.html", icon: "fa-comment-dots" },
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

/** PDF kılavuzlar: yöneticiler iki kılavuzu da, müşteriler yalnızca kullanıcı kılavuzunu görür. */
function guidesFor(isAdmin) {
  const guides = [{ label: "Kullanıcı Kılavuzu", href: PATHS.guideUser, file: "Parla-BT-Kullanici-Kilavuzu.pdf" }];
  if (isAdmin) {
    guides.unshift({ label: "Sistem Adminleri Kılavuzu", href: PATHS.guideAdmin, file: "Parla-BT-Sistem-Adminleri-Kilavuzu.pdf" });
  }
  return guides;
}

function renderGuideLinks(isAdmin) {
  const items = guidesFor(isAdmin)
    .map(
      (g) => `
      <div class="sv2-nav-guide">
        <a href="${g.href}" target="_blank" rel="noopener" class="sv2-nav-item sv2-nav-guide-open" data-guide="${escapeHtml(g.file)}" title="${escapeHtml(g.label)} (PDF) — yeni sekmede aç">
          <i class="fas fa-book-open"></i>
          <span class="sv2-nav-label">${escapeHtml(g.label)}</span>
        </a>
        <a href="${g.href}" download="${escapeHtml(g.file)}" class="sv2-nav-guide-dl" aria-label="${escapeHtml(g.label)} PDF indir" title="PDF olarak indir">
          <i class="fas fa-download"></i>
        </a>
      </div>`
    )
    .join("");
  return `<div class="sv2-nav-divider">Kılavuzlar</div>${items}`;
}

function ensureToastContainer() {
  const existing = document.getElementById("sv2-toast-container");
  if (existing) {
    toastContainer = existing;
  } else {
    toastContainer = document.createElement("div");
    toastContainer.id = "sv2-toast-container";
    toastContainer.className = "sv2-toast-container";
    // Ekran okuyucular yeni iletileri okusun (UX-43).
    toastContainer.setAttribute("aria-live", "polite");
    toastContainer.setAttribute("aria-relevant", "additions");
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

const TOAST_MS = { success: 4500, info: 5500, warning: 8000, error: 9000 };
const TOAST_MAX = 4;

/**
 * Bildirim iletisi. Başarı yeşil, hata kırmızı; hata/uyarı daha uzun kalır, fare üzerindeyken
 * duraklar ve × ile kapatılabilir (UX-35/43).
 */
function toast(message, type) {
  type = ["success", "error", "warning", "info"].includes(type) ? type : "info";
  const container = ensureToastContainer();
  while (container.children.length >= TOAST_MAX) container.firstElementChild.remove();

  const el = document.createElement("div");
  el.className = `sv2-toast sv2-toast-${type}`;
  el.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
  const text = document.createElement("span");
  text.className = "sv2-toast-text";
  text.textContent = safeText(message) || String(message ?? "");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "sv2-toast-close";
  close.setAttribute("aria-label", "İletiyi kapat");
  close.innerHTML = "&times;";
  el.append(text, close);
  container.appendChild(el);

  let timer = null;
  const dismiss = () => {
    clearTimeout(timer);
    el.remove();
  };
  const arm = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, ms);
  };
  arm(TOAST_MS[type]);
  close.addEventListener("click", dismiss);
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", () => arm(2500));
  el.addEventListener("focusin", () => clearTimeout(timer));
  el.addEventListener("focusout", () => arm(2500));
  return el;
}

const LOADING_SAFETY_MS = 30000;

/**
 * Tam ekran yükleniyor katmanı. Güvenlik zaman aşımı: 30 sn içinde kapatılmazsa (bağlantı kopuk, takılmış
 * okuma) katman kendiliğinden kalkar ve kullanıcı bilgilendirilir (MUS-21, SEN-24).
 */
function showLoading(show) {
  if (!loadingEl) {
    loadingEl = document.createElement("div");
    loadingEl.className = "sv2-loading-overlay";
    loadingEl.setAttribute("role", "status");
    loadingEl.setAttribute("aria-label", "Yükleniyor");
    loadingEl.innerHTML = '<div class="sv2-spinner"></div>';
    document.body.appendChild(loadingEl);
  }
  loadingEl.classList.toggle("is-visible", !!show);
  clearTimeout(loadingTimer);
  if (show) {
    const ms = Number(window.__SV2_LOADING_SAFETY_MS) > 0 ? Number(window.__SV2_LOADING_SAFETY_MS) : LOADING_SAFETY_MS;
    loadingTimer = setTimeout(() => {
      loadingEl.classList.remove("is-visible");
      toast(
        navigator.onLine === false
          ? "Bağlantı yok: işlem sürüyor olabilir. Bağlantı gelince tamamlanabilir; sayfayı yenilemeden önce listeyi kontrol edin."
          : "İşlem beklenenden uzun sürüyor. Bağlantınız yavaş ya da kopuk olabilir; birazdan listeyi kontrol edin.",
        "warning"
      );
    }, ms);
  }
}

/* Çevrimdışı şeridi: bağlantı kopunca üst kısımda kalıcı uyarı (SEN-24). */
function bindConnectivityBar() {
  if (typeof window === "undefined" || window.__sv2ConnBound) return;
  window.__sv2ConnBound = true;
  const sync = () => {
    let bar = document.getElementById("sv2-offline-bar");
    if (navigator.onLine === false) {
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "sv2-offline-bar";
        bar.className = "sv2-offline-bar";
        bar.setAttribute("role", "status");
        bar.textContent = "Bağlantı yok. Yazdığınız veriler gönderilemeyebilir; bağlantı gelince yeniden deneyin.";
        document.body.prepend(bar);
      }
    } else {
      bar?.remove();
    }
  };
  window.addEventListener("offline", sync);
  window.addEventListener("online", sync);
  sync();
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
    const active = item.id === activePage;
    navHtml += `
      <a href="${item.href}" class="sv2-nav-item${active ? " active" : ""}" data-page="${item.id}"${active ? ' aria-current="page"' : ""}>
        <i class="fas ${item.icon}" aria-hidden="true"></i>
        <span class="sv2-nav-label">${escapeHtml(item.label)}</span>
      </a>`;
  }

  navHtml += renderGuideLinks(isAdmin);

  return `
    <aside class="sv2-sidebar" id="sv2-sidebar" aria-label="Yan menü">
      <div class="sv2-sidebar-header">
        <a href="/index.html" class="sv2-logo-link" aria-label="Parla BT ana sayfa">
          <img src="/assets/img/parla-logo/parla-logo-180.png" alt="Parla BT" class="sv2-logo" width="90" height="36">
        </a>
        <button type="button" class="sv2-sidebar-close" id="sv2-sidebar-close" aria-label="Menüyü kapat">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
      <nav class="sv2-nav" aria-label="Ana menü">${navHtml}</nav>
      <div class="sv2-sidebar-footer">
        <div class="sv2-user-mini">
          <div class="sv2-avatar" aria-hidden="true">${escapeHtml(getInitials(profile))}</div>
          <div class="sv2-user-info">
            <span class="sv2-user-name">${escapeHtml(name)}</span>
            <span class="sv2-user-role">${escapeHtml(roleLabel)}</span>
          </div>
        </div>
        <a href="${PATHS.changePassword}" class="sv2-btn-logout sv2-btn-logout--link" id="sv2-change-password-link">
          <i class="fas fa-key" aria-hidden="true"></i> Şifre Değiştir
        </a>
        <button type="button" class="sv2-btn-logout" id="sv2-logout-btn">
          <i class="fas fa-sign-out-alt" aria-hidden="true"></i> Çıkış Yap
        </button>
      </div>
    </aside>
    <div class="sv2-sidebar-overlay" id="sv2-sidebar-backdrop" aria-hidden="true"></div>`;
}

function renderTopbar(title, profile, isAdmin) {
  const name = getDisplayName(profile);
  const primaryGuide = guidesFor(isAdmin)[0];
  return `
    <header class="sv2-topbar">
      <div class="sv2-topbar-left">
        <button type="button" class="sv2-menu-toggle" id="sv2-menu-toggle" aria-label="Menüyü aç" aria-expanded="false" aria-controls="sv2-sidebar">
          <i class="fas fa-bars" aria-hidden="true"></i>
        </button>
        <h1 class="sv2-page-title">${escapeHtml(title || "")}</h1>
      </div>
      <div class="sv2-topbar-right">
        <a href="${primaryGuide.href}" target="_blank" rel="noopener" class="sv2-topbar-guide" id="sv2-topbar-guide" title="${escapeHtml(primaryGuide.label)} (PDF)" aria-label="Kılavuz: ${escapeHtml(primaryGuide.label)} (PDF, yeni sekmede açılır)">
          <i class="fas fa-book-open" aria-hidden="true"></i><span>Kılavuz</span>
        </a>
        <button type="button" class="sv2-notif-btn" id="sv2-notif-btn" aria-label="Bildirimler" aria-haspopup="dialog" aria-expanded="false" aria-controls="sv2-notif-panel">
          <i class="fas fa-bell" aria-hidden="true"></i>
          <span class="sv2-notif-badge" id="sv2-notif-badge" hidden aria-hidden="true">0</span>
        </button>
        <div class="sv2-topbar-user">
          <div class="sv2-avatar sv2-avatar-sm" aria-hidden="true">${escapeHtml(getInitials(profile))}</div>
          <span class="sv2-topbar-name">${escapeHtml(name)}</span>
        </div>
      </div>
    </header>`;
}

/** Modal kökü uygulama kabuğunun DIŞINDA, `document.body` üzerinde kalıcıdır (MUS-02/UX-01/SEN-01). */
function ensureModalRoot() {
  let root = document.getElementById("sv2-modal-root");
  if (!root || !document.body.contains(root)) {
    root = document.createElement("div");
    root.id = "sv2-modal-root";
    document.body.appendChild(root);
  }
  return root;
}

function shellKeyOf(options) {
  const p = options.profile || {};
  return [options.activePage || "", options.isAdmin ? "a" : "c", p.uid || "", p.role || "", p.first_name || "", p.last_name || "", p.email || ""].join("|");
}

/** Yeniden çizimden önce kullanıcı durumunu (kaydırma, odak, yazılmakta olan taslaklar) yakalar. */
function captureUiState(root) {
  const active = document.activeElement;
  const state = {
    scrollY: window.scrollY,
    mainTop: root.querySelector(".sv2-main")?.scrollTop || 0,
    focusId: active && active !== document.body && root.contains(active) ? active.id || "" : "",
    drafts: [],
  };
  root.querySelectorAll(".sv2-content textarea[data-keep-draft][id]").forEach((t) => {
    if (t.value) state.drafts.push([t.id, t.value]);
  });
  return state;
}

function restoreUiState(root, state) {
  if (!state) return;
  for (const [id, value] of state.drafts) {
    const t = root.querySelector(`#${CSS.escape(id)}`);
    if (t && t.tagName === "TEXTAREA" && !t.value) t.value = value;
  }
  if (state.focusId) {
    const el = root.querySelector(`#${CSS.escape(state.focusId)}`);
    if (el && el !== document.activeElement && typeof el.focus === "function") {
      try {
        el.focus({ preventScroll: true });
      } catch {
        /* odak geri verilemedi */
      }
    }
  }
  const main = root.querySelector(".sv2-main");
  if (main && state.mainTop) main.scrollTop = state.mainTop;
  if (state.scrollY) window.scrollTo(0, state.scrollY);
}

/**
 * Uygulama kabuğunu çizer. İDEMPOTENT: kabuk aynı sayfa/kullanıcı için zaten çizilmişse yalnız başlık ve
 * içerik değişir (olay dinleyicisi/zil/DOM yeniden kurulmaz; OLC-11, PER-46). Yeniden çizimde kaydırma
 * konumu, odak ve `data-keep-draft` işaretli taslaklar korunur (UX-05).
 *
 * Erişilebilirlik: "İçeriğe geç" bağlantısı, `<main id="sv2-main">`, sayfa başına benzersiz `<title>` (UX-10, UX-40).
 */
function renderShell(container, options) {
  options = options || {};
  const el = typeof container === "string" ? document.querySelector(container) : container;
  if (!el) return;

  const { title, activePage, profile, isAdmin, content } = options;
  currentProfile = profile || currentProfile;
  ensureModalRoot();
  bindConnectivityBar();
  // Kabuğun açık kalmış sayfa-içi pencereleri (kalıcı olmayanlar) yeniden çizimle birlikte kapanır.
  document.querySelectorAll("#sv2-modal-root > .sv2-modal-overlay:not([data-persist])").forEach((m) => m.remove());
  syncModalState();
  if (title) document.title = `${title} | Parla BT Destek`;

  const key = shellKeyOf(options);
  const shell = el.firstElementChild;
  const reuse = shell && shell.classList?.contains("sv2-app") && shell.dataset.shellKey === key;
  const snapshot = captureUiState(el);

  if (reuse) {
    const heading = shell.querySelector(".sv2-page-title");
    if (heading) heading.textContent = title || "";
    const contentEl = shell.querySelector(".sv2-content");
    if (contentEl) contentEl.innerHTML = content || "";
  } else {
    el.innerHTML = `
    <div class="sv2-app" data-shell-key="${escapeHtml(key)}">
      <a class="sv2-skip" href="#sv2-main">İçeriğe geç</a>
      ${renderSidebar(activePage, profile, isAdmin)}
      <div class="sv2-main">
        ${renderTopbar(title, profile, isAdmin)}
        <main class="sv2-content" id="sv2-main" tabindex="-1">${content || ""}</main>
      </div>
    </div>`;
    bindShellEvents(profile);
  }
  restoreUiState(el, snapshot);
}

let shellDocBound = false;
let sidebarReturnFocus = null;
const mobileNav = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(max-width: 900px)") : null;

function isSidebarOpen() {
  return !!document.getElementById("sv2-sidebar")?.classList.contains("is-open");
}

/** Mobil çekmece: kapanınca odak menü düğmesine döner; açıkken arka plan `inert` + kaydırma kilidi (UX-09). */
function closeSidebar(restoreFocus = true) {
  const wasOpen = isSidebarOpen();
  document.getElementById("sv2-sidebar")?.classList.remove("is-open");
  document.getElementById("sv2-sidebar-backdrop")?.classList.remove("is-visible");
  document.body.classList.remove("sv2-sidebar-open");
  document.querySelector(".sv2-main")?.removeAttribute("inert");
  document.getElementById("sv2-menu-toggle")?.setAttribute("aria-expanded", "false");
  if (wasOpen && restoreFocus) {
    const back = sidebarReturnFocus && sidebarReturnFocus.isConnected ? sidebarReturnFocus : document.getElementById("sv2-menu-toggle");
    sidebarReturnFocus = null;
    try {
      back?.focus({ preventScroll: true });
    } catch {
      /* odak geri verilemedi */
    }
  }
}

function openSidebar() {
  const sidebar = document.getElementById("sv2-sidebar");
  if (!sidebar) return;
  sidebarReturnFocus = document.activeElement;
  sidebar.classList.add("is-open");
  document.getElementById("sv2-sidebar-backdrop")?.classList.add("is-visible");
  document.body.classList.add("sv2-sidebar-open");
  document.querySelector(".sv2-main")?.setAttribute("inert", "");
  document.getElementById("sv2-menu-toggle")?.setAttribute("aria-expanded", "true");
  focusFirstIn(sidebar, ".sv2-nav-item.active, .sv2-nav-item");
}

function bindShellEvents(profile) {
  const toggle = document.getElementById("sv2-menu-toggle");
  const backdrop = document.getElementById("sv2-sidebar-backdrop");
  const closeBtn = document.getElementById("sv2-sidebar-close");
  const logoutBtn = document.getElementById("sv2-logout-btn");

  // Bu öğeler her kabuk çiziminde yenidir (eskiler DOM ile birlikte atılır); yalnız yeni öğelere bağlanır.
  toggle?.addEventListener("click", openSidebar);
  closeBtn?.addEventListener("click", () => closeSidebar());
  backdrop?.addEventListener("click", () => closeSidebar());
  logoutBtn?.addEventListener("click", () => {
    withInflight(logoutBtn, () => signOutUser()).catch((err) => handleError(err, "Çıkış"));
  });

  // Belge düzeyindeki dinleyiciler YALNIZ BİR KEZ bağlanır; DOM'u kapanışla tutmazlar (OLC-11).
  if (!shellDocBound) {
    shellDocBound = true;
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return; // örn. otomatik tamamlama listesi Esc'i kendisi tüketti
        if (openModals().length) closeTopModal();
        else if (isSidebarOpen()) closeSidebar();
      } else if (e.key === "Tab") {
        const top = openModals().pop();
        if (top) trapTab(top.querySelector(".sv2-modal") || top, e);
        else if (isSidebarOpen()) trapTab(document.getElementById("sv2-sidebar"), e);
      }
    });
    // Masaüstü genişliğine dönülünce çekmece durumu temizlenir.
    mobileNav?.addEventListener?.("change", (e) => {
      if (!e.matches) closeSidebar(false);
    });
  }

  if (profile?.uid) {
    // initNotifications kendi içinde idempotenttir (aynı kullanıcı için yeniden yoklama başlatmaz).
    import("./notifications.js")
      .then((m) => m.initNotifications(profile))
      .catch(() => {
        /* bildirim zili opsiyonel */
      });
  }
}

function renderStatsGrid(cards) {
  if (!cards || !cards.length) return "";
  const items = cards
    .map(
      (c) => `
    <div class="sv2-stat-card ${safeClass(c.variant)}">
      <div class="sv2-stat-value">${escapeHtml(String(c.value ?? "0"))}</div>
      <div class="sv2-stat-label">${escapeHtml(c.label || "")}</div>
      ${c.hint ? `<div class="sv2-stat-hint">${escapeHtml(c.hint)}</div>` : ""}
    </div>`
    )
    .join("");
  return `<div class="sv2-stats-grid">${items}</div>`;
}

/** Sayfalama düğmeleri olay delegasyonuyla çalışır (birden çok tablo, gecikmeli yerleştirme güvenli). */
const pageHandlers = new Map();
let pageSeq = 0;
let pageDelegated = false;

function bindPageDelegation() {
  if (pageDelegated || typeof document === "undefined") return;
  pageDelegated = true;
  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(".sv2-page-prev, .sv2-page-next");
    if (!btn || btn.disabled) return;
    const holder = btn.closest("[data-pg]");
    const h = holder && pageHandlers.get(holder.dataset.pg);
    if (!h || !h.onPageChange) return;
    if (btn.classList.contains("sv2-page-prev") && h.page > 1) h.onPageChange(h.page - 1);
    else if (btn.classList.contains("sv2-page-next") && h.page < h.totalPages) h.onPageChange(h.page + 1);
  });
}

/**
 * Veri tablosu. Dar ekranlarda (≤900 px) "tablo → kart" düzenine geçer: her hücre `data-label` taşır
 * (UX-11, MUS-24, PER-41). Sütun seçenekleri: `render`, `width`, `wide` (uzun metin: asgari genişlik),
 * `nowrap`, `hideOnCard` (kart görünümünde gizle), `lowPriority` (901–1499 px masaüstünde gizle), `className`.
 * `options.responsive === false` ile kart düzeni kapatılır (yatay kaydırmalı tablo).
 */
function renderDataTable(options) {
  options = options || {};
  const { columns, rows, emptyMessage, pagination, responsive } = options;

  if (!rows || rows.length === 0) {
    return renderEmptyState(emptyMessage || "Kayıt bulunamadı.", "fa-inbox");
  }

  const cols = columns || [];
  const cellClass = (col) =>
    [col.className, col.wide ? "sv2-col-wide" : "", col.nowrap ? "sv2-col-nowrap" : "", col.hideOnCard ? "sv2-card-hide" : "", col.lowPriority ? "sv2-col-lo" : ""]
      .filter(Boolean)
      .map((c) => safeClass(c) || c)
      .join(" ");
  const classAttr = (col) => (cellClass(col) ? ` class="${escapeHtml(cellClass(col))}"` : "");

  const thead = cols
    .map(
      (col) =>
        `<th scope="col"${classAttr(col)}${col.width ? ` style="width:${escapeHtml(col.width)}"` : ""}>${escapeHtml(col.label || col.key)}</th>`
    )
    .join("");

  // Zehirli kayıt dayanıklılığı: bozuk bir satır/hücre tabloyu (ve sayfayı) çökertmez (SEC-02).
  const tbody = rows
    .map((row) => {
      try {
        const cells = cols
          .map((col) => {
            let cell;
            try {
              const raw = row[col.key];
              cell = typeof col.render === "function" ? col.render(raw, row) : escapeHtml(safeText(raw) || "—");
            } catch (cellErr) {
              console.warn("[Parla V2] hücre çizilemedi", col.key, cellErr);
              cell = "—";
            }
            return `<td data-label="${escapeHtml(col.label || col.key || "")}"${classAttr(col)}>${cell}</td>`;
          })
          .join("");
        return `<tr data-id="${escapeHtml(safeText(row.id))}">${cells}</tr>`;
      } catch (rowErr) {
        console.warn("[Parla V2] satır çizilemedi", rowErr);
        return "";
      }
    })
    .join("");

  let paginationHtml = "";
  if (pagination) {
    const { page, totalPages, total, onPageChange } = pagination;
    bindPageDelegation();
    const pid = `pg${++pageSeq}`;
    if (pageHandlers.size > 60) {
      for (const k of pageHandlers.keys()) if (!document.querySelector(`[data-pg="${k}"]`)) pageHandlers.delete(k);
    }
    pageHandlers.set(pid, { page, totalPages: totalPages || 1, onPageChange });
    paginationHtml = `
      <div class="sv2-pagination" data-pg="${pid}">
        <span class="sv2-pagination-info" role="status">Toplam ${total ?? 0} kayıt · Sayfa ${page}/${totalPages || 1}</span>
        <div class="sv2-pagination-btns">
          <button type="button" class="sv2-btn sv2-page-prev" ${page <= 1 ? "disabled" : ""}>Önceki</button>
          <button type="button" class="sv2-btn sv2-page-next" ${page >= totalPages ? "disabled" : ""}>Sonraki</button>
        </div>
      </div>`;
  }

  return `
    <div class="sv2-table-wrap${responsive === false ? "" : " sv2-table-responsive"}">
      <table class="sv2-table">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
    ${paginationHtml}`;
}

/** Arama kutusu yazımında gereksiz yeniden çizimi önler (OLC-10). `fn.cancel()` bekleyen çağrıyı iptal eder. */
function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** `input` olayını (varsayılan 200 ms) geciktirerek bağlar; Enter beklemeden hemen çalıştırır. */
function bindSearchInput(input, handler, ms = 200) {
  if (!input) return null;
  const run = debounce(() => handler(input.value), ms);
  input.addEventListener("input", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      run.cancel();
      handler(input.value);
    }
  });
  return run;
}

function renderFilterBar(options) {
  options = options || {};
  const { search, chips, sortOptions, advancedFilters } = options;

  let searchHtml = "";
  if (search) {
    const sid = escapeHtml(search.id || "sv2-search");
    const label = escapeHtml(search.label || search.placeholder || "Ara");
    searchHtml = `
      <div class="sv2-filter-search">
        <label class="sv2-sr-only" for="${sid}">${label}</label>
        <input type="search" id="${sid}" placeholder="${escapeHtml(search.placeholder || "Ara...")}" value="${escapeHtml(search.value || "")}" autocomplete="off">
      </div>`;
  }

  let chipsHtml = "";
  if (chips && chips.length) {
    chipsHtml = `
      <div class="sv2-filter-chips" id="sv2-filter-chips" role="group" aria-label="${escapeHtml(options.chipsLabel || "Süzgeçler")}">
        ${chips
          .map(
            (c) =>
              `<button type="button" class="sv2-chip${c.active ? " is-active" : ""}" data-value="${escapeHtml(c.value)}" aria-pressed="${c.active ? "true" : "false"}">${escapeHtml(c.label)}</button>`
          )
          .join("")}
      </div>`;
  }

  let sortHtml = "";
  if (sortOptions && sortOptions.length) {
    sortHtml = `
      <div class="sv2-filter-sort">
        <select id="sv2-sort-select" aria-label="Sıralama">
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
      <button type="button" class="sv2-btn" id="sv2-advanced-toggle" aria-expanded="false" aria-controls="sv2-advanced-panel" data-disclosure>
        <i class="fas fa-filter" aria-hidden="true"></i> Gelişmiş Filtre
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

/*
 * Pencere (modal) bileşeni — tek yer, tüm pencereler (UX-03, MUS-15, UX-42):
 *  - role="dialog" + aria-modal + aria-labelledby (başlık kimliği), onay penceresi role="alertdialog"
 *  - açılışta odak ilk alana; Tab/Shift+Tab pencere içinde döner; Esc kapatır; kapanışta odak tetikleyiciye döner
 *  - açıkken uygulama kabuğu ve alttaki pencereler `inert`, sayfa kaydırması kilitli (`body.sv2-modal-open`)
 * Pencereler `<dialog>` yerine kaplama (overlay) öğesidir: sayfa kodunun bağlı olduğu `renderModal/openModal/closeModal`
 * API'si ve kalıcı (`persist`) pencere davranışı korunur; davranış yerel `<dialog>.showModal()` ile eşdeğerdir.
 */
const modalReturnFocus = new Map();

function toggleInert(el, on) {
  if (!el) return;
  if (on) el.setAttribute("inert", "");
  else el.removeAttribute("inert");
}

/** Açık pencereler, belge sırasıyla; onay penceresi her zaman en üsttedir. */
function openModals() {
  const all = [...document.querySelectorAll(".sv2-modal-overlay.is-open")];
  const confirm = all.filter((o) => o.id === "sv2-confirm-overlay");
  return [...all.filter((o) => o.id !== "sv2-confirm-overlay"), ...confirm];
}

/** Açık pencere durumuna göre arka planı kilitler/açar. */
function syncModalState() {
  const open = openModals();
  const top = open[open.length - 1] || null;
  document.body.classList.toggle("sv2-modal-open", open.length > 0);
  const appRoot = document.getElementById("sv2-app");
  toggleInert(appRoot, !!top && !appRoot.contains(top));
  document.querySelectorAll(".sv2-modal-overlay").forEach((o) => toggleInert(o, o.classList.contains("is-open") && o !== top));
}

function restoreFocusAfterClose(id) {
  const back = modalReturnFocus.get(id);
  modalReturnFocus.delete(id);
  const top = openModals().pop();
  const usable = back && back.isConnected && !back.closest("[inert]") && back.getClientRects().length > 0;
  try {
    if (usable) back.focus({ preventScroll: true });
    else if (top) focusFirstIn(top.querySelector(".sv2-modal") || top);
    else document.getElementById("sv2-main")?.focus({ preventScroll: true });
  } catch {
    /* odak geri verilemedi */
  }
}

function renderModal(id, options) {
  options = options || {};
  const root = ensureModalRoot();
  let overlay = document.getElementById(id);
  const safeId = escapeHtml(id);
  const titleId = `${safeId}-title`;
  const wasOpen = !!overlay?.classList.contains("is-open");

  const html = `
    <div class="sv2-modal-overlay${wasOpen ? " is-open" : ""}" id="${safeId}" role="dialog" aria-modal="true" aria-labelledby="${titleId}"${options.persist ? " data-persist" : ""}>
      <div class="sv2-modal" tabindex="-1">
        <div class="sv2-modal-header">
          <h2 id="${titleId}">${escapeHtml(options.title || "")}</h2>
          <button type="button" class="sv2-modal-close" data-close="${safeId}" aria-label="Kapat"><span aria-hidden="true">&times;</span></button>
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
  // `data-close` düğmeleri (üst çarpı, altbilgideki İptal/Vazgeç) pencereyi kapatır.
  overlay?.querySelectorAll(`[data-close="${CSS.escape(id)}"]`).forEach((btn) => {
    btn.addEventListener("click", () => closeModal(id));
  });

  if (options.closeOnBackdrop) {
    overlay?.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(id);
    });
  }
  if (wasOpen) syncModalState();
}

function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return false;
  if (!overlay.classList.contains("is-open")) modalReturnFocus.set(id, document.activeElement);
  overlay.classList.add("is-open");
  syncModalState();
  focusFirstIn(overlay.querySelector(".sv2-modal"), overlay.dataset.initialFocus || null);
  return true;
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove("is-open");
  overlay.removeAttribute("inert");
  syncModalState();
  restoreFocusAfterClose(id);
}

function closeTopModal() {
  const top = openModals().pop();
  if (!top) return;
  if (top.id === "sv2-confirm-overlay") closeConfirm();
  else closeModal(top.id);
}

function renderBreadcrumb(items) {
  if (!items || !items.length) return "";
  const parts = items.map((item, i) => {
    const isLast = i === items.length - 1;
    if (isLast || !item.href) {
      return `<span class="sv2-breadcrumb-current"${isLast ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</span>`;
    }
    return `<a href="${escapeHtml(item.href)}" class="sv2-breadcrumb-link">${escapeHtml(item.label)}</a>`;
  });
  return `<nav class="sv2-breadcrumb" aria-label="Sayfa yolu">${parts.join('<span class="sv2-breadcrumb-sep" aria-hidden="true">›</span>')}</nav>`;
}

/** Boş durum: başlık değil metin olarak işaretlenir (başlık hiyerarşisini bozmaz; UX-27). */
function renderEmptyState(message, icon) {
  icon = safeClass(icon) || "fa-inbox";
  return `
    <div class="sv2-empty">
      <i class="fas ${icon}" aria-hidden="true"></i>
      <p class="sv2-empty-title">${escapeHtml(message || "Kayıt bulunamadı.")}</p>
    </div>`;
}

function renderStatusBadge(status) {
  const key = String(status || "open").toLowerCase();
  // CSS sınıfları durum anahtarıyla aynı adlandırılır (sv2-badge-in_progress vb.).
  const known = ["open", "assigned", "in_progress", "waiting_customer", "pending_close", "resolved", "closed", "reopened"];
  const cls = known.includes(key) ? key : "open";
  return `<span class="sv2-badge sv2-badge-${cls}">${escapeHtml(formatStatusLabel(status))}</span>`;
}

/**
 * SLA rozeti. Açık talepte en yakın hedefi (önce ilk yanıt, sonra çözüm) gösterir;
 * kapanmış talepte hedeflerin karşılanıp karşılanmadığını özetler.
 */
function renderSlaBadge(ticket) {
  // SLA hesabı ve metinleri ticket-utils'te tek yerdedir (describeSla): pano, liste ve zil aynı sonucu görür.
  const d = describeSla(ticket);
  if (!d) return '<span class="sv2-text-muted">—</span>';
  return `<span class="sv2-sla sv2-sla--${d.cls}" title="${escapeHtml(d.title || "")}"><i class="fas ${d.icon}"></i> ${escapeHtml(d.text)}</span>`;
}

/** SEC-01: öncelik sınıf adına girer → yalnız beyaz listedeki değerler; bilinmeyen değer "medium" sınıfıyla (metin kaçışlı) çizilir. */
function renderPriorityBadge(priority) {
  const key = safeToken(priority || "medium", PRIORITY_TOKENS, "medium");
  return `<span class="sv2-priority sv2-priority-${key}">${escapeHtml(formatPriorityLabel(safeText(priority)))}</span>`;
}

function renderTypeBadge(type) {
  const key = String(type || "").toUpperCase();
  return `<span class="sv2-type-badge" data-type="${escapeHtml(key)}">${escapeHtml(key)}</span>`;
}

/**
 * Otomatik tamamlama (WAI-ARIA combobox): ↑/↓ ile gezinme, Enter ile seçim, Esc ile kapatma; Tab'da vurgulanan ya da
 * yazılanla birebir eşleşen tek öneri seçilir, böylece klavye kullanıcısı seçimsiz alanla kalmaz (UX-07).
 */
function renderAutocomplete(inputId, items, onSelect, options) {
  options = options || {};
  const input = document.getElementById(inputId);
  if (!input) return;

  const listId = `${inputId}-ac-list`;
  let listEl = document.getElementById(listId);
  if (!listEl) {
    listEl = document.createElement("div");
    listEl.id = listId;
    listEl.className = "sv2-autocomplete-list";
    listEl.setAttribute("role", "listbox");
    listEl.hidden = true;
    input.parentNode.classList.add("sv2-autocomplete-wrap");
    input.parentNode.appendChild(listEl);
  }
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-haspopup", "listbox");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("autocomplete", "off");

  const minChars = options.minChars ?? 2;
  const labelKey = options.labelKey || "label";
  const valueKey = options.valueKey || "value";
  const nameKey = options.nameKey || "name";
  let current = [];
  let activeIdx = -1;

  function setActive(idx) {
    const opts = [...listEl.querySelectorAll('[role="option"]')];
    activeIdx = opts.length ? (idx + opts.length) % opts.length : -1;
    opts.forEach((o, i) => {
      const on = i === activeIdx;
      o.classList.toggle("is-active", on);
      o.setAttribute("aria-selected", on ? "true" : "false");
      if (on) {
        input.setAttribute("aria-activedescendant", o.id);
        o.scrollIntoView?.({ block: "nearest" });
      }
    });
    if (activeIdx < 0) input.removeAttribute("aria-activedescendant");
  }

  function closeList() {
    listEl.classList.remove("is-open");
    listEl.hidden = true;
    activeIdx = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function openList() {
    listEl.hidden = false;
    listEl.classList.add("is-open");
    input.setAttribute("aria-expanded", "true");
  }

  function getItemLabel(item) {
    return String(item[labelKey] ?? item[nameKey] ?? "");
  }

  function exactMatches(term) {
    const q = normalizeSearch(term).trim();
    if (!q) return [];
    return (items || []).filter((item) => {
      const label = normalizeSearch(getItemLabel(item)).trim();
      const name = normalizeSearch(item[nameKey]).trim();
      return label === q || name === q;
    });
  }

  function hasExactMatch(term) {
    return exactMatches(term).length > 0;
  }

  function shouldOfferCreate(term) {
    if (!options.createLabel || !term) return false;
    if (options.createExactMatch !== false && hasExactMatch(term)) return false;
    return true;
  }

  // Türkçe karakter/İ-ı duyarsız ve çok sözcüklü arama (PER-19, YON-27).
  function filterItems(q) {
    const tokens = normalizeSearch(q).split(/\s+/).filter(Boolean);
    return (items || []).filter((item) => {
      const hay = `${normalizeSearch(getItemLabel(item))} ${normalizeSearch(item[nameKey])}`;
      return tokens.every((t) => hay.includes(t));
    });
  }

  function choose(opt) {
    if (!opt) return;
    if (opt.dataset.create === "1") {
      onSelect?.({ create: true, term: input.value.trim() });
    } else {
      const selected = current.find((i) => String(i[valueKey] ?? i.id) === opt.dataset.value);
      if (selected) {
        input.value = String(selected[nameKey] ?? selected[labelKey] ?? "");
        onSelect?.(selected);
      }
    }
    closeList();
  }

  function showList(filtered) {
    const term = input.value.trim();
    const offerCreate = shouldOfferCreate(term);

    if (!filtered.length && !offerCreate) {
      closeList();
      return;
    }
    current = filtered.slice(0, options.maxItems || 10);

    let html = current
      .map(
        (item, i) =>
          `<div role="option" id="${listId}-o${i}" aria-selected="false" class="sv2-ac-item" data-value="${escapeHtml(String(item[valueKey] ?? item.id ?? ""))}">${escapeHtml(getItemLabel(item))}</div>`
      )
      .join("");

    if (offerCreate) {
      const createText = options.createLabel.replace("{term}", term);
      html += `<div role="option" id="${listId}-oc" aria-selected="false" class="sv2-ac-item sv2-ac-create" data-create="1"><i class="fas fa-plus" aria-hidden="true"></i> ${escapeHtml(createText)}</div>`;
    }

    listEl.innerHTML = html;
    activeIdx = -1;
    input.removeAttribute("aria-activedescendant");
    openList();
  }

  function refreshList() {
    const q = input.value.trim();
    if (q.length < minChars) {
      closeList();
      return;
    }
    showList(filterItems(q));
  }

  // Fare: odak girişte kalır (mousedown iptal), tıklama seçer.
  listEl.addEventListener("mousedown", (e) => e.preventDefault());
  listEl.addEventListener("click", (e) => choose(e.target.closest('[role="option"]')));

  input.addEventListener("input", () => {
    options.onTyping?.();
    refreshList();
  });
  input.addEventListener("focus", refreshList);

  input.addEventListener("keydown", (e) => {
    const open = !listEl.hidden;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) refreshList();
      setActive(activeIdx + 1);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive(activeIdx - 1);
    } else if (e.key === "Enter" && open && activeIdx >= 0) {
      e.preventDefault(); // formu göndermesin
      choose(listEl.querySelectorAll('[role="option"]')[activeIdx]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault(); // pencereyi kapatmasın; yalnız liste kapanır
      closeList();
    } else if (e.key === "Tab" && open) {
      const opts = [...listEl.querySelectorAll('[role="option"]')];
      if (activeIdx >= 0) choose(opts[activeIdx]);
      else if (!options.createLabel) {
        const exact = exactMatches(input.value);
        if (exact.length === 1) {
          current = exact;
          choose(opts.find((o) => o.dataset.value === String(exact[0][valueKey] ?? exact[0].id)));
        }
      }
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(closeList, 150);
  });
}

function bindFilterChips(container, onChange) {
  const root = typeof container === "string" ? document.querySelector(container) : container;
  if (!root) return;

  root.querySelectorAll(".sv2-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const multi = root.dataset.multi === "true";
      if (!multi) {
        root.querySelectorAll(".sv2-chip").forEach((c) => {
          c.classList.remove("is-active");
          c.setAttribute("aria-pressed", "false");
        });
        chip.classList.add("is-active");
      } else {
        chip.classList.toggle("is-active");
      }
      chip.setAttribute("aria-pressed", chip.classList.contains("is-active") ? "true" : "false");
      const active = [...root.querySelectorAll(".sv2-chip.is-active")].map((c) => c.dataset.value);
      onChange?.(multi ? active : chip.dataset.value);
    });
  });
}

/** Sekmeler: role=tablist/tab, aria-selected, dolaşan tabindex ve ←/→/Home/End tuşları (UX-27). */
function renderTabs(tabs, activeId, onChange) {
  const tabId = "sv2-tabs-" + Math.random().toString(36).slice(2, 8);
  const html = `
    <div class="sv2-tabs" id="${tabId}" role="tablist">
      ${(tabs || [])
        .map(
          (t) =>
            `<button type="button" role="tab" id="${tabId}-${escapeHtml(t.id)}" class="sv2-tab${t.id === activeId ? " active" : ""}" data-tab="${escapeHtml(t.id)}" aria-selected="${t.id === activeId ? "true" : "false"}" tabindex="${t.id === activeId ? "0" : "-1"}">${escapeHtml(t.label)}</button>`
        )
        .join("")}
    </div>`;

  setTimeout(() => {
    const el = document.getElementById(tabId);
    if (!el) return;
    const all = () => [...el.querySelectorAll(".sv2-tab")];
    const select = (btn, focus) => {
      all().forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
      });
      if (focus) btn.focus();
      onChange?.(btn.dataset.tab);
    };
    all().forEach((btn) => btn.addEventListener("click", () => select(btn, false)));
    el.addEventListener("keydown", (e) => {
      const list = all();
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      let next = null;
      if (e.key === "ArrowRight") next = list[(i + 1) % list.length];
      else if (e.key === "ArrowLeft") next = list[(i - 1 + list.length) % list.length];
      else if (e.key === "Home") next = list[0];
      else if (e.key === "End") next = list[list.length - 1];
      if (next) {
        e.preventDefault();
        select(next, true);
      }
    });
  }, 0);

  return html;
}

/** Gönderen rolü → görsel ayrım: müşteri / personel (UX-41). `variant` açıkça verilmişse o kullanılır. */
const CUSTOMER_ROLES = ["customer", "arizi_customer", "company_admin"];
const STAFF_ROLES = ["super_admin", "service_admin", "project_manager", "consultant", "admin"];

function timelineVariant(item) {
  if (item.variant) return safeClass(item.variant);
  const role = String(item.author_role || "").toLowerCase();
  if (CUSTOMER_ROLES.includes(role)) return "customer";
  if (STAFF_ROLES.includes(role)) return "admin";
  return safeClass(role);
}

const VARIANT_LABELS = { customer: "Müşteri", admin: "Personel", internal: "Dahili not", system: "Sistem" };

function renderTimeline(items) {
  if (!items || !items.length) {
    return renderEmptyState("Henüz aktivite yok.", "fa-clock");
  }

  // Satır başına try/catch: bir zehirli kayıt tüm zaman çizelgesini düşürmez (SEC-02).
  const list = items
    .map((item) => {
      try {
        const variant = timelineVariant(item);
        const roleTag = VARIANT_LABELS[variant] && (item.author_role || variant === "internal")
          ? `<span class="sv2-timeline-role sv2-timeline-role--${variant}">${VARIANT_LABELS[variant]}</span>`
          : "";
        return `
      <li class="sv2-timeline-item ${variant}">
        <div class="sv2-timeline-dot" aria-hidden="true"></div>
        <div class="sv2-timeline-bubble">
          <div class="sv2-timeline-head">
            <span class="sv2-timeline-author">${escapeHtml(safeText(item.author || item.changed_by_name) || "Sistem")}${roleTag}</span>
            <span class="sv2-timeline-time">${escapeHtml(formatDateTime(safeText(item.created_at || item.changed_at)))}</span>
          </div>
          <div class="sv2-timeline-body">${escapeHtml(safeText(item.message || item.new_value || item.details))}</div>
          ${typeof item.attachments_html === "string" ? item.attachments_html : ""}
        </div>
      </li>`;
      } catch (err) {
        console.warn("[Parla V2] zaman çizelgesi kaydı atlandı", err);
        return "";
      }
    })
    .join("");

  return `<ul class="sv2-timeline">${list}</ul>`;
}

function closeConfirm() {
  if (!confirmOverlay) return;
  confirmOverlay.classList.remove("is-open");
  confirmOverlay.removeAttribute("inert");
  syncModalState();
  restoreFocusAfterClose("sv2-confirm-overlay");
}

/** Yıkıcı onay metinleri kırmızı onay düğmesiyle çizilir (UX-42): sil / kalıcı / kaldır / pasife al / arşiv. */
const DANGEROUS_CONFIRM = /silin|silme|silmek|kalıcı|kaldırıl|kaldırıp|geri alınamaz|pasife alın|arşive/i;

/**
 * Onay penceresi. `options`: { title, confirmLabel, cancelLabel, danger }.
 * Varsayılan odak "İptal"dedir; yıkıcı işlemde onay düğmesi kırmızıdır, iki düğme ayırt edilir (UX-42).
 */
function renderConfirmDialog(message, onConfirm, options) {
  options = options || {};
  const text = message || "Bu işlemi onaylıyor musunuz?";
  const danger = options.danger !== undefined ? !!options.danger : DANGEROUS_CONFIRM.test(text);
  const title = options.title || (danger ? "Silme / kaldırma onayı" : "Onay");

  if (!confirmOverlay || !document.body.contains(confirmOverlay)) {
    confirmOverlay = document.createElement("div");
    confirmOverlay.id = "sv2-confirm-overlay";
    confirmOverlay.className = "sv2-modal-overlay";
    confirmOverlay.setAttribute("role", "alertdialog");
    confirmOverlay.setAttribute("aria-modal", "true");
    confirmOverlay.setAttribute("aria-labelledby", "sv2-confirm-title");
    confirmOverlay.setAttribute("aria-describedby", "sv2-confirm-message");
    document.body.appendChild(confirmOverlay);
  }

  confirmOverlay.innerHTML = `
    <div class="sv2-modal sv2-confirm-modal" tabindex="-1">
      <div class="sv2-modal-header"><h2 id="sv2-confirm-title">${escapeHtml(title)}</h2></div>
      <div class="sv2-modal-body">
        <p id="sv2-confirm-message">${escapeHtml(text)}</p>
      </div>
      <div class="sv2-modal-footer">
        <button type="button" class="sv2-btn sv2-btn-secondary" id="sv2-confirm-cancel">${escapeHtml(options.cancelLabel || "İptal")}</button>
        <button type="button" class="sv2-btn ${danger ? "sv2-btn-danger" : "sv2-btn-primary"}" id="sv2-confirm-ok">${escapeHtml(options.confirmLabel || "Onayla")}</button>
      </div>
    </div>`;

  if (!confirmOverlay.classList.contains("is-open")) modalReturnFocus.set("sv2-confirm-overlay", document.activeElement);
  confirmOverlay.classList.add("is-open");
  syncModalState();
  document.getElementById("sv2-confirm-cancel")?.focus({ preventScroll: true });

  document.getElementById("sv2-confirm-cancel")?.addEventListener("click", closeConfirm, { once: true });
  document.getElementById("sv2-confirm-ok")?.addEventListener(
    "click",
    () => {
      closeConfirm();
      onConfirm?.();
    },
    { once: true }
  );
}

/**
 * Hata iletisi (toast). SDK/geliştirici iletileri son kullanıcıya gösterilmez; yetki hatası
 * "Firebase Console → Rules" gibi bir yönlendirme içermez (SEC-32, UX-15, MUS-08, YON-25, PER-29).
 * Ayrıntı yalnız tarayıcı konsoluna yazılır.
 */
function handleError(error, context) {
  console.error("[Parla V2]", context || "Hata", error);
  // Çağıran zaten yönlendirme/hata ekranı gösterdiyse (requireAuth) ikinci bir ileti üretme.
  if (error && error.handled) return error.message || "";

  const { message: base } = classifyError(error);
  const message = context ? `${context}: ${base}` : base;
  toast(message, "error");
  showBlankScreenFallback(error);
  return message;
}

/**
 * Okuma/yükleme hatası: toast + sayfa içinde kalıcı "Yeniden dene" kartı. Kabuk henüz çizilmemişse
 * (boş beyaz ekran) kabuğu hata durumuyla birlikte çizer (UX-02, MUS-06, PER-35, YON-30).
 *
 * @param {Error} error
 * @param {string} [context] örn. "Talepler yüklenemedi"
 * @param {{ retry?: Function, title?: string, activePage?: string, pageTitle?: string, isAdmin?: boolean }} [options]
 */
function handleLoadError(error, context, options) {
  options = options || {};
  console.error("[Parla V2]", context || "Yükleme hatası", error);
  if (error && error.handled) return "";
  const { kind, message } = classifyError(error);
  const title = options.title || context || "Veriler yüklenemedi";
  const app = document.getElementById("sv2-app");
  const retryFn = options.retry || (() => window.location.reload());
  // Yeniden dene: eski hata kartı kalkar; işlem yine başarısız olursa çağrılan işlev kartı yeniden çizer.
  const retry = async () => {
    document.getElementById("sv2-load-error")?.remove();
    await retryFn();
  };
  const cardOptions = { title, message, onRetry: retry, icon: kind === "network" ? "fa-wifi" : kind === "permission" ? "fa-lock" : undefined };

  let content = document.querySelector("#sv2-app .sv2-content");
  if (!content && app) {
    // Kabuk yok: oturum biliniyorsa menüyle birlikte çiz, bilinmiyorsa tam sayfa kart göster.
    const session = getLastSession();
    if (session) {
      renderShell(app, {
        title: options.pageTitle || "",
        activePage: options.activePage,
        profile: session,
        isAdmin: options.isAdmin !== undefined ? options.isAdmin : isAdminRole(session.role),
        content: "<div id=\"sv2-load-error\"></div>",
      });
      content = document.querySelector("#sv2-app .sv2-content");
    }
  }
  if (content) {
    let holder = document.getElementById("sv2-load-error");
    if (!holder) {
      holder = document.createElement("div");
      holder.id = "sv2-load-error";
      content.prepend(holder);
    }
    renderErrorState(holder, cardOptions);
    holder.scrollIntoView?.({ block: "nearest" });
  } else if (app) {
    app.innerHTML = '<div class="sv2-fatal-wrap"></div>';
    renderErrorState(app.firstElementChild, cardOptions);
  }
  toast(`${context ? context + ": " : ""}${message}`, "error");
  return message;
}

/** Sayfada hiçbir şey çizilmemişse (kabuk yok, içerik boş) menü + hata kartı göster — güvenlik ağı. */
function showBlankScreenFallback(error) {
  try {
    const app = document.getElementById("sv2-app");
    if (!app || app.innerHTML.trim() !== "") return;
    const session = getLastSession();
    if (!session) return;
    handleLoadError(error, "Sayfa yüklenemedi");
  } catch {
    /* güvenlik ağı hata vermemeli */
  }
}

function linkTicket(id, number) {
  const num = number || id;
  return `<a href="${PATHS.adminTicketDetail}?id=${encodeURIComponent(id)}" class="sv2-link">${escapeHtml(num)}</a>`;
}

/** Kullanıcı bağlantısı yalnız kullanıcı listesini okuyabilen rollerde (super/service admin) bağlantıdır (PER-29). */
function canOpenUserPages() {
  const role = String((currentProfile || getLastSession())?.role || "").toLowerCase();
  return (PAGE_ROLES.adminUsers || []).includes(role);
}

function linkUser(uid, name) {
  const label = escapeHtml(safeText(name) || safeText(uid));
  if (!uid || !canOpenUserPages()) return `<span>${label}</span>`;
  return `<a href="${PATHS.adminUserDetail}?uid=${encodeURIComponent(uid)}" class="sv2-link">${label}</a>`;
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
  renderSlaBadge,
  renderTypeBadge,
  renderAutocomplete,
  bindFilterChips,
  renderTabs,
  renderTimeline,
  debounce,
  bindSearchInput,
  renderConfirmDialog,
  handleError,
  handleLoadError,
  renderErrorState,
  errorStateHtml,
  loadingStateHtml,
  withInflight,
  withTimeout,
  isPermissionError,
  ensureModalRoot,
  linkTicket,
  linkUser,
  linkCompany,
  linkPersonnel,
  linkProject,
  formatDate,
  formatDateTime,
  formatTicketTypeLabel,
};
