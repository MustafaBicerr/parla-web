// --- AYARLAR ---
var HEDEF_MAIL = "info@parlabilgiteknolojileri.net";
var GEMINI_API_KEY = "AIzaSyCublpywjEbq8YUWychrQn2qqieIFOEjoA"; // Tercihen PropertiesService kullanın
var HEDEF_KLASOR_YOLU = "Web_Dosyalari/Kariyer_Formu_CV";
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
      GmailApp.sendEmail(HEDEF_MAIL, "Yeni İş Başvurusu: " + params.first_name, "Detaylar tabloda.\nCV Linki: " + cvUrl);

      return ContentService.createTextOutput(JSON.stringify({ "result": "success" })).setMimeType(ContentService.MimeType.JSON);
    }

    // --- SENARYO 3: İLETİŞİM FORMU ---
    else if (type === "contact") {
      var sheetContact = ss.getSheetByName("Iletisim_Mesajlari");
      sheetContact.appendRow([timestamp, params.name, params.email, params.subject, params.message, params.phone]);
      GmailApp.sendEmail(HEDEF_MAIL, "Yeni İletişim Mesajı", "Gönderen: " + params.name + "\nMesaj: " + params.message + "\nTelefon: " + params.phone);

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

      var mailBody =
        "Yeni fikir başvurusu.\n\n" +
        "Ad: " + params.first_name + "\n" +
        "Soyad: " + params.last_name + "\n" +
        "Telefon: " + params.phone + "\n" +
        "E-posta: " + params.email + "\n\n" +
        "Fikir başlığı: " + params.idea_title + "\n\n" +
        "Fikir detayları / özeti:\n" + params.idea_details + "\n\n" +
        "Çözülen problem:\n" + (problem.trim() !== "" ? problem : "(Belirtilmedi)");

      GmailApp.sendEmail(HEDEF_MAIL, "Yeni Fikir Başvurusu: " + params.idea_title, mailBody);

      return ContentService.createTextOutput(JSON.stringify({ "result": "success" })).setMimeType(ContentService.MimeType.JSON);
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

