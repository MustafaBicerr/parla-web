module.exports = (L) => `
<section class="chapter" data-opener="false" data-title="Raporlar, Aktiviteler ve Bildirimler"
         data-intro="Dönemsel raporlar ve dışa aktarma, değişmez aktivite günlüğü (e-posta hataları dahil) ve personel bildirim zili.">
  <h1>Raporlar, Aktiviteler ve Bildirimler</h1>

  <h2>Raporlar</h2>
  ${L.who()}
  <p>${L.menu("Raporlar")} sayfası seçilen tarih aralığı için dokuz kart üretir. Veri sayfa açılırken bir kez okunur; yeni kayıtlar için sayfayı yenileyin. Aralık <strong>Bu Hafta</strong> (pazartesiden bugüne), <strong>Bu Ay</strong>, <strong>Son 3 Ay</strong> veya <strong>Özel</strong> olabilir ve ${L.btn("Uygula")} ile çalışır.</p>
  ${L.fig("a05-raporlar", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/admin/reports.html", caption: "Raporlar (Son 3 Ay; ilk satır).",
    legend: ["<strong>Tarih Aralığı</strong>", "<strong>Uygula</strong>", "<strong>CSV</strong> — kartın verisini noktalı virgül ayraçlı indirir.", "<strong>Excel</strong> — aynı veriyi .xlsx indirir.", "<strong>Modül / Tip dağılımı</strong> — pasta grafikler.", "<strong>Danışman Efor Detayı</strong> — ekranda ilk 50 satır; dışa aktarma hepsini içerir."], cols2: true })}
  <table class="fields">
    <thead><tr><th>Kart</th><th>Neyi gösterir?</th><th>Tarih ölçütü</th></tr></thead>
    <tbody>
      <tr><td>Aylık Firma Eforu · Danışman Efor Detayı</td><td>Firma başına efor saati (ilk 15) · tek tek efor kayıtları.</td><td>Efor iş tarihi</td></tr>
      <tr><td>Modül · Tip Bazlı Dağılım</td><td>Taleplerin SAP modülüne / talep tipine göre dağılımı.</td><td>Oluşturma tarihi</td></tr>
      <tr><td>Danışman Performansı</td><td>Birincil danışman başına atanan, çözülen (Çözüldü/Kapandı), ortalama çözüm süresi (saat).</td><td>Oluşturma tarihi</td></tr>
      <tr><td>En Aktif Firmalar (Top 10) · Arızı Müşteri İstatistikleri</td><td>En çok talep açan firmalar · ARZ talepleri, açık ARZ, ARC firma sayısı, ortalama çözüm.</td><td>Oluşturma tarihi</td></tr>
      <tr><td>Aylık Trend (6 Ay) · Çözüm Süreleri (Öncelik)</td><td>Son altı ayın talep sayısı · öncelik başına ortalama çözüm (saat).</td><td>Trend: her zaman son 6 ay</td></tr>
    </tbody>
  </table>
  ${L.info("Ortalama çözüm süresi hesapları (<em>Danışman Performansı</em>, <em>Arızı Müşteri</em>, <em>Çözüm Süreleri</em>) yalnızca <strong>Çözüldü zaman damgası</strong> olan talepleri kullanır; doğrudan <em>Kapandı</em> yapılan veya müşterinin <em>Kapanış Onayı</em>'ndan kapattığı talepler girmez. Genel Bakış'taki “Ort. Çözüm Süresi” ise çözüm yoksa kapanış zamanını kullanır. <em>Excel</em> dışa aktarma tarayıcının internetten bir kütüphane yüklemesini gerektirir; CSV her zaman çalışır.", "Çözüm süresi ve dışa aktarma")}

  <h2>Aktivite günlüğü</h2>
  ${L.who()}
  <p>${L.menu("Aktiviteler")} sayfası portaldaki önemli işlemlerin <strong>değişmez denetim günlüğüdür</strong>: kayıtlar eklenir; düzenlenemez veya silinemez (veritabanı kuralı, Süper Admin dahil). Tablo ve Zaman Çizelgesi görünümleri arasında geçilebilir; satırlardaki ticket, kullanıcı ve firma adları ilgili sayfaya bağlanır.</p>
  ${L.fig("a05-eposta-hatalari", { wide: true, bare: true, caption: "Denetim Günlüğü: Olay Tipi = E-posta Gönderilemedi.",
    legend: ["<strong>Tablo / Zaman Çizelgesi</strong> görünümü.", "<strong>Olay Tipi</strong> — burada E-posta Gönderilemedi.", "<strong>Kullanıcı</strong> — liste Muhataplar okuma yetkisi gerektirir.", "<strong>Varlık Tipi</strong> — Ticket, Kullanıcı, Firma …", "<strong>Başlangıç / Bitiş</strong> tarihleri.", "<strong>Temizle</strong> — filtreleri sıfırlar.", "<strong>Detaylar</strong> — <code>olay — [hata kodu] açıklama</code>."], cols2: true })}
  <ul>
    <li><strong>Kaydedilenler:</strong> talep oluşturma, güncelleme (durum, öncelik, atama), silme; müşterinin yanıtı, kapanış onayı, yeniden açması; kullanıcı, firma, danışman oluşturma/güncelleme/aktif-pasif; sözleşme, proje, departman, modül, tür değişiklikleri; <strong>e-posta gönderim hataları</strong>.</li>
    <li><strong>Kaydedilmeyenler:</strong> personelin yanıt ve iç notları, efor, ek dosyalar, ONAY kutusu, girişler (bunlar talebin Mesajlar/Efor/Geçmiş bölümlerinde izlenir).</li>
  </ul>
  <ul>
    <li>Etiketi tanımlı olmayan bazı olaylar <em>ham kod adıyla</em> görünür (ör. <code>ticket_closed</code>, <code>user_updated</code>). Sayfa tüm kayıtları bir kerede yükler; dönemi tarih filtreleriyle daraltın.</li>
    <li><strong>E-posta hataları:</strong> bir bildirim gönderilemezse işlemi yapanın ekranında sarı uyarı çıkar ve günlüğe <strong>E-posta Gönderilemedi</strong> düşer. Olay Tipi filtresiyle sorunları toplu inceleyin; kodların anlamı Bölüm 6.2'dedir.</li>
  </ul>
  ${L.warn("Geçici hatalarda e-posta kuyruktan sonradan yeniden denenir; ilk başarısızlık yine de günlüğe yazılır. <em>E-posta Gönderilemedi</em> kaydı e-postanın hiç ulaşmadığı anlamına gelmeyebilir; şüphede alıcıdan teyit isteyin.")}

  <h2>Bildirim zili</h2>
  ${L.who()}
  <p>Başlık çubuğundaki zil <strong>size ait</strong> uyarıları toplar. Bildirimler saklanmaz; son güncellenen 80 talepten türetilir ve her 90 saniyede bir ve sekmeye dönüldüğünde yenilenir. “Size ait”, <em>birincil danışmanı siz olan</em> talepler demektir (eşleştirme oturum e-postanızın <em>Danışmanlar</em> kaydıyla aynı olmasına dayanır).</p>
  ${L.side("a05-bildirim-danisman", { lc: "74mm", caption: "Danışmanın bildirim paneli.",
    legend: ["<strong>SLA hedefi aşıldı</strong> (+süre) — eylem bildirimi.", "<strong>Müşteri yanıtladı</strong> veya talebi güncelledi.", "<strong>Tümünü okundu say</strong> — yalnızca güncelleme bildirimlerini temizler."],
    body: `<p>Panelde en yeni 12 bildirim gösterilir; zil rozeti hepsini sayar. “Okundu” bilgisi <strong>bu tarayıcıda</strong> tutulur (başka bilgisayarda yeniden görünebilir); ilk kullanımda son 48 saat dikkate alınır.</p>
    <p>Danışmanlar “Atama bekliyor” almaz; personel kaydı olmayan bir yönetici yalnızca “Atama bekliyor” görür (Destek Atayıcı'nın panelinde bu bildirim <em>danışmansız açık talep</em> için çıkar).</p>` })}
  <table class="fields w3b">
    <thead><tr><th>Bildirim</th><th>Kime?</th><th>Ne zaman kaybolur?</th></tr></thead>
    <tbody>
      <tr><td>Atama bekliyor</td><td>${L.rb("sa")}${L.rb("da")}${L.rb("pm")}</td><td>Danışman atanınca veya durum değişince.</td></tr>
      <tr><td>Müşteri talebi yeniden açtı</td><td>Birincil danışman</td><td>Talep <em>Tekrar Açıldı</em>'dan çıkınca.</td></tr>
      <tr><td>SLA hedefi aşıldı (+süre)</td><td>Birincil danışman</td><td>Talep kapanınca veya <em>Müşteri Bekleniyor</em> olunca.</td></tr>
      <tr><td>Müşteri yanıtladı veya talebi güncelledi</td><td>Birincil danışman</td><td>Talebi açınca veya <em>Tümünü okundu say</em> ile.</td></tr>
    </tbody>
  </table>
</section>`;
