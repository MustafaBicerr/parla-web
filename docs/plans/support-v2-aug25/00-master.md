# 00 — Word 25.08.2026 Destek Portalı Master

> **Arşiv notu (2026-10-07):** Bu belge Ağustos 2026 fazının *tarihsel* planıdır. Güncel mimari, rol/yetki davranışı ve yayın sırası için
> `docs/ticket-system-analysis.md`, `docs/yayin-kontrol-listesi.md`, `docs/runbook.md` ve denetim sonrası kurallar (`tests/rules/generate-rules.js`) esas alınır.
> Aşağıdaki alt planların dosyaları (01–08, 10) bu depoda **bulunmaz**; yalnızca `00-master.md` ve `09-resend-auth-smtp.md` arşivlenmiştir.

Bu faz Word belgesi *talep sistemi mustafa eklenecekler 25.08.2026* gap’lerini kapatmıştır (önceki faz planı depoda yoktur).

## Onaylı kararlar (tarihsel; sonradan değişenler işaretli)

- Invite-only. *(Sonradan: kullanıcı oluşturma/davet sunucu işlevine — Netlify Function + Admin SDK — taşındı; `/api/admin-users`.)*
- Resend: From `info@parlabilgiteknolojileri.net` (noreply yok). Bildirim e-postalarına yanıt vermek talebe eklenmez; "portaldan yazın" notu eklendi.
- Talep ve davet e-postaları Netlify Function (`/api/send-email`); portal e-postaları Apps Script'ten **geçmez**.
- Firebase Auth SMTP (şifre sıfırlama) hâlâ Console işi; site formları (iletişim/kariyer/fikir/sohbet) Apps Script.
- `company_admin` korunur (belgede tanımsız).
- Efor rate formülü kapsam dışı.

## Alt plan listesi (uygulandı; dosyaları arşivde yok)

| # | Konu | Not |
|---|---|---|
| 01 | Veri modeli ve yaşam döngüsü | Kurallar |
| 02 | Sözleşmeler (SZL) | Kod |
| 03 | Pano ve arama | Kod |
| 04 | Talep kapanışı ve ilişkili işler | Kod |
| 05 | Bekleme ve efor | Kod |
| 06 | RBAC / yetkiler | Kod + kurallar |
| 07 | Firmalar ve muhataplar | Kod |
| 08 | Katalog ve hatalar | Kod |
| 09 | `09-resend-auth-smtp.md` | Konsol kontrol listesi (arşivde var) |
| 10 | QA ve yayın | Güncel karşılığı: `docs/yayin-kontrol-listesi.md` |

## Rol matrisi (güncel davranış)

| Rol | Talepleri | Yazma |
|---|---|---|
| `super_admin` / `service_admin` | Tüm talepleri okur | Hepsinde yazar (destek atayıcı yumuşak siler; yalnız süper admin kalıcı siler) |
| `project_manager` | Tüm talepleri okur | Hepsinde yazar (atama, durum, öncelik, efor; silmez) |
| `consultant` | Tüm talepleri **okur** | Yalnızca **atandığı** talepte yazar (kurallar `assigned_uids` ile zorlar) |
| `company_admin` | Yalnızca kendi firmasının talepleri | Firmanın taleplerinde yanıt/onay; kullanıcı yönetemez |
| `customer` | Yalnızca kendi açtığı talepler | Kendi talebinde yanıt/onay/yeniden açma |
| `arizi_customer` | Yalnızca kendi açtığı talepler | Ayrı bir kapsam yoktur (`company_id` boş olabilir); talep tipleri ARZ/BUG ile sınırlıdır |

## Residual (güncel)

- Yetki = RTDB kuralları + arayüz; sunucu işlevleri (kullanıcı yönetimi, otomasyon, yedek) Admin SDK kullanır ve servis hesabı ister.
- Genel Auth kaydı Firebase'de kapatılamaz; profili olmayan hesap kural düzeyinde etkisizdir (talep/mesaj/ek yazamaz). Ek önlemler: e-posta numaralandırma koruması, App Check, API anahtarı kısıtı (`docs/yayin-kontrol-listesi.md` §8).
- Auth hesabı silme Console işidir; portalda kullanıcı pasife alınır (Auth hesabı da kapatılır).
- Talep ve davet e-postaları Netlify Function + Resend; çağrılar Firebase ID token ister (bkz. `docs/ticket-system-analysis.md`). Mail hataları Aktiviteler'de "E-posta Gönderilemedi" olarak izlenir.
