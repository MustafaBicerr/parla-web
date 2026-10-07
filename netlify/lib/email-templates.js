/**
 * Parla BT — transactional HTML e-posta şablonları (tablo tabanlı, istemci uyumlu) + düz metin alternatifi.
 *
 * Tasarım ilkeleri:
 *  - Her değer HTML'e kaçışlı basılır; bağlantılar yalnızca https (geliştirmede localhost) origin'ine kurulur.
 *  - Konu satırı denetim karakterlerinden (CR/LF dahil) arındırılır ve kısaltılır (EML-24).
 *  - Uzun boşluksuz metin (URL, SAP hata kodu) taşmaz: overflow-wrap/word-break + table-layout:fixed (EML-19).
 *  - Düğme Outlook'ta da çalışır (VML) ve düz metin bağlantı yedeği bulunur (EML-29, EML-35).
 *  - Durum/öncelik etiketleri portal (assets/js/support-v2/ticket-utils.js) ile birebir aynıdır (EML-25; test eşitliği doğrular).
 *  - Uzun not kod noktası/grapheme bazında kesilir, "… (devamı portalda)" eklenir (SEN-31).
 *  - Parola e-postası YOK: user_credentials "şifre belirleme" yönlendirmesi içerir (karar 19).
 */

const BRAND = {
  name: "Parla Bilgi Teknolojileri",
  shortName: "Parla BT",
  fromName: "Parla BT Destek",
  fromEmail: "info@parlabilgiteknolojileri.net",
  siteUrl: "https://www.parlabilgiteknolojileri.net",
  logoUrl: "https://www.parlabilgiteknolojileri.net/assets/img/parla-logo/parla-logo.png",
  orange: "#F37021",
  orangeDark: "#D45F16",
  ink: "#1A1A1A",
  text: "#333333",
  muted: "#6B7280",
  line: "#E8E4DE",
  canvas: "#F3F1ED",
  card: "#FFFFFF",
  navy: "#0A1628",
};

/** Portal etiketleriyle aynı (ticket-utils.js STATUS_LABELS / PRIORITY_LABELS). */
const STATUS_LABELS = {
  open: "Açık",
  assigned: "Atandı",
  in_progress: "İşlemde",
  waiting_customer: "Müşteri Bekleniyor",
  pending_close: "Kapanış Onayı Bekliyor",
  resolved: "Çözüldü",
  closed: "Kapandı",
  reopened: "Yeniden Açıldı",
};

const PRIORITY_LABELS = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};

const SUBJECT_MAX = 150;
const TITLE_IN_SUBJECT_MAX = 40;
const NOTE_MAX = 500;
const TRUNCATION_SUFFIX = "… (devamı portalda)";
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const WRAP = "word-break:break-word;overflow-wrap:anywhere;";

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(value) {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>");
}

/** Denetim karakterleri (CR/LF dahil), satır/paragraf ayırıcıları ve yönlendirme (bidi) karakterlerini boşluğa çevirir. */
function singleLine(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Çok satırlı metin: satır sonlarını korur, diğer denetim/yönlendirme karakterlerini temizler. */
function multiLine(value) {
  return String(value == null ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Görünen karakter (grapheme) dizisi; Intl.Segmenter yoksa kod noktası dizisi. Emoji/vekil çiftleri bölünmez. */
function toUnits(text) {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter("tr", { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** @returns {{text: string, truncated: boolean}} */
function truncateText(value, max) {
  const text = String(value == null ? "" : value);
  if (text.length <= max) return { text, truncated: false };
  const units = toUnits(text);
  if (units.length <= max) return { text, truncated: false };
  return { text: units.slice(0, max).join("").trimEnd(), truncated: true };
}

/** Konu satırı: tek satır, en çok 150 karakter (kod noktası bazlı). */
function cleanSubject(value) {
  const line = singleLine(value) || BRAND.shortName;
  const units = Array.from(line);
  return units.length > SUBJECT_MAX ? `${units.slice(0, SUBJECT_MAX - 1).join("").trimEnd()}…` : line;
}

function isDevHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/** Yalnızca `https://host[:port]` (ya da geliştirmede http://localhost) origin'i; aksi halde marka adresi. */
function safeOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.username || url.password) return BRAND.siteUrl;
    if (url.protocol === "https:" || (url.protocol === "http:" && isDevHost(url.hostname))) return url.origin;
  } catch {
    /* geçersiz URL */
  }
  return BRAND.siteUrl;
}

function originFrom(data) {
  return safeOrigin(data.portalUrl || data.origin || BRAND.siteUrl);
}

function labelStatus(status) {
  const key = String(status || "").toLowerCase();
  return STATUS_LABELS[key] || singleLine(status) || "—";
}

function labelPriority(priority) {
  const key = String(priority || "").toLowerCase();
  return PRIORITY_LABELS[key] || singleLine(priority) || "—";
}

function ticketHref(data, audience) {
  const origin = originFrom(data);
  const id = encodeURIComponent(data.ticket_id || data.id || "");
  if (!id) return `${origin}/support-v2/login.html`;
  const path =
    audience === "staff" ? "/support-v2/admin/ticket-detail.html" : "/support-v2/customer/ticket-detail.html";
  return `${origin}${path}?id=${id}`;
}

/** Yalnızca personele giden (tek kitleli) olaylar: bağlantı personel sayfasına kurulur. */
const STAFF_ONLY_TYPES = new Set([
  "ticket_assigned",
  "ticket_reopened",
  "ticket_unassigned",
  "ticket_priority_critical",
  "sla_warning",
  "sla_breached",
  "unassigned_escalation",
]);

function staffAudience(type, data) {
  if (data.audience === "staff") return true;
  if (data.audience === "customer") return false;
  return STAFF_ONLY_TYPES.has(type);
}

/** "6 Eki 2026 14:32" (Europe/Istanbul). Geçersiz tarihte boş döner. */
function formatDateTr(value) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Istanbul",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

function metaRows(data) {
  const rows = [];
  if (data.ticket_number) rows.push(["Talep no", singleLine(data.ticket_number)]);
  if (data.title) rows.push(["Konu", singleLine(data.title)]);
  if (data.status) rows.push(["Durum", labelStatus(data.status)]);
  if (data.priority) rows.push(["Öncelik", labelPriority(data.priority)]);
  if (data.company_name) rows.push(["Firma", singleLine(data.company_name)]);
  if (data.user_name) rows.push(["Muhatap", singleLine(data.user_name)]);
  // Olaya özgü ek satırlar (ör. otomasyon: SLA aşaması, bekleme süresi). [[etiket, değer], ...]
  if (Array.isArray(data.extraRows)) {
    data.extraRows.slice(0, 6).forEach((row) => {
      if (Array.isArray(row) && row[0] && row[1] != null && row[1] !== "") {
        rows.push([singleLine(row[0]).slice(0, 40), singleLine(row[1]).slice(0, 120)]);
      }
    });
  }
  return rows;
}

function renderMetaTable(rows) {
  if (!rows.length) return "";
  const body = rows
    .map(([k, v], i) => {
      const first = i === 0;
      const last = i === rows.length - 1;
      const pad = `padding:${first ? "0" : "10px"} 0 ${last ? "0" : "10px"} 0;border-bottom:${last ? "0" : "1px solid #E8E4DE"};`;
      return `
      <tr>
        <td valign="top" style="${pad}width:38%;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#6B7280;font-family:Georgia,'Times New Roman',serif;${WRAP}">${escapeHtml(k)}</td>
        <td valign="top" style="${pad}font-size:15px;color:#1A1A1A;font-weight:600;font-family:${FONT};${WRAP}">${escapeHtml(v)}</td>
      </tr>`;
    })
    .join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;table-layout:fixed;margin:0 0 24px 0;">
      ${body}
    </table>`;
}

function renderNote(note, byline) {
  const text = String(note || "").trim();
  if (!text) return "";
  const head = byline
    ? `<div style="margin:0 0 8px 0;font-size:12px;color:#6B7280;font-family:${FONT};${WRAP}">${escapeHtml(byline)}</div>`
    : "";
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;table-layout:fixed;margin:0 0 28px 0;">
      <tr>
        <td style="border-left:3px solid #F37021;background:#FFF8F3;padding:16px 18px;font-size:15px;line-height:1.6;color:#333333;font-family:${FONT};${WRAP}">
          ${head}${nl2br(text)}
        </td>
      </tr>
    </table>`;
}

/** "Bulletproof" düğme: Outlook için VML, diğerleri için dolgusu <td>'de olan tablo. */
function renderButton(href, label) {
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  const width = Math.min(320, Math.max(180, Array.from(label).length * 9 + 64));
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;">
      <tr>
        <td align="center" bgcolor="${BRAND.orange}" style="border-radius:8px;mso-padding-alt:14px 28px;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeHref}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="17%" strokecolor="${BRAND.orange}" fillcolor="${BRAND.orange}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:bold;">${safeLabel}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
          <a href="${safeHref}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;font-family:${FONT};letter-spacing:0.01em;border-radius:8px;">${safeLabel}</a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
    <p style="margin:0 0 28px 0;font-size:12px;line-height:1.5;color:#6B7280;font-family:${FONT};${WRAP}">Düğme çalışmıyorsa bu bağlantıyı tarayıcınıza yapıştırın:<br><a href="${safeHref}" style="color:${BRAND.orangeDark};text-decoration:underline;${WRAP}">${safeHref}</a></p>`;
}

const REPLY_NOTICE =
  "Bu ileti otomatik gönderilmiştir. Lütfen bu e-postayı yanıtlamayın; yanıtınız talebe eklenmez. Mesajınızı destek portalından yazın.";

function privacyLine(data) {
  const candidate = data && data.privacyUrl ? String(data.privacyUrl) : "";
  return {
    base: "Kişisel verileriniz, destek hizmetinin yürütülmesi amacıyla 6698 sayılı KVKK kapsamında işlenir.",
    url: /^https:\/\/[^\s"'<>]+$/i.test(candidate) ? candidate : "",
    contact: `Aydınlatma metni ve haklarınız için ${BRAND.fromEmail} adresine yazabilirsiniz.`,
  };
}

function renderLayout({ title, preview, eyebrow, intro, bodyHtml, footerNote, data }) {
  const preheader = escapeHtml(singleLine(preview || intro || title));
  const filler = "&zwnj;&nbsp;".repeat(60);
  const kvkk = privacyLine(data);
  const kvkkHtml = kvkk.url
    ? `${escapeHtml(kvkk.base)} <a href="${escapeHtml(kvkk.url)}" style="color:${BRAND.orangeDark};text-decoration:underline;">Aydınlatma metni</a>`
    : `${escapeHtml(kvkk.base)} ${escapeHtml(kvkk.contact)}`;
  return `<!DOCTYPE html>
<html lang="tr" dir="ltr" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <title>${escapeHtml(singleLine(title))}</title>
  <style>
    @media only screen and (max-width:620px) {
      .px { padding-left:20px !important; padding-right:20px !important; }
      .outer { padding:16px 8px !important; }
      h1 { font-size:22px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${BRAND.canvas};">
  <div lang="tr" dir="ltr" style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:transparent;mso-hide:all;">${preheader}${filler}</div>
  <div lang="tr" dir="ltr">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.canvas};margin:0;padding:0;">
    <tr>
      <td align="center" class="outer" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;table-layout:fixed;background:${BRAND.card};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.line};">
          <tr>
            <td style="height:6px;background:${BRAND.orange};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td class="px" style="padding:28px 40px 8px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td valign="middle">
                    <a href="${BRAND.siteUrl}" style="text-decoration:none;">
                      <img src="${BRAND.logoUrl}" alt="Parla Bilgi Teknolojileri ana sayfası" width="148" style="display:block;border:0;width:148px;height:auto;">
                    </a>
                  </td>
                  <td valign="middle" align="right" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.muted};font-family:${FONT};font-weight:700;">
                    Destek Portalı
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:8px 40px 0 40px;${WRAP}">
              <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND.orangeDark};font-weight:700;font-family:${FONT};">${escapeHtml(eyebrow || "Bildirim")}</p>
              <h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;color:${BRAND.ink};font-weight:700;font-family:Georgia,'Times New Roman',serif;${WRAP}">${escapeHtml(title)}</h1>
              <p style="margin:0 0 28px 0;font-size:16px;line-height:1.65;color:${BRAND.text};font-family:${FONT};${WRAP}">${escapeHtml(intro)}</p>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:8px 40px 36px 40px;border-top:1px solid ${BRAND.line};${WRAP}">
              <p style="margin:20px 0 8px 0;font-size:13px;line-height:1.55;color:${BRAND.muted};font-family:${FONT};">${escapeHtml(footerNote || REPLY_NOTICE)}</p>
              <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:${BRAND.muted};font-family:${FONT};">${kvkkHtml}</p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.muted};font-family:${FONT};">${escapeHtml(BRAND.name)} · <a href="${BRAND.siteUrl}" style="color:${BRAND.orangeDark};text-decoration:none;">parlabilgiteknolojileri.net</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  </div>
</body>
</html>`;
}

/** Konu: "<önek> · <talep no> · <başlık (ilk 40 karakter)>" */
function ticketSubject(prefix) {
  return (d) => {
    const parts = [prefix];
    if (d.ticket_number) parts.push(singleLine(d.ticket_number));
    const title = truncateText(singleLine(d.title), TITLE_IN_SUBJECT_MAX);
    if (title.text) parts.push(title.truncated ? `${title.text}…` : title.text);
    return parts.join(" · ");
  };
}

const num = (d, fallback) => singleLine(d.ticket_number) || fallback;

const COPY = {
  ticket_created: {
    staff: {
      subject: ticketSubject("Yeni destek talebi"),
      preview: (d) => `${singleLine(d.user_name) || "Müşteri"} yeni bir talep açtı.`,
      eyebrow: "Yeni talep",
      title: "Yeni destek talebi alındı",
      intro: (d) =>
        `${singleLine(d.user_name) || "Bir müşteri"} ${num(d, "yeni bir talep")} numaralı kaydı oluşturdu. Detayları portalda inceleyebilirsiniz.`,
      cta: "Talebi incele",
    },
    customer: {
      subject: ticketSubject("Talebiniz alındı"),
      preview: (d) => `${num(d, "Talebiniz")} sisteme kaydedildi.`,
      eyebrow: "Kayıt onayı",
      title: "Destek talebiniz alındı",
      intro: (d) =>
        `${num(d, "Talebiniz")} numaralı kaydınız Parla BT Destek sistemine işlendi. Ekibimiz en kısa sürede dönüş yapacaktır.`,
      cta: "Talebi görüntüle",
    },
  },
  ticket_assigned: {
    subject: ticketSubject("Size atanan talep"),
    preview: (d) => `${num(d, "Bir talep")} size atandı.`,
    eyebrow: "Atama",
    title: "Size yeni bir talep atandı",
    intro: (d) =>
      `${num(d, "Talep")} numaralı kayıt sorumluluğunuza verildi. Lütfen portal üzerinden inceleyip işleme alın.`,
    cta: "Görevi aç",
  },
  ticket_status_changed: {
    staff: {
      subject: ticketSubject("Durum güncellendi"),
      preview: (d) => `Yeni durum: ${labelStatus(d.status)}`,
      eyebrow: "Durum",
      title: "Talep durumu güncellendi",
      intro: (d) => `${num(d, "Talebin")} durumu “${labelStatus(d.status)}” olarak güncellendi.`,
      cta: "Güncellemeyi gör",
    },
    customer: {
      subject: ticketSubject("Durum güncellendi"),
      preview: (d) => `Talebinizin yeni durumu: ${labelStatus(d.status)}`,
      eyebrow: "Durum",
      title: "Talebinizin durumu güncellendi",
      intro: (d) => `${num(d, "Talebinizin")} durumu “${labelStatus(d.status)}” olarak güncellendi.`,
      cta: "Güncellemeyi gör",
    },
  },
  ticket_message: {
    staff: {
      subject: ticketSubject("Yeni yanıt"),
      preview: "Talebe yeni bir mesaj eklendi.",
      eyebrow: "Yazışma",
      title: "Talebe yeni mesaj geldi",
      intro: (d) =>
        `${num(d, "Talebe")} numaralı talebe yeni bir mesaj yazıldı. Özeti aşağıdadır; ayrıntı için portala gidebilirsiniz.`,
      cta: "Mesajı oku",
    },
    customer: {
      subject: ticketSubject("Yeni yanıt"),
      preview: "Talebinize destek ekibinden yeni bir yanıt geldi.",
      eyebrow: "Yazışma",
      title: "Talebinize yeni yanıt geldi",
      intro: (d) =>
        `${num(d, "Talebinize")} numaralı talebinize destek ekibimiz yeni bir yanıt yazdı. Özeti aşağıdadır; ayrıntı için portala gidebilirsiniz.`,
      cta: "Yanıtı oku",
    },
  },
  ticket_resolved: {
    staff: {
      subject: ticketSubject("Talep çözüldü"),
      preview: "Talep çözüldü olarak işaretlendi.",
      eyebrow: "Çözüm",
      title: "Talep çözüldü olarak işaretlendi",
      intro: (d) => `${num(d, "Talep")} çözüldü olarak işaretlendi. Müşteri kapanış onayı gerekebilir.`,
      cta: "Talebi aç",
    },
    customer: {
      subject: ticketSubject("Talep çözüldü"),
      preview: "Çözüm kaydı tamamlandı.",
      eyebrow: "Çözüm",
      title: "Talebiniz çözüldü",
      intro: (d) =>
        `${num(d, "Talebiniz")} çözüldü olarak işaretlendi. Kapanış onayı gerekebilir; portaldan kontrol edin.`,
      cta: "Çözümü incele",
    },
  },
  ticket_closed: {
    staff: {
      subject: ticketSubject("Talep kapatıldı"),
      preview: "Kayıt kapatıldı.",
      eyebrow: "Kapanış",
      title: "Talep kapatıldı",
      intro: (d) => `${num(d, "Talep")} kapatıldı.`,
      cta: "Kaydı görüntüle",
    },
    customer: {
      subject: ticketSubject("Talep kapatıldı"),
      preview: "Kayıt kapatıldı.",
      eyebrow: "Kapanış",
      title: "Talebiniz kapatıldı",
      intro: (d) =>
        `${num(d, "Talebiniz")} kapatıldı. İlgili kayıtlara destek portalından ulaşabilirsiniz.`,
      cta: "Kaydı görüntüle",
    },
  },
  ticket_close_approval: {
    subject: ticketSubject("Kapanış onayı"),
    preview: "Talebin kapanışı onayınızı bekliyor.",
    eyebrow: "Onay bekleniyor",
    title: "Kapanış onayınızı bekliyoruz",
    intro: (d) =>
      `${num(d, "Talebiniz")} için çözüm tamamlandı. Lütfen portala girerek kapanışı onaylayın veya gerekçenizle tekrar açın.`,
    cta: "Kapanışı onayla",
  },
  ticket_reopened: {
    staff: {
      subject: ticketSubject("Talep tekrar açıldı"),
      preview: "Müşteri kapanışı reddetti veya talebi yeniden açtı.",
      eyebrow: "Yeniden açıldı",
      title: "Talep tekrar açıldı",
      intro: (d) =>
        `${num(d, "Talep")} yeniden açık duruma alındı. Lütfen kaydı inceleyip devam edin.`,
      cta: "Talebi aç",
    },
    customer: {
      subject: ticketSubject("Talep tekrar açıldı"),
      preview: "Talebiniz yeniden açık duruma alındı.",
      eyebrow: "Yeniden açıldı",
      title: "Talebiniz tekrar açıldı",
      intro: (d) =>
        `${num(d, "Talebiniz")} yeniden açık duruma alındı. Ekibimiz konuyu yeniden ele alacaktır.`,
      cta: "Talebi görüntüle",
    },
  },
  send_to_customer: {
    subject: ticketSubject("İncelemeniz bekleniyor"),
    preview: "Test veya bilgilendirme için size iletildi.",
    eyebrow: "Müşteri testi",
    title: "İncelemeniz bekleniyor",
    intro: (d) =>
      `${num(d, "Talep")} size test veya bilgilendirme amacıyla iletildi. Lütfen kontrol edip portaldan dönüş yapın.`,
    cta: "Kontrol et",
  },
  user_credentials: {
    subject: "Parla BT Destek — hesabınız oluşturuldu",
    preview: "Destek portalı hesabınız hazır; şifrenizi kendiniz belirleyeceksiniz.",
    eyebrow: "Hesap",
    title: "Destek portalı hesabınız hazır",
    intro: (d) =>
      /^https:\/\/[^\s"'<>]+$/i.test(String(d.setPasswordUrl || ""))
        ? `Merhaba${d.name ? ` ${singleLine(d.name)}` : ""}, Parla BT Destek sisteminde hesabınız oluşturuldu. Bu e-postada şifre yer almaz: aşağıdaki düğmeyle şifrenizi kendiniz belirleyebilirsiniz. Bağlantı kısa süre geçerlidir ve yalnızca bir kez kullanılabilir; süresi dolduysa giriş sayfasındaki “Şifremi Unuttum” ile yeni bir bağlantı isteyebilirsiniz.`
        : `Merhaba${d.name ? ` ${singleLine(d.name)}` : ""}, Parla BT Destek sisteminde hesabınız oluşturuldu. Bu e-postada şifre yer almaz: şifrenizi kendiniz belirlemeniz için adresinize ayrıca bir “şifre belirleme” bağlantısı gönderilir. Bağlantı kısa süre geçerlidir; süresi dolduysa giriş sayfasındaki “Şifremi Unuttum” ile yeni bir bağlantı isteyebilirsiniz.`,
    cta: "Portala git",
    footer:
      "Şifrenizi kimseyle paylaşmayın; Parla BT çalışanları sizden hiçbir zaman şifre istemez. Bu iletiyi beklemiyorsanız info@parlabilgiteknolojileri.net adresine bildirin.",
  },
  // --- WP-05: atama bildirimi kapsamı -------------------------------------------------------------------------
  ticket_unassigned: {
    subject: ticketSubject("Talep sizden alındı"),
    preview: (d) => `${num(d, "Talep")} artık size atanmış değil.`,
    eyebrow: "Atama kaldırıldı",
    title: "Talep sizden alındı",
    intro: (d) =>
      `${num(d, "Talep")} numaralı kayıt artık sorumluluğunuzda değil${d.assignee_name ? `; yeni sorumlu: ${singleLine(d.assignee_name)}` : ""}. Kayıt salt okunur olarak görüntülenebilir.`,
    cta: "Talebi görüntüle",
  },
  consultant_assigned: {
    subject: ticketSubject("Talebinize danışman atandı"),
    preview: (d) => `${num(d, "Talebiniz")} için danışman atandı.`,
    eyebrow: "Danışman atandı",
    title: "Talebinize danışman atandı",
    intro: (d) =>
      `${num(d, "Talebiniz")} numaralı kaydınız${d.assignee_name ? ` ${singleLine(d.assignee_name)} adlı danışmanımıza` : " bir danışmanımıza"} atandı. Gelişmeleri portaldan takip edebilirsiniz.`,
    cta: "Talebi görüntüle",
  },
  ticket_priority_critical: {
    subject: ticketSubject("Kritik öncelik"),
    preview: (d) => `${num(d, "Bir talep")} kritik önceliğe yükseltildi.`,
    eyebrow: "Öncelik",
    title: "Talep kritik önceliğe yükseltildi",
    intro: (d) =>
      `${num(d, "Talep")} numaralı kayıt kritik önceliğe yükseltildi (ilk yanıt hedefi 1 saat). Lütfen öncelikle ilgilenin.`,
    cta: "Talebi aç",
  },
  // --- WP-04/05 + D-07 C: zamanlanmış otomasyon ---------------------------------------------------------------
  sla_warning: {
    subject: ticketSubject("SLA uyarısı"),
    preview: (d) => `${num(d, "Talep")}: ${singleLine(d.phase_label) || "SLA"} süresinin %80'i doldu.`,
    eyebrow: "SLA uyarısı",
    title: "SLA süresi %80'e ulaştı",
    intro: (d) =>
      `${num(d, "Talep")} numaralı kayıtta ${singleLine(d.phase_label) || "SLA"} hedef süresinin %80'i doldu${d.remaining_text ? ` (kalan: ${singleLine(d.remaining_text)})` : ""}. Süre dolmadan işlem yapılması önerilir.`,
    cta: "Talebi aç",
  },
  sla_breached: {
    subject: ticketSubject("SLA aşıldı"),
    preview: (d) => `${num(d, "Talep")}: ${singleLine(d.phase_label) || "SLA"} hedef süresi aşıldı.`,
    eyebrow: "SLA aşımı",
    title: "SLA hedef süresi aşıldı",
    intro: (d) =>
      `${num(d, "Talep")} numaralı kayıtta ${singleLine(d.phase_label) || "SLA"} hedef süresi aşıldı. Lütfen kaydı öncelikle ele alın.`,
    cta: "Talebi aç",
  },
  reminder_waiting_customer: {
    staff: {
      subject: ticketSubject("Müşteri yanıtı bekleniyor"),
      preview: (d) => `${num(d, "Talep")} ${Number(d.days) || ""} gündür müşteri yanıtı bekliyor.`,
      eyebrow: "Hatırlatma",
      title: "Müşteri yanıtı hâlâ bekleniyor",
      intro: (d) => `${num(d, "Talep")} numaralı kayıt ${Number(d.days) || "birkaç"} gündür müşteri yanıtı bekliyor. Gerekirse müşteriyle iletişime geçin.`,
      cta: "Talebi aç",
    },
    customer: {
      subject: ticketSubject("Yanıtınızı bekliyoruz"),
      preview: (d) => `${num(d, "Talebiniz")} için yanıtınız bekleniyor.`,
      eyebrow: "Hatırlatma",
      title: "Yanıtınızı bekliyoruz",
      intro: (d) => `${num(d, "Talebiniz")} numaralı kaydınız ${Number(d.days) || "birkaç"} gündür sizden gelecek bilgiyi bekliyor. Lütfen portaldan yanıt verin; yanıt gelmezse çalışmamız ilerleyemez.`,
      cta: "Talebe yanıt ver",
    },
  },
  reminder_pending_close: {
    subject: ticketSubject("Kapanış onayınızı bekliyoruz"),
    preview: (d) => `${num(d, "Talebiniz")} kapanış onayınızı bekliyor.`,
    eyebrow: "Hatırlatma",
    title: "Kapanış onayınız bekleniyor",
    intro: (d) =>
      `${num(d, "Talebiniz")} numaralı kaydınızın çözümü tamamlandı ve ${Number(d.days) || 3} gündür onayınızı bekliyor. ${Number(d.days_left) > 0 ? `Yanıt verilmezse kayıt ${Number(d.days_left)} gün sonra otomatik olarak kapatılır.` : "Yanıt verilmezse kayıt otomatik olarak kapatılır."} Sorun sürüyorsa kaydı gerekçenizle yeniden açabilirsiniz.`,
    cta: "Kapanışı onayla",
  },
  ticket_auto_closed: {
    staff: {
      subject: ticketSubject("Talep otomatik kapatıldı"),
      preview: "Müşteri yanıt vermediği için kayıt kapatıldı.",
      eyebrow: "Otomatik kapanış",
      title: "Talep otomatik kapatıldı",
      intro: (d) => `${num(d, "Talep")} numaralı kayıt, ${Number(d.days) || 10} gün boyunca müşteri onayı alınamadığı için sistem tarafından otomatik kapatıldı.`,
      cta: "Kaydı görüntüle",
    },
    customer: {
      subject: ticketSubject("Talebiniz otomatik kapatıldı"),
      preview: "Talebiniz otomatik olarak kapatıldı.",
      eyebrow: "Otomatik kapanış",
      title: "Talebiniz otomatik kapatıldı",
      intro: (d) => `${num(d, "Talebiniz")} numaralı kaydınız, ${Number(d.days) || 10} gün içinde onay/yanıt alınamadığı için otomatik olarak kapatıldı. Sorun sürüyorsa kapanıştan sonra 14 gün içinde portaldan yeniden açabilirsiniz.`,
      cta: "Kaydı görüntüle",
    },
  },
  unassigned_escalation: {
    subject: ticketSubject("Atanmamış talep"),
    preview: (d) => `${num(d, "Talep")} ${Number(d.hours) || 4} saati aşkın süredir atanmadı.`,
    eyebrow: "Eskalasyon",
    title: "Talep hâlâ atanmadı",
    intro: (d) => `${num(d, "Talep")} numaralı kayıt ${Number(d.hours) || 4} saati aşkın süredir bir danışmana atanmadı. Lütfen atama yapın.`,
    cta: "Talebi ata",
  },
  password_reset_admin: {
    subject: "Parla BT Destek — şifre belirleme bağlantınız",
    preview: "Şifrenizi belirlemek için bağlantıyı kullanın.",
    eyebrow: "Hesap",
    title: "Şifrenizi belirleyin",
    intro: (d) =>
      `Merhaba${d.name ? ` ${singleLine(d.name)}` : ""}, hesabınız için bir yönetici şifre belirleme bağlantısı oluşturdu. Aşağıdaki düğmeyle yeni şifrenizi belirleyebilirsiniz. Bağlantı kısa süre geçerlidir ve yalnızca bir kez kullanılabilir; süresi dolduysa giriş sayfasındaki “Şifremi Unuttum” ile yeni bir bağlantı isteyin.`,
    cta: "Şifremi belirle",
    footer:
      "Bu iletiyi beklemiyorsanız bağlantıyı kullanmayın ve info@parlabilgiteknolojileri.net adresine bildirin. Şifrenizi kimseyle paylaşmayın.",
  },
  test_email: {
    subject: "Parla BT Destek — test e-postası",
    preview: "E-posta servisi çalışıyor.",
    eyebrow: "Test",
    title: "E-posta servisi çalışıyor",
    intro: (d) =>
      `Merhaba${d.name ? ` ${singleLine(d.name)}` : ""}, bu ileti destek portalından gönderilen bir test e-postasıdır. Bunu görüyorsanız e-posta yapılandırması ve gönderen alan adı doğru çalışıyor.`,
    cta: null,
  },
  daily_digest: {
    subject: (d) => `Parla BT Destek — günlük özet (${singleLine(d.day)})`,
    preview: "Günlük e-posta kotası nedeniyle gönderilmeyen bildirimler.",
    eyebrow: "Günlük özet",
    title: "Kota nedeniyle gönderilmeyen bildirimler",
    intro: (d) =>
      `${singleLine(d.day)} günü günlük e-posta kotası dolduğu için ${Number(d.count) || 0} bildirim ayrı ayrı gönderilmedi. Aşağıda özetlenmiştir; ayrıntılar portalda görünür.`,
    cta: null,
  },
};

function pickCopy(type, data) {
  const entry = COPY[type];
  if (!entry) return null;
  if (entry.subject) return entry;
  return staffAudience(type, data) ? entry.staff : entry.customer;
}

function valueOf(field, data) {
  return typeof field === "function" ? field(data) : field;
}

function credentialsRows(data) {
  return [["Kullanıcı adı (e-posta)", singleLine(data.email)]].filter(([, v]) => v);
}

const EVENT_LABELS = {
  ticket_created: "Yeni talep",
  ticket_assigned: "Atama",
  ticket_status_changed: "Durum güncellemesi",
  ticket_message: "Yeni yanıt",
  ticket_resolved: "Çözüldü",
  ticket_closed: "Kapatıldı",
  ticket_close_approval: "Kapanış onayı",
  ticket_reopened: "Tekrar açıldı",
  send_to_customer: "Müşteri testi",
  ticket_unassigned: "Atama kaldırıldı",
  consultant_assigned: "Danışman atandı",
  ticket_priority_critical: "Kritik öncelik",
  sla_warning: "SLA %80 uyarısı",
  sla_breached: "SLA aşımı",
  reminder_waiting_customer: "Müşteri yanıtı hatırlatması",
  reminder_pending_close: "Kapanış onayı hatırlatması",
  ticket_auto_closed: "Otomatik kapanış",
  unassigned_escalation: "Atanmamış talep",
};

function digestBlock(data) {
  const items = Array.isArray(data.items) ? data.items.slice(0, 100) : [];
  return items.map((it) => {
    const label = [singleLine(it.ticket_number), singleLine(it.title)].filter(Boolean).join(" · ");
    const event = EVENT_LABELS[it.event] || singleLine(it.event);
    return `${event} (${it.audience === "customer" ? "müşteriye" : "ekibe"}): ${label}`;
  });
}

function buildPlainText({ title, intro, rows, note, byline, ctaLabel, ctaUrl, footerNote, data }) {
  const lines = [title, "", intro, ""];
  rows.forEach(([k, v]) => lines.push(`${k}: ${v}`));
  if (note) {
    lines.push("");
    if (byline) lines.push(byline);
    lines.push(note);
  }
  if (ctaUrl) {
    lines.push("", ctaLabel ? `${ctaLabel}: ${ctaUrl}` : ctaUrl);
  }
  const kvkk = privacyLine(data);
  lines.push(
    "",
    "--",
    footerNote || REPLY_NOTICE,
    kvkk.url ? `${kvkk.base} Aydınlatma metni: ${kvkk.url}` : `${kvkk.base} ${kvkk.contact}`,
    `${BRAND.name} · ${BRAND.siteUrl}`
  );
  return lines.join("\n");
}

function buildEmail(type, data) {
  const payload = data || {};
  const copy = pickCopy(type, payload);
  if (!copy) {
    return { error: "Bilinmeyen e-posta tipi." };
  }

  const audience = staffAudience(type, payload) ? "staff" : "customer";
  const subject = cleanSubject(valueOf(copy.subject, payload));
  const preview = singleLine(valueOf(copy.preview, payload));
  const intro = singleLine(valueOf(copy.intro, payload));

  let rows;
  let noteText = "";
  let byline = "";
  let digestRows = [];
  if (type === "user_credentials" || type === "password_reset_admin") {
    rows = credentialsRows(payload);
  } else if (type === "daily_digest") {
    rows = [];
    digestRows = digestBlock(payload);
    noteText = digestRows.join("\n");
  } else if (type === "test_email") {
    rows = [];
  } else {
    rows = metaRows(payload);
    const raw = multiLine(payload.note);
    if (raw) {
      const cut = truncateText(raw, NOTE_MAX);
      noteText = cut.truncated ? `${cut.text}${TRUNCATION_SUFFIX}` : cut.text;
      const who = singleLine(payload.author_name);
      const when = formatDateTr(payload.at);
      byline = [who && `Yazan: ${who}`, when].filter(Boolean).join(" · ");
    }
  }

  let ctaUrl = null;
  let ctaLabel = copy.cta;
  if (type === "user_credentials" || type === "password_reset_admin") {
    const origin = originFrom(payload);
    if (payload.setPasswordUrl && /^https:\/\/[^\s"'<>]+$/i.test(String(payload.setPasswordUrl))) {
      ctaUrl = String(payload.setPasswordUrl);
      ctaLabel = "Şifremi belirle";
    } else {
      ctaUrl = `${origin}/support-v2/login.html`;
    }
  } else if (copy.cta) {
    ctaUrl = ticketHref(payload, audience);
  }

  const bodyHtml = `
    ${renderMetaTable(rows)}
    ${renderNote(noteText, byline)}
    ${ctaLabel && ctaUrl ? renderButton(ctaUrl, ctaLabel) : ""}
  `;

  return {
    subject,
    preview,
    html: renderLayout({
      title: copy.title,
      preview,
      eyebrow: copy.eyebrow,
      intro,
      bodyHtml,
      footerNote: copy.footer,
      data: payload,
    }),
    text: buildPlainText({
      title: copy.title,
      intro,
      rows,
      note: noteText,
      byline,
      ctaLabel,
      ctaUrl,
      footerNote: copy.footer,
      data: payload,
    }),
    replyTo: BRAND.fromEmail,
  };
}

/** Şablonu olan olay tipleri (testler için). */
const TEMPLATE_TYPES = Object.keys(COPY);

module.exports = {
  BRAND,
  STATUS_LABELS,
  PRIORITY_LABELS,
  TEMPLATE_TYPES,
  NOTE_MAX,
  TRUNCATION_SUFFIX,
  buildEmail,
  escapeHtml,
  truncateText,
  cleanSubject,
  singleLine,
  multiLine,
  safeOrigin,
  formatDateTr,
};
