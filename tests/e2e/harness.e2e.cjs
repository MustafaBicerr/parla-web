/**
 * E2E: test altyapısının KENDİ testi (WP-15; SEN-27, ALT-27). Harness yanlış-negatif/yanlış-pozitif üretmesin:
 *  - anonim işlem, önceki yazanın yetkisini TAŞIMAZ (targaryen `as(null)` tuzağı);
 *  - `runTransaction` eşzamanlı çağrılarda atomik (kayıp güncelleme yok, numaralar benzersiz);
 *  - `signOut` oturumu gerçekten kapatır (currentUser null, veritabanı işlemleri reddedilir, yeniden yükleme girişe döner);
 *  - `signInWithEmailAndPassword` taklidi (yanlış parola reddedilir, doğru parolayla oturum açılır);
 *  - oturum e-postası dolu; same-origin 404 sayfa hatası sayılır; SRI isteği kaydedilir (intl-tel-input).
 * Çalıştırma: node tests/e2e/harness.e2e.cjs
 */
const { createWorld, startServer } = require("./harness.cjs");
const { buildSeed } = require("./seed.cjs");

const results = [];
const check = (name, ok, extra) => results.push([ok ? "PASS" : "FAIL", name, ok ? "" : extra || ""]);

(async () => {
  const world = createWorld(buildSeed());

  // ---- 1) Node tarafı: as(null) tuzağı --------------------------------------------------------------------------------
  const rootWrite = world.dbOp({ uid: "u_root", op: "set", path: "v2/counters/SUP/AUTHTEST/2610", value: 1 });
  check("hazırlık: süper admin yazabilir", rootWrite.ok === true, JSON.stringify(rootWrite));
  const anonRead = world.dbOp({ uid: null, op: "get", path: "v2/users" });
  check("yazımdan hemen sonra anonim okuma REDDEDİLİR (son yazanın yetkisi taşınmaz)", anonRead.error === "PERMISSION_DENIED", JSON.stringify(anonRead).slice(0, 200));
  const anonWrite = world.dbOp({ uid: null, op: "set", path: "v2/counters/SUP/AUTHTEST/2610", value: 2 });
  check("anonim yazma REDDEDİLİR", anonWrite.error === "PERMISSION_DENIED", JSON.stringify(anonWrite).slice(0, 200));
  check("anonim yazma veriyi değiştirmedi", world.valueAt("v2/counters/SUP/AUTHTEST/2610") === 1);
  const custRead = world.dbOp({ uid: "u_cust", op: "get", path: "v2/users" });
  check("müşteri tüm kullanıcı listesini OKUYAMAZ (kimlik değişimi doğru uygulanır)", custRead.error === "PERMISSION_DENIED", JSON.stringify(custRead).slice(0, 200));
  const casConflict = world.dbOp({ uid: "u_root", op: "cas", path: "v2/counters/SUP/AUTHTEST/2610", expected: 5, value: 6 });
  check("cas: beklenen değer uyuşmazsa çakışma döner ve yazmaz", casConflict.conflict === true && world.valueAt("v2/counters/SUP/AUTHTEST/2610") === 1, JSON.stringify(casConflict));

  const srv = await startServer(world);
  try {
    // ---- 2) Atomik transaction (kural zorlayan, ADMIN olmayan personel; yalnız +1 artışa izin verilir) -------------------
    const staff = await srv.session("u_cons1");
    await staff.goto("/support-v2/admin/dashboard.html");
    await staff.page.waitForSelector(".sv2-content");
    const N = 12;
    const out = await staff.page.evaluate(async (n) => {
      const fb = window.__PARLA_FIREBASE;
      const ref = fb.db.ref(fb.database, "v2/counters/SUP/ATOMTEST/2610");
      const runs = Array.from({ length: n }, () =>
        fb.db.runTransaction(ref, (cur) => (typeof cur === "number" ? cur : 0) + 1).then((r) => ({ ok: r.committed, v: r.snapshot.val() }), (e) => ({ err: String(e.message || e).slice(0, 120) }))
      );
      return Promise.all(runs);
    }, N);
    const values = out.filter((r) => r.ok).map((r) => r.v).sort((a, b) => a - b);
    check(`${N} eşzamanlı transaction hepsi başarılı`, out.every((r) => r.ok), JSON.stringify(out.filter((r) => !r.ok)));
    check("transaction sonuçları benzersiz ve ardışık (1…N): kayıp güncelleme yok", JSON.stringify(values) === JSON.stringify(Array.from({ length: N }, (_, i) => i + 1)), JSON.stringify(values));
    check("son değer N", world.valueAt("v2/counters/SUP/ATOMTEST/2610") === N, String(world.valueAt("v2/counters/SUP/ATOMTEST/2610")));
    const aborted = await staff.page.evaluate(async () => {
      const fb = window.__PARLA_FIREBASE;
      const r = await fb.db.runTransaction(fb.db.ref(fb.database, "v2/counters/SUP/ATOMTEST/2610"), () => undefined);
      return r.committed;
    });
    check("işlev undefined dönerse transaction iptal edilir (yazmaz)", aborted === false && world.valueAt("v2/counters/SUP/ATOMTEST/2610") === N);
    await staff.context.close();

    // ---- 3) Oturum e-postası, signOut, signIn ---------------------------------------------------------------------------
    const cust = await srv.session("u_cust");
    await cust.goto("/support-v2/customer/dashboard.html");
    await cust.page.waitForSelector(".sv2-content");
    const email = await cust.page.evaluate(() => window.__PARLA_FIREBASE.auth.currentUser && window.__PARLA_FIREBASE.auth.currentUser.email);
    check("oturum e-postası dolu", email === "ayse.demir@ornekholding.com", String(email));
    const before = await cust.page.evaluate(async () => {
      const fb = window.__PARLA_FIREBASE;
      return (await fb.db.get(fb.db.ref(fb.database, "v2/users/u_cust"))).exists();
    }).catch((e) => "err " + e);
    check("oturum açıkken müşteri kendi profilini okuyabilir (kontrol)", before === true, String(before));
    // Çıkış: sayfadaki kimlik dinleyicileri tetiklenir (korumalı sayfa girişe döner), bağlam artık oturumsuzdur.
    await Promise.all([
      cust.page.waitForURL(/login\.html/, { timeout: 8000 }).catch(() => {}),
      cust.page.evaluate(() => window.__PARLA_FIREBASE.authFn.signOut()).catch(() => {}),
    ]);
    check("signOut: kimlik dinleyicisi tetiklenir ve korumalı sayfa girişe döner", /login\.html/.test(cust.page.url()), cust.page.url());
    check("signOut sonrası bağlam durumu oturumsuz", cust.state.uid === null);
    await cust.page.waitForSelector("#sv2-login-form", { timeout: 8000 }).catch(() => {});
    check("signOut sonrası currentUser null", (await cust.page.evaluate(() => window.__PARLA_FIREBASE.auth.currentUser)) === null);
    const afterOut = await cust.page.evaluate(async () => {
      const fb = window.__PARLA_FIREBASE;
      try { await fb.db.get(fb.db.ref(fb.database, "v2/users/u_cust")); return "izin verildi"; } catch (e) { return e.code; }
    });
    check("signOut sonrası veritabanı okuması reddedilir", afterOut === "PERMISSION_DENIED", String(afterOut));
    cust.errors.length = 0;
    await cust.goto("/support-v2/customer/dashboard.html");
    await cust.page.waitForURL(/login\.html/, { timeout: 8000 }).catch(() => {});
    check("signOut sonrası yeniden yüklenen korumalı sayfa girişe yönlendirir", /login\.html/.test(cust.page.url()), cust.page.url());

    // signIn: yanlış parola reddedilir, doğru parolayla oturum açılır
    const bad = await cust.page.evaluate(async () => {
      try { await window.__PARLA_FIREBASE.authFn.signInWithEmailAndPassword({}, "ayse.demir@ornekholding.com", "yanlis"); return "kabul"; } catch (e) { return e.code; }
    });
    check("signIn: yanlış parola reddedilir", bad === "auth/invalid-credential", String(bad));
    const good = await cust.page.evaluate(async (pw) => {
      const r = await window.__PARLA_FIREBASE.authFn.signInWithEmailAndPassword({}, "AYSE.demir@ornekholding.com ", pw);
      return r.user.uid;
    }, world.password);
    check("signIn: doğru parola (e-posta büyük/küçük harf duyarsız) oturum açar", good === "u_cust", String(good));
    await cust.goto("/support-v2/customer/dashboard.html");
    await cust.page.waitForSelector(".sv2-content", { timeout: 8000 }).catch(() => {});
    check("signIn sonrası yeni sayfa yüklemesi oturumlu açılır", /customer\/dashboard\.html/.test(cust.page.url()) && (await cust.page.locator(".sv2-content").count()) > 0, cust.page.url());

    // ---- 4) same-origin 404 sayfa hatası sayılır ------------------------------------------------------------------------
    cust.errors.length = 0;
    await cust.page.evaluate(() => fetch("/assets/img/yok-boyle-bir-dosya.png").then((r) => r.status));
    await cust.page.waitForTimeout(150);
    check("yerel 404 `errors` listesine düşer", cust.errors.some((e) => /^http 404: \/assets\/img\/yok-boyle-bir-dosya\.png/.test(e)), JSON.stringify(cust.errors));
    await cust.context.close();

    // ---- 5) SRI: telefon bileşeni betik/CSS'i integrity ile istenir ------------------------------------------------------
    const root = await srv.session("u_root");
    await root.goto("/support-v2/admin/users.html");
    await root.page.waitForSelector("#btn-new-user");
    await root.page.click("#btn-new-user");
    await root.page.waitForFunction(() => document.querySelector('script[src*="intlTelInput"]'), null, { timeout: 8000 }).catch(() => {});
    const sri = await root.page.evaluate(() => ({
      js: (document.querySelector('script[src*="intlTelInput"]') || {}).integrity || "",
      css: (document.querySelector("link[data-iti-css]") || {}).integrity || "",
    }));
    check("intl-tel-input betiği SRI (sha384) ile istenir", /^sha384-[A-Za-z0-9+/]{64}$/.test(sri.js), JSON.stringify(sri));
    check("intl-tel-input CSS'i SRI (sha384) ile istenir", /^sha384-[A-Za-z0-9+/]{64}$/.test(sri.css), JSON.stringify(sri));
    await root.context.close();
  } finally {
    await srv.close();
  }
  results.forEach((r) => console.log(r.join(" | ")));
  const fails = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - fails}/${results.length} geçti`);
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
