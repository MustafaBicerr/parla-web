/**
 * SAP Destek Portalı — yapılandırma
 * site-config.js'den sonra yüklenmeli
 */
(function () {
  var base = window.__PARLA_SITE_CONFIG || {};
  window.__PARLA_SUPPORT = {
    API_URL: base.GOOGLE_SCRIPT_URL || "",
    SESSION_KEY: "parla_support_session",
    MIN_PASSWORD: 8,
    PATHS: {
      login: "/support-v2/login.html",
      register: "/support-v2/login.html",
      dashboard: "/support-v2/customer/dashboard.html",
      admin: "/support-v2/admin/dashboard.html",
      ticket: "/support-v2/customer/ticket-detail.html",
      ticketAdmin: "/support-v2/admin/ticket-detail.html",
    },
  };
})();
