/**
 * Parla BT Ticket V2 — Admin Muhataplar (Kullanıcı Yönetimi)
 */
import ParlaDb from "../firebase-client.js";
import { requireAuth, createUser, PATHS } from "../auth-guard.js";
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
} from "../ticket-utils.js";
import { validateUserForm } from "../validators.js";
import ParlaEmailService from "../email-service.js";

let session = null;
let allUsers = [];
let allCompanies = [];
let filters = { search: "", role: "all", status: "all" };
let selectedCompany = null;

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
  const q = filters.search.trim().toLowerCase();
  return allUsers.filter((u) => {
    if (filters.role !== "all") {
      if (filters.role === "admin") {
        if (![ROLES.SUPER_ADMIN, ROLES.SERVICE_ADMIN].includes(u.role)) return false;
      } else if (u.role !== filters.role) return false;
    }
    if (filters.status === "active" && u.is_active === false) return false;
    if (filters.status === "inactive" && u.is_active !== false) return false;
    if (!q) return true;
    const hay = [
      u.first_name,
      u.last_name,
      u.email,
      u.company_name,
      u.phone,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function buildPageContent() {
  const rows = filterUsers().map((u) => ({
    id: u.uid || u.id,
    name: fullName(u),
    email: u.email || "—",
    company: u.company_name || "—",
    company_id: u.company_id,
    role: u.role,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
    is_active: u.is_active,
  }));

  return `
    ${renderBreadcrumbLocal()}
    <div class="sv2-section">
      <div class="sv2-section-header">
        <h3>Muhataplar</h3>
        <button type="button" class="sv2-btn sv2-btn-primary" id="btn-new-user">
          <i class="fas fa-plus"></i> Yeni Kullanıcı
        </button>
      </div>
      <div class="sv2-section-body">
        ${allUsers.length === 0 ? renderEmptyState("Henüz kayıtlı kullanıcı yok. İlk hesabı oluşturmak için Yeni Kullanıcı butonuna tıklayın.", "fa-user-plus") : ""}
        ${renderFilterBar({
          search: { id: "users-search", placeholder: "Ad, e-posta veya firma ara...", value: filters.search },
          chips: [
            { value: "all", label: "Tüm Roller", active: filters.role === "all" },
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
          ${renderUsersTable(rows)}
        </div>
      </div>
    </div>`;
}

function renderBreadcrumbLocal() {
  return `<nav class="sv2-breadcrumb" aria-label="Breadcrumb">
    <a href="${PATHS.adminDashboard}" class="sv2-breadcrumb-link">Genel Bakış</a>
    <span class="sv2-breadcrumb-sep">›</span>
    <span class="sv2-breadcrumb-current">Muhataplar</span>
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

function roleOptionsHtml(selected) {
  return Object.entries(ROLE_LABELS)
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
      <div class="sv2-form-group">
        <label for="nu-temp-password">Geçici Şifre *</label>
        <div class="sv2-form-row" style="grid-template-columns: 1fr auto; align-items: end;">
          <input type="text" id="nu-temp-password" name="temp_password" autocomplete="new-password">
          <button type="button" class="sv2-btn sv2-btn-secondary" id="nu-gen-password">Üret</button>
        </div>
      </div>
    </form>`;
}

function suggestNextCode(type) {
  const prefix = String(type || "CUS").toUpperCase();
  const nums = allCompanies
    .filter((c) => String(c.customer_code || "").startsWith(prefix))
    .map((c) => parseInt(String(c.customer_code).slice(3), 10) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
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

  const pwdInput = document.getElementById("nu-temp-password");
  pwdInput.value = generateTempPassword();

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
        document.getElementById("nu-company-code").value = suggestNextCode(type);
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
    document.getElementById("nu-company-code").value = suggestNextCode(e.target.value);
  });

  document.getElementById("nu-gen-password")?.addEventListener("click", () => {
    pwdInput.value = generateTempPassword();
  });

  document.getElementById("nu-role")?.addEventListener("change", (e) => {
    const warn = document.getElementById("nu-role-warning");
    const val = e.target.value;
    warn.hidden = val !== ROLES.SERVICE_ADMIN && val !== ROLES.SUPER_ADMIN;
  });

  document.getElementById("nu-submit")?.addEventListener("click", submitNewUser);
}

async function submitNewUser() {
  const form = document.getElementById("new-user-form");
  if (!form) return;

  let companyId = document.getElementById("nu-company-id").value;
  let companyName = document.getElementById("nu-company").value.trim();
  let customerCode = "";

  const data = {
    first_name: form.first_name.value.trim(),
    last_name: form.last_name.value.trim(),
    email: form.email.value.trim(),
    phone: form.phone.value.trim(),
    role: form.role.value,
    company_id: companyId,
    temp_password: form.temp_password.value,
  };

  const needsCompany =
    data.role === ROLES.CUSTOMER || data.role === ROLES.ARIZI_CUSTOMER;

  if (needsCompany && !companyId && !selectedCompany?.create) {
    showFormErrors(form, { company: "Müşteri kullanıcıları için firma seçimi zorunludur." });
    return;
  }

  if (needsCompany && !companyId && selectedCompany?.create) {
    if (!companyName) {
      showFormErrors(form, { company: "Firma adı zorunludur." });
      return;
    }
    showLoading(true);
    try {
      const type = document.getElementById("nu-company-type")?.value || "CUS";
      const code =
        document.getElementById("nu-company-code")?.value.trim() || suggestNextCode(type);
      const company = await ParlaDb.createCompany({
        name: companyName,
        customer_code: code,
        customer_type: type,
        created_by: session.uid,
        updated_by: session.uid,
      });
      companyId = company.id;
      companyName = company.name;
      customerCode = company.customer_code;
      await ParlaDb.logActivity(
        "company_created",
        "company",
        company.id,
        company.name,
        "Kullanıcı oluşturma sırasında yeni firma eklendi",
        session
      );
    } catch (err) {
      handleError(err, "Firma oluşturulamadı");
      showLoading(false);
      return;
    }
  } else if (selectedCompany && !selectedCompany.create) {
    companyId = selectedCompany.id;
    companyName = selectedCompany.name;
    customerCode = selectedCompany.customer_code || "";
  }

  data.company_id = companyId;

  const { valid, errors } = validateUserForm(data);
  if (!valid) {
    showFormErrors(form, errors);
    showLoading(false);
    return;
  }

  const dup = allUsers.find(
    (u) => String(u.email || "").toLowerCase() === data.email.toLowerCase()
  );
  if (dup) {
    showFormErrors(form, { email: "Bu e-posta adresi zaten kayıtlı." });
    showLoading(false);
    return;
  }

  showLoading(true);
  try {
    const authUser = await createUser(data.email, data.temp_password);
    await ParlaDb.createUserProfile(authUser.uid, {
      email: data.email,
      first_name: data.first_name,
      last_name: data.last_name,
      phone: data.phone,
      role: data.role,
      company_id: companyId,
      company_name: companyName,
      customer_code: customerCode,
      is_active: true,
      created_by: session.uid,
      updated_by: session.uid,
    });
    await ParlaDb.logActivity(
      "user_created",
      "user",
      authUser.uid,
      `${data.first_name} ${data.last_name}`,
      `${data.email} — ${formatRoleLabel(data.role)}`,
      session
    );

    closeModal("modal-new-user");
    showSuccessCredentials(data.email, data.temp_password, fullName(data));
    await loadData();
    refreshView();
  } catch (err) {
    handleError(err, "Kullanıcı oluşturulamadı");
  } finally {
    showLoading(false);
  }
}

function showSuccessCredentials(email, password, name) {
  renderModal("modal-user-success", {
    title: "Kullanıcı Oluşturuldu",
    body: `
      <p><strong>${escapeHtml(name)}</strong> başarıyla oluşturuldu.</p>
      <div class="sv2-meta-grid sv2-mt-1">
        <div class="sv2-meta-item">
          <label>E-posta</label>
          <span id="cred-email">${escapeHtml(email)}</span>
        </div>
        <div class="sv2-meta-item">
          <label>Geçici Şifre</label>
          <span id="cred-password">${escapeHtml(password)}</span>
        </div>
      </div>
      <p class="sv2-text-muted" style="margin-top:1rem;font-size:0.875rem;">Bu bilgileri kullanıcıya güvenli bir kanaldan iletin.</p>`,
    footer: `
      <button type="button" class="sv2-btn sv2-btn-secondary" id="cred-copy">Panoya Kopyala</button>
      <button type="button" class="sv2-btn sv2-btn-outline" id="cred-email-btn">E-posta Gönder</button>
      <button type="button" class="sv2-btn sv2-btn-primary" data-close="modal-user-success">Tamam</button>`,
  });
  openModal("modal-user-success");

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
    const res = await ParlaEmailService.send({
      to: email,
      subject: "Parla BT Destek — Giriş Bilgileriniz",
      body: `Merhaba,\n\nParla BT Destek sistemine hesabınız oluşturuldu.\n\nE-posta: ${email}\nGeçici Şifre: ${password}\n\nGiriş: ${window.location.origin}${PATHS.login}\n\nİlk girişten sonra şifrenizi değiştirmenizi öneririz.`,
    });
    showLoading(false);
    toast(res.success ? "E-posta gönderildi." : res.message || "E-posta gönderilemedi.", res.success ? "success" : "warning");
  });
}

function bindEvents() {
  document.getElementById("btn-new-user")?.addEventListener("click", openNewUserModal);

  document.getElementById("users-search")?.addEventListener("input", (e) => {
    filters.search = e.target.value;
    document.getElementById("users-table-wrap").innerHTML = renderUsersTable(
      filterUsers().map((u) => ({
        id: u.uid || u.id,
        name: fullName(u),
        email: u.email || "—",
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
    title: "Muhataplar",
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
    session = await requireAuth({ adminOnly: true });
    await ParlaDb.waitForFirebase();
    refreshView();
    try {
      await loadData();
    } catch (err) {
      handleError(err, "Kullanıcı listesi yüklenemedi");
    }
    refreshView();
  } catch (err) {
    if (err.message !== "not_authenticated" && err.message !== "not_admin") {
      handleError(err, "Sayfa yüklenemedi");
    }
  } finally {
    showLoading(false);
  }
}

init();
