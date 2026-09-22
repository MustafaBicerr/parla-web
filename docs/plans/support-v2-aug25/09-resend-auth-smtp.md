# 09 — Resend (info@) + Netlify Function

## Hedef

Tüm uygulama mailleri yeni Resend hesabından `Parla BT Destek <info@parlabilgiteknolojileri.net>` ile gider. `noreply` yok; yanıtlar gerçek `info@` kutusuna düşer.

## Mimari

- Ticket / davet mailleri: tarayıcı → `POST /api/send-email` (Netlify Function) → Resend API
- Kariyer / iletişim / fikir formları: GAS sheet kaydı + GAS → Resend API
- Firebase Auth (şifre sıfırlama, e-posta doğrulama): Firebase Console SMTP → `smtp.resend.com`

API anahtarı repoda yoktur. Netlify env: `RESEND_API_KEY`. GAS: Script Properties `RESEND_API_KEY`.

## İnsan checklist

1. Resend (yeni hesap) → Domain `parlabilgiteknolojileri.net` (veya gönderim alt alanı) doğrula: SPF / DKIM / DMARC
2. Netlify → Environment variables → `RESEND_API_KEY`
3. Firebase Console → Authentication → Templates → SMTP:
   - Host `smtp.resend.com` · Port `587` · User `resend` · Pass `re_…`
   - From `Parla BT Destek <info@parlabilgiteknolojileri.net>`
   - Action URL `/support-v2/auth-action.html`
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
2. Ticket oluştur / yanıt / kapanış onayı
3. Spam klasörü + Auth action sayfası
