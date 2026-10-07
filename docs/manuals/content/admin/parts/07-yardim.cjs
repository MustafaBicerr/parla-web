module.exports = (L) => `
<section class="chapter cont" data-opener="false" data-title="Sorun Giderme ve Sözlük"
         data-intro="Sık karşılaşılan uyarılar ve çözümleri, sık sorulan sorular ve terimler sözlüğü.">
  <h1>Sorun Giderme ve Sözlük</h1>

  <h2>Sorun giderme</h2>
  <table class="fields w3b">
    <thead><tr><th>Belirti</th><th>Olası neden</th><th>Çözüm</th></tr></thead>
    <tbody>
      <tr><td>Kullanıcılar'a tıklayınca Genel Bakış'a dönüyorum</td><td>Sayfayı yalnızca Süper Admin ve Destek Atayıcı açabilir.</td><td>Rolünüzü Süper Admin / Destek Atayıcı'dan kontrol ettirin.</td></tr>
      <tr><td>“Bu talep size atanmadığı için yalnızca görüntüleyebilirsiniz”</td><td>Danışman rolü yalnızca atandığı talepte yazar; atama, danışman kaydınızın kullanıcı hesabınızla eşleşmesine dayanır.</td><td>Atama isteyin; danışman kaydının e-postası giriş e-postanızla aynı olmalı.</td></tr>
      <tr><td>Talep size atanmış görünüyor ama “eşleşmesi tamamlanmamış” uyarısı çıkıyor ya da yazamıyorsunuz</td><td>Danışman kaydı kullanıcı hesabına bağlanmamış (kimlik bağı yok).</td><td>Yönetici <em>Danışmanlar</em> sayfasında <em>Personel ↔ Kullanıcı Eşleştir</em> aracını çalıştırsın; e-postalar aynı olmalı (Bölüm 3.3).</td></tr>
      <tr><td>“Personel kaydınız bulunamadı. E-posta eşleşmesini kontrol edin.”</td><td>Efor eklerken hesabınız hiçbir <em>Danışmanlar</em> kaydıyla eşleşmiyor.</td><td>Danışman kaydı açın veya e-postasını düzeltin (Bölüm 3.3).</td></tr>
      <tr><td>Bildirim zilim hiç dolmuyor</td><td>Zil, birincil ya da ikincil danışmanı siz olduğunuz talepler için çalışır; danışman kaydınız/eşleşmeniz yoksa kişisel uyarı üretilmez.</td><td>Danışman kaydı e-postasını, eşleşmeyi ve atamayı kontrol edin.</td></tr>
      <tr><td>“Bu işlem için yetkiniz yok” / “Veritabanı erişim izni reddedildi”</td><td>Rolünüz bu işleme izin vermiyor (ör. Danışman firma düzenliyor, PM sözleşme bedeli okuyor) veya güncel kurallar yayınlanmamış.</td><td>Yetki matrisine bakın (Bölüm 1.1); kurallar için Bölüm 6.5.</td></tr>
      <tr><td>Durum güncellenirken “başka biri değiştirdi / geçersiz geçiş” uyarısı</td><td>Ekran açıkken talebin durumu başka biri veya otomasyon tarafından değişti; ya da seçilen geçiş matriste yok.</td><td>Ekran gerçek duruma yenilenir; izinli seçeneklerle yeniden deneyin (Bölüm 2.4).</td></tr>
      <tr><td>Toplu işlemde bazı talepler “atlandı”</td><td>Talep kapalı/arşivde ya da hedef durum o talep için izinli geçiş değil.</td><td>Özet penceresindeki nedene bakın; atlananları tek tek işleyin.</td></tr>
      <tr><td>PRJ talebi oluşturulamıyor: “proje seçimi zorunludur”</td><td>Firmanın aktif projesi yok ya da proje seçilmedi.</td><td>Önce Projeler sayfasından projeyi ekleyin (Bölüm 4.2).</td></tr>
      <tr><td>Kullanıcı oluşturulamadı: “Bu e-posta adresi zaten kayıtlı / kullanımda”</td><td>E-posta Firebase kimlik doğrulamasında (profili olmasa bile) ya da kullanıcı listesinde zaten var.</td><td>Profilsiz (yetim) hesapsa <em>Yetim Hesabı Onar</em>; profili varsa mevcut hesabı <em>Aktive Et</em> veya <em>Şifre Sıfırla</em> ile kurtarın (Bölüm 3.2).</td></tr>
      <tr><td>Kullanıcı Yeni Kullanıcı penceresinde “Eski yöntem kullanılıyor” uyarısı</td><td>Sunucuda <code>FIREBASE_SERVICE_ACCOUNT</code> tanımlı değil (ya da işlev dağıtılmamış).</td><td>Bölüm 6.3'teki adımlarla servis hesabını ekleyin, yeniden dağıtın.</td></tr>
      <tr><td>“Bu e-posta adresi bir danışman kaydına ait; müşteri kullanıcısı olarak eklenemez”</td><td>Aynı e-posta hem personel hem müşteri olamaz.</td><td>Müşteri için farklı bir e-posta kullanın.</td></tr>
      <tr><td>Kullanıcı davet e-postasını almadı / bağlantı çalışmıyor</td><td>Bağlantı kısa süreli ve tek kullanımlıktır; e-posta spam'e düşmüş ya da gönderilememiş olabilir.</td><td>Kullanıcı ayrıntısında <em>Şifre Sıfırla</em> ile yeni bağlantı gönderin (gönderilemezse bağlantıyı pencereden güvenli kanaldan iletin); Aktiviteler'de <em>E-posta Gönderilemedi</em> kaydına bakın.</td></tr>
      <tr><td>Kullanıcı giriş yapamıyor</td><td>Hesap pasif, şifre hatalı veya “Çok fazla başarısız deneme” kilidi.</td><td>Hesabı <em>Aktive Et</em>; birkaç dakika bekleyin; <em>Şifre Sıfırla</em> gönderin.</td></tr>
      <tr><td>“Oturumunuz uzun süre boşta kaldığı için sona erdi”</td><td>Boşta oturum zaman aşımı: personelde 8 saat, müşteride 30 gün.</td><td>Yeniden giriş yapın.</td></tr>
      <tr><td>Müşteri “yeni talep açamıyorum / tip listesinde SUP/ARZ yok” diyor</td><td>Talep tipi firma türüne kilitlidir (CUS → SUP/BUG, ARC → ARZ/BUG) ya da firma pasife alınmıştır.</td><td>Firma tipini ve durumunu kontrol edin (Bölüm 3.1); gerekirse talebi personel olarak açın.</td></tr>
      <tr><td>Müşteri kapanmış talebi yeniden açamıyor</td><td>Kapanıştan sonra 14 gün geçmiş (kuralda da zorlanır).</td><td>Yönetici <em>Yeniden Aç</em> ile açabilir ya da yeni talep açılır.</td></tr>
      <tr><td>“Gönderilemedi” uyarısı ve Aktiviteler'de E-posta Gönderilemedi</td><td>E-posta hattında sorun.</td><td>Köşeli parantezdeki hata koduna göre Bölüm 6.2 tablosuna bakın; <em>Test E-postası</em> ile deneyin.</td></tr>
    </tbody>
  </table>

  <h2>Sık sorulan sorular</h2>
  ${L.faq([
    ["Müşteri adına talep açtım ama müşteri e-posta almadı.", `<p>Müşteriye “Talebiniz alındı” e-postası yalnızca <strong>Muhatap</strong> seçtiyseniz gider. Muhatap boşsa talep sizin adınıza açılır (Bölüm 2.2).</p>`],
    ["Bir danışmanın tüm taleplerini başkasına nasıl devrederim?", `<p>Talepler listesinde danışmana göre süzüp tümünü işaretleyin (en çok 300), <strong>Toplu Ata</strong> ile yeni danışmanı seçin ve <em>Yerine ata</em>'yı işaretleyin (Bölüm 2.1). Toplu atamada e-posta gitmez; talepler yeni danışmanın zilinde görünür.</p>`],
    ["Yanlış durum seçtim, geri alabilir miyim?", `<p>İzinli geçiş matrisi geri alma geçişlerini içerir (<em>İşleme Geri Al</em>, <em>Çözümü Geri Al</em>). Süper Admin matris dışı bir geçişi gerekçeyle yapabilir. Gönderilmiş e-posta geri alınamaz.</p>`],
    ["İç not müşteriye görünür mü?", `<p>Hayır. İç notlar ve ekleri ayrı düğümde, yalnızca personel okuma kuralıyla tutulur; e-posta da üretmez.</p>`],
    ["Firma veya kullanıcıyı silebilir miyim?", `<p>Hayır. Firma, kullanıcı ve danışman kayıtları <em>pasife alınır</em> (kullanıcı pasife alınınca Firebase hesabı da kapanır); böylece eski talepler ve raporlar bozulmaz. Silinebilen tek şey talep (arşive alma, Süper Admin için kalıcı silme) ve — danışmanı olmayan — departmandır.</p>`],
    ["Silinen bir talebi geri getirebilir miyim?", `<p>Arşivdeyse evet: Talepler → <em>Arşiv (Silinenler)</em> → <em>Geri Yükle</em> (Süper Admin / Destek Atayıcı). <em>Kalıcı Sil</em> ile silinen talep geri getirilemez; ancak yedekten tek kayıt olarak geri yüklenebilir (<code>docs/runbook.md</code> §4).</p>`],
    ["Müşteri kapanış onayını vermezse ne olur?", `<p>3. günde müşteriye hatırlatma gider; 10. günde talep otomatik kapatılır (müşteri ve danışmana e-posta). Müşteri 14 gün içinde yeniden açabilir. Müşteri bu sürede yanıt yazarsa talep otomatik <em>Yeniden Açıldı</em> olur.</p>`],
    ["Bir talep neden hâlâ “SLA aşıldı” gösteriyor, durumu Müşteri Bekleniyor yaptım?", `<p>Duraklama bekleme süresince saati durdurur ama <em>önceden gerçekleşmiş</em> aşım damgası kalıcıdır. Rozet “SLA duraklatıldı (aşıldı)” der; zilde yeni uyarı çıkmaz.</p>`],
  ])}

  <h2>Sözlük</h2>
  <table class="glossary">
    <thead><tr><th>Terim</th><th>Açıklama</th></tr></thead>
    <tbody>
      <tr><td>Talep</td><td>Portal üzerinden açılan destek, arıza veya iş kaydı (müşteri ve yönetim tarafında aynı terim).</td></tr>
      <tr><td>Muhatap</td><td>Bir talebin müşteri tarafındaki kişisi (talep sahibi); personel hesapları için kullanılmaz.</td></tr>
      <tr><td>Kullanıcı</td><td>Portalda hesabı olan kişi; <em>Kullanıcılar</em> sayfası müşteri ve personel hesaplarının listesidir.</td></tr>
      <tr><td>Danışman</td><td>Taleplere atanabilen personel kaydı (<em>Danışmanlar</em> sayfası); kullanıcı hesabından ayrıdır, e-posta ve kimlik bağıyla eşleşir.</td></tr>
      <tr><td>Birincil danışman</td><td>Talepteki sorumlu danışman; liste, iş yükü, performans, zil ve müşteri e-postalarında esas alınır.</td></tr>
      <tr><td>Hızlı İşlem</td><td>Mevcut duruma uygun sonraki adımı tek düğmeyle (notla) uygulayan Admin Paneli kısayolu.</td></tr>
      <tr><td>Toplu işlem</td><td>Listede işaretlenen (en çok 300) taleplere toplu atama veya toplu durum değişikliği uygulama.</td></tr>
      <tr><td>Arşiv (yumuşak silme)</td><td>Talebin silinmiş sayılıp listelerden kalkması; veriler korunur, geri yüklenebilir. <em>Kalıcı silme</em> yalnızca Süper Admin'dedir.</td></tr>
      <tr><td>İç not</td><td>Yalnızca personelin gördüğü, e-posta üretmeyen not.</td></tr>
      <tr><td>Hazır yanıt</td><td>Yanıt kutusuna <code>{musteri_adi}</code>, <code>{talep_no}</code>, <code>{danisman}</code> değişkenleriyle eklenen şablon metin.</td></tr>
      <tr><td>SLA<small>hizmet seviyesi hedefi</small></td><td>Önceliğe göre ilk yanıt ve çözüm için 7/24 takvim saati hedefi (SUP, ARZ, BUG); müşteri bekleniyor ve kapanış onayı durumlarında durur.</td></tr>
      <tr><td>Otomasyon</td><td>Sunucuda 30 dakikada bir çalışan SLA uyarısı, hatırlatma, otomatik kapanış ve eskalasyon işlevi.</td></tr>
      <tr><td>Yetim hesap</td><td>Firebase'de hesabı olan ama portalda profili olmayan (yarım kalmış oluşturma) hesap.</td></tr>
      <tr><td>Davet</td><td>Kullanıcıya şifre içermeyen bir e-postayla şifre belirleme bağlantısı gönderilerek hesap açılması.</td></tr>
      <tr><td>Resend</td><td>E-postaları gönderen servis; gönderen alan adı doğrulanmış olmalıdır (SPF/DKIM).</td></tr>
      <tr><td>Netlify Function</td><td><code>/api/send-email</code> ve <code>/api/admin-users</code> adreslerini sunan, e-postayı üreten / hesapları yöneten sunucu işlevleri.</td></tr>
      <tr><td>Aktivite günlüğü</td><td>Değiştirilemez denetim kaydı (Aktiviteler sayfası).</td></tr>
    </tbody>
  </table>

  <h2>Bize ulaşın</h2>
  <div class="cards cols-2">
    <div class="card blue"><div class="ico" data-ico="mail"></div><h4>E-posta</h4><p>info@parlabilgiteknolojileri.net<br>Destek kutusu; talep numarasını konuya yazın.</p></div>
    <div class="card red"><div class="ico" data-ico="phone"></div><h4>Telefon</h4><p>+90 530 226 77 98<br>Üretimi durduran acil sorunlarda.</p></div>
  </div>
</section>`;
