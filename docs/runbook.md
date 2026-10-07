# İşletim El Kitabı (Runbook) — Parla BT Destek Portalı v2

Bu belge **kim ne zaman ne yapar** sorusunun cevabıdır: yayın sırası, geri alma, yedekten dönme, olay müdahalesi, anahtar
döndürme ve kota izleme. Ayrıntılı ilk kurulum kontrol listesi için `docs/yayin-kontrol-listesi.md`, izleme hesapları için
`docs/monitoring.md`, kişisel veri süreçleri için `docs/kvkk.md` belgelerine bakın. (Denetim: ALT-11, ALT-12, ALT-14, ALT-15, ALT-29.)

> **Kural (CLAUDE.md):** `main` dalına açık onay olmadan push yapılmaz; her push Netlify build kredisi harcar. Önce yerelde test,
> sonra tek seferde toplu push.

## 1. Sistem haritası

| Parça | Nerede çalışır | Not |
|---|---|---|
| Statik site + portal (HTML/ES modülleri) | Netlify (`main` dalı, publish `.`) | Build yok; Functions `netlify/functions` |
| Kimlik doğrulama | Firebase Authentication (`parla-bt-web`) | Parola yalnızca Firebase'de |
| Veritabanı | Firebase Realtime Database `v2/*` (europe-west1, **Spark planı**) | Kurallar: kaynak `tests/rules/generate-rules.js` → `database.rules.json` |
| E-posta | Netlify Function `/api/send-email` → Resend; Auth e-postaları Firebase SMTP → Resend | Ortak kota: ≈100 e-posta/gün |
| Zamanlanmış işler | Netlify scheduled functions: `ticket-automation` (30 dk), `email-digest` (06:00 UTC), `backup-export` (02:30 UTC) | Yalnızca *production* dağıtımında çalışır; `FIREBASE_SERVICE_ACCOUNT` yoksa kendiliğinden atlanır |
| Tam yedek | GitHub Actions `backup.yml` (02:45 UTC) → artifact (30 gün) | Depo ÖZEL olmalı; `BACKUP_PASSPHRASE` ile şifrelenir |
| CI | GitHub Actions `ci.yml`, `secrets.yml` (gitleaks), `deploy-rules.yml` | Aşağıda §2 |

## 2. Yayın (deploy) sırası

### 2.1 Yayın öncesi (yerel)

```bash
node --test netlify/tests/*.test.* tests/unit/*.test.mjs
(cd tests/rules && npm ci && npm test)
node tests/rules/generate-rules.js /tmp/g.json && diff database.rules.json /tmp/g.json   # kural dosyası üreteçle aynı mı
(cd tests/e2e && npm ci)                       # bir kez (Playwright + axe-core)
A11Y_REQUIRE=1 node tests/e2e/run-all.cjs --skip xss,button-crawler
node tests/e2e/xss.e2e.cjs                     # yavaş (≈5-10 dk)
node tests/e2e/button-crawler.e2e.cjs          # her rol × her sayfa × her düğme (≈10 dk)
```

Aynı kapı GitHub'da `ci.yml` ile otomatik çalışır (`unit`, `rules`, `e2e`, `e2e-xss`, `e2e-crawler`). `main` korumasız olduğundan **tek güvenlik ağı**
budur; zorunlu kılmak için GitHub → Settings → Branches → *Add rule* (`main`) → *Require status checks to pass* → bu beş işi seçin.
(Tek kişilik ekipte *Require a pull request* şart değildir.)

### 2.2 Sıra

1. **Kural değişikliği var mı?** (`database.rules.json` / `generate-rules.js` diff'inde) Varsa dağıtımdan ÖNCE canlı veriyi tarayın:
   `tests/rules/README.md` → "Dağıtımdan ÖNCE: canlı veriyi tara" (Console → JSON dışa aktar → `node scan-existing-data.cjs`; çıkış kodu 2 = ENGEL).
2. Kullanıcıdan **main'e push onayı** alın; tek toplu push.
3. Netlify build'i bitince doğrulayın: `GET https://www.parlabilgiteknolojileri.net/api/send-email` → `configured:true`; giriş sayfası açılıyor; PDF kılavuzlar açılıyor.
4. **Hemen ardından kurallar** (kural değiştiyse): `firebase deploy --only database --project parla-bt-web`
   (ya da `FIREBASE_SERVICE_ACCOUNT` GitHub secret'ı tanımlıysa `deploy-rules.yml` push'ta kendisi yapar; elle: Actions → *Deploy RTDB rules* → Run workflow, **yalnızca `main` dalından** çalışır).
   Kural ve istemci birbirine bağımlıysa (yeni düğüm/alan) iki adım arasındaki süreyi dakikalarla sınırlayın.
5. Duman testi: `docs/yayin-kontrol-listesi.md` §5 (10 dk).
6. Zamanlanmış işlevler çalışıyor mu: Netlify → Functions → `ticket-automation`, `backup-export` günlüğünde bir sonraki çalışmadan sonra `atlandı`/hata yok.

### 2.3 Ortam değişkeni değiştirince
Netlify env değişkeni eklemek/değiştirmek **yeniden dağıtım** ister (Deploys → Trigger deploy → *Clear cache and deploy site*). Bu da build kredisi harcar; birden çok değişikliği tek seferde yapın.

## 3. Geri alma (rollback)

| Ne bozuldu | Geri alma | Not |
|---|---|---|
| Site/portal/Functions | Netlify → Deploys → önceki başarılı dağıtım → **Publish deploy**. | Bu, otomatik yayını durdurur; düzelttikten sonra **Start auto publishing**. Kredi harcamaz. |
| Veritabanı kuralları | `git show <önceki-iyi-commit>:database.rules.json > database.rules.json` → `firebase deploy --only database --project parla-bt-web`. Firebase Console → Realtime Database → Rules → *Geçmiş* sekmesi de son sürümleri tutar. | Eski kurallar güvensiz olabilir (yetki yükseltme açığı); yalnızca acil durumda, ardından hızlıca düzeltin. Geri alınmış `database.rules.json`, üreteçten farklı olacağından CI kırılır — kalıcı çözüm `generate-rules.js`'yi de geri almaktır. |
| Veri (yanlış silme/bozulma) | §4 Yedekten geri yükleme. | Silinen kayıtlar yedekte (en fazla 14/30 gün) bulunur. |
| E-posta | `RESEND_API_KEY`'i önceki değere çevirin (§6) ya da Resend panelinde alan adı durumunu kontrol edin. | |
| Zamanlanmış otomasyon istenmeyen e-posta atıyor | Netlify env'den `FIREBASE_SERVICE_ACCOUNT`'ı geçici kaldırın (işlevler kendiliğinden atlar) veya `AUTOMATION_EMAIL_DAILY_MAX=0`; yeniden dağıtın. | |

## 4. Yedek ve geri yükleme

### 4.1 Yedekler nerede
- **Netlify Blobs** `db-backups` deposu: `<YYYY-MM-DD>/<düğüm>.json.gz` + `manifest.json`; `BACKUP_RETENTION_DAYS` (varsayılan 14) gün saklanır. 30 sn işlev sınırı nedeniyle `manifest.json` içinde `partial:true` olabilir.
- **GitHub Actions artifact** `rtdb-backup-<run_id>` (30 gün; *tam*, süresiz çalışan iş). `BACKUP_PASSPHRASE` tanımlıysa dosyalar `.gpg` (AES-256) şifrelidir.
- Elle: Firebase Console → Realtime Database → Veri → kök ⋮ → *JSON'u dışa aktar* (kişisel veri içerir; depoya koymayın).
- İlk gün ve sonra **üç ayda bir** bir *geri yükleme tatbikatı* yapın (§4.3 test projesinde ya da yerelde).

### 4.2 Yedeği indirme
```bash
# GitHub artifact (gh CLI):
gh run list --workflow backup.yml --limit 5
gh run download <run_id> -n rtdb-backup-<run_id> -D yedek
# Şifreliyse:
find yedek -name '*.gpg' | while read f; do gpg --batch --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -o "${f%.gpg}" -d "$f"; done

# Netlify Blobs (netlify-cli; site bağlı olmalı):
netlify blobs:list db-backups
netlify blobs:get db-backups 2026-10-07/tickets.json.gz --output tickets.json.gz
```
Her `*.json.gz`, `{ "<düğüm>": <değer> }` biçiminde tek düğüm içerir. `manifest.json` → `partial`, `skipped`, `omitted_attachment_data` alanlarını kontrol edin (ek dosya verisi bütçe aşılırsa atlanmış olabilir: `data_omitted:true`).

### 4.3 Geri yükleme (örnek: `tickets` düğümü)
**Önce hedefi yedekleyin**, mümkünse önce test projesine yükleyip kontrol edin. Tek kayıt/tek düğüm geri yüklemek tüm veritabanını ezmekten güvenlidir.

```bash
gunzip -c yedek/2026-10-07/tickets.json.gz > /tmp/tickets.full.json          # {"tickets": {...}}
node -e 'const j=require("/tmp/tickets.full.json");require("fs").writeFileSync("/tmp/tickets.json",JSON.stringify(j.tickets))'
# TEK KAYIT geri yükleme (önerilen):
node -e 'const j=require("/tmp/tickets.full.json").tickets;require("fs").writeFileSync("/tmp/one.json",JSON.stringify(j["<ticketId>"]))'
firebase database:set /v2/tickets/<ticketId> /tmp/one.json --project parla-bt-web
# TÜM düğümü geri yükleme (mevcut düğümün ÜZERİNE yazar!):
firebase database:set /v2/tickets /tmp/tickets.json --project parla-bt-web
```
Notlar:
- `firebase database:set` kurallardan bağımsız (yönetici yetkisiyle) yazar; geri yüklenen veri `.validate` kurallarından geçmeyebilir ama yazılır. Eski kayıtların yeni kurallarda kilitlenmemesi için `tests/rules/scan-existing-data.cjs`'yi geri yüklenen JSON ile çalıştırın.
- Bir talebin bağlı düğümleri ayrı yedeklenir (`ticket_messages`, `ticket_internal_notes`, `ticket_attachments`, `ticket_internal_attachments`, `ticket_history`, `ticket_assignments`, `ticket_efforts`). Kalıcı silinmiş bir talebi geri getirirken hepsini aynı yedek gününden geri yükleyin.
- `ticket_attachment_stats` ve `counters` tutarlılığı: sayaç düğümü (`counters`) geri alınırken talep numaraları çakışmasın diye yedekteki **en büyük** değeri korur; emin değilseniz `counters`'ı geri yüklemeyin.
- Kullanıcı kayıtları (`users`) geri yüklenirse Firebase Auth hesabı da var olmalıdır (profil ↔ Auth `uid` eşleşir); Auth hesabı silinmişse **Yönetici → Kullanıcılar → Yetim hesabı onar** akışıyla yeniden bağlayın.

## 5. Olay (incident) müdahalesi

Genel akış: **1) Sınırla → 2) Teşhis et → 3) Düzelt → 4) Doğrula → 5) Not al.** Her olayda tarih/saat, ne olduğu, ne yapıldığı bu belgenin sonundaki "Olay günlüğü" tablosuna (ya da özel depodaki issue'ya) yazılır.

| Belirti | İlk bakılacak yer | Eylem |
|---|---|---|
| Site açılmıyor / 5xx | Netlify → Deploys (son build hatası?) ve https://www.netlifystatus.com | Son dağıtım hatalıysa §3 rollback. |
| Giriş yapılamıyor | Firebase Console → Authentication; https://status.firebase.google.com; tarayıcı konsolu | Kota/ana bilgisayar yetkisi (Authorized domains) kontrolü. |
| Her şey `PERMISSION_DENIED` | Rules → son dağıtım tarihi; `database.rules.json` ↔ canlı | Yanlış kural dağıttıysanız §3 kural geri alma. |
| Veritabanı hiç yanıt vermiyor ("quota exceeded") | Console → Realtime Database → **Kullanım** | **Spark kotası doldu** (indirme 10 GB/ay ya da depolama 1 GB): Blaze'e geçin (kota anında açılır) + bütçe uyarısı; §7. |
| E-posta gitmiyor | `GET /api/send-email`; Resend → Logs; Aktiviteler → "E-posta Gönderilemedi" | Kota (100/gün) ya da anahtar: §6/§7. |
| Beklenmeyen e-posta fırtınası | Resend → Logs; Netlify → Functions günlüğü `ticket-automation` | Otomasyonu durdur (§3 son satır); hız sınırı ve günlük sert sınır (`DAILY_EMAIL_HARD_LIMIT`) zaten korur. |
| Şüpheli erişim / hesap ele geçirilmesi | Aktiviteler; Firebase Auth → Users | Kullanıcıyı pasifleştirin (kural düzeyinde engellenir), parolayı sıfırlatın; oturumların düşmesi için Console → Authentication'dan hesabı devre dışı bırakın (kimlik belirteci en geç ≈1 saatte biter; kurallar pasif kullanıcıyı zaten engeller) ya da Admin SDK `revokeRefreshTokens(uid)` çağırın. |
| Sır sızdı (anahtar/servis hesabı depoda, günlükte, ekran görüntüsünde) | — | **Hemen döndürün** (§6), sonra geçmişi inceleyin (gitleaks). Kişisel veri sızdıysa `docs/kvkk.md` §6 (ihlal bildirimi: ilgili kişi + KVKK Kurulu, **72 saat**). |
| Yanlışlıkla silinen/bozulan veri | Aktiviteler (kim, ne zaman) | §4 yedekten tek kayıt geri yükleme. |
| CI kırmızı | Actions → ilgili iş günlüğü | e2e hatası: `tests/e2e` günlüğünde `FAIL |` satırları; `main`'e merge etmeyin. |

### Olay günlüğü
| Tarih/saat | Olay | Etki | Yapılan | Kalıcı önlem |
|---|---|---|---|---|
| | | | | |

## 6. Anahtar ve sır döndürme

> Sırlar yalnızca Netlify env / GitHub secret / Firebase / Resend panelinde durur. Depoya, sohbete, e-postaya YAZMAYIN. Bir sırrın sızdığından şüpheleniyorsanız önce döndürün, sonra araştırın.

| Sır | Nerede kullanılır | Döndürme adımları | Doğrulama |
|---|---|---|---|
| **Resend API anahtarı** | (1) Netlify env `RESEND_API_KEY`; (2) Firebase Console → Authentication → Templates → SMTP parolası; (3) (kullanılıyorsa) Apps Script Script Property | Resend → API Keys → yeni anahtar oluştur → **üç yeri de** güncelle → Netlify'da yeniden dağıt → eski anahtarı sil. Mümkünse Auth SMTP için ayrı anahtar/alt alan adı kullanın (D-04). | Süper admin → Genel Bakış → E-posta Servisi → Durumu Kontrol Et + Test E-postası; ardından "Şifremi unuttum" denemesi (Auth SMTP). |
| **`FIREBASE_SERVICE_ACCOUNT`** (Admin SDK JSON) | Netlify env + GitHub secret (aynı değer) | Google Cloud Console → IAM → Hizmet hesapları → Anahtarlar → yeni JSON anahtar → (tek satıra çevir) Netlify env + GitHub secret güncelle → yeniden dağıt → **eski anahtarı sil**. Roller yalnızca *Firebase Authentication Admin* + *Firebase Realtime Database Admin*. | Yeni kullanıcı oluşturma çalışıyor; Actions → *RTDB yedeği* → Run workflow başarılı. |
| **`BACKUP_PASSPHRASE`** | GitHub secret | Yeni parola tanımlayın. **Eski yedekler eski parolayla şifrelidir**; eski parolayı güvenli bir yerde (parola yöneticisi) saklayın, yoksa eski yedekler açılamaz. | Yedek iş akışını elle çalıştırıp bir `.gpg` dosyasını açın. |
| **Firebase web `apiKey`** | İstemci kodu (herkese açıktır, sır değildir) | Döndürülmez; **kısıtlanır**: Google Cloud Console → APIs & Services → Credentials → tarayıcı anahtarı → HTTP referrer = `https://www.parlabilgiteknolojileri.net/*`, `https://parlabilgiteknolojileri.net/*`, `https://parla-bt-web.firebaseapp.com/*`. | Girişin hâlâ çalıştığını doğrulayın. |
| **GitHub kişisel erişim jetonları / Netlify jetonu** | Yerel CLI | İlgili hesap ayarlarından iptal edip yenisini oluşturun. | |

## 7. Kota izleme

| Kaynak | Sınır (ücretsiz) | Nerede izlenir | Eşik / eylem |
|---|---|---|---|
| **Resend** | ≈100 e-posta/gün, ≈3.000/ay (Auth + ticket + form e-postaları ORTAK) | Resend → Usage ve Logs; uygulamada günlük soft/hard sınır (`DAILY_EMAIL_SOFT_LIMIT=80`, `DAILY_EMAIL_HARD_LIMIT=95`); yönetici oturumuyla `GET /api/send-email` yanıtındaki `quota` alanı bugünkü kullanımı verir (E-posta Servisi kartı bu alanı okur) | Haftada bir bakın. Günlük >%80 sık görülürse ücretli plana geçin ya da Auth SMTP için ayrı hesap açın. Resend → Settings → Usage alert (varsa) %80'e kurun. |
| **Firebase RTDB (Spark)** | 1 GB depolama, 10 GB/ay indirme, 100 eşzamanlı bağlantı | Console → Realtime Database → **Kullanım** sekmesi (Depolama, İndirilen, Bağlantılar) | Haftalık bakış. **%70** (7 GB indirme ya da 700 MB depolama) → Blaze'e geçin + bütçe uyarısı ($5/$10) kurun; ek verisi (base64) 500 MB'ı geçerse Storage'a geçiş planlayın (denetim D-03). Eşik: yaklaşık 1.000–1.500 talep ya da ≥5 aktif personel. |
| **Firebase Auth** | Spark'ta SMS yok; e-posta/parola sınırsız | Console → Authentication → Usage | — |
| **Netlify** | Aylık build/bant genişliği/işlev kredisi (plana göre) | Netlify → Team → Usage | Her `main` push'u kredi harcar (CLAUDE.md); branch deploy/deploy preview kapalı tutulur (`netlify.toml` yorumu). |
| **GitHub Actions** | Özel depoda aylık dakika kotası (genel depoda ücretsiz) | Settings → Billing → Usage | `ci.yml` ≈ 15–20 dk/koşu (iş başına); gereksiz push'tan kaçının, `concurrency` eski koşuyu iptal eder. |
| **Yedek boyutu** | Netlify Blobs ve Actions artifact depolaması | `manifest.json` → `total_gz_bytes`; Actions → Artifacts | Ham boyut `DEFAULT_RAW_BUDGET` (150 MB) aşılırsa ek verisi atlanır — bu bir *RTDB boyutu* uyarısıdır. |

Spark kota/boyut göstergesi (süper admin panosunda) **şimdilik eklenmedi**: istemci RTDB boyutunu ucuz biçimde okuyamaz (kök okuma tüm veriyi indirir, kendisi kotayı tüketir); güvenli yol sunucu işlevi ve servis hesabıdır. Yedek `manifest.json` zaten günlük `total_raw_bytes` ve düğüm başına bayt verir — gelecekte bu değerlerin panoda gösterilmesi yeterli olur (WP-13/D-03 "eşik izleme" notu). Şimdilik yukarıdaki haftalık Console kontrolü geçerlidir.

## 8. Bağımlılık ve güvenlik bakımı

- **Dependabot/npm audit:** `tests/rules` ve `tests/e2e` yalnızca test bağımlılıklarıdır (üretime girmez). `ci.yml` `npm audit --audit-level=critical` çalıştırır. Kalan bilinen bulgu: `targaryen → lodash.set` (high, yama yok; yalnızca kendi kural girdilerimizle test sürecinde çalışır). `request`/`form-data`/`qs`/`uuid`/`tough-cookie` zinciri `tests/rules/package.json` içindeki `overrides` ile yamalı sürümlere/bakımlı çatala (`@cypress/request`) çevrilmiştir.
- **GitHub Actions sürümleri** tam commit SHA'sına sabittir. Güncelleme: `git ls-remote --tags https://github.com/actions/checkout.git 'refs/tags/v4*'` ile yeni etiketin SHA'sını alıp yorumdaki sürümle birlikte `.github/workflows/*.yml`'de değiştirin (hepsinde aynı).
- **SRI özetlerini yenileme** (`assets/js/support-v2/phone-utils.js`, intl-tel-input): sürümü değiştirince ITI_BASE, ITI_CSS_SRI, ITI_JS_SRI sabitlerini birlikte güncelleyin. Özeti **npm kayıt defterindeki paketten** hesaplayın (CDN'e güvenmeyin):
  ```bash
  npm pack intl-tel-input@<sürüm> && tar xzf intl-tel-input-<sürüm>.tgz
  for f in build/css/intlTelInput.css build/js/intlTelInput.min.js; do echo "$f sha384-$(openssl dgst -sha384 -binary package/$f | openssl base64 -A)"; done
  node tests/verify-sri.cjs        # CI'da da çalışır
  ```
  `utils.js` kütüphane tarafından yüklenir; SRI eklenemez (yalnızca telefon doğrulama yardımcısı; CSP ile jsDelivr kökeni sınırlıdır).
- **Uzun önbellek:** `/assets/vendor/*` 1 gün (+7 gün stale-while-revalidate), `/assets/img/*` ve `/favicon.ico` 7 gün. Dosya adlarında özet olmadığından `immutable` kullanılmaz; adlara içerik özeti eklenirse o desen için `immutable` kuralı eklenebilir (`netlify.toml`).

## 9. Açık işler (bu belgenin sahibi: repo sahibi)

- [ ] Sentry + uptime hesapları ve kurulum: `docs/monitoring.md`.
- [ ] `main` dalı için zorunlu durum kontrolleri (§2.1).
- [ ] GitHub secret `FIREBASE_SERVICE_ACCOUNT` + `BACKUP_PASSPHRASE` tanımlı mı? İlk yedek koşusunu elle çalıştırıp §4.2–4.3 tatbikatını yapın.
- [ ] Blaze planı + bütçe uyarısı kararı (D-03 eşiği).
- [ ] Hukuk danışmanı onayı: `docs/kvkk.md` ve `support-v2/privacy.html` taslağı.
- [ ] RTDB boyut/kota göstergesi (süper admin panosu) — §7 sonundaki not.
