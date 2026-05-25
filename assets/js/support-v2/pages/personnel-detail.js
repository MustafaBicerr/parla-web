/**
 * Parla BT Ticket V2 — Admin Personel Detayı
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
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
  escapeHtml,
  formatDate,
  renderStatusBadge,
  renderPriorityBadge,
} from "../ui-shell.js";
import { validatePersonnelForm } from "../validators.js";
import { STATUSES, SAP_MODULE_LABELS } from "../ticket-utils.js";

let session = null;
let person = null;
let departments = [];
let tickets = [];
let activities = [];

function getId() {
  return new URLSearchParams(window.location.search).get("id");
}

function fullName(p) {
  return [p?.first_name, p?.last_name].filter(Boolean).join(" ") || p?.email || "—";
}

function initials(p) {
  return (
    (p?.first_name?.charAt(0) || "") + (p?.last_name?.charAt(0) || "")
  ).toUpperCase() || "?";
}

function openTickets() {
  const open = [STATUSES.OPEN, STATUSES.IN_PROGRESS, STATUSES.WAITING_CUSTOMER];
  return tickets.filter((t) => open.includes(t.status));
}

function completedTickets() {
  return tickets.filter((t) => t.status === STATUSES.RESOLVED || t.status === STATUSES.CLOSED);
}

function computeStats() {
  const open = openTickets();
  const completed = completedTickets();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const closedThisMonth = completed.filter(
    (t) => new Date(t.resolved_at || t.closed_at || t.updated_at) >= monthStart
  ).length;

  const totalEffort = tickets.reduce((s, t) => s + (parseFloat(t.total_work_hours) || 0), 0);

  let avgDays = "—";
  if (completed.length) {
    const totalDays = completed.reduce((sum, t) => {
      const end = new Date(t.resolved_at || t.closed_at || t.updated_at);
      const start = new Date(t.created_at);
      return sum + (end - start) / 86400000;
    }, 0);
    avgDays = (totalDays / completed.length).toFixed(1) + " gün";
  }

  const moduleCounts = {};
  tickets.forEach((t) => {
    const m = t.sap_module || "Diğer";
    moduleCounts[m] = (moduleCounts[m] || 0) + 1;
  });
  const topModule = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1])[0];
  const topModuleLabel = topModule
    ? `${topModule[0]} (${topModule[1]})`
    : "—";

  return [
    { label: "Açık Ticket", value: open.length, variant: "open" },
    { label: "Bu Ay Kapatılan", value: closedThisMonth, variant: "resolved" },
    { label: "Toplam Efor", value: totalEffort.toFixed(1) + " sa", variant: "in_progress" },
    { label: "Ort. Çözüm Süresi", value: avgDays, variant: "waiting" },
    { label: "En Yoğun Modül", value: topModuleLabel, variant: "critical" },
  ];
}

function resolutionDays(t) {
  const end = new Date(t.resolved_at || t.closed_at || t.updated_at);
  const start = new Date(t.created_at);
  const days = (end - start) / 86400000;
  return days >= 0 ? days.toFixed(1) + " gün" : "—";
}

function buildContent() {
  if (!person) {
    return `<div class="sv2-empty"><i class="fas fa-user-tie"></i><h4>Personel bulunamadı</h4></div>`;
  }

  const active = person.is_active !== false;

  return `
    <nav class="sv2-breadcrumb" aria-label="Breadcrumb">
      <a href="${PATHS.adminPersonnel}" class="sv2-breadcrumb-link">Danışmanlar</a>
      <span class="sv2-breadcrumb-sep">›</span>
      <span class="sv2-breadcrumb-current">${escapeHtml(fullName(person))}</span>
    </nav>

    <div class="sv2-section">
      <div class="sv2-section-body">
        <div style="display:flex;flex-wrap:wrap;gap:1.5rem;align-items:flex-start;">
          <div style="width:72px;height:72px;border-radius:50%;background:var(--sv2-navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700;">
            ${escapeHtml(initials(person))}
          </div>
          <div style="flex:1;min-width:200px;">
            <h2 style="margin:0 0 0.5rem;color:var(--sv2-navy);">${escapeHtml(fullName(person))}</h2>
            <p style="margin:0 0 0.75rem;color:var(--sv2-gray-500);">${escapeHtml(person.email || "")}</p>
            <div class="sv2-meta-grid">
              <div class="sv2-meta-item"><label>Telefon</label><span>${escapeHtml(person.phone || "—")}</span></div>
              <div class="sv2-meta-item"><label>Departman</label><span>${escapeHtml(person.department_name || "—")}</span></div>
              <div class="sv2-meta-item"><label>Rol Ünvanı</label><span>${escapeHtml(person.role_title || "—")}</span></div>
              <div class="sv2-meta-item"><label>Durum</label><span>${active ? '<span class="sv2-badge sv2-badge-resolved">Aktif</span>' : '<span class="sv2-badge sv2-badge-closed">Pasif</span>'}</span></div>
            </div>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button type="button" class="sv2-btn sv2-btn-primary" id="btn-edit-person"><i class="fas fa-edit"></i> Düzenle</button>
            <button type="button" class="sv2-btn ${active ? "sv2-btn-danger" : "sv2-btn-outline"}" id="btn-toggle-person">
              ${active ? "Pasife Al" : "Aktive Et"}
            </button>
          </div>
        </div>
      </div>
    </div>

    ${renderStatsGrid(computeStats())}

    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Aktif Ticketlar</h3></div>
      <div class="sv2-section-body">
        ${renderDataTable({
          emptyMessage: "Açık ticket yok.",
          columns: [
            { key: "ticket_number", label: "NO", render: (v, r) => linkTicket(r.id, v) },
            { key: "title", label: "KONU" },
            { key: "priority", label: "ÖNCELİK", render: (v) => renderPriorityBadge(v) },
            { key: "status", label: "DURUM", render: (v) => renderStatusBadge(v) },
            { key: "created_at", label: "ATANMA", render: (v) => escapeHtml(formatDate(v)) },
          ],
          rows: openTickets().map((t) => ({ ...t, id: t.id || t.ticket_id })),
        })}
      </div>
    </div>

    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Tamamlanan Ticketlar</h3></div>
      <div class="sv2-section-body">
        ${renderDataTable({
          emptyMessage: "Tamamlanan ticket yok.",
          columns: [
            { key: "ticket_number", label: "NO", render: (v, r) => linkTicket(r.id, v) },
            { key: "title", label: "KONU" },
            { key: "sap_module", label: "MODÜL", render: (v) => escapeHtml(SAP_MODULE_LABELS[v] ? `${v}` : v || "—") },
            { key: "status", label: "DURUM", render: (v) => renderStatusBadge(v) },
            { key: "resolution", label: "ÇÖZÜM SÜRESİ", render: (_, r) => escapeHtml(resolutionDays(r)) },
          ],
          rows: completedTickets().map((t) => ({
            ...t,
            id: t.id || t.ticket_id,
            resolution: resolutionDays(t),
          })),
        })}
      </div>
    </div>

    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Aktivite Geçmişi</h3></div>
      <div class="sv2-section-body">
        ${renderTimeline(
          activities.slice(0, 20).map((a) => ({
            author: a.user_name || "Sistem",
            created_at: a.created_at,
            message: a.details || `${a.action} — ${a.entity_label || ""}`,
            variant: "admin",
          }))
        )}
      </div>
    </div>`;
}

function openEditModal() {
  const deptOpts = departments
    .map(
      (d) =>
        `<option value="${escapeHtml(d.id || d.department_id)}"${(d.id || d.department_id) === person.department_id ? " selected" : ""}>${escapeHtml(d.name)}</option>`
    )
    .join("");

  renderModal("modal-edit-person", {
    title: "Personel Düzenle",
    body: `
      <form id="edit-person-form">
        <div class="sv2-form-row">
          <div class="sv2-form-group">
            <label>Ad</label>
            <input type="text" name="first_name" value="${escapeHtml(person.first_name || "")}">
          </div>
          <div class="sv2-form-group">
            <label>Soyad</label>
            <input type="text" name="last_name" value="${escapeHtml(person.last_name || "")}">
          </div>
        </div>
        <div class="sv2-form-group">
          <label>E-posta</label>
          <input type="email" name="email" value="${escapeHtml(person.email || "")}">
        </div>
        <div class="sv2-form-group">
          <label>Telefon</label>
          <input type="tel" name="phone" value="${escapeHtml(person.phone || "")}">
        </div>
        <div class="sv2-form-group">
          <label>Departman</label>
          <select name="department_id">${deptOpts}</select>
        </div>
        <div class="sv2-form-group">
          <label>Rol Ünvanı</label>
          <input type="text" name="role_title" value="${escapeHtml(person.role_title || "")}">
        </div>
      </form>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="modal-edit-person">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="edit-person-save">Kaydet</button>`,
  });
  openModal("modal-edit-person");

  document.getElementById("edit-person-save")?.addEventListener("click", async () => {
    const form = document.getElementById("edit-person-form");
    const dept = departments.find((d) => (d.id || d.department_id) === form.department_id.value);
    const data = {
      first_name: form.first_name.value.trim(),
      last_name: form.last_name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      department_id: form.department_id.value,
      role_title: form.role_title.value.trim(),
    };
    const { valid, errors } = validatePersonnelForm(data);
    if (!valid) {
      toast(Object.values(errors)[0], "error");
      return;
    }
    showLoading(true);
    try {
      person = await ParlaDb.updatePersonnel(person.id || person.personnel_id, {
        ...data,
        department_name: dept?.name || person.department_name,
        updated_by: session.uid,
      });
      await ParlaDb.logActivity(
        "personnel_updated",
        "personnel",
        person.id || person.personnel_id,
        fullName(person),
        "Profil güncellendi",
        session
      );
      closeModal("modal-edit-person");
      toast("Personel güncellendi.", "success");
      refreshView();
    } catch (err) {
      handleError(err, "Güncelleme");
    } finally {
      showLoading(false);
    }
  });
}

function bindEvents() {
  document.getElementById("btn-edit-person")?.addEventListener("click", openEditModal);
  document.getElementById("btn-toggle-person")?.addEventListener("click", () => {
    const next = person.is_active === false;
    renderConfirmDialog(next ? "Personel aktive edilsin mi?" : "Personel pasife alınsın mı?", async () => {
      showLoading(true);
      try {
        person = await ParlaDb.updatePersonnel(person.id || person.personnel_id, {
          is_active: next,
          updated_by: session.uid,
        });
        await ParlaDb.logActivity(
          next ? "personnel_activated" : "personnel_deactivated",
          "personnel",
          person.id || person.personnel_id,
          fullName(person),
          "",
          session
        );
        toast(next ? "Personel aktive edildi." : "Personel pasife alındı.", "success");
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
    title: fullName(person),
    activePage: "personnel",
    profile: session,
    isAdmin: true,
    content: buildContent(),
  });
  bindEvents();
}

async function loadData(id) {
  person = await ParlaDb.getPersonnel(id);
  if (!person) return;

  const [depts, assignedTickets, allActivities] = await Promise.all([
    ParlaDb.getAllDepartments(),
    ParlaDb.getPersonnelTickets(id),
    ParlaDb.getActivities(150),
  ]);

  departments = depts;
  tickets = assignedTickets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  activities = allActivities.filter(
    (a) =>
      a.entity_id === id ||
      (a.entity_type === "personnel" && a.entity_id === id) ||
      tickets.some((t) => a.entity_id === (t.id || t.ticket_id))
  );
}

document.addEventListener("DOMContentLoaded", async () => {
  const id = getId();
  if (!id) {
    window.location.href = PATHS.adminPersonnel;
    return;
  }
  try {
    showLoading(true);
    session = await requireAuth({ adminOnly: true });
    await ParlaDb.waitForFirebase();
    await loadData(id);
    if (!person) {
      toast("Personel bulunamadı.", "error");
      setTimeout(() => { window.location.href = PATHS.adminPersonnel; }, 1500);
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
