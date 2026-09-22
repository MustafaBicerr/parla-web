# 00 — Word 25.08.2026 Destek Portalı Master

Önceki faz (`docs/plans/support-v2/`) iskeleti tamamladı. Bu faz Word belgesi *ticket sistemi mustafa eklenecekler 25.08.2026* gap’lerini kapatır.

## Onaylı kararlar

- Invite-only, Cloud Functions yok.
- Resend: From `info@parlabilgiteknolojileri.net` (noreply yok).
- Ticket / davet mailleri Netlify Function (`/api/send-email`).
- Firebase Auth SMTP hâlâ Console işi; site formları GAS + Resend.
- `company_admin` korunur (belgede tanımsız).
- Efor rate formülü kapsam dışı.

## Alt plan sırası

| # | Dosya | Deploy |
|---|---|---|
| 01 | `01-data-model-lifecycle.md` | Kurallar; 04–06 ile birlikte deploy |
| 02 | `02-contracts-szl.md` | Kod |
| 03 | `03-dashboard-search.md` | Kod |
| 04 | `04-ticket-close-related.md` | Kod + GAS tipleri |
| 05 | `05-wait-effort.md` | Kod |
| 06 | `06-rbac-permissions.md` | Kod + rules |
| 07 | `07-firms-contacts.md` | Kod |
| 08 | `08-catalog-bugs.md` | Kod |
| 09 | `09-resend-auth-smtp.md` | Console checklist |
| 10 | `10-qa-deploy.md` | QA + deploy |

## Rol matrisi

| Rol | Ticket görür |
|---|---|
| `super_admin` / `service_admin` | Tüm |
| `project_manager` | Yetkili proje/firma (sıkı) |
| `consultant` | Atandığı + destek danışmanı olduğu |
| `company_admin` / `customer` | Firma ticketları |
| `arizi_customer` | Kendi + tanımlı kapsam |

## Residual

- Yetki = RTDB rules + UI (Admin SDK yok).
- Public Auth signup açık.
- Auth silme Console.
- Ticket maili GAS, Resend değil.
