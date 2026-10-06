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

## 2. Hazırlık durumu (düzeltmelerden sonra)

| Modül | Durum | Not |
|---|---|---|
| Giriş / roller / yönlendirme | Hazır | `company_admin` rolü arayüzde tanımsız (bkz. §5) |
| Talep açma (müşteri / yönetici) | Hazır | Numara üretimi (`TİP-MÜŞTERİ-MODÜL-YYAA-SIRA`) çalışıyor |
| Atama (çoklu danışman, birincil) | Hazır | |
| Mesajlaşma, efor kaydı, geçmiş | Hazır | İç notlar için bkz. §5 (P1) |
| Durum akışı | Kısmi | `açık → atandı → işlemde → müşteri bekleniyor → çözüldü → kapandı`; **kapanış onayı / yeniden açma yok** |
| E-posta bildirimleri | **Düzeltildi, dağıtım bekliyor** | §3 |
| Muhataplar (kullanıcı yönetimi) | **Düzeltildi** | Sayfa hiç açılmıyordu (§3, madde 3) |
| Firma / sözleşme / proje / personel / raporlar | Hazır | Raporlar tüm ticket'ı istemciye çeker (ölçek notu §5) |
| Güvenlik (RTDB kuralları) | **Düzeltildi, dağıtım bekliyor** | §4 |
| Şifre değiştirme / sıfırlama | **Eklendi** | `change-password.html`, `auth-action.html` |
| SLA, uygulama içi bildirim, dosya yükleme | Yok | §5 |

Genel değerlendirme: çekirdek akış (aç → ata → yanıtla → kapat) uçtan uca var. Bu çalışmadan önce
üç şey üretime almayı engelliyordu: (1) mail zinciri, (2) kullanıcı yönetimi sayfasının açılmaması,
(3) veritabanı kurallarındaki yetki yükseltme açığı. Üçü de bu branch'te kapatıldı; **dağıtım adımları §6'da**.

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

## 5. Hâlâ eksik / sonraki adımlar (öncelik sırasıyla)

**P1 — kısa vadede**
1. **İç notlar müşteriye veritabanı düzeyinde açık.** Mesajlar tek düğümde; "dahili not" yalnızca arayüzde filtreleniyor.
   Çözüm: `ticket_internal_notes/$ticketId` (yalnızca personel) + mevcut kayıtlar için tek seferlik taşıma.
2. **Kapanış onayı / yeniden açma akışı yok.** `pending_close` ve `reopened` durumları arayüzde tanımsız; `ticket_close_approval`,
   `ticket_reopened` mail şablonları ve sunucu tipleri hazır ama hiçbir ekran tetiklemiyor.
3. **E-posta tetiklemesi tarayıcıya bağlı:** sekme kapanırsa/ağ koparsa yeniden deneme yok (kuyruk yok). Kalıcı çözüm: `email_outbox`
   + zamanlanmış Netlify function veya RTDB tetikleyici.
4. Firebase Console işleri (§3-F) ve Netlify ortam değişkenleri.

**P2**
5. Firma içi görünürlük: `company_admin`/`customer` için "firma ticket'ları" planlanmış (00-master rol matrisi) ama müşteri yalnızca kendi
   açtıklarını görüyor; `company_admin` rolü `ROLES`'ta yok (giriş sonrası yönlendirilemez).
6. Uygulama içi bildirim zili boş: `addNotification` hiç çağrılmıyor.
7. SLA / hedef süre / eskalasyon alanları yok.
8. Dosya eki yalnızca URL; `firebase.json` olmayan `storage.rules`'a referans veriyor (tam `firebase deploy` hata verir).
9. Ölçek: yönetici sayfaları `getAllTickets()` ile tüm koleksiyonu çekiyor; sayfalama istemci tarafında.
10. Eski v1 portal (`support/`, `assets/js/support/`, `yedek_kod.gs` ticket kısımları) ölü kod; temizlenebilir.

## 6. Dağıtım sırası

1. Branch'i `main`'e birleştirin (PR) → Netlify siteyi ve function'ı yayınlar. (Önce site, sonra kurallar.)
2. Netlify → Environment variables: `RESEND_API_KEY` (zorunlu). İsteğe bağlı: `CONTACT_EMAIL`, `ALLOWED_ORIGINS`. Yeniden deploy.
3. Kontrol: `curl -s https://<site>/api/send-email` → `configured:true`. Süper admin ile girin → Genel Bakış → **E-posta Servisi** kartı:
   "Durumu Kontrol Et" ve "Test E-postası Gönder".
4. Kurallar: `firebase deploy --only database`. Hemen ardından duman testi: müşteri girişi → talep aç → yanıtla; yönetici → ata → yanıtla.
   Sorun olursa geri alma: `git show 1d537a6:database.rules.json > database.rules.json && firebase deploy --only database`.
5. Firebase Console SMTP + action URL (§3-F).
6. Mevcut geçici şifreli kullanıcılar `must_change_password` taşımaz (bayrak yeni oluşturulanlar için); isterseniz Console'dan ekleyin.

## 7. Testler

```
node --test netlify/tests/send-email.test.js            # sunucu: yetkilendirme, alıcı, şablon, Resend hataları
node --test netlify/tests/client-email-service.test.mjs # istemci servisi
node --test netlify/tests/client-utils.test.mjs         # arama yardımcıları
cd tests/rules && npm install && npm test                # RTDB kuralları (targaryen)
```

Tarayıcı duman testleri (Playwright + sahte Firebase) bu çalışmada elle çalıştırıldı: tüm 21 portal sayfası hatasız yükleniyor;
auth-action, muhataplar (oluşturma + credentials e-postası), zorunlu şifre akışı ve dashboard e-posta kartı doğrulandı.
