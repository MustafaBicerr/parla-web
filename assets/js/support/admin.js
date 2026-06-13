/**
 * SAP Destek — admin paneli
 */
document.addEventListener("DOMContentLoaded", function () {
  var headerEl = document.getElementById("sp-header");
  var statsEl = document.getElementById("sp-admin-stats");
  var tableEl = document.getElementById("sp-admin-tickets");
  var allTickets = [];

  ParlaSupportAuth.requireAuth("admin")
    .then(function (user) {
      headerEl.innerHTML = ParlaSupportUI.renderPortalHeader(user, { showDashboard: false });
      ParlaSupportUI.bindLogout();
      loadData();
      bindFilters();
    })
    .catch(function () {});

  function loadData() {
    ParlaSupportUI.showLoading(true);
    var token = ParlaSupportAuth.getToken();
    Promise.all([
      ParlaSupportApi.adminStats(token),
      ParlaSupportApi.getTickets(token)
    ])
      .then(function (results) {
        var statsRes = results[0];
        var ticketsRes = results[1];
        if (!statsRes.success) ParlaSupportUI.toast(statsRes.message, "error");
        if (!ticketsRes.success) {
          ParlaSupportUI.toast(ticketsRes.message, "error");
          return;
        }
        allTickets = ticketsRes.data.tickets || [];
        renderStats(statsRes.success ? statsRes.data : {});
        renderTable(allTickets);
      })
      .finally(function () {
        ParlaSupportUI.showLoading(false);
      });
  }

  function renderStats(data) {
    statsEl.innerHTML =
      '<div class="sp-stats-grid">' +
      statCard("Toplam Ticket", data.total || 0, "") +
      statCard("Açık / İşlemde", data.open || 0, "") +
      statCard("Kritik", data.critical || 0, "critical") +
      statCard("Çözülmüş", data.resolved || 0, "resolved") +
      "</div>";
  }

  function statCard(label, value, extra) {
    return (
      '<div class="sp-stat-card ' +
      (extra || "") +
      '"><div class="sp-stat-value">' +
      value +
      '</div><div class="sp-stat-label">' +
      label +
      "</div></div>"
    );
  }

  function renderTable(tickets) {
    if (!tickets.length) {
      tableEl.innerHTML =
        '<div class="sp-empty"><i class="fas fa-inbox"></i><h4>Ticket bulunamadı</h4></div>';
      tableEl.innerHTML = tableEl.innerHTML.replace(/div/g, "div");
      return;
    }
    var rows = tickets
      .map(function (t) {
        return (
          "<tr>" +
          '<td><a href="/support-v2/admin/ticket-detail.html?id=' +
          encodeURIComponent(t.ticket_id) +
          '">' +
          ParlaSupportUI.escapeHtml(t.ticket_number) +
          "</a></td>" +
          "<td>" +
          ParlaSupportUI.escapeHtml(t.company || "") +
          "</td>" +
          "<td>" +
          ParlaSupportUI.escapeHtml(t.customer_email || "") +
          "</td>" +
          "<td>" +
          ParlaSupportUI.escapeHtml(t.title) +
          "</td>" +
          '<td class="' +
          ParlaSupportUI.priorityClass(t.priority) +
          '">' +
          ParlaSupportUI.escapeHtml(t.priority) +
          "</td>" +
          "<td>" +
          ParlaSupportUI.statusBadge(t.status) +
          "</td>" +
          "<td>" +
          ParlaSupportUI.escapeHtml(t.assigned_to || "—") +
          "</td>" +
          "<td>" +
          ParlaSupportUI.formatDate(t.updated_at) +
          "</td></tr>"
        );
      })
      .join("");

    tableEl.innerHTML =
      '<div class="sp-table-wrap"><table class="sp-table"><thead><tr>' +
      "<th>Ticket</th><th>Firma</th><th>E-posta</th><th>Başlık</th><th>Öncelik</th><th>Durum</th><th>Atanan</th><th>Güncelleme</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";
  }

  function bindFilters() {
    var statusFilter = document.getElementById("sp-filter-status");
    var priorityFilter = document.getElementById("sp-filter-priority");
    var searchInput = document.getElementById("sp-filter-search");

    function apply() {
      var status = statusFilter.value;
      var priority = priorityFilter.value;
      var q = searchInput.value.trim().toLowerCase();
      var filtered = allTickets.filter(function (t) {
        if (status && String(t.status).toUpperCase() !== status.toUpperCase()) return false;
        if (priority && t.priority !== priority) return false;
        if (q) {
          var hay =
            (t.ticket_number + " " + t.title + " " + t.customer_email + " " + t.company).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
      renderTable(filtered);
    }

    statusFilter.addEventListener("change", apply);
    priorityFilter.addEventListener("change", apply);
    searchInput.addEventListener("input", apply);
  }
});
