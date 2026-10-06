module.exports = (L) => `
<section class="chapter" data-opener="false" data-title="Müşteri ve Kullanıcı Yönetimi"
         data-intro="Firmalar, müşteri ve personel kullanıcı hesapları (oluşturma, giriş bilgileri, roller, şifre) ve danışman kayıtları.">
  <h1>Müşteri ve Kullanıcı Yönetimi</h1>

  <h2>Müşteriler (firmalar)</h2>
  ${L.who("sa", "da")}
  <p>${L.menu("Müşteriler")} sayfasını tüm personel okur; firma oluşturma, düzenleme ve pasife alma yalnızca Süper Admin ve Destek Atayıcı'dadır (diğer rollerde bu düğmeler hiç gösterilmez; sayfalar salt okunurdur). Müşteri tipi <strong>CUS</strong> (destek anlaşmalı) veya <strong>ARC</strong> (arızi müşteri)'dir.</p>
  ${L.fig("a03-musteriler", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/admin/companies.html", caption: "Müşteriler listesi.",
    legend: ["<strong>Yeni Firma</strong>", "<strong>Arama</strong> — ad, kod, iletişim e-postası.", "<strong>Filtre çipleri</strong> — tip (CUS/ARC), sözleşme ve durum.", "<strong>Kayıtlı Kullanıcı</strong> — firmaya bağlı hesap sayısı.", "<strong>Detay</strong>"], cols2: true })}
  ${L.side("a03-yeni-firma", { lc: "60mm", caption: "Yeni Firma penceresi.",
    legend: ["<strong>Firma Adı</strong> * (en az 2 karakter).", "<strong>Müşteri Tipi</strong> *", "<strong>Müşteri Kodu</strong> * — 3 harf + 4 rakam (<code>CUS0001</code>), benzersiz; talep numarasının ikinci bölümüdür.", "<strong>Ana İletişim E-postası</strong>", "<strong>Kaydet</strong>"],
    body: `
      ${L.warn("Ad veya kod sonradan değişse de <strong>mevcut talepler ve kullanıcı profilleri</strong> eski değeri taşır.")}
      ${L.info("Listedeki <strong>sözleşme durumu</strong>, firma düzenlenirken işaretlenen <em>Aktif sözleşme var</em> kutusundan gelir; Sözleşmeler sayfasından hesaplanmaz.")}` })}
  <p>Firma sayfası iletişim bilgilerini, dört özet kartı ve beş sekmeyi (<em>Ticketlar, Efor, Kullanıcılar, Sözleşmeler, Projeler</em>) toplar; <em>Efor</em> sekmesi seçilen ayın efor kayıtlarını talep bazında özetler ve Excel olarak indirir. <strong>Pasife Al</strong>, firmayı Sözleşme/Proje formlarından kaldırır; kullanıcıların girişini <em>engellemez</em>.</p>
  <div style="width:68%;margin:0 auto">${L.fig("a03-firma-detay", { wide: true, caption: "Firma ayrıntısı.",
    legend: ["<strong>Düzenle</strong> — ad, tip, kod, iletişim, <em>Aktif sözleşme var</em>.", "<strong>Pasife Al / Aktive Et</strong>", "<strong>Özet kartları</strong>", "<strong>Ticketlar</strong> sekmesi — firmanın tüm talepleri.", "<strong>Sözleşmeler</strong> sekmesi."], cols2: true })}</div>

  <h2>Muhataplar (kullanıcı hesapları)</h2>
  ${L.who("sa", "da")}
  <p>${L.menu("Muhataplar")} müşteri ve personel hesaplarını listeler; <em>Muhatap Kodu</em> sütunu mevcut sürümde boştur.</p>
  <ul>
    <li>Arama ad, e-posta, firma ve telefonda çalışır (her sözcük ayrı aranır); <strong>rol</strong> ve <strong>durum</strong> çipleri birlikte süzer. <em>Admin</em> çipi Süper Admin ve Destek Atayıcı'yı birlikte getirir.</li>
    <li>Her satırda rol rozeti, kayıt tarihi, son giriş ve aktif/pasif durumu görünür; kullanıcı adı ve <em>Detay</em> ayrıntı sayfasını açar.</li>
  </ul>
  ${L.fig("a03-muhataplar", { wide: true, caption: "Muhataplar listesi (ilk üç kayıt).",
    legend: ["<strong>Yeni Kullanıcı</strong>", "<strong>Arama</strong>", "<strong>Rol çipleri</strong> (altında durum çipleri).", "<strong>Rol rozeti</strong>", "<strong>Detay</strong> — kullanıcı sayfası."], cols2: true })}

  <h3>Yeni kullanıcı oluşturma</h3>
  ${L.side("a03-yeni-kullanici", { lc: "70mm", caption: "Yeni Kullanıcı penceresi.",
    legend: ["<strong>Ad / Soyad</strong> *", "<strong>İş E-postası</strong> * — giriş adı; sonradan değişmez.", "<strong>Telefon</strong> * (en az 10 hane).", "<strong>Firma</strong> — müşteri rollerinde zorunlu; yeni firma da kaydedilebilir.", "<strong>Rol</strong> *", "<strong>Geçici Şifre</strong> * — otomatik üretilir.", "<strong>Üret</strong> — yeni şifre üretir.", "<strong>Oluştur</strong>"],
    body: `
      <p><strong>Roller:</strong> <em>Müşteri Kullanıcısı</em> yalnızca kendi taleplerini görür; <em>Arızi Müşteri</em> sözleşmesiz firma kullanıcısıdır (tip varsayılanı ARZ); <em>Firma Yöneticisi</em> firmasının tüm taleplerini görür ve yanıtlar; personel rolleri Bölüm 1.1'dedir.</p>
      ${L.warn("<strong>Süper Admin</strong> rolünü yalnızca Süper Admin atayabilir; Destek Atayıcı seçerse kayıt veritabanı kuralınca reddedilir. Destek Atayıcı/Süper Admin seçilince <em>Yüksek Yetki Uyarısı</em> görünür.")}` })}
  <ol class="steps">
    <li><h4>Doğrulama</h4><p>E-posta zaten kayıtlıysa form uyarır. Aynı e-posta hem <em>Danışmanlar</em> kaydında hem müşteri hesabında kullanılamaz.</p></li>
    <li><h4>Hesap ve profil</h4><p>Firebase hesabı geçici şifreyle açılır (oturumunuz bozulmaz); profil <em>şifre değişimi zorunlu</em> işaretiyle kaydedilir. Firebase ayrıca bir şifre belirleme e-postası yollar (gönderilemezse sarı uyarı çıkar).</p></li>
    <li><h4>Giriş bilgilerini iletin</h4><p>Geçici şifre <strong>yalnızca</strong> aşağıdaki pencerede görünür; kapatırsanız tekrar görülemez (kaybolursa <em>Şifre Sıfırla</em> kullanın).</p></li>
  </ol>
  <div class="shot-row">
    ${L.fig("a03-kimlik-bilgileri", { bare: true, nonum: true, caption: "Kullanıcı Oluşturuldu penceresi.", legend: ["<strong>E-posta</strong> — giriş adı.", "<strong>Geçici Şifre</strong> — yalnızca burada.", "<strong>Panoya Kopyala</strong> — bilgi ve giriş adresi.", "<strong>E-posta Gönder</strong> — bilgileri kullanıcıya iletir.", "<strong>Tamam</strong>"] })}
    ${L.fig("a03-eposta-kimlik", { bare: true, nonum: true, caption: "“E-posta Gönder” ile giden ileti." })}
  </div>
  ${L.warn("Şifre içeren bu e-posta tarayıcıda saklanıp <strong>sonradan yeniden denenmez</strong>; gönderilemezse (uyarı çıkar) düğmeye yeniden basın. Şifreyi mümkünse ayrıca telefonla iletin.")}

  <h3>Kullanıcı ayrıntısı ve roller</h3>
  ${L.fig("a03-kullanici-detay", { wide: true, caption: "Kullanıcı ayrıntısı (Firma Yöneticisi).",
    legend: ["<strong>Düzenle</strong>", "<strong>Şifre Sıfırla</strong> — sıfırlama e-postası gönderir.", "<strong>Devre Dışı Bırak / Aktive Et</strong>", "<strong>Rol</strong> rozeti.", "<strong>Özet</strong> — talep istatistikleri."], cols2: true })}
  ${L.side("a03-kullanici-duzenle", { lc: "66mm", caption: "Rolü Firma Yöneticisi yapma.",
    legend: ["<strong>Ad / Soyad / Telefon</strong> düzenlenir.", "<strong>E-posta</strong> salt okunur.", "<strong>Rol</strong> — yedi rolden biri.", "<strong>Kaydet</strong>"],
    body: `
      <ul>
        <li><strong>Devre Dışı Bırak</strong> girişi engeller; açık oturum sonraki sayfada kapanır. Kullanıcı <em>silinmez</em>, pasife alınır; talepleri kalır.</li>
        <li><strong>Firma Yöneticisi</strong> için kullanıcının firması olmalıdır (firma bu pencereden değişmez). Rol değişikliği kullanıcının sonraki sayfa yüklemesinde etkinleşir.</li>
        <li>Personel rolündeki hesabın talep alabilmesi, efor girebilmesi ve kişisel bildirim görebilmesi için aynı e-postayla bir <strong>Danışmanlar</strong> kaydı gerekir.</li>
      </ul>` })}
  <div class="shot-row">
    <ul class="checklist" data-title="Yeni danışman">
      <li>Danışmanlar'da personel kaydı açıldı (departman, rol ünvanı).</li>
      <li>Muhataplar'da <strong>aynı e-postayla</strong> kullanıcı oluşturuldu.</li>
      <li>Giriş bilgileri güvenli kanaldan iletildi.</li>
      <li>Gerekli taleplere atama yapıldı.</li>
    </ul>
    <ul class="checklist" data-title="Ayrılan personel">
      <li>Açık talepleri başkasına atandı (toplu devir yok).</li>
      <li>Kullanıcı <em>Devre Dışı Bırak</em> ile pasife alındı.</li>
      <li>Danışman kaydı <em>Pasife Al</em> ile pasife alındı.</li>
    </ul>
  </div>

  <h2>Danışmanlar (personel kayıtları)</h2>
  ${L.who("sa", "da")}
  <p>${L.menu("Danışmanlar")} sayfası taleplere atanabilen personelin kayıt defteridir. <strong>Kullanıcı hesabından ayrıdır:</strong> kayıt açmak giriş yetkisi vermez; ikisi <em>e-posta adresiyle</em> eşleşir. Açık ticket ve efor sütunları yalnızca talebin <em>birincil</em> danışmanına sayılır.</p>
  ${L.fig("a03-personel", { wide: true, caption: "Danışmanlar listesi.",
    legend: ["<strong>Yeni Personel</strong>", "<strong>Arama</strong> — ad, e-posta, bölüm, rol ünvanı.", "<strong>Departman</strong> filtresi.", "<strong>Durum</strong> çipleri.", "<strong>Açık Ticket</strong> — birincil olarak atanmış açık talepler.", "<strong>Detay</strong> — istatistik ve talepler."], cols2: true })}
  ${L.side("a03-yeni-personel", { lc: "66mm", caption: "Yeni Personel penceresi.",
    legend: ["<strong>E-posta</strong> * — hesabın e-postasıyla aynı; benzersiz.", "<strong>Departman</strong> * — Departmanlar sayfasından.", "<strong>Rol Ünvanı</strong> * (ör. SAP FI Danışmanı).", "<strong>Kaydet</strong>"],
    body: `
      <p>Zorunlu alanlar: Ad, Soyad, E-posta, Departman, Rol Ünvanı. Telefon isteğe bağlıdır.</p>
      ${L.info("<strong>Pasife Al</strong> danışmanı yeni atama listelerinden ve iş yükü tablosundan kaldırır; <em>mevcut atamaları</em> korur. Girişini engellemek için kullanıcı hesabını ayrıca pasife alın.")}` })}
</section>`;
