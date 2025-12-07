// Header/component loader and UI interactions

async function loadComponent(id, file) {
    try {
        const response = await fetch(file);
        document.getElementById(id).innerHTML = await response.text();
        if (id === 'header-placeholder') initHeaderEvents();
    } catch (error) { console.error("Component Yükleme Hatası:", error); }
}

function initHeaderEvents() {
    const hamburger = document.getElementById('hamburger-btn');
    const navMenu = document.getElementById('nav-menu');
    const langToggles = document.querySelectorAll('.lang-toggle');
    
    // 1. Hamburger Menü
    if(hamburger) {
        hamburger.addEventListener('click', (e) => {
            e.stopPropagation();
            navMenu.classList.toggle('active');
            hamburger.innerHTML = navMenu.classList.contains('active') ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
        });
    }

    // 2. Dışarı Tıklayınca Kapat
    document.addEventListener('click', (e) => {
        if (navMenu && navMenu.classList.contains('active') && !navMenu.contains(e.target) && !hamburger.contains(e.target)) {
            navMenu.classList.remove('active');
            hamburger.innerHTML = '<i class="fas fa-bars"></i>';
        }
    });

    // 3. Mobil Dropdown (Accordion)
    const dropdowns = document.querySelectorAll('.dropdown');
    dropdowns.forEach(drop => {
        const link = drop.querySelector('.nav-link');
        link.addEventListener('click', (e) => {
            if (window.innerWidth <= 1100) {
                e.preventDefault();
                dropdowns.forEach(d => { if(d !== drop) d.classList.remove('active'); });
                drop.classList.toggle('active');
            }
        });
    });

    // 4. Dil Toggle Button(s) -> use i18n API if available
    langToggles.forEach(btn => {
        btn.addEventListener('click', function () {
            // determine current language (prefer data-current-lang then localStorage then html[lang])
            const stored = localStorage.getItem('site_lang');
            const htmlLang = document.documentElement.getAttribute('lang');
            const current = this.getAttribute('data-current-lang') || stored || htmlLang || 'tr';
            const next = (current === 'tr') ? 'en' : 'tr';
            // delegate to i18n loader if available
            if (window.__i18n && typeof window.__i18n.setLanguage === 'function') {
                window.__i18n.setLanguage(next);
            } else {
                // fallback: swap button text
                this.innerText = (next === 'tr') ? 'TR | EN' : 'EN | TR';
                localStorage.setItem('site_lang', next);
                document.documentElement.setAttribute('lang', next);
                location.reload();
            }
        });
    });

    // After header injection, re-apply i18n in case translations were loaded earlier
    try {
        const stored = localStorage.getItem('site_lang');
        const htmlLang = document.documentElement.getAttribute('lang');
        const start = stored || htmlLang || 'tr';
        if (window.__i18n && typeof window.__i18n.setLanguage === 'function') {
            window.__i18n.setLanguage(start);
        }
    } catch (e) { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', () => {
    loadComponent('header-placeholder', 'components/header.html');
    loadComponent('footer-placeholder', 'components/footer.html');
});