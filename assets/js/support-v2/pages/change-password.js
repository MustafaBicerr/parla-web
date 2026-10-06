/**
 * Parla BT Ticket V2 — şifre değiştirme.
 * Geçici şifreyle oluşturulan hesaplar (must_change_password) buraya yönlendirilir;
 * oturum açmış herkes kenar çubuğundan da ulaşabilir.
 */
import { requireAuth, changePassword, redirectByRole } from "../auth-guard.js";
import { renderShell, showLoading, toast } from "../ui-shell.js";
import { isAdminRole } from "../ticket-utils.js";

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
          </div>
          <div class="sv2-form-group">
            <label for="sv2-cp-new2">Yeni şifre (tekrar)</label>
            <input type="password" id="sv2-cp-new2" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
            <span class="sv2-field-error" id="sv2-cp-error" hidden></span>
          </div>
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
  const showError = (msg) => {
    errEl.textContent = msg;
    errEl.hidden = !msg;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const current = document.getElementById("sv2-cp-current").value;
    const next = document.getElementById("sv2-cp-new").value;
    const next2 = document.getElementById("sv2-cp-new2").value;

    if (!current) return showError("Mevcut şifrenizi girin.");
    if (next.length < MIN_PASSWORD_LENGTH) return showError(`Yeni şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalıdır.`);
    if (next === current) return showError("Yeni şifre mevcut şifreden farklı olmalıdır.");
    if (next !== next2) return showError("Yeni şifreler eşleşmiyor.");

    const btn = document.getElementById("sv2-cp-submit");
    btn.disabled = true;
    showLoading(true);
    try {
      await changePassword(current, next);
      toast("Şifreniz güncellendi.", "success");
      redirectByRole(session);
    } catch (err) {
      showError(err.message || "Şifre güncellenemedi.");
      btn.disabled = false;
    } finally {
      showLoading(false);
    }
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
