/**
 * SAP Destek — oturum yönetimi (localStorage)
 */
var ParlaSupportAuth = (function () {
  function cfg() {
    return window.__PARLA_SUPPORT || {};
  }

  function key() {
    return cfg().SESSION_KEY || "parla_support_session";
  }

  function paths() {
    return cfg().PATHS || {};
  }

  function getSession() {
    try {
      var raw = localStorage.getItem(key());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function setSession(data) {
    localStorage.setItem(key(), JSON.stringify(data));
  }

  function clearSession() {
    localStorage.removeItem(key());
  }

  function getToken() {
    var s = getSession();
    return s && s.token ? s.token : null;
  }

  function getUser() {
    var s = getSession();
    return s && s.user ? s.user : null;
  }

  function isAdmin() {
    var u = getUser();
    return u && String(u.role).toLowerCase() === "admin";
  }

  function saveLogin(responseData) {
    setSession({
      token: responseData.token,
      expires_at: responseData.expires_at,
      user: responseData.user
    });
  }

  function redirectByRole() {
    var p = paths();
    if (isAdmin()) {
      window.location.href = p.admin || "/support/admin.html";
    } else {
      window.location.href = p.dashboard || "/support/dashboard.html";
    }
  }

  /**
   * Korumalı sayfa — giriş yoksa login'e yönlendir
   * @param {string} requiredRole - 'admin' | 'customer' | null (herhangi giriş)
   */
  function requireAuth(requiredRole) {
    var session = getSession();
    if (!session || !session.token) {
      window.location.href = paths().login || "/support/login.html";
      return Promise.reject(new Error("no_session"));
    }

    return ParlaSupportApi.verifySession(session.token).then(function (res) {
      if (!res.success || !res.data || !res.data.user) {
        clearSession();
        window.location.href = paths().login || "/support/login.html";
        return Promise.reject(new Error("invalid_session"));
      }

      setSession({
        token: session.token,
        expires_at: session.expires_at,
        user: res.data.user
      });

      if (requiredRole === "admin" && String(res.data.user.role).toLowerCase() !== "admin") {
        window.location.href = paths().dashboard || "/support/dashboard.html";
        return Promise.reject(new Error("not_admin"));
      }

      if (requiredRole === "customer" && String(res.data.user.role).toLowerCase() === "admin") {
        window.location.href = paths().admin || "/support/admin.html";
        return Promise.reject(new Error("not_customer"));
      }

      return res.data.user;
    });
  }

  function logout() {
    var token = getToken();
    var done = function () {
      clearSession();
      window.location.href = paths().login || "/support/login.html";
    };
    if (token) {
      ParlaSupportApi.logout(token).finally(done);
    } else {
      done();
    }
  }

  return {
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    getToken: getToken,
    getUser: getUser,
    isAdmin: isAdmin,
    saveLogin: saveLogin,
    redirectByRole: redirectByRole,
    requireAuth: requireAuth,
    logout: logout
  };
})();
