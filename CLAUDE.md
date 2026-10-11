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
node --test netlify/tests/*.test.* tests/unit/*.test.mjs          # sunucu + istemci birim testleri
(cd tests/rules && npm install && npm test)                       # RTDB kuralları (yetki matrisi) + database.rules.json eşitliği
(cd tests/e2e && npm install)                                     # bir kez: Playwright + axe-core
node tests/e2e/run-all.cjs --skip xss,button-crawler              # hızlı e2e kümesi (hepsi: --skip vermeden)
```

E2E dosyaları `tests/e2e/*.e2e.cjs` (hepsini `run-all.cjs` sırayla çalıştırır; tek tek: `node tests/e2e/<ad>.e2e.cjs`):
`a11y`, `admin-modules`, `attachments`, `bell-perf`, `bell-sla`, `bulk`, `button-crawler`, `guides`, `harness`, `layout`, `lifecycle`,
`lifecycle2`, `perf-budget`, `permissions-ui`, `reply-templates`, `smoke-all`, `users-admin`, `xss`.

- `a11y` axe-core ister (`tests/e2e/package.json`); kurulu değilse atlanır, CI'da `A11Y_REQUIRE=1` ile zorunludur.
- `xss` ve `button-crawler` yavaştır (**≈10 dk**); günlük değişikliklerde `--skip xss,button-crawler` kullanın, yayın öncesi tam çalıştırın.
- E2E testleri Playwright + Chromium kullanır; tarayıcıda sahte Firebase, Node tarafında gerçek RTDB kuralları
  (targaryen) ve gerçek `send-email` fonksiyonu çalışır (`tests/e2e/harness.cjs`, demo veri: `tests/e2e/seed.cjs`).
- Kılavuz ekran görüntüleri de aynı harness ile üretilir; uygulama arayüzü/metinleri değişince `docs/manuals/capture-specs.cjs`
  seçicileri güncellenmelidir.

## Kılavuzlar (PDF)

`docs/manuals/` (HTML+CSS → Chromium PDF). Ekran görüntüleri gerçek arayüzden üretilir:
`node docs/manuals/capture-screens.cjs user|admin`, ardından `node docs/manuals/content/<user|admin>/make.cjs &&
node docs/manuals/build.cjs <user|admin>`. Derleme yalnızca `docs/manuals/out/` altına yazar; **çıktılar elle** `support-v2/docs/` altına
kopyalanır (`Kullanici-Kilavuzu.pdf`, `Sistem-Adminleri-Kullanim-Kilavuzu.pdf`; `cp docs/manuals/out/*.pdf support-v2/docs/`).
Terminoloji: yönetim ve müşteri tarafında "Talep" (Ticket değil); "Muhatap" yalnızca müşteri firma kişisi anlamında. Ayrıntı: `docs/manuals/README.md`.

## Diğer belgeler

`docs/yayin-kontrol-listesi.md` (ilk yayın/dağıtım sırası), `docs/runbook.md` (işletim: geri alma, yedek, anahtar döndürme, kota),
`docs/monitoring.md`, `docs/kvkk.md`, `docs/ticket-system-analysis.md` (mimari/durum), `docs/ticket-sistemi-denetim-raporu.md` (denetim ve iş planı; **yalnız yerelde**, istismar ayrıntısı içerdiği için public depoya itilmez — repo private olunca eklenebilir).
