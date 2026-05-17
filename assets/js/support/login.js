/**
 * SAP Destek — giriş sayfası
 */
document.addEventListener("DOMContentLoaded", function () {
  var form = document.getElementById("sp-login-form");
  if (!form) return;

  var session = ParlaSupportAuth.getSession();
  if (session && session.token) {
    ParlaSupportApi.verifySession(session.token).then(function (res) {
      if (res.success) ParlaSupportAuth.redirectByRole();
    });
    return;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    ParlaSupportUI.clearFormErrors(form);

    var email = document.getElementById("sp-email").value.trim();
    var password = document.getElementById("sp-password").value;
    var valid = true;

    if (!ParlaSupportValidators.email(email)) {
      ParlaSupportUI.setFieldError(document.getElementById("sp-email"), "Geçerli e-posta girin.");
      valid = false;
    }
    if (!password) {
      ParlaSupportUI.setFieldError(document.getElementById("sp-password"), "Şifre gereklidir.");
      valid = false;
    }
    if (!valid) return;

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    ParlaSupportUI.showLoading(true);

    ParlaSupportApi.login(email, password)
      .then(function (res) {
        if (!res.success) {
          ParlaSupportUI.toast(res.message || "Giriş başarısız.", "error");
          return;
        }
        ParlaSupportAuth.saveLogin(res.data);
        ParlaSupportUI.toast("Hoş geldiniz!", "success");
        ParlaSupportAuth.redirectByRole();
      })
      .catch(function (err) {
        ParlaSupportUI.toast(err.message || "Bağlantı hatası.", "error");
      })
      .finally(function () {
        btn.disabled = false;
        ParlaSupportUI.showLoading(false);
      });
  });
});
