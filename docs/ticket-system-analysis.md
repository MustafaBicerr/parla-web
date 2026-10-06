# Ticket Sistemi (Destek Portalı v2) — Analiz, Durum ve Yol Haritası

Tarih: 2026-10-06 · Kapsam: `support-v2/`, `assets/js/support-v2/`, `netlify/`, `database.rules.json`

## 1. Mimari (kısa)

| Katman | Teknoloji | Not |
|---|---|---|
| Arayüz | Statik HTML + ES modülleri (`support-v2/**`, `assets/js/support-v2/**`) | Framework yok, build yok |
| Kimlik | Firebase Auth (e-posta/şifre) | Kullanıcı oluşturma istemci tarafında (ikincil app) |
| Veri | Firebase Realtime Database, `v2/*` | Yetki = `database.rules.json` + arayüz (Admin SDK yok) |
| E-posta | Tarayıcı → `POST /api/send-email` (Netlify Function) → Resend | Form mailleri ayrı: GAS (`yedek_kod.gs`) |
| Auth e-postaları | Firebase Console SMTP (Resend) | Console işi, kodla yönetilmiyor |

## 2. Hazırlık durumu

| Modül | Durum | Not |
|---|---|---|
| Giriş / roller / yönlendirme | Hazır | `company_admin` dahil 7 rol; zorunlu şifre değişimi (`must_change_password`) |
| Talep açma (müşteri / yönetici) | Hazır | Numara: `TİP-MÜŞTERİ-MODÜL-YYAA-SIRA`; dosya eki (≤3 dosya, ≤2 MB) |
| Atama (çoklu danışman, birincil) | Hazır | Danışman e-postası atamaya kaydedilir (`personel_email`) |
| Mesajlaşma, efor kaydı, geçmiş | Hazır | **Dahili notlar ayrı düğümde** (`ticket_internal_notes`), müşteri veritabanı düzeyinde okuyamaz |
| Durum akışı | Hazır | `açık → atandı → işlemde → müşteri bekleniyor → onay bekleniyor → çözüldü → kapandı` (+ `yeniden açıldı`); müşteri kapanış onayı ve 14 günlük yeniden açma |
| SLA / hedef süreler | Hazır | Önceliğe göre ilk yanıt/çözüm hedefi; `müşteri bekleniyor`da süre durur; listede ve ayrıntıda rozet; panoda "SLA Aşımı" |
| Uygulama içi bildirim | Hazır | Türetilmiş bildirim zili (veritabanına yazmaz); okundu bilgisi tarayıcıda |
| E-posta bildirimleri | Hazır, dağıtım bekliyor | §3; hatalar görünür (toast + aktivite), geçici hatalarda tarayıcı kuyruğu + otomatik yeniden deneme |
| Muhataplar (kullanıcı yönetimi) | Hazır | Davet, geçici şifre e-postası, rol/firma atama |
| Firma içi görünürlük | Hazır | `company_admin` firmanın tüm taleplerini görür/yanıtlar |
| Firma / sözleşme / proje / personel / raporlar | Hazır | Raporlar tüm talepleri istemciye çeker (ölçek notu §5) |
| Güvenlik (RTDB kuralları) | Hazır, dağıtım bekliyor | §4; 49 kural testi |
| Şifre değiştirme / sıfırlama | Hazır | `change-password.html`, `auth-action.html` (şifre kuralı: ≥8, 1 büyük harf, 1 rakam) |
| PDF kılavuzlar | Hazır | `support-v2/docs/` — giriş sayfasından ve menüden erişilir; kaynak: `docs/manuals/` |
| Eski v1 portal | Kaldırıldı | `support/`, `assets/js/support/` silindi; `/support` → v2 girişine yönlenir |

Genel değerlendirme: uçtan uca akış (aç → ata → yanıtla → çöz → müşteri onayı → kapat / yeniden aç) tamam. Üretime almadan önce
yalnızca **altyapı adımları** kalır; sıra ve kontroller `docs/yayin-kontrol-listesi.md` içindedir.

## 3. "Mailler neden gönderilmiyor?" — bulgular

Kodda **kanıtlanan** nedenler (hepsi düzeltildi):

1. **Hatalar sessizce yutuluyordu.** `ParlaEmailService.send` hata durumunda `{success:false}` döndürüyor,
   çağıranlar sonucu hiç kontrol etmiyor (`.catch(() => {})`) ve "Yanıt gönderildi" diyordu. Yani
   Resend/Netlify tarafında ne olursa olsun kimse fark etmiyordu. → Artık toast uyarısı +
   Aktiviteler'de **"E-posta Gönderilemedi"** kaydı var.
2. **Kullanıcı yönetimi sayfası hiç açılmıyordu.** `users.js`, repoda olmayan `access-control.js`,
   `matchesSearch` ve `ParlaDb.emailHasConflictingRole`'a dayanıyordu (commit `dd1913a`); tarayıcıda modül 404.
   Davet ve "giriş bilgilerini e-posta ile gönder" bu sayfadan tetiklendiği için **hiç gönderilemiyordu**.
   Ayrıca oluşturma sonrası geçici şifre penceresi, liste yenilenirken siliniyordu.
3. **Atama sonrası müşteri yanıtları kimseye bildirilmiyordu.** Müşteri sayfası personel listesini
   yüklemediği için atanmış danışmanın adresi bulunamıyordu.
4. **Yanlış alıcı / şablon:** admin güncellemesinde müşteriye "Size yeni bir talep atandı" (personel şablonu,
   admin bağlantısı) gidiyordu; personele müşteri bağlantılı mail gidiyordu; atama + durum birlikte
   değişince durum maili atlanıyordu; müşteri talep açınca kendisine onay maili gitmiyordu;
   `waiting_customer` için hazır şablon (`send_to_customer`) kullanılmıyordu.
5. **Uç nokta açıktı** (güvenlik): kimlik doğrulama yoktu, `Origin` başlığı yoksa herkes `info@` adresinden
   keyfi içerikle (örn. sahte "giriş bilgileriniz" + `loginUrl`) mail gönderebilirdi.

**Altyapıda doğrulanması gerekenler** (sandbox'tan canlı siteye erişim yok; kodla kanıtlanamaz):

| # | Kontrol | Nasıl bakılır |
|---|---|---|
| A | Netlify function yayında mı, site Netlify'da mı? | `curl -s https://www.parlabilgiteknolojileri.net/api/send-email` → `{"configured":true,...}` bekleniyor. HTML/404 ise function yok (site Firebase Hosting'de olabilir: `firebase.json` hosting'de `/api/send-email` yönlendirmesi **yok**). |
| B | `RESEND_API_KEY` Netlify ortam değişkeni | Yukarıdaki yanıtta `configured:false` ise eksik. Değişkenden sonra **yeniden deploy** gerekir. |
| C | Resend'de `parlabilgiteknolojileri.net` doğrulanmış mı (SPF/DKIM) | Dashboard → E-posta Servisi → "Durumu Kontrol Et" (tam yetkili anahtarla alan adı durumunu gösterir). |
| D | Uçtan uca | Dashboard → "Test E-postası Gönder" (kendi adresinize). Spam klasörüne de bakın. |
| E | Site hangi alan adında? | İzinli: `parlabilgiteknolojileri.net`, `www.`, `parla-bt-web.web.app`, `parla-bt-web.firebaseapp.com`, `*.netlify.app`. Başka alan adı (ör. `.com`) için Netlify'a `ALLOWED_ORIGINS=alanadi.com` ekleyin. |
| F | Firebase Auth e-postaları (şifre sıfırlama / davet) | Console → Authentication → Templates → SMTP (`smtp.resend.com`, 587, kullanıcı `resend`) ve "Customize action URL" = `https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html`. Aksi halde Firebase'in varsayılan göndericisi kullanılır ve spam'e düşer. |

Site Firebase Hosting'de, function Netlify'daysa: `assets/js/site-config.js` içinde
`EMAIL_API_URL: "https://<netlify-site>.netlify.app/api/send-email"` yazın (CORS desteği eklendi).

## 4. Güvenlik bulguları (RTDB kuralları) — düzeltildi

`tests/rules` (targaryen ile yerel simülasyon): **eski kurallarda 34 testin 20'si başarısız**, yenilerde 34/34 geçiyor.

- **Kritik — yetki yükseltme:** `users/$uid` yazma kuralı kullanıcının kendi profilini serbestçe yazmasına izin
  veriyordu; herhangi bir müşteri (ya da herkese açık Auth kaydıyla oluşturulmuş hesap) kendine `role: super_admin`
  yazıp sistemi ele geçirebilirdi.
- Başka bir kullanıcı `assigned_to_id` sorgusuyla tüm firmaların ticket'larını okuyabiliyordu.
- Mesajlar/geçmiş herkes tarafından okunup (başka firmanınki dahil) **silinebiliyordu**; aktivite listesi toptan silinebiliyordu.
- Sözleşme bedelleri, proje, personel iletişim bilgileri ve tüm firma listesi giriş yapmış herkese açıktı.
- Müşteri kendi ticket'ının önceliğini/atamasını/durumunu (ör. `closed`) değiştirebiliyordu.

Not: "invite-only" mimarisi kullanıcıları istemci tarafında oluşturduğu için Firebase'de e-posta kaydı kapatılamıyor
(kapatılırsa davet de çalışmaz). Yeni kurallar profili olmayan hesabı etkisiz bırakır; kalıcı çözüm kullanıcı oluşturmayı
sunucuya (Cloud Function / Admin SDK) taşımaktır.

## 5. Bilinen sınırlar ve sonraki adımlar (bilinçli olarak kapsam dışı)

1. **Sunucu tarafı e-posta kuyruğu yok.** Yeniden deneme tarayıcıda (localStorage) yapılır; kullanıcı sekmeyi kapatırsa bekleyen e-posta bir sonraki
   girişte gönderilir, 24 saat sonra düşer ve Aktiviteler'e `email_failed` yazılır. Kalıcı çözüm: Cloud Function / zamanlanmış Netlify function.
2. **Kullanıcı oluşturma istemci tarafında** (ikincil Firebase app). Firebase'de genel e-posta kaydı kapatılamaz; kurallar profili olmayan hesabı etkisiz bırakır.
   Kalıcı çözüm: Admin SDK ile sunucu tarafı kullanıcı oluşturma.
3. **Dosya ekleri RTDB'de base64** (Firebase Storage kullanılmıyor): küçük dosyalar için uygundur (≤2 MB, ≤3 dosya, görseller istemcide sıkıştırılır).
   Hacim büyürse Storage'a taşıyın.
4. **Ölçek:** yönetici sayfaları ve raporlar `getAllTickets()` ile koleksiyonu çeker; sayfalama istemci tarafında. Binlerce talepten sonra sunucu tarafı sorgu/sayfalama gerekir.
5. **SLA hedefleri sabit** (`ticket-utils.js` → `SLA_TARGETS_HOURS`); sözleşmeye özel hedef ve eskalasyon e-postası yok.
6. Mevcut ("must_change_password" bayrağı olmayan) kullanıcılar zorunlu şifre değişimine tabi değildir; isterseniz Console'dan bayrağı ekleyin.
7. Eski dahili notlar (kural değişikliğinden önce `ticket_messages` içine yazılmış olanlar) için süper admin → Genel Bakış → **Veri Bakımı** → "İç Notları Taşı".

## 6. Dağıtım sırası

Ayrıntılı, işaretlenebilir liste: **`docs/yayin-kontrol-listesi.md`**. Özet:

1. `main` güncel → Netlify'dan yayınlayın (site + `/api/send-email` function).
2. **Hemen ardından** RTDB kurallarını dağıtın: `firebase deploy --only database` (iç notlar, ekler, kapanış/yeniden açma ve `company_admin` kuralları yeni kurallara bağlıdır;
   kurallar dağıtılmadan yeni özellikler `PERMISSION_DENIED` verir).
3. Süper admin → Genel Bakış → **E-posta Servisi**: "Durumu Kontrol Et" + "Test E-postası Gönder".
4. Firebase Console: SMTP + action URL (§3-F).
5. Duman testi (müşteri + danışman), ardından Veri Bakımı (isteğe bağlı).

Geri alma: `git show 1d537a6:database.rules.json > database.rules.json && firebase deploy --only database` (eski, **güvensiz** kurallar — yalnızca acil durumda).

## 7. Testler

```
node --test netlify/tests/send-email.test.js netlify/tests/client-email-service.test.mjs \
            netlify/tests/client-firebase.test.mjs netlify/tests/client-notifications.test.mjs \
            netlify/tests/client-utils.test.mjs        # sunucu + istemci birim testleri (53)
cd tests/rules && npm install && npm test              # RTDB kuralları (targaryen, 49) + üretecin database.rules.json ile eşitliği
node tests/e2e/lifecycle.e2e.cjs                       # tarayıcı: talep yaşam döngüsü (34)
node tests/e2e/bell-sla.e2e.cjs                        # bildirim zili, SLA, e-posta kuyruğu (22)
node tests/e2e/attachments.e2e.cjs                     # dosya ekleri (22)
node tests/e2e/guides.e2e.cjs                          # PDF kılavuz bağlantıları
node tests/e2e/smoke-all.e2e.cjs                       # tüm roller × tüm sayfalar (75)
```

E2E testleri Playwright + Chromium ister (`PLAYWRIGHT_PATH` ile yol verilebilir). Tarayıcıda gerçek RTDB kuralları (targaryen) ve gerçek
`send-email` fonksiyonu çalışır; yalnızca Google sertifikaları, RTDB REST ve Resend taklit edilir. Kılavuzları yeniden üretmek için `docs/manuals/README.md`.
