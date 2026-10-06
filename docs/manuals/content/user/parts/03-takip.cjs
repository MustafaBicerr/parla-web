module.exports = (L) => `
<section class="chapter cont" data-opener="false" data-title="Taleplerinizi Takip Etme"
         data-intro="Genel Bakış ve Taleplerim sayfaları, talep numarasının anlamı, durumlar ve bunların sizden ne beklediği, bildirim zili, e-posta bildirimleri ve hedef süreler.">
  <h1>Taleplerinizi Takip Etme</h1>

  <h2>Genel Bakış ve Taleplerim</h2>
  <p>${L.menu("Genel Bakış")} sayfası güne başlarken ilk bakacağınız yerdir. Dört özet kartı, o anki durumunuzu tek bakışta verir; altındaki tablo son 10 talebinizi listeler.</p>

  <table class="fields">
    <thead><tr><th>Kart</th><th>Neyi sayar?</th><th>Ne yapmalı?</th></tr></thead>
    <tbody>
      <tr><td><strong>Aktif</strong></td><td>Henüz çözülmemiş (kapanış onayı bekleyenler dahil) tüm talepleriniz.</td><td>Bilgi amaçlı.</td></tr>
      <tr><td><strong>Yanıt Bekleniyor</strong></td><td>Danışmanın sizden test veya ek bilgi beklediği talepler.</td><td>${L.req.replace("Zorunlu", "Yanıt verin")}</td></tr>
      <tr><td><strong>Bu Ay Çözüldü</strong></td><td>Bu ay çözülen veya kapanan talepler.</td><td>Bilgi amaçlı.</td></tr>
      <tr><td><strong>Toplam</strong></td><td>Şimdiye kadar açtığınız tüm talepler.</td><td>Bilgi amaçlı.</td></tr>
    </tbody>
  </table>

  <p>${L.menu("Taleplerim")} sayfası tüm taleplerinizi listeler. Üstteki arama kutusu <strong>talep numarası, konu veya modüle</strong> göre arar; durum çipleri listeyi tek tıkla daraltır; sağdaki açılır liste sıralamayı değiştirir. Bir talebin satırına (numarası dışında herhangi bir yerine) tıklayarak ayrıntı sayfasını açarsınız.</p>

  ${L.fig("03-taleplerim", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/customer/tickets.html", caption: "Taleplerim sayfası.",
    legend: ["<strong>Yeni Talep</strong> — talep formunu açar.", "<strong>Arama</strong> — numara, konu veya modül.", "<strong>Durum çipleri</strong> — Tümü ve sekiz durum.", "<strong>Sıralama</strong> — En yeni, En eski veya Öncelik.", "<strong>Durum rozeti</strong> — talebin güncel aşaması."], cols2: true })}

  ${L.fig("03-filtre", { wide: true, bare: true, caption: "Örnek: “Kapanış Onayı Bekliyor” çipi seçilince yalnızca onayınızı bekleyen talepler görünür.",
    legend: ["<strong>Seçili çip</strong> mavi görünür; “Tümü” ile filtreyi kaldırırsınız.", "<strong>Liste</strong> yalnızca seçilen duruma uyan talepleri gösterir."] })}
  ${L.tip("Günün başında “Müşteri Bekleniyor” ve “Kapanış Onayı Bekliyor” çiplerine bakın: bunlar sizden bir işlem bekleyen taleplerdir. Çözümü sizin onayınız bekliyorsa süreç ilerleyemez.")}

  <h3>Talep numarasını okuma</h3>
  <p>Her talep numarası, talebin kimliğini özetleyen beş parçadan oluşur:</p>
  <div class="flow">
    <div class="node open"><span class="n">1</span>SUP<small>Talep tipi</small></div><span class="arrow"></span>
    <div class="node assigned"><span class="n">2</span>ORN<small>Müşteri kodunuz</small></div><span class="arrow"></span>
    <div class="node in_progress"><span class="n">3</span>FI<small>SAP modülü</small></div><span class="arrow"></span>
    <div class="node pending_close"><span class="n">4</span>2610<small>Yıl-ay (Ekim 2026)</small></div><span class="arrow"></span>
    <div class="node closed"><span class="n">5</span>0042<small>Sıra numarası</small></div>
  </div>
  <p>Örnek: <code>SUP-ORN-FI-2610-0042</code> → Ekim 2026'da, ORN müşteri koduyla açılmış, FI modülüne ait 42. destek talebi.</p>

  <h2>Talep durumları</h2>
  <p>Her talep çözüme kavuşana kadar aşağıdaki durumlardan geçer. Durum, listede ve ayrıntıda renkli rozetle gösterilir. Aşağıdaki akış tipik bir talebin yolunu gösterir:</p>
  <div class="flow">
    <div class="node open"><span class="n">1</span>Açık<small>Talep alındı</small></div><span class="arrow"></span>
    <div class="node assigned"><span class="n">2</span>Atandı<small>Danışman belirlendi</small></div><span class="arrow"></span>
    <div class="node in_progress"><span class="n">3</span>İşlemde<small>Çalışma sürüyor</small></div><span class="arrow"></span>
    <div class="node waiting_customer"><span class="n">4</span>Müşteri Bekleniyor<small>Sizin testiniz</small></div><span class="arrow"></span>
    <div class="node pending_close"><span class="n">5</span>Kapanış Onayı<small>Son kontrol</small></div><span class="arrow"></span>
    <div class="node closed"><span class="n">6</span>Kapandı<small>Tamamlandı</small></div>
  </div>

  <table class="fields">
    <thead><tr><th>Durum</th><th>Ne anlama gelir?</th><th>Sizden beklenen</th></tr></thead>
    <tbody>
      <tr><td>${L.ST.open}</td><td>Talebiniz alındı, henüz danışman atanmadı.</td><td><span class="opt">Yok</span></td></tr>
      <tr><td>${L.ST.assigned}</td><td>Bir danışman talebin sorumluluğunu aldı.</td><td><span class="opt">Yok</span></td></tr>
      <tr><td>${L.ST.in_progress}</td><td>Danışman talep üzerinde çalışıyor.</td><td><span class="opt">Yok</span></td></tr>
      <tr><td>${L.ST.waiting_customer}</td><td>Çözümü denemeniz veya ek bilgi vermeniz gerekiyor.</td><td><span class="req">Yanıt verin</span></td></tr>
      <tr><td>${L.ST.pending_close}</td><td>Çözüm tamamlandı; kapatılması için onayınız bekleniyor.</td><td><span class="req">Onaylayın veya yeniden açın</span></td></tr>
      <tr><td>${L.ST.resolved}</td><td>Talep çözüldü olarak işaretlendi.</td><td><span class="opt">Kapatın / gerekirse yeniden açın</span></td></tr>
      <tr><td>${L.ST.closed}</td><td>Talep tamamlandı ve kapatıldı.</td><td><span class="opt">Sorun tekrar ederse yeniden açın (14 gün)</span></td></tr>
      <tr><td>${L.ST.reopened}</td><td>Talep yeniden açıldı; danışman yeniden inceliyor.</td><td><span class="opt">Yok</span></td></tr>
    </tbody>
  </table>

  <h2>Bildirimler</h2>
  <h3>Bildirim zili</h3>
  <p>Sayfanın sağ üstündeki <strong>zil</strong> simgesi, dikkatinizi gerektiren gelişmeleri toplar. Üzerindeki kırmızı rakam, okunmamış bildirim sayısıdır. Zile tıklayınca açılan panelde bildirimler yeniden eskiye sıralanır; bir bildirime tıklayınca ilgili talebe gidersiniz ve bildirim okundu sayılır.</p>
  ${L.fig("03-bildirimler", { half: true, bare: true, caption: "Bildirim paneli.",
    legend: ["<strong>Danışman güncellemesi</strong> — yeni yanıt veya durum değişikliği.", "<strong>Eylem bildirimi</strong> — sizden işlem bekleyen talep (turuncu simge).", "<strong>Tümünü okundu say</strong> — güncelleme bildirimlerini temizler."] })}
  <table class="fields">
    <thead><tr><th>Bildirim</th><th>Anlamı</th><th>Ne zaman kaybolur?</th></tr></thead>
    <tbody>
      <tr><td>Kapanış onayınız bekleniyor</td><td>Çözüm tamamlandı, onayınız gerekiyor.</td><td>Talebi onaylayınca veya yeniden açınca.</td></tr>
      <tr><td>Danışmanımız yanıtınızı bekliyor</td><td>Test veya ek bilgi isteniyor.</td><td>Yanıt yazınca.</td></tr>
      <tr><td>Danışmanımız talebinizi güncelledi veya yanıtladı</td><td>Yeni mesaj, durum veya öncelik değişikliği.</td><td>Talebi açınca veya “Tümünü okundu say” ile.</td></tr>
      <tr><td>Talebiniz çözüldü / kapatıldı</td><td>Talep sonuçlandı.</td><td>Talebi açınca.</td></tr>
    </tbody>
  </table>
  ${L.info("Bildirim zili ilk kullanımda son 48 saati gösterir; “okundu” bilgisi tarayıcınızda saklanır. Farklı bir bilgisayardan girerseniz bildirimleri yeniden görebilirsiniz.")}

  <h3>E-posta bildirimleri</h3>
  <p>Önemli gelişmeler e-posta adresinize de gönderilir; böylece portalı açmasanız bile haberdar olursunuz. E-postalar <strong>Parla BT Destek &lt;info@parlabilgiteknolojileri.net&gt;</strong> adresinden gelir ve doğrudan yanıtlayabilirsiniz.</p>
  <table class="fields">
    <thead><tr><th>E-posta başlığı</th><th>Ne zaman gelir?</th></tr></thead>
    <tbody>
      <tr><td>Talebiniz alındı · <em>numara</em></td><td>Talep oluşturulduğunda.</td></tr>
      <tr><td>Yeni yanıt · <em>numara</em></td><td>Danışmanınız talebe yanıt yazdığında.</td></tr>
      <tr><td>Durum güncellendi · <em>numara</em></td><td>Talebin durumu değiştiğinde (ör. işleme alındı).</td></tr>
      <tr><td>İncelemeniz bekleniyor · <em>numara</em></td><td>Danışman çözümü test etmenizi istediğinde.</td></tr>
      <tr><td>Kapanış onayı · <em>numara</em></td><td>Çözüm tamamlandığında ve onayınız gerektiğinde.</td></tr>
      <tr><td>Talep çözüldü / Talep kapatıldı · <em>numara</em></td><td>Talep sonuçlandığında.</td></tr>
    </tbody>
  </table>
  ${L.row(
    L.fig("04-eposta-talep-alindi", { half: true, bare: true, caption: "Talep oluşturulunca gelen “Talebiniz alındı” e-postası.", alt: "Talebiniz alındı e-postası" }),
    L.fig("04-eposta-yanit", { half: true, bare: true, caption: "Danışman yanıt yazınca gelen e-posta; “Yanıtı oku” sizi doğrudan talebe götürür.", alt: "Yeni yanıt e-postası" })
  )}
  ${L.tip("E-postalar gelmiyorsa önce gereksiz (spam) klasörünü kontrol edin ve info@parlabilgiteknolojileri.net adresini güvenli göndericiler listenize ekleyin. Kurumsal e-posta sisteminiz harici mesajları engelliyorsa BT biriminize başvurun.")}

  <h2>Hedef süreler</h2>
  <p>Her talebin ayrıntı sayfasında, önceliğe göre belirlenen <strong>Hedef Süreler</strong> görünür: danışmanın talebe <em>ilk yanıt</em> vermesi ve talebi <em>çözmesi</em> için hedeflenen süreler. Süreler talebin açıldığı andan itibaren (takvim saati olarak) sayılır; danışman sizden yanıt beklerken (${L.ST.waiting_customer}) süre duraklatılır.</p>
  <table class="fields">
    <thead><tr><th>Öncelik</th><th>Hedef ilk yanıt</th><th>Hedef çözüm</th></tr></thead>
    <tbody>
      <tr><td>${L.PR.critical}</td><td>1 saat</td><td>8 saat</td></tr>
      <tr><td>${L.PR.high}</td><td>4 saat</td><td>24 saat</td></tr>
      <tr><td>${L.PR.medium}</td><td>8 saat</td><td>72 saat (3 gün)</td></tr>
      <tr><td>${L.PR.low}</td><td>24 saat</td><td>120 saat (5 gün)</td></tr>
    </tbody>
  </table>
  ${L.info("Hedef süreler portalın iç hedefleridir ve talep tiplerinden Destek, Arızi ve Hata kayıtları için geçerlidir. Sözleşmenizdeki hizmet seviyeleri ayrıca geçerlidir; ayrıntı için Parla BT hesap yöneticinizle görüşün.")}
</section>`;
