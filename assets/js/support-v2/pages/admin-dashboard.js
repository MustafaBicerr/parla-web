/**
 * Parla BT Ticket V2 — Admin Dashboard
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, PATHS } from "../auth-guard.js";
import {
  renderShell,
  renderStatsGrid,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  renderEmptyState,
  renderStatusBadge,
  renderPriorityBadge,
  toast,
  showLoading,
  handleError,
  handleLoadError,
  withInflight,
  linkTicket,
  formatDateTime,
  formatTicketTypeLabel,
  escapeHtml,
  renderConfirmDialog,
} from "../ui-shell.js";
import {
  TICKET_TYPE_LABELS,
  getTicketKey,
  computeSla,
  isOpenStatus,
  isClosedToday,
  isResolvedThisMonth,
  resolutionDurationMs,
  isSameIstanbulDay,
} from "../ticket-utils.js";
import ParlaEmailService from "../email-service.js";
import { reportEmailResult } from "../email-report.js";
import { describeActivity, activityIconClass } from "../activity-labels.js";
import { safeText, formatNumber } from "../safe-utils.js";

const ADMIN_ROLES = ["super_admin", "service_admin", "project_manager", "consultant"];

/** Danışman rolü atama yapamaz (ticket sayfasındaki Admin Paneli ile aynı kural). */
function canAssignTickets() {
  return ["super_admin", "service_admin", "project_manager"].includes(String(session?.role || "").toLowerCase());
}

let session = null;
let allTickets = [];
let allPersonnel = [];
let assignmentsByTicket = {};
let allEfforts = [];

/** Talebin tüm atananları (atama kayıtları; yoksa birincil danışman). */
function ticketAssigneeIds(t) {
  const list = assignmentsByTicket[getTicketKey(t)];
  const ids = list && list.length ? list.map((a) => a.personnel_id) : [];
  if (!ids.length && t.assigned_to_id) ids.push(t.assigned_to_id);
  return ids;
}

function avgResolutionLabel(tickets) {
  const durations = tickets.map(resolutionDurationMs).filter((d) => d !== null);
  if (!durations.length) return "—";
  const avgHours = durations.reduce((a, b) => a + b, 0) / durations.length / (1000 * 60 * 60);
  if (avgHours < 24) return `${formatNumber(avgHours)} saat`;
  return `${formatNumber(avgHours / 24)} gün`;
}

/** Aktif personel kimlikleri; pasif/bilinmeyen danışmana atanmış açık talepler "sahipsiz"dir (SEN-21, YON-15). */
function isOrphaned(t, activeIds) {
  const ids = ticketAssigneeIds(t);
  return ids.length > 0 && !ids.some((pid) => activeIds.has(pid));
}

function computeStats(tickets, personnel) {
  const activeIds = new Set((personnel || []).filter((p) => p.is_active !== false).map((p) => p.personnel_id || p.id));
  const open = tickets.filter((t) => isOpenStatus(t.status));
  const critical = open.filter((t) => String(t.priority).toLowerCase() === "critical");
  const todayOpened = tickets.filter((t) => isSameIstanbulDay(t.created_at));
  const todayClosed = tickets.filter((t) => isClosedToday(t));
  const unassigned = open.filter((t) => ticketAssigneeIds(t).length === 0);
  const orphaned = open.filter((t) => isOrphaned(t, activeIds));
  const monthResolved = tickets.filter((t) => isResolvedThisMonth(t));

  return {
    totalOpen: open.length,
    critical: critical.length,
    todayOpened: todayOpened.length,
    todayClosed: todayClosed.length,
    unassigned: unassigned.length,
    orphaned: orphaned.length,
    monthResolved: monthResolved.length,
    avgResolution: avgResolutionLabel(tickets),
    // SLA aşımı: açık talepte herhangi bir hedef aşıldı (saklı ihlal damgaları dahil; duraklatma gerçekten süreyi durdurur).
    slaBreached: open.filter((t) => computeSla(t)?.breached).length,
  };
}

function computeTypeDistribution(tickets) {
  const counts = {};
  for (const t of tickets) {
    const type = String(t.ticket_type || "SUP").toUpperCase();
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function renderBarChart(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    return renderEmptyState("Henüz talep verisi yok.", "fa-chart-bar");
  }
  const max = Math.max(...entries.map((e) => e[1]), 1);
  const bars = entries
    .map(([type, count]) => {
      const pct = Math.max(4, Math.round((count / max) * 100));
      const label = TICKET_TYPE_LABELS[type] ? type : type;
      return `
        <div class="sv2-bar">
          <span class="sv2-bar-value">${count}</span>
          <div class="sv2-bar-fill" style="height:${pct}%"></div>
          <span class="sv2-bar-label" title="${escapeHtml(formatTicketTypeLabel(type))}">${escapeHtml(label)}</span>
        </div>`;
    })
    .join("");
  return `<div class="sv2-bar-chart">${bars}</div>`;
}

/** Danışman iş yükü: ikincil danışmanlar da sayılır; efor kişinin kendi eforudur (açık taleplerinde). */
function computeConsultantWorkload(tickets, personnel, efforts) {
  const open = tickets.filter((t) => isOpenStatus(t.status));
  const openIds = new Set(open.map((t) => getTicketKey(t)));
  const map = {};
  for (const p of personnel) {
    if (p.is_active === false) continue;
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
    map[p.personnel_id || p.id] = {
      id: p.personnel_id || p.id,
      name,
      open: 0,
      critical: 0,
      totalHours: 0,
    };
  }
  for (const t of open) {
    for (const pid of ticketAssigneeIds(t)) {
      if (!map[pid]) continue;
      map[pid].open++;
      if (String(t.priority).toLowerCase() === "critical") map[pid].critical++;
    }
  }
  for (const e of efforts || []) {
    if (!openIds.has(e.ticket_id) || !map[e.personnel_id]) continue;
    map[e.personnel_id].totalHours += parseFloat(e.hours) || 0;
  }
  return Object.values(map)
    .filter((r) => r.open > 0 || personnel.some((p) => (p.personnel_id || p.id) === r.id))
    .sort((a, b) => b.open - a.open);
}

function formatActivityText(activity) {
  return describeActivity(activity);
}

function activityIcon(action) {
  return activityIconClass(action);
}

function renderActivityFeed(activities) {
  if (!activities.length) {
    return renderEmptyState("Henüz aktivite kaydı yok.", "fa-history");
  }
  // Satır başına try/catch: tek bir bozuk aktivite kaydı panoyu çökertmez (SEC-02).
  return activities
    .map((a) => {
      try {
        return `
    <div class="sv2-notif-item">
      <div class="sv2-notif-icon"><i class="fas ${activityIcon(a.action)}"></i></div>
      <div>
        <div class="sv2-notif-text">${escapeHtml(formatActivityText(a))}</div>
        <div class="sv2-notif-time">${escapeHtml(safeText(a.user_name) || "Sistem")} · ${escapeHtml(formatDateTime(safeText(a.created_at)))}</div>
      </div>
    </div>`;
      } catch (err) {
        console.warn("[Parla V2] aktivite kaydı atlandı", err);
        return "";
      }
    })
    .join("");
}

function personnelOptions(selectedId) {
  return allPersonnel
    .filter((p) => p.is_active !== false)
    .map((p) => {
      const id = p.personnel_id || p.id;
      const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
      const sel = id === selectedId ? " selected" : "";
      return `<option value="${escapeHtml(id)}"${sel}>${escapeHtml(name)}</option>`;
    })
    .join("");
}

function openAssignModal(ticket) {
  renderModal("sv2-assign-modal", {
    title: "Danışman Ata",
    body: `
      <p><strong>${escapeHtml(ticket.ticket_number)}</strong> — ${escapeHtml(ticket.title || "")}</p>
      <div class="sv2-form-group">
        <label for="sv2-assign-personnel">Danışman</label>
        <select id="sv2-assign-personnel">
          <option value="">— Seçiniz —</option>
          ${personnelOptions(ticket.assigned_to_id)}
        </select>
      </div>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="sv2-assign-modal">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="sv2-assign-save">Ata</button>`,
  });
  openModal("sv2-assign-modal");

  const assignSaveBtn = document.getElementById("sv2-assign-save");
  assignSaveBtn?.addEventListener("click", () => withInflight(assignSaveBtn, async () => {
    const select = document.getElementById("sv2-assign-personnel");
    const pid = select?.value;
    if (!pid) {
      toast("Lütfen bir danışman seçin.", "error");
      return;
    }
    const person = allPersonnel.find((p) => (p.personnel_id || p.id) === pid);
    const name = person
      ? [person.first_name, person.last_name].filter(Boolean).join(" ")
      : "";

    showLoading(true);
    try {
      const report = {};
      const updated = await ParlaDb.assignConsultants(
        getTicketKey(ticket),
        [
          {
            personnel_id: pid,
            personnel_name: name,
            personnel_email: person?.email || "",
            personnel_uid: person?.uid || "",
            is_primary: true,
          },
        ],
        session,
        { expectedStatus: ticket.status, report, activity: { action: "ticket_assigned", details: `${name} atandı` } }
      );
      if (report.unmatched?.length) {
        toast(
          `${report.unmatched.join(", ")} için kullanıcı hesabı eşleşmesi yok; danışman bu talepte işlem yapamaz. "Personel ↔ kullanıcı eşleştir" aracını çalıştırın.`,
          "warning"
        );
      }
      {
        // WP-05: alıcılar sunucuda atama geçmişinden türetilir (yeni danışman, önceki danışman "talep sizden alındı", müşteri).
        // İşlemi yapanın kendi adresi sunucuda ayıklanır; değişiklik yoksa e-posta gitmez (aynı kişiye tekrar "Ata" mükerrer üretmez).
        const mailResult = await ParlaEmailService.notifyTicketEvent("ticket_assignment_changed", "@assigned", updated, {});
        await reportEmailResult(mailResult, {
          eventType: "ticket_assignment_changed",
          label: "Atama e-postası",
          ticket: updated,
          actor: session,
        });
      }
      toast("Danışman ataması kaydedildi.", "success");
      closeModal("sv2-assign-modal");
      // Tüm koleksiyonu yeniden indirmek yerine yerel durum güncellenir; yalnız küçük düğümler (atamalar + son 20 aktivite) yenilenir.
      const key = getTicketKey(ticket);
      allTickets = allTickets.map((t) => (getTicketKey(t) === key ? updated : t));
      const [assignMap, recent] = await Promise.all([
        ParlaDb.getAllAssignments().catch(() => assignmentsByTicket),
        ParlaDb.getActivities(20).catch(() => []),
      ]);
      assignmentsByTicket = assignMap;
      renderDashboard(recent);
    } catch (err) {
      handleError(err, "Atama");
    } finally {
      showLoading(false);
    }
  }));
}

const EMAIL_ADMIN_ROLES = ["super_admin", "service_admin"];

function canSeeEmailHealth() {
  return EMAIL_ADMIN_ROLES.includes(String(session?.role || "").toLowerCase());
}

function renderEmailHealthSection() {
  if (!canSeeEmailHealth()) return "";
  return `
    <div class="sv2-section sv2-mb-1" id="sv2-email-health">
      <div class="sv2-section-header">
        <h3><i class="fas fa-envelope"></i> E-posta Servisi</h3>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-outline" id="sv2-email-diagnose">Durumu Kontrol Et</button>
          <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-primary" id="sv2-email-test">Test E-postası Gönder</button>
        </div>
      </div>
      <div class="sv2-section-body">
        <p id="sv2-email-health-status" class="sv2-text-muted" style="margin:0">Kontrol ediliyor…</p>
      </div>
    </div>`;
}

function renderMaintenanceSection() {
  if (String(session?.role || "").toLowerCase() !== "super_admin") return "";
  return `
    <div class="sv2-section sv2-mb-1" id="sv2-maintenance">
      <div class="sv2-section-header">
        <h3><i class="fas fa-tools"></i> Veri Bakımı</h3>
        <button type="button" class="sv2-btn sv2-btn-sm sv2-btn-outline" id="sv2-migrate-notes">İç Notları Taşı</button>
      </div>
      <div class="sv2-section-body">
        <p class="sv2-text-muted" style="margin:0" id="sv2-maintenance-status">
          Eski sürümde mesajlarla birlikte saklanan dahili notları, yalnızca personelin okuyabildiği ayrı alana taşır.
          Güvenle tekrar çalıştırılabilir.
        </p>
      </div>
    </div>`;
}

function bindMaintenance() {
  document.getElementById("sv2-migrate-notes")?.addEventListener("click", () => {
    // Sistem penceresi (window.confirm) yerine ortak onay bileşeni: odak yönetimi ve ayırt edilebilir düğmeler (UX-42).
    renderConfirmDialog("Eski dahili notlar yalnızca personelin görebileceği alana taşınacak. Devam edilsin mi?", runNoteMigration, { title: "Veri bakımı onayı", danger: false });
  });
}

async function runNoteMigration() {
  {
    showLoading(true);
    const status = document.getElementById("sv2-maintenance-status");
    try {
      const { tickets, moved } = await ParlaDb.migrateInternalMessages({
        onProgress: (done, total) => {
          if (status) status.textContent = `Taşınıyor… ${done}/${total} talep tarandı`;
        },
      });
      status.textContent = moved
        ? `${moved} dahili not ${tickets} talepten taşındı.`
        : "Taşınacak eski dahili not bulunmadı.";
      toast(status.textContent, "success");
    } catch (err) {
      status.textContent = "Taşıma başarısız: " + (err.message || err);
      handleError(err, "Veri bakımı");
    } finally {
      showLoading(false);
    }
  }
}

function setEmailHealthStatus(kind, message) {
  const el = document.getElementById("sv2-email-health-status");
  if (!el) return;
  const icon = kind === "ok" ? "fa-check-circle" : kind === "warn" ? "fa-exclamation-triangle" : "fa-times-circle";
  const color = kind === "ok" ? "#0d7d4d" : kind === "warn" ? "#c47a00" : "#c41e3a";
  el.innerHTML = `<i class="fas ${icon}" style="color:${color}"></i> ${escapeHtml(message)}`;
}

async function refreshEmailHealth() {
  if (!canSeeEmailHealth()) return;
  const health = await ParlaEmailService.health();
  if (!health.reachable) {
    setEmailHealthStatus(
      "error",
      "E-posta servisine ulaşılamıyor: /api/send-email bu sitede yayında değil (Netlify function deploy edilmemiş veya site Firebase Hosting'de çalışıyor olabilir)."
    );
  } else if (!health.configured) {
    setEmailHealthStatus("error", "Servis yayında ama RESEND_API_KEY tanımlı değil (Netlify → Environment variables).");
  } else {
    setEmailHealthStatus(
      "ok",
      `Servis yayında ve anahtar tanımlı (gönderen: ${health.from}). Alan adı doğrulamasını görmek için "Durumu Kontrol Et" düğmesini kullanın.`
    );
  }
}

function bindEmailHealth() {
  if (!canSeeEmailHealth()) return;

  document.getElementById("sv2-email-diagnose")?.addEventListener("click", async () => {
    showLoading(true);
    try {
      const res = await ParlaEmailService.diagnose();
      if (!res.success) {
        setEmailHealthStatus("error", res.message || "Tanılama başarısız.");
        return;
      }
      const d = res.data || {};
      if (d.domain_status === "verified") {
        setEmailHealthStatus("ok", `${d.domain} alan adı Resend'de doğrulanmış. Test e-postası ile uçtan uca doğrulayabilirsiniz.`);
      } else if (d.domain_status === "unknown") {
        setEmailHealthStatus(d.key_valid === false ? "error" : "warn", d.note || "Alan adı durumu okunamadı.");
      } else {
        setEmailHealthStatus("error", `${d.domain}: ${d.domain_status}. ${d.note || ""}`.trim());
      }
    } finally {
      showLoading(false);
    }
  });

  document.getElementById("sv2-email-test")?.addEventListener("click", async () => {
    showLoading(true);
    try {
      const res = await ParlaEmailService.sendTest();
      if (res.success) {
        setEmailHealthStatus("ok", `Test e-postası ${session.email} adresine gönderildi. Gelen kutusunu ve spam klasörünü kontrol edin.`);
        toast("Test e-postası gönderildi.", "success");
      } else {
        setEmailHealthStatus("error", res.message || "Test e-postası gönderilemedi.");
        toast(res.message || "Test e-postası gönderilemedi.", "error");
      }
    } finally {
      showLoading(false);
    }
  });

  refreshEmailHealth();
}

function buildContent(stats, typeCounts, workload, unassigned, activities) {
  const statCards = [
    { label: "Toplam Açık", value: stats.totalOpen, variant: "open" },
    { label: "Kritik", value: stats.critical, variant: "critical" },
    { label: "Bugün Açılan", value: stats.todayOpened, variant: "" },
    { label: "Bugün Kapanan", value: stats.todayClosed, variant: "success" },
    { label: "Atanmamış", value: stats.unassigned, variant: "waiting" },
    { label: "Pasif Danışmanda", value: stats.orphaned, variant: "critical", hint: "Atandığı tüm danışmanlar pasif: yeniden atanmalı" },
    { label: "SLA Aşımı", value: stats.slaBreached, variant: "critical", hint: "Açık taleplerde hedef süre aşıldı" },
    { label: "Bu Ay Çözülen", value: stats.monthResolved, variant: "resolved" },
    { label: "Ort. Çözüm Süresi", value: stats.avgResolution, variant: "" },
  ];

  const workloadRows = workload.map((w) => ({
    id: w.id,
    name: w.name,
    open: w.open,
    critical: w.critical,
    hours: formatNumber(w.totalHours),
  }));

  const unassignedRows = unassigned.slice(0, 10).map((t) => ({
    id: getTicketKey(t),
    number: t.ticket_number,
    title: t.title,
    priority: t.priority,
    status: t.status,
    created: t.created_at,
    orphan: ticketAssigneeIds(t).length > 0,
    _ticket: t,
  }));

  return `
    ${renderStatsGrid(statCards)}
    <div class="sv2-form-row sv2-mb-1">
      <div class="sv2-section">
        <div class="sv2-section-header"><h3>Talep Tipi Dağılımı</h3></div>
        <div class="sv2-section-body">${renderBarChart(typeCounts)}</div>
      </div>
      <div class="sv2-section">
        <div class="sv2-section-header"><h3>Son Aktiviteler</h3></div>
        <div class="sv2-section-body sv2-notif-panel-body" style="max-height:280px;overflow-y:auto">
          ${renderActivityFeed(activities)}
        </div>
      </div>
    </div>
    <div class="sv2-section sv2-mb-1">
      <div class="sv2-section-header"><h3>Danışman İş Yükü</h3></div>
      <div class="sv2-section-body">
        ${
          workloadRows.length
            ? renderDataTable({
                columns: [
                  { key: "name", label: "Danışman" },
                  { key: "open", label: "Açık Talep" },
                  { key: "critical", label: "Kritik" },
                  { key: "hours", label: "Toplam Efor (saat)" },
                ],
                rows: workloadRows,
              })
            : renderEmptyState("Aktif danışman bulunamadı.", "fa-user-tie")
        }
      </div>
    </div>
    ${renderEmailHealthSection()}
    ${renderMaintenanceSection()}
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Atanmamış / Sahipsiz Talepler</h3>
        <a href="${PATHS.adminTickets}?filter=unassigned" class="sv2-btn sv2-btn-sm sv2-btn-outline">Tümünü Gör</a>
      </div>
      <div class="sv2-section-body" id="sv2-unassigned-wrap">
        ${
          unassignedRows.length
            ? `<div class="sv2-table-wrap"><table class="sv2-table">
              <thead><tr>
                <th>NO</th><th>KONU</th><th>ÖNCELİK</th><th>DURUM</th><th>TARİH</th><th>İŞLEM</th>
              </tr></thead>
              <tbody id="sv2-unassigned-tbody">
                ${unassignedRows
                  .map(
                    (r) => `
                  <tr data-id="${escapeHtml(r.id)}">
                    <td>${linkTicket(r.id, r.number)}</td>
                    <td>${escapeHtml(r.title || "—")}</td>
                    <td>${renderPriorityBadge(r.priority)}</td>
                    <td>${renderStatusBadge(r.status)}${r.orphan ? ' <span class="sv2-badge sv2-badge-closed" title="Atandığı danışman(lar) pasif">Pasif danışman</span>' : ""}</td>
                    <td>${escapeHtml(formatDateTime(r.created))}</td>
                    <td>${canAssignTickets() ? `<button type="button" class="sv2-btn sv2-btn-sm sv2-btn-primary sv2-quick-assign" data-id="${escapeHtml(r.id)}">Ata</button>` : `<a href="${PATHS.adminTicketDetail}?id=${encodeURIComponent(r.id)}" class="sv2-btn sv2-btn-sm sv2-btn-outline">Aç</a>`}</td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table></div>`
            : renderEmptyState("Atanmamış açık talep yok.", "fa-check-circle")
        }
      </div>
    </div>`;
}

/** Yüklenmiş yerel veriden panoyu çizer (veri indirmez). */
function renderDashboard(activities) {
  const tickets = allTickets;
  const personnel = allPersonnel;
  const activeIds = new Set(personnel.filter((p) => p.is_active !== false).map((p) => p.personnel_id || p.id));
  const stats = computeStats(tickets, personnel);
  const typeCounts = computeTypeDistribution(tickets);
  const workload = computeConsultantWorkload(tickets, personnel, allEfforts);
  // Atanmamış + atandığı tüm danışmanlar pasif olan (sahipsiz) açık talepler.
  const unassigned = tickets
    .filter((t) => isOpenStatus(t.status) && (ticketAssigneeIds(t).length === 0 || isOrphaned(t, activeIds)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const content = buildContent(stats, typeCounts, workload, unassigned, activities);

  renderShell("#sv2-app", {
    title: "Genel Bakış",
    activePage: "dashboard",
    profile: session,
    isAdmin: true,
    content,
  });

  bindEmailHealth();
  bindMaintenance();

  document.querySelectorAll(".sv2-quick-assign").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const ticket = allTickets.find((t) => getTicketKey(t) === id);
      if (ticket) openAssignModal(ticket);
    });
  });
}

async function loadAndRender() {
  showLoading(true);
  try {
    const [tickets, personnel, activities, assignMap, efforts] = await Promise.all([
      ParlaDb.getAllTickets(),
      ParlaDb.getAllPersonnel(),
      ParlaDb.getActivities(20),
      ParlaDb.getAllAssignments().catch(() => ({})),
      ParlaDb.getAllTicketEfforts().catch(() => []),
    ]);
    allTickets = tickets;
    allPersonnel = personnel;
    assignmentsByTicket = assignMap;
    allEfforts = efforts;
    renderDashboard(activities);
  } catch (err) {
    handleLoadError(err, "Genel bakış yüklenemedi", { retry: loadAndRender, activePage: "dashboard", pageTitle: "Genel Bakış", isAdmin: true });
  } finally {
    showLoading(false);
  }
}

async function init() {
  try {
    session = await requireAuth({
      adminOnly: true,
      roles: ADMIN_ROLES,
    });
    await loadAndRender();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin" && err.message !== "role_denied") {
      handleError(err, "Oturum");
    }
  }
}

init();
