module.exports = (L) => `
<section class="chapter cont" data-opener="false" data-title="Yardım"
         data-intro="Sık sorulan sorular, karşılaşabileceğiniz sorunların çözümleri, terimler sözlüğü ve bize ulaşma yolları.">
  <h1>Yardım</h1>

  <h2>Sık sorulan sorular</h2>
  ${L.faq([
    ["Hesabım yok, kendim kayıt olabilir miyim?", `<p>Hayır. Hesaplar Parla BT tarafından oluşturulur. Hesap talebi için hesap yöneticinize veya <strong>info@parlabilgiteknolojileri.net</strong> adresine yazın.</p>`],
    ["Şifremi unuttum, ne yapmalıyım?", `<p>Giriş sayfasında e-posta adresinizi yazıp <strong>Şifremi Unuttum</strong>'a tıklayın; sıfırlama bağlantısı e-postanıza gelir. Gelmezse spam klasörünü kontrol edin.</p>`],
    ["Yanlışlıkla iki kez talep açtım.", `<p>Mükerrer talebin numarasını bize e-postayla veya diğer talebe yazarak bildirin; danışmanımız birini kapatır. Siz talebi kendiniz silemezsiniz.</p>`],
    ["Talebimi açtıktan sonra düzenleyebilir miyim?", `<p>Konu ve açıklama değiştirilemez; eklemek istediğiniz her şeyi talebe <strong>yanıt</strong> olarak yazın, gerekirse dosya ekleyin. Böylece geçmiş bozulmaz.</p>`],
    ["Önceliği yanlış seçtim.", `<p>Talebe yazarak durumu belirtin; danışmanımız önceliği güncelleyebilir. Kritik bir durumsa ayrıca telefonla arayın.</p>`],
    ["Danışmanım kim, ona nasıl ulaşırım?", `<p>Atanan danışman talep ayrıntısında <strong>Danışman</strong> alanında görünür. Danışmanla yazışma talebin içinden yapılır; acil durumlarda <strong>+90 530 226 77 98</strong> numarasından ulaşabilirsiniz.</p>`],
    ["Talebim neden hâlâ “Açık” durumda?", `<p>Talep henüz bir danışmana atanmamıştır. Atama genellikle kısa sürede yapılır; yüksek öncelikli taleplerde destek ekibi hemen devreye girer. Bir süre geçtiyse talebe kısa bir not yazabilirsiniz.</p>`],
    ["Kapanış onayını vermezsem ne olur?", `<p>Talep “Kapanış Onayı Bekliyor” durumunda kalır; yazışmaya devam edebilirsiniz. Çözümü kontrol edip onayladığınızda veya yeniden açtığınızda süreç ilerler.</p>`],
    ["Kapanmış talebi yeniden açamıyorum.", `<p>Yeniden açma süresi kapanıştan sonra 14 gündür. Süre dolduysa yeni bir talep açın ve açıklamada eski talep numarasını belirtin.</p>`],
    ["Dosyam yüklenmiyor.", `<p>Dosyanın 2 MB'tan küçük olduğundan ve desteklenen bir türde olduğundan emin olun (görsel, PDF, Office, TXT/CSV/LOG, ZIP). Büyük dosyalar için paylaşım bağlantısını <strong>Ek Bağlantı</strong> alanına yazın.</p>`],
    ["E-posta bildirimleri gelmiyor.", `<p>Spam klasörünüzü kontrol edin ve info@parlabilgiteknolojileri.net adresini güvenli göndericilere ekleyin. Sorun sürerse BT biriminize başvurun; portalı kullanmaya devam edebilirsiniz, bildirimler zilde de görünür.</p>`],
    ["Başka bir firmanın talebini görebilir miyim?", `<p>Hayır. Her firma yalnızca kendi taleplerini görür; müşteri kullanıcıları ise yalnızca kendi açtıkları talepleri görür (firma yöneticileri firmanın tüm taleplerini görür).</p>`],
  ])}

  <h2>Sorun giderme</h2>
  <table class="fields">
    <thead><tr><th>Belirti</th><th>Olası neden</th><th>Çözüm</th></tr></thead>
    <tbody>
      <tr><td>“E-posta veya şifre hatalı”</td><td>Yanlış şifre veya e-posta; Caps Lock açık.</td><td>Bilgileri kontrol edin; gerekirse <strong>Şifremi Unuttum</strong>.</td></tr>
      <tr><td>“Çok fazla başarısız deneme”</td><td>Güvenlik amaçlı geçici kilit.</td><td>Birkaç dakika bekleyip tekrar deneyin.</td></tr>
      <tr><td>“Hesabınız aktif değil”</td><td>Hesap devre dışı bırakılmış.</td><td>Parla BT destek ekibine yazın.</td></tr>
      <tr><td>Sayfa boş veya yarım yükleniyor</td><td>Eski tarayıcı önbelleği veya bağlantı sorunu.</td><td>Sayfayı yenileyin (<kbd>Ctrl</kbd> + <kbd>F5</kbd>); güncel bir tarayıcı kullanın.</td></tr>
      <tr><td>“Bu talebe erişim yetkiniz yok”</td><td>Başka kullanıcının talebi.</td><td>Talebi açan kişiyle veya firma yöneticinizle görüşün.</td></tr>
      <tr><td>Talep gönderilemiyor</td><td>Zorunlu alan eksik veya metin kısa.</td><td>Kırmızı uyarılara bakın: konu en az 5, açıklama en az 20 karakter.</td></tr>
      <tr><td>Şifre sıfırlama bağlantısı çalışmıyor</td><td>Süresi dolmuş veya daha önce kullanılmış.</td><td>Giriş sayfasından yeni bağlantı isteyin.</td></tr>
    </tbody>
  </table>

  <h2>Sözlük</h2>
  <table class="glossary">
    <thead><tr><th>Terim</th><th>Açıklama</th></tr></thead>
    <tbody>
      <tr><td>Talep<small>ticket</small></td><td>Portal üzerinden açtığınız her destek, arıza veya hata kaydı.</td></tr>
      <tr><td>Danışman</td><td>Talebiniz için atanan Parla BT uzmanı.</td></tr>
      <tr><td>Talep numarası</td><td>Talebin benzersiz kimliği (TİP-MÜŞTERİ-MODÜL-YYAA-SIRA).</td></tr>
      <tr><td>SAP modülü<small>FI, MM, SD ...</small></td><td>Sorunun ilişkili olduğu SAP uygulama alanı.</td></tr>
      <tr><td>Öncelik</td><td>Talebin işinize etkisini belirten Düşük / Orta / Yüksek / Kritik seviyesi.</td></tr>
      <tr><td>Hedef süre</td><td>İlk yanıt ve çözüm için önceliğe göre belirlenen hedef.</td></tr>
      <tr><td>Kapanış onayı</td><td>Çözümün sizin tarafınızdan doğrulanması ve talebin kapatılması adımı.</td></tr>
      <tr><td>Yeniden açma</td><td>Kapanmış/çözülmüş talebi, gerekçenizle tekrar aktif hale getirmek.</td></tr>
      <tr><td>Dahili not</td><td>Yalnızca Parla BT personelinin gördüğü iç not; müşteriye gösterilmez.</td></tr>
      <tr><td>Arızi talep</td><td>Destek sözleşmesi kapsamı dışındaki, tek seferlik hizmet talebi.</td></tr>
    </tbody>
  </table>

  <h2>Bize ulaşın</h2>
  <div class="cards cols-2">
    <div class="card blue"><div class="ico" data-ico="mail"></div><h4>E-posta</h4><p>info@parlabilgiteknolojileri.net<br>Talep numaranızı konuya yazın.</p></div>
    <div class="card red"><div class="ico" data-ico="phone"></div><h4>Telefon (acil durumlar)</h4><p>+90 530 226 77 98<br>Kritik taleplerde portala ek olarak arayın.</p></div>
  </div>
</section>`;
