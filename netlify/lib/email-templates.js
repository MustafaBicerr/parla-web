/**
 * Parla BT — transactional HTML e-posta şablonları (tablo tabanlı, istemci uyumlu).
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

const STATUS_LABELS = {
  open: "Yeni / Atama Bekliyor",
  assigned: "Danışmana Atandı",
  in_progress: "İşlemde",
  waiting_customer: "Müşteri Testinde",
  pending_close: "Kapanış Onayı Bekliyor",
  closed: "Kapandı",
  reopened: "Tekrar Açıldı",
  resolved: "Çözüldü",
};

const PRIORITY_LABELS = {
  low: "Düşük",
  medium: "Orta",
  high: "Yüksek",
  critical: "Kritik",
};

const PRIORITY_COLORS = {
  low: "#0D7D4D",
  medium: "#1D4ED8",
  high: "#C47A00",
  critical: "#C41E3A",
};

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

function safeHttpUrl(value, fallback) {
  const raw = String(value || "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${BRAND.siteUrl}${raw}`;
  return fallback || BRAND.siteUrl;
}

function labelStatus(status) {
  const key = String(status || "").toLowerCase();
  return STATUS_LABELS[key] || status || "—";
}

function labelPriority(priority) {
  const key = String(priority || "").toLowerCase();
  return PRIORITY_LABELS[key] || priority || "—";
}

function originFrom(data) {
  return String(data.portalUrl || data.origin || BRAND.siteUrl).replace(/\/$/, "");
}

function ticketHref(data, audience) {
  const origin = originFrom(data);
  const id = encodeURIComponent(data.ticket_id || data.id || "");
  if (!id) return `${origin}/support-v2/login.html`;
  const path =
    audience === "staff"
      ? "/support-v2/admin/ticket-detail.html"
      : "/support-v2/customer/ticket-detail.html";
  return `${origin}${path}?id=${id}`;
}

function staffAudience(type, data) {
  if (data.audience === "staff") return true;
  if (data.audience === "customer") return false;
  return type === "ticket_assigned" || type === "ticket_reopened";
}

function metaRows(data) {
  const rows = [];
  if (data.ticket_number) rows.push(["Talep no", data.ticket_number]);
  if (data.title) rows.push(["Konu", data.title]);
  if (data.status) rows.push(["Durum", labelStatus(data.status)]);
  if (data.priority) rows.push(["Öncelik", labelPriority(data.priority)]);
  if (data.company_name) rows.push(["Firma", data.company_name]);
  if (data.user_name) rows.push(["Muhatap", data.user_name]);
  return rows;
}

function renderMetaTable(rows) {
  if (!rows.length) return "";
  const body = rows
    .map(
      ([k, v], i) => `
      <tr>
        <td style="padding:${i === 0 ? "0" : "10px"} 0 ${i === rows.length - 1 ? "0" : "10px"} 0;border-bottom:${i === rows.length - 1 ? "0" : "1px solid #E8E4DE"};width:38%;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#6B7280;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(k)}</td>
        <td style="padding:${i === 0 ? "0" : "10px"} 0 ${i === rows.length - 1 ? "0" : "10px"} 0;border-bottom:${i === rows.length - 1 ? "0" : "1px solid #E8E4DE"};font-size:15px;color:#1A1A1A;font-weight:600;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(v)}</td>
      </tr>`
    )
    .join("");
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px 0;">
      ${body}
    </table>`;
}

function renderNote(note) {
  const text = String(note || "").trim();
  if (!text) return "";
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px 0;">
      <tr>
        <td style="border-left:3px solid #F37021;background:#FFF8F3;padding:16px 18px;font-size:15px;line-height:1.6;color:#333333;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          ${nl2br(text)}
        </td>
      </tr>
    </table>`;
}

function renderButton(href, label) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
      <tr>
        <td align="center" bgcolor="${BRAND.orange}" style="border-radius:8px;">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.01em;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

function renderLayout({ title, preview, eyebrow, intro, bodyHtml, footerNote }) {
  const preheader = escapeHtml(preview || intro || title);
  return `<!DOCTYPE html>
<html lang="tr" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.canvas};">
  <div lang="tr" dir="ltr" style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
  <div lang="tr" dir="ltr">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.canvas};margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background:${BRAND.card};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.line};">
          <tr>
            <td style="height:6px;background:${BRAND.orange};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 40px 8px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td valign="middle">
                    <a href="${BRAND.siteUrl}" style="text-decoration:none;">
                      <img src="${BRAND.logoUrl}" alt="Parla Bilgi Teknolojileri ana sayfası" width="148" style="display:block;border:0;width:148px;height:auto;">
                    </a>
                  </td>
                  <td valign="middle" align="right" style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${BRAND.muted};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-weight:700;">
                    Destek Portalı
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 0 40px;">
              <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:${BRAND.orange};font-weight:700;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(eyebrow || "Bildirim")}</p>
              <h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;color:${BRAND.ink};font-weight:700;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(title)}</h1>
              <p style="margin:0 0 28px 0;font-size:16px;line-height:1.65;color:${BRAND.text};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(intro)}</p>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 36px 40px;border-top:1px solid ${BRAND.line};">
              <p style="margin:20px 0 6px 0;font-size:13px;line-height:1.55;color:${BRAND.muted};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(footerNote || "Bu e-postayı yanıtlayabilirsiniz; mesajınız doğrudan info@parlabilgiteknolojileri.net adresine ulaşır.")}</p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#9CA3AF;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(BRAND.name)} · <a href="${BRAND.siteUrl}" style="color:${BRAND.orange};text-decoration:none;">parlabilgiteknolojileri.net</a></p>
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

const COPY = {
  ticket_created: {
    staff: {
      subject: (d) => `Yeni destek talebi · ${d.ticket_number || ""}`.trim(),
      preview: (d) => `${d.user_name || "Müşteri"} yeni bir talep açtı.`,
      eyebrow: "Yeni talep",
      title: "Yeni destek talebi alındı",
      intro: (d) =>
        `${d.user_name || "Bir müşteri"} ${d.ticket_number || "yeni bir talep"} numaralı kaydı oluşturdu. Detayları portalda inceleyebilirsiniz.`,
      cta: "Talebi incele",
    },
    customer: {
      subject: (d) => `Talebiniz alındı · ${d.ticket_number || ""}`.trim(),
      preview: (d) => `${d.ticket_number || "Talebiniz"} sisteme kaydedildi.`,
      eyebrow: "Kayıt onayı",
      title: "Destek talebiniz alındı",
      intro: (d) =>
        `${d.ticket_number || "Talebiniz"} numaralı kaydınız Parla BT Destek sistemine işlendi. Ekibimiz en kısa sürede dönüş yapacaktır.`,
      cta: "Talebi görüntüle",
    },
  },
  ticket_assigned: {
    subject: (d) => `Size atanan talep · ${d.ticket_number || ""}`.trim(),
    preview: (d) => `${d.ticket_number || "Bir talep"} size atandı.`,
    eyebrow: "Atama",
    title: "Size yeni bir talep atandı",
    intro: (d) =>
      `${d.ticket_number || "Talep"} numaralı kayıt sorumluluğunuza verildi. Lütfen portal üzerinden inceleyip işleme alın.`,
    cta: "Görevi aç",
  },
  ticket_status_changed: {
    subject: (d) => `Durum güncellendi · ${d.ticket_number || ""}`.trim(),
    preview: (d) => `Yeni durum: ${labelStatus(d.status)}`,
    eyebrow: "Durum",
    title: "Talep durumu güncellendi",
    intro: (d) =>
      `${d.ticket_number || "Talebinizin"} durumu “${labelStatus(d.status)}” olarak güncellendi.`,
    cta: "Güncellemeyi gör",
  },
  ticket_message: {
    subject: (d) => `Yeni yanıt · ${d.ticket_number || ""}`.trim(),
    preview: "Talebe yeni bir mesaj eklendi.",
    eyebrow: "Yazışma",
    title: "Talebe yeni yanıt geldi",
    intro: (d) =>
      `${d.ticket_number || "Talebinize"} yeni bir mesaj yazıldı. Özeti aşağıdadır; ayrıntı için portala gidebilirsiniz.`,
    cta: "Yanıtı oku",
  },
  ticket_resolved: {
    subject: (d) => `Talep çözüldü · ${d.ticket_number || ""}`.trim(),
    preview: "Çözüm kaydı tamamlandı.",
    eyebrow: "Çözüm",
    title: "Talebiniz çözüldü",
    intro: (d) =>
      `${d.ticket_number || "Talebiniz"} çözüldü olarak işaretlendi. Kapanış onayı gerekebilir; portaldan kontrol edin.`,
    cta: "Çözümü incele",
  },
  ticket_closed: {
    subject: (d) => `Talep kapatıldı · ${d.ticket_number || ""}`.trim(),
    preview: "Kayıt kapatıldı.",
    eyebrow: "Kapanış",
    title: "Talep kapatıldı",
    intro: (d) =>
      `${d.ticket_number || "Talebiniz"} kapatıldı. İlgili kayıtlara destek portalından ulaşabilirsiniz.`,
    cta: "Kaydı görüntüle",
  },
  ticket_close_approval: {
    subject: (d) => `Kapanış onayı · ${d.ticket_number || ""}`.trim(),
    preview: "Talebin kapanışı onayınızı bekliyor.",
    eyebrow: "Onay bekleniyor",
    title: "Kapanış onayınızı bekliyoruz",
    intro: (d) =>
      `${d.ticket_number || "Talebiniz"} için çözüm tamamlandı. Lütfen portala girerek kapanışı onaylayın veya gerekçenizle tekrar açın.`,
    cta: "Kapanışı onayla",
  },
  ticket_reopened: {
    subject: (d) => `Talep tekrar açıldı · ${d.ticket_number || ""}`.trim(),
    preview: "Müşteri kapanışı reddetti veya talebi yeniden açtı.",
    eyebrow: "Yeniden açıldı",
    title: "Talep tekrar açıldı",
    intro: (d) =>
      `${d.ticket_number || "Talep"} yeniden açık duruma alındı. Lütfen kaydı inceleyip devam edin.`,
    cta: "Talebi aç",
  },
  send_to_customer: {
    subject: (d) => `İncelemeniz bekleniyor · ${d.ticket_number || ""}`.trim(),
    preview: "Test veya bilgilendirme için size iletildi.",
    eyebrow: "Müşteri testi",
    title: "İncelemeniz bekleniyor",
    intro: (d) =>
      `${d.ticket_number || "Talep"} size test veya bilgilendirme amacıyla iletildi. Lütfen kontrol edip portaldan dönüş yapın.`,
    cta: "Kontrol et",
  },
  user_credentials: {
    subject: "Parla BT Destek — giriş bilgileriniz",
    preview: "Hesabınız hazır. Geçici şifreniz bu iletidedir.",
    eyebrow: "Hesap",
    title: "Destek portalı hesabınız hazır",
    intro: (d) =>
      `Merhaba${d.name ? ` ${d.name}` : ""}, Parla BT Destek sisteminde hesabınız oluşturuldu. Aşağıdaki bilgilerle giriş yapabilirsiniz; ilk oturumda şifrenizi değiştirmenizi öneririz.`,
    cta: "Portala giriş yap",
  },
  contact_form: {
    subject: (d) => `Yeni iletişim mesajı${d.subject ? ` · ${d.subject}` : ""}`,
    preview: (d) => `${d.name || "Ziyaretçi"} siteden mesaj bıraktı.`,
    eyebrow: "Web sitesi",
    title: "Yeni iletişim mesajı",
    intro: "Kurumsal sitedeki iletişim formundan yeni bir kayıt düştü.",
    cta: null,
  },
  career_form: {
    subject: (d) => `Yeni iş başvurusu · ${d.first_name || ""} ${d.last_name || ""}`.trim(),
    preview: "Kariyer formundan yeni başvuru.",
    eyebrow: "Kariyer",
    title: "Yeni iş başvurusu",
    intro: "Kariyer sayfasından yeni bir başvuru alındı.",
    cta: null,
  },
  idea_form: {
    subject: (d) => `Yeni fikir başvurusu${d.idea_title ? ` · ${d.idea_title}` : ""}`,
    preview: "Ödüllü fikir yarışmasına yeni başvuru.",
    eyebrow: "Fikir yarışması",
    title: "Yeni fikir başvurusu",
    intro: "Fikir yarışması formundan yeni bir kayıt alındı.",
    cta: null,
  },
};

function pickCopy(type, data) {
  const entry = COPY[type];
  if (!entry) return null;
  if (type === "ticket_created") {
    return staffAudience(type, data) ? entry.staff : entry.customer;
  }
  return entry;
}

function valueOf(field, data) {
  return typeof field === "function" ? field(data) : field;
}

function credentialsBlock(data) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px 0;background:#0A1628;border-radius:12px;">
      <tr>
        <td style="padding:20px 22px;">
          <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#F37021;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">E-posta</p>
          <p style="margin:0 0 16px 0;font-size:16px;color:#FFFFFF;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(data.email || "")}</p>
          <p style="margin:0 0 6px 0;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#F37021;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Geçici şifre</p>
          <p style="margin:0;font-size:18px;letter-spacing:0.04em;color:#FFFFFF;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escapeHtml(data.password || "")}</p>
        </td>
      </tr>
    </table>`;
}

function formRows(type, data) {
  if (type === "contact_form") {
    return [
      ["Ad", data.name],
      ["E-posta", data.email],
      ["Telefon", data.phone],
      ["Konu", data.subject],
    ].filter(([, v]) => v);
  }
  if (type === "career_form") {
    return [
      ["Ad", data.first_name],
      ["Soyad", data.last_name],
      ["E-posta", data.email],
      ["Telefon", data.phone],
      ["Şehir", data.city],
      ["Deneyim", data.experience],
      ["CV", data.cvUrl],
    ].filter(([, v]) => v);
  }
  if (type === "idea_form") {
    return [
      ["Ad", data.first_name],
      ["Soyad", data.last_name],
      ["E-posta", data.email],
      ["Telefon", data.phone],
      ["Başlık", data.idea_title],
    ].filter(([, v]) => v);
  }
  return metaRows(data);
}

function formNote(type, data) {
  if (type === "contact_form") return data.message;
  if (type === "career_form") return data.motivation;
  if (type === "idea_form") {
    const parts = [];
    if (data.idea_details) parts.push(data.idea_details);
    if (data.problem_solved) parts.push(`Çözülen problem:\n${data.problem_solved}`);
    return parts.join("\n\n");
  }
  return data.note;
}

function buildPlainText({ title, intro, rows, note, ctaLabel, ctaUrl }) {
  const lines = [title, "", intro, ""];
  rows.forEach(([k, v]) => lines.push(`${k}: ${v}`));
  if (note) {
    lines.push("", note);
  }
  if (ctaUrl) {
    lines.push("", `${ctaLabel}: ${ctaUrl}`);
  }
  lines.push(
    "",
    "Bu e-postayı yanıtlayabilirsiniz.",
    `${BRAND.name} · ${BRAND.fromEmail}`,
    BRAND.siteUrl
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
  const subject = String(valueOf(copy.subject, payload) || BRAND.shortName).trim();
  const preview = String(valueOf(copy.preview, payload) || "");
  const intro = String(valueOf(copy.intro, payload) || "");
  const rows = formRows(type, payload);
  const note = formNote(type, payload);
  const ctaUrl =
    type === "user_credentials"
      ? safeHttpUrl(payload.loginUrl, `${originFrom(payload)}/support-v2/login.html`)
      : copy.cta
        ? ticketHref(payload, audience)
        : null;

  let extraHtml = "";
  if (type === "user_credentials") extraHtml += credentialsBlock(payload);

  const bodyHtml = `
    ${extraHtml}
    ${renderMetaTable(rows)}
    ${renderNote(note)}
    ${copy.cta && ctaUrl ? renderButton(ctaUrl, copy.cta) : ""}
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
      footerNote:
        type === "user_credentials"
          ? "Şifrenizi kimseyle paylaşmayın. Bu iletiyi beklemiyorsanız lütfen info@parlabilgiteknolojileri.net adresine yazın."
          : undefined,
    }),
    text: buildPlainText({
      title: copy.title,
      intro,
      rows,
      note,
      ctaLabel: copy.cta,
      ctaUrl,
    }),
    replyTo: payload.replyTo || BRAND.fromEmail,
  };
}

module.exports = {
  BRAND,
  buildEmail,
  escapeHtml,
};
