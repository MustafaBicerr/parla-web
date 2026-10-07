module.exports = (L) => `
<section class="chapter" data-opener="false" data-title="Müşteri ve Kullanıcı Yönetimi"
         data-intro="Firmalar, müşteri ve personel kullanıcı hesapları (davet, yetim hesap onarma, roller, şifre bağlantısı) ve danışman kayıtları.">
  <h1>Müşteri ve Kullanıcı Yönetimi</h1>

  <h2>Müşteriler (firmalar)</h2>
  ${L.who("sa", "da")}
  <p>${L.menu("Müşteriler")} sayfasını tüm personel okur; firma oluşturma, düzenleme ve pasife alma yalnızca Süper Admin ve Destek Atayıcı'dadır (diğer rollerde bu düğmeler hiç gösterilmez; sayfalar salt okunurdur). Müşteri tipi <strong>CUS</strong> (destek anlaşmalı) veya <strong>ARC</strong> (arızi müşteri)'dir; <strong>müşteri tipi, kullanıcıların açabileceği talep tiplerini belirler</strong> (CUS → SUP/BUG, ARC → ARZ/BUG).</p>
  ${L.fig("a03-musteriler", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/admin/companies.html", caption: "Müşteriler listesi.",
    legend: ["<strong>Yeni Firma</strong>", "<strong>Arama</strong> — ad, kod, iletişim e-postası.", "<strong>Filtre çipleri</strong> — tip (CUS/ARC), sözleşmeli ve durum.", "<strong>Kayıtlı Kullanıcı</strong> — firmaya bağlı hesap sayısı.", "<strong>Detay</strong>"], cols2: true })}
  ${L.side("a03-yeni-firma", { lc: "60mm", caption: "Yeni Firma penceresi.",
    legend: ["<strong>Firma Adı</strong> * (en az 2 karakter).", "<strong>Müşteri Tipi</strong> *", "<strong>Müşteri Kodu</strong> * — 3 harf + 4 rakam (<code>CUS0001</code>), <strong>benzersiz</strong>; talep numarasının ikinci bölümüdür.", "<strong>Ana İletişim E-postası</strong>", "<strong>Kaydet</strong>"],
    body: `
      ${L.info("Firma <strong>adı veya kodu</strong> sonradan değiştirilirse, o firmaya bağlı kullanıcı, talep, sözleşme ve proje kayıtlarındaki ad/kod <em>kopyaları</em> da otomatik eşitlenir (işlem sonunda kaç kayıt güncellendiği bildirilir). <strong>Mevcut talep numaraları değişmez.</strong> Kopyaların bir kısmı güncellenemezse uyarı çıkar; düzenlemeyi yeniden kaydedin.")}
      ${L.info("Listedeki <strong>Sözleşmeli</strong> rozeti elle işaretlenmez; firmanın <em>Sözleşmeler</em> kayıtlarından (etkin durumuyla) hesaplanır. Sözleşme eklemek veya bitirmek rozeti kendiliğinden günceller.")}` })}
  <p>Firma sayfası iletişim bilgilerini, özet kartlarını (<em>Aktif Kullanıcı, Açık Talep, Toplam Talep, Aktif Sözleşme</em>) ve sekmeleri (<em>Talepler, Efor, Kullanıcılar, Sözleşmeler, Projeler</em>) toplar. <em>Kullanıcılar</em> sekmesi ve kullanıcı sayıları yalnızca Süper Admin / Destek Atayıcı'ya görünür; <em>Sözleşmeler</em> sekmesindeki <em>Değer (₺)</em> sütunu da öyle. <em>Efor</em> sekmesi seçilen ayın efor kayıtlarını talep bazında özetler ve Excel olarak indirir. <strong>Pasife Al</strong>, firmayı Sözleşme/Proje/Talep formlarındaki seçicilerden kaldırır ve <strong>firma kullanıcılarının yeni talep açmasını engeller</strong>; kullanıcılar giriş yapmaya ve mevcut taleplerini görmeye devam eder, açık talepler etkilenmez.</p>
  <div style="width:68%;margin:0 auto">${L.fig("a03-firma-detay", { wide: true, caption: "Firma ayrıntısı.",
    legend: ["<strong>Düzenle</strong> — ad, tip, kod, iletişim, adres.", "<strong>Pasife Al / Aktive Et</strong>", "<strong>Özet kartları</strong>", "<strong>Talepler</strong> sekmesi — firmanın tüm talepleri.", "<strong>Sözleşmeler</strong> sekmesi."], cols2: true })}</div>

  <h2>Kullanıcılar (hesap yönetimi)</h2>
  ${L.who("sa", "da")}
  <p>${L.menu("Kullanıcılar")} müşteri ve personel hesaplarını listeler. Sayfayı yalnızca Süper Admin ve Destek Atayıcı açabilir; <strong>Firma Yöneticisi dahil müşteri rolleri kullanıcı yönetemez</strong>. Hesap işlemleri (oluşturma, onarma, pasife alma, şifre bağlantısı) bir <em>sunucu işlevi</em> üzerinden yapılır; işlev yoksa sayfa uyarıyla eski, tarayıcı tabanlı akışa döner (aşağıda).</p>
  <ul>
    <li>Arama ad, e-posta, firma ve telefonda çalışır (her sözcük ayrı aranır); <strong>rol</strong> ve <strong>durum</strong> çipleri birlikte süzer. <em>Admin</em> çipi Süper Admin ve Destek Atayıcı'yı birlikte getirir.</li>
    <li>Her satırda rol rozeti, kayıt tarihi, son giriş ve aktif/pasif durumu görünür; kullanıcı adı ve <em>Detay</em> ayrıntı sayfasını açar.</li>
  </ul>
  ${L.fig("a03-kullanicilar", { wide: true, caption: "Kullanıcılar listesi (ilk üç kayıt).",
    legend: ["<strong>Yetim Hesabı Onar</strong> — yarım kalmış hesabı kurtarır (aşağıda).", "<strong>Yeni Kullanıcı</strong>", "<strong>Arama</strong>", "<strong>Rol çipleri</strong> (altında durum çipleri).", "<strong>Rol rozeti</strong>", "<strong>Detay</strong> — kullanıcı sayfası."], cols2: true })}

  <h3>Yeni kullanıcı oluşturma (davet)</h3>
  ${L.side("a03-yeni-kullanici", { lc: "70mm", caption: "Yeni Kullanıcı penceresi (sunucu işlevi tanımlıyken).",
    legend: ["<strong>Ad / Soyad</strong> *", "<strong>İş E-postası</strong> * — giriş adı; sonradan değişmez.", "<strong>Telefon</strong> * (ülke kodu ve hane sayısı denetlenir).", "<strong>Firma</strong> — müşteri rollerinde zorunlu; yeni firma da kaydedilebilir.", "<strong>Rol</strong> * — yetkinize göre listelenir.", "<strong>Parola belirlemeden davet gönder</strong> — varsayılan ve önerilen; işaret kalkarsa geçici şifre alanı açılır.", "<strong>Oluştur</strong>"],
    body: `
      <p><strong>Roller:</strong> <em>Müşteri Kullanıcısı</em> yalnızca kendi taleplerini görür; <em>Arızi Müşteri</em> sözleşmesiz firma kullanıcısıdır; <em>Firma Yöneticisi</em> firmasının tüm taleplerini görür ve yanıtlar (kullanıcı yönetemez); personel rolleri Bölüm 1.1'dedir. Destek Atayıcı yalnızca müşteri rollerini, Danışman'ı ve Proje Yöneticisi'ni verebilir.</p>
      ${L.warn("<strong>Süper Admin</strong> ve <strong>Destek Atayıcı</strong> rollerini yalnızca Süper Admin atayabilir; bu rollerin hesaplarını da yalnızca Süper Admin yönetir. Bu roller seçilince <em>Yüksek Yetki Uyarısı</em> görünür.")}` })}
  <ol class="steps">
    <li><h4>Doğrulama</h4><p>E-posta zaten kayıtlıysa form uyarır. Aynı e-posta hem <em>Danışmanlar</em> kaydında hem müşteri hesabında kullanılamaz.</p></li>
    <li><h4>Hesap ve profil (tek işlem)</h4><p>Sunucu işlevi Firebase hesabını ve portal profilini <strong>tek işlemde</strong> açar; profil yazılamazsa hesabı geri alır (yarım kayıt kalmaz). Oturumunuz bozulmaz.</p></li>
    <li><h4>Davet e-postası</h4><p>Kullanıcıya <strong>şifre içermeyen</strong> bir e-posta gider; düğme, kullanıcının kendi şifresini belirlediği sayfayı açar (bağlantı kısa süreli ve tek kullanımlıktır). Personel rolü (Danışman, Proje Yöneticisi) için aynı e-postalı <em>Danışmanlar</em> kaydı varsa otomatik eşleştirilir; yoksa sarı uyarı çıkar.</p></li>
  </ol>
  <div class="shot-row">
    ${L.fig("a03-kimlik-bilgileri", { bare: true, nonum: true, caption: "Kullanıcı Davet Edildi penceresi.", legend: ["<strong>E-posta</strong> — giriş adı.", "<strong>Davet</strong> — bağlantının e-postayla gönderilip gönderilmediği.", "<strong>Tamam</strong>"] })}
    ${L.fig("a03-eposta-kimlik", { bare: true, nonum: true, caption: "Kullanıcıya giden davet e-postası (şifre içermez)." })}
  </div>
  ${L.info("Davet e-postası gönderilemezse pencerede <strong>şifre belirleme bağlantısı</strong> gösterilir; <em>Bağlantıyı Kopyala</em> ile kullanıcıya yalnızca güvenli bir kanaldan iletin (kısa süre geçerli, tek kullanımlık). Hiçbir yerde şifre gönderilmez veya saklanmaz.")}
  ${L.warn("Sunucu işlevi için servis hesabı tanımlı değilse (Bölüm 6.3) <strong>davet seçeneği gizlenir</strong> ve formda “Eski yöntem kullanılıyor” uyarısı çıkar: hesap tarayıcıdan, otomatik üretilen <em>geçici şifreyle</em> açılır, kullanıcı ilk girişte şifresini değiştirmek zorunda kalır ve geçici şifre yalnızca sonuç penceresinde bir kez görünür (<em>Panoya Kopyala</em> / <em>E-posta Gönder</em>). Bu yedek akış kalıcı çözüm değildir; sunucu işlevini etkinleştirin.", "Yedek akış")}

  <h3>Yetim hesabı onarma</h3>
  <p>Kullanıcı oluşturma yarıda kesilirse (ağ kopması, sekme kapanması) Firebase'de hesabı olan ama portalda <strong>profili bulunmayan</strong> bir “yetim hesap” kalabilir; aynı e-postayla yeniden oluşturmak “e-posta zaten kayıtlı” hatası verir. <strong>Yetim Hesabı Onar</strong> bu hesabı kurtarır: e-posta alanına yazmaya başlayınca bulunan yetim hesaplar listelenir; ad, soyad, telefon, rol (ve müşteri rollerinde firma) girilip <em>Onar</em>'a basılır. Hesap yeniden oluşturulmaz, mevcut hesaba profil yazılır ve kullanıcıya <strong>şifre belirleme bağlantısı</strong> gönderilir.</p>
  ${L.side("a03-yetim-hesap", { lc: "74mm", caption: "Yetim Hesabı Onar penceresi.",
    legend: ["<strong>Hesabın e-postası</strong> — yetim hesaplar listeden seçilebilir.", "<strong>Durum satırı</strong> — kaç yetim hesap bulunduğunu söyler.", "<strong>Rol</strong> (ve gerekirse firma).", "<strong>Onar</strong>"],
    body: `${L.tip("Sunucu işlevi yoksa pencere, hesabın oluşturulurken verilen <em>bilinen parolasını</em> da ister (hesaba bu parolayla girilerek kimliği alınır). Onardıktan sonra kullanıcı mevcut parolasıyla girer ve ilk girişte şifresini değiştirir.")}` })}

  <h3>Kullanıcı ayrıntısı, roller ve pasife alma</h3>
  ${L.fig("a03-kullanici-detay", { wide: true, caption: "Kullanıcı ayrıntısı (Firma Yöneticisi).",
    legend: ["<strong>Düzenle</strong>", "<strong>Şifre Sıfırla</strong> — kullanıcıya şifre belirleme bağlantısı e-postası gönderir.", "<strong>Devre Dışı Bırak / Aktive Et</strong>", "<strong>Rol</strong> rozeti.", "<strong>Özet</strong> — talep istatistikleri."], cols2: true })}
  ${L.side("a03-kullanici-duzenle", { lc: "66mm", caption: "Rolü Firma Yöneticisi yapma.",
    legend: ["<strong>Ad / Soyad / Telefon</strong> düzenlenir.", "<strong>E-posta</strong> salt okunur.", "<strong>Rol</strong> — yetkinizin izin verdiği roller.", "<strong>Kaydet</strong>"],
    body: `
      <ul>
        <li><strong>Şifre Sıfırla</strong> şifre göndermez; kullanıcıya bağlantı e-postası yollar (gönderilemezse bağlantı pencerede gösterilir).</li>
        <li><strong>Devre Dışı Bırak</strong> girişi engeller: sunucu işlevi tanımlıyken Firebase hesabı da kapatılır ve kullanıcının açık oturumu sonraki sayfada sona erer. Kullanıcı <em>silinmez</em>, pasife alınır; talepleri kalır. Kendi hesabınızı pasife alamaz, kendi rolünüzü değiştiremezsiniz.</li>
        <li><strong>Firma Yöneticisi</strong> için kullanıcının firması olmalıdır (firma bu pencereden değişmez). Rol değişikliği kullanıcının sonraki sayfa yüklemesinde etkinleşir.</li>
        <li>Personel rolündeki hesabın talep alabilmesi, efor girebilmesi ve kişisel bildirim görebilmesi için aynı e-postayla bir <strong>Danışmanlar</strong> kaydı ve kayıt–hesap <strong>eşleşmesi</strong> gerekir (aşağıda).</li>
      </ul>` })}
  <div class="shot-row">
    <ul class="checklist" data-title="Yeni danışman">
      <li>Danışmanlar'da kayıt açıldı (departman, rol ünvanı).</li>
      <li>Kullanıcılar'da <strong>aynı e-postayla</strong> Danışman (veya Proje Yöneticisi) kullanıcısı davet edildi.</li>
      <li><em>Personel ↔ Kullanıcı Eşleştir</em> çalıştırıldı (yeni kullanıcıda otomatik denenir).</li>
      <li>Gerekli taleplere atama yapıldı.</li>
    </ul>
    <ul class="checklist" data-title="Ayrılan personel">
      <li>Açık talepleri <strong>Toplu Ata</strong> (“Yerine ata”) ile devredildi.</li>
      <li>Kullanıcı <em>Devre Dışı Bırak</em> ile pasife alındı.</li>
      <li>Danışman kaydı <em>Pasife Al</em> ile pasife alındı.</li>
    </ul>
  </div>

  <h2>Danışmanlar (personel kayıtları)</h2>
  ${L.who("sa", "da")}
  <p>${L.menu("Danışmanlar")} sayfası taleplere atanabilen personelin kayıt defteridir. <strong>Kullanıcı hesabından ayrıdır:</strong> kayıt açmak giriş yetkisi vermez; ikisi önce <em>e-posta adresiyle</em>, sonra bir <strong>kimlik bağıyla</strong> eşleşir. Danışmanın bir talepte yazabilmesi bu bağa dayanır. Açık talep ve efor sütunları yalnızca talebin <em>birincil</em> danışmanına sayılır.</p>
  ${L.fig("a03-personel", { wide: true, caption: "Danışmanlar listesi.",
    legend: ["<strong>Personel ↔ Kullanıcı Eşleştir</strong> — e-posta eşleşmesiyle danışman kayıtlarını kullanıcı hesaplarına bağlar; eşleşmeyenleri listeler.", "<strong>Yeni Danışman</strong>", "<strong>Arama</strong> — ad, e-posta, bölüm, rol ünvanı.", "<strong>Departman</strong> filtresi.", "<strong>Durum</strong> çipleri.", "<strong>Açık Talep</strong> — birincil olarak atanmış açık talepler.", "<strong>Detay</strong> — istatistik, aktif/tamamlanan talepler ve aktivite geçmişi."], cols2: true })}
  ${L.side("a03-yeni-personel", { lc: "66mm", caption: "Yeni Danışman penceresi.",
    legend: ["<strong>E-posta</strong> * — hesabın e-postasıyla aynı; benzersiz.", "<strong>Departman</strong> * — Departmanlar sayfasından.", "<strong>Rol Ünvanı</strong> * (ör. SAP FI Danışmanı).", "<strong>Kaydet</strong>"],
    body: `
      <p>Zorunlu alanlar: Ad, Soyad, E-posta, Departman, Rol Ünvanı. Telefon isteğe bağlıdır. Kayıt, aynı e-postalı kullanıcı varsa onunla otomatik eşleştirilir; yoksa kullanıcı oluşturup <em>Personel ↔ Kullanıcı Eşleştir</em> aracını çalıştırın (eşleşmemiş danışman talepte işlem yapamaz ve atama sırasında uyarı çıkar).</p>
      ${L.info("<strong>Danışman Düzenle</strong> (Detay sayfasından) ad veya e-posta değişince atama/talep/proje üzerindeki kopyalar da güncellenir. <strong>Pasife Al</strong> danışmanı yeni atama listelerinden ve iş yükü tablosundan kaldırır; <em>mevcut atamaları</em> korur (bu talepler Genel Bakış'ta <em>Pasif Danışmanda</em> sayılır ve yeniden atanmalıdır). Girişini engellemek için kullanıcı hesabını ayrıca pasife alın.")}` })}
</section>`;
