module.exports = (L) => `
<section class="chapter cont" data-opener="false" data-title="Firma Yöneticisi ve Hesabınız"
         data-intro="Firma yöneticisi rolüne sahipseniz firmanızın tüm taleplerini nasıl izleyeceğinizi; herkesin ise profil sayfasını, şifre yönetimini ve güvenli kullanım ipuçlarını burada bulursunuz.">
  <h1>Firma Yöneticisi ve Hesabınız</h1>

  <h2>Firma yöneticisi görünümü</h2>
  <p>Hesabınızın rolü <strong>Firma Yöneticisi</strong> ise Taleplerim sayfası <strong>Firma Talepleri</strong> olarak açılır ve yalnızca kendi taleplerinizi değil, firmanızın tüm kullanıcılarının taleplerini listeler. Böylece firmanızdaki konuları tek yerden izler, gerekirse meslektaşlarınız adına yanıt verir veya çözümü onaylarsınız.</p>

  ${L.fig("06-firma-talepleri", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/customer/tickets.html", caption: "Firma yöneticisinin talep listesi.",
    legend: ["<strong>Firma Talepleri</strong> — firmanın tüm talepleri.", "<strong>Talep Sahibi</strong> — talebi açan kullanıcı (yalnızca firma yöneticisinde görünür).", "<strong>Arama</strong> — talep sahibinin adıyla da arar."] })}

  <table class="fields">
    <thead><tr><th>İşlem</th><th>Müşteri Kullanıcısı</th><th>Firma Yöneticisi</th></tr></thead>
    <tbody>
      <tr><td>Kendi taleplerini görme</td><td>Evet</td><td>Evet</td></tr>
      <tr><td>Firmadaki diğer kullanıcıların taleplerini görme</td><td>Hayır</td><td><strong>Evet</strong></td></tr>
      <tr><td>Talep açma, yanıtlama, dosya ekleme</td><td>Evet (kendi talepleri)</td><td>Evet (firmanın tüm talepleri)</td></tr>
      <tr><td>Kapanış onayı verme / yeniden açma</td><td>Evet (kendi talepleri)</td><td>Evet (firmanın tüm talepleri)</td></tr>
      <tr><td>Dahili (personel) notlarını görme</td><td>Hayır</td><td>Hayır</td></tr>
    </tbody>
  </table>
  ${L.info("Firma yöneticisi rolünü Parla BT atar. Yeni bir yönetici belirlemek veya rolü değiştirmek için destek ekibimize e-posta gönderin.")}

  <h2>Profiliniz</h2>
  <p>${L.menu("Profil")} sayfası hesap bilgilerinizi ve talep istatistiklerinizi gösterir. Bilgiler salt okunurdur; ad, telefon veya firma bilgilerinizde değişiklik gerekiyorsa Parla BT destek ekibine bildirin.</p>
  ${L.fig("07-profil", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/customer/profile.html", caption: "Profil sayfası.",
    legend: ["<strong>Profil Bilgileri</strong> — ad soyad, e-posta, telefon, rol, firma, müşteri kodu, son giriş ve hesap durumu.", "<strong>Talep İstatistikleri</strong> — toplam, aktif ve çözülen talep sayısı.", "<strong>Şifre Değiştir</strong> — menünün altından erişilir."] })}

  <h3>Şifrenizi değiştirme</h3>
  ${L.steps([
    ["Şifre Değiştir'e tıklayın", `<p>Menünün altındaki ${L.btn("Şifre Değiştir", "secondary")} düğmesine tıklayın.</p>`],
    ["Bilgileri girin", `<p>${L.field("Mevcut şifre")}, ${L.field("Yeni şifre")} ve ${L.field("Yeni şifre (tekrar)")} alanlarını doldurun. Yeni şifre en az 8 karakter olmalı; en az bir büyük harf ve bir rakam içermelidir.</p>`],
    ["Kaydedin", `<p>${L.btn("Şifreyi Güncelle")} düğmesine tıklayın. Güvenlik nedeniyle işlem için mevcut şifrenizi yeniden doğrulamanız gerekir.</p>`],
  ])}

  <h2>Güvenli kullanım</h2>
  <div class="cards">
    <div class="card"><div class="ico" data-ico="key-round"></div><h4>Şifrenizi koruyun</h4><p>Şifrenizi kimseyle paylaşmayın, bir yere not etmeyin; başka sitelerde kullandığınız şifreleri kullanmayın.</p></div>
    <div class="card blue"><div class="ico" data-ico="log-out"></div><h4>Oturumu kapatın</h4><p>Ortak veya paylaşılan bilgisayarlarda işiniz bitince mutlaka <em>Çıkış Yap</em>'a tıklayın.</p></div>
    <div class="card amber"><div class="ico" data-ico="paperclip"></div><h4>Hassas veri eklemeyin</h4><p>Mesaj ve ekran görüntülerinde şifre, TC kimlik numarası, maaş bilgisi gibi verileri gizleyin.</p></div>
  </div>
  ${L.warn("Parla BT çalışanları sizden hiçbir zaman şifrenizi istemez. Şifrenizi isteyen bir e-posta veya telefon aldıysanız yanıt vermeyin ve bize bildirin.")}
</section>`;
