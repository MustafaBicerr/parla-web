# SAP Destek Ticket Sistemi — Kurulum Kılavuzu

Bu doküman, Parla BT web sitesine entegre SAP Destek Portalı için Google Sheets, Apps Script ve deployment adımlarını içerir.

## Dosya yapısı

```
/support/
  login.html
  register.html
  dashboard.html      (müşteri)
  admin.html
  ticket.html
  SUPPORT_SETUP.md

/assets/css/support-portal.css
/assets/js/support/
  config.js, api.js, auth.js, ui.js, validators.js
  login.js, register.js, dashboard.js, admin.js, ticket.js

/Kod.gs               (mevcut formlar + support_* modülü)
```

Mevcut `site-config.js` içindeki `GOOGLE_SCRIPT_URL` tüm portal istekleri için kullanılır.

---

## 1) Google Sheets — yeni sayfalar

Mevcut spreadsheet’e (iletişim, kariyer, chat ile aynı dosya) **4 yeni sayfa** ekleyin. Sayfa adları **tam olarak** şöyle olmalı:

### `users`

| Kolon | Açıklama |
|--------|----------|
| user_id | Örn. USR-1710000000000 |
| first_name | Ad |
| last_name | Soyad |
| company | Firma |
| phone | Telefon |
| email | Benzersiz iş e-postası |
| password_hash | SHA-256 (salt ile) |
| salt | Rastgele salt |
| role | **customer** veya **admin** — kayıtta her zaman customer |
| created_at | Kayıt zamanı |
| session_token | Aktif oturum token |
| session_expires | Oturum bitiş |
| is_active | TRUE / FALSE |

**Admin atama:** `role` sütununu elle `admin` yapın. Frontend’de rol seçimi yoktur.

### `tickets`

| Kolon | Açıklama |
|--------|----------|
| ticket_id | TKT-... |
| ticket_number | TCK-2026-0001 |
| user_id | Oluşturan müşteri |
| customer_email | E-posta |
| company | Firma |
| title | Başlık |
| priority | Low / Medium / High / Critical |
| sap_module | MM, SD, FI, ... |
| description | İlk açıklama |
| status | OPEN (varsayılan) |
| assigned_to | Admin ataması |
| attachment_url | Drive link |
| created_at | |
| updated_at | |

### `ticket_messages`

| Kolon | Açıklama |
|--------|----------|
| message_id | MSG-... |
| ticket_id | |
| user_id | |
| author_email | |
| author_name | |
| author_role | customer / admin / system |
| message | Metin |
| is_internal | TRUE = sadece admin görür |
| created_at | |

### `logs`

| Kolon | Açıklama |
|--------|----------|
| log_id | LOG-... |
| action | register, login, ticket_created, ... |
| user_id | |
| details | |
| created_at | |

---

## 2) Örnek sheet verileri

### users (örnek admin — şifreyi siz üretin)

Önce normal kayıt ile bir kullanıcı oluşturun veya satırı elle ekleyin. Admin için:

1. Portalden kayıt olun (role otomatik `customer`).
2. Sheet’te `role` → `admin` yapın.
3. Şifre hash için geçici olarak Apps Script editörde `supportHashPassword("Sifreniz", "testsalt")` çalıştırıp `password_hash` ve `salt` değerlerini kopyalayın.

| user_id | first_name | last_name | company | phone | email | password_hash | salt | role | created_at | session_token | session_expires | is_active |
|---------|------------|-----------|---------|-------|-------|---------------|------|------|------------|---------------|-----------------|-----------|
| USR-001 | Admin | Kullanıcı | Parla BT | 05302267798 | admin@firma.com | (hash) | (salt) | admin | 2026-05-17 | | | TRUE |
| USR-002 | Ali | Yılmaz | Örnek A.Ş. | 05321234567 | ali@ornek.com | (hash) | (salt) | customer | 2026-05-17 | | | TRUE |

### tickets (örnek)

| ticket_id | ticket_number | user_id | customer_email | company | title | priority | sap_module | description | status | assigned_to | attachment_url | created_at | updated_at |
|-----------|---------------|---------|----------------|---------|-------|----------|------------|-------------|--------|-------------|----------------|------------|------------|
| TKT-001 | TCK-2026-0001 | USR-002 | ali@ornek.com | Örnek A.Ş. | FI posting hatası | High | FI | Mal girişi sonrası hata alıyoruz | OPEN | | | 2026-05-17 | 2026-05-17 |

---

## 3) Google Apps Script

1. Spreadsheet → **Uzantılar → Apps Script**
2. Mevcut `Kod.gs` içeriğini projedeki **`Kod.gs`** dosyası ile değiştirin (chat, career, contact, idea **korunur**; `support_*` tipleri eklendi).
3. **Dağıtım → Yeni dağıtım → Web uygulaması**
   - Yürüt: **Ben**
   - Erişim: **Herkes** (anonim form/chat ile aynı)
4. Yeni `/exec` URL’ini kopyalayın.
5. `assets/js/site-config.js` → `GOOGLE_SCRIPT_URL` güncelleyin.

### API tipleri (`type` alanı)

| type | Açıklama |
|------|----------|
| support_register | Kayıt |
| support_login | Giriş |
| support_logout | Çıkış |
| support_verify_session | Token doğrulama |
| support_create_ticket | Yeni ticket |
| support_get_tickets | Liste (müşteri: kendi; admin: tümü) |
| support_get_ticket | Detay + mesajlar |
| support_update_ticket | Admin: durum, atama, not |
| support_add_message | Yanıt / mesaj |
| support_admin_stats | Admin özet kartları |

Mevcut tipler değişmedi: `chat`, `career`, `contact`, `idea`.

---

## 4) Örnek API yanıtları

Tüm destek uçları:

```json
{
  "success": true,
  "message": "Açıklama metni",
  "data": { }
}
```

### Kayıt — `support_register`

**İstek:**
```json
{
  "type": "support_register",
  "first_name": "Ali",
  "last_name": "Yılmaz",
  "company": "Örnek A.Ş.",
  "phone": "05321234567",
  "email": "ali@ornek.com",
  "password": "GuvenliSifre123"
}
```

**Yanıt:**
```json
{
  "success": true,
  "message": "Kayıt başarılı. Giriş yapabilirsiniz.",
  "data": { "user_id": "USR-1715920000000" }
}
```

### Giriş — `support_login`

**Yanıt:**
```json
{
  "success": true,
  "message": "Giriş başarılı.",
  "data": {
    "token": "abc123...",
    "expires_at": "2026-05-18T12:00:00.000Z",
    "user": {
      "user_id": "USR-002",
      "first_name": "Ali",
      "last_name": "Yılmaz",
      "company": "Örnek A.Ş.",
      "phone": "05321234567",
      "email": "ali@ornek.com",
      "role": "customer",
      "created_at": "2026-05-17T10:00:00.000Z"
    }
  }
}
```

### Ticket oluştur — `support_create_ticket`

**İstek:** `token`, `title`, `priority`, `sap_module`, `description`, opsiyonel `file: { name, type, data }` (base64)

**Yanıt:**
```json
{
  "success": true,
  "message": "Destek talebi oluşturuldu.",
  "data": {
    "ticket_id": "TKT-1715920000000",
    "ticket_number": "TCK-2026-0001",
    "status": "OPEN"
  }
}
```

### Hata örneği

```json
{
  "success": false,
  "message": "Bu e-posta adresi ile zaten kayıt yapılmış.",
  "data": null
}
```

---

## 5) Güvenlik özeti

- Şifreler **SHA-256 + salt** ile hash’lenir (plaintext saklanmaz).
- Rol yalnızca `users` sheet’ten okunur; istemciden kabul edilmez.
- Oturum: `session_token` + `session_expires` (varsayılan 24 saat).
- Müşteri yalnızca kendi `user_id` ticket’larını görür (backend filtresi).
- Dahili mesajlar (`is_internal`) müşteriye gösterilmez.

---

## 6) Web sitesi deployment

1. `support/` ve `assets/` değişikliklerini sunucuya yükleyin.
2. `site-config.js` içinde güncel Apps Script URL olduğundan emin olun.
3. İsteğe bağlı: SAP danışmanlık sayfasına portal linki:
   - `/support/login.html`

### Test planı

- [ ] Kayıt → login → müşteri dashboard
- [ ] Ticket oluşturma (dosyalı / dosyasız)
- [ ] Ticket detay + müşteri mesajı
- [ ] Sheet’te admin rolü → admin panel, filtre, durum güncelleme
- [ ] İletişim / kariyer / chat / fikir formları hâlâ çalışıyor

---

## 7) Drive klasörü

Ticket ekleri: `Web_Dosyalari/SAP_Support_Attachments` (script otomatik oluşturur).

CV klasörü (`Kariyer_Formu_CV`) ve mevcut akışlar etkilenmez.
