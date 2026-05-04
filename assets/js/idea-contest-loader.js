(function () {
    var ph = document.getElementById('idea-contest-placeholder');
    if (!ph) return;
    fetch('/components/idea-contest-section.html')
        .then(function (r) { return r.text(); })
        .then(function (html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            var section = doc.querySelector('section#idea-contest');
            if (section && ph.parentNode) {
                ph.replaceWith(section);
                if (window.__i18n && typeof window.__i18n.refreshTranslations === 'function') {
                    window.__i18n.refreshTranslations();
                }
            }
        })
        .catch(function (err) { console.error('Idea contest section load error:', err); });
})();
