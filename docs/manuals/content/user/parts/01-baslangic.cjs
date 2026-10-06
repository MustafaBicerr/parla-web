module.exports = (L) => `
<section class="chapter" data-title="Başlangıç"
         data-intro="Destek Portalı'nın ne işe yaradığını, ilk girişi, şifre işlemlerini ve ekranlardaki ana alanları öğrenin. Bu bölümü bitirdiğinizde portalı rahatça kullanmaya hazırsınız.">
  <h1>Başlangıç</h1>

  <h2>Destek Portalı nedir?</h2>
  <p class="lead">Destek Portalı, Parla Bilgi Teknolojileri'nden aldığınız SAP destek hizmetini tek bir yerden yönetmeniz için hazırlanmış web uygulamasıdır. Telefon ve e-posta trafiğine gerek kalmadan taleplerinizi açar, durumlarını izler ve danışmanlarımızla talebin içinden yazışırsınız.</p>

  <div class="cards">
    <div class="card"><div class="ico" data-ico="ticket"></div><h4>Talep açın</h4><p>Sorununuzu ilgili SAP modülü, öncelik ve ekran görüntüleriyle tek formda bildirin.</p></div>
    <div class="card blue"><div class="ico" data-ico="activity"></div><h4>Takip edin</h4><p>Her talebin durumunu, atanan danışmanı ve geçmişi anlık görün; değişikliklerde e-posta alın.</p></div>
    <div class="card green"><div class="ico" data-ico="message-square"></div><h4>Yazışın</h4><p>Danışmanınızla talebin içinden konuşun; tüm yazışma ve dosyalar tek kayıtta kalsın.</p></div>
  </div>
  <div class="cards">
    <div class="card amber"><div class="ico" data-ico="circle-check"></div><h4>Onaylayın</h4><p>Çözümü test edin; sorun giderildiyse kapanışı siz onaylayın, sürüyorsa yeniden açın.</p></div>
    <div class="card navy"><div class="ico" data-ico="bell"></div><h4>Haberdar olun</h4><p>Sizden bir işlem beklendiğinde bildirim zilinde ve e-postanızda uyarı görürsünüz.</p></div>
    <div class="card red"><div class="ico" data-ico="shield-check"></div><h4>Güvende kalın</h4><p>Verileriniz yalnızca size ve ilgili Parla BT ekibine açıktır; dosyalarınız da öyle.</p></div>
  </div>

  <h3>Kimler kullanabilir?</h3>
  <p>Hesaplar Parla BT tarafından oluşturulur; kendi başınıza kayıt olamazsınız. Hesabınızın <strong>rolü</strong>, neleri görebileceğinizi belirler:</p>
  <table class="fields">
    <thead><tr><th>Rol</th><th>Ne yapabilir?</th><th>Hangi talepleri görür?</th></tr></thead>
    <tbody>
      <tr><td>Müşteri Kullanıcısı</td><td>Talep açar, yanıtlar, kapanışı onaylar veya yeniden açar.</td><td>Yalnızca <strong>kendi</strong> açtığı talepler.</td></tr>
      <tr><td>Firma Yöneticisi</td><td>Müşteri kullanıcısının tüm yetkileri; ayrıca firmanın diğer taleplerini izler ve yanıtlar.</td><td>Firmanın <strong>tüm</strong> talepleri.</td></tr>
      <tr><td>Arızi Müşteri</td><td>Destek sözleşmesi olmayan firmalar için, talep tipi varsayılan olarak “Arızi Talep” gelir.</td><td>Yalnızca kendi talepleri.</td></tr>
    </tbody>
  </table>

  ${L.info("Tarayıcı olarak Chrome, Edge, Firefox veya Safari'nin güncel sürümlerini kullanın. Bilgisayar, tablet ve telefonda çalışır; ekran görüntüleri bu kılavuzda bilgisayar görünümüyle verilmiştir.", "Gereksinimler")}

  <h2>Portala giriş</h2>
  <p>Hesabınız oluşturulduğunda Parla BT ekibi <strong>giriş bilgilerinizi</strong> (e-posta adresiniz ve geçici şifreniz) size iletir; genellikle e-posta ile. Portal adresi: <strong>www.parlabilgiteknolojileri.net/support</strong></p>

  ${L.steps([
    ["Giriş sayfasını açın", `<p>Tarayıcınıza portal adresini yazın veya giriş bilgilerinizin geldiği e-postadaki <span class="ui-btn primary">Portala giriş yap</span> bağlantısına tıklayın.</p>`],
    ["Bilgilerinizi girin", `<p>${L.field("E-posta")} alanına hesabınıza bağlı adresi, ${L.field("Şifre")} alanına geçici şifrenizi yazın. Şifreyi görmek için alanın sağındaki göz simgesine tıklayabilirsiniz.</p>`],
    ["Giriş yapın", `<p>${L.btn("Giriş Yap")} düğmesine tıklayın veya <kbd>Enter</kbd> tuşuna basın. Birkaç saniye içinde ${L.menu("Genel Bakış")} sayfası açılır.</p>`],
  ])}

  ${L.fig("01-giris", { half: true, bare: true, caption: "Giriş kartı: oturum açmak için gereken her şey burada.",
    legend: ["<strong>E-posta</strong> — hesabınıza bağlı kurumsal adres.", "<strong>Şifre</strong> — göz simgesi şifreyi gösterir/gizler.", "<strong>Giriş Yap</strong> — oturumu başlatır.", "<strong>Şifremi Unuttum</strong> — sıfırlama e-postası gönderir."], cols2: true })}

  ${L.tip("Giriş yapamıyorsanız önce <kbd>Caps Lock</kbd> tuşunun kapalı olduğundan emin olun; şifre büyük/küçük harfe duyarlıdır. Birkaç başarısız denemeden sonra hesap kısa süre kilitlenebilir — beklemeniz yeterlidir.")}
  ${L.warn("Şifrenizi kimseyle paylaşmayın. Parla BT çalışanları sizden şifrenizi hiçbir zaman istemez.")}

  <h3>İlk girişte şifrenizi belirleyin</h3>
  <p>Hesabınız geçici bir şifreyle açıldığı için ilk girişinizde portal sizi otomatik olarak <strong>Şifrenizi belirleyin</strong> sayfasına yönlendirir. Yeni şifrenizi belirlemeden portalın diğer bölümlerini kullanamazsınız.</p>

  ${L.fig("01-sifre-degistir", { half: true, bare: true, caption: "İlk girişte açılan şifre belirleme kartı.",
    legend: ["<strong>Geçici şifre</strong> — size e-postayla gönderilen şifre.", "<strong>Yeni şifre</strong> — kendi belirlediğiniz şifre.", "<strong>Yeni şifre (tekrar)</strong> — aynısını bir kez daha yazın.", "<strong>Şifreyi Güncelle</strong> — kaydeder ve sizi portala alır."], cols2: true })}

  <table class="fields">
    <thead><tr><th>Şifre kuralı</th><th>Açıklama</th></tr></thead>
    <tbody>
      <tr><td>Uzunluk</td><td>En az <strong>8 karakter</strong>.</td></tr>
      <tr><td>Büyük harf</td><td>En az bir büyük harf (A–Z).</td></tr>
      <tr><td>Rakam</td><td>En az bir rakam (0–9).</td></tr>
      <tr><td>Farklı olmalı</td><td>Yeni şifre geçici şifreyle aynı olamaz.</td></tr>
    </tbody>
  </table>

  <h3>Şifrenizi unuttuysanız</h3>
  ${L.steps([
    ["Bağlantıya tıklayın", `<p>Giriş sayfasında e-posta adresinizi yazın ve ${L.btn("Şifremi Unuttum", "secondary")} bağlantısına tıklayın.</p>`],
    ["E-postanızı kontrol edin", `<p>Birkaç dakika içinde sıfırlama bağlantısı içeren bir e-posta alırsınız. Gelmediyse <strong>gereksiz (spam)</strong> klasörüne bakın.</p>`],
    ["Yeni şifre belirleyin", `<p>E-postadaki bağlantı <strong>Yeni Şifre Belirle</strong> sayfasını açar. Şifrenizi iki kez yazıp ${L.btn("Şifreyi Kaydet")} düğmesine tıklayın, ardından yeni şifrenizle giriş yapın.</p>`],
  ])}
  ${L.fig("01-sifre-sifirla", { half: true, bare: true, caption: "E-postadaki bağlantının açtığı yeni şifre belirleme sayfası.",
    legend: ["<strong>Yeni şifre</strong> — kurallara uygun yeni şifreniz.", "<strong>Yeni şifre (tekrar)</strong> — doğrulama için tekrar.", "<strong>Şifreyi Kaydet</strong> — şifreyi değiştirir."], cols2: true })}
  ${L.info("Sıfırlama bağlantısı sınırlı süre geçerlidir ve yalnızca bir kez kullanılabilir. Süresi dolduysa giriş sayfasından yeni bir bağlantı isteyin.")}

  <h2>Ekranı tanıyın</h2>
  <p>Giriş yaptığınızda ilk olarak <strong>Genel Bakış</strong> sayfasını görürsünüz. Ekran üç ana bölgeden oluşur: soldaki <strong>menü</strong>, üstteki <strong>başlık çubuğu</strong> ve ortadaki <strong>çalışma alanı</strong>.</p>

  ${L.fig("01-genel-bakis", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/customer/dashboard.html", caption: "Genel Bakış sayfası.",
    legend: ["<strong>Menü</strong> — Genel Bakış, Taleplerim ve Profil sayfaları.", "<strong>Bildirim zili</strong> — sizden beklenen işlemler ve yeni gelişmeler.", "<strong>Özet kartları</strong> — aktif, yanıt bekleyen, bu ay çözülen ve toplam talep sayınız.", "<strong>Yeni Talep</strong> — talep formunu açar.", "<strong>Durum rozeti</strong> — talebin güncel aşaması.", "<strong>Hesabınız</strong> — adınız ve ilk harfleriniz.", "<strong>Şifre Değiştir / Çıkış Yap</strong> — menünün altında."], cols2: true })}

  <div class="shot-row">
    ${L.fig("01-menu", { bare: true, nonum: true, caption: "Menü", legend: ["<strong>Genel Bakış</strong> — özet ve son talepler.", "<strong>Taleplerim</strong> — tüm talepler, arama ve filtreler.", "<strong>Profil</strong> — hesap bilgileriniz."] })}
    ${L.fig("01-kullanici-kutusu", { bare: true, nonum: true, caption: "Kullanıcı kutusu", legend: ["<strong>Adınız ve rolünüz</strong>.", "<strong>Şifre Değiştir</strong> — istediğiniz zaman şifrenizi yenileyin.", "<strong>Çıkış Yap</strong> — oturumu kapatır."] })}
  </div>
</section>`;
