module.exports = (L) => `
<section class="chapter" data-opener="false" data-title="Talep Yönetimi"
         data-intro="Talep listesi, filtreler, yeni talep oluşturma, ayrıntı sayfası, durum yaşam döngüsü, atama, efor, SLA ve e-posta bildirimleri.">
  <h1>Talep Yönetimi</h1>

  <h2>Talep listesi ve filtreler</h2>
  ${L.who()}
  <p>${L.menu("Ticketlar")} sayfası <strong>tüm firmaların tüm taleplerini</strong> listeler; her personel rolü hepsini görür (sayfa başına 25 kayıt). Talep numarası veya <span class="ui-btn outline">Düzenle</span> ayrıntıyı açar.</p>
  ${L.fig("a02-liste", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/admin/tickets.html", caption: "Ticketlar listesi (Destek Atayıcı; ilk beş satır).",
    legend: ["<strong>Yeni Ticket</strong> — müşteri adına talep açar.", "<strong>CSV / Excel</strong> — süzülmüş listeyi indirir.", "<strong>Durum çipleri</strong> — birden fazlası seçilebilir.", "<strong>Arama</strong> — numara, konu, firma, kullanıcı, danışman, müşteri kodu.", "<strong>Sıralama</strong> — En Yeni, En Eski, Öncelik, Durum, No.", "<strong>Gelişmiş Filtre</strong>", "<strong>Tip çipleri</strong> — SUP, ARZ, PRJ, INT, DEV, BUG.", "<strong>SLA</strong> — hedef durumu (Bölüm 2.7).", "<strong>Onay kutusu</strong> — iç takip işareti.", "<strong>Sil</strong> — yalnızca Süper Admin / Destek Atayıcı."], cols2: true })}
  ${L.fig("a02-filtre", { wide: true, bare: true, caption: "Filtre örneği: İşlemde + Atandı, Yüksek öncelik, danışman Zeynep Arslan.",
    legend: ["<strong>Seçili çipler</strong> mavi görünür.", "<strong>Arama</strong> çiplerle birlikte çalışır.", "<strong>SAP Modülü</strong> / Öncelik listeleri.", "<strong>Danışman</strong> — birincil danışman.", "<strong>Firma</strong> — yazınca öneri çıkar; listeden seçin.", "<strong>Sadece atanmamış</strong>", "<strong>Uygula</strong> — gelişmiş filtreyi çalıştırır.", "<strong>Tip çipleri</strong>"], cols2: true })}
  <ul>
    <li><strong>Filtre mantığı:</strong> aynı gruptaki çipler “veya”, gruplar “ve” ile birleşir. Çipler ve arama <em>anında</em>, Gelişmiş Filtre (modül, öncelik, danışman, firma, oluşturma tarihi aralığı, atanmamış) <strong>Uygula</strong> ile çalışır. Arama büyük/küçük harf duyarsızdır ve yazdığınız ifadeyi bütün olarak arar.</li>
    <li><strong>Dışa aktarma:</strong> CSV (virgül ayraçlı, Türkçe için BOM'lu) ve Excel dosyaları <em>süzülmüş</em> listenin tüm sayfalarını içerir: NO, KONU, MÜŞTERİ NO/UNVAN, DANIŞMAN, EFOR, ONAY, TARİH, DURUM, ÖNCELİK, TİP, SAP MODÜL. Excel için tarayıcının internetten bir kütüphane yükleyebilmesi gerekir.</li>
    <li><strong>ONAY kutusu</strong> yalnızca iç takip işaretidir (dışa aktarmada Evet/Hayır); durumu veya müşteri onayını etkilemez. <strong>Sil</strong> onaydan sonra talep kaydını kaldırır ve Aktiviteler'e yazar; mesaj, geçmiş, efor ve ekler silinmez — mümkünse talebi <em>Kapandı</em> yapın.</li>
  </ul>

  <h2>Yeni talep oluşturma</h2>
  ${L.who()}
  ${L.side("a02-yeni-ticket", { lc: "70mm", caption: "Yeni Ticket Oluştur.",
    legend: ["<strong>Talep Tipi</strong> * — altı tipin tamamı (müşteri yalnızca SUP/ARZ/BUG görür).", "<strong>Öncelik</strong> *", "<strong>Firma</strong> * — listeden seçin; yoksa <em>Yeni firma kaydet</em>.", "<strong>Muhatap</strong> — firmanın kullanıcıları.", "<strong>SAP Modülü</strong> *", "<strong>Konu</strong> * (5–100 karakter)", "<strong>Açıklama</strong> * (en az 20 karakter)", "<strong>Oluştur</strong>"],
    body: `
      <ul>
        <li><strong>Yeni firma kaydet</strong> seçilirse firma adı, müşteri tipi (CUS/ARC) ve önerilen müşteri kodu istenir. Talep <strong>Açık</strong> durumunda açılır; numara <code>TİP-MÜŞTERİ-MODÜL-YYAA-SIRA</code> biçimindedir (sıra tip + müşteri kodu + ay bazında).</li>
        <li><strong>Muhatap</strong> seçerseniz talep onun adına açılır ve ona “Talebiniz alındı” e-postası gider; boş bırakırsanız sahibi <strong>siz</strong> olursunuz ve e-posta gitmez.</li>
        <li>${L.rb("pm")}${L.rb("dn")} rollerinde Muhatap listesi boştur ve yeni firma kaydı yetki hatası verir.</li>
      </ul>` })}

  <h2>Talep ayrıntısı ve Admin Paneli</h2>
  <p>Ayrıntı sayfası şu bölümlerden oluşur: <strong>başlık ve künye</strong>, <strong>Admin Paneli</strong> (danışmanlar için <em>Danışman Paneli</em>) ile <strong>Müşteri Bilgileri</strong>, <strong>Atanan Danışmanlar</strong>, <strong>Efor Kayıtları</strong>, <strong>İç Notlar</strong> ve <strong>Mesajlar &amp; Geçmiş</strong>.</p>
  ${L.fig("a02-detay-ust", { wide: true, caption: "Talep başlığı ve künye.",
    legend: ["<strong>Tip</strong> rozeti.", "<strong>Durum</strong> rozeti.", "<strong>Öncelik</strong> rozeti.", "<strong>SLA</strong> — o anki hedef durumu.", "<strong>İlk Yanıt</strong> — personelin ilk herkese açık yanıtı.", "<strong>Toplam Efor</strong> — efor kayıtlarının toplamı."], cols2: true })}
  ${L.who("sa", "da", "pm")}
  ${L.side("a02-admin-paneli", { lc: "70mm", caption: "Admin Paneli.",
    legend: ["<strong>Hızlı İşlemler</strong> — mevcut duruma uygun sonraki adımlar (Bölüm 2.4).", "<strong>Durum</strong> — sekiz durumun hepsine geçilebilir.", "<strong>Öncelik</strong> — Düşük … Kritik.", "<strong>Ata</strong> — işaretli danışmanlar talepte çalışır.", "<strong>Birincil</strong> — sorumlu danışman (tek).", "<strong>Durum Değişiklik Notu</strong> — durum değişince en az 10 karakter zorunlu.", "<strong>Güncelle</strong> — durum, öncelik ve atamayı birlikte kaydeder."],
    body: `
      <ul>
        <li>Hiçbir şey değişmediyse “Değişiklik yapılmadı” çıkar. Not, geçmişe yazılır ve müşteriye giden e-postada gösterilir.</li>
        <li>Her durum, öncelik ve danışman değişikliği <em>Geçmiş</em>'e satır olur (atama iki satır görünebilir). Öncelik değişikliği e-posta üretmez; müşterinin zilinde görünür.</li>
        <li>Durum listesi her geçişe izin verir; sıradan akış için Hızlı İşlemler daha güvenlidir. <em>Çözüldü</em>'ye yalnızca buradan geçilir.</li>
        <li>Sağdaki <strong>Müşteri Bilgileri</strong> kartı muhatap, e-posta, firma, müşteri no ve danışmanları gösterir (bağlantılıdır).</li>
      </ul>` })}

  <h2>Durum yaşam döngüsü</h2>
  <div class="flow">
    <div class="node open"><span class="n">1</span>Açık<small>Talep geldi</small></div><span class="arrow"></span>
    <div class="node assigned"><span class="n">2</span>Atandı<small>Danışman atandı</small></div><span class="arrow"></span>
    <div class="node in_progress"><span class="n">3</span>İşlemde<small>İşleme Al</small></div><span class="arrow"></span>
    <div class="node waiting_customer"><span class="n">4</span>Müşteri Bekleniyor<small>Test / bilgi</small></div><span class="arrow"></span>
    <div class="node pending_close"><span class="n">5</span>Kapanış Onayı<small>Müşteri onayı</small></div><span class="arrow"></span>
    <div class="node closed"><span class="n">6</span>Kapandı<small>Tamamlandı</small></div>
  </div>
  <p>Müşteri kapanışı reddederse talep <em>Tekrar Açıldı</em>'ya döner ve çalışma yeniden başlar. Aşağıdaki tablo her durumda ne yapılacağını, <strong>Hızlı İşlem</strong> düğmesini ve müşteriye giden e-postayı özetler.</p>
  <table class="fields w3">
    <thead><tr><th>Durum</th><th>Anlamı</th><th>Hızlı işlem → sonuç · e-posta</th></tr></thead>
    <tbody>
      <tr><td>${L.ST.open}</td><td>Talep geldi, danışman yok; “Atanmamış” sayılır.</td><td>Danışman atayın (Açık → Atandı otomatik).</td></tr>
      <tr><td>${L.ST.assigned}</td><td>Danışman atandı.</td><td><strong>İşleme Al</strong> → İşlemde (not sorulmaz) · “Durum güncellendi”.</td></tr>
      <tr><td>${L.ST.in_progress}</td><td>Çalışma sürüyor.</td><td><strong>Müşteri Testine Gönder</strong> → Müşteri Bekleniyor · “İncelemeniz bekleniyor”. <strong>Kapanış Onayı İste</strong> → Kapanış Onayı · “Kapanış onayı”.</td></tr>
      <tr><td>${L.ST.waiting_customer}</td><td>Müşteri yanıtı bekleniyor; SLA “duraklatıldı”. Müşteri yanıtlayınca talep otomatik <em>İşlemde</em> olur.</td><td><strong>İşleme Geri Al</strong> → İşlemde · “Durum güncellendi”. Kapanış Onayı İste de yapılabilir.</td></tr>
      <tr><td>${L.ST.pending_close}</td><td>Çözüm tamamlandı; müşteri onayı bekleniyor (onaylarsa Kapandı, reddederse Tekrar Açıldı).</td><td><strong>İşleme Geri Al</strong>. <span class="rb mgr">yönetici roller</span> <strong>Müşteri Adına Kapat</strong> → Kapandı · “Talep kapatıldı”.</td></tr>
      <tr><td>${L.ST.resolved}</td><td>Yalnızca Durum listesinden verilir; çözüm zamanı bir kez kaydedilir. Müşteri bunu da onaylayıp kapatabilir.</td><td><span class="rb mgr">yönetici roller</span> <strong>Kapat</strong> → Kapandı · “Talep kapatıldı”.</td></tr>
      <tr><td>${L.ST.closed}</td><td>Tamamlandı; müşteri 14 gün içinde yeniden açabilir.</td><td><span class="rb mgr">yönetici roller</span> <strong>Yeniden Aç</strong> → Tekrar Açıldı (kapanış zamanı silinir).</td></tr>
      <tr><td>${L.ST.reopened}</td><td>Müşteri veya yönetici yeniden açtı; birincil danışmana “Müşteri talebi yeniden açtı” bildirimi düşer.</td><td>İşlemde ile aynı düğmeler.</td></tr>
    </tbody>
  </table>
  <div class="shot-row three">
    ${L.fig("a02-hizli-acik", { bare: true, nonum: true, caption: "Açık / Atandı" })}
    ${L.fig("a02-hizli-islemde", { bare: true, nonum: true, caption: "İşlemde / Tekrar Açıldı" })}
    ${L.fig("a02-hizli-musteri", { bare: true, nonum: true, caption: "Müşteri Bekleniyor" })}
    ${L.fig("a02-hizli-onay", { bare: true, nonum: true, caption: "Kapanış Onayı Bekliyor (yönetici)" })}
    ${L.fig("a02-hizli-cozuldu", { bare: true, nonum: true, caption: "Çözüldü (yönetici)" })}
    ${L.fig("a02-hizli-kapandi", { bare: true, nonum: true, caption: "Kapandı (yönetici)" })}
  </div>
  ${L.side("a02-durum-penceresi", { lc: "83mm", caption: "Müşteri Testine Gönder: not penceresi.",
    legend: ["<strong>Not</strong> — en az 10 karakter; geçmişe yazılır ve müşteriye iletilir.", "<strong>… Olarak Kaydet</strong> — durumu değiştirir, e-postayı gönderir."],
    body: `
      ${L.tip("Notu müşterinin okuyacağını varsayarak yazın: ne yapıldı, neyi kontrol etmeli, nereden bakmalı.")}
      ${L.warn("<strong>Müşteri Adına Kapat</strong>, müşterinin onayını beklemeden kapatır; yalnızca müşteri telefonla/e-postayla onayladıysa kullanın ve notta belirtin.")}` })}

  <h2>Danışman atama ve efor</h2>
  <p>Bir talebe birden çok danışman atanabilir; biri <strong>birincil</strong> danışmandır: listelerde “Danışman” olarak görünür, iş yükü/performans tablolarında sayılır ve bildirim zili uyarıları onun adına üretilir.</p>
  <ul>
    <li><strong>Ata</strong> kutusunu işaretleyin; ilk işaretlenen otomatik birincil olur, <strong>Birincil</strong> düğmesini seçmek danışmanı da atar, birincilin işaretini kaldırırsanız birincillik sıradakine geçer. Yalnızca <em>aktif</em> danışmanlar listelenir ve en az biri işaretli kalmalıdır.</li>
    <li>Kayıtta atama zamanı yenilenir; <em>Açık/Atandı</em> talep <em>Atandı</em> olur, diğer durumlar değişmez. <strong>Yeni</strong> atananlara (işlemi yapan hariç) “Size atanan talep” e-postası gider; müşteriye gitmez.</li>
  </ul>
  ${L.fig("a02-efor", { wide: true, caption: "Efor Kayıtları.",
    legend: ["<strong>Sil</strong> — efor kaydını siler (yöneticiler).", "<strong>Saat</strong> — en az 0,25; 0,25'lik adımlarla.", "<strong>Tarih</strong> — çalışmanın yapıldığı gün.", "<strong>Not</strong> — yapılan iş.", "<strong>Efor Ekle</strong> — kaydı ekler, toplamı günceller."], cols2: true })}
  <ul>
    <li>Efor, oturum e-postanızla eşleşen <em>Danışmanlar</em> kaydı adına yazılır; yöneticilerin kaydı yoksa talebin birincil danışmanı (o da yoksa kendi adınız), danışmanların kaydı yoksa <em>“Personel kaydınız bulunamadı”</em> uyarısı çıkar. Yanıt kutusundaki <strong>Efor (saat)</strong> alanı da aynı şekilde kayıt üretir (<em>“Mesaj: …”</em>).</li>
    <li>Ekleyebilenler: yöneticiler ve talebe atanmış ${L.rb("dn")}; silebilenler yalnızca yöneticiler. Toplam efor Firma ayrıntısı ve Raporlar'da kullanılır.</li>
  </ul>

  <h2>Yanıt, iç not ve ek dosya</h2>
  <p><strong>Mesajlar</strong> müşteriyle yazışmayı, <strong>İç Notlar</strong> yalnızca personelin gördüğü notları gösterir; müşteri iç notları ne arayüzde ne veritabanında okuyabilir. Yanıt kutusu tüm personel rolleri için açıktır.</p>
  <ul>
    <li><strong>Herkese açık yanıt</strong> yalnızca talep sahibine “Yeni yanıt” e-postası yollar (firma yöneticisine/diğer personele gitmez); iç not e-posta üretmez.</li>
    <li><strong>İlk yanıt:</strong> personelin ilk <em>herkese açık</em> mesajı “İlk Yanıt” zamanını yazar ve SLA'nın ilk yanıt hedefini kapatır; iç not, durum değişikliği ve atama sayılmaz.</li>
    <li><strong>Ek dosya:</strong> mesaj başına en çok 3 dosya, her biri en çok 2 MB (görsel, PDF, Office, metin/CSV/LOG, ZIP). 300 KB üstü görseller en uzun kenar 1800 piksel olacak biçimde küçültülür. İç not ekleri yalnızca personele açıktır.</li>
  </ul>
  ${L.fig("a02-yanit", { caption: "Mesajlar & Geçmiş ve yanıt kutusu (ilk mesaj gizlendi).",
    legend: ["<strong>Mesajlar</strong> sekmesi.", "<strong>Geçmiş</strong> sekmesi.", "<strong>Müşteri mesajı</strong>", "<strong>Ek dosya</strong> — tıklayınca açılır/iner.", "<strong>Yanıt Yaz</strong> — en az 3 karakter.", "<strong>Dosya Ekle</strong> — en çok 3 dosya.", "<strong>İç not olarak kaydet</strong> — müşteriye görünmez, e-posta gitmez.", "<strong>Efor (saat)</strong> — isteğe bağlı.", "<strong>Gönder</strong>"], cols2: true })}
  <div class="shot-row">
    ${L.fig("a02-ic-not", { bare: true, nonum: true, caption: "İç Notlar bölümü (turuncu çizgi: personele özel).", legend: ["<strong>İç not</strong> — yalnızca personel okur."] })}
    ${L.fig("a02-gecmis", { bare: true, nonum: true, caption: "Geçmiş sekmesi.", legend: ["<strong>Geçmiş</strong> sekmesi.", "<strong>Yeni</strong> değer.", "<strong>Not</strong> — durum notları."] })}
  </div>

  <h2>SLA ve ilk yanıt</h2>
  <p>Hedefler <strong>takvim saati</strong> olarak önceliğe göre hesaplanır ve yalnızca <strong>SUP, ARZ, BUG</strong> taleplerine uygulanır (PRJ, INT, DEV için “—”). Saat, talebin oluşturulduğu andan başlar.</p>
  <div class="shot-row">
    <table class="fields" style="margin:0">
      <thead><tr><th>Öncelik</th><th>İlk yanıt</th><th>Çözüm</th></tr></thead>
      <tbody>
        <tr><td>${L.PR.critical}</td><td>1 saat</td><td>8 saat</td></tr>
        <tr><td>${L.PR.high}</td><td>4 saat</td><td>24 saat</td></tr>
        <tr><td>${L.PR.medium}</td><td>8 saat</td><td>72 saat</td></tr>
        <tr><td>${L.PR.low}</td><td>24 saat</td><td>120 saat</td></tr>
      </tbody>
    </table>
    <ul style="margin:0;font-size:9.4pt;line-height:1.45">
      <li><strong>Rozet:</strong> önce ilk yanıt, yanıt gelince çözüm hedefi (<em>“İlk yanıt: 2 sa kaldı”</em>, <em>“Çözüm aşıldı +1 sa”</em>). Kalan süre %25'in altına inince sarı, aşılınca kırmızı; kapanmış talepte “SLA karşılandı/aşıldı”.</li>
      <li><strong>Müşteri Bekleniyor:</strong> “SLA duraklatıldı”, aşım/uyarı üretmez; ancak hedef zamanı ertelenmez.</li>
      <li>Çözüm hedefi <em>Çözüldü/Kapandı</em> ile kapanır; <em>Kapanış Onayı</em> iken saat işler. Aşımlar Genel Bakış'ta ve birincil danışmanın zilinde görünür.</li>
    </ul>
  </div>

  <h2>Danışman görünümü</h2>
  ${L.who("dn")}
  <p>Danışman tüm talepleri görür ama yalnızca <strong>kendisine atanmış</strong> talepte işlem yapar; atama, oturum e-postasının <em>Danışmanlar</em> kaydıyla eşleşmesine dayanır. Atanmamış talepte yalnızca bilgi kutusu görünür (yanıt kutusu yine açıktır); atanmış talepte panel Hızlı İşlemleri gösterir.</p>
  <div class="shot-row">
    ${L.fig("a02-danisman-kisitli", { bare: true, nonum: true, caption: "Atanmamış talep.", legend: ["<strong>Yalnızca görüntüleme</strong> uyarısı."] })}
    ${L.fig("a02-danisman-paneli", { bare: true, nonum: true, caption: "Atanmış talep: Danışman Paneli.", legend: ["<strong>Hızlı İşlemler</strong>"] })}
  </div>

  <h2>E-posta bildirimleri</h2>
  <p>E-postaları işlemi yapanın tarayıcısı portalın e-posta servisine gönderir (Netlify Function → Resend). <strong>İşlemi yapan kişiye e-posta gitmez.</strong> Talep sahibi müşteri bağlantılı, diğer alıcılar personel (admin ayrıntı) bağlantılı e-posta alır.</p>
  <table class="fields">
    <thead><tr><th>Olay</th><th>Konu</th><th>Alıcı</th></tr></thead>
    <tbody>
      <tr><td>Müşteri talep açar</td><td>Talebiniz alındı · Yeni destek talebi</td><td>Müşteri + destek kutusu (<code>info@parlabilgiteknolojileri.net</code>)</td></tr>
      <tr><td>Personel talep açar (muhatap seçili)</td><td>Talebiniz alındı</td><td>Yalnızca muhatap</td></tr>
      <tr><td>Danışman atanır</td><td>Size atanan talep</td><td>Yeni atanan danışman(lar)</td></tr>
      <tr><td>Durum değişir (İşleme Al/Geri Al, Yeniden Aç, Çözüldü, Kapandı)</td><td>Durum güncellendi · Talep çözüldü · Talep kapatıldı</td><td>Müşteri + atanmış danışmanlar</td></tr>
      <tr><td>Müşteri Testine Gönder · Kapanış Onayı İste</td><td>İncelemeniz bekleniyor · Kapanış onayı</td><td>Yalnızca müşteri</td></tr>
      <tr><td>Personel herkese açık yanıt yazar</td><td>Yeni yanıt</td><td>Yalnızca talep sahibi</td></tr>
      <tr><td>Müşteri yanıt yazar</td><td>Yeni yanıt</td><td>Destek kutusu + atanmış danışmanlar</td></tr>
      <tr><td>Müşteri kapanışı onaylar / yeniden açar</td><td>Talep kapatıldı · Talep tekrar açıldı</td><td>Destek kutusu + atanmış danışmanlar</td></tr>
      <tr><td>İç not, öncelik değişikliği, efor</td><td>—</td><td>E-posta gitmez</td></tr>
    </tbody>
  </table>
  <div class="shot-row three">
    ${L.fig("a02-eposta-atama", { bare: true, nonum: true, caption: "Danışmana: Size atanan talep" })}
    ${L.fig("a02-eposta-durum", { bare: true, nonum: true, caption: "Müşteriye: Durum güncellendi" })}
    ${L.fig("a02-eposta-cozuldu", { bare: true, nonum: true, caption: "Müşteriye: Talep çözüldü" })}
  </div>
  <div class="shot-row three">
    ${L.fig("a02-eposta-musteri-testi", { bare: true, nonum: true, caption: "Müşteriye: İncelemeniz bekleniyor" })}
    ${L.fig("a02-eposta-kapanis-onayi", { bare: true, nonum: true, caption: "Müşteriye: Kapanış onayı" })}
    ${L.fig("a02-eposta-yeniden-acildi", { bare: true, nonum: true, caption: "Personele: Talep tekrar açıldı" })}
  </div>
  ${L.info("Gönderim hataları sessiz geçmez: ekranda uyarı çıkar ve Aktiviteler'e “E-posta Gönderilemedi” yazılır. Geçici hatalar tarayıcı kuyruğuna alınıp yeniden denenir (Bölüm 6.2).", "Hata durumunda")}
</section>`;
