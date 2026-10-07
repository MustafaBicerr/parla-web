module.exports = (L) => `
<section class="chapter" data-title="Başlangıç"
         data-intro="Roller ve yetkiler, personel girişi, ekranın bölümleri ve Genel Bakış sayfasındaki özet kartlar. Bu bölüm, kılavuzun geri kalanında kullanılan temel kavramları tanıtır.">
  <h1>Başlangıç</h1>

  <h2>Roller ve yetkiler</h2>
  <p class="lead">Parla BT tarafında dört personel rolü vardır. Rol, hesabınıza <strong>Kullanıcılar</strong> sayfasında atanır; hangi işlemleri yapabileceğinizi belirler. Menü dört rolde de aynıdır — roller menüyü değil, sayfaların içindeki işlemleri ve Kullanıcılar sayfasını sınırlar. Kılavuzda <span class="rb mgr">yönetici roller</span> ifadesi Süper Admin, Destek Atayıcı ve Proje Yöneticisi'ni anlatır.</p>
  <table class="fields">
    <thead><tr><th>Rol</th><th>Ne yapar?</th></tr></thead>
    <tbody>
      <tr><td>${L.rb("sa")}</td><td>Her şeyi görür ve yönetir. Departman, modül ve destek türü tanımlarını, <em>Veri Bakımı</em> aracını, Süper Admin ve Destek Atayıcı rolü atamayı ve arşivdeki talepleri <strong>kalıcı silmeyi</strong> yalnızca bu rol yapar.</td></tr>
      <tr><td>${L.rb("da")}</td><td>Günlük operasyonu yürütür: talepleri atar, durum/önceliği değiştirir, toplu işlem yapar, talebi arşive alır ve geri yükler; firma, kullanıcı (müşteri rolleri, danışman, proje yöneticisi), danışman, sözleşme (bedel dahil) ve hazır yanıt kayıtlarını yönetir; e-posta servisini izler.</td></tr>
      <tr><td>${L.rb("pm")}</td><td>Talepleri Destek Atayıcı gibi yönetir (atama, durum, öncelik, efor, toplu işlem) ve proje kayıtlarını düzenler. Kullanıcı/firma/sözleşme yönetemez, sözleşme bedelini göremez, talep silemez.</td></tr>
      <tr><td>${L.rb("dn")}</td><td><strong>Tüm talepleri görüntüler</strong> ama yalnızca <strong>kendisine atanan</strong> talepte yazar (yanıt, iç not, işleme alma, müşteri testi, kapanış onayı isteme, efor). Atanmadığı talepte yazma denemesini veritabanı kuralları da reddeder.</td></tr>
    </tbody>
  </table>

  <h3>Yetki matrisi</h3>
  <p>Matris kodda ve veritabanı kurallarında doğrulanan yetkileri özetler. Yetkisiz düğmeler çoğu sayfada hiç gösterilmez; yine de basılırsa işlem <em>“Bu işlem için yetkiniz yok”</em> uyarısıyla durur. Yetkinin asıl kaynağı veritabanı kurallarıdır: arayüz atlansa bile, danışman başkasının talebine yazamaz, PM sözleşme bedelini okuyamaz.</p>
  <table class="matrix">
    ${L.mhead}
    <tbody>
      ${L.mgrp("Talepler")}
      ${L.mrow("Tüm talepleri listeleme, arama, dışa aktarma", "yyyy", "Danışman dahil her personel rolü tüm talepleri okur; CSV/Excel dışa aktarma süzülmüş listeyi verir.")}
      ${L.mrow("Yeni talep oluşturma", "yypp", "Muhatap seçimi ve yeni firma kaydı yalnızca Süper Admin / Destek Atayıcı'da çalışır. PRJ talebinde proje seçimi zorunludur.")}
      ${L.mrow("Admin Paneli: durum, öncelik, talep tipi, proje, danışman atama", "yyyn", "Danışman yalnızca <em>Hızlı İşlemler</em>'i görür.")}
      ${L.mrow("Hızlı işlemler (İşleme Al, Müşteri Testi, Kapanış Onayı İste, İşleme Geri Al)", "yyyp", "Danışman: yalnızca kendisine atanmış talepte.")}
      ${L.mrow("Müşteri Adına Kapat, Kapat, Yeniden Aç", "yyyn")}
      ${L.mrow("Yanıt yazma, iç not, dosya ekleme", "yyyp", "Danışman: yalnızca atandığı talepte.")}
      ${L.mrow("Efor ekleme / silme", "yyyp", "Danışman yalnızca atandığı talepte efor ekler; efor silmeyi yöneticiler ve girenin kendisi yapar.")}
      ${L.mrow("Toplu atama, toplu durum değişikliği (en çok 300 talep)", "yyyn")}
      ${L.mrow("Talebi arşive alma (yumuşak silme) ve geri yükleme", "yynn")}
      ${L.mrow("Arşivdeki talebi kalıcı silme", "ynnn", "Mesaj, iç not, ek, geçmiş, atama ve eforlarıyla birlikte; geri alınamaz.")}
      ${L.mgrp("Müşteri ve kullanıcılar")}
      ${L.mrow("Kullanıcılar: oluşturma/davet, düzenleme, şifre bağlantısı, pasife alma, yetim hesap onarma", "yynn", "Diğer roller sayfayı açamaz; Genel Bakış'a yönlendirilir. Firma Yöneticisi (müşteri rolü) de kullanıcı yönetemez.")}
      ${L.mrow("Süper Admin / Destek Atayıcı rolü atama", "ynnn", "Destek Atayıcı yalnızca müşteri rollerini, Danışman'ı ve Proje Yöneticisi'ni atayabilir.")}
      ${L.mrow("Firma, danışman (personel) ve sözleşme kayıtları", "yynn", "Sayfaları tüm personel okur; yazma yalnızca Süper Admin / Destek Atayıcı.")}
      ${L.mrow("Sözleşme bedelini (₺) görme ve yazma", "yynn", "Bedel ayrı bir düğümde tutulur; Proje Yöneticisi ve Danışman bedel sütununu/alanını hiç görmez.")}
      ${L.mgrp("Tanımlar ve izleme")}
      ${L.mrow("Proje kayıtları", "yyyn")}
      ${L.mrow("Hazır yanıt şablonlarını kullanma / düzenleme", "yyyn", "Şablonu yanıt kutusunda tüm personel kullanır; şablon sayfasında ekleme/düzenleme/silme yalnızca Süper Admin ve Destek Atayıcı'dadır.")}
      ${L.mrow("Departman tanımları; Modül ve Destek Türü referans listeleri", "ynnn", "Modül ve Destek Türü listeleri salt-okunur referanstır (Bölüm 4.3).")}
      ${L.mrow("Genel Bakış, Raporlar, Aktiviteler, bildirim zili", "yyyy")}
      ${L.mrow("E-posta Servisi kartı (durum, test e-postası)", "yynn")}
      ${L.mrow("Veri Bakımı kartı", "ynnn")}
    </tbody>
  </table>
  ${L.mlegend}

  <h2>Giriş ve ilk adımlar</h2>
  ${L.side("a01-giris", { lc: "74mm", caption: "Personel girişi.",
    legend: ["<strong>E-posta</strong> — hesabınıza tanımlı adres.", "<strong>Şifre</strong> — göz simgesi gösterir/gizler.", "<strong>Giriş Yap</strong>", "<strong>Şifremi Unuttum</strong> — sıfırlama e-postası yollar."],
    body: `
      <p>Personel hesabı <strong>Kullanıcılar</strong> sayfasından açılır (Bölüm 3); kendi kendinize kayıt olamazsınız. Hesap açıldığında adresinize <strong>şifre içermeyen</strong> bir davet e-postası gelir; şifrenizi e-postadaki bağlantıyla kendiniz belirlersiniz.</p>
      <ul>
        <li>Adres: <strong>www.parlabilgiteknolojileri.net/support</strong> (otomatik giriş sayfasına yönlenir).</li>
        <li>Davet e-postasındaki bağlantı <strong>Yeni Şifre Belirle</strong> sayfasını açar (en az 8 karakter, 1 büyük harf, 1 rakam; bağlantı kısa süre geçerli ve tek kullanımlık). Hesap geçici şifreyle açıldıysa (servis hesabı tanımlı değilse) ilk girişte <strong>Şifrenizi belirleyin</strong> sayfası açılır ve tamamlanmadan başka sayfa açılmaz.</li>
        <li>Personel oturumu <strong>8 saat</strong> işlem yapılmazsa güvenlik gereği kapanır (müşteri hesaplarında 30 gün); yeniden giriş yapmanız yeterlidir.</li>
        <li>Bu kılavuza personel olarak kenar menüdeki <em>Kılavuzlar</em> bölümünden ya da üst çubuktaki <em>Kılavuz</em> düğmesinden ulaşırsınız; giriş sayfasında yalnızca Kullanıcı Kılavuzu listelenir.</li>
        <li>Girişten sonra personel rolleri <strong>Genel Bakış</strong>'a gider; müşteri sayfalarını açmaya çalışırsanız yönetici sayfasına döndürülürsünüz.</li>
      </ul>
      ${L.warn("Pasif hesaplar giriş yapamaz (“Hesabınız aktif değil”); pasife alınan kullanıcının açık oturumu da sonraki sayfada kapanır.")}` })}

  <h2>Ekranı tanıyın</h2>
  <p>Her sayfa soldaki <strong>menü</strong>, üstteki <strong>başlık çubuğu</strong> ve ortadaki <strong>çalışma alanı</strong>ndan oluşur. Menünün altında adınız, rolünüz, <em>Şifre Değiştir</em> ve <em>Çıkış Yap</em> bulunur.</p>
  ${L.fig("a01-genel-bakis", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/admin/dashboard.html", caption: "Genel Bakış (Süper Admin görünümü).",
    legend: ["<strong>Menü</strong> — tüm personel sayfaları.", "<strong>Kılavuz</strong> — bu PDF'i yeni sekmede açar.", "<strong>Bildirim zili</strong> — size özel uyarılar (Bölüm 5.3).", "<strong>Özet kartları</strong> — açık, kritik, atanmamış, SLA.", "<strong>SLA Aşımı</strong> — hedefi aşılmış açık talepler.", "<strong>Talep Tipi Dağılımı</strong>", "<strong>Son Aktiviteler</strong> — son 20 kayıt.", "<strong>Hesabınız</strong> — adınız."], cols2: true })}
  <table class="fields">
    <thead><tr><th>Menü öğesi</th><th>Ne işe yarar?</th><th>Bölüm</th></tr></thead>
    <tbody>
      <tr><td>Genel Bakış · Talepler</td><td>Özet kartlar ve iş yükü · tüm taleplerin listesi ve ayrıntısı.</td><td>1.4 · 2</td></tr>
      <tr><td>Aktiviteler</td><td>Değişmez denetim günlüğü; e-posta hataları da burada.</td><td>5.2</td></tr>
      <tr><td>Kullanıcılar ${L.rb("sa")}${L.rb("da")}</td><td>Müşteri ve personel kullanıcı hesapları (davet, onarım, pasife alma).</td><td>3.2</td></tr>
      <tr><td>Müşteriler · Sözleşmeler · Projeler</td><td>Firma, sözleşme ve proje kayıtları.</td><td>3.1 · 4</td></tr>
      <tr><td>Yönetim: Departmanlar, Modüller, Danışmanlar, Destek Türleri, Hazır Yanıtlar, Raporlar</td><td>Tanım listeleri, danışman kayıtları, hazır yanıt şablonları ve raporlar.</td><td>3.3 · 4.3 · 5.1</td></tr>
      <tr><td>Kılavuzlar</td><td>Sistem Adminleri ve Kullanıcı kılavuzu PDF'leri (aç / indir). Dar ekranlarda menü sol üstteki düğmeden açılır ve tablolar kart görünümüne geçer.</td><td>—</td></tr>
    </tbody>
  </table>

  <h2>Genel Bakış sayfası</h2>
  <p>Kartlar <strong>tüm talepler</strong> üzerinden hesaplanır (yalnızca sizin taleplerinizle sınırlı değildir).</p>
  <table class="fields">
    <thead><tr><th>Kart</th><th>Neyi sayar?</th></tr></thead>
    <tbody>
      <tr><td>Toplam Açık · Kritik</td><td>Çözüldü/Kapandı olmayan tüm talepler (Kapanış Onayı ve Müşteri Bekleniyor dahil) · bunların içinde önceliği Kritik olanlar.</td></tr>
      <tr><td>Bugün Açılan · Bugün Kapanan</td><td>Bugün oluşturulan · bugün kapanan talepler.</td></tr>
      <tr><td>Atanmamış · Pasif Danışmanda</td><td>Açık ve henüz danışman atanmamış talepler · atandığı tüm danışmanlar pasif olan (sahipsiz) açık talepler: yeniden atanmalıdır.</td></tr>
      <tr><td>SLA Aşımı</td><td>İlk yanıt veya çözüm hedefinden biri aşılmış açık talepler (aşım damgası kalıcıdır; öncelik düşürmek veya duraklama aşımı silmez; Bölüm 2.7).</td></tr>
      <tr><td>Bu Ay Çözülen · Ort. Çözüm Süresi</td><td>Çözüm zamanı bu aya düşen Çözüldü/Kapandı talepler · oluşturma ile çözüm (kapanış onayına ilk geçiş ya da kapanış) arasındaki ortalama süre; <em>6,7 gün</em> gibi virgüllü gösterilir. Raporlar sayfası aynı tanımı kullanır.</td></tr>
    </tbody>
  </table>
  <p>Kartların altında <strong>Danışman İş Yükü</strong> (aktif danışman başına açık talep, kritik talep ve toplam efor; yalnızca <em>birincil</em> danışman sayılır), <strong>E-posta Servisi</strong> ve <strong>Veri Bakımı</strong> kartları (Bölüm 6) ile en yeni 10 <strong>Atanmamış / Sahipsiz Talep</strong> bulunur.</p>
  ${L.fig("a01-is-yuku", { wide: true, caption: "Danışman İş Yükü ve Atanmamış / Sahipsiz Talepler.",
    legend: ["<strong>Danışman İş Yükü</strong> — kim ne kadar işle meşgul.", "<strong>Ata</strong> — danışman seçme penceresini açar: kişi tek ve birincil danışman olur, talep <em>Atandı</em>'ya geçer, ona e-posta gider (işlemi yapana gitmez). Düğme yönetici rollerde (Süper Admin, Destek Atayıcı, Proje Yöneticisi) görünür; Danışman rolünde yerine <em>Aç</em> bağlantısı gelir. Çoklu atama için Admin Paneli (Bölüm 2.3).", "<strong>Tümünü Gör</strong> — Talepler listesini “Atanmamış / sahipsiz” filtresiyle açar."] })}
</section>`;
