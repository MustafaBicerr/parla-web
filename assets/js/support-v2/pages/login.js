/**
 * Parla BT Ticket V2 — giriş sayfası
 */
import {
  signIn,
  resetPassword,
  redirectByRole,
  getSessionUser,
  LOGIN_REASONS,
} from "../auth-guard.js";
import { toast, showLoading, handleError, withInflight } from "../ui-shell.js";
import { email as validateEmail } from "../validators.js";
import { isAdminRole, isCustomerRole } from "../ticket-utils.js";

const app = document.getElementById("sv2-app");

/** `login.html?reason=inactive|no_role|no_profile|expired` → sabit listeden bilgi bandı (parametre metni basılmaz). */
function reasonBanner() {
  const reason = new URLSearchParams(window.location.search).get("reason") || "";
  const text = Object.prototype.hasOwnProperty.call(LOGIN_REASONS, reason) ? LOGIN_REASONS[reason] : "";
  return text ? `<div class="sv2-alert sv2-alert-warning" role="alert" id="sv2-login-reason"><i class="fas fa-info-circle" aria-hidden="true"></i> ${text}</div>` : "";
}

function renderLoginPage() {
  app.innerHTML = `
    <div class="sv2-auth-wrap">
      <header class="sv2-auth-brand">
        <img src="/assets/img/parla-logo/parla-logo-320.png" alt="Parla BT" class="sv2-auth-logo" width="160" height="64">
        <h1>Parla BT Destek Portalı</h1>
        <p>SAP destek taleplerinizi oluşturun, takip edin ve danışmanlarımızla iletişim kurun.</p>
        <ul>
          <li><i class="fas fa-ticket-alt" aria-hidden="true"></i> Talep oluşturma ve takip</li>
          <li><i class="fas fa-comments" aria-hidden="true"></i> Mesajlaşma</li>
          <li><i class="fas fa-chart-line" aria-hidden="true"></i> Durum ve öncelik yönetimi</li>
        </ul>
      </header>
      <main class="sv2-auth-panel" id="sv2-main">
        <div class="sv2-card">
          <h2>Giriş Yap</h2>
          <p class="sv2-subtitle">Hesabınıza erişmek için bilgilerinizi girin.</p>
          ${reasonBanner()}
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
                <button type="button" id="sv2-toggle-password" aria-label="Şifreyi göster" aria-pressed="false">
                  <i class="fas fa-eye" id="sv2-toggle-password-icon" aria-hidden="true"></i>
                </button>
              </div>
              <span class="sv2-field-error" id="sv2-login-err-password" hidden></span>
            </div>
            <button type="submit" class="sv2-btn sv2-btn-primary sv2-btn-block" id="sv2-login-submit">
              <i class="fas fa-sign-in-alt"></i> Giriş Yap
            </button>
          </form>
          <p class="sv2-auth-links">
            <button type="button" class="sv2-btn sv2-btn-link" id="sv2-forgot-password">
              Şifremi Unuttum
            </button>
          </p>
          <div class="sv2-auth-guides" id="sv2-auth-guides">
            <h3>Kılavuzlar</h3>
            <div class="sv2-guide-card">
              <span class="sv2-guide-icon"><i class="fas fa-book-open"></i></span>
              <span class="sv2-guide-text"><strong>Kullanıcı Kılavuzu</strong><span>Talep açma ve takip · PDF</span></span>
              <span class="sv2-guide-actions">
                <a href="/support-v2/docs/Kullanici-Kilavuzu.pdf" target="_blank" rel="noopener" id="sv2-guide-user-open">Aç</a>
                <a href="/support-v2/docs/Kullanici-Kilavuzu.pdf" download="Parla-BT-Kullanici-Kilavuzu.pdf" class="is-primary" id="sv2-guide-user-dl"><i class="fas fa-download"></i> İndir</a>
              </span>
            </div>
            <div class="sv2-guide-card">
              <span class="sv2-guide-icon"><i class="fas fa-user-shield"></i></span>
              <span class="sv2-guide-text"><strong>Sistem Adminleri Kılavuzu</strong><span>Parla BT personeli için · PDF</span></span>
              <span class="sv2-guide-actions">
                <a href="/support-v2/docs/Sistem-Adminleri-Kullanim-Kilavuzu.pdf" target="_blank" rel="noopener" id="sv2-guide-admin-open">Aç</a>
                <a href="/support-v2/docs/Sistem-Adminleri-Kullanim-Kilavuzu.pdf" download="Parla-BT-Sistem-Adminleri-Kilavuzu.pdf" class="is-primary" id="sv2-guide-admin-dl"><i class="fas fa-download"></i> İndir</a>
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>`;

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
    toggleBtn.setAttribute("aria-pressed", isPassword ? "true" : "false");
    toggleBtn.setAttribute("aria-label", isPassword ? "Şifreyi gizle" : "Şifreyi göster");
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
      setFieldError("sv2-email", "sv2-login-err-email", "Geçerli bir e-posta adresi girin.");
      valid = false;
    }

    if (!passwordVal) {
      setFieldError("sv2-password", "sv2-login-err-password", "Şifre zorunludur.");
      valid = false;
    }

    if (!valid) return;

    const submitBtn = document.getElementById("sv2-login-submit");
    await withInflight(submitBtn, async () => {
      showLoading(true);
      try {
        const profile = await signIn(emailVal, passwordVal);
        toast("Hoş geldiniz!", "success");
        // Giriş öncesi hedef (ör. e-postadaki talep bağlantısı) `?next=` ile korunur (MUS-10, SEN-18).
        redirectByRole(profile);
        return;
      } catch (err) {
        handleError(err, "Giriş");
      } finally {
        showLoading(false);
      }
    });
  });

  forgotBtn?.addEventListener("click", async () => {
    const emailVal = document.getElementById("sv2-email").value.trim();
    if (!emailVal || !validateEmail(emailVal)) {
      setFieldError("sv2-email", "sv2-login-err-email", "Şifre sıfırlama için geçerli bir e-posta adresi girin.");
      return;
    }

    await withInflight(forgotBtn, async () => {
      showLoading(true);
      try {
        await resetPassword(emailVal);
        toast("Bu adres sistemde kayıtlıysa şifre sıfırlama bağlantısı e-postanıza gönderildi.", "success");
      } catch (err) {
        handleError(err, "Şifre sıfırlama");
      } finally {
        showLoading(false);
      }
    });
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
