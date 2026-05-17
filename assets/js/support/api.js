/**
 * SAP Destek — Google Apps Script API istemcisi
 */
var ParlaSupportApi = (function () {
  function getUrl() {
    var cfg = window.__PARLA_SUPPORT;
    return cfg && cfg.API_URL ? cfg.API_URL : "";
  }

  /**
   * GAS web app yanıtını parse eder (redirect sonrası JSON)
   */
  function parseResponse(text) {
    if (!text) return { success: false, message: "Boş yanıt", data: null };
    try {
      return JSON.parse(text);
    } catch (e) {
      var match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {
          /* ignore */
        }
      }
    }
    return { success: false, message: "Sunucu yanıtı işlenemedi.", data: null };
  }

  function request(type, payload) {
    var url = getUrl();
    if (!url) {
      return Promise.reject(new Error("API URL tanımlı değil. site-config.js kontrol edin."));
    }

    var body = Object.assign({ type: type }, payload || {});

    return fetch(url, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        return res.text();
      })
      .then(parseResponse)
      .then(function (json) {
        if (!json || json.success === undefined) {
          return { success: false, message: json.message || "Beklenmeyen yanıt", data: json.data || null };
        }
        return json;
      });
  }

  return {
    register: function (data) {
      return request("support_register", data);
    },
    login: function (email, password) {
      return request("support_login", { email: email, password: password });
    },
    logout: function (token) {
      return request("support_logout", { token: token });
    },
    verifySession: function (token) {
      return request("support_verify_session", { token: token });
    },
    createTicket: function (token, data) {
      return request("support_create_ticket", Object.assign({ token: token }, data));
    },
    getTickets: function (token) {
      return request("support_get_tickets", { token: token });
    },
    getTicket: function (token, ticketId) {
      return request("support_get_ticket", { token: token, ticket_id: ticketId });
    },
    updateTicket: function (token, data) {
      return request("support_update_ticket", Object.assign({ token: token }, data));
    },
    addMessage: function (token, ticketId, message, isInternal) {
      return request("support_add_message", {
        token: token,
        ticket_id: ticketId,
        message: message,
        is_internal: !!isInternal
      });
    },
    adminStats: function (token) {
      return request("support_admin_stats", { token: token });
    }
  };
})();
