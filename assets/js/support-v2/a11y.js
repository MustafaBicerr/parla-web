/**
 * Parla BT Ticket V2 — erişilebilirlik tamamlayıcıları (WP-12).
 *
 *  - focusableIn / trapTab: modal, onay ve mobil çekmece için ortak odak yönetimi.
 *  - installA11yEnhancer: sayfa kodundan bağımsız, DOM'a eklenen öğeleri tamamlar. Böylece her sayfada
 *    elle yinelenmesi gereken (ve unutulan) nitelikler tek yerde güvence altına alınır:
 *      · form hataları  → role="alert", aria-invalid, aria-describedby; gönderim sonrası ilk hataya odak (UX-26)
 *      · aç/kapa anahtarları, onay kutuları, aramalar, `for`'suz etiketler → erişilebilir ad (UX-21)
 *      · kaydırılabilir tablo bölgeleri → klavyeyle odaklanır, ad taşır (UX-45)
 *      · <th scope>, bölüm başlıklarının düzeyi, dekoratif simgelerde aria-hidden (UX-27)
 *
 * Yalnız tarayıcıda çalışır; birim testlerinde (Node) içe aktarmak güvenlidir.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Kapsayıcı içindeki, görünür ve odaklanabilir öğeler (belge sırasıyla). */
export function focusableIn(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (el.closest("[inert]") && !container.hasAttribute("inert")) return false;
    if (el.hidden || el.closest("[hidden]")) return false;
    return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  });
}

/**
 * Tab / Shift+Tab'ı `container` içinde döndürür. Olay işlendiyse true döner.
 * Odak kapsayıcının dışındaysa ilk (Shift ile son) öğeye alınır.
 */
export function trapTab(container, e) {
  const items = focusableIn(container);
  if (!items.length) {
    e.preventDefault();
    container.focus?.();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!container.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return true;
  }
  if (e.shiftKey && (active === first || active === container)) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/** İlk anlamlı öğeye odak (ilk alan; yoksa kaçış düğmesi dışındaki ilk düğme; yoksa kapsayıcı). */
export function focusFirstIn(container, preferSelector) {
  if (!container) return;
  const preferred = preferSelector ? container.querySelector(preferSelector) : null;
  const items = focusableIn(container);
  const target =
    preferred ||
    items.find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) ||
    items.find((el) => !el.classList.contains("sv2-modal-close") && !el.classList.contains("sv2-sidebar-close")) ||
    items[0] ||
    container;
  try {
    target.focus({ preventScroll: true });
  } catch {
    /* odaklanamadı */
  }
}

// ─── Form hataları ────────────────────────────────────────────────────────────────────────────────────

const ERROR_SEL = ".sv2-field-error, .sv2-form-error";
const shown = new WeakSet();
let lastSubmitAt = 0;
let idSeq = 0;

function ensureId(el, prefix) {
  if (!el.id) el.id = `${prefix}-${++idSeq}`;
  return el.id;
}

function isShown(err) {
  return !err.hidden && !err.closest("[hidden]") && err.textContent.trim() !== "";
}

function controlFor(err) {
  const group = err.closest(".sv2-form-group, .sv2-file-picker, .sv2-assign-group") || err.parentElement;
  if (!group) return null;
  const list = [...group.querySelectorAll("input:not([type=hidden]):not([hidden]), select, textarea")].filter((c) => !c.disabled);
  return list[0] || null;
}

function tokens(el, attr) {
  return (el.getAttribute(attr) || "").split(/\s+/).filter(Boolean);
}

function syncFieldErrors() {
  const fresh = [];
  document.querySelectorAll(ERROR_SEL).forEach((err) => {
    const ctrl = controlFor(err);
    if (isShown(err)) {
      if (!err.hasAttribute("role")) err.setAttribute("role", "alert");
      const id = ensureId(err, "sv2-err");
      if (ctrl) {
        ctrl.setAttribute("aria-invalid", "true");
        const t = tokens(ctrl, "aria-describedby");
        if (!t.includes(id)) ctrl.setAttribute("aria-describedby", [...t, id].join(" "));
      }
      if (!shown.has(err)) {
        shown.add(err);
        fresh.push({ err, ctrl });
      }
    } else if (shown.has(err) || (ctrl && err.id && tokens(ctrl, "aria-describedby").includes(err.id))) {
      shown.delete(err);
      if (ctrl && err.id) {
        const t = tokens(ctrl, "aria-describedby").filter((x) => x !== err.id);
        if (t.length) ctrl.setAttribute("aria-describedby", t.join(" "));
        else ctrl.removeAttribute("aria-describedby");
        const stillInvalid = t.some((x) => {
          const other = document.getElementById(x);
          return other && other.matches(ERROR_SEL) && isShown(other);
        });
        if (!stillInvalid) ctrl.removeAttribute("aria-invalid");
      }
    }
  });

  // Kullanıcı az önce gönderdiyse odak ilk hatalı alana taşınır (okuyucu "Kaydet'e bastım, ne oldu?" demesin).
  if (fresh.length && Date.now() - lastSubmitAt < 5000) {
    const target = fresh.find((f) => f.ctrl && f.ctrl.getClientRects().length > 0 && !f.ctrl.closest("[inert]"));
    if (target && document.activeElement !== target.ctrl) {
      try {
        target.ctrl.focus();
      } catch {
        /* odaklanamadı */
      }
    }
  }
}

// ─── Ad / etiket tamamlayıcıları ──────────────────────────────────────────────────────────────────────

function hasAccessibleName(el) {
  if ((el.getAttribute("aria-label") || "").trim() || el.getAttribute("aria-labelledby")) return true;
  const labels = el.labels ? [...el.labels] : [];
  return labels.some((l) => l.textContent.trim() !== "");
}

function rowLabel(el) {
  const row = el.closest("tr");
  const cell = row && row.querySelector("td");
  return cell ? cell.textContent.replace(/\s+/g, " ").trim() : "";
}

function sectionLabel(el) {
  const section = el.closest(".sv2-section, .sv2-report-card, .sv2-modal");
  const head = section && section.querySelector("h2, h3, h4");
  return head ? head.textContent.replace(/\s+/g, " ").trim() : "";
}

function enhance(root) {
  if (!root || root.nodeType !== 1) return;
  const q = (sel) => (root.matches?.(sel) ? [root, ...root.querySelectorAll(sel)] : [...root.querySelectorAll(sel)]);

  q("i.fas:not([aria-hidden]), i.fa:not([aria-hidden])").forEach((i) => i.setAttribute("aria-hidden", "true"));
  q("th:not([scope])").forEach((th) => th.setAttribute("scope", "col"));

  // Başlık düzeyi: sayfa başlığı h1, bölümler h2 (h3 etiketi taşısa da).
  q(".sv2-section-header > h3, .sv2-report-card-header > h4").forEach((h) => {
    if (!h.hasAttribute("aria-level")) h.setAttribute("aria-level", "2");
  });

  // Grafikler: görsel olarak çizilen değerler okuyucuya tek özet olarak verilir (UX-13).
  q(".sv2-bar-chart:not([role])").forEach((c) => {
    const parts = [...c.querySelectorAll(".sv2-bar")].map(
      (b) => `${b.querySelector(".sv2-bar-label")?.textContent.trim() || ""}: ${b.querySelector(".sv2-bar-value")?.textContent.trim() || ""}`
    );
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", `Çubuk grafik. ${parts.join(", ")}`);
  });
  q(".sv2-pie-chart:not([role])").forEach((c) => {
    const legend = c.parentElement?.querySelector(".sv2-pie-legend");
    c.setAttribute("role", "img");
    c.setAttribute("aria-label", `Dağılım grafiği. ${legend ? legend.textContent.replace(/\s+/g, " ").trim() : ""}`);
  });

  q(".sv2-table-wrap:not([tabindex])").forEach((w) => {
    w.setAttribute("tabindex", "0");
    w.setAttribute("role", "region");
    w.setAttribute("aria-label", `${sectionLabel(w) || "Liste"} tablosu (kaydırılabilir)`);
  });
  q(".sv2-notif-panel-body:not([tabindex]), .sv2-assign-list:not([tabindex])").forEach((w) => {
    w.setAttribute("tabindex", "0");
    w.setAttribute("role", "region");
    w.setAttribute("aria-label", w.classList.contains("sv2-assign-list") ? "Danışman listesi" : "Bildirim listesi");
  });

  // `for`'suz etiketler: aynı gruptaki ilk alana bağlanır (düzenleme pencereleri).
  q(".sv2-form-group > label:not([for])").forEach((label) => {
    if (label.querySelector("input, select, textarea")) return;
    const group = label.parentElement;
    const controls = [...group.querySelectorAll("input:not([type=hidden]), select, textarea")];
    if (controls.length === 1) label.setAttribute("for", ensureId(controls[0], "sv2-f"));
    else if (controls.length > 1 && !group.hasAttribute("role")) {
      // Birden çok alan (ör. danışman atama listesi): etiket tek bir alana değil, gruba bağlanır.
      group.setAttribute("role", "group");
      group.setAttribute("aria-labelledby", ensureId(label, "sv2-gl"));
    }
  });

  q("input:not([type=hidden]), select, textarea").forEach((el) => {
    if (hasAccessibleName(el)) return;
    if (el.closest(".sv2-switch")) {
      const name = rowLabel(el);
      el.setAttribute("aria-label", name ? `Aktif: ${name}` : (el.closest("[title]")?.getAttribute("title") || "Aktif"));
    } else if (el.type === "checkbox" || el.type === "radio") {
      const name = rowLabel(el);
      const base = el.getAttribute("title") || "Seç";
      el.setAttribute("aria-label", name ? `${base}: ${name}` : base);
    } else {
      const name = el.getAttribute("placeholder") || el.getAttribute("title"); // yalnız okunur metinler; teknik `name` kullanılmaz
      if (name) el.setAttribute("aria-label", name.replace(/[….]+$/, ""));
    }
  });
}

let installed = false;

/** Belge düzeyinde bir kez kurulur (ui-shell içe aktarıldığında). */
export function installA11yEnhancer() {
  if (installed || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  installed = true;

  const pending = new Set();
  let scheduled = false;
  let errorsDirty = false;
  const flush = () => {
    scheduled = false;
    pending.forEach((n) => n.isConnected && enhance(n));
    pending.clear();
    if (errorsDirty) {
      errorsDirty = false;
      syncFieldErrors();
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(flush, 0);
  };
  const touchesError = (n) => n.nodeType === 1 && (n.matches?.(ERROR_SEL) || n.closest?.(ERROR_SEL) || n.querySelector?.(ERROR_SEL));

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "childList") {
        r.addedNodes.forEach((n) => {
          if (n.nodeType === 1) {
            pending.add(n);
            if (touchesError(n)) errorsDirty = true;
          }
        });
        if (touchesError(r.target)) errorsDirty = true;
      } else if (r.type === "attributes" && touchesError(r.target)) {
        errorsDirty = true;
      }
    }
    schedule();
  });
  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    pending.add(document.body);
    schedule();
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });

  // Aç/kapa düğmeleri (`data-disclosure`): bağlı `hidden` bölümün durumu `aria-expanded`'a yansıtılır (sayfa kodu değişmez).
  document.addEventListener("click", (e) => {
    const t = e.target.closest?.("[data-disclosure][aria-controls]");
    const panel = t && document.getElementById(t.getAttribute("aria-controls"));
    if (panel) t.setAttribute("aria-expanded", String(!panel.hidden));
  });

  // Gönderim girişimi: Enter ile form gönderme ve gönder/kaydet düğmesi tıklaması.
  document.addEventListener("submit", () => (lastSubmitAt = Date.now()), true);
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest?.("button, input[type=submit]");
      if (btn && !btn.classList.contains("sv2-modal-close") && !btn.disabled) lastSubmitAt = Date.now();
    },
    true
  );
}
