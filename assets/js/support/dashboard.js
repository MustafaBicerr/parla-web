/**
 * SAP Destek — müşteri paneli
 */
document.addEventListener("DOMContentLoaded", function () {
  var headerEl = document.getElementById("sp-header");
  var contentEl = document.getElementById("sp-dashboard-content");
  var modal = document.getElementById("sp-create-ticket-modal");
  var createForm = document.getElementById("sp-create-ticket-form");
  var allTickets = [];

  ParlaSupportAuth.requireAuth("customer")
    .then(function (user) {
      headerEl.innerHTML = ParlaSupportUI.renderPortalHeader(user, { showDashboard: false });
      ParlaSupportUI.bindLogout();
      loadTickets();
      bindCreateTicket();
    })
    .catch(function () {});

  function loadTickets() {
    ParlaSupportUI.showLoading(true);
    ParlaSupportApi.getTickets(ParlaSupportAuth.getToken())
      .then(function (res) {
        if (!res.success) {
          ParlaSupportUI.toast(res.message, "error");
          return;
        }
        allTickets = res.data.tickets || [];
        renderDashboard();
      })
      .finally(function () {
        ParlaSupportUI.showLoading(false);
      });
  }

  function countByFilter(fn) {
    return allTickets.filter(fn).length;
  }

  function statCard(label, value, extraClass) {
    return (
      '<div class="sp-stat-card ' +
      (extraClass || "") +
      '"><div class="sp-stat-value">' +
      value +
      '</div><div class="sp-stat-label">' +
      label +
      "</div></div>"
    );
  }

  function renderDashboard() {
    var active = countByFilter(function (t) {
      var s = String(t.status).toUpperCase();
      return s === "OPEN" || s === "IN PROGRESS" || s === "WAITING CUSTOMER";
    });
    var resolved = countByFilter(function (t) {
      var s = String(t.status).toUpperCase();
      return s === "RESOLVED" || s === "CLOSED";
    });
    var waiting = countByFilter(function (t) {
      return String(t.status).toUpperCase() === "WAITING CUSTOMER";
    });
    var recent = allTickets.slice(0, 5);

    var html =
      '<div class="sp-stats-grid">' +
      statCard("Aktif Talepler", active, "") +
      statCard("Çözülmüş", resolved, "resolved") +
      statCard("Bekleyen", waiting, "") +
      statCard("Toplam", allTickets.length, "") +
      "</div>" +
      '<div class="sp-section">' +
      '<div class="sp-section-header">' +
      "<h3>Destek Taleplerim</h3>" +
      '<button type="button" class="sp-btn sp-btn-primary sp-btn-sm" id="sp-open-create-modal" style="width:auto"><i class="fas fa-plus"></i> Yeni Talep</button>' +
      "</div>" +
      '<div class="sp-section-body">' +
      renderTicketTable(allTickets) +
      "</div></div>";

    if (recent.length) {
      html +=
        '<div class="sp-section"><div class="sp-section-header"><h3>Son Aktiviteler</h3></div>' +
        '<div class="sp-section-body"><ul class="sp-timeline">' +
        recent
          .map(function (t) {
            return (
              '<li class="sp-timeline-item"><span class="sp-timeline-dot"></span>' +
              '<div class="sp-timeline-bubble"><div class="sp-timeline-head">' +
              "<span>" +
              ParlaSupportUI.escapeHtml(t.ticket_number) +
              " — " +
              ParlaSupportUI.escapeHtml(t.title) +
              "</span>" +
              '<span class="sp-timeline-time">' +
              ParlaSupportUI.formatDate(t.updated_at) +
              "</span></div>" +
              ParlaSupportUI.statusBadge(t.status) +
              "</div></li>"
            );
          })
          .join("") +
        "</ul></div></div>";
    }

    contentEl.innerHTML = html;

    var openBtn = document.getElementById("sp-open-create-modal");
    if (openBtn) openBtn.addEventListener("click", openModal);
  }

  function renderTicketTable(tickets) {
    if (!tickets.length) {
      return (
        '<div class="sp-empty"><i class="fas fa-ticket-alt"></i>' +
        "<h4>Henüz destek talebiniz yok</h4>" +
        "<p>İlk talebinizi oluşturmak için yukarıdaki butonu kullanın.</p></div>"
      );
    }
    var rows = tickets
      .map(function (t) {
        return (
          "<tr>" +
          '<td><a href="/support-v2/customer/ticket-detail.html?id=' +
          encodeURIComponent(t.ticket_id) +
          '">' +
          ParlaSupportUI.escapeHtml(t.ticket_number) +
          "</a></td>" +
          "<td>" +
          ParlaSupportUI.escapeHtml(t.title) +
          "</td>" +
          '<td class="' +
          ParlaSupportUI.priorityClass(t.priority) +
          '">' +
          ParlaSupportUI.escapeHtml(t.priority) +
          "</td>" +
          "<td>" +
          ParlaSupportUI.escapeHtml(t.sap_module) +
          "</td>" +
          "<td>" +
          ParlaSupportUI.statusBadge(t.status) +
          "</td>" +
          "<td>" +
          ParlaSupportUI.formatDate(t.updated_at) +
          "</td></tr>"
        );
      })
      .join("");

    return (
      '<div class="sp-table-wrap"><table class="sp-table"><thead><tr>' +
      "<th>Ticket No</th><th>Başlık</th><th>Öncelik</th><th>Modül</th><th>Durum</th><th>Güncelleme</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>"
    );
  }

  function openModal() {
    modal.classList.add("is-open");
    createForm.reset();
  }

  function closeModal() {
    modal.classList.remove("is-open");
  }

  function bindCreateTicket() {
    document.getElementById("sp-modal-close").addEventListener("click", closeModal);
    document.getElementById("sp-modal-cancel").addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });

    createForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var title = document.getElementById("sp-ticket-title").value.trim();
      var priority = document.getElementById("sp-ticket-priority").value;
      var sapModule = document.getElementById("sp-ticket-module").value;
      var description = document.getElementById("sp-ticket-description").value.trim();
      var fileInput = document.getElementById("sp-ticket-file");

      if (title.length < 3 || description.length < 10) {
        ParlaSupportUI.toast("Başlık ve açıklama alanlarını kontrol edin.", "error");
        return;
      }

      var payload = {
        title: title,
        priority: priority,
        sap_module: sapModule,
        description: description
      };

      var submitBtn = createForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      ParlaSupportUI.showLoading(true);

      function sendWithFile(filePayload) {
        if (filePayload) payload.file = filePayload;
        ParlaSupportApi.createTicket(ParlaSupportAuth.getToken(), payload)
          .then(function (res) {
            if (!res.success) {
              ParlaSupportUI.toast(res.message, "error");
              return;
            }
            ParlaSupportUI.toast("Talep oluşturuldu: " + res.data.ticket_number, "success");
            closeModal();
            loadTickets();
          })
          .finally(function () {
            submitBtn.disabled = false;
            ParlaSupportUI.showLoading(false);
          });
      }

      if (fileInput.files && fileInput.files[0]) {
        var file = fileInput.files[0];
        if (file.size > 5 * 1024 * 1024) {
          ParlaSupportUI.toast("Dosya en fazla 5 MB olabilir.", "error");
          submitBtn.disabled = false;
          ParlaSupportUI.showLoading(false);
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          sendWithFile({
            name: file.name,
            type: file.type,
            data: reader.result.split(",")[1]
          });
        };
        reader.readAsDataURL(file);
      } else {
        sendWithFile(null);
      }
    });
  }
});
