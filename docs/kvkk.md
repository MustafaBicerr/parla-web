# KVKK Asgari Paketi (D-13 A) — Destek Portalı

> **TASLAK — hukuk danışmanı onayı gerekir.** Bu belge teknik envanter ve işletme prosedürüdür; hukuki değerlendirme, aydınlatma
> metninin son hâli, VERBİS yükümlülüğü ve yurt dışına aktarım dayanağı (KVKK m.9) bir hukuk danışmanıyla netleştirilmelidir.
> Denetim kaynağı: ALT-13 / K-ALT-9 / D-13 A. İlgili: `support-v2/privacy.html` (kullanıcıya açık taslak metin), `docs/runbook.md`.

## 1. Kapsam ve rol

- **Veri sorumlusu:** Parla Bilgi Teknolojileri (ticari unvan, MERSİS, adres: `[hukuk danışmanı tamamlayacak]`).
- **Veri işleyenler (hizmet sağlayıcılar):** Google Firebase (Auth + Realtime Database, europe-west1 / Belçika), Netlify (barındırma, işlevler, Blobs yedekleri), Resend (e-posta gönderimi), GitHub (özel depoda yedek artifact'ı, kod), jsDelivr CDN (telefon bileşeni; yalnızca IP/tarayıcı bilgisi ulaşır).
- **İlgili kişiler:** müşteri kullanıcıları (muhatap, firma yöneticisi), Parla BT personeli/danışmanları.
- Sözleşmeler/DPA: Firebase/Google Cloud, Netlify, Resend ve GitHub için veri işleme eklerini (DPA) indirip arşivleyin `[açık madde]`.

## 2. Veri envanteri (RTDB `v2/*`)

| Düğüm | Kişisel veri | Kim görür (özet) | Ek not |
|---|---|---|---|
| `users/<uid>` | Ad, soyad, e-posta, telefon, rol, firma, son giriş, oluşturan/güncelleyen | Kendisi + yönetici roller; müşteri firma yöneticisi kendi firmasını | Firebase Auth kaydı (e-posta, parola özeti) ayrıca Firebase'de |
| `tickets/<id>` | Talep başlığı/açıklaması (serbest metin, kişisel veri içerebilir), `user_name`, `user_email`, oluşturan | Talebin sahibi/firması + atanan personel + yönetim | |
| `ticket_messages`, `ticket_internal_notes` | Mesaj metni, yazar adı | Müşteri mesajları: taraflar; iç notlar: yalnızca personel | |
| `ticket_attachments`, `ticket_internal_attachments` | Yüklenen dosyalar (base64; içeriği kontrol edilemez, kişisel veri içerebilir) | Mesajlar gibi | RTDB içinde tutulur; boyut/adet kotası var |
| `ticket_history`, `ticket_assignments`, `ticket_efforts` | İşlemi yapan kişi adı/uid'si, atanan danışman, efor kayıtları | Personel | |
| `activities` | `user_uid`, `user_name`, işlem ayrıntısı (ör. talep numarası, e-posta içeren metinler) | Yönetici roller | **Talep kalıcı silinse de kaybolmaz** (§5) |
| `personnel`, `departments` | Danışman adı, e-posta, telefon, departman | Yönetici roller | |
| `companies`, `contracts`, `projects` | Firma adı, müşteri kodu, yetkili kişi bilgileri (varsa) | Yönetici roller | Tüzel kişi verisi; yetkili kişi alanları kişisel veridir |
| `system_state`, `ops` | E-posta kota sayaçları, otomasyon durumu | Yalnızca sunucu | Alıcı adresi içermez / kısa ömürlü |
| Netlify Blobs `db-backups` | Yukarıdaki tüm düğümlerin kopyası (sıkıştırılmış) | Netlify hesabı | 14 gün |
| GitHub artifact `rtdb-backup-*` | Tüm düğümlerin kopyası | **Özel depo** üyeleri (şifreli: `BACKUP_PASSPHRASE`) | 30 gün |
| Resend | E-posta içeriği ve alıcı adresi (gönderim günlüğü) | Resend hesabı | Saklama süresi Resend ayarlarına/planına bağlı `[doğrulanacak]` |
| Netlify günlükleri | IP, istek yolu, işlev günlükleri | Netlify hesabı | Plan süresi kadar |

**Kişisel veri olmayanlar:** SLA tanımları, destek türleri, SAP modülleri, yanıt şablonları, sayaçlar.

## 3. Hukuki sebep ve amaç (taslak — hukuk onayı gerekir)
Destek hizmetinin sunulması (sözleşmenin ifası, KVKK m.5/2-c), hesap güvenliği ve kötüye kullanımın önlenmesi (meşru menfaat m.5/2-f), kayıt ve ispat yükümlülükleri (m.5/2-ç). Pazarlama amacı yoktur. **Açık rıza gerektiren işleme yoktur**, bir istisna dışında: tarayıcıdan ölçümleme (Analytics) — bkz. §8.

## 4. Saklama ve imha politikası (taslak)

| Veri | Saklama süresi (öneri) | Gerekçe / uygulama |
|---|---|---|
| Destek talebi + mesaj + ek + geçmiş | Hizmet ilişkisi süresince + **5 yıl** (sözleşme/zamanaşımı; hukuk danışmanıyla teyit) | Süre sonu: süper admin **Kalıcı Sil** (§5) |
| Pasifleştirilen kullanıcı | Hesap kapatma talebine kadar pasif; talep üzerine anonimleştirme/silme | Pasif kullanıcı kural düzeyinde engellenir |
| Personel kayıtları | Çalışma süresi + 2 yıl `[hukuk]` | |
| Aktivite günlüğü | 2 yıl `[hukuk]` | Elle temizleme gerekir (otomatik silme yok) |
| Günlük yedek (Blobs) | 14 gün (`BACKUP_RETENTION_DAYS`) | Otomatik silinir |
| Yedek (GitHub artifact) | 30 gün | Otomatik silinir (`retention-days: 30`) |
| E-posta günlüğü (Resend), Netlify günlükleri | Sağlayıcı süresi | Sağlayıcı panelinden doğrulayın |

İmha edilen kayıt **yedeklerde süre dolana kadar** (en çok 30 gün) kalır; bu durum aydınlatma metninde belirtilmiştir. Yedekten geri yükleme yapılırsa silinen kayıtlar yeniden gelebilir: silme talebi karşılandıktan sonra 30 gün içinde yedekten geri yükleme yapılacaksa silinen kayıtlar yeniden silinmelidir (silme günlüğüne bakın).

## 5. İlgili kişi başvurusu — erişim, düzeltme, silme/anonimleştirme prosedürü

Başvuru kanalı: `info@parlabilgiteknolojileri.net`. Süre: **en geç 30 gün** (KVKK m.13). Başvuru sahibinin kimliği, portal e-posta adresiyle yazışma ya da başka makul doğrulamayla teyit edilir. Her başvuru "Başvuru kaydı" tablosuna (aşağıda) işlenir.

### 5.1 Erişim / bilgi talebi
1. Süper admin: Yönetici → Kullanıcılar → kullanıcı detay (profil) ve Talepler listesi (kullanıcıya göre süz).
2. Dışa aktarma: Talepler → CSV/Excel Dışa Aktar (arama/süzgeçle kişiye daraltarak) ya da Firebase Console'dan ilgili `v2/users/<uid>` ve `tickets` (`user_id` eşleşenler) kayıtlarının JSON çıktısı.
3. Başka kişilerin verisini (diğer kullanıcı adları, iç notlar, personel iç yorumları) çıkarın; **iç notlar ilgili kişiye verilmez** (yalnızca kendisine ait kişisel veri varsa, hukuk danışmanı değerlendirir).
4. Yanıtı güvenli kanaldan (kayıtlı e-posta adresi) gönderin.

### 5.2 Düzeltme
Ad/telefon: kullanıcı kendi profilinden telefonunu düzenler; ad/e-posta/firma: Yönetici → Kullanıcılar → Düzenle. Ad değiştiğinde talepler üzerindeki `user_name` kopyaları otomatik yayılır; `activities` ve geçmiş metinlerindeki eski ad kopyaları kalabilir (denetim izi).

### 5.3 Silme / anonimleştirme (yalnızca süper admin; geri dönüşsüzdür)
> **Önce yedek:** Console → JSON dışa aktar ya da en güncel `rtdb-backup` (runbook §4). Silmeden önce talep gerekçesini ve tarihini kaydedin.

1. **Hesabı kapatın:** Yönetici → Kullanıcılar → ilgili kullanıcı detayı → **Devre Dışı Bırak** (Auth hesabı da devre dışı kalır; kural düzeyinde giriş/yazma engellenir).
2. **Talepleri silin ya da saklayın:** Talep içeriği başka tarafları (firma, danışmanlar) ilgilendirir ve sözleşme/ispat kaydıdır. Hukuki saklama süresi dolmuşsa veya silme gerekiyorsa: Yönetici → talep detayı (ya da Talepler → Arşiv listesi) → **Kalıcı Sil** (yalnızca `super_admin`). Bu işlem talebi ve bağlı 8 düğümü (`tickets`, `ticket_messages`, `ticket_internal_notes`, `ticket_attachments`, `ticket_internal_attachments`, `ticket_history`, `ticket_assignments`, `ticket_efforts`) tek seferde siler ve `activities`'e *ticket_permanently_deleted* kaydı bırakır (silinen talebin numarası, silen kişi, tarih — içerik değil).
3. **Profili anonimleştirin** (saklanması gereken talepler varsa): Firebase Console → Realtime Database → `v2/users/<uid>` → `first_name: "Anonim"`, `last_name: "Kullanıcı"`, `email: "silindi-<uid>@anonim.invalid"`, `phone: ""`, `is_active: false`. Aynı kişinin talepleri üzerindeki `user_name` / `user_email` alanlarını aynı şekilde anonimleştirin (`tickets` → `orderByChild("user_id")` ile bulun). **Not:** bunun için henüz arayüz aracı yoktur (rapor §3.1-13 "anonimleştirme aracı" hâlâ açık madde); Console'dan elle yapılır.
4. **Firebase Auth kaydını silin:** Console → Authentication → Users → kullanıcı → Delete (e-posta + parola özeti kaldırılır).
5. **Yedekler:** otomatik süre dolumunu bekleyin (Blobs 14 gün, artifact 30 gün); başvurana "yedeklerde en çok 30 gün saklanır" bilgisi verin.
6. **E-posta sağlayıcı:** Resend → Logs → ilgili alıcı e-postalarını silin ya da saklama süresine bırakın `[Resend ayarına bağlı]`.
7. `activities` / `ticket_history` içindeki ad kopyaları: gerekirse Console'dan ilgili kayıtların `user_name`/`details` alanını "Anonim" yapın (denetim izi bütünlüğü ile kişisel veri silme arasında hukuk danışmanının kararı).
8. Başvuruyu kapatın: işlem tarihi, yapan kişi, kapsam, başvurana yanıt.

### 5.4 Başvuru kaydı (özel yerde tutulur — örn. özel depo issue'su; kişisel veriyi minimumda tutun)
| Alındığı tarih | Başvuru türü | Kimlik doğrulama | Yapılan işlem | Yanıt tarihi (≤30 gün) | Yapan |
|---|---|---|---|---|---|
| | | | | | |

### 5.5 Kişisel veri ihlali
Şüphede `docs/runbook.md` §5 "Sır sızdı". Kişisel veri ihlali doğrulanırsa: ilgili kişilere gecikmeksizin ve **Kurul'a 72 saat içinde** bildirim (KVKK m.12/5) — hukuk danışmanı ile birlikte. İhlal kaydı: ne, ne zaman, kaç kişi, hangi veri, alınan önlem.

## 6. Teknik ve idari tedbirler (özet)
HTTPS; rol bazlı RTDB kuralları (matris testli); pasif kullanıcı engeli; iç notların müşteriye kapalı olması; e-posta alıcı/içeriğinin sunucuda türetilmesi; hız sınırı ve günlük e-posta kotası; günlük yedek (özel depo + isteğe bağlı AES-256); gizli anahtar taraması (gitleaks); CSP Report-Only; sır döndürme prosedürü (runbook §6); portal arama motorlarına kapalı (`noindex`).

## 7. Taslak metinler
1. **Portal gizlilik/aydınlatma sayfası:** `support-v2/privacy.html` (üstünde "Taslak — hukuk danışmanı onayı gerekir" uyarısı; ticari unvan/MERSİS/saklama süreleri köşeli parantezli alanlar hukuk danışmanınca tamamlanacak). Onay sonrası uyarı bandı kaldırılır.
2. **E-posta altbilgisi:** `PRIVACY_URL` (Netlify env) tanımlıysa şablonlara "KVKK aydınlatma metni" bağlantısı eklenir. Sayfa onaylanınca: `PRIVACY_URL=https://www.parlabilgiteknolojileri.net/support-v2/privacy.html` (+ yeniden dağıtım; runbook §2.3). Tanımlı değilken altbilgi `info@` adresini önerir.
3. **Giriş sayfası bağlantısı:** "Gizlilik ve KVKK" bağlantısı `/support-v2/privacy.html`'e gider (giriş sayfası altbilgisi).
4. **Resmî ana site** (`index.html`, iletişim/kariyer/fikir formları) için ayrı aydınlatma/rıza onayı gerekir (§8).

## 8. Açık maddeler (hukuk + geliştirme)
- [ ] **Hukuk danışmanı onayı:** `privacy.html` içeriği, saklama süreleri, yurt dışına aktarım (Firebase/Netlify/Resend/jsDelivr), VERBİS gereği.
- [ ] **Analytics:** `assets/js/firebase-init.js` Firebase Analytics'i (`G-FZBYFFJF32`) portalda koşulsuz yüklüyor (D-13 A: portalda kapatılsın ya da rıza sonrası). Öneri: `isSupported().then(...getAnalytics...)` bloğunu kaldırın (portalda ölçüm ihtiyacı yok) ve CSP'deki analytics kökenlerini temizleyin. **Bu depo değişikliği yapılmadı** (repo sahibinin onayını bekliyor).
- [ ] **Ana site:** GTM (`GTM-MXDFN92L`) koşulsuz; formlarda aydınlatma/rıza kutusu yok; Apps Script/Sheets/Drive (CV'ler "bağlantıyla herkese açık") — ayrı iş.
- [ ] **Anonimleştirme aracı:** §5.3 adım 3 elle; arayüz/sunucu aracı planlı iş.
- [ ] **DPA arşivi** (Google, Netlify, Resend, GitHub).
- [ ] **Saklama otomasyonu:** kapanan taleplerin süre sonunda önerilmesi / `activities` temizliği (otomatik değil).
