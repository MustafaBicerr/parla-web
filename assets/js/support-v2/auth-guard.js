/**
 * Parla BT Ticket V2 — kimlik doğrulama ve rota koruması
 */
import ParlaDb from "./firebase-client.js";
import { isAdminRole, isCustomerRole } from "./ticket-utils.js";

export const PATHS = {
  login: "/support-v2/login.html",
  customerDashboard: "/support-v2/customer/dashboard.html",
  customerTickets: "/support-v2/customer/tickets.html",
  customerTicketDetail: "/support-v2/customer/ticket-detail.html",
  customerProfile: "/support-v2/customer/profile.html",
  adminDashboard: "/support-v2/admin/dashboard.html",
  adminTickets: "/support-v2/admin/tickets.html",
  adminTicketDetail: "/support-v2/admin/ticket-detail.html",
  adminUsers: "/support-v2/admin/users.html",
  adminUserDetail: "/support-v2/admin/user-detail.html",
  adminCompanies: "/support-v2/admin/companies.html",
  adminCompanyDetail: "/support-v2/admin/company-detail.html",
  adminPersonnel: "/support-v2/admin/personnel.html",
  adminPersonnelDetail: "/support-v2/admin/personnel-detail.html",
  adminContracts: "/support-v2/admin/contracts.html",
  adminProjects: "/support-v2/admin/projects.html",
  adminProjectDetail: "/support-v2/admin/project-detail.html",
  adminDepartments: "/support-v2/admin/departments.html",
  adminModules: "/support-v2/admin/modules.html",
  adminSupportTypes: "/support-v2/admin/support-types.html",
  adminActivities: "/support-v2/admin/activities.html",
  adminReports: "/support-v2/admin/reports.html",
};

const AUTH_ERROR_MESSAGES = {
  "auth/user-not-found":
    "Bu e-posta adresi sistemde kayıtlı değil. Sistem yöneticinizle iletişime geçin.",
  "auth/wrong-password":
    "Şifre hatalı. Lütfen tekrar deneyin veya 'Şifremi Unuttum' bağlantısını kullanın.",
  "auth/invalid-email": "Geçersiz e-posta adresi formatı.",
  "auth/user-disabled":
    "Hesabınız devre dışı bırakılmış. Lütfen sistem yöneticinizle iletişime geçin.",
  "auth/too-many-requests":
    "Çok fazla başarısız deneme. Hesabınız geçici olarak kilitlendi. Birkaç dakika bekleyin.",
  "auth/network-request-failed":
    "İnternet bağlantınızı kontrol edin ve tekrar deneyin.",
  "auth/invalid-credential":
    "E-posta veya şifre hatalı. Lütfen bilgilerinizi kontrol edin.",
  "auth/email-already-in-use": "Bu e-posta adresi zaten kullanımda.",
  "auth/weak-password": "Şifre çok zayıf. En az 8 karakter kullanın.",
};

function mapAuthError(error) {
  const code = error?.code || "";
  return AUTH_ERROR_MESSAGES[code] || error?.message || "Bir hata oluştu. Lütfen tekrar deneyin.";
}

function waitForAuth(timeoutMs) {
  const maxWait = timeoutMs || 15000;
  return ParlaDb.waitForFirebase().then(
    (fb) =>
      new Promise((resolve, reject) => {
        if (fb.auth.currentUser) {
          resolve(fb.auth.currentUser);
          return;
        }

        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          unsub();
          if (fb.auth.currentUser) {
            resolve(fb.auth.currentUser);
          } else {
            reject(new Error("not_authenticated"));
          }
        }, maxWait);

        const unsub = fb.authFn.onAuthStateChanged(fb.auth, (user) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          unsub();
          if (user) {
            resolve(user);
          } else {
            reject(new Error("not_authenticated"));
          }
        });
      })
  );
}

async function getSessionUser() {
  await ParlaDb.waitForFirebase();
  let authUser;
  try {
    authUser = await waitForAuth(8000);
  } catch {
    return null;
  }

  const profile = await ParlaDb.getUserProfile(authUser.uid);
  if (!profile) {
    return {
      uid: authUser.uid,
      email: authUser.email,
      profile: null,
      authUser,
    };
  }

  return {
    uid: authUser.uid,
    email: authUser.email,
    ...profile,
    profile,
    authUser,
  };
}

function redirectByRole(profile) {
  const role = profile?.role || profile?.profile?.role;
  if (isAdminRole(role)) {
    window.location.href = PATHS.adminDashboard;
  } else if (isCustomerRole(role)) {
    window.location.href = PATHS.customerDashboard;
  } else {
    window.location.href = PATHS.login;
  }
}

async function requireAuth(options) {
  options = options || {};
  const redirect = options.redirect !== false ? options.redirect || PATHS.login : null;

  try {
    await ParlaDb.waitForFirebase();
    const fb = window.__PARLA_FIREBASE;
    let authUser;
    try {
      authUser = await waitForAuth(8000);
    } catch {
      if (redirect) window.location.href = redirect;
      throw new Error("not_authenticated");
    }

    const profile = await ParlaDb.getUserProfile(authUser.uid);

    if (!profile) {
      await fb.authFn.signOut(fb.auth);
      if (redirect) window.location.href = redirect;
      throw new Error("profile_not_found");
    }

    if (profile.is_active === false) {
      await fb.authFn.signOut(fb.auth);
      throw new Error("account_inactive");
    }

    const session = { uid: authUser.uid, email: authUser.email, ...profile, authUser };

    if (options.adminOnly && !isAdminRole(profile.role)) {
      window.location.href = PATHS.customerDashboard;
      throw new Error("not_admin");
    }

    if (options.customerOnly && !isCustomerRole(profile.role)) {
      window.location.href = PATHS.adminDashboard;
      throw new Error("not_customer");
    }

    if (options.roles && options.roles.length > 0) {
      const allowed = options.roles.map((r) => String(r).toLowerCase());
      if (!allowed.includes(String(profile.role).toLowerCase())) {
        redirectByRole(profile);
        throw new Error("role_denied");
      }
    }

    return session;
  } catch (err) {
    if (err.message === "profile_not_found") {
      throw new Error(
        "Kullanıcı profili bulunamadı. Lütfen yöneticinizle iletişime geçin."
      );
    }
    if (err.message === "account_inactive") {
      throw new Error("Hesabınız aktif değil. Sistem yöneticinizle iletişime geçin.");
    }
    throw err;
  }
}

async function signIn(email, password) {
  await ParlaDb.waitForFirebase();
  const fb = window.__PARLA_FIREBASE;

  try {
    const credential = await fb.authFn.signInWithEmailAndPassword(
      fb.auth,
      String(email || "").trim(),
      String(password || "")
    );

    const profile = await ParlaDb.getUserProfile(credential.user.uid);

    if (!profile) {
      await fb.authFn.signOut(fb.auth);
      throw new Error("Kullanıcı profili bulunamadı. Lütfen yöneticinizle iletişime geçin.");
    }

    if (profile.is_active === false) {
      await fb.authFn.signOut(fb.auth);
      throw new Error("Hesabınız aktif değil. Sistem yöneticinizle iletişime geçin.");
    }

    await ParlaDb.updateUserProfile(credential.user.uid, {
      last_login_at: new Date().toISOString(),
    });

    return {
      uid: credential.user.uid,
      email: credential.user.email,
      ...profile,
    };
  } catch (err) {
    if (err.message && !err.code) throw err;
    throw new Error(mapAuthError(err));
  }
}

async function signOutUser() {
  await ParlaDb.waitForFirebase();
  const fb = window.__PARLA_FIREBASE;
  await fb.authFn.signOut(fb.auth);
  window.location.href = PATHS.login;
}

async function resetPassword(email) {
  await ParlaDb.waitForFirebase();
  const fb = window.__PARLA_FIREBASE;

  try {
    await fb.authFn.sendPasswordResetEmail(fb.auth, String(email || "").trim());
    return true;
  } catch (err) {
    throw new Error(mapAuthError(err));
  }
}

/**
 * Admin kullanıcı oluşturma — ikincil Firebase app ile mevcut oturumu bozmaz.
 */
async function createUser(email, password) {
  await ParlaDb.waitForFirebase();
  const fb = window.__PARLA_FIREBASE;
  const { initializeApp, deleteApp } = await import(
    "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js"
  );
  const { getAuth, createUserWithEmailAndPassword } = await import(
    "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js"
  );

  const appName = `parla-create-user-${Date.now()}`;
  const secondaryApp = initializeApp(fb.app.options, appName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      String(email || "").trim(),
      String(password || "")
    );
    return credential.user;
  } catch (err) {
    throw new Error(mapAuthError(err));
  } finally {
    try {
      await deleteApp(secondaryApp);
    } catch {
      /* ikincil app temizliği opsiyonel */
    }
  }
}

export {
  waitForAuth,
  getSessionUser,
  requireAuth,
  redirectByRole,
  signIn,
  signOutUser,
  resetPassword,
  createUser,
  mapAuthError,
};
