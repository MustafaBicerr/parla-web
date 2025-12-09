// Header/component loader and UI interactions

async function loadComponent(id, file) {
    try {
        const response = await fetch(file);
        const container = document.getElementById(id);
        container.innerHTML = await response.text();

        // If we just injected the header, wire up header-specific events
        if (id === 'header-placeholder') {
            initHeaderEvents();
            initHeaderScroll(); // Add scroll handling after header loads
        }

        // If this is a hero placeholder and the page provided a data-hero-key, apply it to the injected hero title
        try {
            if (container && container.dataset && container.dataset.heroKey) {
                const key = container.dataset.heroKey;
                const titleEl = container.querySelector('.hero-title');
                if (titleEl) titleEl.setAttribute('data-i18n', key);
                // Re-apply translations for the newly injected component using the current language
                if (window.__i18n && typeof window.__i18n.setLanguage === 'function') {
                    const lang = localStorage.getItem('site_lang') || document.documentElement.getAttribute('lang') || 'tr';
                    window.__i18n.setLanguage(lang);
                }
            }
        } catch (err) { /* ignore */ }
    } catch (error) { console.error("Component Yükleme Hatası:", error); }
}

function initHeaderEvents() {
    const hamburger = document.getElementById('hamburger-btn');
    const navMenu = document.getElementById('nav-menu');
    const langToggles = document.querySelectorAll('.lang-toggle');

    const body = document.querySelector('body');
    
    // 1. Hamburger Menü
    if(hamburger) {
        hamburger.addEventListener('click', (e) => {
            e.stopPropagation();
            navMenu.classList.toggle('active');
            hamburger.innerHTML = navMenu.classList.contains('active') ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
            body.classList.toggle('menu-open'); // Menü açıkken sayfa kaydırması engellenir
        });
    }

    // 2. Dışarı Tıklayınca Kapat
    document.addEventListener('click', (e) => {
        if (navMenu && navMenu.classList.contains('active') && !navMenu.contains(e.target) && !hamburger.contains(e.target)) {
            navMenu.classList.remove('active');
            hamburger.innerHTML = '<i class="fas fa-bars"></i>';
            body.classList.remove('menu-open'); // Sayfa kaydırması tekrar aktif olur
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
                // Update all toggles to reflect the new state
                langToggles.forEach(b => {
                    b.setAttribute('data-current-lang', next);
                    b.innerText = (next === 'tr') ? 'TR | EN' : 'EN | TR';
                });
            } else {
                // fallback: if i18n fails, set storage and reload
                localStorage.setItem('site_lang', next);
                document.documentElement.setAttribute('lang', next);
                location.reload();
            }
        });
    });

}

// Handle header scroll effect
function initHeaderScroll() {



    const header = document.querySelector('header');
    if (!header) return;
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });
}

// Hero Carousel - Auto-rotate images every 2 seconds
function initCarousel() {
    // Initialize background carousel (hero section)
    const bgSlides = document.querySelectorAll('.hero-bg-carousel .carousel-slide');
    if (bgSlides.length > 0) {
        let bgIndex = 0;
        function showBgSlide(index) {
            bgSlides.forEach((slide, i) => {
                slide.classList.remove('carousel-active');
                if (i === index) slide.classList.add('carousel-active');
            });
        }
        function nextBgSlide() {
            bgIndex = (bgIndex + 1) % bgSlides.length;
            showBgSlide(bgIndex);
        }
        setInterval(nextBgSlide, 4000);
    }
    
    // Initialize regular carousel (if any)
    const slides = document.querySelectorAll('.hero-carousel:not(.hero-bg-carousel) .carousel-slide');
    if (slides.length > 0) {
        let currentIndex = 0;
        function showSlide(index) {
            slides.forEach((slide, i) => {
                slide.classList.remove('carousel-active');
                if (i === index) slide.classList.add('carousel-active');
            });
        }
        function nextSlide() {
            currentIndex = (currentIndex + 1) % slides.length;
            showSlide(currentIndex);
        }
        setInterval(nextSlide, 2000);
    }
}

function initCareerForm() {
    const dropArea = document.querySelector('.file-drop-area');
    if (!dropArea) return; // Sadece kariyer sayfasında çalışmasını sağlar

    const fileInput = dropArea.querySelector('.file-input');
    const fileInfoDiv = document.querySelector('.file-info');

    // Sürükle-bırak için varsayılan davranışları engelle
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });

    // Dosya sürüklendiğinde görsel geri bildirim için sınıf ekle
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('dragover'), false);
    });

    // Sürükleme alanı dışına çıkıldığında sınıfı kaldır
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('dragover'), false);
    });

    // Bırakılan dosyaları işle
    dropArea.addEventListener('drop', (e) => {
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true })); // Arayüzü güncellemek için 'change' olayını tetikle
    }, false);

    // Dosya seçildiğinde arayüzü güncelle
    fileInput.addEventListener('change', function() {
        if (this.files && this.files.length > 0) {
            fileInfoDiv.innerHTML = `<span>${this.files[0].name}</span> <i class="fas fa-times remove-file-btn" title="Dosyayı kaldır"></i>`;
            fileInfoDiv.style.display = 'flex';
            dropArea.style.display = 'none';

            fileInfoDiv.querySelector('.remove-file-btn').addEventListener('click', () => {
                fileInput.value = ''; // Dosya seçimini temizle
                fileInfoDiv.style.display = 'none';
                dropArea.style.display = 'flex';
            });
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Use root-relative paths so components load correctly from pages in subfolders
    loadComponent('header-placeholder', '/components/header.html');
    loadComponent('footer-placeholder', '/components/footer.html');

    // If a hero placeholder exists on this page, load the shared hero component
    if (document.getElementById('hero-placeholder')) {
        // preserve any data-hero-key attribute on the placeholder element before injection
        loadComponent('hero-placeholder', '/components/hero.html');
    }

    // Initialize carousel
    initCarousel();

    // Initialize career form interactions if the form exists on the page
    initCareerForm();
});