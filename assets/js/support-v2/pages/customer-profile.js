/**
 * Parla BT Ticket V2 — müşteri profil sayfası
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth } from "../auth-guard.js";
import {
  renderShell,
  renderStatsGrid,
  showLoading,
  handleError,
  formatDateTime,
  escapeHtml,
} from "../ui-shell.js";
import {
  STATUSES,
  formatRoleLabel,
} from "../ticket-utils.js";

const app = document.getElementById("sv2-app");
let session = null;

const ACTIVE_STATUSES = ["open", "in_progress", "waiting_customer"];

function computeTicketStats(tickets) {
  const active = tickets.filter((t) =>
    ACTIVE_STATUSES.includes(String(t.status).toLowerCase())
  ).length;
  const resolved = tickets.filter((t) => {
    const s = String(t.status).toLowerCase();
    return s === STATUSES.RESOLVED || s === STATUSES.CLOSED;
  }).length;
  return { total: tickets.length, active, resolved };
}

function renderPage(company, tickets) {
  const stats = computeTicketStats(tickets);
  const fullName = [session.first_name, session.last_name].filter(Boolean).join(" ") || "—";

  const content = `
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Profil Bilgileri</h3>
      </div>
      <div class="sv2-section-body">
        <div class="sv2-meta-grid">
          <div class="sv2-meta-item">
            <label>Ad Soyad</label>
            <span>${escapeHtml(fullName)}</span>
          </div>
          <div class="sv2-meta-item">
            <label>E-posta</label>
            <span>${escapeHtml(session.email || "—")}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Telefon</label>
            <span>${escapeHtml(session.phone || "—")}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Rol</label>
            <span><span class="sv2-role-badge customer">${escapeHtml(formatRoleLabel(session.role))}</span></span>
          </div>
          <div class="sv2-meta-item">
            <label>Firma</label>
            <span>${escapeHtml(session.company_name || company?.name || "—")}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Müşteri Kodu</label>
            <span>${escapeHtml(session.customer_code || company?.customer_code || "—")}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Son Giriş</label>
            <span>${escapeHtml(formatDateTime(session.last_login_at))}</span>
          </div>
          <div class="sv2-meta-item">
            <label>Hesap Durumu</label>
            <span>${session.is_active !== false ? "Aktif" : "Pasif"}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Talep İstatistikleri</h3>
      </div>
      <div class="sv2-section-body">
        ${renderStatsGrid([
          { label: "Toplam Talep", value: stats.total },
          { label: "Aktif Talep", value: stats.active, variant: "open" },
          { label: "Çözülen", value: stats.resolved, variant: "success" },
        ])}
      </div>
    </div>`;

  renderShell(app, {
    title: "Profil",
    activePage: "profile",
    profile: session,
    isAdmin: false,
    content,
  });
}

async function init() {
  showLoading(true);
  try {
    session = await requireAuth({ customerOnly: true });

    const [company, tickets] = await Promise.all([
      session.company_id ? ParlaDb.getCompany(session.company_id) : Promise.resolve(null),
      ParlaDb.getTicketsForUser(session.uid),
    ]);

    renderPage(company, tickets);
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_customer") {
      handleError(err, "Profil yükleme");
    }
  } finally {
    showLoading(false);
  }
}

init();
