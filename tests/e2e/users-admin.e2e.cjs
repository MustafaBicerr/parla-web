/**
 * E2E (gerçek veritabanı kuralları): WP-08 kullanıcı yönetimi —
 *   - sunucu işlevi YOK/yapılandırılmamış (404 ve 503 not_configured) → eski istemci akışına UYARIYLA geri dönüş,
 *   - rol listesi oturum rolüne göre süzülür (Destek Atayıcı "Süper Admin"/"Destek Atayıcı" göremez),
 *   - profil yazımı başarısız olursa Auth hesabı GERİ ALINIR (yetim hesap yok) ve aynı e-postayla yeniden denenebilir,
 *   - satır içi yeni firma yalnız kullanıcı doğrulaması geçince yazılır, yeniden denemede ikinci firma oluşmaz,
 *   - müşteri kodu ortak doğrulayıcı (biçim + benzersizlik),
 *   - yetim hesap: aynı parolayla kurtarma / parola uymazsa anlaşılır hata, "Yetim Hesabı Onar" penceresi,
 *   - sunucu kipi (route ile taklit edilen yanıtlar): davet akışı (parola yok), sunucu hata eşlemesi,
 *   - kullanıcı detayı: yönetilemeyen/kendi hesap düğmeleri, pasife alma (sunucu + yedek),
 *   - geçici şifre crypto ile; boşta oturum zaman aşımı (personel 8 sa / müşteri 30 gün); çıkışta yerel iz temizliği,
 *   - auth-action: şifre belirleyen kullanıcının must_change_password bayrağı kapanır.
 * Sunucu işlevinin KENDİ mantığı netlify/tests/admin-users.test.js'te (sahte Admin) test edilir.
 * Çalıştırma: node tests/e2e/users-admin.e2e.cjs
 */
const { createWorld, startServer } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) pass += 1; else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${ok ? "" : " | " + (detail || "")}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { if (await fn()) return true; } catch { /* yeniden dene */ }
    await sleep(80);
  }
  return false;
}

/** Firebase Auth CDN modülünün taklidi: hesap kaydı (window.__existingAuth: e-posta → parola), günlük (window.__authLog). */
const AUTH_STUB = `
const log = (window.__authLog = window.__authLog || []);
window.__existingAuth = window.__existingAuth || {};
let seq = 0;
const slug = (e) => String(e).split('@')[0].replace(/[^a-z0-9]/g, '');
export const getAuth = () => ({});
export const createUserWithEmailAndPassword = async (a, e, p) => {
  const email = String(e).toLowerCase();
  log.push(['create', email]);
  if (window.__existingAuth[email] !== undefined) { const err = new Error('exists'); err.code = 'auth/email-already-in-use'; throw err; }
  window.__existingAuth[email] = p;
  seq += 1;
  return { user: { uid: 'new-' + seq + '-' + slug(email), email } };
};
export const signInWithEmailAndPassword = async (a, e, p) => {
  const email = String(e).toLowerCase();
  log.push(['signin', email]);
  if (window.__existingAuth[email] === p) return { user: { uid: 'orphan-' + slug(email), email } };
  const err = new Error('bad'); err.code = 'auth/invalid-credential'; throw err;
};
export const deleteUser = async (user) => { log.push(['delete', user.uid]); delete window.__existingAuth[user.email]; };
`;

(async () => {
  const world = createWorld(buildSeed());
  const srv = await startServer(world);

  // Veritabanı hata enjeksiyonu: profil yazımını reddet (kural reddi gibi)
  const origDbOp = world.dbOp.bind(world);
  const inject = { denyUserSets: 0 };
  world.dbOp = (op) => {
    if (inject.denyUserSets > 0 && op.op === "set" && /^v2\/users\/(new-|orphan-)/.test(String(op.path))) {
      inject.denyUserSets -= 1;
      return { error: "PERMISSION_DENIED", info: "enjekte edilen red" };
    }
    return origDbOp(op);
  };
  const val = (p) => world.valueAt(p);
  const companyCount = () => Object.keys(val("v2/companies") || {}).length;
  const userByEmail = (email) => Object.values(val("v2/users") || {}).find((u) => String(u.email).toLowerCase() === email);

  /** İstemci oturumu; auth CDN taklidi + (isteğe bağlı) /api/admin-users taklidi. */
  async function open(uid, options) {
    const o = options || {};
    const s = await srv.session(uid);
    await s.page.addInitScript((existing) => { window.__existingAuth = Object.assign({}, existing); }, o.existingAuth || {});
    await s.page.route(/gstatic\.com\/firebasejs\/.*\/firebase-auth\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: AUTH_STUB }));
    s.api = [];
    if (o.api) {
      await s.page.route("**/api/admin-users", async (route) => {
        const body = JSON.parse(route.request().postData() || "{}");
        s.api.push(body);
        const res = o.api(body) || { status: 500, json: { success: false } };
        await route.fulfill({ status: res.status || 200, contentType: "application/json", body: JSON.stringify(res.json) });
      });
    }
    return s;
  }
  const toastsOf = (s) => s.page.locator(".sv2-toast-text").allTextContents();
  const toastText = async (s) => (await toastsOf(s)).join(" | ");
  const authLog = (s) => s.page.evaluate(() => window.__authLog || []);
  const gotoUsers = async (s) => {
    await s.goto("/support-v2/admin/users.html");
    await s.page.waitForSelector("#btn-new-user");
    await s.page.waitForSelector("#users-table-wrap table", { timeout: 10000 });
  };
  async function openNewUser(s) {
    await s.page.click("#btn-new-user");
    await s.page.waitForSelector("#nu-first-name");
    await sleep(250); // sunucu işlevi sorgusu (status) tamamlanır
  }
  async function fillUser(s, d) {
    await s.page.fill("#nu-first-name", d.first || "Yeni");
    await s.page.fill("#nu-last-name", d.last || "Kullanıcı");
    await s.page.fill("#nu-email", d.email);
    await s.page.fill("#nu-phone", d.phone || "5301112233");
    if (d.role) await s.page.selectOption("#nu-role", d.role);
    if (d.company) {
      await s.page.fill("#nu-company", d.company);
      await s.page.click(".sv2-ac-item:not(.sv2-ac-create)");
    }
    if (d.password !== undefined) await s.page.fill("#nu-temp-password", d.password);
  }

  try {
    // =============================================================================================== 1) rol süzme + yedek akış bandı
    {
      const s = await open("u_service");
      await gotoUsers(s);
      await openNewUser(s);
      const opts = await s.page.locator("#nu-role option").evaluateAll((els) => els.map((e) => e.value));
      check("Destek Atayıcı: rol listesinde Süper Admin/Destek Atayıcı YOK (YON-02)", !opts.includes("super_admin") && !opts.includes("service_admin"), opts.join());
      check("Destek Atayıcı: müşteri rolleri + danışman + proje yöneticisi var", ["customer", "company_admin", "arizi_customer", "consultant", "project_manager"].every((r) => opts.includes(r)), opts.join());
      check("sunucu işlevi yok (404): uyarı bandı görünür, davet seçeneği gizli, geçici şifre alanı açık", await s.page.locator("#nu-fallback-note").isVisible() && !(await s.page.locator("#nu-invite-wrap").isVisible()) && (await s.page.locator("#nu-password-group").isVisible()));
      const pw = await s.page.inputValue("#nu-temp-password");
      check("geçici şifre üretildi ve ilkeye uyuyor (≥8, büyük harf, rakam)", pw.length >= 12 && /[A-Z]/.test(pw) && /[0-9]/.test(pw), pw);
      await s.context.close();

      const r = await open("u_root");
      await gotoUsers(r);
      await openNewUser(r);
      const rootOpts = await r.page.locator("#nu-role option").evaluateAll((els) => els.map((e) => e.value));
      check("Süper Admin: tüm roller listede", rootOpts.length === 7 && rootOpts.includes("super_admin") && rootOpts.includes("service_admin"), rootOpts.join());
      await r.context.close();
    }

    // =============================================================================================== 2) not_configured (503) → yedek akış
    {
      const s = await open("u_service", { api: () => ({ status: 503, json: { success: false, code: "not_configured", message: "yapılandırılmadı" } }) });
      await gotoUsers(s);
      await openNewUser(s);
      check("503 not_configured: yedek akış uyarısı", await s.page.locator("#nu-fallback-note").isVisible());
      await s.context.close();
    }

    // =============================================================================================== 3) yedek akış: başarılı oluşturma
    {
      const s = await open("u_service");
      await gotoUsers(s);
      const before = Object.keys(val("v2/users")).length;
      await openNewUser(s);
      await fillUser(s, { first: "Selma", last: "Test", email: "  Selma.TEST@OrnekHolding.com ", role: "customer", company: "Örnek", password: "Gecici123x" });
      await s.page.click("#nu-submit");
      const ok = await waitFor(async () => (await s.page.locator("#modal-user-success.is-open").count()) > 0);
      check("yedek akış: oluşturuldu, kimlik bilgileri penceresi açıldı", ok, await toastText(s));
      const created = userByEmail("selma.test@ornekholding.com");
      check("profil yazıldı: e-posta küçük harf, firma+kod firma kaydından, must_change_password=true", created && created.email === "selma.test@ornekholding.com" && created.company_id === "cA" && created.customer_code === "ORN" && created.must_change_password === true && created.role === "customer", JSON.stringify(created));
      check("kullanıcı sayısı +1 ve geçici şifre ekranda", Object.keys(val("v2/users")).length === before + 1 && (await s.page.locator("#cred-password").textContent()) === "Gecici123x");
      const log = await authLog(s);
      check("yalnızca bir Auth hesabı açıldı, silme yok", log.filter((l) => l[0] === "create").length === 1 && !log.some((l) => l[0] === "delete"), JSON.stringify(log));
      await s.context.close();
    }

    // =============================================================================================== 4) GERİ ALMA: profil yazımı reddedilirse Auth hesabı silinir
    {
      const s = await open("u_service");
      await gotoUsers(s);
      await openNewUser(s);
      await fillUser(s, { email: "geri.alma@ornekholding.com", role: "customer", company: "Örnek", password: "Gecici123x" });
      inject.denyUserSets = 1;
      await s.page.click("#nu-submit");
      const ok = await waitFor(async () => /geri alındı/.test(await toastText(s)));
      const log = await authLog(s);
      check("profil reddedildi: oluşturulan Auth hesabı geri alındı (deleteUser) ve ileti 'geri alındı' diyor", ok && log.some((l) => l[0] === "delete"), `${await toastText(s)} ${JSON.stringify(log)}`);
      check("profil yazılmadı; ileti yönlendirici (Console/Rules metni YOK)", !userByEmail("geri.alma@ornekholding.com") && !/Console|Rules/.test(await toastText(s)));
      check("hesap kaydı silindi: aynı e-postayla yeniden denenebilir", (await s.page.evaluate(() => window.__existingAuth["geri.alma@ornekholding.com"])) === undefined);
      // aynı form açık: tekrar dene (yeni parola gerekmez)
      await s.page.click("#nu-submit");
      const retry = await waitFor(async () => (await s.page.locator("#modal-user-success.is-open").count()) > 0);
      check("yeniden deneme başarılı (e-posta 'yanmadı')", retry && !!userByEmail("geri.alma@ornekholding.com"), await toastText(s));
      await s.context.close();
    }

    // =============================================================================================== 5) YON-03/08: satır içi yeni firma sırası + ortak kod doğrulayıcı
    {
      // Sayfa açılmadan önce başka bir firma kodu kullanımda olsun (istemci listesi yüklenirken görür)
      world.seed("v2/companies/cZ", { company_id: "cZ", name: "Başka Firma", customer_code: "CUS0005", customer_type: "CUS", is_active: true, created_at: new Date().toISOString() });
      const s = await open("u_service");
      await gotoUsers(s);
      await openNewUser(s);
      const c0 = companyCount();
      // (a) geçersiz kullanıcı (e-posta yok) → firma YAZILMAZ
      await s.page.fill("#nu-first-name", "Firma");
      await s.page.fill("#nu-last-name", "Deneme");
      await s.page.fill("#nu-phone", "5301112233");
      await s.page.fill("#nu-temp-password", "Gecici123x");
      await s.page.fill("#nu-company", "Tamamen Yeni Firma A.Ş.");
      await s.page.click(".sv2-ac-create");
      await s.page.click("#nu-submit");
      await sleep(600);
      check("kullanıcı doğrulaması geçmedi: firma yazılmadı (YON-03)", companyCount() === c0 && (await s.page.locator(".sv2-field-error").count()) > 0, `firma ${c0}→${companyCount()}`);
      // (b) müşteri kodu biçimi/öneki
      await s.page.fill("#nu-email", "yeni.firma@yenifirma.com");
      await s.page.fill("#nu-company-code", "ARC0001");
      await s.page.click("#nu-submit");
      await sleep(500);
      check("CUS tipli firma için ARC kodu reddedildi (ortak doğrulayıcı; firma yazılmadı)", companyCount() === c0 && /CUS ile başlamalıdır/.test(await s.page.locator("#nu-new-company-fields .sv2-field-error").allTextContents().then((a) => a.join(" "))), `firma ${companyCount()}`);
      // (c) çift tanımlı kod
      await s.page.fill("#nu-company-code", "CUS0005");
      await s.page.click("#nu-submit");
      await sleep(500);
      check("kullanılan müşteri kodu reddedildi (benzersizlik)", companyCount() === c0 && /zaten/.test((await s.page.locator("#nu-new-company-fields .sv2-field-error").allTextContents()).join(" ")), `firma ${companyCount()}`);
      // (d) geçerli kod; ama profil reddedilir → firma bir kez yazılır, yeniden denemede İKİNCİ firma oluşmaz
      await s.page.fill("#nu-company-code", "CUS0006");
      inject.denyUserSets = 1;
      const base = companyCount();
      await s.page.click("#nu-submit");
      await waitFor(async () => /geri alındı|yetkiniz yok/.test(await toastText(s)));
      check("doğrulama geçti: firma tam bir kez yazıldı", companyCount() === base + 1, `firma ${base}→${companyCount()}`);
      await s.page.click("#nu-submit");
      const done = await waitFor(async () => (await s.page.locator("#modal-user-success.is-open").count()) > 0);
      check("yeniden denemede firma tekrar oluşmadı (seçili duruma alındı) ve kullanıcı oluşturuldu", done && companyCount() === base + 1 && userByEmail("yeni.firma@yenifirma.com")?.customer_code === "CUS0006", `firma ${companyCount()} | ${JSON.stringify(userByEmail("yeni.firma@yenifirma.com"))}`);
      await s.context.close();
    }

    // =============================================================================================== 6) yetim hesap kurtarma (yedek akış)
    {
      const s = await open("u_service", { existingAuth: { "yetim@parla-demo.com": "Bilinen123x", "yetim2@parla-demo.com": "Baska123x" } });
      await gotoUsers(s);
      await openNewUser(s);
      await fillUser(s, { email: "yetim@parla-demo.com", role: "customer", company: "Örnek", password: "Bilinen123x" });
      await s.page.click("#nu-submit");
      const ok = await waitFor(async () => (await s.page.locator("#modal-user-success.is-open").count()) > 0);
      const log = await authLog(s);
      const profile = userByEmail("yetim@parla-demo.com");
      check("yetim hesap aynı parolayla kurtarıldı: uid mevcut hesaptan, profil yazıldı, hesap silinmedi", ok && profile && profile.uid === "orphan-yetim" && !log.some((l) => l[0] === "delete"), `${JSON.stringify(profile)} ${JSON.stringify(log)}`);
      await s.context.close();

      const s2 = await open("u_service", { existingAuth: { "yetim2@parla-demo.com": "Baska123x" } });
      await gotoUsers(s2);
      await openNewUser(s2);
      await fillUser(s2, { email: "yetim2@parla-demo.com", role: "customer", company: "Örnek", password: "Yanlis123x" });
      await s2.page.click("#nu-submit");
      const msg = await waitFor(async () => /profili yok/.test(await toastText(s2)));
      check("parola uymazsa anlaşılır hata (yetim hesap; Console/sunucu onarımı yönergesi), profil yok", msg && !userByEmail("yetim2@parla-demo.com"), await toastText(s2));
      await s2.context.close();

      // "Yetim Hesabı Onar" penceresi (yedek akış: parola ister)
      const s3 = await open("u_service", { existingAuth: { "yetim3@parla-demo.com": "Bilinen123x" } });
      await gotoUsers(s3);
      await s3.page.click("#btn-repair-user");
      await s3.page.waitForSelector("#rp-email");
      await waitFor(async () => await s3.page.locator("#rp-password-group").isVisible());
      await s3.page.fill("#rp-email", "yetim3@parla-demo.com");
      await s3.page.fill("#rp-first", "Onarılan");
      await s3.page.fill("#rp-last", "Hesap");
      await s3.page.fill("#rp-phone", "5301112233");
      await s3.page.selectOption("#rp-role", "consultant");
      await s3.page.fill("#rp-password", "Bilinen123x");
      await s3.page.click("#rp-submit");
      const repaired = await waitFor(async () => !!userByEmail("yetim3@parla-demo.com"));
      check("'Yetim Hesabı Onar' (yedek): profil mevcut hesaba bağlandı", repaired && userByEmail("yetim3@parla-demo.com").uid === "orphan-yetim3" && userByEmail("yetim3@parla-demo.com").role === "consultant", JSON.stringify(userByEmail("yetim3@parla-demo.com")));
      check("personel rolünde firma alanları boş (YON-16)", userByEmail("yetim3@parla-demo.com")?.company_id === "");
      await s3.context.close();
    }

    // =============================================================================================== 7) sunucu kipi (route taklidi): davet, parola yok; hata eşlemesi
    {
      const handler = (body) => {
        if (body.action === "status") return { json: { success: true, action: "status", data: { configured: true }, warnings: [] } };
        if (body.action === "create" && body.dry_run) {
          if (String(body.email).startsWith("var@")) return { status: 409, json: { success: false, code: "email_in_use", message: "Bu e-posta adresi zaten kayıtlı.", errors: { email: "Bu e-posta adresi zaten kayıtlı." } } };
          return { json: { success: true, action: "create", data: { dry_run: true }, warnings: [] } };
        }
        if (body.action === "create") {
          return { json: { success: true, action: "create", data: { uid: "srv-1", email: String(body.email).toLowerCase(), mode: body.password ? "password" : "invite", invite: { status: "sent" }, orphan_repaired: false }, warnings: [{ code: "no_personnel", message: "Eşleşen personel kaydı yok." }] } };
        }
        return { status: 400, json: { success: false, code: "bad_action" } };
      };
      const s = await open("u_service", { api: handler });
      await gotoUsers(s);
      await openNewUser(s);
      check("sunucu kipi: eski yöntem uyarısı yok, davet seçeneği görünür ve işaretli, geçici şifre alanı gizli", !(await s.page.locator("#nu-fallback-note").isVisible()) && (await s.page.locator("#nu-invite").isChecked()) && !(await s.page.locator("#nu-password-group").isVisible()));
      // sunucu çakışma hatası: firma YAZILMADAN alan hatası (dry_run)
      await fillUser(s, { email: "var@ornekholding.com", role: "customer" });
      await s.page.fill("#nu-company", "Yeni Sunucu Firması Ltd.");
      await s.page.click(".sv2-ac-create");
      const c0 = companyCount();
      await s.page.click("#nu-submit");
      await waitFor(async () => (await s.page.locator("#nu-email ~ .sv2-field-error, .sv2-form-group.has-error").count()) > 0);
      check("sunucu çakışması (409): e-posta alanında hata, yeni firma YAZILMADI", companyCount() === c0 && /zaten kayıtlı/.test((await s.page.locator(".sv2-field-error").allTextContents()).join(" ")), `firma ${c0}→${companyCount()}`);
      // başarılı davet
      await s.page.fill("#nu-email", "davet@yenifirma.com");
      await s.page.click("#nu-submit");
      const ok = await waitFor(async () => (await s.page.locator("#modal-user-success.is-open").count()) > 0);
      const createCall = s.api.filter((b) => b.action === "create" && !b.dry_run).pop();
      check("davet: sunucuya parola GÖNDERİLMEDİ, yeni firma id'si ile çağrıldı", ok && createCall && createCall.password === undefined && createCall.company_id && createCall.company_id !== "__pending__", JSON.stringify(createCall));
      check("davet penceresi: parola gösterilmez, e-posta bilgisi var; sunucu uyarısı toast", ok && (await s.page.locator("#cred-password").count()) === 0 && /Davet|davet/.test(await s.page.locator("#modal-user-success").textContent()) && /personel kaydı yok/.test(await toastText(s)), await toastText(s));
      check("dry_run isteği firma yazımından ÖNCE gitti", s.api[1] && s.api[1].dry_run === true && s.api[1].company_id === "__pending__", JSON.stringify(s.api.map((b) => [b.action, b.dry_run])));
      await s.context.close();
    }

    // =============================================================================================== 8) kullanıcı detayı
    {
      const s = await open("u_service");
      await s.goto("/support-v2/admin/user-detail.html?uid=u_root");
      await s.page.waitForSelector(".sv2-content");
      await sleep(500);
      check("Destek Atayıcı, Süper Admin detayında: düzenle/şifre/pasife al düğmeleri YOK (YON-05)", (await s.page.locator("#btn-edit-user, #btn-reset-pwd, #btn-toggle-active").count()) === 0 && /yönetme yetkiniz yok/.test(await s.page.locator(".sv2-content").textContent()));
      await s.goto("/support-v2/admin/user-detail.html?uid=u_service");
      await s.page.waitForSelector(".sv2-content");
      await sleep(400);
      check("kendi detayında: düzenle var, pasife al YOK (kendini kilitleme, YON-06)", (await s.page.locator("#btn-edit-user").count()) === 1 && (await s.page.locator("#btn-toggle-active").count()) === 0);
      await s.page.click("#btn-edit-user");
      await s.page.waitForSelector("#edit-user-form");
      check("kendi rol seçimi devre dışı", await s.page.locator('#edit-user-form select[name="role"]').isDisabled());
      await s.context.close();

      const s2 = await open("u_service");
      await s2.goto("/support-v2/admin/user-detail.html?uid=u_cust2");
      await s2.page.waitForSelector("#btn-edit-user");
      await s2.page.click("#btn-edit-user");
      await s2.page.waitForSelector("#edit-user-form");
      const editOpts = await s2.page.locator('#edit-user-form select[name="role"] option').evaluateAll((els) => els.map((e) => e.value));
      check("düzenleme rol listesi oturum rolüne göre süzülü", !editOpts.includes("super_admin") && !editOpts.includes("service_admin") && editOpts.includes("customer"), editOpts.join());
      await s2.context.close();

      // yedek akış: pasife alma (profil) + uyarı; ardından aktive et
      const s3 = await open("u_root");
      await s3.goto("/support-v2/admin/user-detail.html?uid=u_cust2");
      await s3.page.waitForSelector("#btn-toggle-active");
      await s3.page.click("#btn-toggle-active");
      await confirmDialogClick(s3);
      await waitFor(async () => val("v2/users/u_cust2/is_active") === false && /açık kalır/.test(await toastText(s3)));
      check("yedek akış: profil pasife alındı ve Auth hesabının açık kaldığı uyarıldı", val("v2/users/u_cust2/is_active") === false && /açık kalır/.test(await toastText(s3)), await toastText(s3));
      await s3.context.close();

      // sunucu kipi: setActive çağrısı (profil + Auth + oturum iptali sunucuda)
      const s4 = await open("u_root", { api: (b) => (b.action === "setActive" ? { json: { success: true, action: "setActive", data: { uid: b.uid, is_active: b.active }, warnings: [] } } : { json: { success: true, data: {}, warnings: [] } }) });
      await s4.goto("/support-v2/admin/user-detail.html?uid=u_cust2");
      await s4.page.waitForSelector("#btn-toggle-active");
      await s4.page.click("#btn-toggle-active");
      await confirmDialogClick(s4);
      await waitFor(async () => s4.api.some((b) => b.action === "setActive"));
      const call = s4.api.find((b) => b.action === "setActive");
      check("sunucu kipi: pasife alma/aktive etme sunucu işlevi üzerinden (uid + active)", call && call.uid === "u_cust2" && call.active === true, JSON.stringify(call));
      await s4.context.close();
    }

    // =============================================================================================== 9) geçici şifre: crypto, Math.random değil
    {
      const s = await open("u_root");
      await gotoUsers(s);
      const res = await s.page.evaluate(async () => {
        const m = await import("/assets/js/support-v2/ticket-utils.js");
        const orig = Math.random;
        let used = false;
        Math.random = () => { used = true; return 0.5; };
        const passwords = new Set();
        for (let i = 0; i < 50; i += 1) passwords.add(m.generateTempPassword());
        Math.random = orig;
        return { used, size: passwords.size, ok: [...passwords].every((p) => p.length === 12 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)) };
      });
      check("generateTempPassword: Math.random kullanılmaz, 50 farklı şifre, hepsi ilkeye uygun (SEC-31)", !res.used && res.size === 50 && res.ok, JSON.stringify(res));
      await s.context.close();
    }

    // =============================================================================================== 10) oturum zaman aşımı + çıkışta temizlik
    {
      const visited = async (uid, ageMs, path) => {
        const s = await open(uid);
        const urls = [];
        s.page.on("framenavigated", (f) => { if (f === s.page.mainFrame()) urls.push(f.url()); });
        await s.goto(path);
        await s.page.waitForSelector(".sv2-content");
        await s.page.evaluate(([u, age]) => localStorage.setItem(`sv2_last_active_${u}`, String(Date.now() - age)), [uid, ageMs]);
        urls.length = 0;
        await s.goto(path);
        await sleep(1200);
        const expired = urls.some((u) => /login\.html.*reason=expired/.test(u));
        await s.context.close();
        return expired;
      };
      const H = 3600 * 1000;
      check("personel 9 saat boşta → oturum zaman aşımı (girişe 'expired')", await visited("u_root", 9 * H, "/support-v2/admin/dashboard.html"));
      check("personel 7 saat boşta → oturum sürer", !(await visited("u_root", 7 * H, "/support-v2/admin/dashboard.html")));
      check("müşteri 9 saat boşta → oturum sürer (limit 30 gün)", !(await visited("u_cust", 9 * H, "/support-v2/customer/dashboard.html")));
      check("müşteri 31 gün boşta → oturum zaman aşımı", await visited("u_cust", 31 * 24 * H, "/support-v2/customer/dashboard.html"));

      // çıkışta yerel iz temizliği
      const s = await open("u_root");
      await s.goto("/support-v2/admin/dashboard.html");
      await s.page.waitForSelector("#sv2-logout-btn");
      await s.page.evaluate(() => {
        localStorage.setItem("sv2_seen_u_root", JSON.stringify({ t1: "x" }));
        localStorage.setItem("sv2_seen_baseline_u_root", "1");
        localStorage.setItem("sv2_bell_cache_u_root", "{}");
        localStorage.setItem("sv2_email_outbox_u_root", JSON.stringify([{ payload: { type: "ticket_message", to: ["info@x.com"], ticketData: { ticket_id: "yok" }, requestId: "r1" }, attempts: 0, firstAt: Date.now(), lastAt: Date.now(), nextAt: Date.now() + 3600000 }]));
      });
      await s.page.click("#sv2-logout-btn");
      await waitFor(async () => /login\.html/.test(s.page.url()));
      const left = await s.page.evaluate(() => Object.keys(localStorage).filter((k) => /^sv2_(seen|bell|email_outbox|last_active)/.test(k)));
      check("çıkışta e-posta kuyruğu, 'görüldü' ve zil önbelleği temizlendi (SEC-28)", left.length === 0, left.join());
      await s.context.close();
    }

    // =============================================================================================== 11) auth-action: must_change_password bayrağı kapanır
    {
      const s = await srv.session("u_new");
      await s.page.addInitScript(() => {
        let fb;
        Object.defineProperty(window, "__PARLA_FIREBASE", {
          configurable: true,
          get: () => fb,
          set: (v) => {
            fb = v;
            v.authFn.signInWithEmailAndPassword = async () => ({ user: { uid: "u_new", email: "ahmet.guler@ornekholding.com" } });
          },
        });
      });
      check("(ön koşul) u_new bayrağı açık", val("v2/users/u_new/must_change_password") === true);
      await s.goto("/support-v2/auth-action.html?mode=resetPassword&oobCode=abc123");
      await s.page.waitForSelector("#sv2-new-password");
      await s.page.fill("#sv2-new-password", "YeniSifre123");
      await s.page.fill("#sv2-new-password2", "YeniSifre123");
      await s.page.click("#sv2-reset-submit");
      const cleared = await waitFor(async () => val("v2/users/u_new/must_change_password") === false);
      check("bağlantıyla şifre belirleyen kullanıcının must_change_password bayrağı kapandı (EML-17, SEN-10)", cleared, String(val("v2/users/u_new/must_change_password")));
      await s.context.close();
    }
  } finally {
    await srv.close();
  }
  console.log(`\n${pass}/${pass + fail} geçti`);
  process.exit(fail ? 1 : 0);

  async function confirmDialogClick(s) {
    await s.page.waitForSelector("#sv2-confirm-ok");
    await s.page.click("#sv2-confirm-ok");
  }
})().catch((e) => { console.error(e); process.exit(2); });
