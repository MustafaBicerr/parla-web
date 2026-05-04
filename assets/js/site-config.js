/**
 * Merkezi site ayarları (Google Apps Script endpoint, iletişim numaraları).
 * Sayfalarda main.js ve chatbot.js’den ÖNCE yüklenmelidir.
 */
(function () {
  window.__PARLA_SITE_CONFIG = {
    GOOGLE_SCRIPT_URL:
      "https://script.google.com/macros/s/AKfycbwELTQlSAyXUNdOEgG8jU-dsu8mTMeWs-sUXnoWhQQGfKlbYw94vRC1uT5kPjJkzlzy/exec",
    /** WhatsApp wa.me için ülke kodu ile, başında + olmadan */
    PHONE_WHATSAPP_DIGITS: "905302267798",
    /** tel: ve schema.org uyumlu */
    PHONE_TEL_HREF: "+905302267798",
    CONTACT_EMAIL: "info@parlabilgiteknolojileri.net",
  };
})();
