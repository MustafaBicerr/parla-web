// --- AYARLAR ---
var HEDEF_MAIL = "info@parlabilgiteknolojileri.net";
var RESEND_FROM = "Parla BT Destek <info@parlabilgiteknolojileri.net>";
var GEMINI_API_KEY = "AIzaSyCublpywjEbq8YUWychrQn2qqieIFOEjoA"; // Tercihen PropertiesService kullanın
var HEDEF_KLASOR_YOLU = "Web_Dosyalari/Kariyer_Formu_CV";
// Resend: Apps Script → Project Settings → Script properties → RESEND_API_KEY
// ----------------

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var type = params.type;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var timestamp = new Date();

    // --- SENARYO 1: CHATBOT ---
    if (type === "chat") {
      var sheetChat = ss.getSheetByName("Chat_Logs");
      var userMsg = params.message;
      var botReply = callGeminiAPI(userMsg);
      if (sheetChat) { sheetChat.appendRow([timestamp, userMsg, botReply]); }

      return ContentService.createTextOutput(JSON.stringify({ "reply": botReply })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- SENARYO 2: KARİYER FORMU ---
    else if (type === "career") {
      var sheetCareer = ss.getSheetByName("Kariyer_Basvurulari");
      var cvUrl = "Dosya Yok";

      if (params.file && params.file.data) {
        var data = Utilities.base64Decode(params.file.data);
        var blob = Utilities.newBlob(data, params.file.type, params.first_name + "_" + params.last_name + "_CV.pdf");

        var folder = getOrCreateFolder(HEDEF_KLASOR_YOLU);
        var file = folder.createFile(blob);

        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        cvUrl = file.getUrl();
      }

      sheetCareer.appendRow([timestamp, params.first_name, params.last_name, params.email, params.phone, params.city, params.experience, params.motivation, cvUrl]);
      sendViaResend_({
        to: HEDEF_MAIL,
        replyTo: params.email,
        subject: "Yeni iş başvurusu · " + params.first_name + " " + params.last_name,
        eyebrow: "Kariyer",
        title: "Yeni iş başvurusu",
        intro: "Kariyer sayfasından yeni bir başvuru alındı.",
        rows: [
          ["Ad", params.first_name],
          ["Soyad", params.last_name],
          ["E-posta", params.email],
          ["Telefon", params.phone],
          ["Şehir", params.city],
          ["Deneyim", params.experience],
          ["CV", cvUrl]
        ],
        note: params.motivation
      });

      return ContentService.createTextOutput(JSON.stringify({ "result": "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- SENARYO 3: İLETİŞİM FORMU ---
    else if (type === "contact") {
      var sheetContact = ss.getSheetByName("Iletisim_Mesajlari");
      sheetContact.appendRow([timestamp, params.name, params.email, params.subject, params.message, params.phone]);
      sendViaResend_({
        to: HEDEF_MAIL,
        replyTo: params.email,
        subject: "Yeni iletişim mesajı" + (params.subject ? " · " + params.subject : ""),
        eyebrow: "Web sitesi",
        title: "Yeni iletişim mesajı",
        intro: (params.name || "Ziyaretçi") + " kurumsal siteden mesaj bıraktı.",
        rows: [
          ["Ad", params.name],
          ["E-posta", params.email],
          ["Telefon", params.phone],
          ["Konu", params.subject]
        ],
        note: params.message
      });

      return ContentService.createTextOutput(JSON.stringify({ "result": "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- SENARYO 4: FİKİR FORMU ---
    else if (type === "idea") {
      var sheetIdea = ss.getSheetByName("Fikir_Yarismasi");
      if (!sheetIdea) {
        return ContentService.createTextOutput(JSON.stringify({ "result": "error", "reply": "Fikir_Yarismasi sayfası bulunamadı." })).setMimeType(ContentService.MimeType.JSON);
      }

      var problem = (params.problem_solved !== undefined && params.problem_solved !== null) ? String(params.problem_solved) : "";
      sheetIdea.appendRow([
        timestamp,
        params.first_name,
        params.last_name,
        params.phone,
        params.email,
        params.idea_title,
        params.idea_details,
        problem
      ]);

      sendViaResend_({
        to: HEDEF_MAIL,
        replyTo: params.email,
        subject: "Yeni fikir başvurusu · " + params.idea_title,
        eyebrow: "Fikir yarışması",
        title: "Yeni fikir başvurusu",
        intro: "Ödüllü fikir yarışmasına yeni bir kayıt düştü.",
        rows: [
          ["Ad", params.first_name],
          ["Soyad", params.last_name],
          ["E-posta", params.email],
          ["Telefon", params.phone],
          ["Başlık", params.idea_title]
        ],
        note: params.idea_details + (problem.trim() !== "" ? "\n\nÇözülen problem:\n" + problem : "")
      });

      return ContentService.createTextOutput(JSON.stringify({ "result": "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- SENARYO 5: DESTEK PORTALI (yedek) ---
    // Canlı portal Netlify Function kullanır. Bu dal yalnızca eski istemciler içindir.
    else if (type === "support_v2_notify") {
      var to = params.to;
      var recipients = Array.isArray(to) ? to : String(to || "").split(",");
      var td = params.ticketData || {};
      if (!recipients.length || !String(recipients[0] || "").trim()) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Alıcı yok" })).setMimeType(ContentService.MimeType.JSON);
      }
      sendViaResend_({
        to: recipients,
        subject: params.subject || ("Parla BT Destek · " + (td.ticket_number || "")),
        eyebrow: "Destek Portalı",
        title: params.subject || "Destek bildirimi",
        intro: params.body || (td.title || "Yeni bir destek bildirimi."),
        rows: [
          ["Talep no", td.ticket_number],
          ["Konu", td.title],
          ["Durum", td.status],
          ["Öncelik", td.priority]
        ],
        note: td.note || td.event
      });
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: "E-posta gönderildi." })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "reply": "Bilinmeyen istek türü." })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ "result": "error", "reply": "Bir hata oluştu: " + error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

// --- YARDIMCI 1: KLASÖR YOLU BULUCU ---
function getOrCreateFolder(path) {
  var folders = path.split('/');
  var prevFolder = DriveApp.getRootFolder();

  for (var i = 0; i < folders.length; i++) {
    var folderName = folders[i];
    var folderIterator = prevFolder.getFoldersByName(folderName);

    if (folderIterator.hasNext()) {
      prevFolder = folderIterator.next();
    } else {
      prevFolder = prevFolder.createFolder(folderName);
    }
  }
  return prevFolder;
}

// --- KARARLI GEMINI API FONKSİYONU (Standart Model) ---
function callGeminiAPI(prompt) {
  var model = "gemini-flash-latest";

  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + GEMINI_API_KEY;

  var systemInstruction = "Sen Parla BT (SAP Danışmanlık Firması) asistanısın. Kısa, Türkçe ve profesyonel cevap ver. SAP, E-Dönüşüm, Lisanslama konularında yardımcı ol.";

  var payload = {
    "contents": [{
      "parts": [{
        "text": systemInstruction + "\n\nKullanıcı Sorusu: " + prompt
      }]
    }],
    "safetySettings": [
      { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_ONLY_HIGH" },
      { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_ONLY_HIGH" },
      { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_ONLY_HIGH" },
      { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_ONLY_HIGH" }
    ]
  };

  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var json = JSON.parse(response.getContentText());

    if (json.candidates && json.candidates.length > 0 && json.candidates[0].content) {
      return json.candidates[0].content.parts[0].text;
    }

    else if (json.error) {
      if (json.error.message.includes("quota")) {
        return "Üzgünüm, günlük işlem limitim doldu. Lütfen daha sonra tekrar deneyin.";
      }
      return "Bot Hatası: " + json.error.message;
    } else {
      return "Cevap alınamadı.";
    }

  } catch (e) {
    return "Bağlantı hatası: " + e.toString();
  }
}

function htmlEscape_(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlNl2br_(value) {
  return htmlEscape_(value).replace(/\r\n|\r|\n/g, "<br>");
}

function parlaMailHtml_(opts) {
  var rows = opts.rows || [];
  var rowHtml = "";
  var i;
  for (i = 0; i < rows.length; i++) {
    if (!rows[i] || rows[i][1] == null || String(rows[i][1]).trim() === "") continue;
    rowHtml +=
      "<tr>" +
      '<td style="padding:8px 0;border-bottom:1px solid #E8E4DE;width:38%;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:0.04em;">' +
      htmlEscape_(rows[i][0]) +
      "</td>" +
      '<td style="padding:8px 0;border-bottom:1px solid #E8E4DE;font-size:15px;color:#1A1A1A;font-weight:600;">' +
      htmlEscape_(rows[i][1]) +
      "</td></tr>";
  }
  var noteHtml = "";
  if (opts.note && String(opts.note).trim()) {
    noteHtml =
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px 0;"><tr>' +
      '<td style="border-left:3px solid #F37021;background:#FFF8F3;padding:16px 18px;font-size:15px;line-height:1.6;color:#333;">' +
      htmlNl2br_(opts.note) +
      "</td></tr></table>";
  }
  return (
    '<!DOCTYPE html><html lang="tr" dir="ltr"><head><meta charset="utf-8"><title>' +
    htmlEscape_(opts.title) +
    "</title></head><body style=\"margin:0;background:#F3F1ED;\">" +
    '<div lang="tr" dir="ltr">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1ED;"><tr><td align="center" style="padding:32px 16px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#fff;border-radius:16px;border:1px solid #E8E4DE;">' +
    '<tr><td style="height:6px;background:#F37021;font-size:0;">&nbsp;</td></tr>' +
    '<tr><td style="padding:28px 40px 8px 40px;"><img src="https://www.parlabilgiteknolojileri.net/assets/img/parla-logo/parla-logo.png" alt="Parla Bilgi Teknolojileri ana sayfası" width="148" style="display:block;border:0;"></td></tr>' +
    '<tr><td style="padding:8px 40px 36px 40px;">' +
    '<p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#F37021;font-weight:700;">' +
    htmlEscape_(opts.eyebrow || "Bildirim") +
    "</p>" +
    '<h1 style="margin:0 0 16px 0;font-size:26px;line-height:1.25;color:#1A1A1A;font-family:Georgia,serif;">' +
    htmlEscape_(opts.title) +
    "</h1>" +
    '<p style="margin:0 0 24px 0;font-size:16px;line-height:1.65;color:#333;">' +
    htmlEscape_(opts.intro || "") +
    "</p>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    rowHtml +
    "</table>" +
    noteHtml +
    '<p style="margin:24px 0 0 0;font-size:13px;color:#6B7280;">Bu e-postayı yanıtlayabilirsiniz; mesajınız info@parlabilgiteknolojileri.net adresine ulaşır.</p>' +
    "</td></tr></table></td></tr></table></div></body></html>"
  );
}

function parlaMailText_(opts) {
  var lines = [opts.title || "", "", opts.intro || "", ""];
  var rows = opts.rows || [];
  var i;
  for (i = 0; i < rows.length; i++) {
    if (!rows[i] || rows[i][1] == null || String(rows[i][1]).trim() === "") continue;
    lines.push(rows[i][0] + ": " + rows[i][1]);
  }
  if (opts.note) {
    lines.push("", String(opts.note));
  }
  lines.push("", "Parla Bilgi Teknolojileri · info@parlabilgiteknolojileri.net");
  return lines.join("\n");
}

function sendViaResend_(opts) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("RESEND_API_KEY Script Property tanımlı değil.");
  }
  var to = opts.to;
  var recipients = Array.isArray(to)
    ? to
    : String(to || "")
        .split(",")
        .map(function (item) {
          return String(item || "").trim();
        })
        .filter(Boolean);
  if (!recipients.length) {
    throw new Error("Alıcı yok");
  }
  var payload = {
    from: RESEND_FROM,
    to: recipients,
    subject: opts.subject || "Parla BT",
    html: parlaMailHtml_(opts),
    text: parlaMailText_(opts),
    reply_to: [opts.replyTo || HEDEF_MAIL]
  };
  var response = UrlFetchApp.fetch("https://api.resend.com/emails", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Resend gönderimi başarısız (" + code + ")");
  }
}

