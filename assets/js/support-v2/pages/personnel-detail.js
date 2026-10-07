/**
 * Parla BT Ticket V2 — Admin Personel Detayı
 */
import { formatNumber } from "../safe-utils.js";
import ParlaDb from "../firebase-client.js";
import { canWrite } from "../access-control.js";
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
  handleLoadError,
  linkTicket,
  escapeHtml,
  formatDate,
  renderStatusBadge,
  renderPriorityBadge,
} from "../ui-shell.js";
import { validatePersonnelForm } from "../validators.js";
import {
  STATUSES,
  SAP_MODULE_LABELS,
  isOpenStatus,
  getTicketKey,
  isResolvedThisMonth,
  resolutionDurationMs,
} from "../ticket-utils.js";
import { initPhoneInput, normalizePhone, formatPhoneDisplay, setPhoneValue } from "../phone-utils.js";
import { selectableDepartments } from "../entity-utils.js";

let session = null;
let person = null;
let departments = [];
let tickets = [];
let activities = [];
let personEfforts = [];
let assignmentByTicket = new Map(); // talep kimliği -> bu danışmanın atama kaydı ({is_primary, assigned_at})

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
  return tickets.filter((t) => isOpenStatus(t.status));
}

function completedTickets() {
  return tickets.filter((t) => t.status === STATUSES.RESOLVED || t.status === STATUSES.CLOSED);
}

function computeStats() {
  const open = openTickets();
  const completed = completedTickets();
  const closedThisMonth = completed.filter((t) => isResolvedThisMonth(t)).length;

  // Danışmanın KENDİ girdiği efor (efor kayıtlarındaki personel kimliği): başkalarının eforu bu danışmana yazılmaz (YON-14).
  const totalEffort = personEfforts.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);

  let avgDays = "—";
  const durations = completed.map(resolutionDurationMs).filter((d) => d !== null);
  if (durations.length) {
    avgDays = formatNumber(durations.reduce((a, b) => a + b, 0) / durations.length / 86400000) + " gün";
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
    { label: "Açık Talep", value: open.length, variant: "open" },
    { label: "Bu Ay Kapatılan", value: closedThisMonth, variant: "resolved" },
    { label: "Toplam Efor (kendi girdiği)", value: formatNumber(totalEffort) + " sa", variant: "in_progress" },
    { label: "Ort. Çözüm Süresi", value: avgDays, variant: "waiting" },
    { label: "En Yoğun Modül", value: topModuleLabel, variant: "critical" },
  ];
}

function resolutionDays(t) {
  const ms = resolutionDurationMs(t);
  return ms !== null && ms >= 0 ? formatNumber(ms / 86400000) + " gün" : "—";
}

function buildContent() {
  if (!person) {
    return `<div class="sv2-empty"><i class="fas fa-user-tie"></i><h4>Danışman bulunamadı</h4></div>`;
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
              <div class="sv2-meta-item"><label>Telefon</label><span>${escapeHtml(formatPhoneDisplay(person.phone))}</span></div>
              <div class="sv2-meta-item"><label>Departman</label><span>${escapeHtml(person.department_name || "—")}</span></div>
              <div class="sv2-meta-item"><label>Rol Ünvanı</label><span>${escapeHtml(person.role_title || "—")}</span></div>
              <div class="sv2-meta-item"><label>Durum</label><span>${active ? '<span class="sv2-badge sv2-badge-resolved">Aktif</span>' : '<span class="sv2-badge sv2-badge-closed">Pasif</span>'}</span></div>
            </div>
          </div>
          ${canWrite(session, "admin") ? `<div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <button type="button" class="sv2-btn sv2-btn-primary" id="btn-edit-person"><i class="fas fa-edit"></i> Düzenle</button>
            <button type="button" class="sv2-btn ${active ? "sv2-btn-danger" : "sv2-btn-outline"}" id="btn-toggle-person">
              ${active ? "Pasife Al" : "Aktive Et"}
            </button>
          </div>` : ""}
        </div>
      </div>
    </div>

    ${renderStatsGrid(computeStats())}

    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Aktif Talepler</h3></div>
      <div class="sv2-section-body">
        ${renderDataTable({
          emptyMessage: "Açık talep yok.",
          columns: [
            { key: "ticket_number", label: "NO", render: (v, r) => linkTicket(r.id, v) },
            { key: "title", label: "KONU" },
            { key: "priority", label: "ÖNCELİK", render: (v) => renderPriorityBadge(v) },
            { key: "status", label: "DURUM", render: (v) => renderStatusBadge(v) },
            { key: "role", label: "ROL" },
            { key: "assigned_at", label: "ATANMA", render: (v) => escapeHtml(formatDate(v)) },
          ],
          rows: openTickets().map((t) => {
            const id = t.id || t.ticket_id;
            const a = assignmentByTicket.get(id);
            return {
              ...t,
              id,
              role: a ? (a.is_primary ? "Birincil" : "İkincil") : t.assigned_to_id === (person.id || person.personnel_id) ? "Birincil" : "İkincil",
              // Atama tarihi: atama kaydındaki `assigned_at` (yoksa talepteki atama tarihi); talep oluşturma tarihi DEĞİL
              assigned_at: (a && a.assigned_at) || t.assigned_at || t.created_at,
            };
          }),
        })}
      </div>
    </div>

    <div class="sv2-section">
      <div class="sv2-section-header"><h3>Tamamlanan Talepler</h3></div>
      <div class="sv2-section-body">
        ${renderDataTable({
          emptyMessage: "Tamamlanan talep yok.",
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
  // Pasif departman seçilemez; yalnız mevcut departman pasif olsa da "(pasif)" etiketiyle listede kalır (YON-35).
  const deptOpts = selectableDepartments(departments, person.department_id)
    .map((d) => `<option value="${escapeHtml(d.id)}"${d.id === person.department_id ? " selected" : ""}>${escapeHtml(d.label)}</option>`)
    .join("");

  renderModal("modal-edit-person", {
    title: "Danışman Düzenle",
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
  const phoneInput = document.querySelector('#edit-person-form [name="phone"]');
  initPhoneInput(phoneInput).then(() => setPhoneValue(phoneInput, person.phone || ""));

  document.getElementById("edit-person-save")?.addEventListener("click", async () => {
    const form = document.getElementById("edit-person-form");
    const dept = departments.find((d) => (d.id || d.department_id) === form.department_id.value);
    const data = {
      first_name: form.first_name.value.trim(),
      last_name: form.last_name.value.trim(),
      email: form.email.value.trim(),
      phone: normalizePhone(form.phone) || form.phone.value.trim(),
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
      const pid = person.id || person.personnel_id;
      data.email = data.email.trim().toLowerCase();
      const emailChanged = data.email !== String(person.email || "").trim().toLowerCase();
      let uidPatch = {};
      if (emailChanged) {
        // E-posta benzersizliği ve müşteri hesabıyla çakışma (YON-13).
        const others = await ParlaDb.getAllPersonnel();
        if (others.some((p) => (p.personnel_id || p.id) !== pid && String(p.email || "").trim().toLowerCase() === data.email)) {
          toast("Bu e-posta başka bir personel kaydında kullanılıyor.", "error");
          return;
        }
        const conflict = await ParlaDb.emailHasConflictingRole(data.email, "consultant");
        if (conflict) {
          toast(conflict, "error");
          return;
        }
        // Yeni e-postayla eşleşen kullanıcı hesabı varsa kimlik bağı güncellenir.
        try {
          const match = (await ParlaDb.getAllUsers()).find(
            (u) => String(u.email || "").trim().toLowerCase() === data.email && ["consultant", "project_manager", "service_admin", "super_admin"].includes(String(u.role || "").toLowerCase())
          );
          if (match) uidPatch = { uid: match.uid || match.id };
        } catch {
          /* kullanıcı listesi okunamadı */
        }
      }
      // Kayıt + kopyalar: e-posta → atama kayıtlarındaki personnel_email (müşteri yanıtı doğru adrese gitsin; YON-04),
      // ad → atama/talep/proje ad kopyaları (YON-09).
      const result = await ParlaDb.updatePersonnelAndSync(pid, {
        ...data,
        ...uidPatch,
        department_name: dept?.name || person.department_name,
        updated_by: session.uid,
      });
      person = result.person;
      if (result.failed) {
        toast("Danışman güncellendi ancak atama/talep kopyaları tam güncellenemedi; düzenlemeyi yeniden kaydedin.", "warning");
      } else if (result.synced) {
        toast(`${result.synced} kayıttaki ad/e-posta kopyası güncellendi.`, "info");
      }
      await ParlaDb.logActivity(
        "personnel_updated",
        "personnel",
        person.id || person.personnel_id,
        fullName(person),
        "Profil güncellendi",
        session
      );
      closeModal("modal-edit-person");
      toast("Danışman güncellendi.", "success");
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
    const openCount = next ? 0 : openTickets().length;
    const message = next
      ? "Danışman aktive edilsin mi?"
      : openCount
        ? `Bu personele atanmış ${openCount} açık talep var. Pasife alınırsa bu talepler panoda "Pasif danışmanda" olarak sahipsiz görünür; önce başka danışmana devretmeniz önerilir. Yine de pasife alınsın mı?`
        : "Danışman pasife alınsın mı?";
    renderConfirmDialog(message, async () => {
      showLoading(true);
      try {
        // Pasife alınca atama kayıtlarındaki e-posta kopyaları boşaltılır (müşteri yanıtı pasif kişiye gitmesin);
        // yeniden aktifleşince geri yazılır.
        const result = await ParlaDb.updatePersonnelAndSync(person.id || person.personnel_id, {
          is_active: next,
          updated_by: session.uid,
        });
        person = result.person;
        await ParlaDb.logActivity(
          next ? "personnel_activated" : "personnel_deactivated",
          "personnel",
          person.id || person.personnel_id,
          fullName(person),
          "",
          session
        );
        toast(next ? "Danışman aktive edildi." : "Danışman pasife alındı.", "success");
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

  // Yalnız bu danışmanı ilgilendiren veriler (birincil: assigned_to_id indeksi; ikincil: atama kayıtları; aktivite: sunucu süzmeli).
  const [depts, primaryTickets, assignMap, entityActs, userActs, allEfforts] = await Promise.all([
    ParlaDb.getAllDepartments(),
    ParlaDb.getPersonnelTickets(id),
    ParlaDb.getAllAssignments().catch(() => ({})),
    ParlaDb.getActivitiesByField("entity_id", id, 50).catch(() => []),
    person.uid ? ParlaDb.getActivitiesByField("user_uid", person.uid, 50).catch(() => []) : Promise.resolve([]),
    ParlaDb.getAllTicketEfforts().catch(() => []),
  ]);

  departments = depts;
  assignmentByTicket = new Map();
  const secondaryIds = [];
  for (const [tid, list] of Object.entries(assignMap)) {
    const rec = (list || []).find((a) => a.personnel_id === id);
    if (!rec) continue;
    assignmentByTicket.set(tid, rec);
    if (!primaryTickets.some((t) => getTicketKey(t) === tid)) secondaryIds.push(tid);
  }
  const secondary = (await Promise.all(secondaryIds.map((tid) => ParlaDb.getTicket(tid).catch(() => null)))).filter(
    (t) => t && t.is_deleted !== true
  );
  tickets = [...primaryTickets, ...secondary].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const ticketIds = new Set(tickets.map((t) => getTicketKey(t)));
  personEfforts = allEfforts.filter((e) => e.personnel_id === id);
  activities = [...entityActs, ...userActs]
    .filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .filter((a) => a.entity_id === id || a.user_uid === person.uid || ticketIds.has(a.entity_id));
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
      toast("Danışman bulunamadı.", "error");
      setTimeout(() => { window.location.href = PATHS.adminPersonnel; }, 1500);
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
