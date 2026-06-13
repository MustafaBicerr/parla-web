/**
 * Parla BT Ticket V2 — Admin Kullanıcı Detayı
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, resetPassword, PATHS } from "../auth-guard.js";
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
  linkTicket,
  linkCompany,
  escapeHtml,
  formatDate,
  formatDateTime,
  renderStatusBadge,
  renderTypeBadge,
} from "../ui-shell.js";
import { ROLE_LABELS, formatRoleLabel, STATUSES } from "../ticket-utils.js";
import { validateUserForm } from "../validators.js";
import { initPhoneInput, normalizePhone, formatPhoneDisplay, setPhoneValue } from "../phone-utils.js";

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
  const openStatuses = [STATUSES.OPEN, STATUSES.IN_PROGRESS, STATUSES.WAITING_CUSTOMER];
  const open = tickets.filter((t) => openStatuses.includes(t.status)).length;
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
    avgHours = (totalMs / resolved.length / 3600000).toFixed(1) + " sa";
  }

  return [
    { label: "Toplam Ticket", value: tickets.length, variant: "" },
    { label: "Açık Ticket", value: open, variant: "open" },
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

  return `
    <nav class="sv2-breadcrumb" aria-label="Breadcrumb">
      <a href="${PATHS.adminUsers}" class="sv2-breadcrumb-link">Muhataplar</a>
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
            <button type="button" class="sv2-btn sv2-btn-primary" id="btn-edit-user"><i class="fas fa-edit"></i> Düzenle</button>
            <button type="button" class="sv2-btn sv2-btn-secondary" id="btn-reset-pwd"><i class="fas fa-key"></i> Şifre Sıfırla</button>
            <button type="button" class="sv2-btn ${active ? "sv2-btn-danger" : "sv2-btn-outline"}" id="btn-toggle-active">
              ${active ? "Devre Dışı Bırak" : "Aktive Et"}
            </button>
          </div>
        </div>
      </div>
    </div>

    ${renderStatsGrid(computeStats())}

    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Ticket Geçmişi</h3></div>
      <div class="sv2-section-body">
        ${renderDataTable({
          emptyMessage: "Bu kullanıcıya ait ticket bulunamadı.",
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
            author: a.user_name || "Sistem",
            created_at: a.created_at,
            message: `${a.action}: ${a.details || a.entity_label || ""}`,
            variant: "admin",
          }))
        )}
      </div>
    </div>`;
}

function openEditModal() {
  const roleOpts = Object.entries(ROLE_LABELS)
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
          <select name="role">${roleOpts}</select>
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
    if (!valid) {
      toast(Object.values(errors)[0], "error");
      return;
    }
    showLoading(true);
    try {
      user = await ParlaDb.updateUserProfile(user.uid, {
        ...data,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity("user_updated", "user", user.uid, fullName(user), "Profil güncellendi", session);
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

function bindEvents() {
  document.getElementById("btn-edit-user")?.addEventListener("click", openEditModal);
  document.getElementById("btn-reset-pwd")?.addEventListener("click", () => {
    renderConfirmDialog(
      `${user.email} adresine şifre sıfırlama e-postası gönderilsin mi?`,
      async () => {
        showLoading(true);
        try {
          await resetPassword(user.email);
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
    const msg = next ? "Hesap aktive edilsin mi?" : "Hesap devre dışı bırakılsın mı?";
    renderConfirmDialog(msg, async () => {
      showLoading(true);
      try {
        user = await ParlaDb.updateUserProfile(user.uid, {
          is_active: next,
          updated_by: session.uid,
        });
        await ParlaDb.logActivity(
          next ? "user_activated" : "user_deactivated",
          "user",
          user.uid,
          fullName(user),
          next ? "Hesap aktive edildi" : "Hesap devre dışı bırakıldı",
          session
        );
        toast(next ? "Hesap aktive edildi." : "Hesap devre dışı bırakıldı.", "success");
        refreshView();
      } catch (err) {
        handleError(err, "Durum güncelleme");
      } finally {
        showLoading(false);
      }
    });
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
      a.details?.includes(user.email)
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
    session = await requireAuth({ adminOnly: true });
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
      handleError(err, "Sayfa yüklenemedi");
    }
  } finally {
    showLoading(false);
  }
});
