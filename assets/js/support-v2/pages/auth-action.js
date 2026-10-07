/**
 * Parla BT Ticket V2 — Firebase Auth e-posta eylemleri (şifre sıfırlama, e-posta doğrulama).
 *
 * Firebase Console → Authentication → Templates → "Customize action URL" alanına
 * https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html yazılırsa
 * e-postadaki bağlantılar bu sayfaya gelir (?mode=...&oobCode=...).
 */
import ParlaDb from "../firebase-client.js";
import { PATHS } from "../auth-guard.js";
import { escapeHtml } from "../ticket-utils.js";
import { password as passwordPolicyOk } from "../validators.js";

const app = document.getElementById("sv2-app");
const MIN_PASSWORD_LENGTH = 8;

const ERROR_MESSAGES = {
  "auth/expired-action-code": "Bu bağlantının süresi dolmuş. Giriş sayfasından yeni bir bağlantı isteyin.",
  "auth/invalid-action-code": "Bu bağlantı geçersiz veya daha önce kullanılmış. Giriş sayfasından yeni bir bağlantı isteyin.",
  "auth/user-disabled": "Hesabınız devre dışı bırakılmış. Lütfen sistem yöneticinizle iletişime geçin.",
  "auth/user-not-found": "Bu bağlantıya ait kullanıcı bulunamadı.",
  "auth/weak-password": `Şifre çok zayıf. En az ${MIN_PASSWORD_LENGTH} karakter kullanın.`,
  "auth/network-request-failed": "İnternet bağlantınızı kontrol edip yeniden deneyin.",
};

function mapError(err) {
  return ERROR_MESSAGES[err?.code] || err?.message || "Bir hata oluştu. Lütfen yeniden deneyin.";
}

function shell(inner) {
  app.innerHTML = `
    <div class="sv2-auth-wrap">
      <header class="sv2-auth-brand">
        <img src="/assets/img/parla-logo/parla-logo-320.png" alt="Parla BT" class="sv2-auth-logo" width="160" height="64">
        <h1>Parla BT Destek Portalı</h1>
        <p>Hesap güvenliğiniz için bu işlemi tamamlayın.</p>
      </header>
      <main class="sv2-auth-panel" id="sv2-main">
        <div class="sv2-card">${inner}</div>
      </main>
    </div>`;
}

function renderMessage(icon, color, title, message, withLoginLink) {
  shell(`
    <h2><i class="fas ${icon}" style="color:${color}" aria-hidden="true"></i> ${escapeHtml(title)}</h2>
    <p class="sv2-subtitle">${escapeHtml(message)}</p>
    ${
      withLoginLink
        ? `<a href="${PATHS.login}" class="sv2-btn sv2-btn-primary" style="display:block;text-align:center;margin-top:1rem"><i class="fas fa-sign-in-alt" aria-hidden="true"></i> Giriş sayfasına git</a>`
        : `<a href="${PATHS.login}" class="sv2-link">Giriş sayfasına dön</a>`
    }`);
}

/**
 * Bağlantıyla şifresini kendisi belirleyen kullanıcının `must_change_password` bayrağı kapatılır (EML-17, SEN-10): aksi halde ilk
 * girişte az önce belirlediği şifreden FARKLI yeni bir şifre seçmeye zorlanırdı. Kurallar kullanıcıya yalnızca kendi bayrağını
 * `false` yapma izni verir; bu yüzden yeni şifreyle kısa süre oturum açılıp bayrak yazılır ve oturum kapatılır. En iyi çabadır:
 * başarısız olursa (hesap pasif, ağ vb.) şifre yine güncellenmiştir ve giriş akışı olağan biçimde sürer.
 */
async function clearTempPasswordFlag(auth, email, newPassword) {
  const { authFn } = window.__PARLA_FIREBASE;
  if (typeof authFn.signInWithEmailAndPassword !== "function") return;
  try {
    const credential = await authFn.signInWithEmailAndPassword(auth, email, newPassword);
    const uid = credential?.user?.uid;
    if (uid) await ParlaDb.updateUserProfile(uid, { must_change_password: false });
  } catch {
    /* en iyi çaba */
  } finally {
    try {
      await authFn.signOut(auth);
    } catch {
      /* oturum açılmamış olabilir */
    }
  }
}

function renderResetForm(email, auth, oobCode) {
  shell(`
    <h2>Yeni Şifre Belirle</h2>
    <p class="sv2-subtitle"><strong>${escapeHtml(email)}</strong> hesabı için yeni bir şifre girin.</p>
    <form id="sv2-reset-form" novalidate>
      <div class="sv2-form-group">
        <label for="sv2-new-password">Yeni şifre</label>
        <input type="password" id="sv2-new-password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
        <small class="sv2-text-muted">En az ${MIN_PASSWORD_LENGTH} karakter; en az bir büyük harf ve bir rakam.</small>
      </div>
      <div class="sv2-form-group">
        <label for="sv2-new-password2">Yeni şifre (tekrar)</label>
        <input type="password" id="sv2-new-password2" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required>
      </div>
      <div class="sv2-field-error" id="sv2-reset-error" role="alert" hidden></div>
      <button type="submit" class="sv2-btn sv2-btn-primary" id="sv2-reset-submit" style="width:100%;margin-top:0.5rem">
        <i class="fas fa-key"></i> Şifreyi Kaydet
      </button>
    </form>`);

  const form = document.getElementById("sv2-reset-form");
  const errEl = document.getElementById("sv2-reset-error");
  const pw1 = document.getElementById("sv2-new-password");
  const pw2 = document.getElementById("sv2-new-password2");
  const showError = (msg, field) => {
    errEl.textContent = msg;
    errEl.hidden = !msg;
    [pw1, pw2].forEach((f) => {
      f.removeAttribute("aria-invalid");
      f.removeAttribute("aria-describedby");
    });
    if (msg && field) {
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", "sv2-reset-error");
      field.focus();
    }
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showError("");
    const p1 = document.getElementById("sv2-new-password").value;
    const p2 = document.getElementById("sv2-new-password2").value;

    if (!passwordPolicyOk(p1)) {
      showError(`Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı; en az bir büyük harf ve bir rakam içermelidir.`, pw1);
      return;
    }
    if (p1 !== p2) {
      showError("Şifreler eşleşmiyor.", pw2);
      return;
    }

    const btn = document.getElementById("sv2-reset-submit");
    btn.disabled = true;
    try {
      await window.__PARLA_FIREBASE.authFn.confirmPasswordReset(auth, oobCode, p1);
      await clearTempPasswordFlag(auth, email, p1);
      renderMessage("fa-check-circle", "#0d7d4d", "Şifreniz güncellendi", "Yeni şifrenizle giriş yapabilirsiniz.", true);
    } catch (err) {
      showError(mapError(err));
      btn.disabled = false;
    }
  });
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const oobCode = params.get("oobCode");

  if (!mode || !oobCode) {
    renderMessage("fa-exclamation-triangle", "#c47a00", "Geçersiz bağlantı", "Bu sayfa yalnızca e-postadaki bağlantıyla açılabilir.", false);
    return;
  }

  shell(`<h2>İşleniyor…</h2><p class="sv2-subtitle">Lütfen bekleyin.</p>`);

  try {
    await ParlaDb.waitForFirebase();
    const fb = window.__PARLA_FIREBASE;
    const { auth, authFn } = fb;

    if (mode === "resetPassword") {
      const email = await authFn.verifyPasswordResetCode(auth, oobCode);
      renderResetForm(email, auth, oobCode);
    } else if (mode === "verifyEmail") {
      await authFn.applyActionCode(auth, oobCode);
      renderMessage("fa-check-circle", "#0d7d4d", "E-posta doğrulandı", "E-posta adresiniz doğrulandı. Giriş yapabilirsiniz.", true);
    } else if (mode === "recoverEmail") {
      const info = await authFn.checkActionCode(auth, oobCode);
      await authFn.applyActionCode(auth, oobCode);
      const restored = info?.data?.email || "önceki adresiniz";
      renderMessage("fa-check-circle", "#0d7d4d", "E-posta adresi geri alındı", `Hesap e-postanız ${restored} olarak geri yüklendi. Güvenlik için şifrenizi de sıfırlamanızı öneririz.`, true);
    } else {
      renderMessage("fa-exclamation-triangle", "#c47a00", "Desteklenmeyen işlem", "Bu işlem türü tanınmıyor.", false);
    }
  } catch (err) {
    renderMessage("fa-times-circle", "#c41e3a", "İşlem tamamlanamadı", mapError(err), false);
  }
}

init();
