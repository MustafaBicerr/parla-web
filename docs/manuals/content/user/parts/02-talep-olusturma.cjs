module.exports = (L) => `
<section class="chapter cont" data-opener="false" data-title="Talep Oluşturma"
         data-intro="Yeni talep formundaki her alan, doğru öncelik ve talep tipi seçimi, ekran görüntüsü ekleme ve danışmanın işini hızlandıran iyi bir talep yazma ipuçları.">
  <h1>Talep Oluşturma</h1>

  <h2>Yeni talep formu</h2>
  <p class="lead">Talep formu, danışmanınızın sorunu ilk okumada anlayıp çalışmaya başlaması için tasarlandı. Alanları ne kadar eksiksiz doldurursanız çözüm o kadar hızlı gelir.</p>

  ${L.steps([
    ["Formu açın", `<p>Genel Bakış veya Taleplerim sayfasının sağ üstündeki ${L.btn("+ Yeni Talep")} düğmesine tıklayın. Form bir pencere olarak açılır.</p>`],
    ["Alanları doldurun", `<p>Talep tipi, öncelik, SAP modülü, konu ve açıklamayı girin. Zorunlu alanlar boş bırakılırsa gönderemezsiniz; kırmızı uyarı hangi alanın eksik olduğunu gösterir.</p>`],
    ["Dosya ekleyin (isteğe bağlı)", `<p>${L.btn("Dosya Ekle", "outline")} düğmesiyle ekran görüntüsü veya belge ekleyin.</p>`],
    ["Gönderin", `<p>${L.btn("Talebi Gönder")} düğmesine tıklayın. Talebiniz oluşturulur ve ekranın üstünde “Talebiniz başarıyla oluşturuldu” mesajı görünür.</p>`],
  ])}

  ${L.row(L.fig("02-yeni-talep-bos", { half: true, bare: true, caption: "Yeni Destek Talebi penceresi.",
    legend: ["<strong>Talep Tipi</strong> — talebin kategorisi.", "<strong>Öncelik</strong> — işinize etkisine göre.", "<strong>SAP Modülü</strong> — sorunun yaşandığı alan.", "<strong>Konu</strong> — tek cümlelik özet.", "<strong>Açıklama</strong> — sorunun ayrıntıları.", "<strong>Dosya Ekle</strong> — ekran görüntüsü veya belge.", "<strong>Ek Bağlantı</strong> — Drive vb. bağlantı (isteğe bağlı).", "<strong>Talebi Gönder</strong> — kaydeder."] }), L.fig("02-yeni-talep-dolu", { half: true, bare: true, caption: "Eksiksiz doldurulmuş örnek talep: net konu, ayrıntılı açıklama ve iki ek dosya.",
    legend: ["<strong>Konu</strong> — sorunu özetliyor.", "<strong>Açıklama</strong> — hata mesajı, işlem kodu ve şirket kodu içeriyor.", "<strong>Ekler</strong> — dosyalar adı ve boyutuyla listelenir.", "<strong>Talebi Gönder</strong> — talebi oluşturur."] }))}

  <table class="fields">
    <thead><tr><th>Alan</th><th>Ne yazmalı / seçmeli?</th><th>Zorunlu mu?</th></tr></thead>
    <tbody>
      <tr><td>Talep Tipi</td><td>Çoğu durumda <strong>Destek Anlaşmalı Talep</strong>. Aşağıdaki tabloya bakın.</td><td>${L.req}</td></tr>
      <tr><td>Öncelik</td><td>Sorunun işinize etkisine göre Düşük, Orta, Yüksek veya Kritik.</td><td>${L.req}</td></tr>
      <tr><td>SAP Modülü</td><td>Sorunun ilişkili olduğu modül (FI, MM, SD ...). Emin değilseniz <em>Diğer</em>.</td><td>${L.req}</td></tr>
      <tr><td>Konu</td><td>5–100 karakter. Sorunu bir cümleyle özetleyin: <em>“Fatura kesiminde vergi kodu hatası”</em>.</td><td>${L.req}</td></tr>
      <tr><td>Açıklama</td><td>En az 20 karakter. Ne yapmaya çalışıyordunuz, hangi hata mesajını gördünüz, ne bekliyordunuz?</td><td>${L.req}</td></tr>
      <tr><td>Ekran Görüntüsü / Dosya</td><td>En fazla 3 dosya; her biri en çok 2 MB.</td><td>${L.opt}</td></tr>
      <tr><td>Ek Bağlantı</td><td>Büyük dosyalar için paylaşım bağlantısı (https:// ile başlamalı).</td><td>${L.opt}</td></tr>
    </tbody>
  </table>

  <h2>Talep tipi ve öncelik</h2>
  <p>İki seçim, talebin ne kadar hızlı ve kimin tarafından ele alınacağını belirler. Doğru seçim sizin de lehinizedir.</p>

  <h3>Talep tipleri</h3>
  <table class="fields">
    <thead><tr><th>Tip</th><th>Ne zaman seçilir?</th><th>Örnek</th></tr></thead>
    <tbody>
      <tr><td><strong>SUP</strong> — Destek Anlaşmalı Talep</td><td>Destek sözleşmeniz kapsamındaki günlük sorular, hatalar ve küçük değişiklikler.</td><td>“XK01 ile satıcı açamıyorum.”</td></tr>
      <tr><td><strong>ARZ</strong> — Arızi Talep</td><td>Destek sözleşmesi kapsamında olmayan, tek seferlik hizmet gereken durumlar (Arızi müşteri hesaplarında varsayılan).</td><td>“Eski modülde tek seferlik rapor düzeltmesi.”</td></tr>
      <tr><td><strong>BUG</strong> — Hata / Problem Kaydı</td><td>Daha önce çalışan bir özelliğin beklenmedik şekilde bozulması.</td><td>“Dünkü transport sonrası fatura belgesi oluşmuyor.”</td></tr>
    </tbody>
  </table>

  <h3>Öncelik nasıl seçilir?</h3>
  <div class="cards cols-4">
    <div class="card"><h4>${L.PR.low}</h4><p>Beklenebilir. Çalışmanızı engellemiyor; iyileştirme veya soru.</p></div>
    <div class="card blue"><h4>${L.PR.medium}</h4><p>Çalışmayı zorlaştırıyor ama geçici çözümle devam edebiliyorsunuz.</p></div>
    <div class="card amber"><h4>${L.PR.high}</h4><p>Önemli bir iş süreci aksıyor; aynı gün içinde çözüm gerekiyor.</p></div>
    <div class="card red"><h4>${L.PR.critical}</h4><p>Üretim/ödeme/fatura gibi kritik süreç tamamen durdu; çok sayıda kullanıcı etkileniyor.</p></div>
  </div>
  ${L.danger("<strong>Kritik</strong> öncelik yalnızca iş sürekliliğini ciddi biçimde tehdit eden durumlar içindir. Kritik talep açtıktan sonra danışmanlarımızı ayrıca telefonla da arayın: <strong>+90 530 226 77 98</strong>.")}
  ${L.tip("Emin değilseniz bir alt seviyeyi seçip açıklamada etkisini yazın (“10 kullanıcı etkileniyor”, “ay sonu kapanışı yarın”). Danışmanınız gerekirse önceliği yükseltir.")}

  <h2>SAP modülü seçimi</h2>
  <p>Modül, talebin doğru uzmana ulaşmasını sağlar ve talep numarasının bir parçası olur.</p>
  <table class="glossary">
    <thead><tr><th>Modül</th><th>Kapsamı</th></tr></thead>
    <tbody>
      <tr><td>FI<small>Finansal Muhasebe</small></td><td>Genel defter, alacak/borç hesapları, ödeme programı, duran varlıklar, dönem kapanışı.</td></tr>
      <tr><td>CO<small>Yönetim Muhasebesi</small></td><td>Maliyet merkezleri, iç siparişler, kârlılık analizi, bütçe raporları.</td></tr>
      <tr><td>MM<small>Malzeme Yönetimi</small></td><td>Satın alma, stok, envanter, tedarikçi (satıcı) ana verisi.</td></tr>
      <tr><td>SD<small>Satış ve Dağıtım</small></td><td>Satış siparişi, sevkiyat, faturalama, fiyatlandırma.</td></tr>
      <tr><td>PP<small>Üretim Planlama</small></td><td>Üretim siparişleri, ürün ağaçları, iş yeri, planlama.</td></tr>
      <tr><td>WM<small>Depo Yönetimi</small></td><td>Depo, raf, transfer emirleri.</td></tr>
      <tr><td>HR<small>İnsan Kaynakları</small></td><td>Personel yönetimi, bordro, zaman yönetimi.</td></tr>
      <tr><td>BASIS<small>Sistem Yönetimi</small></td><td>Kullanıcı ve yetkiler, performans, transport, Fiori/GUI erişimi.</td></tr>
      <tr><td>ABAP<small>Geliştirme</small></td><td>Özel raporlar, ekranlar, arayüzler, formlar.</td></tr>
      <tr><td>Diğer</td><td>Yukarıdakilere girmeyen veya emin olmadığınız konular.</td></tr>
    </tbody>
  </table>

  <h2>Dosya ve ekran görüntüsü ekleme</h2>
  <p>Hata mesajının ekran görüntüsü, çoğu zaman bin kelimeden değerlidir. Talep oluştururken ve sonraki her yanıtınızda dosya ekleyebilirsiniz.</p>

  ${L.fig("02-dosya-ekle", { wide: true, bare: true, caption: "Seçilen dosyalar küçük etiketler olarak listelenir; ✕ ile kaldırabilirsiniz.",
    legend: ["<strong>Dosya Ekle</strong> — bilgisayarınızdan bir veya birkaç dosya seçer.", "<strong>✕</strong> — gönderilmeden önce dosyayı listeden çıkarır.", "<strong>Sınırlar</strong> — en fazla 3 dosya, her biri 2 MB."] })}

  <table class="fields">
    <thead><tr><th>Dosya türü</th><th>Uzantılar</th><th>Not</th></tr></thead>
    <tbody>
      <tr><td>Görseller</td><td>.png .jpg .jpeg .gif .webp</td><td>Büyük görseller otomatik olarak küçültülür ve sıkıştırılır; okunabilirlik korunur.</td></tr>
      <tr><td>PDF</td><td>.pdf</td><td>Olduğu gibi yüklenir.</td></tr>
      <tr><td>Office belgeleri</td><td>.doc .docx .xls .xlsx .ppt .pptx</td><td>2 MB sınırı geçerlidir.</td></tr>
      <tr><td>Metin / kayıt dosyaları</td><td>.txt .csv .log</td><td>Hata günlükleri için uygundur.</td></tr>
      <tr><td>Arşiv</td><td>.zip</td><td>Birden fazla dosyayı tek pakette göndermek için.</td></tr>
    </tbody>
  </table>
  ${L.warn("Güvenlik nedeniyle çalıştırılabilir dosyalar (.exe, .bat vb.) ve web sayfaları (.html) kabul edilmez. 2 MB'tan büyük dosyalar için <strong>Ek Bağlantı</strong> alanına paylaşım bağlantısı yazın. Dosyalara yalnızca siz ve Parla BT ekibi erişebilir.")}
  ${L.tip("Ekran görüntüsünü almak için Windows'ta <kbd>Win</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd>, Mac'te <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>4</kbd> tuşlarını kullanın. SAP penceresinde <strong>işlem kodu, hata mesajı ve alan değerleri</strong> görünsün; hassas verileri (maaş, TCKN vb.) önceden gizleyin.")}

  <h2>İyi bir talep nasıl yazılır?</h2>
  <p>Aşağıdaki örnek, aynı sorunun iki farklı anlatımını karşılaştırıyor. İkincisi ilk mesajda danışmanın ihtiyacı olan her şeyi içerir ve gidip gelen soruları ortadan kaldırır.</p>
  <div class="cards cols-2">
    <div class="card red"><h4>Yetersiz talep</h4><p><strong>Konu:</strong> Ödeme çalışmıyor<br><strong>Açıklama:</strong> F110 çalışmıyor, acil bakar mısınız.</p></div>
    <div class="card green"><h4>Yeterli talep</h4><p><strong>Konu:</strong> F110 ödeme programı banka dosyası üretmiyor<br><strong>Açıklama:</strong> F110'da ödeme önerisi başarılı ama DME dosyası oluşmuyor. Hata: “Ödeme ortamı bulunamadı”. Şirket kodu 1000, yöntem T. Dün çalışıyordu. Ekran görüntüsü ekte.</p></div>
  </div>

  <ul class="checklist" data-title="Göndermeden önce kontrol edin">
    <li class="done">Konu, sorunu tek cümlede anlatıyor.</li>
    <li class="done">Hata mesajını ve işlem kodunu (ör. VF01, F110) yazdım.</li>
    <li class="done">Sorunun ne zaman başladığını ve nelerin değiştiğini belirttim.</li>
    <li class="done">Kaç kullanıcının etkilendiğini yazdım.</li>
    <li class="done">Ekran görüntüsü/dosya ekledim.</li>
    <li class="done">Önceliği işime etkisine göre seçtim.</li>
  </ul>



  <h2>Gönderdikten sonra ne olur?</h2>
  ${L.steps([
    ["Talep numaranız oluşur", `<p>Talebiniz <code>SUP-ORN-FI-2610-0042</code> gibi benzersiz bir numara alır. Numarayı yazışmalarda ve telefonda referans olarak kullanabilirsiniz.</p>`],
    ["Onay e-postası gelir", `<p>E-posta adresinize “<strong>Talebiniz alındı</strong>” başlıklı bir onay gönderilir. Aynı anda Parla BT destek ekibine de bildirim gider.</p>`],
    ["Danışman atanır", `<p>Talep ilgili danışmana atanır; durum ${L.ST.assigned} olur ve danışmanın adı talepte görünür. Atama sırasında size ayrıca e-posta gönderilmez; durumu portalda veya bildirim zilinde izleyebilirsiniz.</p>`],
    ["İlk yanıt ve çözüm", `<p>Danışmanınız talebi ${L.ST.in_progress} durumuna alır ve size talep içinden yazar. Yanıt geldiğinde e-posta ve bildirim alırsınız.</p>`],
  ])}
</section>`;
