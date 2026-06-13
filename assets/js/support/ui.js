/**
 * SAP Destek — UI yardımcıları (toast, loading, badge, tarih)
 */
var ParlaSupportUI = (function () {
  var toastContainer = null;
  var loadingEl = null;

  function ensureToastContainer() {
    if (!document.getElementById("sp-toast-container")) {
      toastContainer = document.createElement("div");
      toastContainer.id = "sp-toast-container";
      toastContainer.className = "sp-toast-container";
      document.body.appendChild(toastContainer);
    } else {
      toastContainer = document.getElementById("sp-toast-container");
    }
    return toastContainer;
  }

  function toast(message, type) {
    type = type || "info";
    var container = ensureToastContainer();
    var el = document.createElement("div");
    el.className = "sp-toast sp-toast-" + type;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 4500);
  }

  function showLoading(show) {
    if (!loadingEl) {
      loadingEl = document.createElement("div");
      loadingEl.className = "sp-loading-overlay";
      loadingEl.innerHTML = '<div class="sp-spinner"></div>';
      document.body.appendChild(loadingEl);
    }
    if (show) loadingEl.classList.add("is-visible");
    else loadingEl.classList.remove("is-visible");
  }

  function statusBadge(status) {
    var raw = String(status || "OPEN").toUpperCase();
    var clsMap = {
      OPEN: "open",
      "IN PROGRESS": "in-progress",
      "WAITING CUSTOMER": "waiting",
      RESOLVED: "resolved",
      CLOSED: "closed"
    };
    var cls = clsMap[raw] || "open";
    return '<span class="sp-badge sp-badge-' + cls + '">' + escapeHtml(status || "OPEN") + "</span>";
  }

  function priorityClass(priority) {
    return "sp-priority-" + String(priority || "medium").toLowerCase();
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(value) {
    if (!value) return "—";
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function setFieldError(inputEl, message) {
    var group = inputEl.closest(".sp-form-group");
    if (!group) return;
    group.classList.add("has-error");
    var err = group.querySelector(".sp-field-error");
    if (!err) {
      err = document.createElement("div");
      err.className = "sp-field-error";
      group.appendChild(err);
    }
    err.textContent = message || "";
  }

  function clearFormErrors(form) {
    form.querySelectorAll(".sp-form-group").forEach(function (g) {
      g.classList.remove("has-error");
      var e = g.querySelector(".sp-field-error");
      if (e) e.textContent = "";
    });
  }

  function renderPortalHeader(user, options) {
    options = options || {};
    var name = user ? user.first_name + " " + user.last_name : "";
    var roleLabel =
      user && String(user.role).toLowerCase() === "admin" ? "Admin" : "Müşteri";
    var panelHref = ParlaSupportAuth.isAdmin()
      ? "/support-v2/admin/dashboard.html"
      : "/support-v2/customer/dashboard.html";
    return (
      '<header class="sp-portal-header">' +
      '<a href="/index.html" class="sp-logo-link">' +
      '<img src="/assets/img/parla-logo/parla-logo.png" alt="Parla SAP" class="sp-site-logo">' +
      '</a>' +
      '<nav class="sp-portal-nav">' +
      (options.showDashboard
        ? '<a href="' + panelHref + '"><i class="fas fa-th-large"></i> Panel</a>'
        : "") +
      '<span class="sp-user-badge">' +
      escapeHtml(name) +
      " · " +
      roleLabel +
      "</span>" +
      '<button type="button" id="sp-logout-btn"><i class="fas fa-sign-out-alt"></i> Çıkış</button>' +
      "</nav></header>"
    );
  }

  function bindLogout() {
    var btn = document.getElementById("sp-logout-btn");
    if (btn) {
      btn.addEventListener("click", function () {
        ParlaSupportAuth.logout();
      });
    }
  }

  return {
    toast: toast,
    showLoading: showLoading,
    statusBadge: statusBadge,
    priorityClass: priorityClass,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    setFieldError: setFieldError,
    clearFormErrors: clearFormErrors,
    renderPortalHeader: renderPortalHeader,
    bindLogout: bindLogout
  };
})();
