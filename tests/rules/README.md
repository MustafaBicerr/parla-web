# tests/rules — Realtime Database kuralları (kaynak, testler, veri tarayıcı)

`database.rules.json` **elle düzenlenmez**: kaynak `generate-rules.js`'tir.

```
node tests/rules/generate-rules.js      # database.rules.json'u yeniden üretir
cd tests/rules && npm install && npm test
```

| Dosya | Görev |
|---|---|
| `generate-rules.js` | Kural kaynağı (WP-03 sertleştirme paketi). `buildRules({attachmentQuota})` ek kotası modunu da üretir. |
| `helpers.js` | Bağımsız örnek veri (e2e `seed.cjs`'ten bağımsız), 17 aktör, geçerli yük üreticileri. |
| `database-rules.test.js` | İşlevsel testler: olumlu yol, yalıtım, pasif/profilsiz hesap, danışman ataması, silme, 14 gün, sayaç… |
| `matrix-ops.js` + `matrix.test.js` | **Yetki matrisi (220 işlem × 17 aktör = 3.740 hücre)** — beklenen sonuç tablosu `matrix.test.js` içindeki `EXPECT` nesnesidir; ardından SEC-01…SEC-40 ve diğer rapor bulgularının "reddedilmeli" probe'ları. |
| `scan-existing-data.cjs` (+ `.test.js`) | **Salt-okunur** canlı veri tarayıcı (aşağıya bakın). |

## Yetki matrisini güncelleme
Bir kuralı bilerek değiştirirseniz `matrix.test.js` başarısız olur ve her değişen hücreyi (BEKLENMEDİK İZİN / BEKLENMEDİK RED) yazar.
Değişikliği gözden geçirip `EXPECT` satırını elle güncelleyin (tabloyu körü körüne yeniden üretmeyin). Yeni işlem eklemek için
`matrix-ops.js`'e `op("<ID>", grup, ad, fn)` ekleyin ve `EXPECT`'e aynı kimliği yazın.

## Dağıtımdan ÖNCE: canlı veriyi tara (zorunlu)
Yeni `.validate` kuralları canlıdaki **eski kayıtları kilitleyebilir** (üst düğüm `.validate` her alt yazımda yeniden çalışır; örn.
`id` alanı ya da eksik zorunlu alanı olan bir talebin durumu bile değişmez).

1. Firebase Console → Realtime Database → Veri → kök düğüm ⋮ → **JSON'u dışa aktar** (dosyayı depoya koymayın; kişisel veri içerir).
2. `cd tests/rules && node scan-existing-data.cjs <export.json> --emit-backfill goc.json --json rapor.json`
3. Çıkış kodu: `0` temiz · `1` GÖÇ/KAYIT bulguları · `2` **ENGEL** (kuralları dağıtmayın).

| Sınıf | Anlamı |
|---|---|
| ENGEL | Kural dağıtılırsa kayıt güncellenemez (talebin üst düğüm `.validate`'i geçmiyor) ya da sayaç artırılamaz (ticket numarası üretilemez). Önce veriyi düzeltin. |
| KAYIT | Kayıt yeni `.validate`'e uymuyor; yalnızca o alan/kayıt yeniden yazılırsa reddedilir (eski geçersiz öncelik, uzun başlık, bilinmeyen alan…). |
| GÖÇ | Veri göçü gerekir: `assigned_uids` (atanmış danışmanlar yazabilsin), `closed_at_ms` (müşteri 14 gün içinde yeniden açabilsin), `contracts/<id>/value` → `contract_values/<id>`. |
| BİLGİ | Yetim kayıtlar, iç notlar herkese açık düğümde, yinelenen numara, sayaç geride kalmış… |

`--emit-backfill` dosyası bir **çok-yollu güncelleme nesnesidir** (`{"tickets/<id>/assigned_uids/<uid>": true, ...}`). Admin SDK ile
uygulayın (`db.ref('v2').update(obj)`); Console "İçe aktar" kullanmayın (düğümü değiştirir). Betik hiçbir yere bağlanmaz, canlıya yazmaz.

## Dağıtım sırası (önemli)
`main`'e `database.rules.json` push edildiğinde `.github/workflows/deploy-rules.yml`, `FIREBASE_SERVICE_ACCOUNT` tanımlıysa kuralları
**kendiliğinden dağıtır**. Sıra: (1) istemci değişiklikleri (aşağıdaki sözleşme) → (2) tarama + göç → (3) kurallar
(`firebase deploy --only database --project parla-bt-web`, `docs/yayin-kontrol-listesi.md`). Kurallar istemciden önce giderse danışmanlar
(`assigned_uids` yok), kapalı talebi yeniden açmak isteyen müşteriler (`closed_at_ms` yok) ve `auth.token.email` bağlaması nedeniyle bazı yazımlar reddedilir.

## İstemci sözleşmesi (kuralların beklediği veri)
- **Talep** (izinli alan listesi dışı alan reddedilir; bilinmeyen alan eklemek için `generate-rules.js` `TICKET_FIELD_SPEC`'e eklenmelidir):
  zorunlu `user_id, title, status, priority, ticket_type, ticket_number, created_at, updated_at`; `id` alanı **yasak**, `ticket_id` varsa anahtarla aynı;
  `priority` low|medium|high|critical; `ticket_type` SUP|ARZ|PRJ|INT|DEV|BUG; `status` 8 değer; `title ≤ 200`, `description ≤ 10000`; ISO tarihler (2020–2049).
  SLA damgaları (`sla_window, sla_paused_ms, sla_paused_since, sla_response_breached_at, sla_resolution_breached_at`) müşteri tarayıcısı tarafından da yazılabilir ama yalnızca güvenli yönlerde
  (duraklama süresi azalmaz, ihlal damgası bir kez yazılır/silinmez, yeni pencere yalnızca `status='reopened'` ile). Ayrılmış aileler (yalnız personel): `sla_*`, `reminder_*`, `pause_*`, `auto_close_*`.
- **Müşteri talep oluşturma**: `user_id = created_by = auth.uid`, `status='open'`, `user_email = auth.token.email`, kendi `company_id`'si, personel/SLA alanları yok;
  tür kilidi: sözleşmeli → SUP|BUG, arızı (rol `arizi_customer` ya da firma `customer_type='ARC'`) → ARZ|BUG; firma pasifse açamaz.
- **assigned_uids**: `tickets/<id>/assigned_uids/<uid> = true` (atama yapılırken `ticket_assignments` ile birlikte yazılmalı; danışman yazma yetkisi buna bağlıdır).
- **Yumuşak silme**: `is_deleted=true, deleted_at (ISO), deleted_by` (yalnız super/service). Kalıcı silme (cascade) yalnız super_admin ve **tek çok-yollu update**:
  `tickets, ticket_messages, ticket_internal_notes, ticket_attachments, ticket_internal_attachments, ticket_history, ticket_assignments, ticket_efforts, ticket_attachment_stats` `/<id>` = null.
- **closed_at_ms** (sayı, `ServerValue.TIMESTAMP` önerilir; sunucu saatine ±10 dk): kapatırken `closed_at` ile birlikte yazılır, yeniden açarken `closed_at`/`closed_at_ms` ile birlikte `null` + `status='reopened'`.
  Kapalı talebi müşteri yalnızca `closed_at_ms + 14 gün` içinde açar; kapalı talepte müşteri mesaj/ek yazamaz (önce durum → sonra mesaj).
- **Mesaj/iç not**: `message_id` = anahtar, `user_id = auth.uid`, `author_role` = oturum rolü (müşteri: `customer`), `author_email` = oturum e-postası (boş olabilir), `work_hours` yalnız personelde sayı.
  **Geçmiş**: `changed_by_uid = auth.uid`. **Aktivite**: `user_uid = auth.uid`; müşteri yalnız `ticket_created|ticket_message|ticket_closed|ticket_reopened|email_failed`.
  **Efor**: `created_by_uid = auth.uid`, `hours` sayı > 0.
- **Sayaç**: `counters/<TÜR>/<MÜŞTERİ_KODU>/<YYAA>` yalnızca +1 (transaction); müşteri yalnız kendi kodu ve türleri için.
- **Sözleşme bedeli**: `contract_values/<contractId> = { value:number, currency?:'TRY', updated_at?, updated_by? }` (yalnız super/service); `contracts/<id>/value` yazılamaz.
- **Hazır yanıt şablonları**: `reply_templates/<id> = { title, body, category?, is_active?, sort_order?, created_*/updated_* }` (okuma personel, yazma super/service).
- `notifications`, `system_state`, `ops` istemciye kapalıdır (sunucu Admin SDK kuralları atlar).

## Ek kotası (kapalı gelir)
`buildRules({attachmentQuota:true})` talep başına en çok 30 ek / 40 MB kuralını üretir; açıkken ek yazımı `ticket_attachment_stats/<tid>`
sayaçlarını **aynı** çok-yollu `update('/v2', {...})` içinde (+1 / +size) artırmak zorundadır. Varsayılan KAPALIDIR (istemci sayaç yazana kadar):
etkinleştirmek için `generate-rules.js` içinde `buildRules()` varsayılanını değiştirin ve istemciyi güncelleyin.

## Bilinen sınırlar
- Kural dili ISO tarih dizesini sayıya çeviremez: `created_at/updated_at` için yalnızca biçim + yıl aralığı denetlenir; "sunucu saatine yakınlık" yalnız sayısal alanlarda (`closed_at_ms`) uygulanır.
- Firebase kayıt (sign-up) kapatılamıyor; profilsiz hesaplar yazamaz ama Auth hesabı açabilir (App Check / sunucu tarafı kullanıcı oluşturma ayrı iş).
- `is_active=false` kural düzeyinde erişimi keser; Auth hesabının kendisini kapatmak sunucu işidir (D-01).
- Liste sorguları `is_deleted` talepleri döndürür; istemci (liste/zil/pano/rapor) `is_deleted` olanları süzmelidir.
