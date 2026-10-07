/**
 * Parla BT Ticket V2 — Admin Kullanıcı Detayı
 */
import ParlaDb from "../firebase-client.js";
import { resetPassword, PATHS } from "../auth-guard.js";
import { requirePage } from "../access-control.js";
import {
  renderShell,
  toast,
  showLoading,
  renderStatsGrid,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  renderConfirmDialog,
  renderTimeline,
  handleError,
  handleLoadError,
  linkTicket,
  linkCompany,
  escapeHtml,
  formatDate,
  formatDateTime,
  renderStatusBadge,
  renderTypeBadge,
} from "../ui-shell.js";
import { ROLE_LABELS, formatRoleLabel, STATUSES, isOpenStatus, isCustomerRole } from "../ticket-utils.js";
import { callAdminUsers, assignableRoles, canManageRole, warningsText, phoneInputError } from "../user-admin.js";
import { validateUserForm } from "../validators.js";
import { initPhoneInput, normalizePhone, formatPhoneDisplay, setPhoneValue } from "../phone-utils.js";
import { safeText, formatNumber } from "../safe-utils.js";
import { formatActivityAction } from "../activity-labels.js";

let session = null;
let user = null;
let tickets = [];
let activities = [];

function getUid() {
  return new URLSearchParams(window.location.search).get("uid");
}

function fullName(u) {
  return [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.email || "—";
}

function initials(u) {
  const f = u?.first_name?.charAt(0) || "";
  const l = u?.last_name?.charAt(0) || "";
  return (f + l).toUpperCase() || u?.email?.charAt(0)?.toUpperCase() || "?";
}

function renderRoleBadge(role) {
  const key = String(role || "").toLowerCase();
  let cls = "customer";
  if (key === "super_admin" || key === "service_admin") cls = "admin";
  else if (key === "consultant" || key === "project_manager") cls = "agent";
  return `<span class="sv2-role-badge ${cls}">${escapeHtml(formatRoleLabel(role))}</span>`;
}

function computeStats() {
  const open = tickets.filter((t) => isOpenStatus(t.status)).length;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonth = tickets.filter((t) => new Date(t.created_at) >= monthStart).length;

  const resolved = tickets.filter((t) => t.resolved_at || t.status === STATUSES.RESOLVED || t.status === STATUSES.CLOSED);
  let avgHours = "—";
  if (resolved.length) {
    const totalMs = resolved.reduce((sum, t) => {
      const end = new Date(t.resolved_at || t.closed_at || t.updated_at);
      const start = new Date(t.created_at);
      return sum + (end - start);
    }, 0);
    avgHours = formatNumber(totalMs / resolved.length / 3600000) + " sa";
  }

  return [
    { label: "Toplam Talep", value: tickets.length, variant: "" },
    { label: "Açık Talep", value: open, variant: "open" },
    { label: "Bu Ay Açılan", value: thisMonth, variant: "in_progress" },
    { label: "Ort. Çözüm Süresi", value: avgHours, variant: "resolved" },
  ];
}

function buildContent() {
  if (!user) {
    return `<div class="sv2-empty"><i class="fas fa-user-slash"></i><h4>Kullanıcı bulunamadı</h4></div>`;
  }

  const name = fullName(user);
  const active = user.is_active !== false;
  const isSelf = !!session && user.uid === session.uid;
  // Üst rolü alt rol yönetemez (Destek Atayıcı → Süper Admin/Destek Atayıcı hesapları; YON-05); kendini kilitleme yok (YON-06).
  const manageable = isSelf || canManageRole(session?.role, user.role);

  return `
    <nav class="sv2-breadcrumb" aria-label="Breadcrumb">
      <a href="${PATHS.adminUsers}" class="sv2-breadcrumb-link">Kullanıcılar</a>
      <span class="sv2-breadcrumb-sep">›</span>
      <span class="sv2-breadcrumb-current">${escapeHtml(name)}</span>
    </nav>

    <div class="sv2-section">
      <div class="sv2-section-body">
        <div style="display:flex;flex-wrap:wrap;gap:1.5rem;align-items:flex-start;">
          <div style="width:72px;height:72px;border-radius:50%;background:var(--sv2-accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;flex-shrink:0;">
            ${escapeHtml(initials(user))}
          </div>
          <div style="flex:1;min-width:200px;">
            <h2 style="margin:0 0 0.5rem;color:var(--sv2-navy);">${escapeHtml(name)}</h2>
            <p style="margin:0 0 0.75rem;color:var(--sv2-gray-500);">${escapeHtml(user.email || "")}</p>
            <div class="sv2-meta-grid">
              <div class="sv2-meta-item"><label>Telefon</label><span>${escapeHtml(formatPhoneDisplay(user.phone))}</span></div>
              <div class="sv2-meta-item"><label>Firma</label><span>${user.company_id ? linkCompany(user.company_id, user.company_name) : escapeHtml(user.company_name || "—")}</span></div>
              <div class="sv2-meta-item"><label>Rol</label><div>${renderRoleBadge(user.role)}</div></div>
              <div class="sv2-meta-item"><label>Durum</label><span>${active ? '<span class="sv2-badge sv2-badge-resolved">Aktif</span>' : '<span class="sv2-badge sv2-badge-closed">Pasif</span>'}</span></div>
              <div class="sv2-meta-item"><label>Kayıt Tarihi</label><span>${escapeHtml(formatDate(user.created_at))}</span></div>
              <div class="sv2-meta-item"><label>Son Giriş</label><span>${escapeHtml(formatDateTime(user.last_login_at))}</span></div>
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
            ${
              manageable
                ? `<button type="button" class="sv2-btn sv2-btn-primary" id="btn-edit-user"><i class="fas fa-edit"></i> Düzenle</button>
                   <button type="button" class="sv2-btn sv2-btn-secondary" id="btn-reset-pwd"><i class="fas fa-key"></i> Şifre Sıfırla</button>`
                : ""
            }
            ${
              manageable && !isSelf
                ? `<button type="button" class="sv2-btn ${active ? "sv2-btn-danger" : "sv2-btn-outline"}" id="btn-toggle-active">${active ? "Devre Dışı Bırak" : "Aktive Et"}</button>`
                : ""
            }
            ${
              !manageable
                ? `<p class="sv2-text-muted" style="max-width:22rem;margin:0;font-size:0.875rem;">Bu hesabı yönetme yetkiniz yok: Süper Admin ve Destek Atayıcı hesapları yalnızca Süper Admin tarafından yönetilir.</p>`
                : ""
            }
            ${isSelf ? `<p class="sv2-text-muted" style="max-width:22rem;margin:0;font-size:0.875rem;">Kendi hesabınızı devre dışı bırakamaz ve rolünüzü değiştiremezsiniz.</p>` : ""}
          </div>
        </div>
      </div>
    </div>

    ${renderStatsGrid(computeStats())}

    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Talep Geçmişi</h3></div>
      <div class="sv2-section-body">
        ${renderDataTable({
          emptyMessage: "Bu kullanıcıya ait talep bulunamadı.",
          columns: [
            { key: "ticket_number", label: "NO", render: (v, r) => linkTicket(r.id, v) },
            { key: "title", label: "KONU" },
            { key: "ticket_type", label: "TİP", render: (v) => renderTypeBadge(v) },
            { key: "status", label: "DURUM", render: (v) => renderStatusBadge(v) },
            { key: "created_at", label: "TARİH", render: (v) => escapeHtml(formatDate(v)) },
          ],
          rows: tickets.map((t) => ({ ...t, id: t.id || t.ticket_id })),
        })}
      </div>
    </div>

    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Son Aktiviteler</h3></div>
      <div class="sv2-section-body">
        ${renderTimeline(
          activities.slice(0, 15).map((a) => ({
            author: safeText(a.user_name) || "Sistem",
            created_at: safeText(a.created_at),
            message: `${formatActivityAction(a.action)}: ${safeText(a.details) || safeText(a.entity_label)}`,
            variant: "admin",
          }))
        )}
      </div>
    </div>`;
}

function openEditModal() {
  const isSelf = user.uid === session.uid;
  // Rol listesi oturum rolüne göre süzülür; kullanıcının mevcut rolü (yönetilebilir değilse bile) gösterilir ama başkasına atanamaz.
  const allowedRoles = assignableRoles(session.role);
  const roleOpts = Object.entries(ROLE_LABELS)
    .filter(([v]) => allowedRoles.includes(v) || v === user.role)
    .map(
      ([v, l]) =>
        `<option value="${v}"${v === user.role ? " selected" : ""}>${escapeHtml(l)}</option>`
    )
    .join("");

  renderModal("modal-edit-user", {
    title: "Kullanıcı Düzenle",
    body: `
      <form id="edit-user-form">
        <div class="sv2-form-row">
          <div class="sv2-form-group">
            <label>Ad</label>
            <input type="text" name="first_name" value="${escapeHtml(user.first_name || "")}">
          </div>
          <div class="sv2-form-group">
            <label>Soyad</label>
            <input type="text" name="last_name" value="${escapeHtml(user.last_name || "")}">
          </div>
        </div>
        <div class="sv2-form-group">
          <label>E-posta</label>
          <input type="email" name="email" value="${escapeHtml(user.email || "")}" readonly>
        </div>
        <div class="sv2-form-group">
          <label>Telefon</label>
          <input type="tel" name="phone" value="${escapeHtml(user.phone || "")}">
        </div>
        <div class="sv2-form-group">
          <label>Rol</label>
          <select name="role"${isSelf ? " disabled" : ""}>${roleOpts}</select>
          ${isSelf ? '<small class="sv2-text-muted">Kendi rolünüzü değiştiremezsiniz.</small>' : ""}
        </div>
      </form>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="modal-edit-user">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="edit-user-save">Kaydet</button>`,
  });
  openModal("modal-edit-user");
  const phoneInput = document.querySelector('#edit-user-form [name="phone"]');
  initPhoneInput(phoneInput).then(() => setPhoneValue(phoneInput, user.phone || ""));

  document.getElementById("edit-user-save")?.addEventListener("click", async () => {
    const form = document.getElementById("edit-user-form");
    const data = {
      first_name: form.first_name.value.trim(),
      last_name: form.last_name.value.trim(),
      email: user.email,
      phone: normalizePhone(form.phone) || form.phone.value.trim(),
      role: form.role.value,
      company_id: user.company_id || "",
    };
    const { valid, errors } = validateUserForm(data);
    const phoneErr = valid ? phoneInputError(form.phone) : "";
    if (!valid || phoneErr) {
      toast(phoneErr || Object.values(errors)[0], "error");
      return;
    }
    showLoading(true);
    try {
      const roleChanged = data.role !== user.role;
      // 1) Sunucu işlevi (rol matrisi + son süper admin koruması + firma/rol tutarlılığı tek yerde)
      const res = await callAdminUsers("update", {
        uid: user.uid,
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        ...(roleChanged ? { role: data.role } : {}),
      });
      if (res.ok) {
        user = await ParlaDb.getUserProfile(user.uid);
        closeModal("modal-edit-user");
        toast(`Kullanıcı güncellendi. ${warningsText(res.warnings)}`.trim(), res.warnings.length ? "warning" : "success");
        refreshView();
        return;
      }
      if (!res.unavailable) {
        toast(res.errors ? Object.values(res.errors)[0] : res.message, "error");
        return;
      }

      // 2) Yedek akış (servis hesabı yok): istemci tarafı kontroller + doğrudan profil yazımı
      if (roleChanged) {
        if (user.uid === session.uid) {
          toast("Kendi rolünüzü değiştiremezsiniz.", "error");
          return;
        }
        if (!canManageRole(session.role, data.role)) {
          toast("Bu rolü atama yetkiniz yok.", "error");
          return;
        }
        if (user.role === "super_admin" && (await activeSuperAdminCount(user.uid)) === 0) {
          toast("Son aktif Süper Admin'in rolü düşürülemez.", "error");
          return;
        }
      }
      const patch = { ...data, updated_by: session.uid };
      if (roleChanged && !isCustomerRole(data.role)) {
        // Personel rollerinde firma alanları boşaltılır (YON-16)
        patch.company_id = "";
        patch.company_name = "";
        patch.customer_code = "";
      }
      user = await ParlaDb.updateUserProfile(user.uid, patch);
      try {
        await ParlaDb.logActivity("user_updated", "user", user.uid, fullName(user), "Profil güncellendi", session);
      } catch {
        toast("Kullanıcı güncellendi ancak aktivite kaydı yazılamadı.", "warning");
      }
      closeModal("modal-edit-user");
      toast("Kullanıcı güncellendi.", "success");
      refreshView();
    } catch (err) {
      handleError(err, "Güncelleme");
    } finally {
      showLoading(false);
    }
  });
}

/** Yedek akış için: bu kullanıcı HARİÇ aktif Süper Admin sayısı (son süper admin koruması; YON-06). */
async function activeSuperAdminCount(excludeUid) {
  const users = await ParlaDb.getAllUsers();
  return users.filter((u) => (u.uid || u.id) !== excludeUid && u.role === "super_admin" && u.is_active !== false).length;
}

function bindEvents() {
  document.getElementById("btn-edit-user")?.addEventListener("click", openEditModal);
  document.getElementById("btn-reset-pwd")?.addEventListener("click", () => {
    renderConfirmDialog(
      `${user.email} adresine şifre belirleme/sıfırlama e-postası gönderilsin mi?`,
      async () => {
        showLoading(true);
        try {
          // Sunucu işlevi: bağlantı sunucuda üretilir ve (kota dostu) tek e-postayla gider; parola e-postada yok.
          const res = await callAdminUsers("resetLink", { uid: user.uid, send: true });
          if (res.ok) {
            if (res.data?.sent) toast("Şifre belirleme bağlantısı e-postayla gönderildi.", "success");
            else toast(warningsText(res.warnings) || "E-posta gönderilemedi.", "warning");
            if (res.data?.link) showLinkModal(res.data.link);
            return;
          }
          if (!res.unavailable) {
            toast(res.message, "error");
            return;
          }
          // Yedek: Firebase'in kendi şifre sıfırlama e-postası
          await resetPassword(user.email, { revealMissing: true });
          toast("Şifre sıfırlama e-postası gönderildi.", "success");
        } catch (err) {
          handleError(err, "Şifre sıfırlama");
        } finally {
          showLoading(false);
        }
      }
    );
  });
  document.getElementById("btn-toggle-active")?.addEventListener("click", () => {
    const next = user.is_active === false;
    const label = fullName(user);
    const msg = next
      ? `${label} hesabı aktive edilsin mi?`
      : `${label} (${user.email}) hesabı devre dışı bırakılsın mı? Açık oturumları sonlandırılır ve giriş yapamaz.`;
    renderConfirmDialog(msg, async () => {
      showLoading(true);
      try {
        if (!next && user.uid === session.uid) {
          toast("Kendi hesabınızı devre dışı bırakamazsınız.", "error");
          return;
        }
        // Sunucu işlevi: profil + Auth devre dışı + oturum iptali tek işlemde
        const res = await callAdminUsers("setActive", { uid: user.uid, active: next });
        if (res.ok) {
          user = await ParlaDb.getUserProfile(user.uid);
          const w = warningsText(res.warnings);
          toast(`${next ? "Hesap aktive edildi." : "Hesap devre dışı bırakıldı; oturumları sonlandırıldı."} ${w}`.trim(), w ? "warning" : "success");
          refreshView();
          return;
        }
        if (!res.unavailable) {
          toast(res.message, "error");
          return;
        }

        // Yedek akış: yalnızca profil (kural düzeyinde erişimi keser; Firebase Auth hesabı AÇIK kalır)
        if (!next && user.role === "super_admin" && (await activeSuperAdminCount(user.uid)) === 0) {
          toast("Son aktif Süper Admin hesabı devre dışı bırakılamaz.", "error");
          return;
        }
        user = await ParlaDb.updateUserProfile(user.uid, {
          is_active: next,
          updated_by: session.uid,
        });
        try {
          await ParlaDb.logActivity(
            next ? "user_activated" : "user_deactivated",
            "user",
            user.uid,
            fullName(user),
            next ? "Hesap aktive edildi" : "Hesap devre dışı bırakıldı",
            session
          );
        } catch {
          toast("İşlem yapıldı ancak aktivite kaydı yazılamadı.", "warning");
        }
        toast(
          next
            ? "Hesap aktive edildi."
            : "Hesap devre dışı bırakıldı. Sunucu tarafı yönetim yapılandırılmadığından Firebase oturum hesabı açık kalır; veritabanı erişimi kurallarla engellenir.",
          next ? "success" : "warning"
        );
        refreshView();
      } catch (err) {
        handleError(err, "Durum güncelleme");
      } finally {
        showLoading(false);
      }
    });
  });
}

/** Bağlantı e-postayla gönderilemediğinde yöneticiye gösterilir (güvenli kanaldan iletilsin). */
function showLinkModal(link) {
  renderModal("modal-reset-link", {
    title: "Şifre Belirleme Bağlantısı",
    body: `<p>Bağlantıyı kullanıcıya yalnızca güvenli bir kanaldan iletin (kısa süre geçerli, tek kullanımlık).</p>
           <div class="sv2-form-group"><label for="reset-link-input">Bağlantı</label><input type="text" id="reset-link-input" readonly value="${escapeHtml(link)}"></div>`,
    footer: `<button type="button" class="sv2-btn sv2-btn-secondary" id="reset-link-copy">Kopyala</button>
             <button type="button" class="sv2-btn sv2-btn-primary" data-close="modal-reset-link">Tamam</button>`,
  });
  openModal("modal-reset-link");
  document.getElementById("reset-link-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Bağlantı panoya kopyalandı.", "success");
    } catch {
      toast("Kopyalama başarısız.", "error");
    }
  });
}

function refreshView() {
  renderShell("#sv2-app", {
    title: fullName(user),
    activePage: "users",
    profile: session,
    isAdmin: true,
    content: buildContent(),
  });
  bindEvents();
}

async function loadData(uid) {
  user = await ParlaDb.getUserProfile(uid);
  if (!user) return;
  const [userTickets, allActivities] = await Promise.all([
    ParlaDb.getTicketsForUser(uid),
    ParlaDb.getActivities(100),
  ]);
  tickets = userTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  activities = allActivities.filter(
    (a) =>
      a.entity_id === uid ||
      (a.entity_type === "user" && a.entity_id === uid) ||
      (!!safeText(user.email) && safeText(a.details).includes(safeText(user.email)))
  );
}

document.addEventListener("DOMContentLoaded", async () => {
  const uid = getUid();
  if (!uid) {
    window.location.href = PATHS.adminUsers;
    return;
  }
  try {
    showLoading(true);
    session = await requirePage("adminUsers", { adminOnly: true });
    await ParlaDb.waitForFirebase();
    await loadData(uid);
    if (!user) {
      toast("Kullanıcı bulunamadı.", "error");
      setTimeout(() => { window.location.href = PATHS.adminUsers; }, 1500);
      return;
    }
    refreshView();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin") {
      handleLoadError(err, "Sayfa yüklenemedi");
    }
  } finally {
    showLoading(false);
  }
});
