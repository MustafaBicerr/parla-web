module.exports = (L) => `
<section class="chapter" data-opener="false" data-title="Sözleşme, Proje ve Tanımlar"
         data-intro="Sözleşme ve proje kayıtları ile departman, SAP modülü ve destek türü tanım listeleri.">
  <h1>Sözleşme, Proje ve Tanımlar</h1>

  <h2>Sözleşmeler</h2>
  ${L.who("sa", "da")}
  <p>${L.menu("Sözleşmeler")} sayfası firmaların destek sözleşmelerini izler. Listeyi tüm personel görür; ekleme ve düzenleme Süper Admin ve Destek Atayıcı'dadır. Bitiş tarihine göre <strong>kalan gün</strong> hesaplanır; 30 günün altı kırmızı görünür.</p>
  ${L.fig("a04-sozlesmeler", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/admin/contracts.html", caption: "Sözleşme Listesi.",
    legend: ["<strong>Yeni Sözleşme</strong>", "<strong>Arama</strong> — sözleşme no, firma, tip, durum.", "<strong>Çipler</strong> — Tümü, Aktif, Sona Ermiş, Yenileme Gerekiyor (30 gün), Beklemede.", "<strong>Kalan Gün</strong> — kırmızı: 30 gün veya daha az / geçmiş.", "<strong>Durum</strong> — hesaplanan durum.", "<strong>Düzenle</strong>"], cols2: true })}
  ${L.side("a04-sozlesme-formu", { lc: "74mm", caption: "Yeni Sözleşme formu.",
    legend: ["<strong>Sözleşme No</strong> *", "<strong>Tip</strong> * — Yıllık Bakım, Bakım Anlaşması, Proje Sözleşmesi, Lisans, Diğer.", "<strong>Firma</strong> * — yalnızca aktif firmalar.", "<strong>Başlangıç</strong> *", "<strong>Bitiş</strong> * — başlangıçtan önce olamaz.", "<strong>Durum</strong> — Aktif, Sona Ermiş, Beklemede, İptal.", "<strong>Kaydet</strong>"],
    body: `
      <table class="fields">
        <thead><tr><th>Durum</th><th>Davranış</th></tr></thead>
        <tbody>
          <tr><td>Aktif</td><td>Bitiş tarihi geçmişse liste otomatik <strong>Sona Ermiş</strong> gösterir (kayıt değişmez).</td></tr>
          <tr><td>Beklemede · İptal</td><td>Tarihten bağımsız olduğu gibi görünür.</td></tr>
          <tr><td>Yenileme Gerekiyor</td><td>Aktif, bitişine 0–30 gün kalmış.</td></tr>
        </tbody>
      </table>` })}
  ${L.info("Sözleşme kayıtları <strong>izleme ve raporlama</strong> amaçlıdır: talep açmayı, SLA'yı veya Müşteriler listesindeki “Sözleşme” rozetini otomatik etkilemez. Değer (₺) isteğe bağlıdır.")}

  <h2>Projeler</h2>
  ${L.who("sa", "da", "pm")}
  <p>${L.menu("Projeler")} sayfası proje kayıtlarını tutar; listeyi tüm personel görür. Kod (<code>PRJ0001</code> …) otomatik önerilir ve değişmez. Formda: <strong>Proje Adı</strong> *, <strong>Firma</strong> * (aktif firmalar), Proje Yöneticisi (Danışmanlar kayıtlarından), Durum (Planlama, Aktif, Beklemede, Tamamlandı, İptal), tarihler, açıklama ve <strong>Atanan Personel</strong>.</p>
  ${L.fig("a04-projeler", { wide: true, caption: "Proje Listesi (Proje Yöneticisi görünümü).",
    legend: ["<strong>Yeni Proje</strong>", "<strong>Arama</strong> — kod, ad, firma, yönetici.", "<strong>Durum</strong>", "<strong>Aktif Task</strong> — projeye bağlı kapanmamış PRJ talepleri.", "<strong>Detay</strong> ve Düzenle."], cols2: true })}
  ${L.warn("Proje ayrıntısı, projeye bağlı <strong>PRJ taleplerini</strong> listeler; ancak mevcut sürümde talep formlarında <strong>proje seçimi bulunmadığından</strong> talepler projeye bağlanamaz ve <em>Aktif Task</em> sayacı ile ayrıntıdaki liste şimdilik boş kalır. Proje kaydı yönetim ve ekip bilgisi için kullanılır.")}

  <h2>Departman, Modül ve Destek Türü</h2>
  ${L.who("sa")}
  <p>Bu üç <strong>Yönetim</strong> sayfası tanım listeleridir. Listeleri tüm personel görür, değiştirme yalnızca Süper Admin'dedir. Ortak davranış: <em>Durum/Aktif</em> anahtarı kaydı pasife alır, <em>Düzenle</em> kodu değiştirmeden güncelleme yapar, her değişiklik Aktiviteler'e yazılır.</p>
  ${L.fig("a04-departmanlar", { wide: true, caption: "Departmanlar.", legend: ["<strong>Yeni Departman</strong>", "<strong>Durum</strong> anahtarı.", "<strong>Düzenle</strong>", "<strong>Sil</strong> — kaydı silmez, pasifleştirir."], cols2: true })}
  ${L.fig("a04-moduller", { wide: true, caption: "SAP Modülleri (ilk dört kayıt).", legend: ["<strong>Yeni Modül</strong> — kod en çok 20 karakter, büyük harf.", "<strong>Toplam Ticket</strong> — modüldeki talep sayısı.", "<strong>Aktif</strong> anahtarı.", "<strong>Düzenle</strong> — yalnızca ad."], cols2: true })}
  ${L.fig("a04-destek-turleri", { wide: true, caption: "Destek Türleri (ilk dört kayıt).", legend: ["<strong>Yeni Tür</strong> — kod en çok 10 karakter.", "<strong>Renk</strong> — tür rozetinin rengi.", "<strong>Aktif</strong> anahtarı.", "<strong>Düzenle</strong> — ad, açıklama, renk."], cols2: true })}
  <ul>
    <li><strong>Departman</strong> personel formlarının listesini besler; <em>Personel Sayısı</em> aktif danışmanları sayar. Modül ve tür sayfaları boşsa ilk açılışta varsayılan kayıtlar eklenir (10 SAP modülü; SUP, ARZ, PRJ, INT, DEV, BUG).</li>
    <li><strong>Talep tipleri:</strong> SUP Destek Anlaşmalı Talep · ARZ Arızi Talep · PRJ Proje Taskı · INT İç Task · DEV Geliştirme Taskı · BUG Hata / Problem Kaydı. Müşteri formu yalnızca SUP, ARZ, BUG sunar.</li>
  </ul>
  ${L.warn("Talep formlarındaki ve raporlardaki <strong>modül/tür seçenekleri</strong> mevcut sürümde kodundaki sabit listeden (<code>assets/js/support-v2/ticket-utils.js</code>) gelir. Bu sayfalarda kayıt eklemek veya pasife almak formlara <em>otomatik yansımaz</em>; yeni modül/tür için geliştirme tarafında değişiklik gerekir.", "Tanım listeleri ve formlar")}
</section>`;
