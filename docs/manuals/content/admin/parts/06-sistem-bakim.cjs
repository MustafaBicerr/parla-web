module.exports = (L) => `
<section class="chapter" data-opener="false" data-title="Sistem ve Bakım"
         data-intro="E-posta servisinin izlenmesi, test edilmesi ve kurulumu (Netlify, Resend, Firebase), yeniden deneme kuyruğu, Veri Bakımı aracı, veritabanı kurallarının yayınlanması ve güvenlik notları.">
  <h1>Sistem ve Bakım</h1>

  <h2>E-posta servisi</h2>
  ${L.who("sa", "da")}
  <p>Portalın tüm bildirim e-postaları aynı hattan geçer. İşlemi yapan personelin tarayıcısı, oturum açmış kullanıcının Firebase kimlik jetonuyla portalın <code>/api/send-email</code> adresine istek gönderir; <strong>Netlify Function</strong> jetonu doğrular, içeriği ve alıcıları veritabanından kendisi oluşturur ve <strong>Resend</strong> aracılığıyla gönderir.</p>
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

  <h3>Kurulum kontrol listesi</h3>
  <table class="fields">
    <thead><tr><th>Değişken (Netlify → Site settings → Environment variables)</th><th>Anlamı</th><th>Zorunlu mu?</th></tr></thead>
    <tbody>
      <tr><td><code>RESEND_API_KEY</code></td><td>Resend API anahtarı. Gönderim için yeterlidir; <em>Durumu Kontrol Et</em>'in alan adını okuyabilmesi için tam yetkili anahtar gerekir.</td><td><span class="req">Zorunlu</span></td></tr>
      <tr><td><code>CONTACT_EMAIL</code></td><td>Destek kutusu adresi (varsayılan <code>info@parlabilgiteknolojileri.net</code>). Sunucu, talep e-postalarında bu adrese gönderime izin verir; <code>assets/js/site-config.js</code> içindeki <code>CONTACT_EMAIL</code> ile <strong>aynı</strong> olmalıdır.</td><td><span class="opt">İsteğe bağlı</span></td></tr>
      <tr><td><code>ALLOWED_ORIGINS</code></td><td>Virgülle ayrılmış ek site alan adları (ör. <code>destek.ornek.com</code>). Varsayılan izinliler: <code>parlabilgiteknolojileri.net</code>, <code>www.</code>, <code>parla-bt-web.web.app</code>, <code>parla-bt-web.firebaseapp.com</code>, <code>localhost</code> ve tüm <code>*.netlify.app</code>.</td><td><span class="opt">İsteğe bağlı</span></td></tr>
      <tr><td><code>FIREBASE_PROJECT_ID</code> · <code>FIREBASE_DATABASE_URL</code></td><td>Varsayılan değerleri <code>parla-bt-web</code> projesini gösterir; yalnızca farklı bir Firebase projesi kullanılırsa girilir.</td><td><span class="opt">İsteğe bağlı</span></td></tr>
    </tbody>
  </table>
  <ol class="steps">
    <li><h4>Siteyi ve işlevi yayınlayın</h4><p>Netlify, <code>netlify.toml</code> uyarınca <code>/api/send-email</code> isteğini <code>netlify/functions/send-email.js</code>'e yönlendirir. Site yalnızca Firebase Hosting'de çalışıyorsa <code>site-config.js</code> içindeki <code>EMAIL_API_URL</code> değerine Netlify sitesinin tam adresini yazın.</p></li>
    <li><h4>Anahtarı ekleyip yeniden dağıtın</h4><p>Ortam değişkeni eklemek tek başına yetmez; <strong>yeniden dağıtım</strong> gerekir. Kontrol için tarayıcıda <code>/api/send-email</code> adresini açın: <code>"configured": true</code> görmelisiniz.</p></li>
    <li><h4>Resend alan adını doğrulayın</h4><p><code>parlabilgiteknolojileri.net</code> alan adını Resend'e ekleyin, istenen SPF ve DKIM DNS kayıtlarını girin ve durum <em>verified</em> olunca Genel Bakış'ta <em>Durumu Kontrol Et</em> ile teyit edin. Gönderen her zaman <em>Parla BT Destek &lt;info@parlabilgiteknolojileri.net&gt;</em>; yanıtlar aynı adrese gider.</p></li>
    <li><h4>Uçtan uca deneyin</h4><p><em>Test E-postası Gönder</em>'e basın; iletiyi gelen kutunuzda (ve spam'de) görün.</p></li>
    <li><h4>Firebase şifre e-postaları (ayrı kurulum)</h4><p>Şifre sıfırlama ve hesap davet e-postalarını Firebase gönderir; kodla yönetilmez. Firebase Console → Authentication → Templates bölümünde SMTP'yi Resend'e (<code>smtp.resend.com</code>, 587, kullanıcı <code>resend</code>) yönlendirin ve eylem bağlantısını <code>https://www.parlabilgiteknolojileri.net/support-v2/auth-action.html</code> yapın; aksi halde iletiler Firebase'in varsayılan göndericisinden gider ve spam'e düşebilir.</p></li>
  </ol>

  <h2>Yeniden deneme kuyruğu ve hata kodları</h2>
  <p>Gönderim hatası ekranda uyarı olarak görünür ve Aktiviteler'e <em>E-posta Gönderilemedi</em> yazılır (Bölüm 5.2). Hatanın türüne göre iki yol izlenir:</p>
  <ul>
    <li><strong>Geçici hatalar</strong> (ağ kesintisi, 5xx, “yoğunluk”): e-posta bu tarayıcının yerel depolamasındaki bir kuyruğa alınır. Kuyruk sayfa açıldıktan 4 saniye sonra, ardından her dakika ve tarayıcı yeniden çevrimiçi olunca işlenir; en çok 6 deneme veya 24 saat sürer, en çok 50 iletiyi tutar. Aynı istek kimliği kullanıldığından e-posta <em>mükerrer gitmez</em>. Süre/deneme dolarsa ileti düşürülür ve günlüğe yazılır.</li>
    <li><strong>Kalıcı hatalar</strong> (4xx): kuyruğa alınmaz. Şifre içeren <em>giriş bilgileri</em> e-postası ile <em>tanılama/test</em> istekleri de hiçbir zaman kuyruğa alınmaz.</li>
  </ul>
  ${L.warn("Kuyruk <strong>kullanıcının tarayıcısına</strong> bağlıdır: tarayıcı kapanır veya yerel veriler silinirse bekleyen e-postalar kaybolur ve başka cihazda görünmez.")}
  <table class="fields w3b">
    <thead><tr><th>Hata kodu</th><th>Ekranda görünen</th><th>Ne yapmalı?</th></tr></thead>
    <tbody>
      <tr><td><code>not_configured</code></td><td>E-posta servisi yapılandırılmamış (RESEND_API_KEY).</td><td>Anahtarı ekleyip yeniden dağıtın.</td></tr>
      <tr><td><code>invalid_api_key</code> · 401</td><td>Resend API anahtarı geçersiz veya yetkisiz.</td><td>Anahtarı yenileyin.</td></tr>
      <tr><td><code>domain_not_verified</code></td><td>Gönderen alan adı Resend'de doğrulanmamış.</td><td>DNS kayıtlarını tamamlayın.</td></tr>
      <tr><td><code>rate_limited</code> · 429</td><td>E-posta servisi yoğun, lütfen tekrar deneyin.</td><td>Geçicidir; kuyruk yeniden dener.</td></tr>
      <tr><td><code>validation_error</code></td><td>E-posta içeriği veya alıcı kabul edilmedi.</td><td>Alıcı adresini kontrol edin.</td></tr>
      <tr><td><code>recipient_not_allowed</code></td><td>Alıcı bu ticket'ın muhatapları arasında değil.</td><td>Talep sahibinin e-postasını / atamayı kontrol edin.</td></tr>
      <tr><td><code>status_mismatch</code></td><td>Talep durumu bu bildirimle uyuşmuyor.</td><td>Talebi yenileyin; durum bu arada değişmiş olabilir.</td></tr>
      <tr><td><code>origin_denied</code></td><td>İstek kaynağı kabul edilmedi.</td><td>Site alan adını <code>ALLOWED_ORIGINS</code>'e ekleyin.</td></tr>
      <tr><td><code>no_session</code> · <code>no_token</code></td><td>Oturum bulunamadı; yeniden giriş yapın.</td><td>Çıkış yapıp tekrar girin.</td></tr>
      <tr><td><code>endpoint_missing</code> · 404</td><td>E-posta servisi bu sitede bulunamadı.</td><td>Netlify Function'ı dağıtın.</td></tr>
    </tbody>
  </table>

  <h2>Veri Bakımı</h2>
  ${L.who("sa")}
  <p>Genel Bakış'taki <strong>Veri Bakımı</strong> kartı yalnızca Süper Admin'e görünür ve tek bir araç içerir: <strong>İç Notları Taşı</strong>. Eski portal sürümü iç notları müşteriye de açık olan mesaj düğümünde saklıyordu; araç bu kayıtları yalnızca personelin okuyabildiği ayrı alana (<code>ticket_internal_notes</code>) taşır ve eski yerinden siler.</p>
  <div class="shot-row">
    ${L.fig("a06-veri-bakimi", { bare: true, nonum: true, caption: "Taşıma sonrası: 2 iç not 1 talepten taşındı.", legend: ["<strong>İç Notları Taşı</strong> — onay sorar, sonra tüm talepleri tarar."] })}
    <div>
      <ul>
        <li>Onay penceresinden sonra sonuç kartta yazar: <em>“N dahili not M talepten taşındı”</em> veya <em>“Taşınacak eski dahili not bulunmadı”</em>.</li>
        <li>İşlem <strong>tekrar çalıştırılabilir</strong>; taşınacak kayıt yoksa hiçbir şey değiştirmez.</li>
        <li>İşlem tarayıcıdan tüm talepleri okuyarak yürür; çok talep varsa bitene kadar sekmeyi kapatmayın.</li>
      </ul>
      ${L.tip("Yeni sürümde iç notlar zaten ayrı düğüme yazılır; bu aracı yalnızca eski sürümden kalan veriler için, bir kez çalıştırmanız yeter.")}
    </div>
  </div>

  <h2>Veritabanı kuralları ve dağıtım</h2>
  <p>Tüm yetkilendirme Firebase Realtime Database kurallarıyla uygulanır; arayüzde bir düğmenin gizlenmesi tek başına güvenlik sağlamaz. Kuralların kaynağı <code>tests/rules/generate-rules.js</code>, çıktısı <code>database.rules.json</code>'dur (<code>firebase.json</code> bu dosyayı yayınlar).</p>
  <ol class="steps">
    <li><h4>Kuralı düzenleyin ve üretin</h4><p><code>generate-rules.js</code> içinde değişikliği yapın, ardından <code>node tests/rules/generate-rules.js</code> ile <code>database.rules.json</code>'u yeniden üretin.</p></li>
    <li><h4>Testleri çalıştırın</h4><p><code>cd tests/rules &amp;&amp; npm install &amp;&amp; npm test</code> — kuralları ve JSON'un güncelliğini doğrular.</p></li>
    <li><h4>Yayınlayın</h4><p><code>firebase deploy --only database</code>. Önce siteyi, sonra kuralları yayınlamak güvenlidir.</p></li>
    <li><h4>Duman testi yapın</h4><p>Müşteri girişiyle talep açıp yanıtlayın; ardından personel girişiyle atayıp yanıtlayın. Sorun olursa önceki sürümü geri yükleyip yeniden yayınlayın: <code>git show &lt;eski-commit&gt;:database.rules.json &gt; database.rules.json &amp;&amp; firebase deploy --only database</code>.</p></li>
  </ol>
  ${L.info("Arayüzde <em>“Veritabanı erişim izni reddedildi … kuralları yayınladığınızdan emin olun”</em> uyarısı çıkıyorsa, güncel kurallar yayınlanmamış veya bir rol yetkisiz işlem yapıyordur.", "İzin hatası")}

  <h3>Güvenlik notları</h3>
  <ul>
    <li><strong>Roller:</strong> kullanıcı kendi profilinde yalnızca son giriş, güncelleme zamanı ve (<em>false</em> yaparak) şifre-değiştirme bayrağını yazabilir; rol ve yetkiler yalnızca Süper Admin/Destek Atayıcı tarafından değiştirilir. Süper Admin rolü yalnızca Süper Admin tarafından verilir.</li>
    <li><strong>Gizlilik:</strong> müşteri yalnızca kendi taleplerini (Firma Yöneticisi: firmasınınkileri) okur; iç notlar ve onların ekleri yalnızca personele açıktır. Mesajlar ve aktivite kayıtları eklenir, değiştirilemez; mesaj silme yalnızca Süper Admin'dedir.</li>
    <li><strong>E-posta ucu:</strong> geçerli bir Firebase kimlik jetonu ister; pasif hesapları reddeder; e-posta içeriği ve alıcılar sunucuda veritabanından türetilir (alıcılar yalnızca talep tarafları, destek kutusu ve — personel gönderenler için — aktif personel olabilir).</li>
    <li><strong>Ek dosyalar</strong> veritabanında base64 olarak tutulur (en çok 3 dosya × 2 MB); çok sayıda ek veritabanı boyutunu büyütür. <strong>Talep silme</strong> yalnızca talep kaydını kaldırır; mesaj, geçmiş, efor ve ek düğümleri yetim kalır.</li>
  </ul>

  <h3>Yedekleme ve kontrol</h3>
  <ul>
    <li><strong>Veri yedeği:</strong> düzenli aralıklarla Firebase Console → Realtime Database → <em>Veri</em> sekmesindeki kök düğümden JSON dışa aktarımı alın ve güvenli bir yerde saklayın (Firebase Console özelliği; portal bunu otomatik yapmaz). Ticketlar ve Raporlar sayfalarındaki CSV/Excel dışa aktarmaları kısmi bir döküm olarak işe yarar.</li>
    <li><strong>Otomatik testler</strong> (geliştirme ortamında): <code>node --test netlify/tests/send-email.test.js</code>, <code>node --test netlify/tests/client-email-service.test.mjs</code>, <code>cd tests/rules &amp;&amp; npm test</code> ve <code>node tests/e2e/lifecycle.e2e.cjs</code> (ayrıca <code>bell-sla</code>, <code>attachments</code>, <code>smoke-all</code>).</li>
    <li><strong>Bu kılavuzu yenilemek:</strong> <code>node docs/manuals/capture-screens.cjs admin</code> (ekran görüntüleri), <code>node docs/manuals/content/admin/make.cjs &amp;&amp; node docs/manuals/build.cjs admin</code> (PDF). Çıktı <code>docs/manuals/out/</code> altına yazılır; portaldaki bağlantılar <code>support-v2/docs/</code> klasörünü kullanır.</li>
  </ul>
</section>`;
