/**
 * Parla BT Ticket V2 — giriş sayfası
 */
import {
  signIn,
  resetPassword,
  redirectByRole,
  getSessionUser,
} from "../auth-guard.js";
import { toast, showLoading, handleError } from "../ui-shell.js";
import { email as validateEmail } from "../validators.js";
import { isAdminRole, isCustomerRole } from "../ticket-utils.js";

const app = document.getElementById("sv2-app");

function renderLoginPage() {
  app.innerHTML = `
    <div class="sv2-auth-wrap">
      <div class="sv2-auth-brand">
        <img src="/assets/img/parla-logo/parla-logo.png" alt="Parla BT" class="sv2-auth-logo">
        <h1>Parla BT Destek Portalı</h1>
        <p>SAP destek taleplerinizi oluşturun, takip edin ve danışmanlarımızla iletişim kurun.</p>
        <ul>
          <li><i class="fas fa-ticket-alt"></i> Talep oluşturma ve takip</li>
          <li><i class="fas fa-comments"></i> Anlık mesajlaşma</li>
          <li><i class="fas fa-chart-line"></i> Durum ve öncelik yönetimi</li>
        </ul>
      </div>
      <div class="sv2-auth-panel">
        <div class="sv2-card">
          <h2>Giriş Yap</h2>
          <p class="sv2-subtitle">Hesabınıza erişmek için bilgilerinizi girin.</p>
          <form id="sv2-login-form" novalidate>
            <div class="sv2-form-group">
              <label for="sv2-email">E-posta</label>
              <input type="email" id="sv2-email" name="email" autocomplete="email" placeholder="ornek@sirket.com" required>
              <span class="sv2-field-error" id="sv2-login-err-email" hidden></span>
            </div>
            <div class="sv2-form-group">
              <label for="sv2-password">Şifre</label>
              <div class="sv2-toggle-password">
                <input type="password" id="sv2-password" name="password" autocomplete="current-password" placeholder="••••••••" required>
                <button type="button" id="sv2-toggle-password" aria-label="Şifreyi göster/gizle">
                  <i class="fas fa-eye" id="sv2-toggle-password-icon"></i>
                </button>
              </div>
              <span class="sv2-field-error" id="sv2-login-err-password" hidden></span>
            </div>
            <button type="submit" class="sv2-btn sv2-btn-primary" style="width:100%;margin-top:0.5rem" id="sv2-login-submit">
              <i class="fas fa-sign-in-alt"></i> Giriş Yap
            </button>
          </form>
          <p style="text-align:center;margin:1.25rem 0 0">
            <button type="button" class="sv2-btn" id="sv2-forgot-password" style="background:none;border:none;color:var(--sv2-accent);cursor:pointer;font-size:0.875rem;padding:0">
              Şifremi Unuttum
            </button>
          </p>
        </div>
      </div>
    </div>
    <div id="sv2-modal-root"></div>`;

  bindLoginEvents();
}

function setFieldError(fieldId, errId, message) {
  const input = document.getElementById(fieldId);
  const err = document.getElementById(errId);
  if (message) {
    input?.closest(".sv2-form-group")?.classList.add("has-error");
    if (err) {
      err.textContent = message;
      err.hidden = false;
    }
  } else {
    input?.closest(".sv2-form-group")?.classList.remove("has-error");
    if (err) {
      err.textContent = "";
      err.hidden = true;
    }
  }
}

function clearLoginErrors() {
  setFieldError("sv2-email", "sv2-login-err-email", "");
  setFieldError("sv2-password", "sv2-login-err-password", "");
}

function bindLoginEvents() {
  const form = document.getElementById("sv2-login-form");
  const toggleBtn = document.getElementById("sv2-toggle-password");
  const passwordInput = document.getElementById("sv2-password");
  const toggleIcon = document.getElementById("sv2-toggle-password-icon");
  const forgotBtn = document.getElementById("sv2-forgot-password");

  toggleBtn?.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    toggleIcon.className = isPassword ? "fas fa-eye-slash" : "fas fa-eye";
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearLoginErrors();

    const emailVal = document.getElementById("sv2-email").value.trim();
    const passwordVal = document.getElementById("sv2-password").value;
    let valid = true;

    if (!emailVal) {
      setFieldError("sv2-email", "sv2-login-err-email", "E-posta adresi zorunludur.");
      valid = false;
    } else if (!validateEmail(emailVal)) {
      setFieldError("sv2-email", "sv2-login-err-email", "Geçerli bir e-posta adresi giriniz.");
      valid = false;
    }

    if (!passwordVal) {
      setFieldError("sv2-password", "sv2-login-err-password", "Şifre zorunludur.");
      valid = false;
    }

    if (!valid) return;

    const submitBtn = document.getElementById("sv2-login-submit");
    submitBtn.disabled = true;
    showLoading(true);

    try {
      const profile = await signIn(emailVal, passwordVal);
      toast("Hoş geldiniz!", "success");
      redirectByRole(profile);
      return;
    } catch (err) {
      handleError(err, "Giriş");
    } finally {
      submitBtn.disabled = false;
      showLoading(false);
    }
  });

  forgotBtn?.addEventListener("click", async () => {
    const emailVal = document.getElementById("sv2-email").value.trim();
    if (!emailVal || !validateEmail(emailVal)) {
      setFieldError("sv2-email", "sv2-login-err-email", "Şifre sıfırlama için geçerli e-posta giriniz.");
      return;
    }

    showLoading(true);
    try {
      await resetPassword(emailVal);
      toast("Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.", "success");
    } catch (err) {
      handleError(err, "Şifre sıfırlama");
    } finally {
      showLoading(false);
    }
  });
}

async function init() {
  showLoading(true);
  try {
    const session = await getSessionUser();
    if (session?.role && session.is_active !== false) {
      if (isAdminRole(session.role) || isCustomerRole(session.role)) {
        redirectByRole(session);
        return;
      }
    }
    renderLoginPage();
  } catch {
    renderLoginPage();
  } finally {
    showLoading(false);
  }
}

init();
