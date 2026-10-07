module.exports = (L) => `
<section class="chapter" data-opener="false" data-title="Raporlar, Aktiviteler ve Bildirimler"
         data-intro="Dönemsel raporlar ve dışa aktarma, değişmez aktivite günlüğü (e-posta hataları dahil) ve personel bildirim zili.">
  <h1>Raporlar, Aktiviteler ve Bildirimler</h1>

  <h2>Raporlar</h2>
  ${L.who()}
  <p>${L.menu("Raporlar")} sayfası seçilen tarih aralığı için dokuz kart üretir. Veri sayfa açılırken bir kez okunur; yeni kayıtlar için sayfayı yenileyin. Arşivdeki (silinmiş) talepler ve eforları raporlara girmez. Aralık <strong>Bu Hafta</strong> (pazartesiden bugüne), <strong>Bu Ay</strong>, <strong>Son 3 Ay</strong> veya <strong>Özel</strong> olabilir ve ${L.btn("Uygula")} ile çalışır.</p>
  ${L.fig("a05-raporlar", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/admin/reports.html", caption: "Raporlar (Son 3 Ay; ilk satır).",
    legend: ["<strong>Tarih Aralığı</strong>", "<strong>Uygula</strong>", "<strong>CSV</strong> — kartın verisini noktalı virgül ayraçlı indirir (formül nötrlemeli).", "<strong>Excel</strong> — aynı veriyi .xlsx indirir.", "<strong>Modül / Tip dağılımı</strong> — pasta grafikler.", "<strong>Danışman Efor Detayı</strong> — ekranda 50'şer satır sayfalanır ve toplam kayıt sayısı yazılır; dışa aktarma hepsini içerir."], cols2: true })}
  <table class="fields">
    <thead><tr><th>Kart</th><th>Neyi gösterir?</th><th>Tarih ölçütü</th></tr></thead>
    <tbody>
      <tr><td>Aylık Firma Eforu · Danışman Efor Detayı</td><td>Firma başına efor saati (ilk 15) · tek tek efor kayıtları.</td><td>Efor iş tarihi</td></tr>
      <tr><td>Modül · Tip Bazlı Dağılım</td><td>Taleplerin SAP modülüne / talep tipine göre dağılımı.</td><td>Oluşturma tarihi</td></tr>
      <tr><td>Danışman Performansı</td><td>Birincil danışman başına atanan, çözülen (Çözüldü/Kapandı), ortalama çözüm süresi (saat).</td><td>Oluşturma tarihi</td></tr>
      <tr><td>En Aktif Firmalar (Top 10) · Arızi Müşteri İstatistikleri</td><td>En çok talep açan firmalar · ARZ talepleri, açık ARZ, ARC firma sayısı, ortalama çözüm.</td><td>Oluşturma tarihi</td></tr>
      <tr><td>Aylık Trend (6 Ay) · Çözüm Süreleri (Öncelik)</td><td>Son altı ayın talep sayısı · öncelik başına ortalama çözüm (saat).</td><td>Trend: her zaman son 6 ay</td></tr>
    </tbody>
  </table>
  ${L.info("<strong>Çözüm süresi</strong> pano ve raporlarda <em>aynı tanımla</em> hesaplanır: talebin oluşturulmasından çözüme kadar geçen süre; çözüm anı, talebin <em>Kapanış Onayı Bekliyor</em> / <em>Çözüldü</em> durumuna ilk geçtiği an (yoksa kapanış zamanı)dır. Müşterinin Kapanış Onayı'ndan kapattığı talepler de böylece hesaba girer. Süre takvim süresidir (SLA duraklaması düşülmez); sayılar Türkçe biçimle, virgüllü gösterilir. <em>Excel</em> dışa aktarma tarayıcının internetten bir kütüphane yüklemesini gerektirir; CSV her zaman çalışır.", "Çözüm süresi ve dışa aktarma")}

  <h2>Aktivite günlüğü</h2>
  ${L.who()}
  <p>${L.menu("Aktiviteler")} sayfası portaldaki önemli işlemlerin <strong>değişmez denetim günlüğüdür</strong>: kayıtlar eklenir; düzenlenemez veya silinemez (veritabanı kuralı, Süper Admin dahil). Tablo ve Zaman Çizelgesi görünümleri arasında geçilebilir; satırlardaki ticket, kullanıcı ve firma adları ilgili sayfaya bağlanır.</p>
  ${L.fig("a05-eposta-hatalari", { wide: true, bare: true, caption: "Denetim Günlüğü: Olay Tipi = E-posta Gönderilemedi.",
    legend: ["<strong>Tablo / Zaman Çizelgesi</strong> görünümü.", "<strong>Olay Tipi</strong> — burada E-posta Gönderilemedi.", "<strong>Kullanıcı</strong> — liste Kullanıcılar sayfasının okuma yetkisini gerektirir.", "<strong>Varlık Tipi</strong> — Talep, Kullanıcı, Firma …", "<strong>Başlangıç / Bitiş</strong> tarihleri.", "<strong>Temizle</strong> — filtreleri sıfırlar.", "<strong>Detaylar</strong> — <code>olay — [hata kodu] açıklama</code>."], cols2: true })}
  <ul>
    <li><strong>Kaydedilenler:</strong> talep oluşturma, güncelleme (durum, öncelik, atama), arşive alma, geri yükleme ve kalıcı silme; <strong>toplu atama / toplu durum</strong> (işlem başına tek özet kayıt); sistemin <strong>otomatik kapanışı</strong> (kullanıcı “Sistem (otomatik)”); müşterinin yanıtı, kapanış onayı, yeniden açması; kullanıcı, firma, danışman oluşturma/güncelleme/aktif-pasif, <em>yetim hesap onarımı</em>; sözleşme, proje, departman, modül, tür ve hazır yanıt değişiklikleri; <strong>e-posta gönderim hataları</strong>.</li>
    <li><strong>Kaydedilmeyenler:</strong> personelin yanıt ve iç notları, efor, ek dosyalar, ONAY kutusu, girişler (bunlar talebin Mesajlar/Efor/Geçmiş bölümlerinde izlenir).</li>
  </ul>
  <ul>
    <li>Olay adları Türkçe etiketlerle gösterilir; etiketi tanımlı olmayan bir olay <em>ham kod adıyla</em> görünebilir. Sayfa <strong>en son 200 kaydı</strong> yükler; daha eskisi için listenin altındaki <strong>Daha eski yükle</strong> düğmesini kullanın. Dönemi tarih filtreleriyle daraltın.</li>
    <li><strong>E-posta hataları:</strong> bir bildirim gönderilemezse işlemi yapanın ekranında sarı uyarı çıkar ve günlüğe <strong>E-posta Gönderilemedi</strong> düşer. Olay Tipi filtresiyle sorunları toplu inceleyin; kodların anlamı Bölüm 6.2'dedir.</li>
  </ul>
  ${L.warn("Geçici hatalarda e-posta kuyruktan sonradan yeniden denenir; ilk başarısızlık yine de günlüğe yazılır. <em>E-posta Gönderilemedi</em> kaydı e-postanın hiç ulaşmadığı anlamına gelmeyebilir; şüphede alıcıdan teyit isteyin.")}

  <h2>Bildirim zili</h2>
  ${L.who()}
  <p>Başlık çubuğundaki zil <strong>size ait</strong> uyarıları toplar. Bildirimler saklanmaz; hedefli sorgularla (sizin danışman kaydınıza atanmış açık talepler, atayıcı rolünde ayrıca danışmansız açık talepler) türetilir; tüm talep koleksiyonu indirilmez. Zil <strong>görünür sekmede yaklaşık 5 dakikada bir</strong> yenilenir; sekme arka plandayken yoklama durur, sekmeye dönünce (son yenilemeden bu yana süre dolduysa) yenilenir. “Size ait”, <em>birincil ya da ikincil danışmanı siz olan</em> talepler demektir (eşleştirme danışman kaydınızın kullanıcı hesabıyla eşleşmesine dayanır).</p>
  ${L.side("a05-bildirim-danisman", { lc: "74mm", caption: "Danışmanın bildirim paneli.",
    legend: ["<strong>SLA hedefi aşıldı</strong> (+süre) — eylem bildirimi.", "<strong>Müşteri yanıtladı</strong> veya talebi güncelledi.", "<strong>Tümünü okundu say</strong> — yalnızca güncelleme bildirimlerini temizler."],
    body: `<p>Panelde ve rozette en çok 50 bildirim gösterilir (fazlası “+N” olarak belirtilir). “Okundu” bilgisi <strong>bu tarayıcıda</strong> tutulur (başka bilgisayarda yeniden görünebilir); ilk kullanımda son 48 saat dikkate alınır.</p>
    <p>Danışmanlar “Atama bekliyor” almaz. SLA uyarısı yalnızca saat işlerken üretilir: <em>Müşteri Bekleniyor</em> / <em>Kapanış Onayı</em> sırasında (SLA duraklatıldığında) zilde uyarı çıkmaz; Genel Bakış'taki aşım sayacı ise kalıcı aşım damgasını saymaya devam eder.</p>` })}
  <table class="fields w3b">
    <thead><tr><th>Bildirim</th><th>Kime?</th><th>Ne zaman kaybolur?</th></tr></thead>
    <tbody>
      <tr><td>Atama bekliyor</td><td>${L.rb("sa")}${L.rb("da")}${L.rb("pm")}</td><td>Danışman atanınca veya durum değişince.</td></tr>
      <tr><td>Müşteri talebi yeniden açtı</td><td>Atanmış danışman</td><td>Talep <em>Yeniden Açıldı</em>'dan çıkınca.</td></tr>
      <tr><td>SLA hedefi aşıldı (+süre)</td><td>Atanmış danışman</td><td>Talep kapanınca veya SLA duraklatılınca.</td></tr>
      <tr><td>Müşteri yanıtladı veya talebi güncelledi · Başka bir danışman talebi güncelledi</td><td>Atanmış danışman</td><td>Talebi açınca veya <em>Tümünü okundu say</em> ile.</td></tr>
    </tbody>
  </table>
</section>`;
