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
      login: "/support/login.html",
      register: "/support/register.html",
      dashboard: "/support/dashboard.html",
      admin: "/support/admin.html",
      ticket: "/support/ticket.html"
    }
  };
})();
