# Parla BT · Destek Portalı kılavuzları — PDF üretim altyapısı

HTML + CSS ile yazılan içerikten, Chromium (Playwright) ile A4 PDF üretir. Yazı tipleri (Inter, Plus Jakarta Sans,
JetBrains Mono — Türkçe için `latin-ext` dahil), logo, kapak, bölüm açılışları, **gerçek sayfa numaralı içindekiler**,
üst/alt bilgi ve PDF yer imleri otomatik gelir. Siz yalnızca bölümleri yazarsınız.

```
docs/manuals/
├── build.cjs            derleyici  (node build.cjs <kılavuz-adı>)
├── capture.cjs          ekran görüntüsü yardımcısı (isteğe bağlı)
├── theme.css            tasarım sistemi (sayfa, kapak, açılış, içindekiler, tüm bileşenler)
├── assets/              logo-bt.png (başlık/kapak), logo-bt-tagline.png (sloganlı)
├── content/
│   ├── _sample/         tasarımı kanıtlayan örnek (index.html, meta.json, screens/)
│   ├── user/            (siz ekleyeceksiniz)  index.html + meta.json + screens/
│   └── admin/           (siz ekleyeceksiniz)
├── out/                 üretilen PDF'ler (meta.json -> "output")
└── .build/              ara HTML dosyaları (git'e girmez)
```

## 1. Derleme

Gereksinimler: Node 20+, `npm install` (bu klasörde), Playwright ve Chromium.

```bash
cd docs/manuals && npm install        # yazı tipleri, pdfjs-dist, pdf-lib, lucide-static
node docs/manuals/build.cjs _sample   # repo kökünden; çıktı: docs/manuals/out/_sample.pdf
node docs/manuals/build.cjs user      # content/user/ -> meta.json'daki "output"
node docs/manuals/build.cjs user --html-only   # yalnızca .build/user.html (tarayıcıda göz atmak için)
```

Playwright/Chromium bu ortamda `/opt/node-tools` ve `/opt/pw-browsers` altında hazırdır; derleyici bunları kendiliğinden
bulur. Başka makinede: `PLAYWRIGHT_PATH=/yol/node_modules/playwright` ve/veya `CHROMIUM_PATH=/yol/chrome` ayarlayın
(ya da `npm i playwright && npx playwright install chromium`). Sayfa kenar kutuları için Chromium 131+ gerekir
(Chromium 141 / Playwright 1.56 ile denendi).

Derleme çıktısında şunları görürsünüz: geçiş sayısı, sayfa sayısı, yer imi sayısı, **Türkçe karakter denetimi**
(içerikteki her `ÇĞİÖŞÜçğıöşü` PDF metninde aranır, `U+FFFD` sayılır) ve **içindekiler doğrulaması** (her satırdaki başlık
gösterdiği sayfada aranır). Biri başarısızsa süreç 2 koduyla çıkar.

### İçindekiler nasıl gerçek sayfa numarası alır?

1. HTML Chromium'da açılır; `enhance` adımı bölümleri numaralar, açılış sayfalarını ve içindekileri kurar, DOM statik
   HTML'e (`.build/<ad>.html`) yazılır.
2. **Geçiş 1:** PDF üretilir (içindekilerde yer tutucu `00`). PDF yer imlerinden (Chromium `outline: true`) her başlığın
   sayfası okunur (`pdfjs-dist`).
3. **Geçiş 2:** numaralar içindekilere yazılır, PDF yeniden üretilir, yer imlerinden numaralar yeniden okunur.
   Değişmediyse biter; değiştiyse en çok 5 geçişe kadar tekrarlanır.
4. `pdf-lib` ile belge bilgisi (başlık, yazar, konu, anahtar sözcükler, dil) yazılır. Başlıklar PDF yer imi ve içindekilerde
   tıklanabilir iç bağlantıdır.

Sayfa numaraları kapak = 1 sayılarak verilir; alt bilgideki "3 / 40" ile içindekiler aynı sayıyı kullanır.

## 2. Yeni kılavuz oluşturma

`content/<ad>/index.html` (yalnızca gövde parçası: bölümler) ve `content/<ad>/meta.json` yazın. Kapak, içindekiler ve
(isteğe bağlı) arka kapak `meta.json`'dan otomatik eklenir.

```json
{
  "title": "Destek Portalı\n*Kullanıcı* Kılavuzu",
  "subtitle": "Talep açma, takip etme ve danışmanlarımızla iletişim kurma rehberi.",
  "eyebrow": "Kullanıcı Kılavuzu",
  "product": "Destek Portalı",
  "version": "1.0",
  "date": "Ekim 2026",
  "audience": "Müşteri kullanıcıları",
  "author": "Parla Bilgi Teknolojileri",
  "header": "Destek Portalı · Kullanıcı Kılavuzu",
  "footer": "Parla Bilgi Teknolojileri · Destek Portalı",
  "pdfTitle": "Parla BT Destek Portalı — Kullanıcı Kılavuzu",
  "keywords": ["Parla BT", "Destek Portalı"],
  "toc": { "depth": 2, "title": "İçindekiler" },
  "numbering": true,
  "backCover": { "kicker": "Destek", "title": "Yardıma mı\nihtiyacınız var?", "lines": ["destek@ornek.com"] },
  "output": "out/user-kilavuzu.pdf"
}
```

| Alan | Anlamı |
|---|---|
| `title` (zorunlu) | Kapak başlığı. `\n` = satır sonu, `*vurgu*` = turuncu vurgu |
| `subtitle`, `eyebrow`, `product` | Kapak alt yazısı, başlık üstü etiketi, sağ üst hap etiketi |
| `version`, `date`, `audience`, `author` | Kapak alt şeridi. Tamamen özelleştirmek için `coverMeta: [{"k":"Sürüm","v":"1.0"}, ...]` |
| `header` / `footer` | Üst bilgi sağ metni (varsayılan: başlık) / alt bilgi sol metni |
| `toc` | `{ "depth": 1-3, "title": "..." }` ya da `false` (içindekiler yok). Derinlik 1 = bölümler, 2 = + h2, 3 = + h3 |
| `numbering` | `false` ise bölüm/alt başlık numaraları (01, 1.1) gizlenir |
| `cover`, `backCover` | `cover: false` otomatik kapağı kapatır; `backCover: true` ya da `{kicker,title,lines}` arka kapak ekler |
| `output` | PDF yolu (`docs/manuals`'a göre göreli) |
| `pdfTitle`, `keywords`, `lang` | PDF belge bilgisi ve dil (`tr` varsayılan) |

Kılavuza özel CSS gerekirse `content/<ad>/style.css` dosyası temadan sonra yüklenir. Kendi kapağınızı yazarsanız
(`class="cover"` içeren bir öğe) otomatik kapak eklenmez; `<nav class="toc">` yazarsanız otomatik içindekiler sayfası eklenmez.

## 3. Bölüm yapısı

```html
<section class="chapter" data-title="Başlangıç"
         data-intro="Açılış sayfasında görünen 1-2 cümlelik giriş.">
  <h1>Başlangıç</h1>            <!-- bölüm başlığı: içindekiler + yer imi -->
  <h2>Portala giriş</h2>        <!-- alt başlık: 1.1 numaralanır, içindekilerde görünür -->
  <h3>Şifrenizi unuttuysanız</h3>
  ...
</section>
```

Her `section.chapter` yeni sayfada başlar ve otomatik olarak **açılış sayfası** alır (büyük numara, başlık, giriş ve bölümün
h2 listesi; üst/alt bilgi yok). Seçenekler:

| Nitelik / sınıf | Etki |
|---|---|
| `data-intro="..."` | Açılış girişi. Yoksa bölümün doğrudan çocuğu olan ilk `<p class="lead">` açılışa taşınır |
| `data-opener="false"` | Açılış sayfası olmasın; h1 sayfa başında büyük başlık olur |
| `data-opener-toc="false"` | Açılıştaki "Bu bölümde" listesini gizler |
| `<h2 class="no-toc">` / `<h3 class="no-toc">` | İçindekilerde gösterme |
| `<h2 class="no-num">` | Numaralanmasın |
| `<section class="bare">` | Tek bölümlük sayfada üst/alt bilgi olmasın (kenar boşlukları kalır) |
| `.page-break`, `.no-break`, `.keep-with-next` | Sayfa sonu / bölünmesin / sonrakiyle birlikte kalsın |

Not: `h4`–`h6` etiketleri derleyici tarafından aynı görünümlü `div.h4`'e çevrilir; böylece PDF yer imi paneli yalnızca
h1–h3'ü gösterir. Aşağıdaki bileşenlerde başlık yerine `<h4>` kullanabilirsiniz.

## 4. Bileşen kütüphanesi (kopyala-yapıştır)

### Adım adım akış
```html
<ol class="steps">
  <li>
    <h4>Giriş sayfasını açın</h4>
    <p>Tarayıcınıza portal adresini yazın.</p>
  </li>
  <li>
    <h4>Giriş yapın</h4>
    <p><span class="ui-btn primary">Giriş Yap</span> düğmesine tıklayın.</p>
    <figure class="shot"> ... </figure>   <!-- adımın içine görsel konabilir -->
  </li>
</ol>
```
Adımlar bölünmez (`break-inside: avoid`); çok uzun adım için `<li class="long">`.

### Ekran görüntüsü figürü
```html
<figure class="shot" data-url="destek.parlabilgiteknolojileri.net/support-v2/login.html">
  <img src="screens/01-giris-sayfasi.png" alt="">
  <figcaption>Giriş sayfası.</figcaption>
</figure>
```
Tarayıcı şeridi (üç nokta + adres çubuğu) derleyici tarafından eklenir; `data-url` yoksa yalnızca noktalar görünür.
Genişlik varyantları (`figure`'a eklenir):

| Sınıf | Genişlik (166 mm metin alanına göre) |
|---|---|
| `shot` | %82 ortalı (varsayılan) |
| `shot shot--wide` | %100 |
| `shot shot--half` | %50 |
| `shot--bare` | Tarayıcı şeridi yok (kırpılmış pencere/form için) |
| `shot--nonum` | "Şekil N" numarası yok |

Yan yana iki görsel:
```html
<div class="shot-row">
  <figure class="shot"><img src="screens/a.png" alt=""><figcaption>Önce</figcaption></figure>
  <figure class="shot"><img src="screens/b.png" alt=""><figcaption>Sonra</figcaption></figure>
</div>
```
Figürler sayfa sonunda ortadan bölünmez. Altyazılar otomatik "Şekil N" önekini alır.

### Numaralı çağrı işaretleri (pin)
```html
<figure class="shot shot--wide" data-url="...">
  <img src="screens/01-giris-sayfasi.png" alt="">
  <span class="pin" style="left:58%;top:45%">1</span>      <!-- % = görselin sol/üstüne göre merkez -->
  <span class="pin navy" style="left:58%;top:56%">2</span>  <!-- koyu varyant -->
  <figcaption>Giriş sayfası.</figcaption>
  <ol class="pin-legend cols-2">     <!-- cols-2 isteğe bağlı: iki sütun -->
    <li><strong>E-posta</strong> — kurumsal adresiniz.</li>
    <li><strong>Şifre</strong> — gözü simgesiyle göster/gizle.</li>
  </ol>
</figure>
```
Pin yüzdeleri **görsele** göre hesaplanır (tarayıcı şeridi ve altyazı hariç). Yüzdeyi görselin pikselinden bulun:
`left = x / genişlik * 100`, `top = y / yükseklik * 100`.

### Bilgi kutuları
```html
<div class="callout tip"><p>Kısayol: <kbd>Ctrl</kbd> + <kbd>K</kbd>.</p></div>       <!-- İpucu (yeşil) -->
<div class="callout warn"><p>Şifrenizi kimseyle paylaşmayın.</p></div>                <!-- Dikkat (sarı) -->
<div class="callout info"><p>Talep numarası <code>SUP-ORN-FI-2610-0042</code>.</p></div> <!-- Bilgi (mavi) -->
<div class="callout danger"><p>Üretimi durduran sorunda ayrıca arayın.</p></div>       <!-- Önemli uyarı (kırmızı) -->
<div class="callout warn" data-title="Süre sınırı"><p>Özel başlık.</p></div>             <!-- başlığı değiştirir -->
```

### Metin içinde arayüz öğeleri
```html
<span class="ui-btn primary">Talebi Gönder</span>   <!-- turuncu -->
<span class="ui-btn secondary">Vazgeç</span>        <!-- gri -->
<span class="ui-btn outline">Dosya Ekle</span>      <!-- çerçeveli -->
<span class="ui-btn danger">Sil</span>
<span class="ui-field">E-posta</span>               <!-- giriş alanı -->
<span class="ui-menu">Taleplerim</span>             <!-- menü öğesi -->
<kbd>Enter</kbd>
<span class="ico-inline" data-ico="mail"></span>    <!-- satır içi simge (lucide adı) -->
```

### Durum ve öncelik rozetleri
```html
<span class="badge open">Açık</span>
<span class="badge assigned">Atandı</span>
<span class="badge in_progress">İşlemde</span>
<span class="badge waiting_customer">Müşteri Bekleniyor</span>
<span class="badge pending_close">Kapanış Onayı Bekliyor</span>
<span class="badge resolved">Çözüldü</span>
<span class="badge closed">Kapandı</span>
<span class="badge reopened">Tekrar Açıldı</span>

<span class="prio low">Düşük</span> <span class="prio medium">Orta</span>
<span class="prio high">Yüksek</span> <span class="prio critical">Kritik</span>
```
Rozet metnini siz yazarsınız (portaldaki etiketlerle aynı tutun).

### Alan tablosu
```html
<table class="fields">
  <thead><tr><th>Alan</th><th>Ne yazmalı?</th><th>Zorunlu mu?</th></tr></thead>
  <tbody>
    <tr><td>Konu</td><td>Sorunu bir cümleyle özetleyin.</td><td><span class="req">Zorunlu</span></td></tr>
    <tr><td>Telefon</td><td>Size ulaşabileceğimiz numara.</td><td><span class="opt">İsteğe bağlı</span></td></tr>
  </tbody>
</table>
```
Şerit satırlı, başlık turuncu çizgili; sayfa sonunda başlık satırı tekrarlanır, satırlar bölünmez. (`table.plain`
başlık/hücre stilini paylaşan, şeritsiz sade bir tablodur; örnekte kullanılmadı, görsel olarak denenmedi.)

### Kartlar
```html
<div class="cards">            <!-- cols-2 | (varsayılan 3) | cols-4 -->
  <div class="card">           <!-- renk: blue | green | amber | red | navy -->
    <div class="ico" data-ico="ticket"></div>   <!-- lucide simge adı: lucide.dev/icons -->
    <h4>Talep açın</h4>
    <p>Sorununuzu tek formda bildirin.</p>
  </div>
</div>
```

### "Bu bölümde", hızlı başlangıç, SSS, sözlük
```html
<div class="in-this-chapter">             <!-- data-title="..." ile başlık değişir -->
  <ul><li>Hesabınıza giriş yapma</li><li>Şifrenizi değiştirme</li></ul>
</div>

<ul class="checklist" data-title="Hızlı başlangıç">
  <li class="done">Portala giriş yaptım.</li>   <!-- done = işaretli -->
  <li>İlk talebimi oluşturdum.</li>
</ul>

<div class="faq">
  <div class="qa"><p class="q">Şifremi unuttum?</p><div class="a"><p>Giriş sayfasındaki bağlantıyı kullanın.</p></div></div>
  <!-- ya da: <details><summary>Soru</summary><p>Cevap</p></details>  (baskıda otomatik açılır) -->
</div>

<table class="glossary">
  <thead><tr><th>Terim</th><th>Açıklama</th></tr></thead>
  <tbody><tr><td>Talep (ticket)<small>isteğe bağlı alt not</small></td><td>Destek isteği.</td></tr></tbody>
</table>
```

### Akış diyagramı (durum akışı)
```html
<div class="flow">
  <div class="node open"><span class="n">1</span>Yeni<small>Talep açıldı</small></div><span class="arrow"></span>
  <div class="node assigned"><span class="n">2</span>Atandı</div><span class="arrow"></span>
  <div class="node in_progress"><span class="n">3</span>İşlemde</div><span class="arrow"></span>
  <div class="node waiting_customer"><span class="n">4</span>Müşteri Testi</div><span class="arrow"></span>
  <div class="node pending_close"><span class="n">5</span>Kapanış Onayı</div><span class="arrow"></span>
  <div class="node closed"><span class="n">6</span>Kapandı</div>
</div>
```
Düğüm renkleri durum sınıflarıyla gelir (`open assigned in_progress waiting_customer pending_close resolved closed reopened`);
sınıfsız düğüm lacivert olur. `.n` (numara) ve `<small>` isteğe bağlıdır. Dikey: `<div class="flow flow--vertical">`.
Bir satıra sığmayan akış alt satıra sarar; satır başında kalan ok kusurunu önlemek için bir satırda **en çok 6 düğüm** kullanın
ya da akışı iki `.flow` bloğuna bölün.

### Diğer
`p.lead` (giriş paragrafı), `.eyebrow` (küçük turuncu etiket), `blockquote`, `pre > code`, `code`, `.cols-2-text` (iki sütun
metin), `.muted`, `.small`, `.center`, `hr`. Renk/aralık değişkenleri `theme.css` başındaki `:root` içindedir.

## 5. Ekran görüntüsü önerileri

Metin alanı 166 mm genişliğindedir: `shot` ≈ 136 mm, `shot--wide` = 166 mm, `shot--half` ≈ 83 mm.

| Kullanım | Yakalama | Sınıf |
|---|---|---|
| Tam sayfa/ana ekran | Görünüm **1280–1440 px** genişlik, cihaz oranı **1,5** (≈ 1900–2200 px dosya) | `shot` veya `shot--wide` |
| Tek form / pencere / kart | Görünüm 800–900 px, oran **2**, **yalnızca ilgili öğeyi kırpın** | `shot--half` veya `shot--bare` |
| Küçük arayüz parçası (menü, rozet) | Öğeyi kırpın, oran 2 | `shot--half` |

* Yarım genişlikte 1440 px'lik tam ekran görüntüsü okunmaz hale gelir; küçük çıktıda **kırpın**, dar ekran çekin.
* Dosya boyutu: PNG başına ideal 150–600 KB (PDF boyutu görsellerle büyür; yazı tipleri ~0,5 MB ekler). Çok büyük PNG'leri
  JPEG (kalite 85) veya optimize PNG yapın.
* İsimlendirme: ASCII, küçük harf, tire; bölüm numarasıyla başlayın: `screens/01-giris-sayfasi.png`,
  `03-talep-formu-dolu.png`, `03-talep-formu-hata.png`, yönetici için `a05-atama-penceresi.png`. Türkçe karakter, boşluk yok.
* Gizlilik: gerçek müşteri adı, e-posta, telefon, talep içeriği olmasın; örnek veri kullanın (ör. `ornekfirma.com`).
* Tutarlılık: aynı tarayıcı, aynı yakınlaştırma (%100), aynı dil; bildirim/çerez şeritlerini kapatın.
* Yardımcı: `node docs/manuals/capture.cjs /support-v2/login.html docs/manuals/content/user/screens/01-giris-sayfasi.png --wait "#sv2-login-form" --w 1280 --h 800 --scale 1.5`
  (`/` ile başlayan adresler repo kökünden yerel sunulur; seçenekler için betiğin başındaki açıklamaya bakın).
  Oturum gerektiren sayfaları kendi tarayıcınızdan çekin; yardımcı oturum açmaz (isterseniz `--fill`/`--click` ile
  giriş formunu doldurabilirsiniz).

## 6. Sayfa sayısı ve kırılma ipuçları

* Kullanılabilir alan 166 × 239 mm (kenar boşlukları 22 / 31 / 27 mm). Sayfa ölçülerinden hesaplanan kaba tahmin (örnek PDF'e bakarak): düz metin
  sayfası ≈ 450–550 kelime; 4 kısa adım + giriş ≈ ¾ sayfa; tam genişlik ekran görüntüsü + açıklama listesi ≈ ½–⅔ sayfa;
  alan tablosu satırı ≈ 10–16 mm.
* Her bölüm yeni sayfada başlar ve açılış sayfası 1 sayfa harcar (`data-opener="false"` ile kazanılır). Kapak, içindekiler
  (≈ 40 satıra kadar 1 sayfa) ve arka kapak da sayıya girer.
* Bölünmeyen bloklar (figür, callout, kart, adım, tablo satırı) sonraki sayfaya kayar ve altta boşluk bırakabilir;
  örnek PDF'te bazı sayfaların altı %20–25 boştur. Önce büyük görseli, sonra metni koyup sırayı değiştirerek veya
  `shot--half` kullanarak sıkıştırabilirsiniz.
* Başlığın sonraki içerikten ayrı sayfaya düşmesi engellenir (`break-after: avoid`); bir bileşenin hemen önündeki paragraf da
  onunla birlikte kalır. Zorla sayfa sonu için `class="page-break"`.
* İki geçişli derleme sayfa sayısı değişse bile içindekileri otomatik düzeltir; elle numara yazmayın.

## 7. Bilinen sınırlamalar

* Yalnızca Chromium (CSS `@page` kenar kutuları, adlandırılmış sayfalar, `:has()`); başka tarayıcıdan "Yazdır" aynı çıktıyı vermez.
* Chromium bazı başlıkları yer imine iki kez yazıyor (ör. "SözlükSözlük"). Derleyici bunu hem eşlemede hem PDF'te temizler;
  yer imi eşlemesi başarısız olursa yedek yöntem sayfa metninde arama yapar ve bunu uyarıyla bildirir (daha az güvenilir).
* Üst/alt bilgi tek satırdır; çok uzun `header` metni logoyla çakışabilir (≈ 60 karakterin altında kalın; uzun adlarda test edilmedi).
* Akış diyagramında satıra sığmayan düğümler sarar ve satır sonunda sahipsiz ok kalır (bkz. akış diyagramı notu).
* Test edilmedi: Windows/macOS yolları, Türkçe dışı diller, PDF/UA erişilebilirlik uyumu, çok büyük (100+ sayfa) kılavuzlarda süre.
* `_sample` ekran görüntüleri: `giris-sayfasi.png` ve `giris-karti.png` gerçek giriş sayfasından (yerel sunucu + Playwright);
  `taleplerim.png` portalın kendi kabuğu ve CSS'iyle **uydurma verilerle** üretilmiştir (oturum gerektirdiği için).
