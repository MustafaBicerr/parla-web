/**
 * SAP Destek — ticket detay sayfası (v2'ye yönlendir)
 */
(function () {
  var params = new URLSearchParams(window.location.search);
  var ticketId = params.get("id");
  var target = ticketId
    ? "/support-v2/customer/ticket-detail.html?id=" + encodeURIComponent(ticketId)
    : "/support-v2/login.html";
  window.location.replace(target);
})();
