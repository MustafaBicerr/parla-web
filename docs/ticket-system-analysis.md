# Talep Sistemi (Destek Portalı v2) — Mimari, Durum ve Bilinen Sınırlar

Güncelleme: 2026-10-07 (denetim WP-02…WP-16 sonrası) · Kapsam: `support-v2/`, `assets/js/support-v2/`, `netlify/`, `database.rules.json`
Bu belge **uygulanan sistemi** anlatır; denetim bulguları ve iş planı için `docs/ticket-sistemi-denetim-raporu.md`, yayın sırası için
`docs/yayin-kontrol-listesi.md`, işletim için `docs/runbook.md`.

## 1. Mimari (kısa)

| Katman | Teknoloji | Not |
|---|---|---|
| Arayüz | Statik HTML + ES modülleri (`support-v2/**`, `assets/js/support-v2/**`) | Framework yok, build yok; yerel Font Awesome alt kümesi; dar ekranda tablolar kart olur |
| Kimlik | Firebase Auth (e-posta/şifre) | Kullanıcı oluşturma **sunucu işleviyle** (`/api/admin-users`, Admin SDK/servis hesabı: davet + geri alma + onarım); servis hesabı yoksa uyarıyla istemci tarafı yedek akış |
| Veri | Firebase Realtime Database, `v2/*` | Yetki = `database.rules.json` (kaynak `tests/rules/generate-rules.js`, elle düzenlenmez) + arayüz; sunucu işlevleri Admin SDK kullanır |
| E-posta | Tarayıcı → `POST /api/send-email` (Netlify Function) → Resend | Alıcılar ve içerik **sunucuda** türetilir; hız sınırı + günlük kota; tarayıcı kuyruğu (geçici hatalar) |
| Zamanlanmış işler | Netlify scheduled functions | `ticket-automation` (30 dk), `email-digest` (06:00 UTC), `backup-export` (02:30 UTC); servis hesabı yoksa kendiliğinden kapalı |
| Auth e-postaları | Firebase Console SMTP (Resend) | Şifre sıfırlama (kullanıcının başlattığı); yönetici davet/bağlantı e-postaları Netlify işlevinden gider |
| Site formları | Apps Script (`docs/gas/yedek_kod.gs`, gizli anahtarsız yedek) | Portal talep e-postaları GAS'tan **geçmez** |
| Yedek | Netlify Blobs (14 gün) + GitHub Actions artifact (30 gün, isteğe bağlı şifreli) | Bkz. `docs/runbook.md` §4 |

## 2. Hazırlık durumu

| Modül | Durum | Not |
|---|---|---|
| Giriş / roller / yönlendirme | Hazır | 7 rol (`company_admin` dahil); zorunlu şifre değişimi (geçici şifreli hesaplar); boşta oturum zaman aşımı: personel 8 saat, müşteri 30 gün |
| Talep açma (müşteri / yönetici) | Hazır | Numara `TİP-MÜŞTERİ-MODÜL-YYAA-SIRA` (değişmez); dosya eki (≤3 dosya, ≤2 MB); **talep tipi kilidi** (CUS → SUP/BUG, ARC → ARZ/BUG; kurallarda da); PRJ talebi proje ister (yönetici tarafı) |
| Atama (çoklu danışman, birincil) | Hazır | Danışman e-postası/kimlik bağı atamaya kaydedilir; danışman **tüm talepleri okur, yalnızca atandığı talepte yazar** (kurallar `assigned_uids` ile zorlar) |
| Mesajlaşma, efor kaydı, geçmiş | Hazır | **İç notlar ayrı düğümde** (`ticket_internal_notes`); efor 0,25–24 saat, en çok 30 gün geriye, girenin danışman kaydına |
| Hazır yanıtlar | Hazır | `reply_templates`; değişkenler `{musteri_adi}`, `{talep_no}`, `{danisman}`; yazma yalnız süper admin/destek atayıcı |
| Toplu işlemler | Hazır | Toplu atama / toplu durum (yalnız süper admin, destek atayıcı, proje yöneticisi); en çok 300 talep; durum için ≥10 karakter not; yalnız Çözüldü/Kapandı müşteriye e-posta |
| Durum akışı | Hazır | İzinli geçiş matrisi (`ticket-utils.js` ve kurallar); koşullu yazma (bayat ekran yarım kayıt yapmaz); damgalar (`resolved_at/closed_at/reopened_at`) tek yerden |
| Müşteri yanıtı | Hazır | Kapanış Onayı / Çözüldü iken müşteri yanıtı talebi **otomatik yeniden açar**; Müşteri Bekleniyor'da yanıt → İşlemde; kapalı talebe yazılamaz (14 gün içinde yeniden açılır) |
| SLA | Hazır | **7/24 takvim saati**; Müşteri Bekleniyor ve Kapanış Onayı Bekliyor'da saat **gerçekten durur**; çözüm = kapanış onayına ilk geçiş; ihlal damgası kalıcı; yeniden açılışta yeni pencere; yalnız SUP/ARZ/BUG |
| Otomasyon | Hazır (servis hesabı gerekir) | SLA %80 uyarısı ve aşımı; Müşteri Bekleniyor hatırlatmaları (3. ve 7. gün); Kapanış Onayı hatırlatması (3. gün) ve **10. gün otomatik kapanış**; 4 saat atanmamış eskalasyonu |
| Silme | Hazır | Yumuşak silme (arşiv; süper admin + destek atayıcı geri yükler) ve yalnız süper adminin **kalıcı silmesi** (tüm bağlı düğümlerle, geri alınamaz) |
| Uygulama içi bildirim | Hazır | Türetilmiş zil (veritabanına yazmaz); hedefli sorgular; görünür sekmede ≈5 dk yoklama; okundu bilgisi tarayıcıda |
| E-posta bildirimleri | Hazır, dağıtım bekliyor | §4; hatalar görünür (uyarı + aktivite), geçici hatalarda tarayıcı kuyruğu |
| Kullanıcılar | Hazır | Davet (şifre içermeyen bağlantı e-postası), **Yetim Hesabı Onar**, şifre belirleme bağlantısı, pasife alma (Auth hesabı da kapanır); yalnız süper admin/destek atayıcı (**firma yöneticisi kullanıcı yönetemez**); destek atayıcı süper admin/destek atayıcı rolü veremez |
| Firma / sözleşme / proje / danışman | Hazır | Firma ad/kod değişince kopyalar yayılır; sözleşme etkin durumu tek hesaptan, firma "Sözleşmeli" rozeti ondan türer; **sözleşme bedeli yalnız süper admin/destek atayıcı** (`contract_values`); PRJ talepleri projeye bağlanır |
| Modüller / Destek Türleri | Referans (salt-okunur) | Formlar, SLA ve numara sabit kod listesini (`ticket-utils.js`) kullanır; sayfalardaki değişiklikler formlara yansımaz |
| Raporlar, aktiviteler, dışa aktarma | Hazır | CSV `;` ayraçlı, formül nötrlemeli; çözüm süresi pano ve raporlarda aynı tanım; aktivite `limitToLast(200)` + "Daha eski yükle" |
| Güvenlik (RTDB kuralları) | Hazır, dağıtım bekliyor | §5 |
| Şifre değiştirme / sıfırlama | Hazır | `change-password.html`, `auth-action.html` (şifre kuralı: ≥8, 1 büyük harf, 1 rakam) |
| PDF kılavuzlar | Hazır | `support-v2/docs/`; kullanıcı kılavuzu girişten ve menüden, **sistem adminleri kılavuzu yalnız personel menüsünden/üst çubuktan**; kaynak `docs/manuals/` |
| Eski v1 portal | Kaldırıldı | `support/`, `assets/js/support/` silindi; `/support` → v2 girişine yönlenir |

Genel değerlendirme: uçtan uca akış (aç → ata → yanıtla → çöz → müşteri onayı → kapat / yeniden aç) ve yönetim modülleri tamam. Üretime almadan önce
**altyapı adımları** (veri taraması, kural dağıtımı, Console ayarları, servis hesabı) `docs/yayin-kontrol-listesi.md` sırasıyla yapılmalıdır.

## 3. Terminoloji

| Terim | Anlamı |
|---|---|
| **Talep** | Portaldaki tek kayıt türü; müşteri ve yönetim tarafında aynı sözcük ("Ticket" kullanılmaz). Menü: *Talepler* (yönetim), *Taleplerim* (müşteri) |
| **Muhatap** | Yalnızca **müşteri firmadaki kişi** (talep sahibi); personel için kullanılmaz |
| **Kullanıcı** | Portalda hesabı olan herkes; yönetim menüsü *Kullanıcılar* (eski "Muhataplar") |
| **Danışman** | Taleplere atanabilen personel kaydı (*Danışmanlar*; "Personel" değil); birincil danışman liste/iş yükü/zil için esastır |
| Durum etiketleri | Açık · Atandı · İşlemde · Müşteri Bekleniyor · Kapanış Onayı Bekliyor · Çözüldü · Kapandı · **Yeniden Açıldı** (eski "Tekrar Açıldı") |

## 4. E-posta mimarisi ve doğrulama

Tarihçe (denetim öncesi hatalar, **düzeltildi**): hatalar sessizce yutuluyordu; kullanıcı yönetimi sayfası eksik modül yüzünden açılmıyordu; atama sonrası müşteri yanıtları
kimseye bildirilmiyordu; bazı olaylarda yanlış alıcı/şablon seçiliyordu. Bugünkü model:

- Tarayıcı yalnızca olayı ve kayıt kimliğini (`message_id` / `history_id`) iletir; **alıcıları ve metni sunucu** veritabanından türetir, e-posta kök adresi sabittir (`SITE_URL`).
- Her istek Firebase kimlik jetonu taşır; pasif hesap reddedilir; `Origin` denetlenir (tam eşleşme; `*.netlify.app` jokeri yok, `localhost` yalnızca üretim dışı).
- Hız sınırı (kullanıcı/talep başına) ve **günlük kota** (yumuşak 80 / sert 95; Resend ücretsiz planı ≈100/gün, Auth + form e-postalarıyla ortak). Kota dolunca düşük öncelikli bildirimler günlük özete (06:00 UTC) düşer.
- Geçici hatalarda tarayıcı kuyruğu: en çok 6 deneme veya 24 saat (5 dk, 30 dk, 2 sa, 6 sa, 12 sa aralıklar), aynı istek kimliğiyle mükerrer gitmez; süre dolarsa Aktiviteler'e `E-posta Gönderilemedi` yazılır. Kuyruk tarayıcıya bağlıdır; sunucu tarafı kalıcı kuyruk yoktur.
- Parola e-postayla **gönderilmez**: yeni kullanıcıya şifre belirleme bağlantısı gider. Bildirim e-postalarında "bu adrese yanıt vermeyin, portaldan yazın" notu vardır.
- Portal e-postaları Apps Script'ten geçmez; Apps Script yalnızca kurumsal site formlarını (iletişim/kariyer/fikir/sohbet) işler.

**Altyapıda doğrulanması gerekenler** (kodla kanıtlanamaz):

| # | Kontrol | Nasıl bakılır |
|---|---|---|
| A | Netlify function yayında mı, site Netlify'da mı? | `curl -s https://www.parlabilgiteknolojileri.net/api/send-email` → `{"configured":true,...}` bekleniyor. HTML/404 ise function yok. |
| B | `RESEND_API_KEY` Netlify ortam değişkeni | Yukarıdaki yanıtta `configured:false` ise eksik. Değişkenden sonra **yeniden deploy** gerekir. |
| C | Resend'de `parlabilgiteknolojileri.net` doğrulanmış mı (SPF/DKIM) | Genel Bakış → E-posta Servisi → "Durumu Kontrol Et" (tam yetkili anahtarla alan adı durumunu gösterir). |
| D | Uçtan uca | "Test E-postası Gönder" (kendi adresinize). Spam klasörüne de bakın. |
| E | Site hangi alan adında? | İzinli: `parlabilgiteknolojileri.net`, `www.`, `parla-bt-web.web.app`, `parla-bt-web.firebaseapp.com`. Başka alan adı veya deploy önizlemesi için Netlify'a `ALLOWED_ORIGINS=tam.host` ekleyin. |
| F | Firebase Auth e-postaları (şifre sıfırlama) | Console → Authentication → Templates → SMTP (`smtp.resend.com`, 587, kullanıcı `resend`) ve "Customize action URL" = `https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html`. Aksi halde Firebase'in varsayılan göndericisi kullanılır ve spam'e düşer. |

Site Firebase Hosting'de değil Netlify'dadır (`firebase.json` hosting bloğu kaldırıldı). Site başka bir yerde çalıştırılırsa `assets/js/site-config.js` içinde
`EMAIL_API_URL` / `ADMIN_USERS_API_URL` Netlify adresine çevrilir (CORS desteklidir).

## 5. Güvenlik (RTDB kuralları)

Eski sürümdeki kritik açıklar (kullanıcı profili üzerinden yetki yükseltme, başkasının talebini okuma/silme, herkese açık sözleşme/personel verisi, müşterinin kendi talebinin
durumunu/önceliğini değiştirmesi) **yeni kurallarla kapatılmıştır**; kurallar canlıya dağıtılana kadar eski kurallar geçerlidir — bu yüzden kural dağıtımı yayın listesinin zorunlu adımıdır.
Bugünkü kurallar özeti (ayrıntı: `tests/rules/generate-rules.js` başlık yorumu ve `tests/rules/README.md`):

- Pasif hesap hiçbir rolün yetkisini kullanamaz; **profili olmayan hesap talep/mesaj/ek yazamaz**. Kullanıcı kendi rolünü/aktifliğini/firmasını değiştiremez; süper admin ve destek atayıcı hesaplarını yalnız süper admin yönetir.
- Tüm kritik düğümlerde `.validate`: izinli alan listesi, uzunluk/enum/ISO biçimi, kimlik bağlama (`user_id === auth.uid` vb.); mesajlar, geçmiş ve aktivite eklenir, değiştirilemez.
- Danışman okumada geniş, **yazmada atamaya bağlı** (`assigned_uids`); müşteri yalnız kendi talebini (firma yöneticisi firmasınınkini) okur; iç notlar ve ekleri yalnız personele açıktır.
- Müşteri: kapalı/silinmiş talebe yazamaz, kapanmış talebi `closed_at_ms + 14 gün` içinde yeniden açar, talep tipi firma türüne kilitlidir, pasif firma yeni talep açamaz.
- Silme: yumuşak silme (`is_deleted`) destek atayıcı ve süper admin; kalıcı silme (cascade) yalnız süper admin. Sözleşme bedeli `contract_values` düğümünde yalnız süper admin/destek atayıcıya açıktır.
- `notifications`, `system_state`, `ops` istemciye kapalıdır; yalnız sunucu (Admin SDK) kullanır.
- Yetki matrisi (rol × işlem) otomatik test edilir (`tests/rules/matrix.test.js`).

Not: Firebase'de genel e-posta kaydı kapatılamaz; ancak kullanıcılar artık sunucu işleviyle (davet) oluşturulur ve profilsiz hesap kural düzeyinde etkisizdir. Ek önlemler Console ayarlarıdır
(e-posta numaralandırma koruması, App Check, API anahtarı kısıtı — `docs/yayin-kontrol-listesi.md` §8).

## 6. Bilinen sınırlar ve sonraki adımlar (bilinçli olarak kapsam dışı)

1. **Sunucu tarafı kalıcı e-posta kuyruğu yok.** Yeniden deneme tarayıcıda yapılır (en çok 6 deneme / 24 saat); sekme kapanırsa bekleyen e-posta bir sonraki girişte gönderilir. Otomasyon e-postaları sunucudan gider ve kota dolunca özete düşer.
2. **Dosya ekleri RTDB'de base64** (Firebase Storage kullanılmıyor): ≤3 dosya, ≤2 MB, görseller istemcide sıkıştırılır. Ek hacmi ≈500 MB'ı geçerse Storage'a taşıyın (talep başına ek kotası kuralı hazır ama kapalıdır).
3. **Ölçek:** yönetici liste/raporları tüm talepleri istemciye çeker (aktivite günlüğü ve müşteri listeleri sayfalı/hedefli); binlerce talepten sonra sunucu tarafı özet düğümleri/sayfalama gerekir (Spark kota eşikleri: `docs/runbook.md` §7).
4. **SLA hedefleri sabit** (`ticket-utils.js` → `SLA_TARGETS_HOURS`); sözleşmeye özel hedef ve mesai takvimi yok (7/24).
5. **Modül ve destek türü listeleri sabit** kod listesidir; sayfaları referanstır.
6. Bildirim tercihleri (kullanıcı bazlı e-posta kapatma) yok; e-postadan talebe yanıt (e-posta→talep) yok.
7. Mevcut ("must_change_password" bayrağı olmayan) kullanıcılar zorunlu şifre değişimine tabi değildir; isterseniz Console'dan bayrağı ekleyin.
8. Eski dahili notlar (kural değişikliğinden önce `ticket_messages` içine yazılmış olanlar) için süper admin → Genel Bakış → **Veri Bakımı** → "İç Notları Taşı".
9. KVKK metinleri taslak durumundadır (`docs/kvkk.md`); izleme (Sentry/uptime) hesapları kurulmamıştır (`docs/monitoring.md`).

## 7. Dağıtım sırası

Ayrıntılı, işaretlenebilir liste: **`docs/yayin-kontrol-listesi.md`**; işletim: **`docs/runbook.md`**. Özet:

1. Güvenlik temizliği (sızan anahtarı döndürme, depoyu özel yapma), yerel testler.
2. **Canlı veriyi tarayıp göç edin** (`tests/rules/scan-existing-data.cjs`; ENGEL varsa kuralları dağıtmayın).
3. `main` onayla, tek toplu push → Netlify yayını (site + `/api/send-email` + `/api/admin-users` işlevleri).
4. **Hemen ardından** RTDB kurallarını dağıtın: `firebase deploy --only database --project parla-bt-web` (kurallar istemciye bağlıdır; sırayı bozmayın).
5. Firebase Console ayarları (SMTP + action URL, e-posta numaralandırma koruması, App Check, API anahtarı kısıtı, şifre politikası) ve E-posta Servisi sınaması.
6. Duman testi (müşteri + danışman + yönetici), ardından — kapanış onayında 10 günden uzun bekleyen talepleri gözden geçirdikten sonra — servis hesabını ekleyerek otomasyonu/yedeği/kullanıcı yönetimi işlevini etkinleştirin.

Geri alma: Netlify → önceki dağıtım (site); kurallar için Console → Rules → Geçmiş ya da `git show <önceki-iyi-commit>:database.rules.json > database.rules.json && firebase deploy --only database`
ve ardından `git checkout -- database.rules.json` (eski kurallar güvensiz olabilir; ayrıntı `docs/runbook.md` §3).

## 8. Testler

```
node --test netlify/tests/*.test.* tests/unit/*.test.mjs   # sunucu + istemci birim testleri (e-posta, otomasyon, kullanıcı yönetimi, güvenli çizim, ...)
(cd tests/rules && npm install && npm test)                # RTDB kuralları: yetki matrisi (rol × işlem) + üretecin database.rules.json ile eşitliği
(cd tests/e2e && npm install)                              # bir kez (Playwright + axe-core)
node tests/e2e/run-all.cjs --skip xss,button-crawler       # tarayıcı: yaşam döngüsü, zil/SLA, ekler, kılavuzlar, rol bazlı düğmeler, toplu işlem, hazır yanıtlar,
                                                           # kullanıcı yönetimi, yönetim modülleri, erişilebilirlik, yerleşim, performans bütçesi, tüm roller × tüm sayfalar
node tests/e2e/xss.e2e.cjs                                 # XSS (yavaş, ≈10 dk)
```

E2E dosyalarının tam listesi ve notlar `CLAUDE.md` içindedir. Tarayıcıda gerçek RTDB kuralları (targaryen) ve gerçek `send-email` fonksiyonu çalışır; yalnızca Google sertifikaları, RTDB REST ve Resend taklit edilir.
Kılavuzları yeniden üretmek için `docs/manuals/README.md`.
