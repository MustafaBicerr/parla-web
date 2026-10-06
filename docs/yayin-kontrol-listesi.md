# Yayın Kontrol Listesi — Destek Portalı v2

Bu liste `main` dalındaki kodun canlıya alınması içindir. Sırayı bozmayın: **önce site, hemen ardından veritabanı kuralları.**

## 0. Ön koşullar (bir kez yapılır — bu proje için tamamlandı)

- [x] Netlify sitesi GitHub `main` dalına bağlı (publish dizini `.`, functions `netlify/functions`).
- [x] Netlify ortam değişkenleri: `RESEND_API_KEY` (zorunlu). İsteğe bağlı: `CONTACT_EMAIL` (destek ekibi adresi), `ALLOWED_ORIGINS` (ek alan adları), `FIREBASE_PROJECT_ID` / `FIREBASE_DATABASE_URL` (varsayılan: parla-bt-web).
- [x] Resend'de `parlabilgiteknolojileri.net` alan adı doğrulanmış (SPF/DKIM).

## 1. Siteyi yayınlayın

1. Netlify → Deploys → son `main` commit'ini **Publish deploy** yapın (otomatik yayın açıksa bekleyin).
2. Doğrulama: `https://www.parlabilgiteknolojileri.net/api/send-email` (GET) → `{"success":true,"configured":true,...}`.
3. `https://www.parlabilgiteknolojileri.net/support-v2/docs/Kullanici-Kilavuzu.pdf` ve `.../Sistem-Adminleri-Kullanim-Kilavuzu.pdf` açılıyor mu?

## 2. Veritabanı kurallarını dağıtın (zorunlu)

Yeni özellikler (dahili notlar, dosya ekleri, kapanış onayı/yeniden açma, `company_admin`) yeni kurallara dayanır;
kurallar dağıtılmadan bu işlemler `PERMISSION_DENIED` verir. Kurallar aynı zamanda eski sürümdeki yetki yükseltme açığını kapatır.

```bash
npm i -g firebase-tools        # bir kez
firebase login
firebase deploy --only database --project parla-bt-web
```

> Otomatikleştirmek için: GitHub → Settings → Secrets → `FIREBASE_SERVICE_ACCOUNT` (servis hesabı JSON'u; rolü *Firebase Realtime Database Admin*).
> Secret tanımlıysa `database.rules.json` değiştiğinde `.github/workflows/deploy-rules.yml` kuralları kendisi dağıtır; tanımlı değilse iş atlanır.

Geri alma (yalnızca acil durumda; eski kurallar güvensizdir):
`git show 1d537a6:database.rules.json > database.rules.json && firebase deploy --only database`

## 3. E-posta servisini sınayın

Süper admin ile giriş → **Genel Bakış → E-posta Servisi**:
- [ ] "Durumu Kontrol Et" → API anahtarı ve alan adı **verified**.
- [ ] "Test E-postası Gönder" → kendi adresinize ulaştı (spam klasörüne de bakın).

## 4. Firebase Console (Authentication)

- [ ] Templates → SMTP: `smtp.resend.com`, port 587, kullanıcı `resend`, parola = Resend API anahtarı, gönderen `info@parlabilgiteknolojileri.net`.
- [ ] Templates → "Customize action URL": `https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html`.
- [ ] Authorized domains: `www.parlabilgiteknolojileri.net`, `parlabilgiteknolojileri.net`.

## 5. Duman testi (10 dakika)

| Rol | Adım | Beklenen |
|---|---|---|
| Müşteri | Giriş → **Yeni Talep** (dosya ekleyerek) | Talep numarası üretilir; destek ekibine + müşteriye e-posta gider |
| Süper admin / servis yöneticisi | Talebi danışmana ata | Danışmana "atandı", müşteriye durum e-postası |
| Danışman | Dahili not + müşteriye yanıt | Dahili not müşteride **görünmez**; yanıt müşteriye e-postayla gider |
| Danışman | Durumu **Kapanış Onayı Bekliyor** yap | Müşteride mor onay bandı + e-posta |
| Müşteri | **Onayla ve Kapat** (veya **Yeniden Aç**) | Talep `Kapandı` / `Yeniden Açıldı`; danışmana e-posta |
| Firma yöneticisi | Taleplerim | Firmanın tüm talepleri, "Talep Sahibi" sütunuyla |
| Herkes | Bildirim zili, kenar menüde **Kılavuzlar** | Zil rozeti; PDF'ler açılıyor/iniyor |

## 6. İsteğe bağlı bakım

- Süper admin → Genel Bakış → **Veri Bakımı** → **İç Notları Taşı**: eski sürümde mesajlarla birlikte saklanan dahili notları
  yeni, yalnızca personelin okuyabildiği düğüme taşır (güvenle tekrar çalıştırılabilir).
- Mevcut kullanıcıları ilk girişte şifre değiştirmeye zorlamak için Console'dan `v2/users/<uid>/must_change_password: true` ekleyin.

## 7. Sorun giderme

| Belirti | Olası neden | Çözüm |
|---|---|---|
| E-posta gitmiyor, kartta `configured:false` | `RESEND_API_KEY` eksik | Netlify → env → ekleyin → **yeniden deploy** |
| `domain not verified` | Resend alan adı doğrulanmamış | Resend → Domains → DNS kayıtlarını ekleyin |
| `403 recipient_not_allowed` | Alıcı talebin tarafı değil | Beklenen güvenlik davranışı; atama/e-posta adreslerini kontrol edin |
| `PERMISSION_DENIED` (konsol) | Kurallar dağıtılmadı | §2 |
| `/api/send-email` 404 | Site Netlify'da değil | `assets/js/site-config.js` → `EMAIL_API_URL` |
| Bekleyen e-posta uyarısı | Geçici ağ/Resend hatası | Otomatik yeniden denenir; kalıcı hata Aktiviteler'de `E-posta Gönderilemedi` |
