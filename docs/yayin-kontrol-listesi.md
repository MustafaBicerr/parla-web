# Yayın Kontrol Listesi — Destek Portalı v2

Bu liste `main` dalındaki kodun canlıya alınması içindir. İşletim ayrıntıları (geri alma, yedekten dönme, anahtar döndürme, kota) için
`docs/runbook.md`; izleme hesapları için `docs/monitoring.md`; kişisel veri için `docs/kvkk.md` belgelerine bakın.

> **Kural (CLAUDE.md):** `main`'e kullanıcı onayı olmadan push yapılmaz; her push Netlify build kredisi harcar. Değişiklikleri yerelde test edin,
> onay alın, **tek seferde toplu** push edin. `main`'e gidene kadar canlıya hiçbir şey gitmez; veritabanı kuralları ayrıca elle dağıtılır.

**Dağıtım sırası (bozmayın):**

1. İstemci/site (`main` → Netlify)
2. Canlı veri taraması ve göç (`tests/rules/scan-existing-data.cjs`)
3. Veritabanı kuralları (`firebase deploy --only database --project parla-bt-web`)
4. Firebase Console ayarları, e-posta sınaması, duman testi
5. Servis hesabı ve zamanlanmış işlevler (otomasyon, kullanıcı yönetimi işlevi, yedek) — **önce §6'daki uyarıyı okuyun**

Kurallar siteden önce giderse danışmanlar (kural düzeyinde `assigned_uids` yok), kapalı talebi yeniden açmak isteyen müşteriler (`closed_at_ms` yok) ve
bazı yazımlar `PERMISSION_DENIED` alır; site kurallardan çok önce giderse yeni kural gerektiren işlemler (toplu işlem, hazır yanıt, sözleşme bedeli) başarısız olur.
İki adım arasındaki süreyi dakikalarla sınırlayın.

## 0. Ön koşullar (bir kez yapılır)

- [x] Netlify sitesi GitHub `main` dalına bağlı (publish dizini `.`, functions `netlify/functions`, Node 22).
- [x] Resend'de `parlabilgiteknolojileri.net` alan adı doğrulanmış (SPF/DKIM).
- [ ] **Netlify → Site configuration → Build & deploy → Branches**: branch deploy ve deploy preview **kapalı** (aksi halde her dal push'u kredi harcar ve üretim veritabanına/Resend'e yazan önizleme üretir).
- [ ] **Netlify ortam değişkenleri** (Site configuration → Environment variables; her değişiklik sonrası yeniden dağıtım gerekir — hepsini tek seferde girin):

  | Değişken | Zorunlu mu? | Açıklama |
  |---|---|---|
  | `RESEND_API_KEY` | **Zorunlu** | E-posta gönderimi. Alan adı durumunu okumak için tam yetkili anahtar gerekir. |
  | `FIREBASE_SERVICE_ACCOUNT` | Önerilir | Servis hesabı JSON'u, **tek satır** (düz JSON ya da base64). Kullanıcı yönetimi işlevini (davet, yetim hesap onarımı, pasife alma), `ticket-automation` ve `backup-export` işlevlerini etkinleştirir. Tanımlı değilse bunlar kendiliğinden kapalı kalır. **Eklemeden önce §6'ya bakın.** |
  | `AUTOMATION_EMAIL_DAILY_MAX` | İsteğe bağlı | Otomasyonun günlük e-posta payı (varsayılan 40; `0` = otomasyon e-posta atmaz). Otomatik kapanış bildirimleri muaftır. |
  | `AUTOMATION_MAX_EMAILS_PER_RUN` | İsteğe bağlı | Tek çalıştırmada en çok e-posta (varsayılan 15). |
  | `DAILY_EMAIL_SOFT_LIMIT` · `DAILY_EMAIL_HARD_LIMIT` | İsteğe bağlı | Günlük kota yumuşak/sert sınırı (80 / 95). Resend ücretsiz planı ≈100/gün ve Auth + form e-postalarıyla **ortaktır**. |
  | `CONTACT_EMAIL` · `SITE_URL` · `ALLOWED_ORIGINS` | İsteğe bağlı | Destek kutusu adresi; e-posta bağlantı kökü; ek site alan adları (tam host; `*.netlify.app` jokeri yoktur). |
  | `BACKUP_RETENTION_DAYS` | İsteğe bağlı | Netlify Blobs yedek saklama günü (14). |
  | `FIREBASE_PROJECT_ID` · `FIREBASE_DATABASE_URL` | İsteğe bağlı | Varsayılan: `parla-bt-web`. |

  Tüm adların açıklaması `.env.example` içindedir (değer yazılmaz).
- [ ] **GitHub → Settings → Secrets and variables → Actions** secret'ları: `FIREBASE_SERVICE_ACCOUNT` (otomatik kural dağıtımı + günlük tam yedek; Netlify'dakiyle aynı JSON) ve isteğe bağlı `BACKUP_PASSPHRASE` (yedek dosyalarını AES-256 ile şifreler). Tanımlı değilse ilgili iş "atlandı" olarak biter.
- [ ] **GitHub → Settings → Branches**: `main` için zorunlu durum kontrolleri (`docs/runbook.md` §2.1).

## 1. Güvenlik temizliği (henüz yapılmadıysa — her şeyden önce)

Bu adımlar kod değil hesap/ayar işidir; sızmış olabilecek sırları kapatır.

- [ ] **Gemini API anahtarını iptal edip yenisini oluşturun** (Google AI Studio / Cloud Console → Credentials). Eski anahtar geçmiş commit'lerde okunabilmiş olabilir; depodan silinmesi yetmez, **döndürülmesi şarttır**. Yenisini yalnızca Apps Script → Project settings → *Script properties*'e (`GEMINI_API_KEY`) koyun; son aylardaki kullanım/fatura kayıtlarına bakın.
- [ ] **Depoyu özel (private) yapın**: GitHub → Settings → General → Danger Zone → *Change visibility*. (Netlify özel depolarla aynı şekilde çalışır; yedek artifact'ları kişisel veri içerdiğinden özel depo zorunludur.)
- [ ] **Apps Script'in canlı kopyasında** kimlik doğrulamasız `support_v2_notify` dalı kalmadığından emin olun ve yeni sürümle yeniden dağıtın (Deploy → Manage deployments → New version). Resend panelinde son haftaların gönderimlerinde beklenmeyen alıcı varsa Resend anahtarını döndürün (`docs/runbook.md` §6).
- [ ] Canlı sitede ifşa kontrolü: `curl -sI https://www.parlabilgiteknolojileri.net/yedek_kod.gs`, `/temp.json`, `/docs/ticket-system-analysis.md`, `/database.rules.json`, `/CLAUDE.md` — hepsi **404** dönmelidir (`netlify.toml` kalkanı). 200 dönüyorsa önce siteyi yayınlayın.

## 2. Yayın öncesi yerel doğrulama

```bash
node --test netlify/tests/*.test.* tests/unit/*.test.mjs
(cd tests/rules && npm install && npm test)
(cd tests/e2e && npm install)                                  # bir kez: Playwright + axe-core
node tests/e2e/run-all.cjs --skip xss,button-crawler           # hızlı e2e kümesi; tam liste ve notlar: CLAUDE.md "Testler"
node tests/e2e/xss.e2e.cjs                                     # yavaş (≈10 dk)
```

- [ ] Birim testleri, kural testleri ve e2e testleri yeşil. (`xss` e2e yavaştır, ≈10 dk; `a11y` e2e `axe-core` ister — yoksa atlanır.)
- [ ] `database.rules.json`, `node tests/rules/generate-rules.js` çıktısıyla aynı (kural testi bunu doğrular).

## 3. Canlı veriyi tarayın ve göç edin (kurallardan ÖNCE)

Yeni `.validate` kuralları canlıdaki eski kayıtları kilitleyebilir; ayrıca yeni kurallar bazı alanlara (`assigned_uids`, `closed_at_ms`, `contract_values`) dayanır.

1. Firebase Console → Realtime Database → Veri → kök düğüm ⋮ → **JSON'u dışa aktar** (kişisel veri içerir; depoya koymayın).
2. `cd tests/rules && node scan-existing-data.cjs <export.json> --emit-backfill goc.json --json rapor.json`
   (çıkış kodu `0` temiz · `1` göç/kayıt bulgusu · `2` **ENGEL** — kuralları dağıtmayın, önce veriyi düzeltin; ayrıntı `tests/rules/README.md`).
3. Göç dosyasını (`goc.json`: çok-yollu güncelleme nesnesi) Admin SDK ile uygulayın; Console "İçe aktar" kullanmayın.
   - Eski sözleşme bedelleri `contracts/<id>/value` → `contract_values/<id>` taşınır.
   - Eski iç notlar için süper admin → Genel Bakış → **Veri Bakımı** → **İç Notları Taşı** (güvenle tekrar çalıştırılabilir).
- [ ] Tarama temiz (ENGEL yok), göç uygulandı.

## 4. Siteyi yayınlayın

1. Kullanıcıdan **main'e push onayı** alın; tek toplu push. Netlify build'i bitince (Deploys) sonucu doğrulayın.
2. `https://www.parlabilgiteknolojileri.net/api/send-email` (GET) → `{"success":true,"configured":true,...}`.
3. Giriş sayfası açılıyor mu? **Yalnızca Kullanıcı Kılavuzu** kartı listelenmelidir (Sistem Adminleri Kılavuzu girişten kaldırıldı; personel menüden/üst çubuktan erişir).
4. `https://www.parlabilgiteknolojileri.net/support-v2/docs/Kullanici-Kilavuzu.pdf` ve `.../Sistem-Adminleri-Kullanim-Kilavuzu.pdf` açılıyor mu? (PDF'ler elle `docs/manuals/out/` → `support-v2/docs/` kopyalanır; sürüm/sayfa sayısı kılavuz kapağıyla uyuşmalı.)

## 5. Veritabanı kurallarını dağıtın (zorunlu)

Yeni özellikler (talep durum makinesi, atama bazlı yazma, yumuşak/kalıcı silme, toplu işlemler, hazır yanıtlar, sözleşme bedeli düğümü, talep tipi kilidi,
pasif hesap engeli) yeni kurallara dayanır; kurallar dağıtılmadan bu işlemler `PERMISSION_DENIED` verir. Kurallar aynı zamanda eski sürümdeki yetki yükseltme açığını kapatır.

```bash
npm i -g firebase-tools        # bir kez
firebase login
firebase deploy --only database --project parla-bt-web
```

- [ ] Firebase Console → Realtime Database → Rules: yayınlanma tarihi ve içerik repodaki `database.rules.json` ile aynı mı?

> Otomatikleştirmek için GitHub → Settings → **Secrets and variables → Actions** → `FIREBASE_SERVICE_ACCOUNT` (rolü *Firebase Realtime Database Admin*). Secret tanımlıysa
> `database.rules.json` değiştiğinde `.github/workflows/deploy-rules.yml` kuralları kendisi dağıtır; tanımlı değilse iş atlanır. Kural dosyası elle düzenlenmez:
> kaynak `tests/rules/generate-rules.js`.

**Geri alma (yalnızca acil durumda; eski kurallar güvensiz olabilir):** önce Firebase Console → Realtime Database → Rules → *Geçmiş* sekmesinden son iyi sürüme dönmeyi deneyin.
Komut satırından: `git show <önceki-iyi-commit>:database.rules.json > database.rules.json && firebase deploy --only database --project parla-bt-web`, **ardından**
`git checkout -- database.rules.json` ile dosyayı eski haline getirin (aksi halde kural testi kırılır ve eski dosya yanlışlıkla commit edilir). İlk sürümün (`1d537a6`) kuralları
yetki yükseltme açığı içerir; "son bilinen iyi yeni sürüm"ü tercih edin. Ayrıntı: `docs/runbook.md` §3.

## 6. Servis hesabını ve zamanlanmış işlevleri etkinleştirin (isteğe bağlı, önerilir)

`FIREBASE_SERVICE_ACCOUNT` tanımlanınca üç şey açılır: **davetle kullanıcı oluşturma / yetim hesap onarımı / pasife alırken Firebase hesabını kapatma**
(`/api/admin-users`), **talep otomasyonu** (30 dakikada bir) ve **günlük yedek**.

> **⚠ ÖNCE gözden geçirin:** Otomasyon, **10 günden uzun süredir "Kapanış Onayı Bekliyor" durumunda duran talepleri ilk çalışmada otomatik kapatır ve müşterilere e-posta gönderir.**
> Servis hesabını eklemeden **önce** Talepler listesini bu duruma ve tarihe göre süzün; bekleyen talepleri sonuçlandırın ya da bilerek otomatik kapanmaya bırakın.
> Ayrıca 3/7 günü geçmiş "Müşteri Bekleniyor" talepleri hatırlatma e-postası alır; eski SLA aşımları (24 saatten eski) yalnızca damgalanır, e-posta üretmez.
> Acil durdurma: Netlify'da `FIREBASE_SERVICE_ACCOUNT`'ı kaldırın ya da `AUTOMATION_EMAIL_DAILY_MAX=0` yapıp yeniden dağıtın.

1. Firebase Console → Proje ayarları → Hizmet hesapları → *Yeni özel anahtar oluştur*. Yalnızca *Firebase Authentication Admin* + *Firebase Realtime Database Admin* rolleri yeter.
2. JSON'u tek satıra çevirip Netlify env + GitHub secret olarak ekleyin (depoya, e-postaya, sohbete **yazmayın**). Netlify'da yeniden dağıtın.
3. Doğrulama: Kullanıcılar → **Yeni Kullanıcı** penceresinde “Eski yöntem kullanılıyor” uyarısı kaybolmalı ve davet kutusu görünmelidir; GitHub → Actions → *RTDB yedeği* → Run workflow başarılı olmalı;
   bir sonraki 30 dakikalık çalışmadan sonra Netlify → Functions → `ticket-automation` günlüğünde hata olmamalı.
4. Anahtarı döndürmek için: `docs/runbook.md` §6.

## 7. E-posta servisini sınayın

Süper admin ile giriş → **Genel Bakış → E-posta Servisi**:
- [ ] "Durumu Kontrol Et" → API anahtarı ve alan adı **verified** (kısıtlı anahtarsa "okunamıyor (normal)" mesajı beklenir).
- [ ] "Test E-postası Gönder" → kendi adresinize ulaştı (spam klasörüne de bakın).

## 8. Firebase Console ayarları (Authentication ve proje)

- [ ] **Authentication → Settings → User actions → Email enumeration protection: AÇIK.**
- [ ] **App Check**: reCAPTCHA Enterprise (ya da v3) ile önce *izleme*, sonra zorunlu. (Fonksiyon tarafı kullanıcı token'ıyla RTDB REST çağrısı yaptığı için App Check zorunlu kılınmadan önce uyumu doğrulayın.)
- [ ] **Web API anahtarı kısıtı**: Google Cloud Console → APIs & Services → Credentials → tarayıcı anahtarı → HTTP referrer: `https://www.parlabilgiteknolojileri.net/*`, `https://parlabilgiteknolojileri.net/*`, `https://parla-bt-web.firebaseapp.com/*`; yalnızca gerekli API'ler.
- [ ] **Şifre politikası** (Authentication → Settings → Password policy): en az 8 karakter, büyük harf, rakam (istemci kuralıyla aynı).
- [ ] Templates → SMTP: `smtp.resend.com`, port 587, kullanıcı `resend`, parola = Resend API anahtarı, gönderen `info@parlabilgiteknolojileri.net`.
- [ ] Templates → "Customize action URL": `https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html`.
- [ ] Authorized domains: `www.parlabilgiteknolojileri.net`, `parlabilgiteknolojileri.net`.
- [ ] Bütçe/kota uyarıları (Firebase, Resend): `docs/runbook.md` §7.

## 9. Duman testi (10 dakika)

| Rol | Adım | Beklenen |
|---|---|---|
| Müşteri | Giriş → **Yeni Talep** (dosya ekleyerek); tip listesinde yalnızca firmasının tipleri (SUP/BUG ya da ARZ/BUG) | Talep numarası üretilir; destek ekibine + müşteriye e-posta gider |
| Süper admin / destek atayıcı | Talebi danışmana ata | Danışmana “Size atanan talep”, müşteriye “Talebinize danışman atandı” |
| Danışman (atanmış) | Hazır yanıt ekleyip müşteriye yanıt + iç not | İç not müşteride **görünmez**; yanıt müşteriye e-postayla gider; atanmadığı talepte yazma kapalı |
| Danışman | **Kapanış Onayı İste** | Müşteride mor onay bandı + e-posta |
| Müşteri | **Onayla ve Kapat** (veya **Yeniden Aç**; ya da Kapanış Onayı'nda yanıt yaz) | Talep `Kapandı` / `Yeniden Açıldı`; danışmana e-posta |
| Yönetici (PM / destek atayıcı) | Talepler listesinde 2 talep seç → **Toplu Durum** (≥10 karakter not) | Özet pencere; yalnızca Çözüldü/Kapandı'da müşteriye e-posta |
| Süper admin | Bir talebi **Sil** → Arşiv → **Geri Yükle** | Talep listeden kalkar, arşivden geri gelir |
| Süper admin / destek atayıcı | **Yeni Kullanıcı** (davet) | Kullanıcıya şifre içermeyen davet e-postası; sonuç penceresinde bağlantı bilgisi |
| Firma yöneticisi | Taleplerim | Firmanın tüm talepleri, “Talep Sahibi” sütunuyla; kullanıcı yönetimi yok |
| Herkes | Bildirim zili, kenar menüde **Kılavuzlar** | Zil rozeti; PDF'ler açılıyor/iniyor |

## 10. İsteğe bağlı bakım

- Mevcut kullanıcıları ilk girişte şifre değiştirmeye zorlamak için Console'dan `v2/users/<uid>/must_change_password: true` ekleyin.
- Düzenli: yedek tatbikatı, kota izleme, anahtar döndürme (`docs/runbook.md`).

## 11. Sorun giderme

| Belirti | Olası neden | Çözüm |
|---|---|---|
| E-posta gitmiyor, kartta `configured:false` | `RESEND_API_KEY` eksik | Netlify → env → ekleyin → **yeniden deploy** |
| `domain not verified` | Resend alan adı doğrulanmamış | Resend → Domains → DNS kayıtlarını ekleyin |
| `403 recipient_not_allowed` | Alıcı talebin tarafı değil | Beklenen güvenlik davranışı; atama/e-posta adreslerini kontrol edin |
| `429 daily_quota` | Günlük e-posta kotası doldu | Düşük öncelikli bildirimler günlük özete düşer; kota ertesi gün yenilenir |
| `PERMISSION_DENIED` (konsol) | Kurallar dağıtılmadı ya da veri yeni kurallara uymuyor | §3 ve §5 |
| Danışman talepte yazamıyor | Danışman kaydı kullanıcı hesabıyla eşleşmemiş (`assigned_uids`) | Danışmanlar → **Personel ↔ Kullanıcı Eşleştir**; kurallar dağıtıldıysa §3 göç dosyasını uygulayın |
| Yeni Kullanıcı'da “Eski yöntem kullanılıyor” | `FIREBASE_SERVICE_ACCOUNT` tanımlı değil | §6 |
| Otomasyon çalışmıyor | Servis hesabı yok / yalnızca *production* dağıtımında çalışır | §6; Netlify → Functions günlüğü |
| `/api/send-email` 404 | Site Netlify'da değil | `assets/js/site-config.js` → `EMAIL_API_URL` |
| Bekleyen e-posta uyarısı | Geçici ağ/Resend hatası | Otomatik yeniden denenir (en çok 6 deneme / 24 saat); kalıcı hata Aktiviteler'de `E-posta Gönderilemedi` |
