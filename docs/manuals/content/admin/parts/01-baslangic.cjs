module.exports = (L) => `
<section class="chapter" data-title="Başlangıç"
         data-intro="Roller ve yetkiler, personel girişi, ekranın bölümleri ve Genel Bakış sayfasındaki özet kartlar. Bu bölüm, kılavuzun geri kalanında kullanılan temel kavramları tanıtır.">
  <h1>Başlangıç</h1>

  <h2>Roller ve yetkiler</h2>
  <p class="lead">Parla BT tarafında dört personel rolü vardır. Rol, hesabınıza <strong>Muhataplar</strong> sayfasında atanır; hangi işlemleri yapabileceğinizi belirler. Menü dört rolde de aynıdır — roller menüyü değil, sayfaların içindeki işlemleri ve Muhataplar sayfasını sınırlar. Kılavuzda <span class="rb mgr">yönetici roller</span> ifadesi Süper Admin, Destek Atayıcı ve Proje Yöneticisi'ni anlatır.</p>
  <table class="fields">
    <thead><tr><th>Rol</th><th>Ne yapar?</th></tr></thead>
    <tbody>
      <tr><td>${L.rb("sa")}</td><td>Her şeyi görür ve yönetir. Departman, modül ve destek türü tanımlarını, <em>Veri Bakımı</em> aracını ve Süper Admin rolü atamayı yalnızca bu rol yapar.</td></tr>
      <tr><td>${L.rb("da")}</td><td>Günlük operasyonu yürütür: talepleri atar, durum/önceliği değiştirir, talep siler; firma, kullanıcı, danışman ve sözleşme kayıtlarını yönetir; e-posta servisini izler.</td></tr>
      <tr><td>${L.rb("pm")}</td><td>Talepleri Destek Atayıcı gibi yönetir (atama, durum, öncelik, efor) ve proje kayıtlarını düzenler. Kullanıcı/firma/sözleşme yönetemez, talep silemez.</td></tr>
      <tr><td>${L.rb("dn")}</td><td>Kendine atanan taleplerde çalışır (işleme alma, müşteri testi, kapanış onayı isteme, efor). Tüm talepleri görüntüler; atanmadığı talepte durum değiştiremez.</td></tr>
    </tbody>
  </table>

  <h3>Yetki matrisi</h3>
  <p>Matris kodda ve veritabanı kurallarında doğrulanan yetkileri özetler. Yetkisiz bir düğmeye basarsanız işlem <em>“Bu işlem için yetkiniz yok”</em> uyarısıyla durur; yetkinin asıl kaynağı veritabanı kurallarıdır.</p>
  <table class="matrix">
    ${L.mhead}
    <tbody>
      ${L.mgrp("Talepler")}
      ${L.mrow("Tüm talepleri listeleme, arama, dışa aktarma", "yyyy")}
      ${L.mrow("Yeni talep oluşturma", "yypp", "Muhatap seçimi ve yeni firma kaydı yalnızca Süper Admin / Destek Atayıcı'da çalışır.")}
      ${L.mrow("Admin Paneli: durum, öncelik, danışman atama", "yyyn", "Danışman yalnızca <em>Hızlı İşlemler</em>'i görür.")}
      ${L.mrow("Hızlı işlemler (İşleme Al, Müşteri Testi, Kapanış Onayı İste, İşleme Geri Al)", "yyyp", "Danışman: yalnızca kendisine atanmış talepte.")}
      ${L.mrow("Müşteri Adına Kapat, Kapat, Yeniden Aç", "yyyn")}
      ${L.mrow("Yanıt yazma, iç not, dosya ekleme", "yyyy")}
      ${L.mrow("Efor ekleme / silme", "yyyp", "Silme yalnızca yöneticilerde; Danışman yalnızca atandığı talepte efor ekler.")}
      ${L.mrow("Talep silme", "yynn")}
      ${L.mgrp("Müşteri ve kullanıcılar")}
      ${L.mrow("Muhataplar: kullanıcı oluşturma, düzenleme, şifre sıfırlama, pasife alma", "yynn", "Diğer roller sayfayı açamaz; Genel Bakış'a yönlendirilir.")}
      ${L.mrow("Süper Admin rolü atama", "ynnn")}
      ${L.mrow("Firma, danışman (personel) ve sözleşme kayıtları", "yynn", "Sayfaları tüm personel okur; yazma yalnızca Süper Admin / Destek Atayıcı.")}
      ${L.mgrp("Tanımlar ve izleme")}
      ${L.mrow("Proje kayıtları", "yyyn")}
      ${L.mrow("Departman, Modül, Destek Türü tanımları", "ynnn")}
      ${L.mrow("Genel Bakış, Raporlar, Aktiviteler, bildirim zili", "yyyy")}
      ${L.mrow("E-posta Servisi kartı (durum, test e-postası)", "yynn")}
      ${L.mrow("Veri Bakımı kartı", "ynnn")}
    </tbody>
  </table>
  ${L.mlegend}

  <h2>Giriş ve ilk adımlar</h2>
  ${L.side("a01-giris", { lc: "74mm", caption: "Personel girişi.",
    legend: ["<strong>E-posta</strong> — hesabınıza tanımlı adres.", "<strong>Şifre</strong> — göz simgesi gösterir/gizler.", "<strong>Giriş Yap</strong>", "<strong>Şifremi Unuttum</strong> — sıfırlama e-postası yollar.", "<strong>Sistem Adminleri Kılavuzu</strong> — bu PDF'i <em>Aç</em> veya <em>İndir</em>."],
    body: `
      <p>Personel hesabı <strong>Muhataplar</strong> sayfasından açılır (Bölüm 3); kendi kendinize kayıt olamazsınız. Size e-posta adresiniz ve bir <strong>geçici şifre</strong> iletilir.</p>
      <ul>
        <li>Adres: <strong>www.parlabilgiteknolojileri.net/support</strong> (otomatik giriş sayfasına yönlenir).</li>
        <li>Geçici şifreyle ilk girişte <strong>Şifrenizi belirleyin</strong> sayfası açılır: en az 8 karakter, 1 büyük harf, 1 rakam; geçici şifreden farklı olmalı. Tamamlanmadan başka sayfa açılmaz.</li>
        <li>Girişten sonra personel rolleri <strong>Genel Bakış</strong>'a gider; müşteri sayfalarını açmaya çalışırsanız yönetici sayfasına döndürülürsünüz.</li>
      </ul>
      ${L.warn("Pasif hesaplar giriş yapamaz (“Hesabınız aktif değil”); pasife alınan kullanıcının açık oturumu da sonraki sayfada kapanır.")}` })}

  <h2>Ekranı tanıyın</h2>
  <p>Her sayfa soldaki <strong>menü</strong>, üstteki <strong>başlık çubuğu</strong> ve ortadaki <strong>çalışma alanı</strong>ndan oluşur. Menünün altında adınız, rolünüz, <em>Şifre Değiştir</em> ve <em>Çıkış Yap</em> bulunur.</p>
  ${L.fig("a01-genel-bakis", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/admin/dashboard.html", caption: "Genel Bakış (Süper Admin görünümü).",
    legend: ["<strong>Menü</strong> — tüm personel sayfaları.", "<strong>Kılavuz</strong> — bu PDF'i yeni sekmede açar.", "<strong>Bildirim zili</strong> — size özel uyarılar (Bölüm 5.3).", "<strong>Özet kartları</strong> — açık, kritik, atanmamış, SLA.", "<strong>SLA Aşımı</strong> — hedefi aşılmış açık talepler.", "<strong>Ticket Tipi Dağılımı</strong>", "<strong>Son Aktiviteler</strong> — son 20 kayıt.", "<strong>Hesabınız</strong> — adınız."], cols2: true })}
  <table class="fields">
    <thead><tr><th>Menü öğesi</th><th>Ne işe yarar?</th><th>Bölüm</th></tr></thead>
    <tbody>
      <tr><td>Genel Bakış · Ticketlar</td><td>Özet kartlar ve iş yükü · tüm taleplerin listesi ve ayrıntısı.</td><td>1.4 · 2</td></tr>
      <tr><td>Aktiviteler</td><td>Değişmez denetim günlüğü; e-posta hataları da burada.</td><td>5.2</td></tr>
      <tr><td>Muhataplar ${L.rb("sa")}${L.rb("da")}</td><td>Müşteri ve personel kullanıcı hesapları.</td><td>3.2</td></tr>
      <tr><td>Müşteriler · Sözleşmeler · Projeler</td><td>Firma, sözleşme ve proje kayıtları.</td><td>3.1 · 4</td></tr>
      <tr><td>Yönetim: Departmanlar, Modüller, Danışmanlar, Destek Türleri, Raporlar</td><td>Tanım listeleri, personel kayıtları ve raporlar.</td><td>3.3 · 4.3 · 5.1</td></tr>
      <tr><td>Kılavuzlar</td><td>Sistem Adminleri ve Kullanıcı kılavuzu PDF'leri (aç / indir).</td><td>—</td></tr>
    </tbody>
  </table>

  <h2>Genel Bakış sayfası</h2>
  <p>Kartlar <strong>tüm talepler</strong> üzerinden hesaplanır (yalnızca sizin taleplerinizle sınırlı değildir).</p>
  <table class="fields">
    <thead><tr><th>Kart</th><th>Neyi sayar?</th></tr></thead>
    <tbody>
      <tr><td>Toplam Açık · Kritik</td><td>Çözüldü/Kapandı olmayan tüm talepler (Kapanış Onayı ve Müşteri Bekleniyor dahil) · bunların içinde önceliği Kritik olanlar.</td></tr>
      <tr><td>Bugün Açılan · Bugün Kapanan</td><td>Bugün oluşturulan · bugün kapanan talepler.</td></tr>
      <tr><td>Atanmamış</td><td>Açık ve henüz danışman atanmamış talepler.</td></tr>
      <tr><td>SLA Aşımı</td><td>İlk yanıt veya çözüm hedefi aşılmış açık talepler (<em>Müşteri Bekleniyor</em> hariç; Bölüm 2.7).</td></tr>
      <tr><td>Bu Ay Çözülen · Ort. Çözüm Süresi</td><td>Bu ay Çözüldü/Kapandı olanlar · çözülmüş/kapanmış taleplerde oluşturma–çözüm arası ortalama.</td></tr>
    </tbody>
  </table>
  <p>Kartların altında <strong>Danışman İş Yükü</strong> (aktif danışman başına açık talep, kritik talep ve toplam efor; yalnızca <em>birincil</em> danışman sayılır), <strong>E-posta Servisi</strong> ve <strong>Veri Bakımı</strong> kartları (Bölüm 6) ile en yeni 10 <strong>Atanmamış Ticket</strong> bulunur.</p>
  ${L.fig("a01-is-yuku", { wide: true, caption: "Danışman İş Yükü ve Atanmamış Ticketlar.",
    legend: ["<strong>Danışman İş Yükü</strong> — kim ne kadar işle meşgul.", "<strong>Ata</strong> — danışman seçme penceresini açar: kişi tek ve birincil danışman olur, talep <em>Atandı</em>'ya geçer, ona e-posta gider (işlemi yapana gitmez). Düğme yönetici rollerde (Süper Admin, Destek Atayıcı, Proje Yöneticisi) görünür; Danışman rolünde yerine <em>Aç</em> bağlantısı gelir. Çoklu atama için Admin Paneli (Bölüm 2.3).", "<strong>Tümünü Gör</strong> — Ticketlar listesini “Sadece atanmamış” filtresiyle açar."] })}
</section>`;
