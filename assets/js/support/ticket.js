/**
 * SAP Destek — ticket detay sayfası
 */
document.addEventListener("DOMContentLoaded", function () {
  var headerEl = document.getElementById("sp-header");
  var contentEl = document.getElementById("sp-ticket-content");
  var params = new URLSearchParams(window.location.search);
  var ticketId = params.get("id");

  if (!ticketId) {
    window.location.href = "/support/dashboard.html";
    return;
  }

  ParlaSupportAuth.requireAuth(null)
    .then(function (user) {
      headerEl.innerHTML = ParlaSupportUI.renderPortalHeader(user, { showDashboard: true });
      ParlaSupportUI.bindLogout();
      loadTicket();
    })
    .catch(function () {});

  function loadTicket() {
    ParlaSupportUI.showLoading(true);
    ParlaSupportApi.getTicket(ParlaSupportAuth.getToken(), ticketId)
      .then(function (res) {
        if (!res.success) {
          ParlaSupportUI.toast(res.message, "error");
          setTimeout(function () {
            window.location.href = ParlaSupportAuth.isAdmin()
              ? "/support/admin.html"
              : "/support/dashboard.html";
          }, 1500);
          return;
        }
        renderTicket(res.data);
      })
      .finally(function () {
        ParlaSupportUI.showLoading(false);
      });
  }

  function metaItem(label, value) {
    return (
      '<div class="sp-meta-item"><label>' +
      ParlaSupportUI.escapeHtml(label) +
      "</label><span>" +
      value +
      "</span></div>"
    );
  }

  function renderTicket(data) {
    var t = data.ticket;
    var messages = data.messages || [];
    var isAdmin = ParlaSupportAuth.isAdmin();
    var customer = t.customer;

    var adminPanel = "";
    if (isAdmin) {
      adminPanel =
        '<div class="sp-section sp-mt-1">' +
        '<div class="sp-section-header"><h3>Admin İşlemleri</h3></div>' +
        '<div class="sp-section-body">' +
        '<div class="sp-form-row">' +
        '<div class="sp-form-group"><label>Durum</label><select id="sp-admin-status">' +
        ["OPEN", "IN PROGRESS", "WAITING CUSTOMER", "RESOLVED", "CLOSED"]
          .map(function (s) {
            var sel = String(t.status).toUpperCase() === s ? " selected" : "";
            return '<option value="' + s + '"' + sel + ">" + s + "</option>";
          })
          .join("") +
        "</select></div>" +
        '<div class="sp-form-group"><label>Atanan</label><input type="text" id="sp-admin-assign" value="' +
        ParlaSupportUI.escapeHtml(t.assigned_to || "") +
        '"></div></div>' +
        '<div class="sp-form-group"><label>Dahili not</label><textarea id="sp-admin-note" rows="2"></textarea></div>' +
        '<button type="button" class="sp-btn sp-btn-primary sp-btn-sm" id="sp-admin-save" style="width:auto">Güncelle</button>' +
        "</div></div>";
    }
    

    var timeline = messages
      .map(function (m) {
        var role = String(m.author_role || "").toLowerCase();
        var cls = role === "admin" ? "admin" : role === "system" ? "system" : "";
        return (
          '<li class="sp-timeline-item ' + cls + '"><span class="sp-timeline-dot"></span>' +
          '<div class="sp-timeline-bubble"><div class="sp-timeline-head">' +
          '<span class="sp-timeline-author">' + ParlaSupportUI.escapeHtml(m.author_name) +
          (m.is_internal ? " (Dahili)" : "") + "</span>" +
          '<span class="sp-timeline-time">' + ParlaSupportUI.formatDate(m.created_at) + "</span></div>" +
          "<p>" + ParlaSupportUI.escapeHtml(m.message).replace(/\n/g, "<br>") + "</p></div></li>"
        );
      })
      .join("");
    

    contentEl.innerHTML =
      '<div class="sp-section"><div class="sp-section-header"><h3>' +
      ParlaSupportUI.escapeHtml(t.ticket_number) + " — " + ParlaSupportUI.escapeHtml(t.title) +
      "</h3>" + ParlaSupportUI.statusBadge(t.status) + "</div>" +
      '<div class="sp-section-body"><div class="sp-ticket-meta">' +
      metaItem("Öncelik", '<span class="' + ParlaSupportUI.priorityClass(t.priority) + '">' + ParlaSupportUI.escapeHtml(t.priority) + "</span>") +
      metaItem("SAP Modülü", ParlaSupportUI.escapeHtml(t.sap_module)) +
      metaItem("Oluşturulma", ParlaSupportUI.formatDate(t.created_at)) +
      metaItem("Güncelleme", ParlaSupportUI.formatDate(t.updated_at)) +
      (customer ? metaItem("Müşteri", ParlaSupportUI.escapeHtml(customer.first_name + " " + customer.last_name)) +
        metaItem("Firma", ParlaSupportUI.escapeHtml(customer.company)) +
        metaItem("E-posta", ParlaSupportUI.escapeHtml(customer.email)) : "") +
      (t.attachment_url ? metaItem("Ek", '<a href="' + ParlaSupportUI.escapeHtml(t.attachment_url) + '" target="_blank" rel="noopener">Dosya</a>') : "") +
      "</div><p><strong>Açıklama:</strong><br>" + ParlaSupportUI.escapeHtml(t.description).replace(/\n/g, "<br>") + "</p></div></div>" +
      adminPanel +
      '<div class="sp-section sp-mt-1"><div class="sp-section-header"><h3>Mesajlar</h3></div><div class="sp-section-body">' +
      (timeline ? '<ul class="sp-timeline">' + timeline + "</ul>" : '<p class="sp-empty">Henüz mesaj yok</p>') +
      '<div class="sp-reply-box"><div class="sp-form-group"><label>Yanıt</label><textarea id="sp-reply-message" rows="4"></textarea></div>' +
      (isAdmin ? '<label style="display:block;margin:0.5rem 0"><input type="checkbox" id="sp-reply-internal"> Dahili not</label>' : "") +
      '<button type="button" class="sp-btn sp-btn-primary sp-btn-sm" id="sp-send-reply">Gönder</button></div></div></div>';

    

    document.getElementById("sp-send-reply").addEventListener("click", sendReply);
    if (isAdmin) document.getElementById("sp-admin-save").addEventListener("click", saveAdmin);
  }

  function sendReply() {
    var msg = document.getElementById("sp-reply-message").value.trim();
    if (!msg) { ParlaSupportUI.toast("Mesaj boş olamaz.", "error"); return; }
    var isInternal = false;
    var el = document.getElementById("sp-reply-internal");
    if (el) isInternal = el.checked;
    ParlaSupportUI.showLoading(true);
    ParlaSupportApi.addMessage(ParlaSupportAuth.getToken(), ticketId, msg, isInternal)
      .then(function (res) {
        if (!res.success) { ParlaSupportUI.toast(res.message, "error"); return; }
        ParlaSupportUI.toast("Mesaj gönderildi.", "success");
        document.getElementById("sp-reply-message").value = "";
        loadTicket();
      })
      .finally(function () { ParlaSupportUI.showLoading(false); });
  }

  function saveAdmin() {
    ParlaSupportUI.showLoading(true);
    ParlaSupportApi.updateTicket(ParlaSupportAuth.getToken(), {
      ticket_id: ticketId,
      status: document.getElementById("sp-admin-status").value,
      assigned_to: document.getElementById("sp-admin-assign").value.trim(),
      admin_note: document.getElementById("sp-admin-note").value.trim() || undefined
    })
      .then(function (res) {
        if (!res.success) { ParlaSupportUI.toast(res.message, "error"); return; }
        ParlaSupportUI.toast("Güncellendi.", "success");
        document.getElementById("sp-admin-note").value = "";
        loadTicket();
      })
      .finally(function () { ParlaSupportUI.showLoading(false); });
  }
});
