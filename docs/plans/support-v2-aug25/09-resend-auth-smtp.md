# 09 — Resend (info@) + Netlify Function

## Hedef

Tüm uygulama mailleri yeni Resend hesabından `Parla BT Destek <info@parlabilgiteknolojileri.net>` ile gider. `noreply` yok; yanıtlar gerçek `info@` kutusuna düşer.

## Mimari

- Ticket / davet mailleri: tarayıcı → `POST /api/send-email` (Netlify Function) → Resend API.
  İstek `Authorization: Bearer <Firebase ID token>` taşır; sunucu token'ı doğrular, içeriği veritabanından okur,
  alıcıları ticket muhatapları ile sınırlar (`netlify/lib/firebase-auth.js`).
- Kariyer / iletişim / fikir formları: GAS sheet kaydı + GAS → Resend API
- Firebase Auth (şifre sıfırlama, e-posta doğrulama): Firebase Console SMTP → `smtp.resend.com`

API anahtarı repoda yoktur. Netlify env: `RESEND_API_KEY`. GAS: Script Properties `RESEND_API_KEY`.

## İnsan checklist

1. Resend (yeni hesap) → Domain `parlabilgiteknolojileri.net` (veya gönderim alt alanı) doğrula: SPF / DKIM / DMARC
2. Netlify → Environment variables → `RESEND_API_KEY` (zorunlu); isteğe bağlı `CONTACT_EMAIL`,
   `ALLOWED_ORIGINS` (virgüllü ek alan adları). Değişkenden sonra yeniden deploy edin.
3. Firebase Console → Authentication → Templates → SMTP:
   - Host `smtp.resend.com` · Port `587` · User `resend` · Pass `re_…`
   - From `Parla BT Destek <info@parlabilgiteknolojileri.net>`
   - Action URL `https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html` (sayfa mevcut:
     şifre sıfırlama, e-posta doğrulama, e-posta geri alma)
4. Apps Script → Project Settings → Script properties → `RESEND_API_KEY` (canlı `yedek_kod.gs` kopyası)

## Kod

- `netlify/functions/send-email.js`
- `netlify/lib/email-templates.js`
- `assets/js/support-v2/email-service.js`
- `yedek_kod.gs` (`UrlFetchApp` + HTML şablon)

## Kabul

Reset ve ticket mailleri `info@parlabilgiteknolojileri.net` From ile gelir. HTML şablon render edilir. Reply çalışır.

## Test

1. `GET /api/send-email` → `{ configured: true, from: "info@..." }`
   (site Firebase Hosting'de ise `EMAIL_API_URL`'i Netlify adresine çevirin: `site-config.js`)
2. Süper admin → Genel Bakış → **E-posta Servisi** kartı: "Durumu Kontrol Et" (Resend alan adı durumu) +
   "Test E-postası Gönder"
3. Ticket oluştur / yanıt / atama / durum değişikliği
4. Spam klasörü + Auth action sayfası
5. Başarısız gönderimler: Aktiviteler → eylem "E-posta Gönderilemedi" (neden kodu ile)
