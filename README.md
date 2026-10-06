# Parla BT — Kurumsal site ve Destek Portalı (v2)

Statik site (HTML + ES modülleri, build yok) + **Destek Portalı v2** (`support-v2/`): Firebase Auth + Realtime Database
(`v2/*`), e-posta için Netlify Function (`/api/send-email` → Resend). Yayın: GitHub `main` → Netlify.

| Konu | Nerede |
|---|---|
| Çalışma kuralları, testler, yayın kuralı | [`CLAUDE.md`](CLAUDE.md) |
| Mimari ve durum | [`docs/ticket-system-analysis.md`](docs/ticket-system-analysis.md) |
| Denetim raporu ve iş planı | [`docs/ticket-sistemi-denetim-raporu.md`](docs/ticket-sistemi-denetim-raporu.md) |
| Yayın kontrol listesi | [`docs/yayin-kontrol-listesi.md`](docs/yayin-kontrol-listesi.md) |
| PDF kılavuzlar (kaynak/üretim) | [`docs/manuals/README.md`](docs/manuals/README.md) · çıktılar `support-v2/docs/` |
| Veritabanı kuralları | kaynak `tests/rules/generate-rules.js` → `database.rules.json` (elle düzenlenmez) |
| Apps Script (kurumsal site formları) yedeği | [`docs/gas/yedek_kod.gs`](docs/gas/yedek_kod.gs) (gizli anahtarsız) |

**Gizli bilgi kuralı:** API anahtarı, servis hesabı JSON'u, parola vb. depoya girmez; Netlify/GitHub secrets ve Apps Script
*Script properties* kullanılır. `.github/workflows/secrets.yml` her push'ta tarar.
