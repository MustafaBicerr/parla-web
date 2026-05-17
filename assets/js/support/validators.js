/**
 * SAP Destek — form doğrulama
 */
var ParlaSupportValidators = {
  email: function (value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  },

  phone: function (value) {
    var v = String(value || "").replace(/\s/g, "");
    return v.length >= 10 && /^[\d+()-]+$/.test(v);
  },

  password: function (value) {
    var min = (window.__PARLA_SUPPORT && window.__PARLA_SUPPORT.MIN_PASSWORD) || 8;
    return String(value || "").length >= min;
  },

  required: function (value) {
    return String(value || "").trim().length > 0;
  }
};
