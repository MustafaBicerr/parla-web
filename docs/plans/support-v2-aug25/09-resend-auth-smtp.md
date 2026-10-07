# 09 — Resend (info@) + Netlify Function

> **Arşiv notu (2026-10-07):** Tarihsel kurulum planıdır; güncel adımlar `docs/yayin-kontrol-listesi.md` (§0, §7, §8) ve `docs/runbook.md` (§6 anahtar döndürme) içindedir.

## Hedef

Tüm uygulama mailleri Resend hesabından `Parla BT Destek <info@parlabilgiteknolojileri.net>` ile gider. `noreply` yok; bununla birlikte bildirim e-postalarına verilen yanıt talebe eklenmez (e-postalarda "portaldan yazın" notu vardır).

## Mimari

- Talep / davet mailleri: tarayıcı → `POST /api/send-email` (Netlify Function) → Resend API.
  İstek `Authorization: Bearer <Firebase ID token>` taşır; sunucu token'ı doğrular, içeriği veritabanından okur,
  alıcıları ve içeriği sunucuda türetir (alıcılar yalnızca talebin tarafları, destek kutusu ve aktif personeldir; `netlify/lib/`).
- Kariyer / iletişim / fikir formları: GAS sheet kaydı + GAS → Resend API (portal talep e-postaları GAS'tan geçmez)
- Firebase Auth (şifre sıfırlama, e-posta doğrulama): Firebase Console SMTP → `smtp.resend.com`

Resend anahtarı repoda yoktur; sırlar yalnızca Netlify env / GitHub secret / Script Properties / Firebase panelinde durur (`RESEND_API_KEY`; GAS: Script Properties `RESEND_API_KEY`). Anahtar üç yerde kullanılır (Netlify, Firebase Auth SMTP, GAS) — döndürme adımları `docs/runbook.md` §6.

## İnsan checklist

1. Resend (yeni hesap) → Domain `parlabilgiteknolojileri.net` (veya gönderim alt alanı) doğrula: SPF / DKIM / DMARC
2. Netlify → Environment variables → `RESEND_API_KEY` (zorunlu); isteğe bağlı `CONTACT_EMAIL`,
   `ALLOWED_ORIGINS` (virgüllü ek alan adları). Değişkenden sonra yeniden deploy edin.
3. Firebase Console → Authentication → Templates → SMTP:
   - Host `smtp.resend.com` · Port `587` · User `resend` · Pass `re_…`
   - From `Parla BT Destek <info@parlabilgiteknolojileri.net>`
   - Action URL `https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html` (sayfa mevcut:
     şifre sıfırlama, e-posta doğrulama, e-posta geri alma)
4. Apps Script → Project Settings → Script properties → `RESEND_API_KEY` (canlı kopya; depodaki gizli anahtarsız yedek: `docs/gas/yedek_kod.gs`). Canlı kopyada kimlik doğrulamasız `support_v2_notify` dalı bulunmamalıdır.

## Kod

- `netlify/functions/send-email.js`
- `netlify/lib/email-templates.js`
- `assets/js/support-v2/email-service.js`
- `docs/gas/yedek_kod.gs` (yalnızca kurumsal site formları: `UrlFetchApp` + HTML şablon)

## Kabul

Reset ve talep mailleri `info@parlabilgiteknolojileri.net` From ile gelir. HTML şablon render edilir. (Yanıt e-postaları talebe eklenmez; yazışma portaldadır.)

## Test

1. `GET /api/send-email` → `{ configured: true, from: "info@..." }`
   (site Firebase Hosting'de ise `EMAIL_API_URL`'i Netlify adresine çevirin: `site-config.js`)
2. Süper admin → Genel Bakış → **E-posta Servisi** kartı: "Durumu Kontrol Et" (Resend alan adı durumu) +
   "Test E-postası Gönder"
3. Talep oluştur / yanıt / atama / durum değişikliği
4. Spam klasörü + Auth action sayfası
5. Başarısız gönderimler: Aktiviteler → eylem "E-posta Gönderilemedi" (neden kodu ile)
