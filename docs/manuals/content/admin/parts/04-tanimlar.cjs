module.exports = (L) => `
<section class="chapter" data-opener="false" data-title="Sözleşme, Proje ve Tanımlar"
         data-intro="Sözleşme ve proje kayıtları, departman tanımı, salt-okunur modül ve destek türü referansları ve hazır yanıt şablonları.">
  <h1>Sözleşme, Proje ve Tanımlar</h1>

  <h2>Sözleşmeler</h2>
  ${L.who("sa", "da")}
  <p>${L.menu("Sözleşmeler")} sayfası firmaların destek sözleşmelerini izler. Listeyi tüm personel görür; ekleme ve düzenleme Süper Admin ve Destek Atayıcı'dadır. Bitiş tarihine göre <strong>kalan gün</strong> hesaplanır; 30 günün altı kırmızı görünür. Sütunlara tıklayarak sıralayabilirsiniz.</p>
  ${L.fig("a04-sozlesmeler", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/admin/contracts.html", caption: "Sözleşme Listesi.",
    legend: ["<strong>Yeni Sözleşme</strong>", "<strong>Arama</strong> — sözleşme no, firma, tip, durum.", "<strong>Çipler</strong> — Tümü, Aktif, Sona Ermiş, Yenileme Gerekiyor (30 gün), Beklemede.", "<strong>Kalan Gün</strong> — kırmızı: 30 gün veya daha az / geçmiş.", "<strong>Durum</strong> — hesaplanan etkin durum.", "<strong>Düzenle</strong>"], cols2: true })}
  ${L.side("a04-sozlesme-formu", { lc: "74mm", caption: "Yeni Sözleşme formu.",
    legend: ["<strong>Sözleşme No</strong> * — benzersiz.", "<strong>Tip</strong> * — Yıllık Bakım, Bakım Anlaşması, Proje Sözleşmesi, Lisans, Diğer.", "<strong>Firma</strong> * — yalnızca aktif firmalar.", "<strong>Başlangıç</strong> *", "<strong>Bitiş</strong> * — başlangıçtan önce olamaz.", "<strong>Durum</strong> — Aktif, Sona Ermiş, Beklemede, İptal.", "<strong>Kaydet</strong>"],
    body: `
      <table class="fields">
        <thead><tr><th>Etkin durum</th><th>Davranış</th></tr></thead>
        <tbody>
          <tr><td>Aktif</td><td>Başlamış ve bitmemiş sözleşme. Bitiş tarihi geçmişse liste otomatik <strong>Sona Ermiş</strong> gösterir (kayıt değişmez).</td></tr>
          <tr><td>Beklemede</td><td>Kayıtlı <em>Beklemede</em> ya da başlangıcı gelecekte olan sözleşme.</td></tr>
          <tr><td>İptal</td><td>Tarihten bağımsız olduğu gibi görünür.</td></tr>
          <tr><td>Yenileme Gerekiyor</td><td>Aktif, bitişine 0–30 gün kalmış.</td></tr>
        </tbody>
      </table>` })}
  ${L.info("Etkin durum <strong>tek bir hesaptan</strong> gelir: Sözleşmeler, firma ayrıntısı ve Müşteriler listesindeki “Sözleşmeli” rozeti aynı sonucu gösterir. Sözleşme kayıtları <strong>izleme ve raporlama</strong> amaçlıdır: talep açmayı veya SLA'yı otomatik etkilemez (talep tipi kilidi firma tipine, yani CUS/ARC'ye bağlıdır).")}
  ${L.warn("<strong>Değer (₺)</strong> alanı ve sütunu yalnızca Süper Admin ve Destek Atayıcı'ya görünür; bedel, sözleşme kaydından ayrı bir düğümde saklanır ve Proje Yöneticisi / Danışman bunu veritabanı düzeyinde de okuyamaz.", "Sözleşme bedeli yalnızca yöneticilere")}

  <h2>Projeler</h2>
  ${L.who("sa", "da", "pm")}
  <p>${L.menu("Projeler")} sayfası proje kayıtlarını tutar; listeyi tüm personel görür. Kod (<code>PRJ0001</code> …) otomatik önerilir ve değişmez. Formda: <strong>Proje Adı</strong> *, <strong>Firma</strong> * (aktif firmalar), Proje Yöneticisi (Danışmanlar kayıtlarından), Durum (Planlama, Aktif, Beklemede, Tamamlandı, İptal), tarihler, açıklama ve <strong>Atanan Danışman</strong>. Pasife alınmış bir firmanın projesi de düzenlenebilir.</p>
  ${L.fig("a04-projeler", { wide: true, caption: "Proje Listesi (Proje Yöneticisi görünümü).",
    legend: ["<strong>Yeni Proje</strong>", "<strong>Arama</strong> — kod, ad, firma, yönetici.", "<strong>Durum</strong>", "<strong>Aktif Task</strong> — projeye bağlı kapanmamış PRJ talepleri.", "<strong>Detay</strong> ve Düzenle."], cols2: true })}
  ${L.info("<strong>PRJ talepleri projeye bağlanır:</strong> talebi oluştururken (Bölüm 2.2) PRJ tipi seçilince <em>Proje seçimi zorunludur</em>; mevcut bir talebin tipini PRJ yaparken ya da projesini değiştirirken Admin Paneli'ndeki <em>Proje</em> alanı kullanılır (değişiklik Geçmiş'e yazılır; tip PRJ dışına çevrilirse bağ temizlenir). <em>Aktif Task</em> sayacı ve proje ayrıntısındaki <em>Proje Taskları (PRJ)</em> listesi bu bağdan beslenir.", "Proje–talep bağı")}

  <h2>Departman, Modül ve Destek Türü</h2>
  ${L.who("sa")}
  <p>Bu üç <strong>Yönetim</strong> sayfası tanım listeleridir. Listeleri tüm personel görür, değiştirme yalnızca Süper Admin'dedir; her değişiklik Aktiviteler'e yazılır.</p>
  ${L.fig("a04-departmanlar", { wide: true, caption: "Departmanlar.", legend: ["<strong>Yeni Departman</strong>", "<strong>Durum</strong> anahtarı — kaydı pasife alır.", "<strong>Düzenle</strong> — ad değişirse danışman kayıtlarındaki departman adı kopyaları da güncellenir."], cols2: true })}
  <ul>
    <li><strong>Departman</strong> danışman formlarının listesini besler; <em>Personel Sayısı</em> aktif danışmanları sayar. <strong>Sil</strong> düğmesi yalnızca <em>hiç danışmanı olmayan</em> departmanda görünür ve kaydı kalıcı siler; danışmanı olan departman yalnızca pasife alınabilir.</li>
    <li><strong>Talep tipleri:</strong> SUP Destek Anlaşmalı Talep · ARZ Arızi Talep · PRJ Proje Taskı · INT İç Task · DEV Geliştirme Taskı · BUG Hata / Problem Kaydı. Müşteri formu firmasının türüne göre yalnızca SUP/BUG (CUS) ya da ARZ/BUG (ARC) sunar; personel formu altısını sunar.</li>
  </ul>
  ${L.fig("a04-moduller", { wide: true, caption: "SAP Modülleri (ilk dört kayıt).", legend: ["<strong>Referans (salt-okunur)</strong> rozeti — listenin formlara yansımadığını belirtir.", "<strong>Yeni Modül</strong> — kod en çok 20 karakter, büyük harf.", "<strong>Toplam Talep</strong> — modüldeki talep sayısı.", "<strong>Aktif</strong> anahtarı.", "<strong>Düzenle</strong> — yalnızca ad."], cols2: true })}
  ${L.fig("a04-destek-turleri", { wide: true, caption: "Destek Türleri (ilk dört kayıt).", legend: ["<strong>Referans (salt-okunur)</strong> rozeti.", "<strong>Yeni Tür</strong> — kod en çok 10 karakter.", "<strong>Renk</strong> — tür rozetinin rengi.", "<strong>Aktif</strong> anahtarı.", "<strong>Düzenle</strong> — ad, açıklama, renk."], cols2: true })}
  ${L.warn("<strong>Modül</strong> ve <strong>Destek Türü</strong> listeleri artık yalnızca <strong>referanstır</strong> (sayfalarda “Referans (salt-okunur)” rozeti ve uyarı kutusu vardır): talep formları, doğrulama, SLA, talep numarası ve raporlar sabit kod listesini (<code>assets/js/support-v2/ticket-utils.js</code>) kullanır. Bu sayfalarda ekleme, düzenleme, renk veya pasifleştirme formlara, rozetlere ve raporlara <strong>yansımaz</strong>; yeni modül/tür için geliştirme tarafında değişiklik gerekir. Departman listesi ise canlıdır ve danışman formlarını besler.", "Referans listeler")}

  <h2>Hazır yanıtlar</h2>
  ${L.who("sa", "da")}
  <p>${L.menu("Hazır Yanıtlar")} sayfası, personelin yanıt kutusunda <strong>Şablon ekle</strong> listesinden kullandığı metinleri tutar. Şablonları tüm personel okur ve kullanır; ekleme, düzenleme, silme ve aktif/pasif yapma yalnızca Süper Admin ve Destek Atayıcı'dadır. Yalnızca <em>aktif</em> şablonlar yanıt kutusunda listelenir.</p>
  ${L.fig("a04-hazir-yanitlar", { wide: true, caption: "Hazır Yanıt Şablonları.",
    legend: ["<strong>Yeni Şablon</strong>", "<strong>Bilgi notu</strong> — kullanım ve değişkenler.", "<strong>Aktif</strong> anahtarı — pasif şablon yanıt kutusunda görünmez.", "<strong>Düzenle</strong> (ve Sil)."], cols2: true })}
  ${L.side("a04-hazir-yanit-formu", { lc: "74mm", caption: "Şablon düzenleme penceresi.",
    legend: ["<strong>Başlık</strong> * — yanıt kutusundaki listede görünen ad.", "<strong>Kategori</strong> ve <strong>Sıra</strong> — listeyi gruplar/sıralar.", "<strong>Metin</strong> * — en çok 10.000 karakter.", "<strong>Değişken düğmeleri</strong> — imlecin olduğu yere ekler.", "<strong>Önizleme</strong> — örnek verilerle doldurulmuş hâli.", "<strong>Kaydet / Güncelle</strong>"],
    body: `
      <table class="fields">
        <thead><tr><th>Değişken</th><th>Yanıt kutusunda yerine geçen</th></tr></thead>
        <tbody>
          <tr><td><code>{musteri_adi}</code></td><td>Talep sahibinin adı soyadı.</td></tr>
          <tr><td><code>{talep_no}</code></td><td>Talep numarası.</td></tr>
          <tr><td><code>{danisman}</code></td><td>Yanıtı yazan personelin (sizin) adı.</td></tr>
        </tbody>
      </table>
      ${L.tip("Şablon metni yanıt kutusuna eklendikten sonra düzenlenebilir; göndermeden önce müşteriye özel bilgileri tamamlayın. Eklenen metin düz metindir, HTML olarak yorumlanmaz.")}` })}
</section>`;
