module.exports = (L) => `
<section class="chapter cont" data-opener="false" data-title="Çözüm, Onay ve Yeniden Açma"
         data-intro="Danışmanınız çözümü hazırladığında sizden iki şey beklenir: çözümü test etmek ve talebin kapanmasını onaylamak. Sorun sürüyorsa talebi gerekçesiyle yeniden açabilirsiniz.">
  <h1>Çözüm, Onay ve Yeniden Açma</h1>

  <h2>Çözümü test etme</h2>
  <p class="lead">Talepler danışman tek taraflı kapatmaz: çözüm doğru çalışıyor mu, bunu en iyi siz bilirsiniz. Bu yüzden son söz sizdedir.</p>

  <p>Danışmanınız çözümü hazırladığında talebi <strong>${L.ST.waiting_customer}</strong> durumuna alabilir ve sizden test etmenizi isteyebilir. Talep sayfasının üstünde pembe bir bilgi bandı görünür; ayrıca “<em>İncelemeniz bekleniyor</em>” e-postası ve bildirim alırsınız.</p>
  ${L.fig("05-banner-bekleniyor", { wide: true, bare: true, nonum: true, caption: "“Yanıtınız bekleniyor” bandı." })}
  ${L.steps([
    ["Çözümü deneyin", `<p>Danışmanın mesajında anlattığı adımları kendi SAP ortamınızda uygulayın.</p>`],
    ["Sonucu bildirin", `<p>Talepteki ${L.field("Yanıt Yaz")} alanına sonucu yazın: “çalıştı” veya “çalışmadı + hata mesajı”. Yanıtınızı gönderdiğiniz anda talep otomatik olarak ${L.ST.in_progress} durumuna döner.</p>`],
  ])}

  <h2>Kapanış onayı</h2>
  <p>Çözüm sizin tarafınızdan doğrulandığında danışman talebi <strong>${L.ST.pending_close}</strong> durumuna alır. Bu aşamada talebin üstünde mor bir onay bandı belirir ve e-posta ile bildirim gelir.</p>

  ${L.fig("05-banner-onay", { wide: true, bare: true, caption: "Kapanış onayı bandı: iki seçeneğiniz var.",
    legend: ["<strong>Onayla ve Kapat</strong> — çözümden memnunsanız talebi kapatır.", "<strong>Yeniden Aç</strong> — sorun sürüyorsa talebi gerekçenizle yeniden açar."], cols2: true })}

  <h3>Çözümü onaylama</h3>
  ${L.steps([
    ["Onayla ve Kapat'a tıklayın", `<p>Açılan pencerede isterseniz danışmanınıza kısa bir teşekkür veya not bırakın (isteğe bağlı).</p>`],
    ["Onaylayın", `<p>${L.btn("Onayla ve Kapat")} düğmesine tıklayın. Talep ${L.ST.closed} durumuna geçer; danışmanınıza kapanış bildirimi gider.</p>`],
  ])}
  ${L.row(L.fig("05-eposta-kapanis-onayi", { half: true, bare: true, caption: "“Kapanış onayı” e-postası.", alt: "Kapanış onayı e-postası" }), L.fig("05-onay-penceresi", { half: true, bare: true, caption: "Talebi Kapat penceresi.",
    legend: ["<strong>Not</strong> — isteğe bağlı mesajınız.", "<strong>Onayla ve Kapat</strong> — kapanışı tamamlar."] }))}
  ${L.warn("Kapanış onayı verdiğinizde talep kapanır ve yeni yanıt yazamazsınız. Sorun tekrar ederse kapanıştan sonra <strong>14 gün</strong> içinde talebi yeniden açabilirsiniz.")}

  <h2>Talebi yeniden açma</h2>
  <p>Çözüm sorununuzu gidermediyse veya sorun tekrarladıysa talebi yeniden açabilirsiniz. Böylece geçmiş yazışma ve dosyalar korunur; danışmanınız kaldığı yerden devam eder.</p>
  ${L.steps([
    ["Yeniden Aç'a tıklayın", `<p>Onay bandındaki (veya Çözüldü / Kapandı bandındaki) ${L.btn("Yeniden Aç", "outline")} düğmesine tıklayın.</p>`],
    ["Gerekçenizi yazın", `<p>Sorunun neden sürdüğünü <strong>en az 10 karakterle</strong> açıklayın. Gerekçeniz talebe mesaj olarak eklenir ve danışmanınızın e-postasına iletilir.</p>`],
    ["Onaylayın", `<p>${L.btn("Yeniden Aç")} düğmesine tıklayın. Talep ${L.ST.reopened} durumuna geçer ve atanmış danışmana bildirim gider.</p>`],
  ])}
  ${L.fig("05-yeniden-ac-penceresi", { half: true, bare: true, caption: "Talebi Yeniden Aç penceresi: gerekçe zorunludur.",
    legend: ["<strong>Yeniden açma gerekçesi</strong> — en az 10 karakter.", "<strong>Yeniden Aç</strong> — talebi yeniden açar."] })}
  ${L.fig("05-banner-yeniden-acildi", { wide: true, bare: true, nonum: true, caption: "Talep yeniden açıldıktan sonra görünen bilgi bandı." })}

  <h2>Çözüldü ve Kapandı durumları</h2>
  <p>Danışmanınız bazı talepleri doğrudan <strong>${L.ST.resolved}</strong> olarak işaretleyebilir. Bu durumda da talebi kapatabilir veya yeniden açabilirsiniz. Kapanmış talepler için yeniden açma süresi <strong>kapanıştan sonra 14 gündür</strong>.</p>
  <div class="shot-row">
    ${L.fig("05-banner-cozuldu", { bare: true, nonum: true, caption: "Çözüldü bandı: kapatın veya yeniden açın." })}
    ${L.fig("05-banner-kapandi", { bare: true, nonum: true, caption: "Kapandı bandı: 14 gün içinde yeniden açabilirsiniz." })}
  </div>
  <table class="fields">
    <thead><tr><th>Durum</th><th>Yanıt yazabilir miyim?</th><th>Yapabileceğiniz</th></tr></thead>
    <tbody>
      <tr><td>${L.ST.pending_close}</td><td>Evet</td><td>Onayla ve Kapat · Yeniden Aç</td></tr>
      <tr><td>${L.ST.resolved}</td><td>Hayır</td><td>Onayla ve Kapat · Yeniden Aç</td></tr>
      <tr><td>${L.ST.closed}</td><td>Hayır</td><td>Yeniden Aç (14 gün içinde)</td></tr>
      <tr><td>${L.ST.reopened}</td><td>Evet</td><td>Yazışmaya devam edin</td></tr>
    </tbody>
  </table>
  ${L.tip("14 günlük süre dolduysa aynı sorun için yeni bir talep açın ve açıklamada eski talep numarasını belirtin; danışmanımız geçmişi görebilir.")}
</section>`;
