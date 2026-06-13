/**
 * SAP Destek — kayıt sayfası
 */
document.addEventListener("DOMContentLoaded", function () {
  var form = document.getElementById("sp-register-form");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    ParlaSupportUI.clearFormErrors(form);

    var fields = {
      first_name: document.getElementById("sp-first-name"),
      last_name: document.getElementById("sp-last-name"),
      company: document.getElementById("sp-company"),
      phone: document.getElementById("sp-phone"),
      email: document.getElementById("sp-email"),
      password: document.getElementById("sp-password"),
      password_confirm: document.getElementById("sp-password-confirm")
    };

    var valid = true;
    if (!ParlaSupportValidators.required(fields.first_name.value)) {
      ParlaSupportUI.setFieldError(fields.first_name, "Ad zorunludur.");
      valid = false;
    }
    if (!ParlaSupportValidators.required(fields.last_name.value)) {
      ParlaSupportUI.setFieldError(fields.last_name, "Soyad zorunludur.");
      valid = false;
    }
    if (!ParlaSupportValidators.required(fields.company.value)) {
      ParlaSupportUI.setFieldError(fields.company, "Firma adı zorunludur.");
      valid = false;
    }
    if (!ParlaSupportValidators.phone(fields.phone.value)) {
      ParlaSupportUI.setFieldError(fields.phone, "Geçerli telefon numarası girin.");
      valid = false;
    }
    if (!ParlaSupportValidators.email(fields.email.value)) {
      ParlaSupportUI.setFieldError(fields.email, "Geçerli iş e-postası girin.");
      valid = false;
    }
    if (!ParlaSupportValidators.password(fields.password.value)) {
      ParlaSupportUI.setFieldError(
        fields.password,
        "Şifre en az " + ((window.__PARLA_SUPPORT && window.__PARLA_SUPPORT.MIN_PASSWORD) || 8) + " karakter olmalı."
      );
      valid = false;
    }
    if (fields.password.value !== fields.password_confirm.value) {
      ParlaSupportUI.setFieldError(fields.password_confirm, "Şifreler eşleşmiyor.");
      valid = false;
    }
    if (!valid) return;

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    ParlaSupportUI.showLoading(true);

    ParlaSupportApi.register({
      first_name: fields.first_name.value.trim(),
      last_name: fields.last_name.value.trim(),
      company: fields.company.value.trim(),
      phone: fields.phone.value.trim(),
      email: fields.email.value.trim(),
      password: fields.password.value
    })
      .then(function (res) {
        if (!res.success) {
          ParlaSupportUI.toast(res.message || "Kayıt başarısız.", "error");
          return;
        }
        ParlaSupportUI.toast("Kayıt tamamlandı. Giriş yapabilirsiniz.", "success");
        setTimeout(function () {
          window.location.href = "/support-v2/login.html";
        }, 1200);
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
