module.exports = (L) => `
<section class="chapter cont" data-opener="false" data-title="Talep Ayrıntısı ve Yazışma"
         data-intro="Bir talebin içinde neler olduğunu, danışmanınızla nasıl yazışacağınızı, dosyaların nasıl ekleneceğini ve geçmiş kaydının nasıl okunacağını öğrenin.">
  <h1>Talep Ayrıntısı ve Yazışma</h1>

  <h2>Ayrıntı sayfası</h2>
  <p class="lead">Listeden bir talebe tıkladığınızda ayrıntı sayfası açılır. Burada talebin tüm bilgisi, yazışmalar ve geçmiş tek sayfada toplanır.</p>

  ${L.fig("04-talep-detay", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/customer/ticket-detail.html", caption: "Talep ayrıntı sayfasının üst bölümü.",
    legend: ["<strong>Yol göstergesi</strong> — Taleplerim sayfasına dönüş bağlantısı.", "<strong>Durum</strong> — talebin güncel rozeti.", "<strong>Talep bilgileri</strong> — öncelik, tip, modül, danışman, hedef süreler, oluşturulma zamanı, firma ve talep sahibi.", "<strong>Açıklama</strong> — talebi açarken yazdığınız metin."], cols2: true })}

  <table class="fields">
    <thead><tr><th>Alan</th><th>Anlamı</th></tr></thead>
    <tbody>
      <tr><td>Durum</td><td>Talebin aşaması (bkz. “Talep durumları”).</td></tr>
      <tr><td>Öncelik</td><td>Açarken seçtiğiniz aciliyet; danışman gerekirse değiştirebilir.</td></tr>
      <tr><td>Tip / SAP Modülü</td><td>Talebin kategorisi ve ilişkili SAP alanı.</td></tr>
      <tr><td>Danışman</td><td>Talebin sorumlusu olan Parla BT uzmanı. Atanana kadar “—” görünür.</td></tr>
      <tr><td>Hedef Süreler</td><td>İlk yanıt ve çözüm için hedeflenen süreler.</td></tr>
      <tr><td>Oluşturulma</td><td>Talebi açtığınız tarih ve saat.</td></tr>
      <tr><td>Firma / Talep Sahibi</td><td>Talebin ait olduğu firma ve talebi açan kişi.</td></tr>
    </tbody>
  </table>

  <h2>Danışmanla yazışma</h2>
  <p>Talebe ilişkin tüm yazışma, sayfanın alt bölümündeki <strong>Mesajlar</strong> alanında yer alır. Yeni mesajlar altta görünür; sizin mesajlarınız ve danışmanın mesajları farklı renkte kutularla ayrılır.</p>

  ${L.fig("04-yazisma", { url: "Mesajlar", caption: "Mesajlar bölümü ve yanıt kutusu.",
    legend: ["<strong>Danışmanın mesajı</strong> — gönderen, tarih ve saatiyle.", "<strong>Sizin mesajınız</strong> — farklı renkli kutuda görünür.", "<strong>Yanıt alanı</strong> — en az 3 karakterlik mesaj yazın.", "<strong>Dosya Ekle</strong> — yanıta ekran görüntüsü/belge ekler.", "<strong>Yanıt Gönder</strong> — mesajı iletir ve danışmana bildirim gönderir."] })}

  ${L.steps([
    ["Mesajınızı yazın", `<p>${L.field("Yanıt Yaz")} alanına cevabınızı yazın. Danışmanınız bir şey sorduysa soruyu sırasıyla yanıtlayın; hata mesajı gibi bilgileri yapıştırın.</p>`],
    ["Gerekirse dosya ekleyin", `<p>${L.btn("Dosya Ekle", "outline")} ile en fazla 3 dosya seçin. Yüklenen dosyalar mesajın altında etiket olarak görünür.</p>`],
    ["Gönderin", `<p>${L.btn("Yanıt Gönder")} düğmesine tıklayın. Danışmanınıza e-posta ve bildirim gider; talep “Müşteri Bekleniyor” durumundaysa otomatik olarak ${L.ST.in_progress} durumuna döner.</p>`],
  ])}
  ${L.info("Mesaj yazabilmek için talebin kapalı olmaması gerekir. Talep <strong>Çözüldü</strong> veya <strong>Kapandı</strong> durumundaysa yanıt kutusu yerine bir bilgi mesajı görünür; yazışmaya devam etmek için talebi yeniden açın (bkz. “Yeniden açma”).")}

  <h3>Ekleri açma</h3>
  <p>Mesajlardaki dosyalar küçük etiketler (<span class="ui-btn outline">hata-ekrani.jpg</span>) olarak görünür. Etikete tıklayın: görseller ve PDF'ler yeni sekmede açılır, diğer dosyalar bilgisayarınıza indirilir. Danışmanlarımızın size gönderdiği dosyaları da aynı şekilde açarsınız.</p>

  <h3>Yazışma ipuçları</h3>
  <div class="cards cols-2">
    <div class="card green"><div class="ico" data-ico="circle-check"></div><h4>Yapın</h4><p>Tek mesajda tek konu yazın; sorulan soruları yanıtlayın; test sonuçlarını “çalıştı / çalışmadı + hata mesajı” biçiminde bildirin.</p></div>
    <div class="card red"><div class="ico" data-ico="circle-x"></div><h4>Kaçının</h4><p>Aynı konuda yeni talep açmayın (mevcut talebe yazın); şifre ve kişisel verileri mesaj veya ekran görüntüsüne koymayın.</p></div>
  </div>

  <h2>Geçmiş</h2>
  <p>Talebin <strong>Geçmiş</strong> bölümü, mesajlardan bağımsız olarak talebin yaşam öyküsünü kaydeder: ne zaman açıldı, kime atandı, durumu ne zaman ve kim tarafından değiştirildi. Danışmanın durum değişikliği için yazdığı açıklamalar da burada görünür.</p>
  ${L.fig("04-gecmis", { wide: true, bare: true, caption: "Geçmiş kaydı: oluşturma, atama ve durum değişiklikleri sırayla listelenir.",
    legend: ["<strong>Oluşturma</strong> — talebin açıldığı an ve numarası.", "<strong>Durum değişikliği</strong> — “Durum değişti: Atandı → İşlemde”."] })}
  ${L.tip("Bir şeyin ne zaman olduğunu hatırlamaya çalışıyorsanız Geçmiş bölümü en güvenilir kayıttır; tarihler ve kişi adları değiştirilemez.")}
</section>`;
