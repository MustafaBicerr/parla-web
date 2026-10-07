module.exports = (L) => `
<section class="chapter" data-opener="false" data-title="Talep Yönetimi"
         data-intro="Talep listesi, filtreler, toplu işlemler, arşiv, yeni talep oluşturma, ayrıntı sayfası, durum yaşam döngüsü, atama, efor, hazır yanıtlar, SLA, otomasyon ve e-posta bildirimleri.">
  <h1>Talep Yönetimi</h1>

  <h2>Talep listesi ve filtreler</h2>
  ${L.who()}
  <p>${L.menu("Talepler")} sayfası <strong>tüm firmaların tüm taleplerini</strong> listeler; her personel rolü (danışman dahil) hepsini görür. Sayfa başına 25 kayıt gösterilir (sayfa boyutu listenin üstünden değişir); sütun başlıklarına tıklayarak sıralayabilirsiniz. Talep numarası veya <span class="ui-btn outline">Düzenle</span> ayrıntıyı açar. Dar ekranlarda (telefon, dikey tablet) tablo satırları <strong>kartlara</strong> dönüşür; her kart bir talebin alanlarını alt alta gösterir.</p>
  ${L.fig("a02-liste", { wide: true, url: "www.parlabilgiteknolojileri.net/support-v2/admin/tickets.html", caption: "Talepler listesi (Destek Atayıcı; ilk beş satır).",
    legend: ["<strong>Yeni Talep</strong> — müşteri adına talep açar.", "<strong>Arşiv (Silinenler)</strong> — silinmiş talepleri gösterir (yalnızca Süper Admin / Destek Atayıcı).", "<strong>CSV / Excel</strong> — süzülmüş listeyi indirir.", "<strong>Durum çipleri</strong> — birden fazlası seçilebilir.", "<strong>Arama</strong> — numara, konu, firma, kullanıcı, danışman, müşteri kodu.", "<strong>Sıralama</strong> — En Yeni, En Eski, Öncelik, Durum, Talep No.", "<strong>Gelişmiş Filtre</strong>", "<strong>Tip çipleri</strong> — SUP, ARZ, PRJ, INT, DEV, BUG.", "<strong>Seç</strong> — toplu işlem için talebi işaretler (Süper Admin, Destek Atayıcı, Proje Yöneticisi).", "<strong>SLA</strong> — hedef durumu (Bölüm 2.7).", "<strong>Onay kutusu</strong> — iç takip işareti.", "<strong>Sil</strong> — talebi arşive alır (Süper Admin / Destek Atayıcı)."], cols2: true })}
  ${L.fig("a02-filtre", { wide: true, bare: true, caption: "Filtre örneği: İşlemde + Atandı, Yüksek öncelik, danışman Zeynep Arslan.",
    legend: ["<strong>Seçili çipler</strong> mavi görünür.", "<strong>Arama</strong> çiplerle birlikte çalışır.", "<strong>SAP Modülü</strong> / Öncelik listeleri.", "<strong>Danışman</strong> — birincil danışman.", "<strong>Firma</strong> — yazınca öneri çıkar; listeden seçin.", "<strong>Atanmamış / sahipsiz (açık)</strong> — danışmanı olmayan ya da tüm danışmanları pasif olan açık talepler.", "<strong>Uygula</strong> — gelişmiş filtreyi çalıştırır.", "<strong>Tip çipleri</strong>"], cols2: true })}
  <ul>
    <li><strong>Filtre mantığı:</strong> aynı gruptaki çipler “veya”, gruplar “ve” ile birleşir. Çipler ve arama <em>anında</em>, Gelişmiş Filtre (modül, öncelik, danışman, firma, oluşturma tarihi aralığı, atanmamış) <strong>Uygula</strong> ile çalışır. Etkin filtreler listenin üstünde <em>Aktif filtreler</em> rozetleri olarak görünür; rozete tıklayarak tek tek, <em>Filtreleri temizle</em> ile hepsini kaldırırsınız. Arama büyük/küçük harf duyarsızdır.</li>
    <li><strong>Dışa aktarma:</strong> CSV (<strong>noktalı virgül ayraçlı</strong>, UTF-8 BOM'lu; Türkçe Excel'de sütunlar doğru ayrılır) ve Excel dosyaları <em>süzülmüş</em> listenin tüm sayfalarını içerir. Hücre başında <code>=</code>, <code>+</code>, <code>-</code>, <code>@</code> bulunan metinler formül çalıştırmaması için nötrlenir. Saatler Türkçe biçimde (virgüllü, ör. 3,5) yazılır. Excel için tarayıcının dışarıdan bir kütüphane yükleyebilmesi gerekir; CSV her zaman çalışır.</li>
    <li><strong>ONAY kutusu</strong> yalnızca iç takip işaretidir; durumu veya müşteri onayını etkilemez.</li>
  </ul>

  <h3>Toplu işlemler</h3>
  ${L.who("sa", "da", "pm")}
  <p>Listede birden çok talebi işaretlediğinizde listenin üstünde <strong>toplu işlem çubuğu</strong> belirir. Başlıktaki kutu görünen satırların tümünü işaretler; “Filtrelenen tüm N talebi seç” bağlantısı süzülmüş listenin tamamını seçer. <strong>Bir seferde en çok 300 talep</strong> işlenir (fazlası seçilirse ilk 300 alınır, uyarı çıkar). Danışman rolünde onay kutuları ve çubuk görünmez.</p>
  ${L.fig("a02-toplu", { wide: true, bare: true, caption: "İki talep işaretlendi: toplu işlem çubuğu listenin üstünde belirir.",
    legend: ["<strong>Seçili talep sayısı</strong> — filtre dışında kalan seçimler ayrıca belirtilir; <em>Seçimi temizle</em> hepsini bırakır.", "<strong>Toplu Ata</strong> — danışman seçme penceresini açar.", "<strong>Toplu Durum</strong> — durum değiştirme penceresini açar.", "<strong>Başlık kutusu</strong> — görünen satırların tümünü işaretler.", "<strong>Satır kutusu</strong> — tek talebi işaretler."], cols2: true })}
  <table class="fields w3">
    <thead><tr><th>İşlem</th><th>Nasıl çalışır?</th><th>Bildirim</th></tr></thead>
    <tbody>
      <tr><td><strong>Toplu Ata</strong></td><td>Bir danışman seçilir. <em>Birincil danışman olarak ata</em> seçilirse mevcut danışmanlar ikincil kalır; <em>Yerine ata</em> seçilirse diğerleri kaldırılır. Pencerede kaç talebin etkileneceği önceden gösterilir; kapalı/çözülmüş talepler atlanır.</td><td>E-posta gönderilmez; talepler atanan danışmanın bildirim zilinde görünür.</td></tr>
      <tr><td><strong>Toplu Durum</strong></td><td>Yeni durum seçilir ve <strong>en az 10 karakterlik not</strong> yazılır (her talebin geçmişine işlenir). İzinli geçiş matrisine uymayan talepler (ve zaten o durumda olanlar) <em>atlanır</em>; özet pencere atlananları ve başarısız olanları nedenleriyle listeler.</td><td>Yalnızca <em>Çözüldü</em> ve <em>Kapandı</em> olayları müşteriye e-postayla bildirilir (bir işlemde en çok 25 e-posta); diğer durumlar bildirimsiz uygulanır.</td></tr>
    </tbody>
  </table>
  ${L.side("a02-toplu-durum", { lc: "74mm", caption: "Toplu Durum Değişikliği penceresi.",
    legend: ["<strong>Yeni durum</strong> — yalnızca matris dahilinde geçilebilen durumlar uygulanır.", "<strong>Durum değişiklik notu</strong> — en az 10 karakter; her talebin geçmişine yazılır.", "<strong>Önizleme</strong> — kaç talebin güncelleneceği, kaçının atlanacağı.", "<strong>Uygula</strong> — işlemi yapar ve özet gösterir."],
    body: `${L.info("Toplu işlem tek bir <em>özet aktivite kaydı</em> olarak Aktiviteler'e yazılır; ayrıntılar her talebin <em>Geçmiş</em> sekmesindedir. Bir talep başka biri tarafından bu arada değiştirilmişse o talep için işlem başarısız sayılır ve özette görünür.")}` })}

  <h3>Silme, arşiv ve kalıcı silme</h3>
  ${L.who("sa", "da")}
  <p>Satırdaki <strong>Sil</strong> talebi gerçekten silmez, <strong>arşive alır</strong> (yumuşak silme): talep listelerden, panodan, raporlardan, zilden ve müşteri sayfalarından kalkar; mesaj, iç not, ek, geçmiş ve eforlar korunur. <strong>Arşiv (Silinenler)</strong> düğmesi arşivdeki talepleri listeler; <strong>Geri Yükle</strong> talebi eski haliyle geri getirir. Arşivdeki talep düzenlenemez, yanıtlanamaz.</p>
  ${L.fig("a02-arsiv", { wide: true, bare: true, caption: "Arşiv görünümü (Süper Admin): geri yükleme ve kalıcı silme.",
    legend: ["<strong>Aktif Taleplere Dön</strong> — arşiv görünümünden çıkar.", "<strong>Geri Yükle</strong> — Süper Admin ve Destek Atayıcı.", "<strong>Kalıcı Sil</strong> — yalnızca Süper Admin."] })}
  ${L.danger("<strong>Kalıcı Sil</strong>, talebi mesajları, iç notları, ekleri, geçmişi, atamaları ve eforlarıyla birlikte veritabanından siler ve <strong>geri alınamaz</strong>. Yalnızca Süper Admin yapabilir; kayıt Aktiviteler'e yazılır. Şüphede talebi arşivde bırakın.", "Geri alınamaz")}

  <h2>Yeni talep oluşturma</h2>
  ${L.who()}
  ${L.side("a02-yeni-ticket", { lc: "70mm", caption: "Yeni Talep Oluştur.",
    legend: ["<strong>Talep Tipi</strong> * — altı tipin tamamı (müşteri yalnızca firmasına göre SUP/BUG ya da ARZ/BUG görür).", "<strong>Öncelik</strong> *", "<strong>Firma</strong> * — listeden seçin; yoksa <em>Yeni firma kaydet</em>.", "<strong>Muhatap</strong> — firmanın kullanıcıları.", "<strong>SAP Modülü</strong> *", "<strong>Konu</strong> * (en az 5 karakter)", "<strong>Açıklama</strong> * (en az 20 karakter)", "<strong>Oluştur</strong>"],
    body: `
      <ul>
        <li><strong>Yeni firma kaydet</strong> seçilirse firma adı, müşteri tipi (CUS/ARC) ve önerilen müşteri kodu istenir. Talep <strong>Açık</strong> durumunda açılır; numara <code>TİP-MÜŞTERİ-MODÜL-YYAA-SIRA</code> biçimindedir (sıra tip + müşteri kodu + ay bazında) ve sonradan değişmez.</li>
        <li><strong>PRJ</strong> tipi seçilirse <strong>Proje</strong> alanı açılır ve <strong>proje seçimi zorunludur</strong> (listede firmanın iptal edilmemiş projeleri çıkar; yoksa önce Projeler sayfasından proje ekleyin).</li>
        <li><strong>Muhatap</strong> seçerseniz talep onun adına açılır ve ona “Talebiniz alındı” e-postası gider; boş bırakırsanız sahibi <strong>siz</strong> olursunuz ve e-posta gitmez.</li>
        <li>${L.rb("pm")}${L.rb("dn")} rollerinde Muhatap listesi boştur (kullanıcı listesini okuyamazlar) ve yeni firma kaydı yetki hatası verir.</li>
      </ul>` })}

  <h2>Talep ayrıntısı ve Admin Paneli</h2>
  <p>Ayrıntı sayfası şu bölümlerden oluşur: <strong>başlık ve künye</strong>, <strong>Admin Paneli</strong> (danışmanlar için <em>Danışman Paneli</em>) ile <strong>Müşteri Bilgileri</strong>, <strong>Atanan Danışmanlar</strong>, <strong>Efor Kayıtları</strong>, <strong>İç Notlar</strong> ve <strong>Mesajlar &amp; Geçmiş</strong>.</p>
  ${L.fig("a02-detay-ust", { wide: true, caption: "Talep başlığı ve künye.",
    legend: ["<strong>Tip</strong> rozeti.", "<strong>Durum</strong> rozeti.", "<strong>Öncelik</strong> rozeti.", "<strong>SLA</strong> — o anki hedef durumu.", "<strong>İlk Yanıt</strong> — personelin ilk herkese açık yanıtı.", "<strong>Toplam Efor</strong> — efor kayıtlarının toplamı."], cols2: true })}
  <p>Künyede ayrıca <em>İşleme Alınma</em>, <em>Çözüm (Kapanış Onayına Geçiş)</em>, <em>Kapanış</em> ve <em>Son Yeniden Açılma</em> zamanları (varsa) ve PRJ taleplerinde bağlı <em>Proje</em> görünür. Bu damgalar durum geçişlerinde otomatik yazılır; yeniden açılışta kapanış zamanı silinir ve yeni bir SLA penceresi başlar.</p>
  ${L.who("sa", "da", "pm")}
  ${L.side("a02-admin-paneli", { lc: "70mm", caption: "Admin Paneli.",
    legend: ["<strong>Hızlı İşlemler</strong> — mevcut duruma uygun sonraki adımlar (Bölüm 2.4).", "<strong>Durum</strong> — yalnızca <em>izinli geçişler</em> listelenir.", "<strong>Öncelik</strong> — Düşük … Kritik.", "<strong>Talep Tipi</strong> — tip değişikliği geçmişe yazılır; PRJ'de proje seçimi çıkar.", "<strong>Ata</strong> — işaretli danışmanlar talepte çalışır.", "<strong>Birincil</strong> — sorumlu danışman (tek).", "<strong>Durum Değişiklik Notu</strong> — durum değişince en az 10 karakter zorunlu.", "<strong>Güncelle</strong> — durum, öncelik, tip, proje ve atamayı birlikte, tek işlemde kaydeder."],
    body: `
      <ul>
        <li>Hiçbir şey değişmediyse “Değişiklik yapılmadı” çıkar. Not, geçmişe yazılır ve müşteriye giden e-postada gösterilir.</li>
        <li>Durum listesi <strong>izinli geçiş matrisini</strong> izler (Bölüm 2.4). Matris dışı bir geçiş yalnızca ${L.rb("sa")} için ayrı bir grupta (<em>Matris dışı</em>) sunulur ve en az 10 karakterlik gerekçe ister.</li>
        <li>Kayıt <strong>koşullu</strong> yazılır: ekranı açtıktan sonra başka biri durumu değiştirdiyse işlem reddedilir, uyarı çıkar ve ekran gerçek duruma yenilenir; yarım kayıt oluşmaz.</li>
        <li>Her durum, öncelik, tip ve danışman değişikliği <em>Geçmiş</em>'e satır olur. Öncelik değişikliği e-posta üretmez (<em>Kritik</em>'e yükseltme hariç: atanmış danışmanlara bildirim gider); müşterinin zilinde görünür.</li>
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
  <p>Müşteri kapanışı reddederse (ya da Kapanış Onayı / Çözüldü iken yanıt yazarsa) talep <em>Yeniden Açıldı</em>'ya döner ve çalışma yeniden başlar. Durum değişimleri bir <strong>izinli geçiş matrisine</strong> bağlıdır: <em>Açık → Atandı → İşlemde ↔ Müşteri Bekleniyor → Kapanış Onayı → Çözüldü → Kapandı</em>; <em>Kapandı → Yeniden Açıldı</em>. Geri alma geçişleri (işleme geri al, çözümü geri al, atamayı kaldırıp <em>Açık</em>'a dönme) da tanımlıdır. Danışman yalnızca <em>İşlemde, Müşteri Bekleniyor, Kapanış Onayı</em> durumlarına geçebilir; kapatma ve yeniden açma yöneticilerdedir. Aşağıdaki tablo her durumda ne yapılacağını, <strong>Hızlı İşlem</strong> düğmesini ve müşteriye giden e-postayı özetler.</p>
  <table class="fields w3">
    <thead><tr><th>Durum</th><th>Anlamı</th><th>Hızlı işlem → sonuç · e-posta</th></tr></thead>
    <tbody>
      <tr><td>${L.ST.open}</td><td>Talep geldi, danışman yok; “Atanmamış” sayılır. Atanmadan 4 saat geçerse atayıcılara hatırlatma gider (Bölüm 2.8).</td><td>Danışman atayın (Açık → Atandı otomatik).</td></tr>
      <tr><td>${L.ST.assigned}</td><td>Danışman atandı.</td><td><strong>İşleme Al</strong> → İşlemde (not sorulmaz) · “Durum güncellendi”.</td></tr>
      <tr><td>${L.ST.in_progress}</td><td>Çalışma sürüyor.</td><td><strong>Müşteri Testine Gönder</strong> → Müşteri Bekleniyor · “İncelemeniz bekleniyor”. <strong>Kapanış Onayı İste</strong> → Kapanış Onayı · “Kapanış onayı”.</td></tr>
      <tr><td>${L.ST.waiting_customer}</td><td>Müşteri yanıtı bekleniyor; SLA saati <strong>durur</strong>. Müşteri yanıtlayınca talep otomatik <em>İşlemde</em> olur. 3. ve 7. günde müşteriye hatırlatma gider (7. günde danışmana da).</td><td><strong>İşleme Geri Al</strong> → İşlemde · “Durum güncellendi”. Kapanış Onayı İste de yapılabilir.</td></tr>
      <tr><td>${L.ST.pending_close}</td><td>Çözüm tamamlandı; müşteri onayı bekleniyor, SLA saati <strong>durur</strong>. Müşteri onaylarsa Kapandı, reddederse ya da yanıt yazarsa Yeniden Açıldı olur. 3. günde hatırlatma, <strong>10. günde otomatik kapanış</strong>.</td><td><strong>İşleme Geri Al</strong>. <span class="rb mgr">yönetici roller</span> <strong>Müşteri Adına Kapat</strong> → Kapandı · “Talep kapatıldı”.</td></tr>
      <tr><td>${L.ST.resolved}</td><td>Durum listesinden verilir (İşlemde'den ya da Kapanış Onayı'ndan); çözüm zamanı bir kez kaydedilir. Müşteri bunu da onaylayıp kapatabilir; yanıt yazarsa talep yeniden açılır.</td><td><span class="rb mgr">yönetici roller</span> <strong>Kapat</strong> → Kapandı · “Talep kapatıldı”. <strong>Çözümü Geri Al</strong> → İşlemde.</td></tr>
      <tr><td>${L.ST.closed}</td><td>Tamamlandı; müşteri <strong>kapanıştan sonra 14 gün</strong> içinde yeniden açabilir (bu sınır veritabanı kurallarında da zorlanır). Kapalı talebe kimse yazamaz; önce yeniden açılmalıdır.</td><td><span class="rb mgr">yönetici roller</span> <strong>Yeniden Aç</strong> → Yeniden Açıldı (kapanış zamanı silinir).</td></tr>
      <tr><td>${L.ST.reopened}</td><td>Müşteri veya yönetici yeniden açtı (ya da müşteri yanıtı üzerine otomatik açıldı); birincil danışmana “Müşteri talebi yeniden açtı” bildirimi düşer. Yeni SLA penceresi başlar.</td><td><strong>İşleme Al</strong>, Müşteri Testine Gönder ve Kapanış Onayı İste düğmeleri.</td></tr>
    </tbody>
  </table>
  <div class="shot-row three">
    ${L.fig("a02-hizli-acik", { bare: true, nonum: true, caption: "Atandı" })}
    ${L.fig("a02-hizli-islemde", { bare: true, nonum: true, caption: "İşlemde / Yeniden Açıldı" })}
    ${L.fig("a02-hizli-musteri", { bare: true, nonum: true, caption: "Müşteri Bekleniyor" })}
    ${L.fig("a02-hizli-onay", { bare: true, nonum: true, caption: "Kapanış Onayı Bekliyor (yönetici)" })}
    ${L.fig("a02-hizli-cozuldu", { bare: true, nonum: true, caption: "Çözüldü (yönetici)" })}
    ${L.fig("a02-hizli-kapandi", { bare: true, nonum: true, caption: "Kapandı (yönetici)" })}
  </div>
  ${L.side("a02-durum-penceresi", { lc: "83mm", caption: "Müşteri Testine Gönder: not penceresi.",
    legend: ["<strong>Not</strong> — en az 10 karakter; geçmişe yazılır ve müşteriye iletilir.", "<strong>Durumu Kaydet</strong> — durumu değiştirir, e-postayı gönderir."],
    body: `
      ${L.tip("Notu müşterinin okuyacağını varsayarak yazın: ne yapıldı, neyi kontrol etmeli, nereden bakmalı.")}
      ${L.warn("<strong>Müşteri Adına Kapat</strong>, müşterinin onayını beklemeden kapatır; yalnızca müşteri telefonla/e-postayla onayladıysa kullanın ve notta belirtin.")}` })}

  <h2>Danışman atama ve efor</h2>
  <p>Bir talebe birden çok danışman atanabilir; biri <strong>birincil</strong> danışmandır: listelerde “Danışman” olarak görünür, iş yükü/performans tablolarında sayılır, bildirim zili uyarıları onun adına üretilir ve müşteriye giden “Talebinize danışman atandı” e-postası onun adını taşır.</p>
  <ul>
    <li><strong>Ata</strong> kutusunu işaretleyin; ilk işaretlenen otomatik birincil olur, <strong>Birincil</strong> düğmesini seçmek danışmanı da atar, birincilin işaretini kaldırırsanız birincillik sıradakine geçer. Yalnızca <em>aktif</em> danışmanlar listelenir ve en az biri işaretli kalmalıdır.</li>
    <li>Kayıtta atama zamanı yenilenir; <em>Açık/Atandı</em> talep <em>Atandı</em> olur, diğer durumlar değişmez. <strong>Yeni</strong> atananlara (işlemi yapan hariç) “Size atanan talep” e-postası, talepten <strong>çıkarılan</strong> danışmana “Talep sizden alındı” e-postası gider; birincil danışman değiştiyse müşteriye tek bir “Talebinize danışman atandı” e-postası gider.</li>
    <li><strong>Önemli:</strong> danışmanın talepte yazabilmesi, danışman kaydının bir <strong>kullanıcı hesabıyla eşleşmesine</strong> bağlıdır (kural düzeyinde “atanmış kullanıcılar” listesi). Eşleşmemiş bir danışman atanırsa ekranda uyarı çıkar; <em>Danışmanlar</em> sayfasındaki <em>Personel ↔ Kullanıcı Eşleştir</em> aracını çalıştırın (Bölüm 3.3).</li>
  </ul>
  ${L.fig("a02-efor", { wide: true, caption: "Efor Kayıtları.",
    legend: ["<strong>Sil</strong> — efor kaydını siler (yöneticiler ve kaydı giren kişi).", "<strong>Saat</strong> — 0,25 ile 24 arası; 0,25'lik adımlarla.", "<strong>Tarih</strong> — çalışmanın yapıldığı gün (en çok 30 gün geriye; gelecek tarih olmaz).", "<strong>Not</strong> — yapılan iş (en çok 500 karakter).", "<strong>Efor Ekle</strong> — kaydı ekler, toplamı günceller."], cols2: true })}
  <ul>
    <li>Efor, <strong>kaydı giren kişinin</strong> danışman kaydı adına yazılır (kullanıcı hesabına bağlı kayıt, yoksa aynı e-postalı kayıt). Danışman kaydı olmayan bir yönetici (ör. PM) efor girerse kayıt kendi adıyla yazılır; kaydı olmayan danışman <em>“Personel kaydınız bulunamadı”</em> uyarısı alır. Yanıt kutusundaki <strong>Efor (saat)</strong> alanı da aynı şekilde kayıt üretir (<em>“Mesaj: …”</em>).</li>
    <li>Ekleyebilenler: yöneticiler ve talebe atanmış ${L.rb("dn")}; silebilenler yöneticiler ve kaydı giren kişidir (silme geçmişe yazılır). Toplam efor Firma ayrıntısı ve Raporlar'da kullanılır.</li>
  </ul>

  <h2>Yanıt, iç not, hazır yanıt ve ek dosya</h2>
  <p><strong>Mesajlar</strong> müşteriyle yazışmayı, <strong>İç Notlar</strong> yalnızca personelin gördüğü notları gösterir; müşteri iç notları ne arayüzde ne veritabanında okuyabilir. Yanıt kutusu yönetici rollerde her açık talepte, danışmanda yalnızca <strong>atandığı</strong> talepte görünür; <em>Kapandı</em> ve arşivdeki talepte kutu yoktur (önce yeniden açın / geri yükleyin).</p>
  <ul>
    <li><strong>Herkese açık yanıt</strong> yalnızca talep sahibine “Yeni yanıt” e-postası yollar (firma yöneticisine/diğer personele gitmez); iç not e-posta üretmez.</li>
    <li><strong>İlk yanıt:</strong> personelin ilk <em>herkese açık</em> mesajı “İlk Yanıt” zamanını yazar ve SLA'nın ilk yanıt hedefini kapatır; iç not, durum değişikliği ve atama sayılmaz.</li>
    <li><strong>Hazır yanıt:</strong> yanıt kutusunun üstündeki <strong>Şablon ekle</strong> listesinden aktif bir şablon seçilir; metin <code>{musteri_adi}</code> (talep sahibi), <code>{talep_no}</code> ve <code>{danisman}</code> (siz) değişkenleri doldurularak kutuya eklenir ve göndermeden önce düzenlenebilir. Şablonları Bölüm 4.4'te yönetirsiniz.</li>
    <li><strong>Ek dosya:</strong> mesaj başına en çok 3 dosya, her biri en çok 2 MB (görsel, PDF, Office, metin/CSV/LOG, ZIP; çalıştırılabilir dosya ve HTML kabul edilmez). 300 KB üstü görseller en uzun kenar 1800 piksel olacak biçimde küçültülür. İç not ekleri yalnızca personele açıktır. Müşterinin <em>Ek Bağlantı</em> alanına yazdığı adres, yalnızca http/https ise tıklanabilir görünür.</li>
  </ul>
  ${L.fig("a02-yanit", { caption: "Mesajlar & Geçmiş ve yanıt kutusu (ilk mesaj gizlendi).",
    legend: ["<strong>Mesajlar</strong> sekmesi.", "<strong>Geçmiş</strong> sekmesi.", "<strong>Müşteri mesajı</strong>", "<strong>Ek dosya</strong> — tıklayınca açılır/iner.", "<strong>Şablon ekle</strong> — hazır yanıt seçer.", "<strong>Yanıt Yaz</strong> — en az 3 karakter.", "<strong>Dosya Ekle</strong> — en çok 3 dosya.", "<strong>İç not olarak kaydet</strong> — müşteriye görünmez, e-posta gitmez.", "<strong>Efor (saat)</strong> — isteğe bağlı.", "<strong>Gönder</strong>"], cols2: true })}
  <div class="shot-row">
    ${L.fig("a02-ic-not", { bare: true, nonum: true, caption: "İç Notlar bölümü (turuncu çizgi: personele özel).", legend: ["<strong>İç not</strong> — yalnızca personel okur."] })}
    ${L.fig("a02-gecmis", { bare: true, nonum: true, caption: "Geçmiş sekmesi.", legend: ["<strong>Geçmiş</strong> sekmesi.", "<strong>Yeni</strong> değer.", "<strong>Not</strong> — durum notları."] })}
  </div>

  <h2>SLA ve ilk yanıt</h2>
  <p>Hedefler <strong>7/24 takvim saati</strong> (mesai ve tatil ayrımı yok) olarak önceliğe göre hesaplanır ve yalnızca müşteri kaynaklı <strong>SUP, ARZ, BUG</strong> taleplerine uygulanır (PRJ, INT, DEV için “—”). Saat, talebin oluşturulduğu andan başlar; <em>yeniden açılışta çözüm hedefi için yeni bir pencere</em> başlar.</p>
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
      <li><strong>Duraklatma gerçektir:</strong> <em>Müşteri Bekleniyor</em> ve <em>Kapanış Onayı Bekliyor</em> durumlarında saat durur, hedef zamanı bekleme süresi kadar ertelenir; rozet “SLA duraklatıldı” der. Aşım damgası kalıcıdır (öncelik düşürmek veya duraklatmak geçmiş aşımı silmez).</li>
      <li>Çözüm hedefi, talebin <em>Kapanış Onayı</em>'na (ya da <em>Çözüldü</em>/<em>Kapandı</em>'ya) ilk geçişiyle kapanır. Aşımlar Genel Bakış'ta ve birincil danışmanın zilinde görünür; otomasyon bildirimleri Bölüm 2.8'dedir.</li>
    </ul>
  </div>

  <h2>Otomasyon: SLA uyarıları, hatırlatmalar ve otomatik kapanış</h2>
  <p>Sunucu tarafında <strong>her 30 dakikada bir</strong> çalışan zamanlanmış bir işlev, açık talepleri tarar. İşlev yalnızca sunucuya bir <em>servis hesabı</em> tanımlıysa çalışır (Bölüm 6.3); tanımlı değilse hiçbir şey yapmaz. Her olay talep başına bir kez üretilir; yeniden açılış, kayıtlı uyarıları geçersiz kılar. İşlemler Aktiviteler'e <em>Sistem (otomatik)</em> adıyla yazılır.</p>
  <table class="fields w3">
    <thead><tr><th>Olay</th><th>Ne zaman?</th><th>Kime / ne olur?</th></tr></thead>
    <tbody>
      <tr><td>SLA uyarısı</td><td>İlk yanıt veya çözüm hedef süresinin <strong>%80'i</strong> dolduğunda (duraklamadayken değil).</td><td>Atanmış danışmanlar (atanan yoksa destek kutusu).</td></tr>
      <tr><td>SLA aşımı</td><td>Hedef aşıldığında.</td><td>Atanmış danışmanlar + destek kutusu. Aşım damgası talebe yazılır. Çok eski (24 saatten eski) aşımlar yeni alarm üretmez, yalnızca damgalanır.</td></tr>
      <tr><td>Atanmamış talep</td><td>Açık/Yeniden Açıldı talep <strong>4 saat</strong> atanmadan kaldığında.</td><td>Destek kutusu + atama yetkisi olan aktif personel (Süper Admin, Destek Atayıcı, PM).</td></tr>
      <tr><td>Müşteri yanıtı hatırlatması</td><td><em>Müşteri Bekleniyor</em>'da <strong>3. ve 7. gün</strong>.</td><td>Müşteriye “Yanıtınızı bekliyoruz”; 7. günde danışmana da.</td></tr>
      <tr><td>Kapanış onayı hatırlatması</td><td><em>Kapanış Onayı Bekliyor</em>'da <strong>3. gün</strong>.</td><td>Müşteriye “Kapanış onayınızı bekliyoruz” (kalan gün belirtilir).</td></tr>
      <tr><td>Otomatik kapanış</td><td><em>Kapanış Onayı Bekliyor</em>'da <strong>10. gün</strong>, müşteriden yanıt gelmediyse.</td><td>Talep <em>Kapandı</em> olur; müşteriye ve danışmana bilgi e-postası gider. Müşteri 14 gün içinde yeniden açabilir.</td></tr>
    </tbody>
  </table>
  ${L.warn("Otomasyon e-postaları günlük e-posta kotasını paylaşır (Bölüm 6.1). Kota dolarken düşük öncelikli bildirimler (uyarı, hatırlatma) ertesi sabah <strong>günlük özet e-postasına</strong> ertelenir; otomatik kapanış ve SLA aşımı önceliklidir. <strong>Otomasyonu ilk kez etkinleştirmeden önce</strong> 10 günden uzun süredir <em>Kapanış Onayı Bekliyor</em>'da duran talepleri gözden geçirin: bu talepler ilk çalışmada kapatılır ve müşterilere e-posta gider.", "İlk etkinleştirme")}

  <h2>Danışman görünümü</h2>
  ${L.who("dn")}
  <p>Danışman tüm talepleri görür ama yalnızca <strong>kendisine atanmış</strong> talepte yazar; yazma yetkisi hem arayüzde hem veritabanı kurallarında atamaya bağlıdır (atama, danışman kaydının kullanıcı hesabıyla eşleşmesine dayanır). Atanmamış talepte yalnızca bilgi kutusu görünür; yanıt, iç not, durum ve efor işlemleri kapalıdır. Atanmış talepte panel Hızlı İşlemleri gösterir.</p>
  <div class="shot-row">
    ${L.fig("a02-danisman-kisitli", { bare: true, nonum: true, caption: "Atanmamış talep.", legend: ["<strong>Yalnızca görüntüleme</strong> uyarısı."] })}
    ${L.fig("a02-danisman-paneli", { bare: true, nonum: true, caption: "Atanmış talep: Danışman Paneli.", legend: ["<strong>Hızlı İşlemler</strong>"] })}
  </div>

  <h2>E-posta bildirimleri</h2>
  <p>E-postaları işlemi yapanın tarayıcısı portalın e-posta servisine gönderir (Netlify Function → Resend). <strong>Alıcıları ve içeriği sunucu belirler</strong> (istemciden gelen adres/metin güvenilmez): metin, veritabanındaki mesaj veya geçmiş kaydından alınır. <strong>İşlemi yapan kişiye e-posta gitmez.</strong> Tüm bildirim e-postalarında “bu adrese yanıt vermeyin, portaldan yazın” notu bulunur; e-postayı yanıtlamak talebe eklenmez.</p>
  <table class="fields">
    <thead><tr><th>Olay</th><th>Konu</th><th>Alıcı</th></tr></thead>
    <tbody>
      <tr><td>Müşteri talep açar</td><td>Talebiniz alındı · Yeni destek talebi</td><td>Müşteri + destek kutusu (<code>info@parlabilgiteknolojileri.net</code>)</td></tr>
      <tr><td>Personel talep açar (muhatap seçili)</td><td>Talebiniz alındı</td><td>Yalnızca muhatap</td></tr>
      <tr><td>Danışman atanır</td><td>Size atanan talep</td><td>Yeni atanan danışman(lar)</td></tr>
      <tr><td>Birincil danışman değişir</td><td>Talebinize danışman atandı</td><td>Müşteri (atama başına tek e-posta)</td></tr>
      <tr><td>Danışman talepten çıkarılır</td><td>Talep sizden alındı</td><td>Çıkarılan danışman</td></tr>
      <tr><td>Öncelik Kritik'e yükselir</td><td>Kritik öncelik</td><td>Atanmış danışmanlar (yoksa destek kutusu)</td></tr>
      <tr><td>Durum değişir (İşleme Al/Geri Al, Yeniden Aç, Çözüldü, Kapandı)</td><td>Durum güncellendi · Talep çözüldü · Talep kapatıldı</td><td>Müşteri + atanmış danışmanlar</td></tr>
      <tr><td>Müşteri Testine Gönder · Kapanış Onayı İste</td><td>İncelemeniz bekleniyor · Kapanış onayı</td><td>Yalnızca müşteri</td></tr>
      <tr><td>Personel herkese açık yanıt yazar</td><td>Yeni yanıt</td><td>Yalnızca talep sahibi</td></tr>
      <tr><td>Müşteri yanıt yazar</td><td>Yeni yanıt</td><td>Destek kutusu + atanmış danışmanlar</td></tr>
      <tr><td>Müşteri kapanışı onaylar / yeniden açar (ya da yanıtla otomatik açılır)</td><td>Talep kapatıldı · Talep tekrar açıldı</td><td>Destek kutusu + atanmış danışmanlar</td></tr>
      <tr><td>Otomasyon (Bölüm 2.8)</td><td>SLA uyarısı · SLA aşıldı · Atanmamış talep · Yanıtınızı/Kapanış onayınızı bekliyoruz · Talep otomatik kapatıldı</td><td>Bölüm 2.8 tablosundaki alıcılar</td></tr>
      <tr><td>İç not, öncelik değişikliği (Kritik hariç), efor, toplu atama</td><td>—</td><td>E-posta gitmez</td></tr>
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
  ${L.info("Gönderim hataları sessiz geçmez: ekranda uyarı çıkar ve Aktiviteler'e “E-posta Gönderilemedi” yazılır. Geçici hatalarda e-posta tarayıcı kuyruğuna alınıp yeniden denenir (Bölüm 6.2).", "Hata durumunda")}
</section>`;
