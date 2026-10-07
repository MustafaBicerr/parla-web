# İzleme ve Uyarı Kurulumu (D-14 A: yedek + Sentry + uptime)

Bugün bir hata ancak kullanıcı bildirince fark ediliyor (denetim ALT-12). Bu belge, **sizin açmanız gereken hesapları** ve her birinin
adım adım kurulumunu içerir. Hiçbiri koda zorunlu bağımlılık eklemez; hesaplar açılana kadar portal bugünkü gibi çalışır.
İşletim süreçleri için `docs/runbook.md`.

| # | Ne | Kim kurar | Maliyet | Durum |
|---|---|---|---|---|
| 1 | Günlük RTDB yedeği (Netlify Blobs + GitHub Actions) | **Kodda hazır**; secret'ları siz ekleyin (runbook §4) | 0 | secret bekliyor |
| 2 | Uptime kontrolü (UptimeRobot / BetterStack) | **Siz** (10 dk) | 0 | bekliyor |
| 3 | Tarayıcı hata izleme (Sentry) | **Siz** hesap + DSN; kod parçası aşağıda (varsayılan KAPALI) | 0 (ücretsiz katman) | bekliyor |
| 4 | Kota / fatura alarmı (Firebase, Resend) | **Siz** (5 dk) | 0 | bekliyor |
| 5 | Netlify fonksiyon günlükleri | Hazır (panelde) | 0 | — |

## 1. Uptime kontrolü (UptimeRobot veya BetterStack — ücretsiz)

1. https://uptimerobot.com → hesap aç → **Add New Monitor**.
2. Monitor 1 — **HTTP(s)**, URL: `https://www.parlabilgiteknolojileri.net/support-v2/login.html`, aralık 5 dk, anahtar kelime denetimi (*Keyword exists*): `sv2-app`.
3. Monitor 2 — **Keyword**, URL: `https://www.parlabilgiteknolojileri.net/api/send-email` (GET), anahtar kelime: `"configured":true`. Bu, e-posta fonksiyonunun ve `RESEND_API_KEY`'in ayakta olduğunu gösterir.
4. (İsteğe bağlı) Monitor 3 — **Keyword**, Firebase RTDB erişimi: `https://parla-bt-web-default-rtdb.europe-west1.firebasedatabase.app/.json?shallow=true` **403/401 dönmesi normaldir** (kurallar kapalı); bu yüzden *HTTP status* türüyle "401 beklenir" şeklinde ayarlayın ya da atlayın. Veritabanı kotası dolunca farklı bir yanıt gelir (aşağıda §4).
5. **Alert Contacts**: e-posta adresiniz (+ isteğe bağlı SMS/Telegram). "Alert when down for 10 minutes" ile gürültüyü azaltın.
6. Durum sayfası gerekmez. Test: monitörü duraklatıp "Resume" edin, e-posta geldiğini görün.

## 2. Sentry (tarayıcı hata izleme)

Amaç: canlıda yakalanmayan JS hatalarını görmek. **Kişisel veri (PII) göndermeyin** (KVKK, `docs/kvkk.md`).

### 2.1 Hesap
1. https://sentry.io → ücretsiz hesap (Developer planı) → **Create Project** → Platform: *Browser JavaScript* → proje adı `parla-destek-portali`.
2. Proje ayarları → **Client Keys (DSN)** → DSN'yi kopyalayın (`https://<anahtar>@o<id>.ingest.sentry.io/<proje>`). DSN sır değildir ama yine de depoya yalnızca bilerek ekleyin.
3. Settings → **Security & Privacy** → *Prevent Storing of IP Addresses* açık, *Data Scrubber* açık.
4. Alerts → *Create Alert* → "A new issue is created" → size e-posta.

### 2.2 Kod parçası (varsayılan KAPALI — DSN verilmedikçe hiçbir şey yüklenmez)
Portal sayfalarında `site-config.js` yüklendikten sonra çalışacak küçük bir modül önerilir. DSN eklenmeden etkinleştirmeyin; bugünkü sürümde **sayfalara eklenmemiştir**. Etkinleştirmek için (1) aşağıdaki dosyayı `assets/js/support-v2/error-reporting.js` olarak ekleyin, (2) her portal HTML'sinde `login.js`/sayfa betiğinden önce `<script type="module" src="/assets/js/support-v2/error-reporting.js"></script>` ekleyin, (3) `site-config.js`'e `SENTRY_DSN` ekleyin, (4) `netlify.toml` CSP'sine aşağıdaki kökenleri ekleyin, (5) `tests/e2e/harness.cjs`'e Sentry isteklerini susturan bir `page.route` ekleyin (CSP/harici istek testleri için).

```js
// assets/js/support-v2/error-reporting.js — Sentry tarayıcı SDK'sı (yalnızca DSN tanımlıysa yüklenir; PII göndermez)
const dsn = (window.__PARLA_SITE_CONFIG && window.__PARLA_SITE_CONFIG.SENTRY_DSN) || "";
if (dsn && !/localhost|127\.0\.0\.1/.test(location.hostname)) {
  const s = document.createElement("script");
  s.src = "https://browser.sentry-cdn.com/8.x.y/bundle.min.js"; // sürümü sabitleyin ve integrity/crossorigin ekleyin (docs/runbook.md "SRI özetlerini yenileme")
  s.crossOrigin = "anonymous";
  s.onload = () => {
    window.Sentry.init({
      dsn,
      release: "parla-web@" + (window.__PARLA_SITE_CONFIG.RELEASE || "dev"),
      environment: "production",
      sendDefaultPii: false,
      tracesSampleRate: 0,          // yalnızca hata; performans izleme kapalı
      replaysSessionSampleRate: 0,  // oturum kaydı KAPALI (kişisel veri)
      beforeSend(event) {
        // E-posta ve kimlik izlerini temizle
        if (event.user) event.user = { id: event.user.id };
        const scrub = (v) => String(v || "").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-posta]");
        if (event.message) event.message = scrub(event.message);
        (event.exception && event.exception.values || []).forEach((e) => { e.value = scrub(e.value); });
        if (event.request) { delete event.request.cookies; delete event.request.headers; }
        return event;
      },
      ignoreErrors: ["ResizeObserver loop limit exceeded", "Non-Error promise rejection captured"],
    });
  };
  document.head.appendChild(s);
}
```

CSP (Report-Only bloklarında) eklenmesi gerekenler: `script-src https://browser.sentry-cdn.com`, `connect-src https://*.ingest.sentry.io` (ve AB bölgesi kullanıyorsanız `https://*.ingest.de.sentry.io`). SRI özetini paketin kendi sürümünden hesaplayın (CDN'e güvenmeyin).

> Alternatif (hesapsız): `window.onerror` → hız sınırlı bir Netlify fonksiyonuna (`/api/client-log`) yazma; şimdilik uygulanmadı.

### 2.3 Sunucu (Netlify Functions) hataları
Fonksiyonlar 5xx ve beklenmeyen durumlarda `console.error` yazar; Netlify → **Logs → Functions** panelinde görünür (saklama süresi plana bağlıdır). Hızlı alarm için Netlify → Site configuration → **Notifications → Deploy and function notifications** (varsa) e-posta bildirimini açın; ücretsiz planda günlük akışı (log drain) yoktur, haftalık bir göz atma yeterlidir.

## 3. Yedek başarısı izleme
- GitHub: Settings → Notifications → "Actions: Failed workflows only" e-postası açık olsun; `backup.yml` başarısız olunca haber gelir.
- Elle kontrol (haftalık): Actions → *RTDB yedeği* son koşu yeşil mi, artifact boyutu mantıklı mı; Netlify → Blobs → `db-backups` son gün klasöründe `manifest.json` var mı (`partial:true` değil mi).
- Uptime servisinde yedek için "heartbeat" izleme de kullanılabilir (UptimeRobot *Heartbeat monitor*): `backup.yml` sonuna `curl -fsS <heartbeat-url>` adımı eklenir (isteğe bağlı; secret olarak saklayın).

## 4. Kota ve fatura alarmları
- **Firebase / Google Cloud:** Console → Project settings → *Usage and billing* → Blaze'e geçmeden önce **Details & settings**; Blaze'de Cloud Billing → **Budgets & alerts** → bütçe $5 ve $10, eşikler %50/%90/%100, e-posta bildirimi. Spark planında veritabanı kotası dolunca (10 GB/ay indirme) **veritabanı durur** — bu yüzden haftalık Console → Realtime Database → *Kullanım* bakışı (`docs/runbook.md` §7).
- **Resend:** Dashboard → **Usage**; günlük 100 e-postaya yaklaşımı için uygulamadaki soft/hard sınır korur (`DAILY_EMAIL_SOFT_LIMIT/HARD_LIMIT`). Resend → Webhooks ile `email.bounced` / `email.complained` olayları ayrı bir adreste izlenebilir (isteğe bağlı).
- **Netlify:** Team → Usage → e-posta uyarısı eşiği (plan sayfasında varsa).

## 5. Kurulum sonrası doğrulama listesi
- [ ] UptimeRobot: giriş sayfası + `/api/send-email` izleniyor, test uyarısı e-postaya geldi.
- [ ] (Sentry kullanılacaksa) hesap + DSN + `SENTRY_DSN` + CSP güncellemesi + test hatası (`setTimeout(() => { throw new Error("sentry-test"); })` konsoldan) Sentry'de göründü, e-posta ve IP görünmüyor.
- [ ] GitHub "Failed workflows" bildirimi açık; `backup.yml` bir kez elle çalıştırıldı.
- [ ] Firebase/Resend kota ve bütçe uyarıları kuruldu.
- [ ] Her şey `docs/runbook.md` §9 "Açık işler" listesinde işaretlendi.
