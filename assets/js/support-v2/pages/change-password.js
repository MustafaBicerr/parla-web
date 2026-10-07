/**
 * Parla BT Ticket V2 — şifre değiştirme.
 * Geçici şifreyle oluşturulan hesaplar (must_change_password) buraya yönlendirilir;
 * oturum açmış herkes kenar çubuğundan da ulaşabilir.
 */
import { requireAuth, changePassword, redirectByRole } from "../auth-guard.js";
import { renderShell, showLoading, toast, withInflight } from "../ui-shell.js";
import { isAdminRole } from "../ticket-utils.js";
import { password as passwordPolicyOk } from "../validators.js";

const MIN_PASSWORD_LENGTH = 8;
let session = null;

function render() {
  const forced = session.must_change_password === true;
  const content = `
    <div class="sv2-section" style="max-width:520px">
      <div class="sv2-section-header"><h3>${forced ? "Şifrenizi belirleyin" : "Şifre Değiştir"}</h3></div>
      <div class="sv2-section-body">
        ${
          forced
            ? `<p class="sv2-subtitle">Hesabınız geçici bir şifreyle oluşturuldu. Devam etmeden önce kendi şifrenizi belirlemeniz gerekiyor.</p>`
            : ""
        }
        <form id="sv2-change-password-form" novalidate>
          <div class="sv2-form-group">
            <label for="sv2-cp-current">${forced ? "Geçici şifre" : "Mevcut şifre"}</label>
            <input type="password" id="sv2-cp-current" autocomplete="current-password" required>
          </div>
          <div class="sv2-form-group">
            <label for="sv2-cp-new">Yeni şifre</label>
            <input type="password" id="sv2-cp-new" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
            <small class="sv2-text-muted">En az ${MIN_PASSWORD_LENGTH} karakter; en az bir büyük harf ve bir rakam.</small>
          </div>
          <div class="sv2-form-group">
            <label for="sv2-cp-new2">Yeni şifre (tekrar)</label>
            <input type="password" id="sv2-cp-new2" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
          </div>
          <div class="sv2-field-error" id="sv2-cp-error" role="alert" hidden></div>
          <button type="submit" class="sv2-btn sv2-btn-primary" id="sv2-cp-submit">
            <i class="fas fa-key"></i> Şifreyi Güncelle
          </button>
        </form>
      </div>
    </div>`;

  renderShell("#sv2-app", {
    title: "Şifre Değiştir",
    activePage: "password",
    profile: session,
    isAdmin: isAdminRole(session.role),
    content,
  });

  const form = document.getElementById("sv2-change-password-form");
  const errEl = document.getElementById("sv2-cp-error");
  // Genel hata alanı formun sonunda; hatayla ilgili alan işaretlenir ve odak ona taşınır (UX-26, MUS-23).
  const fields = ["sv2-cp-current", "sv2-cp-new", "sv2-cp-new2"].map((id) => document.getElementById(id));
  const showError = (msg, field) => {
    errEl.textContent = msg;
    errEl.hidden = !msg;
    fields.forEach((f) => {
      f.removeAttribute("aria-invalid");
      f.removeAttribute("aria-describedby");
    });
    if (msg && field) {
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", "sv2-cp-error");
      field.focus();
    }
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const current = document.getElementById("sv2-cp-current").value;
    const next = document.getElementById("sv2-cp-new").value;
    const next2 = document.getElementById("sv2-cp-new2").value;

    const [curEl, newEl, new2El] = fields;
    if (!current) return showError("Mevcut şifrenizi girin.", curEl);
    if (!passwordPolicyOk(next)) return showError(`Yeni şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı; en az bir büyük harf ve bir rakam içermelidir.`, newEl);
    if (next === current) return showError("Yeni şifre mevcut şifreden farklı olmalıdır.", newEl);
    if (next !== next2) return showError("Yeni şifreler eşleşmiyor.", new2El);

    const btn = document.getElementById("sv2-cp-submit");
    await withInflight(btn, async () => {
      showLoading(true);
      try {
        await changePassword(current, next);
        toast("Şifreniz güncellendi.", "success");
        // Zorunlu değişimden sonra giriş öncesi hedefe (`?next=`) dönülür.
        redirectByRole({ ...session, must_change_password: false });
      } catch (err) {
        showError(err.message || "Şifre güncellenemedi.", /mevcut|hatalı/i.test(err.message || "") ? curEl : null);
      } finally {
        showLoading(false);
      }
    });
  });
}

async function init() {
  try {
    session = await requireAuth({ allowPasswordChange: true });
    render();
  } catch {
    /* requireAuth oturum yoksa girişe yönlendirir */
  }
}

init();
