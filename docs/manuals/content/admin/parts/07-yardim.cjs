module.exports = (L) => `
<section class="chapter cont" data-opener="false" data-title="Sorun Giderme ve Sözlük"
         data-intro="Sık karşılaşılan uyarılar ve çözümleri, sık sorulan sorular ve terimler sözlüğü.">
  <h1>Sorun Giderme ve Sözlük</h1>

  <h2>Sorun giderme</h2>
  <table class="fields w3b">
    <thead><tr><th>Belirti</th><th>Olası neden</th><th>Çözüm</th></tr></thead>
    <tbody>
      <tr><td>Muhataplar'a tıklayınca Genel Bakış'a dönüyorum</td><td>Sayfayı yalnızca Süper Admin ve Destek Atayıcı açabilir.</td><td>Rolünüzü Süper Admin / Destek Atayıcı'dan kontrol ettirin.</td></tr>
      <tr><td>“Bu ticket size atanmadığı için yalnızca görüntüleyebilirsiniz”</td><td>Danışman rolü yalnızca atandığı talepte işlem yapar; atama, e-postanızın <em>Danışmanlar</em> kaydıyla eşleşmesine dayanır.</td><td>Atama isteyin; personel kaydının e-postası giriş e-postanızla aynı olmalı.</td></tr>
      <tr><td>“Personel kaydınız bulunamadı. E-posta eşleşmesini kontrol edin.”</td><td>Efor eklerken oturum e-postanız hiçbir <em>Danışmanlar</em> kaydıyla eşleşmiyor.</td><td>Personel kaydı açın veya e-postasını düzeltin (Bölüm 3.3).</td></tr>
      <tr><td>Bildirim zilim hiç dolmuyor</td><td>Zil, birincil danışmanı siz olduğunuz talepler için çalışır; personel kaydınız yoksa kişisel uyarı üretilmez.</td><td>Personel kaydı e-postasını ve birincil atamayı kontrol edin.</td></tr>
      <tr><td>“Bu işlem için yetkiniz yok” / “Veritabanı erişim izni reddedildi”</td><td>Rolünüz bu işleme izin vermiyor (ör. Danışman firma düzenliyor) veya güncel kurallar yayınlanmamış.</td><td>Yetki matrisine bakın (Bölüm 1.1); kurallar için Bölüm 6.4.</td></tr>
      <tr><td>Kullanıcı oluşturulamadı: “Bu e-posta adresi zaten kayıtlı / kullanımda”</td><td>E-posta Firebase kimlik doğrulamasında (profili olmasa bile) ya da kullanıcı listesinde zaten var.</td><td>Mevcut hesabı <em>Aktive Et</em> veya <em>Şifre Sıfırla</em> ile kurtarın.</td></tr>
      <tr><td>“Bu e-posta adresi bir danışman kaydına ait; müşteri kullanıcısı olarak eklenemez”</td><td>Aynı e-posta hem personel hem müşteri olamaz.</td><td>Müşteri için farklı bir e-posta kullanın.</td></tr>
      <tr><td>Kullanıcı giriş yapamıyor</td><td>Hesap pasif, şifre hatalı veya “Çok fazla başarısız deneme” kilidi.</td><td>Hesabı <em>Aktive Et</em>; birkaç dakika bekleyin; <em>Şifre Sıfırla</em> gönderin.</td></tr>
      <tr><td>“Gönderilemedi” uyarısı ve Aktiviteler'de E-posta Gönderilemedi</td><td>E-posta hattında sorun.</td><td>Köşeli parantezdeki hata koduna göre Bölüm 6.2 tablosuna bakın; <em>Test E-postası</em> ile deneyin.</td></tr>
                      </tbody>
  </table>

  <h2>Sık sorulan sorular</h2>
  ${L.faq([
    ["Müşteri adına talep açtım ama müşteri e-posta almadı.", `<p>Müşteriye “Talebiniz alındı” e-postası yalnızca <strong>Muhatap</strong> seçtiyseniz gider. Muhatap boşsa talep sizin adınıza açılır (Bölüm 2.2).</p>`],
    ["Bir danışmanın tüm taleplerini başkasına nasıl devrederim?", `<p>Toplu devir aracı yoktur. Her talepte Admin Paneli'nden yeni danışmanı işaretleyip birincil yapın; atama listesi tamamen o seçime göre yenilenir.</p>`],
    ["Yanlış durum seçtim, geri alabilir miyim?", `<p>Yöneticiler Admin Paneli'ndeki Durum listesinden (en az 10 karakterlik notla) herhangi bir duruma geçebilir; danışmanlar <em>İşleme Geri Al</em> kullanır. Gönderilmiş e-posta geri alınamaz.</p>`],
    ["İç not müşteriye görünür mü?", `<p>Hayır. İç notlar ve ekleri ayrı düğümde, yalnızca personel okuma kuralıyla tutulur; e-posta da üretmez.</p>`],
    ["Firma veya kullanıcıyı silebilir miyim?", `<p>Hayır. Firma, kullanıcı ve danışman kayıtları <em>pasife alınır</em>; departmandaki <em>Sil</em> de pasifleştirir. Böylece eski talepler ve raporlar bozulmaz.</p>`],
          ])}

  <h2>Sözlük</h2>
  <table class="glossary">
    <thead><tr><th>Terim</th><th>Açıklama</th></tr></thead>
    <tbody>
      <tr><td>Muhatap</td><td>Portalda hesabı olan kişi; <em>Muhataplar</em> sayfası müşteri ve personel hesaplarının listesidir.</td></tr>
      <tr><td>Ticket / Talep</td><td>Portal üzerinden açılan destek, arıza veya iş kaydı.</td></tr>
      <tr><td>Birincil danışman</td><td>Talepteki sorumlu danışman; liste, iş yükü, performans ve bildirim hesaplarında esas alınır.</td></tr>
      <tr><td>Hızlı İşlem</td><td>Mevcut duruma uygun sonraki adımı tek düğmeyle (notla) uygulayan Admin Paneli kısayolu.</td></tr>
      <tr><td>İç not</td><td>Yalnızca personelin gördüğü, e-posta üretmeyen not.</td></tr>
      <tr><td>SLA<small>hizmet seviyesi hedefi</small></td><td>Önceliğe göre ilk yanıt ve çözüm için takvim saati hedefi (SUP, ARZ, BUG).</td></tr>
      <tr><td>Resend</td><td>E-postaları gönderen servis; gönderen alan adı doğrulanmış olmalıdır (SPF/DKIM).</td></tr>
      <tr><td>Netlify Function</td><td><code>/api/send-email</code> adresini sunan, e-postayı üreten ve Resend'e ileten sunucu işlevi.</td></tr>
      <tr><td>Aktivite günlüğü</td><td>Değiştirilemez denetim kaydı (Aktiviteler sayfası).</td></tr>
    </tbody>
  </table>

  <h2>Bize ulaşın</h2>
  <div class="cards cols-2">
    <div class="card blue"><div class="ico" data-ico="mail"></div><h4>E-posta</h4><p>info@parlabilgiteknolojileri.net<br>Destek kutusu; talep numarasını konuya yazın.</p></div>
    <div class="card red"><div class="ico" data-ico="phone"></div><h4>Telefon</h4><p>+90 530 226 77 98<br>Üretimi durduran acil sorunlarda.</p></div>
  </div>
</section>`;
