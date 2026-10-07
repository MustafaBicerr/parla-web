module.exports = (L) => `
<section class="chapter" data-opener="false" data-title="Sistem ve Bakım"
         data-intro="E-posta servisinin izlenmesi, kotası ve kurulumu (Netlify, Resend, Firebase), yeniden deneme kuyruğu, sunucu tarafı yönetim/otomasyon/yedek, Veri Bakımı aracı, veritabanı kurallarının yayınlanması ve güvenlik notları.">
  <h1>Sistem ve Bakım</h1>

  <h2>E-posta servisi</h2>
  ${L.who("sa", "da")}
  <p>Portalın tüm bildirim e-postaları aynı hattan geçer. İşlemi yapan personelin tarayıcısı, oturum açmış kullanıcının Firebase kimlik jetonuyla portalın <code>/api/send-email</code> adresine istek gönderir; <strong>Netlify Function</strong> jetonu doğrular, <strong>alıcıları ve içeriği veritabanından kendisi oluşturur</strong> (istemciden gelen adres, metin ve bağlantı güvenilmez; yalnızca mesaj/geçmiş kaydının kimliği gönderilir) ve <strong>Resend</strong> aracılığıyla gönderir. E-postalardaki bağlantıların kökü sunucuda sabittir (<code>SITE_URL</code>).</p>
  <div class="flow">
    <div class="node open"><span class="n">1</span>Tarayıcı<small>Personel işlemi</small></div><span class="arrow"></span>
    <div class="node assigned"><span class="n">2</span>/api/send-email<small>Netlify Function</small></div><span class="arrow"></span>
    <div class="node in_progress"><span class="n">3</span>Resend<small>info@ alan adı</small></div><span class="arrow"></span>
    <div class="node closed"><span class="n">4</span>Alıcı<small>Müşteri / personel</small></div>
  </div>
  <p>Genel Bakış'taki <strong>E-posta Servisi</strong> kartı (Süper Admin ve Destek Atayıcı) hattın sağlığını gösterir. Sayfa açılınca servis yayında mı ve anahtar tanımlı mı diye kendiliğinden sorgular; iki düğme vardır:</p>
  ${L.fig("a06-eposta-saglikli", { wide: true, bare: true, caption: "Sağlıklı durum.", legend: ["<strong>Durumu Kontrol Et</strong> — Resend'de <code>parlabilgiteknolojileri.net</code> alan adının doğrulanma durumunu sorgular.", "<strong>Test E-postası Gönder</strong> — kendi adresinize deneme iletisi yollar (uçtan uca kanıt)."] })}
  ${L.fig("a06-eposta-hata", { wide: true, bare: true, nonum: true, caption: "Test e-postası reddedilirse: alan adı doğrulanmamış (kırmızı çarpı = hata, sarı üçgen = uyarı, yeşil onay = sağlıklı)." })}
  <table class="fields">
    <thead><tr><th>Kart ne diyor?</th><th>Anlamı → yapılacak</th></tr></thead>
    <tbody>
      <tr><td>“API anahtarı yalnızca gönderim yetkili; alan adı durumu okunamıyor (normal)”</td><td>Kısıtlı anahtar kullanılıyor; durum sorgulanamaz. Normaldir → yalnızca <em>Test E-postası</em> ile doğrulayın.</td></tr>
      <tr><td>“Gönderen alan adı doğrulanmamış”</td><td>Resend'de SPF/DKIM eksik/bekliyor → DNS kayıtlarını tamamlayın.</td></tr>
      <tr><td>“E-posta servisine ulaşılamıyor …”</td><td><code>/api/send-email</code> 404 veriyor → siteyi Netlify'a dağıtın (aşağıdaki liste).</td></tr>
      <tr><td>“… RESEND_API_KEY tanımlı değil”</td><td>Ortam değişkeni eksik → Netlify'da ekleyip yeniden dağıtın.</td></tr>
    </tbody>
  </table>

  <h3>Hız sınırı ve günlük kota</h3>
  <p>Resend ücretsiz planı yaklaşık <strong>günde 100 e-posta</strong> verir ve bu kota portal bildirimleri, Firebase kimlik e-postaları (şifre sıfırlama) ve site form e-postalarıyla <strong>ortaktır</strong>. Sunucu bu yüzden iki koruma uygular: (1) kullanıcı ve talep başına <em>hız sınırı</em> (müşteri dakikada 5, personel dakikada 30 istek gibi); (2) <em>günlük kota</em>: <strong>yumuşak sınır 80</strong> aşılınca düşük öncelikli bildirimler (hatırlatma, SLA %80 uyarısı) gönderilmez, her sabah 06:00 (UTC) tek bir <strong>günlük özet e-postasıyla</strong> destek kutusuna iletilir; <strong>sert sınır 95</strong> aşılınca yüksek öncelikliler de reddedilir (<code>daily_quota</code>) ve özete düşer. Genel Bakış'taki E-posta Servisi kartı bugünkü kullanımı gösterir. Sınırlar ortam değişkenleriyle ayarlanır (aşağıda).</p>

  <h3>Kurulum kontrol listesi</h3>
  <table class="fields">
    <thead><tr><th>Değişken (Netlify → Site configuration → Environment variables)</th><th>Anlamı</th><th>Zorunlu mu?</th></tr></thead>
    <tbody>
      <tr><td><code>RESEND_API_KEY</code></td><td>Resend API anahtarı. Gönderim için yeterlidir; <em>Durumu Kontrol Et</em>'in alan adını okuyabilmesi için tam yetkili anahtar gerekir.</td><td><span class="req">Zorunlu</span></td></tr>
      <tr><td><code>FIREBASE_SERVICE_ACCOUNT</code></td><td>Firebase servis hesabı JSON'unun <strong>tek satırlık</strong> hâli. Sunucu tarafı kullanıcı yönetimini (davet, onarım, pasife alma), zamanlanmış otomasyonu ve yedeği etkinleştirir; tanımlı değilse bunlar kapalı kalır (Bölüm 6.3). Yalnızca Netlify ortam değişkeni (ve yedek için GitHub secret) olarak girilir, depoya yazılmaz.</td><td><span class="opt">Önerilir</span></td></tr>
      <tr><td><code>CONTACT_EMAIL</code></td><td>Destek kutusu adresi (varsayılan <code>info@parlabilgiteknolojileri.net</code>); sunucu “@support” sembolik alıcısını bu adrese çözer.</td><td><span class="opt">İsteğe bağlı</span></td></tr>
      <tr><td><code>SITE_URL</code></td><td>E-postalardaki bağlantıların kökü (https). Varsayılan: <code>https://www.parlabilgiteknolojileri.net</code>. İstemciden gelen bağlantı yok sayılır.</td><td><span class="opt">İsteğe bağlı</span></td></tr>
      <tr><td><code>ALLOWED_ORIGINS</code></td><td>Virgülle ayrılmış <em>ek</em> site alan adları (tam host). Varsayılan izinliler: <code>parlabilgiteknolojileri.net</code>, <code>www.</code>, <code>parla-bt-web.web.app</code>, <code>parla-bt-web.firebaseapp.com</code>. <code>*.netlify.app</code> için joker <strong>yoktur</strong>: deploy önizlemesi denenecekse tam host yazılır. <code>localhost</code> yalnızca üretim dışı çalışmada (yerel geliştirme, testler) kabul edilir.</td><td><span class="opt">İsteğe bağlı</span></td></tr>
      <tr><td><code>DAILY_EMAIL_SOFT_LIMIT</code> · <code>DAILY_EMAIL_HARD_LIMIT</code></td><td>Günlük kota yumuşak/sert sınırları (varsayılan 80 / 95).</td><td><span class="opt">İsteğe bağlı</span></td></tr>
      <tr><td><code>AUTOMATION_EMAIL_DAILY_MAX</code> · <code>AUTOMATION_MAX_EMAILS_PER_RUN</code></td><td>Otomasyonun günlük e-posta payı (varsayılan 40; otomatik kapanış bildirimleri muaf) ve tek çalıştırmada en çok e-posta (varsayılan 15).</td><td><span class="opt">İsteğe bağlı</span></td></tr>
      <tr><td><code>BACKUP_RETENTION_DAYS</code></td><td>Netlify Blobs yedeklerinin saklanma süresi (varsayılan 14 gün).</td><td><span class="opt">İsteğe bağlı</span></td></tr>
      <tr><td><code>FIREBASE_PROJECT_ID</code> · <code>FIREBASE_DATABASE_URL</code></td><td>Varsayılan değerleri <code>parla-bt-web</code> projesini gösterir; yalnızca farklı bir Firebase projesi kullanılırsa girilir.</td><td><span class="opt">İsteğe bağlı</span></td></tr>
    </tbody>
  </table>
  <ol class="steps">
    <li><h4>Siteyi ve işlevleri yayınlayın</h4><p>Netlify, <code>netlify.toml</code> uyarınca <code>/api/send-email</code> ve <code>/api/admin-users</code> isteklerini <code>netlify/functions</code> altındaki işlevlere yönlendirir. Site yalnızca başka bir yerde çalışıyorsa <code>site-config.js</code> içindeki <code>EMAIL_API_URL</code> / <code>ADMIN_USERS_API_URL</code> değerlerine Netlify sitesinin tam adresini yazın.</p></li>
    <li><h4>Anahtarı ekleyip yeniden dağıtın</h4><p>Ortam değişkeni eklemek tek başına yetmez; <strong>yeniden dağıtım</strong> gerekir (her dağıtım build kredisi harcar; değişiklikleri tek seferde yapın). Kontrol için tarayıcıda <code>/api/send-email</code> adresini açın: <code>"configured": true</code> görmelisiniz.</p></li>
    <li><h4>Resend alan adını doğrulayın</h4><p><code>parlabilgiteknolojileri.net</code> alan adını Resend'e ekleyin, istenen SPF ve DKIM DNS kayıtlarını girin ve durum <em>verified</em> olunca Genel Bakış'ta <em>Durumu Kontrol Et</em> ile teyit edin. Gönderen her zaman <em>Parla BT Destek &lt;info@parlabilgiteknolojileri.net&gt;</em>'dir; bildirim e-postalarına yanıt vermek talebe eklenmez.</p></li>
    <li><h4>Uçtan uca deneyin</h4><p><em>Test E-postası Gönder</em>'e basın; iletiyi gelen kutunuzda (ve spam'de) görün.</p></li>
    <li><h4>Firebase şifre sıfırlama e-postaları (ayrı kurulum)</h4><p>Kullanıcının giriş sayfasındaki <em>Şifremi Unuttum</em> ile başlattığı e-postayı Firebase gönderir; kodla yönetilmez. Firebase Console → Authentication → Templates bölümünde SMTP'yi Resend'e (<code>smtp.resend.com</code>, 587, kullanıcı <code>resend</code>) yönlendirin ve eylem bağlantısını <code>https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html</code> yapın; aksi halde iletiler Firebase'in varsayılan göndericisinden gider ve spam'e düşebilir. (Yönetici düğmeleriyle gönderilen davet ve şifre belirleme bağlantıları ise Netlify işlevi üzerinden Resend'den gider.)</p></li>
  </ol>

  <h2>Yeniden deneme kuyruğu ve hata kodları</h2>
  <p>Gönderim hatası ekranda uyarı olarak görünür ve Aktiviteler'e <em>E-posta Gönderilemedi</em> yazılır (Bölüm 5.2). Hatanın türüne göre iki yol izlenir:</p>
  <ul>
    <li><strong>Geçici hatalar</strong> (ağ kesintisi, 5xx, hız sınırı, günlük kota): e-posta bu tarayıcının yerel depolamasındaki bir kuyruğa alınır. İlk yeniden deneme hemen (en geç bir dakika içinde), sonrakiler artan aralıklarla (5 dk, 30 dk, 2 sa, 6 sa, 12 sa) yapılır; <strong>en çok 6 deneme veya 24 saat</strong> sürer, kuyruk en çok 50 iletiyi tutar. Aynı istek kimliği kullanıldığından e-posta <em>mükerrer gitmez</em>. Süre/deneme dolarsa ileti düşürülür ve günlüğe yazılır.</li>
    <li><strong>Kalıcı hatalar</strong> (4xx): kuyruğa alınmaz. <em>Tanılama/test</em> istekleri de hiçbir zaman kuyruğa alınmaz.</li>
  </ul>
  ${L.warn("Kuyruk <strong>kullanıcının tarayıcısına</strong> bağlıdır: tarayıcı kapanır veya yerel veriler silinirse bekleyen e-postalar kaybolur ve başka cihazda görünmez. Sunucu tarafında kalıcı bir e-posta kuyruğu yoktur; kritik bildirimler (otomatik kapanış, SLA aşımı) sunucudaki otomasyondan gider ve kota dolarsa günlük özete düşer.")}
  <table class="fields w3b">
    <thead><tr><th>Hata kodu</th><th>Ekranda görünen</th><th>Ne yapmalı?</th></tr></thead>
    <tbody>
      <tr><td><code>not_configured</code></td><td>E-posta servisi yapılandırılmamış (RESEND_API_KEY).</td><td>Anahtarı ekleyip yeniden dağıtın.</td></tr>
      <tr><td><code>invalid_api_key</code> · 401</td><td>Resend API anahtarı geçersiz veya yetkisiz.</td><td>Anahtarı yenileyin.</td></tr>
      <tr><td><code>domain_not_verified</code></td><td>Gönderen alan adı Resend'de doğrulanmamış.</td><td>DNS kayıtlarını tamamlayın.</td></tr>
      <tr><td><code>rate_limited</code> · <code>rate_limited_user</code> · <code>rate_limited_ticket</code> · 429</td><td>Çok sık istek / e-posta servisi yoğun.</td><td>Geçicidir; kuyruk yeniden dener.</td></tr>
      <tr><td><code>daily_quota</code> · 429</td><td>Günlük e-posta kotası doldu.</td><td>Düşük öncelikli bildirimler günlük özete eklenir; ertesi gün kota yenilenir. Sık oluyorsa ücretli plana geçin.</td></tr>
      <tr><td><code>validation_error</code> · <code>bad_recipients</code></td><td>E-posta içeriği veya alıcı kabul edilmedi.</td><td>Alıcı adresini kontrol edin.</td></tr>
      <tr><td><code>recipient_not_allowed</code> · <code>recipient_not_registered</code> · <code>inactive_recipient</code></td><td>Alıcı bu talebin tarafı değil / kayıtlı değil / hesabı pasif.</td><td>Talep sahibinin e-postasını / atamayı / hesap durumunu kontrol edin.</td></tr>
      <tr><td><code>status_mismatch</code> · <code>priority_mismatch</code></td><td>Talep durumu/önceliği bu bildirimle uyuşmuyor.</td><td>Talebi yenileyin; durum bu arada değişmiş olabilir.</td></tr>
      <tr><td><code>origin_denied</code></td><td>İstek kaynağı kabul edilmedi.</td><td>Site alan adını <code>ALLOWED_ORIGINS</code>'e ekleyin.</td></tr>
      <tr><td><code>no_session</code> · <code>no_token</code> · <code>bad_token</code> · <code>bad_claims</code></td><td>Oturum bulunamadı veya süresi doldu; yeniden giriş yapın.</td><td>Çıkış yapıp tekrar girin.</td></tr>
      <tr><td><code>endpoint_missing</code> · 404</td><td>E-posta servisi bu sitede bulunamadı.</td><td>Netlify Function'ı dağıtın.</td></tr>
    </tbody>
  </table>

  <h2>Sunucu tarafı yönetim, otomasyon ve yedek</h2>
  ${L.who("sa")}
  <p>Firebase <strong>servis hesabı</strong> (<code>FIREBASE_SERVICE_ACCOUNT</code>) tanımlandığında üç özellik etkinleşir; tanımlı değilse üçü de zarifçe kapalı kalır (portal çalışmaya devam eder):</p>
  <table class="fields w3b">
    <thead><tr><th>Özellik</th><th>Ne yapar?</th><th>Tanımlı değilse</th></tr></thead>
    <tbody>
      <tr><td><strong>Kullanıcı yönetimi işlevi</strong> (<code>/api/admin-users</code>)</td><td>Kullanıcıyı davetle oluşturur (Auth hesabı + profil tek işlemde, hata olursa geri alma), yetim hesabı onarır, hesabı pasife alırken Firebase hesabını da kapatır, şifre belirleme bağlantısı üretir.</td><td>Kullanıcılar sayfasında “Eski yöntem kullanılıyor” uyarısı çıkar; hesap tarayıcıdan geçici şifreyle açılır.</td></tr>
      <tr><td><strong>Talep otomasyonu</strong> (30 dakikada bir)</td><td>SLA uyarıları, hatırlatmalar, otomatik kapanış, atanmamış talep eskalasyonu (Bölüm 2.8).</td><td>Hiçbir şey yapmaz.</td></tr>
      <tr><td><strong>Yedek</strong> (günlük)</td><td>Veritabanının günlük dışa aktarımı Netlify Blobs'a yazılır (14 gün saklanır); ayrıca GitHub Actions iş akışı tam yedeği 30 gün saklı artifact olarak üretir (isteğe bağlı parolayla şifreli).</td><td>Yedek alınmaz.</td></tr>
    </tbody>
  </table>
  <ol class="steps">
    <li><h4>Servis hesabı anahtarı oluşturun</h4><p>Firebase Console → Proje ayarları → Hizmet hesapları → <em>Yeni özel anahtar oluştur</em>. Hesaba yalnızca <em>Firebase Authentication Admin</em> ve <em>Firebase Realtime Database Admin</em> rolleri yeter. JSON'u tek satıra çevirin; depoya, e-postaya veya sohbete <strong>yazmayın</strong>.</p></li>
    <li><h4>Netlify'a (ve yedek için GitHub'a) ekleyin</h4><p>Netlify ortam değişkeni <code>FIREBASE_SERVICE_ACCOUNT</code>; GitHub → Settings → <em>Secrets and variables</em> → Actions → aynı adlı secret (yedek ve otomatik kural dağıtımı için). Netlify'da yeniden dağıtın.</p></li>
    <li><h4>Doğrulayın</h4><p>Yönetici olarak <em>Yeni Kullanıcı</em> penceresini açın: “Eski yöntem” uyarısı kaybolmalı ve <em>davet</em> kutusu görünmelidir.</p></li>
  </ol>
  ${L.danger("<strong>Servis hesabını eklemeden önce</strong>, 10 günden uzun süredir <em>Kapanış Onayı Bekliyor</em> durumunda duran talepleri gözden geçirin: otomasyon ilk çalışmasında bunları <strong>otomatik kapatır ve müşterilere e-posta gönderir</strong>. Gerekirse önce talepleri yöneticiler olarak sonuçlandırın. Otomasyonu acil durdurmak için ortam değişkenini geçici kaldırın ya da <code>AUTOMATION_EMAIL_DAILY_MAX=0</code> yapıp yeniden dağıtın.", "İlk etkinleştirme")}
  ${L.warn("Servis hesabı anahtarı veritabanının tamamına kuralları aşarak erişir; sızdığından şüphelenirseniz Google Cloud Console → IAM'den anahtarı <strong>hemen silip yenisini</strong> oluşturun ve her iki yerde güncelleyin. Yedekler kişisel veri içerir: GitHub deposu <strong>özel</strong> olmalı, yedek şifre parolası (<code>BACKUP_PASSPHRASE</code>) güvenli bir yerde saklanmalıdır.", "Anahtar ve yedek güvenliği")}

  <h2>Veri Bakımı</h2>
  ${L.who("sa")}
  <p>Genel Bakış'taki <strong>Veri Bakımı</strong> kartı yalnızca Süper Admin'e görünür ve tek bir araç içerir: <strong>İç Notları Taşı</strong>. Eski portal sürümü iç notları müşteriye de açık olan mesaj düğümünde saklıyordu; araç bu kayıtları yalnızca personelin okuyabildiği ayrı alana (<code>ticket_internal_notes</code>) taşır ve eski yerinden siler.</p>
  <div class="shot-row">
    ${L.fig("a06-veri-bakimi", { bare: true, nonum: true, caption: "Taşıma sonrası: 2 iç not 1 talepten taşındı.", legend: ["<strong>İç Notları Taşı</strong> — onay penceresi sorar, sonra tüm talepleri tarar."] })}
    <div>
      <ul>
        <li>Onay penceresinden sonra sonuç kartta yazar: <em>“N dahili not M talepten taşındı”</em> veya <em>“Taşınacak eski dahili not bulunmadı”</em>.</li>
        <li>İşlem <strong>tekrar çalıştırılabilir</strong>; taşınacak kayıt yoksa hiçbir şey değiştirmez.</li>
        <li>İşlem tarayıcıdan tüm talepleri okuyarak yürür (ilerleme sayacı görünür); çok talep varsa bitene kadar sekmeyi kapatmayın.</li>
      </ul>
      ${L.tip("Yeni sürümde iç notlar zaten ayrı düğüme yazılır; bu aracı yalnızca eski sürümden kalan veriler için, bir kez çalıştırmanız yeter.")}
    </div>
  </div>

  <h2>Veritabanı kuralları ve dağıtım</h2>
  <p>Tüm yetkilendirme Firebase Realtime Database kurallarıyla uygulanır; arayüzde bir düğmenin gizlenmesi tek başına güvenlik sağlamaz. Kuralların kaynağı <code>tests/rules/generate-rules.js</code>, çıktısı <code>database.rules.json</code>'dur; <strong>çıktı dosyası elle düzenlenmez</strong> (testler iki dosyanın eşitliğini doğrular).</p>
  <ol class="steps">
    <li><h4>Kuralı düzenleyin ve üretin</h4><p><code>generate-rules.js</code> içinde değişikliği yapın, ardından <code>node tests/rules/generate-rules.js</code> ile <code>database.rules.json</code>'u yeniden üretin.</p></li>
    <li><h4>Testleri çalıştırın</h4><p><code>cd tests/rules &amp;&amp; npm install &amp;&amp; npm test</code> — yetki matrisini (rol × işlem) ve JSON'un güncelliğini doğrular.</p></li>
    <li><h4>Canlı veriyi tarayın</h4><p>Kurallar sıkılaştıysa, eski kayıtların yeni kurallarda kilitlenmemesi için dağıtımdan <strong>önce</strong> canlı verinin dışa aktarımını <code>node tests/rules/scan-existing-data.cjs</code> ile tarayın (ayrıntı: <code>tests/rules/README.md</code>; çıkış kodu 2 = dağıtımı engelleyen bulgu).</p></li>
    <li><h4>Sırayı izleyin: önce site, sonra kurallar</h4><p>Önce istemci kodunu (site) yayınlayın, doğrulayın; <strong>hemen ardından</strong> <code>firebase deploy --only database --project parla-bt-web</code>. Kurallar ayrıca elle dağıtılır — Netlify yayını kuralları dağıtmaz (GitHub'da servis hesabı secret'ı tanımlıysa <code>deploy-rules.yml</code> kural değişince kendisi dağıtır).</p></li>
    <li><h4>Duman testi yapın</h4><p>Müşteri girişiyle talep açıp yanıtlayın; ardından personel girişiyle atayıp yanıtlayın (ayrıntılı liste: <code>docs/yayin-kontrol-listesi.md</code>). Sorun olursa Firebase Console → Realtime Database → Kurallar → <em>Geçmiş</em> sekmesinden önceki sürüme dönebilir veya <code>docs/runbook.md</code> §3'teki geri alma adımlarını izleyebilirsiniz; geri alınan <code>database.rules.json</code> üreteçten farklı olacağı için işi bitince <code>git checkout -- database.rules.json</code> ile dosyayı eski haline getirin.</p></li>
  </ol>
  ${L.info("Arayüzde <em>“Veritabanı erişim izni reddedildi … kuralları yayınladığınızdan emin olun”</em> uyarısı çıkıyorsa, güncel kurallar yayınlanmamış veya bir rol yetkisiz işlem yapıyordur.", "İzin hatası")}

  <h3>Güvenlik notları</h3>
  <ul>
    <li><strong>Roller:</strong> pasif (devre dışı) hesap hiçbir rolün yetkisini kullanamaz; profili olmayan hesap talep, mesaj veya ek yazamaz. Kullanıcı kendi profilinde yalnızca son giriş, güncelleme zamanı ve (<em>false</em> yaparak) şifre-değiştirme bayrağını yazabilir; rol ve yetkiler yalnızca Süper Admin/Destek Atayıcı tarafından değiştirilir. Süper Admin rolü yalnızca Süper Admin tarafından verilir.</li>
    <li><strong>Gizlilik:</strong> müşteri yalnızca kendi taleplerini (Firma Yöneticisi: firmasınınkileri) okur; iç notlar, ekleri ve <strong>sözleşme bedelleri</strong> yalnızca yetkili personele açıktır. Danışman tüm talepleri okur ama yalnızca atandığı talepte yazar. Mesajlar, geçmiş ve aktivite kayıtları eklenir, değiştirilemez. Talebi kalıcı silme ve mesaj silme yalnızca Süper Admin'dedir; Destek Atayıcı yalnızca arşive alır.</li>
    <li><strong>Müşteri sınırları (kurallarda):</strong> kapalı talebe mesaj/ek yazılamaz; kapanmış talep yalnızca kapanıştan sonra 14 gün içinde yeniden açılabilir; talep tipi firma türüne kilitlidir (CUS → SUP/BUG, ARC → ARZ/BUG); pasif firmanın kullanıcısı yeni talep açamaz.</li>
    <li><strong>E-posta ucu:</strong> geçerli bir Firebase kimlik jetonu ister; pasif hesapları reddeder; kaynak (Origin) denetlenir; hız sınırı ve günlük kota uygular; içerik ve alıcılar sunucuda veritabanından türetilir (alıcılar yalnızca talep tarafları, destek kutusu ve — personel gönderenler için — aktif personel olabilir).</li>
    <li><strong>Oturum süresi:</strong> boşta kalan oturum personelde <strong>8 saat</strong>, müşteride <strong>30 gün</strong> sonra kapanır.</li>
    <li><strong>Ek dosyalar</strong> veritabanında base64 olarak tutulur (en çok 3 dosya × 2 MB); çok sayıda ek veritabanı boyutunu büyütür. <strong>Talebi kalıcı silme</strong> bağlı tüm düğümleri (mesaj, geçmiş, efor, ek, atama) birlikte siler.</li>
  </ul>

  <h3>Yedekleme ve kontrol</h3>
  <ul>
    <li><strong>Veri yedeği:</strong> servis hesabı tanımlıysa günlük yedek otomatik alınır (Bölüm 6.3). Elle yedek için Firebase Console → Realtime Database → <em>Veri</em> sekmesindeki kök düğümden JSON dışa aktarımı alıp güvenli bir yerde saklayın. Geri yükleme adımları <code>docs/runbook.md</code> §4'tedir; üç ayda bir geri yükleme tatbikatı önerilir. Talepler ve Raporlar sayfalarındaki CSV/Excel dışa aktarmaları kısmi bir döküm olarak işe yarar.</li>
    <li><strong>Otomatik testler</strong> (geliştirme ortamında): birim testleri <code>node --test netlify/tests/*.test.* tests/unit/*.test.mjs</code>, kurallar <code>cd tests/rules &amp;&amp; npm test</code>, tarayıcı testleri <code>tests/e2e/*.e2e.cjs</code> (komutların tam listesi depodaki <code>CLAUDE.md</code> ve <code>docs/runbook.md</code>'dedir).</li>
    <li><strong>Bu kılavuzu yenilemek:</strong> <code>node docs/manuals/capture-screens.cjs admin</code> (ekran görüntüleri), <code>node docs/manuals/content/admin/make.cjs &amp;&amp; node docs/manuals/build.cjs admin</code> (PDF). Çıktı <code>docs/manuals/out/</code> altına yazılır; PDF'ler elle <code>support-v2/docs/</code> klasörüne kopyalanır (<code>docs/manuals/README.md</code>).</li>
  </ul>
</section>`;
