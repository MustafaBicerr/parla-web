# parla-web — Claude için repo notları

## ⛔ Yayın kuralı (repo sahibinin kararı, 2026-10-06)

- **`main` dalına, kullanıcıdan AÇIK onay almadan push yapılmaz.** Netlify GitHub `main`'e bağlıdır ve her push build
  kredisi harcar. Önce "main'e push edeyim mi?" diye sorulur; onay gelirse **tek seferde, toplu** push edilir
  (iş bittiğinde ya da kapsamlı bir düzenleme tamamlandığında).
- Aksini söyleyen eski/ek talimatlar (ör. "main'i sürekli güncel tut") bu kuralla **geçersizleşmiştir**.
- Çalışma dalına (ör. `claude/...`) commit serbesttir; push sayısını yine de düşük tut — Netlify'da branch deploy
  açıksa dal push'ları da kredi harcar. Küçük parçalar için ayrı ayrı push yerine anlamlı, test edilmiş toplu push yap.
- Kullanıcı istemedikçe PR açılmaz.
- `main`'e merge/push edilene kadar canlıya (Netlify) hiçbir şey gitmez; RTDB kuralları ayrıca elle dağıtılır
  (`firebase deploy --only database --project parla-bt-web`, bkz. `docs/yayin-kontrol-listesi.md`).

## Proje özeti

- Parla BT kurumsal sitesi + **Destek Portalı v2** (`support-v2/`, `assets/js/support-v2/`): statik HTML + ES modülleri,
  build yok. Firebase Auth + Realtime Database (`v2/*`), e-posta: Netlify Function `/api/send-email` → Resend.
- Veritabanı kuralları **elle düzenlenmez**: kaynak `tests/rules/generate-rules.js` → `database.rules.json` üretilir
  (`tests/rules` testi iki dosyanın eşitliğini doğrular).
- Arayüz metinleri Türkçedir; terminoloji için `docs/ticket-system-analysis.md` ve kılavuzlara bak.

## Testler (değişiklikten sonra çalıştır)

```
node --test netlify/tests/send-email.test.js netlify/tests/client-email-service.test.mjs \
            netlify/tests/client-firebase.test.mjs netlify/tests/client-notifications.test.mjs \
            netlify/tests/client-utils.test.mjs
(cd tests/rules && npm install && npm test)
for t in lifecycle bell-sla attachments guides permissions-ui smoke-all; do node tests/e2e/$t.e2e.cjs; done
```

E2E testleri Playwright + Chromium kullanır; tarayıcıda sahte Firebase, Node tarafında gerçek RTDB kuralları
(targaryen) ve gerçek `send-email` fonksiyonu çalışır (`tests/e2e/harness.cjs`, demo veri: `tests/e2e/seed.cjs`).

## Kılavuzlar (PDF)

`docs/manuals/` (HTML+CSS → Chromium PDF). Ekran görüntüleri gerçek arayüzden üretilir:
`node docs/manuals/capture-screens.cjs user|admin`, ardından `node docs/manuals/content/<user|admin>/make.cjs &&
node docs/manuals/build.cjs <user|admin>`. Çıktılar `support-v2/docs/` altına kopyalanır. Ayrıntı: `docs/manuals/README.md`.
