/**
 * Parla BT Ticket V2 — Admin Muhataplar (Kullanıcı Yönetimi)
 */
import ParlaDb from "../firebase-client.js";
import { requirePage } from "../access-control.js";
import { createUserAccount, PATHS, resetPassword } from "../auth-guard.js";
import {
  renderShell,
  toast,
  showLoading,
  renderFilterBar,
  renderDataTable,
  renderModal,
  openModal,
  closeModal,
  renderAutocomplete,
  bindFilterChips,
  renderEmptyState,
  handleError,
  handleLoadError,
  loadingStateHtml,
  linkUser,
  linkCompany,
  escapeHtml,
  formatDate,
  formatDateTime,
} from "../ui-shell.js";
import {
  ROLES,
  ROLE_LABELS,
  generateTempPassword,
  formatRoleLabel,
  matchesSearch,
  isCustomerRole,
} from "../ticket-utils.js";
import { validateCompanyForm, validateUserForm } from "../validators.js";
import ParlaEmailService from "../email-service.js";
import { initPhoneInput, normalizePhone, formatPhoneDisplay } from "../phone-utils.js";
import { callAdminUsers, assignableRoles, isHighPrivilegeRole, warningsText, phoneInputError } from "../user-admin.js";
import { suggestNextCode, validateCustomerCode } from "../company-code.js";

let session = null;
let allUsers = [];
let allCompanies = [];
let filters = { search: "", role: "all", status: "all" };
// Yükleniyor/hata durumunda "Henüz kayıtlı kullanıcı yok" yanıltması olmasın (YON-30).
let loadState = "loading"; // loading | ok | error
let selectedCompany = null;
// Sunucu tarafı kullanıcı yönetimi işlevi (/api/admin-users): unknown | available | unavailable (servis hesabı yok → eski akış)
let adminApi = "unknown";
let submitting = false;

function fullName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || "—";
}

function renderRoleBadge(role) {
  const key = String(role || "").toLowerCase();
  let cls = "customer";
  if (key === "super_admin" || key === "service_admin") cls = "admin";
  else if (key === "consultant" || key === "project_manager") cls = "agent";
  return `<span class="sv2-role-badge ${cls}">${escapeHtml(formatRoleLabel(role))}</span>`;
}

function renderActiveBadge(isActive) {
  return isActive !== false
    ? `<span class="sv2-badge sv2-badge-resolved">Aktif</span>`
    : `<span class="sv2-badge sv2-badge-closed">Pasif</span>`;
}

function clearFormErrors(form) {
  form.querySelectorAll(".sv2-form-group").forEach((g) => {
    g.classList.remove("has-error");
    g.querySelector(".sv2-field-error")?.remove();
  });
}

function showFormErrors(form, errors) {
  clearFormErrors(form);
  Object.entries(errors).forEach(([field, message]) => {
    const el = form.querySelector(`[name="${field}"]`);
    const group = el?.closest(".sv2-form-group");
    if (!group) return;
    group.classList.add("has-error");
    const err = document.createElement("div");
    err.className = "sv2-field-error";
    err.textContent = message;
    group.appendChild(err);
  });
}

function filterUsers() {
  const q = filters.search.trim();
  return allUsers.filter((u) => {
    if (filters.role !== "all") {
      if (filters.role === "admin") {
        if (![ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN].includes(u.role)) return false;
      } else if (u.role !== filters.role) return false;
    }
    if (filters.status === "active" && u.is_active === false) return false;
    if (filters.status === "inactive" && u.is_active !== false) return false;
    return matchesSearch(q, [
      u.first_name,
      u.last_name,
      u.email,
      u.company_name,
      u.phone,
      u.contact_code,
      u.customer_code,
    ]);
  });
}

function buildPageContent() {
  const rows = filterUsers().map((u) => ({
    id: u.uid || u.id,
    name: fullName(u),
    email: u.email || "—",
    phone: u.phone || "",
    company: u.company_name || "—",
    company_id: u.company_id,
    contact_code: u.contact_code || "—",
    role: u.role,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
    is_active: u.is_active,
  }));

  return `
    ${renderBreadcrumbLocal()}
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Kullanıcılar</h3>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
          <button type="button" class="sv2-btn sv2-btn-outline" id="btn-repair-user" title="Firebase'de hesabı olan ama portalda profili bulunmayan hesabı kaydedin">
            <i class="fas fa-wrench"></i> Yetim Hesabı Onar
          </button>
          <button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-user">
            <i class="fas fa-plus"></i> Yeni Kullanıcı
          </button>
        </div>
      </div>
      <div class="sv2-section-body">
        ${loadState === "ok" && allUsers.length === 0 ? renderEmptyState("Henüz kayıtlı kullanıcı yok. İlk hesabı oluşturmak için Yeni Kullanıcı butonuna tıklayın.", "fa-user-plus") : ""}
        ${renderFilterBar({
          search: { id: "users-search", placeholder: "Ad, e-posta veya firma ara...", value: filters.search },
          chips: [
            { value: "all", label: "Tüm Roller", active: filters.role === "all" },
            { value: ROLES.COMPANY_ADMIN, label: "Firma Yön.", active: filters.role === ROLES.COMPANY_ADMIN },
            { value: ROLES.CUSTOMER, label: "Müşteri", active: filters.role === ROLES.CUSTOMER },
            { value: ROLES.ARIZI_CUSTOMER, label: "Arızi Müşteri", active: filters.role === ROLES.ARIZI_CUSTOMER },
            { value: ROLES.CONSULTANT, label: "Danışman", active: filters.role === ROLES.CONSULTANT },
            { value: ROLES.PROJECT_MANAGER, label: "Proje Yön.", active: filters.role === ROLES.PROJECT_MANAGER },
            { value: "admin", label: "Admin", active: filters.role === "admin" },
          ],
        })}
        <div class="sv2-filter-chips sv2-mt-1" id="status-chips">
          <button type="button" class="sv2-chip${filters.status === "all" ? " is-active" : ""}" data-value="all">Tüm Durumlar</button>
          <button type="button" class="sv2-chip${filters.status === "active" ? " is-active" : ""}" data-value="active">Aktif</button>
          <button type="button" class="sv2-chip${filters.status === "inactive" ? " is-active" : ""}" data-value="inactive">Pasif</button>
        </div>
        <div id="users-table-wrap" class="sv2-mt-1">
          ${loadState === "ok" ? renderUsersTable(rows) : loadState === "loading" ? loadingStateHtml("Kullanıcılar yükleniyor…") : ""}
        </div>
      </div>
    </div>`;
}

function renderBreadcrumbLocal() {
  return `<nav class="sv2-breadcrumb" aria-label="Breadcrumb">
    <a href="${PATHS.adminDashboard}" class="sv2-breadcrumb-link">Genel Bakış</a>
    <span class="sv2-breadcrumb-sep">›</span>
    <span class="sv2-breadcrumb-current">Kullanıcılar</span>
  </nav>`;
}

function renderUsersTable(rows) {
  return renderDataTable({
    emptyMessage: "Kullanıcı bulunamadı.",
    columns: [
      {
        key: "name",
        label: "AD SOYAD",
        render: (_, row) => linkUser(row.id, row.name),
      },
      { key: "email", label: "E-POSTA" },
      {
        key: "phone",
        label: "TELEFON",
        render: (v) => escapeHtml(formatPhoneDisplay(v)),
      },
      {
        key: "company",
        label: "FİRMA",
        render: (_, row) =>
          row.company_id
            ? linkCompany(row.company_id, row.company)
            : escapeHtml(row.company),
      },
      {
        key: "role",
        label: "ROL",
        render: (v) => renderRoleBadge(v),
      },
      {
        key: "created_at",
        label: "KAYIT TARİHİ",
        render: (v) => escapeHtml(formatDate(v)),
      },
      {
        key: "last_login_at",
        label: "SON GİRİŞ",
        render: (v) => escapeHtml(formatDateTime(v)),
      },
      {
        key: "is_active",
        label: "DURUM",
        render: (v) => renderActiveBadge(v),
      },
      {
        key: "id",
        label: "İŞLEMLER",
        render: (_, row) =>
          `<a href="${PATHS.adminUserDetail}?uid=${encodeURIComponent(row.id)}" class="sv2-btn sv2-btn-sm sv2-btn-outline">Detay</a>`,
      },
    ],
    rows,
  });
}

/** Rol listesi OTURUM ROLÜNE göre süzülür: Destek Atayıcı "Süper Admin"/"Destek Atayıcı" atayamaz (YON-02, SEC-20). */
function roleOptionsHtml(selected) {
  const allowed = assignableRoles(session?.role);
  return Object.entries(ROLE_LABELS)
    .filter(([value]) => allowed.includes(value))
    .map(
      ([value, label]) =>
        `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`
    )
    .join("");
}

function newUserModalBody() {
  return `
    <form id="new-user-form">
      <div class="sv2-form-row">
        <div class="sv2-form-group">
          <label for="nu-first-name">Ad *</label>
          <input type="text" id="nu-first-name" name="first_name" required autocomplete="off">
        </div>
        <div class="sv2-form-group">
          <label for="nu-last-name">Soyad *</label>
          <input type="text" id="nu-last-name" name="last_name" required autocomplete="off">
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="nu-email">İş E-postası *</label>
        <input type="email" id="nu-email" name="email" required autocomplete="off">
      </div>
      <div class="sv2-form-group">
        <label for="nu-phone">Telefon *</label>
        <input type="tel" id="nu-phone" name="phone" required autocomplete="off">
      </div>
      <div class="sv2-form-group sv2-autocomplete-wrap">
        <label for="nu-company">Firma</label>
        <input type="text" id="nu-company" name="company" placeholder="Firma adı yazın..." autocomplete="off">
        <input type="hidden" id="nu-company-id" name="company_id">
      </div>
      <div id="nu-new-company-fields" hidden>
        <div class="sv2-form-row">
          <div class="sv2-form-group">
            <label for="nu-company-type">Müşteri Tipi</label>
            <select id="nu-company-type" name="customer_type">
              <option value="CUS">CUS — Destek Anlaşmalı</option>
              <option value="ARC">ARC — Arızi Müşteri</option>
            </select>
          </div>
          <div class="sv2-form-group">
            <label for="nu-company-code">Müşteri Kodu</label>
            <input type="text" id="nu-company-code" name="customer_code" placeholder="CUS0001">
          </div>
        </div>
      </div>
      <div class="sv2-form-group">
        <label for="nu-role">Rol *</label>
        <select id="nu-role" name="role">${roleOptionsHtml(ROLES.CUSTOMER)}</select>
      </div>
      <div id="nu-role-warning" hidden>
        <div class="sv2-warning-card">
          <i class="fas fa-exclamation-triangle"></i>
          <div>
            <p class="sv2-warning-title">Yüksek Yetki Uyarısı</p>
            <p class="sv2-warning-text">Bu rol sistemde tüm verilere ve kullanıcı hesaplarına erişim sağlar. Yalnızca güvenilen ekip üyelerine atayın.</p>
          </div>
        </div>
      </div>
      <div id="nu-fallback-note" hidden>
        <div class="sv2-warning-card">
          <i class="fas fa-exclamation-triangle"></i>
          <div>
            <p class="sv2-warning-title">Eski yöntem kullanılıyor</p>
            <p class="sv2-warning-text">Sunucu tarafı kullanıcı yönetimi henüz yapılandırılmadı. Hesap bu tarayıcıdan geçici şifreyle oluşturulur; profil kaydı başarısız olursa oluşturulan hesap otomatik geri alınır.</p>
          </div>
        </div>
      </div>
      <div class="sv2-form-group" id="nu-invite-wrap">
        <label for="nu-invite" style="display:flex;gap:0.5rem;align-items:flex-start;font-weight:600;">
          <input type="checkbox" id="nu-invite" checked style="margin-top:0.2rem;">
          <span>Parola belirlemeden davet gönder (önerilen)</span>
        </label>
        <small class="sv2-text-muted">Kullanıcı e-postadaki bağlantıyla kendi şifresini belirler; parola hiçbir yerde gönderilmez.</small>
      </div>
      <div class="sv2-form-group" id="nu-password-group" hidden>
        <label for="nu-temp-password">Geçici Şifre *</label>
        <div class="sv2-form-row" style="grid-template-columns: 1fr auto; align-items: end;">
          <input type="text" id="nu-temp-password" name="temp_password" autocomplete="new-password">
          <button type="button" class="sv2-btn sv2-btn-secondary" id="nu-gen-password">Üret</button>
        </div>
      </div>
    </form>`;
}

function nextCodeFor(type) {
  return suggestNextCode(type, allCompanies);
}

/** Sunucu işlevi yapılandırıldı mı? (bir kez sorgulanır; yanıtı bekleyen form kipi güncellenir). */
async function probeAdminApi() {
  const res = await callAdminUsers("status");
  adminApi = res.ok ? "available" : res.unavailable ? "unavailable" : adminApi;
  refreshModeUi();
}

function refreshModeUi() {
  const pwGroup = document.getElementById("nu-password-group");
  if (!pwGroup) return;
  const unavailable = adminApi === "unavailable";
  const note = document.getElementById("nu-fallback-note");
  const inviteWrap = document.getElementById("nu-invite-wrap");
  if (note) note.hidden = !unavailable;
  if (inviteWrap) inviteWrap.hidden = unavailable;
  const invite = !unavailable && document.getElementById("nu-invite")?.checked;
  pwGroup.hidden = !!invite;
}

function openNewUserModal() {
  selectedCompany = null;
  renderModal("modal-new-user", {
    title: "Yeni Kullanıcı",
    body: newUserModalBody(),
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="modal-new-user">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="nu-submit">Oluştur</button>`,
  });
  openModal("modal-new-user");

  initPhoneInput(document.getElementById("nu-phone"));

  const pwdInput = document.getElementById("nu-temp-password");
  // Geçici şifre her zaman üretilir (davet kipinde sunucu yoksa yedek akış bunu kullanır); güvenli üreteç yoksa uyarılır.
  const fillPassword = () => {
    try {
      pwdInput.value = generateTempPassword();
    } catch (err) {
      pwdInput.value = "";
      toast(err.message, "error");
    }
  };
  fillPassword();
  document.getElementById("nu-invite")?.addEventListener("change", refreshModeUi);
  refreshModeUi();
  if (adminApi === "unknown") probeAdminApi();

  const companyItems = allCompanies.map((c) => ({
    id: c.id || c.company_id,
    label: `${c.name} (${c.customer_code || ""})`,
    name: c.name,
    customer_code: c.customer_code,
  }));

  renderAutocomplete(
    "nu-company",
    companyItems,
    (item) => {
      const form = document.getElementById("new-user-form");
      const newFields = document.getElementById("nu-new-company-fields");
      if (item?.create) {
        selectedCompany = { create: true, name: item.term };
        document.getElementById("nu-company-id").value = "";
        document.getElementById("nu-company").value = item.term;
        newFields.hidden = false;
        const type = document.getElementById("nu-company-type").value;
        document.getElementById("nu-company-code").value = nextCodeFor(type);
        if (form) clearFormErrors(form);
        return;
      }
      selectedCompany = item;
      document.getElementById("nu-company-id").value = item?.id || "";
      newFields.hidden = true;
      if (form) clearFormErrors(form);
    },
    {
      labelKey: "label",
      valueKey: "id",
      nameKey: "name",
      createLabel: '"{term}" — Yeni firma kaydet',
      onTyping: () => {
        selectedCompany = null;
        document.getElementById("nu-company-id").value = "";
        document.getElementById("nu-new-company-fields").hidden = true;
      },
    }
  );

  document.getElementById("nu-company-type")?.addEventListener("change", (e) => {
    document.getElementById("nu-company-code").value = nextCodeFor(e.target.value);
  });

  document.getElementById("nu-gen-password")?.addEventListener("click", fillPassword);

  document.getElementById("nu-role")?.addEventListener("change", (e) => {
    const warn = document.getElementById("nu-role-warning");
    const val = e.target.value;
    warn.hidden = !isHighPrivilegeRole(val);
  });

  document.getElementById("nu-submit")?.addEventListener("click", submitNewUser);
}

/** Sunucu doğrulama hatalarındaki alan adlarını formdaki alan adlarına çevirir. */
function mapServerErrors(errors) {
  const out = {};
  Object.entries(errors || {}).forEach(([k, v]) => {
    out[k === "company_id" ? "company" : k === "password" ? "temp_password" : k] = v;
  });
  return out;
}

const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();

/** Kullanıcı formunu (firma kaydı YAZILMADAN) doğrular. @returns {{errors: object, data: object, inlineNew: boolean, wantsInvite: boolean}} */
function collectNewUser(form) {
  const companyHidden = document.getElementById("nu-company-id").value;
  const companyName = document.getElementById("nu-company").value.trim();
  const role = form.role.value;
  const needsCompany = isCustomerRole(role);
  // Personel rollerinde firma alanları kullanılmaz (YON-16a): seçilmiş olsa bile yok sayılır.
  const companyId = needsCompany ? (selectedCompany && !selectedCompany.create ? selectedCompany.id : companyHidden) : "";
  const inlineNew = needsCompany && !companyId && Boolean(selectedCompany?.create);
  const wantsInvite = adminApi !== "unavailable" && Boolean(document.getElementById("nu-invite")?.checked);

  const data = {
    first_name: form.first_name.value.trim(),
    last_name: form.last_name.value.trim(),
    email: form.email.value.trim().toLowerCase(), // SEC-36: küçük harfe normalize
    phone: normalizePhone(form.phone) || form.phone.value.trim(),
    role,
    company_id: inlineNew ? "__pending__" : companyId,
    temp_password: wantsInvite ? "" : form.temp_password.value,
  };
  const { errors } = validateUserForm(data);
  if (errors.company_id) {
    errors.company = errors.company_id;
    delete errors.company_id;
  }
  if (!wantsInvite && !data.temp_password) errors.temp_password = "Geçici şifre zorunludur.";
  const phoneErr = phoneInputError(form.phone);
  if (phoneErr && !errors.phone) errors.phone = phoneErr;

  const company = { name: companyName, code: "", type: "CUS", id: companyId };
  if (inlineNew) {
    company.type = document.getElementById("nu-company-type")?.value || "CUS";
    company.code = document.getElementById("nu-company-code")?.value.trim() || nextCodeFor(company.type);
    // Firma henüz yazılmadı: önce firma doğrulaması (ad + ortak müşteri kodu doğrulayıcısı), kullanıcı geçerliyse sonra yazılır (YON-03, YON-08)
    const nameCheck = validateCompanyForm({ name: companyName, customer_code: "CUS0001", customer_type: company.type });
    if (nameCheck.errors.name) errors.company = nameCheck.errors.name;
    else if (allCompanies.some((c) => norm(c.name) === norm(companyName))) errors.company = "Bu adla kayıtlı bir firma var; listeden seçin.";
    const codeCheck = validateCustomerCode({ code: company.code, type: company.type, companies: allCompanies });
    if (!codeCheck.valid) errors.customer_code = codeCheck.error;
    else company.code = codeCheck.code;
  }
  if (needsCompany && !companyId && !inlineNew && !errors.company) errors.company = "Müşteri kullanıcıları için firma seçimi zorunludur.";
  return { errors, data, company, inlineNew, wantsInvite, needsCompany };
}

async function submitNewUser() {
  const form = document.getElementById("new-user-form");
  if (!form || submitting) return; // çift tıklama koruması
  submitting = true;
  showLoading(true);
  try {
    await runNewUser(form);
  } catch (err) {
    handleError(err, "Kullanıcı oluşturulamadı");
  } finally {
    submitting = false;
    showLoading(false);
  }
}

async function runNewUser(form) {
  clearFormErrors(form);
  const { errors, data, company, inlineNew, wantsInvite } = collectNewUser(form);
  if (Object.keys(errors).length) {
    showFormErrors(form, errors);
    return;
  }

  // İstemci tarafı çakışma denetimleri (firma yazılmadan önce)
  if (allUsers.find((u) => norm(u.email) === data.email)) {
    showFormErrors(form, { email: "Bu e-posta adresi zaten kayıtlı." });
    return;
  }
  const conflict = await ParlaDb.emailHasConflictingRole(data.email, data.role);
  if (conflict) {
    showFormErrors(form, { email: conflict });
    return;
  }

  const base = {
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    phone: data.phone,
    role: data.role,
  };

  // Sunucu işlevi varsa ÖNCE kuru çalıştırma: sunucu tarafı çakışmalar (Auth'ta var, personel, rol matrisi) firma yazılmadan yakalanır.
  if (adminApi !== "unavailable") {
    const dry = await callAdminUsers("create", {
      ...base,
      company_id: inlineNew ? "__pending__" : data.company_id,
      password: wantsInvite ? undefined : data.temp_password,
      dry_run: true,
    });
    if (dry.unavailable) {
      adminApi = "unavailable";
      refreshModeUi();
    } else if (!dry.ok) {
      if (dry.errors) showFormErrors(form, mapServerErrors(dry.errors));
      else toast(dry.message, "error");
      return;
    }
  }

  // Doğrulamalar geçti: şimdi (gerekiyorsa) firma yazılır ve SEÇİLİ duruma alınır — yeniden denemede ikinci kez oluşmaz (YON-03)
  let companyId = data.company_id === "__pending__" ? "" : data.company_id;
  let companyName = selectedCompany && !selectedCompany.create ? selectedCompany.name : document.getElementById("nu-company").value.trim();
  let customerCode = selectedCompany && !selectedCompany.create ? selectedCompany.customer_code || "" : "";
  if (inlineNew) {
    let created;
    try {
      created = await ParlaDb.createCompany({
        name: company.name,
        customer_code: company.code,
        customer_type: company.type,
        created_by: session.uid,
        updated_by: session.uid,
      });
    } catch (err) {
      handleError(err, "Firma oluşturulamadı");
      return;
    }
    companyId = created.id;
    companyName = created.name;
    customerCode = created.customer_code;
    allCompanies.push({ ...created, company_id: created.id });
    selectedCompany = { id: created.id, name: created.name, customer_code: created.customer_code, label: `${created.name} (${created.customer_code})` };
    document.getElementById("nu-company-id").value = created.id;
    document.getElementById("nu-new-company-fields").hidden = true;
    try {
      await ParlaDb.logActivity("company_created", "company", created.id, created.name, "Kullanıcı oluşturma sırasında yeni firma eklendi", session);
    } catch {
      /* aktivite kaydı ikincildir */
    }
  }

  // --- Sunucu tarafı oluşturma (Auth hesabı + profil tek işlemde; hata olursa sunucu geri alır) ---
  if (adminApi !== "unavailable") {
    const res = await callAdminUsers("create", { ...base, company_id: companyId, password: wantsInvite ? undefined : data.temp_password });
    if (res.ok) {
      const d = res.data;
      await afterCreate({
        email: d.email,
        name: fullName(data),
        uid: d.uid,
        mode: d.mode,
        password: d.mode === "password" ? data.temp_password : "",
        invite: d.invite,
        warnings: res.warnings,
        orphanRepaired: d.orphan_repaired,
      });
      return;
    }
    if (!res.unavailable) {
      if (res.errors) showFormErrors(form, mapServerErrors(res.errors));
      toast(res.message, "error");
      return;
    }
    adminApi = "unavailable";
    refreshModeUi();
  }

  // --- Yedek akış (servis hesabı yok): istemci tarafı oluşturma, GERİ ALMA ile ---
  await createUserClientSide(form, { ...base, company_id: companyId, company_name: companyName, customer_code: customerCode, temp_password: data.temp_password }, wantsInvite);
}

/** Profil yazıldıktan sonraki adımlar: hiçbiri "oluşturulamadı" demez (YON-07). */
async function afterCreate(info) {
  closeModal("modal-new-user");
  let stale = false;
  try {
    await loadData();
  } catch {
    stale = true;
  }
  try {
    // refreshView() tüm modal kökünü yeniden çizdiğinden, sonuç penceresi ancak ondan SONRA gösterilmelidir.
    refreshView();
  } catch {
    stale = true;
  }
  showSuccessCredentials(info);
  const extra = warningsText(info.warnings);
  if (extra) toast(extra, "warning");
  if (stale) toast("Kullanıcı oluşturuldu ancak liste yenilenemedi; sayfayı yenileyin.", "warning");
}

async function createUserClientSide(form, d, wantsInvite) {
  const warnings = [];
  const isStaffRole = ["consultant", "project_manager"].includes(d.role);
  let person = null;
  if (isStaffRole) {
    try {
      person = await ParlaDb.findPersonnelByEmail(d.email);
    } catch {
      /* eşleşme uyarısı ikincildir */
    }
  }

  let account;
  try {
    account = await createUserAccount(d.email, d.temp_password, { recoverOrphan: true });
  } catch (err) {
    if (err?.code === "orphan_unrecoverable") toast(err.message, "error");
    else handleError(err, "Kullanıcı oluşturulamadı");
    return;
  }

  try {
    await ParlaDb.createUserProfile(account.uid, {
      email: d.email,
      first_name: d.first_name,
      last_name: d.last_name,
      phone: d.phone,
      role: d.role,
      // Personel rollerinde firma alanları boş (YON-16a)
      company_id: isCustomerRole(d.role) ? d.company_id : "",
      company_name: isCustomerRole(d.role) ? d.company_name : "",
      customer_code: isCustomerRole(d.role) ? d.customer_code : "",
      is_active: true,
      must_change_password: true,
      created_by: session.uid,
      updated_by: session.uid,
    });
  } catch (err) {
    console.error("[Parla V2] profil yazılamadı", err);
    // Profil yazılamadı: yeni açılan Auth hesabı GERİ ALINIR (yetim hesap ve "e-posta yanıyor" sorunu olmaz; SEC-20, YON-02).
    const rolledBack = await account.rollback();
    const denied = /PERMISSION_DENIED|permission/i.test(`${err?.code || ""} ${err?.message || ""}`);
    toast(
      `${denied ? "Bu kullanıcıyı oluşturma yetkiniz yok (rol ya da firma kısıtı). " : "Kullanıcı kaydı tamamlanamadı. "}${
        rolledBack
          ? "Oluşturulan hesap geri alındı; düzeltip yeniden deneyebilirsiniz."
          : account.recovered
            ? "Mevcut (yetim) hesaba dokunulmadı; yeniden deneyebilirsiniz."
            : "Hesap geri alınamadı: aynı e-postayla yeniden denerseniz “Yetim Hesabı Onar” kullanın."
      }`,
      "error"
    );
    return;
  }
  await account.dispose();

  // Profil yazıldı: bundan sonrası uyarıdır.
  let resetMailFailed = false;
  try {
    await resetPassword(d.email);
  } catch {
    resetMailFailed = true;
  }
  try {
    await ParlaDb.logActivity("user_created", "user", account.uid, `${d.first_name} ${d.last_name}`, `${d.email} — ${formatRoleLabel(d.role)}${account.recovered ? " (yetim hesap onarıldı)" : ""}`, session);
  } catch {
    warnings.push({ message: "Aktivite kaydı yazılamadı." });
  }
  if (isStaffRole) {
    if (!person) {
      warnings.push({ message: "Bu e-postayla eşleşen bir personel (danışman) kaydı yok; Danışmanlar sayfasında kayıt oluşturup eşleştirin." });
    } else {
      try {
        await ParlaDb.linkPersonnelUsers();
      } catch {
        warnings.push({ message: "Personel kaydı kullanıcıyla eşleştirilemedi; Danışmanlar sayfasındaki “Personel ↔ kullanıcı eşleştir” aracını çalıştırın." });
      }
    }
  }
  if (resetMailFailed) warnings.push({ message: "Şifre belirleme e-postası gönderilemedi. Giriş bilgilerini “E-posta Gönder” ile iletin." });
  if (wantsInvite) {
    warnings.push({ message: "Sunucu tarafı kullanıcı yönetimi yapılandırılmadığından davet yerine geçici şifre kullanıldı." });
  }
  await afterCreate({
    email: d.email,
    name: fullName(d),
    uid: account.uid,
    mode: "password",
    password: d.temp_password,
    warnings,
    orphanRepaired: account.recovered,
  });
}

function showSuccessCredentials(info) {
  const { email, name, uid, mode, password, invite, orphanRepaired } = info;
  const invited = mode === "invite";
  const inviteSent = invited && invite && invite.status === "sent";
  const link = invited && invite && invite.link ? invite.link : "";
  const intro = orphanRepaired ? "yetim hesap onarılarak kaydedildi" : "başarıyla oluşturuldu";
  const body = invited
    ? `
      <p><strong>${escapeHtml(name)}</strong> ${intro}.</p>
      <div class="sv2-meta-grid sv2-mt-1">
        <div class="sv2-meta-item"><label>E-posta</label><span id="cred-email">${escapeHtml(email)}</span></div>
        <div class="sv2-meta-item"><label>Davet</label><span id="cred-invite">${
          inviteSent ? "Şifre belirleme bağlantısı e-postayla gönderildi" : "Bağlantı e-postayla GÖNDERİLEMEDİ"
        }</span></div>
      </div>
      ${
        link
          ? `<div class="sv2-form-group sv2-mt-1"><label for="cred-link">Şifre belirleme bağlantısı (kısa süre geçerli)</label><input type="text" id="cred-link" readonly value="${escapeHtml(link)}"></div>
             <p class="sv2-text-muted" style="font-size:0.875rem;">Bağlantıyı kullanıcıya yalnızca güvenli bir kanaldan iletin.</p>`
          : `<p class="sv2-text-muted" style="margin-top:1rem;font-size:0.875rem;">Kullanıcı bağlantıyla kendi şifresini belirler; parola e-postayla gönderilmez.</p>`
      }`
    : `
      <p><strong>${escapeHtml(name)}</strong> ${intro}.</p>
      <div class="sv2-meta-grid sv2-mt-1">
        <div class="sv2-meta-item"><label>E-posta</label><span id="cred-email">${escapeHtml(email)}</span></div>
        <div class="sv2-meta-item"><label>Geçici Şifre</label><span id="cred-password">${escapeHtml(password)}</span></div>
      </div>
      <p class="sv2-text-muted" style="margin-top:1rem;font-size:0.875rem;">Bu bilgileri kullanıcıya güvenli bir kanaldan iletin. İlk girişte şifresini değiştirmesi istenir (e-postadaki şifre belirleme bağlantısını kullanırsa bu adım atlanır).</p>`;
  renderModal("modal-user-success", {
    title: invited ? "Kullanıcı Davet Edildi" : "Kullanıcı Oluşturuldu",
    body,
    footer: invited
      ? `${link ? '<button type="button" class="sv2-btn sv2-btn-secondary" id="cred-copy-link">Bağlantıyı Kopyala</button>' : ""}
         <button type="button" class="sv2-btn sv2-btn-primary" data-close="modal-user-success">Tamam</button>`
      : `<button type="button" class="sv2-btn sv2-btn-secondary" id="cred-copy">Panoya Kopyala</button>
         <button type="button" class="sv2-btn sv2-btn-outline" id="cred-email-btn">E-posta Gönder</button>
         <button type="button" class="sv2-btn sv2-btn-primary" data-close="modal-user-success">Tamam</button>`,
  });
  openModal("modal-user-success");

  document.getElementById("cred-copy-link")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Bağlantı panoya kopyalandı.", "success");
    } catch {
      toast("Kopyalama başarısız.", "error");
    }
  });

  document.getElementById("cred-copy")?.addEventListener("click", async () => {
    const text = `Parla BT Destek Giriş Bilgileri\nE-posta: ${email}\nŞifre: ${password}\nGiriş: ${window.location.origin}${PATHS.login}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("Bilgiler panoya kopyalandı.", "success");
    } catch {
      toast("Kopyalama başarısız.", "error");
    }
  });

  document.getElementById("cred-email-btn")?.addEventListener("click", async () => {
    showLoading(true);
    try {
      if (adminApi === "available" && uid) {
        // Parola e-postayla GİTMEZ: kullanıcıya şifre belirleme bağlantısı gönderilir.
        const res = await callAdminUsers("resetLink", { uid, send: true });
        toast(res.ok && res.data?.sent ? "Şifre belirleme bağlantısı e-postayla gönderildi." : res.message || warningsText(res.warnings) || "E-posta gönderilemedi.", res.ok && res.data?.sent ? "success" : "warning");
        return;
      }
      const res = await ParlaEmailService.send({ type: "user_credentials", to: email, ticketData: { email, name } });
      toast(res.success ? "E-posta gönderildi." : res.message || "E-posta gönderilemedi.", res.success ? "success" : "warning");
    } finally {
      showLoading(false);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Yetim hesabı onar (Auth'ta var, profili yok — yarım kalmış oluşturma; SEN-19)
// ---------------------------------------------------------------------------------------------------------------

function companyOptionsHtml() {
  return allCompanies
    .filter((c) => c.is_active !== false)
    .map((c) => `<option value="${escapeHtml(c.id || c.company_id)}">${escapeHtml(`${c.name} (${c.customer_code || ""})`)}</option>`)
    .join("");
}

async function openRepairModal() {
  renderModal("modal-repair-user", {
    title: "Yetim Hesabı Onar",
    body: `
      <p class="sv2-text-muted">Firebase'de hesabı olan ama portalda profili bulunmayan (yarım kalmış oluşturma) bir hesabı kullanıcı olarak kaydeder.</p>
      <form id="repair-user-form">
        <div class="sv2-form-group">
          <label for="rp-email">Hesabın e-postası *</label>
          <input type="email" id="rp-email" name="email" list="rp-orphans" autocomplete="off" required>
          <datalist id="rp-orphans"></datalist>
          <small class="sv2-text-muted" id="rp-hint">Yetim hesaplar aranıyor…</small>
        </div>
        <div class="sv2-form-row">
          <div class="sv2-form-group"><label for="rp-first">Ad *</label><input type="text" id="rp-first" name="first_name" autocomplete="off"></div>
          <div class="sv2-form-group"><label for="rp-last">Soyad *</label><input type="text" id="rp-last" name="last_name" autocomplete="off"></div>
        </div>
        <div class="sv2-form-group"><label for="rp-phone">Telefon *</label><input type="tel" id="rp-phone" name="phone" autocomplete="off"></div>
        <div class="sv2-form-group"><label for="rp-role">Rol *</label><select id="rp-role" name="role">${roleOptionsHtml(ROLES.CUSTOMER)}</select></div>
        <div class="sv2-form-group" id="rp-company-group">
          <label for="rp-company">Firma *</label>
          <select id="rp-company" name="company"><option value="">Firma seçin…</option>${companyOptionsHtml()}</select>
        </div>
        <div class="sv2-form-group" id="rp-password-group" hidden>
          <label for="rp-password">Hesabın bilinen parolası *</label>
          <input type="text" id="rp-password" name="temp_password" autocomplete="new-password">
          <small class="sv2-text-muted">Sunucu tarafı onarım yapılandırılmadığından hesaba, oluşturulurken verilen parolayla girilerek kimliği alınır.</small>
        </div>
      </form>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" data-close="modal-repair-user">İptal</button>
      <button type="button" class="sv2-btn sv2-btn-primary" id="rp-submit">Onar</button>`,
  });
  openModal("modal-repair-user");
  initPhoneInput(document.getElementById("rp-phone"));
  const syncCompany = () => {
    document.getElementById("rp-company-group").hidden = !isCustomerRole(document.getElementById("rp-role").value);
  };
  document.getElementById("rp-role")?.addEventListener("change", syncCompany);
  syncCompany();
  document.getElementById("rp-submit")?.addEventListener("click", submitRepair);

  const res = await callAdminUsers("orphans");
  const hint = document.getElementById("rp-hint");
  if (res.ok) {
    adminApi = "available";
    const list = res.data?.orphans || [];
    const dl = document.getElementById("rp-orphans");
    if (dl) dl.innerHTML = list.map((o) => `<option value="${escapeHtml(o.email)}"></option>`).join("");
    if (hint) hint.textContent = list.length ? `${list.length} yetim hesap bulundu; listeden seçebilirsiniz.` : "Yetim hesap bulunamadı.";
  } else if (res.unavailable) {
    adminApi = "unavailable";
    document.getElementById("rp-password-group").hidden = false;
    if (hint) hint.textContent = "Sunucu tarafı onarım yapılandırılmadı: e-postayı ve hesabın parolasını girin.";
  } else if (hint) {
    hint.textContent = res.message;
  }
}

async function submitRepair() {
  const form = document.getElementById("repair-user-form");
  if (!form || submitting) return;
  submitting = true;
  showLoading(true);
  try {
    clearFormErrors(form);
    const role = form.role.value;
    const needsCompany = isCustomerRole(role);
    const companyId = needsCompany ? form.company.value : "";
    const data = {
      first_name: form.first_name.value.trim(),
      last_name: form.last_name.value.trim(),
      email: form.email.value.trim().toLowerCase(),
      phone: normalizePhone(form.phone) || form.phone.value.trim(),
      role,
      company_id: companyId,
    };
    const { errors } = validateUserForm(data);
    if (errors.company_id) {
      errors.company = errors.company_id;
      delete errors.company_id;
    }
    if (adminApi === "unavailable" && !form.temp_password.value) errors.temp_password = "Hesabın parolası zorunludur.";
    if (!errors.phone && phoneInputError(form.phone)) errors.phone = phoneInputError(form.phone);
    if (Object.keys(errors).length) {
      showFormErrors(form, errors);
      return;
    }
    if (allUsers.find((u) => norm(u.email) === data.email)) {
      showFormErrors(form, { email: "Bu e-posta adresinin zaten bir profili var." });
      return;
    }

    if (adminApi !== "unavailable") {
      const res = await callAdminUsers("repair", data);
      if (res.ok) {
        closeModal("modal-repair-user");
        try {
          await loadData();
          refreshView();
        } catch {
          toast("Hesap onarıldı ancak liste yenilenemedi; sayfayı yenileyin.", "warning");
        }
        toast(`Hesap onarıldı. ${warningsText(res.warnings)}`.trim(), "success");
        if (res.data?.mode === "invite" && res.data.invite?.link) {
          showSuccessCredentials({ email: res.data.email, name: fullName(data), uid: res.data.uid, mode: "invite", invite: res.data.invite, orphanRepaired: true });
        }
        return;
      }
      if (!res.unavailable) {
        if (res.errors) showFormErrors(form, mapServerErrors(res.errors));
        toast(res.message, "error");
        return;
      }
      adminApi = "unavailable";
      document.getElementById("rp-password-group").hidden = false;
      toast("Sunucu tarafı onarım yapılandırılmadı: hesabın parolasını girip yeniden deneyin.", "warning");
      return;
    }

    // Yedek akış: aynı parolayla oturum açıp kimliği al, profili yaz
    let account;
    try {
      account = await createUserAccount(data.email, form.temp_password.value, { recoverOrphan: true });
    } catch (err) {
      toast(err.message, "error");
      return;
    }
    try {
      const company = allCompanies.find((c) => (c.id || c.company_id) === companyId);
      await ParlaDb.createUserProfile(account.uid, {
        ...data,
        company_id: needsCompany ? companyId : "",
        company_name: needsCompany ? company?.name || "" : "",
        customer_code: needsCompany ? company?.customer_code || "" : "",
        is_active: true,
        must_change_password: true,
        created_by: session.uid,
        updated_by: session.uid,
      });
    } catch (err) {
      console.error("[Parla V2] profil yazılamadı", err);
      await account.rollback();
      toast("Profil yazılamadı (yetkiniz olmayabilir). Mevcut hesaba dokunulmadı; yeniden deneyebilirsiniz.", "error");
      return;
    }
    await account.dispose();
    try {
      await ParlaDb.logActivity("user_repaired", "user", account.uid, fullName(data), `${data.email} — ${formatRoleLabel(role)} (yetim hesap onarıldı)`, session);
    } catch {
      /* aktivite ikincildir */
    }
    closeModal("modal-repair-user");
    try {
      await loadData();
      refreshView();
    } catch {
      toast("Hesap onarıldı ancak liste yenilenemedi; sayfayı yenileyin.", "warning");
    }
    toast(account.recovered ? "Yetim hesap onarıldı. Kullanıcı mevcut parolasıyla girer; ilk girişte şifre değiştirmesi istenir." : "Hesap oluşturuldu (yetim hesap bulunamadı).", "success");
  } catch (err) {
    handleError(err, "Onarım");
  } finally {
    submitting = false;
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("btn-new-user")?.addEventListener("click", openNewUserModal);
  document.getElementById("btn-repair-user")?.addEventListener("click", openRepairModal);

  document.getElementById("users-search")?.addEventListener("input", (e) => {
    filters.search = e.target.value;
    document.getElementById("users-table-wrap").innerHTML = renderUsersTable(
      filterUsers().map((u) => ({
        id: u.uid || u.id,
        name: fullName(u),
        email: u.email || "—",
        phone: u.phone || "",
        company: u.company_name || "—",
        company_id: u.company_id,
        role: u.role,
        created_at: u.created_at,
        last_login_at: u.last_login_at,
        is_active: u.is_active,
      }))
    );
  });

  bindFilterChips("#sv2-filter-chips", (value) => {
    filters.role = value;
    refreshView();
  });

  bindFilterChips("#status-chips", (value) => {
    filters.status = value;
    refreshView();
  });
}

function refreshView() {
  renderShell("#sv2-app", {
    title: "Kullanıcılar",
    activePage: "users",
    profile: session,
    isAdmin: true,
    content: buildPageContent(),
  });
  bindEvents();
}

async function loadData() {
  [allUsers, allCompanies] = await Promise.all([
    ParlaDb.getAllUsers(),
    ParlaDb.getAllCompanies(),
  ]);
}

async function init() {
  try {
    showLoading(true);
    session = await requirePage("adminUsers", { adminOnly: true });
    await ParlaDb.waitForFirebase();
    refreshView();
    try {
      await loadData();
      loadState = "ok";
      refreshView();
      // Sunucu işlevi var mı? (yoksa form eski yönteme uyarıyla geri döner)
      probeAdminApi().catch(() => {});
    } catch (err) {
      loadState = "error";
      refreshView();
      handleLoadError(err, "Kullanıcı listesi yüklenemedi", {
        retry: async () => {
          loadState = "loading";
          refreshView();
          try {
            await loadData();
            loadState = "ok";
            refreshView();
          } catch (retryErr) {
            loadState = "error";
            refreshView();
            handleLoadError(retryErr, "Kullanıcı listesi yüklenemedi");
          }
        },
      });
    }
  } catch (err) {
    if (
      err.message !== "not_authenticated" &&
      err.message !== "not_admin" &&
      err.message !== "role_denied"
    ) {
      handleLoadError(err, "Sayfa yüklenemedi");
    }
  } finally {
    showLoading(false);
  }
}

init();
