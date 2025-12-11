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

function initSolutionModal() {
    // Check if modal already exists to prevent duplicates
    if (document.getElementById('solutionModalOverlay')) return;

    const modalHTML = `
        <div class="solution-modal-overlay" id="solutionModalOverlay">
            <div class="solution-modal" id="solutionModal">
                <div class="solution-modal-header">
                    <h3 id="solutionModalTitle"></h3>
                    <button class="solution-modal-close-btn" id="solutionModalCloseBtn" title="Kapat">&times;</button>
                </div>
                <div class="solution-modal-content">
                    <p id="solutionModalContent"></p>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const overlay = document.getElementById('solutionModalOverlay');
    const closeBtn = document.getElementById('solutionModalCloseBtn');

    const closeModal = () => {
        overlay.classList.remove('visible');
    };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        // Only close if the overlay itself is clicked, not the modal content
        if (e.target === overlay) {
            closeModal();
        }
    });
}

function openSolutionModal(jsonKey) {
    const overlay = document.getElementById('solutionModalOverlay');
    if (!overlay || !window.__i18n) return;

    const translations = window.__i18n.t;
    const getKey = (path, obj) => path.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : null, obj);
    const data = getKey(jsonKey, translations);

    if (data && data.title && data.desc) {
        document.getElementById('solutionModalTitle').innerText = data.title;
        document.getElementById('solutionModalContent').innerText = data.desc;
        overlay.classList.add('visible');
    } else {
        console.error(`Modal content not found for key: ${jsonKey}`);
    }
}
// Expose the function to the global scope to be callable from HTML onclick
window.openSolutionModal = openSolutionModal;



// İletişim ve Kariyer Formları için ortak Google Apps Script URL'si
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxe2v7-LXZBon0Hi36K96DXo0MOrNZ6MDRZ5Jv5t-6aCrKNcvUtF-OyPDvnGp0HhsI/exec";

function initCareerForm() {
    const dropArea = document.querySelector('.file-drop-area');
    if (!dropArea) return;

    const fileInput = dropArea.querySelector('.file-input');
    const fileInfoDiv = document.querySelector('.file-info');

    // Sürükle-bırak olayları (Aynı kalıyor)
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.add('dragover'), false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => dropArea.classList.remove('dragover'), false);
    });
    dropArea.addEventListener('drop', (e) => {
        fileInput.files = e.dataTransfer.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }, false);

    fileInput.addEventListener('change', function() {
        if (this.files && this.files.length > 0) {
            fileInfoDiv.innerHTML = `<span>${this.files[0].name}</span> <i class="fas fa-times remove-file-btn" title="Dosyayı kaldır"></i>`;
            fileInfoDiv.style.display = 'flex';
            dropArea.style.display = 'none';
            fileInfoDiv.querySelector('.remove-file-btn').addEventListener('click', () => {
                fileInput.value = '';
                fileInfoDiv.style.display = 'none';
                dropArea.style.display = 'flex';
            });s
        }
    });

    const form = document.getElementById('career-application-form');
    if (!form) return;

    form.addEventListener('submit', function(event) {
        event.preventDefault();

        // --- HATA AYIKLAMA İÇİN KONTROL ---
        // Eğer bu ID'ler HTML'de yoksa kod burada patlar ve istek gitmez.
        const elFirstName = document.getElementById('firstName');
        const elLastName = document.getElementById('lastName');
        
        if (!elFirstName || !elLastName) {
            console.error("HATA: HTML ID'leri bulunamadı. Lütfen input ID'lerinin 'firstName' ve 'lastName' olduğundan emin olun.");
            alert("Teknik bir hata oluştu (HTML ID Uyuşmazlığı). Lütfen console'u kontrol edin.");
            return;
        }
        // ----------------------------------

        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerText;

        // Form verilerini al
        const payload = {
            type: 'career', // <--- KRİTİK EKLEME: Backend'in bunu tanıması için şart!
            first_name: elFirstName.value,
            last_name: elLastName.value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
            city: document.getElementById('address').value, // HTML'deki ID'nin 'address' olduğundan emin ol
            experience: document.getElementById('experience').value,
            motivation: document.getElementById('motivation').value,
        };

        const file = fileInput.files.length > 0 ? fileInput.files[0] : null;

        if (!file) {
            alert('Lütfen başvurunuza CV veya portfolyo dosyanızı ekleyin.');
            return;
        }

        submitButton.disabled = true;
        submitButton.innerText = 'Gönderiliyor...';

        const reader = new FileReader();
        reader.readAsDataURL(file);

        reader.onload = function() {
            const base64File = reader.result.split(',')[1];

            payload.file = {
                name: file.name,
                type: file.type,
                data: base64File
            };

            
            // mode: 'no-cors' KALDIRILDI. Hata varsa görelim.
            fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(payload)
            })
            .then(res => {
                // Google Redirect döneceği için 'res.ok' her zaman true olmayabilir ama hata fırlatmazsa işlem başarılıdır.
                alert('Başvurunuz başarıyla gönderildi. İlginiz için teşekkür ederiz!');
                form.reset();
                fileInfoDiv.style.display = 'none';
                dropArea.style.display = 'flex';
            })
            .catch(error => {
                console.error('Form Gönderme Hatası:', error);
                alert('Başvurunuz gönderilirken bir hata oluştu. Lütfen Console (F12) ekranını kontrol edin.');
            })
            .finally(() => {
                submitButton.disabled = false;
                submitButton.innerText = originalButtonText;
            });
        };

        reader.onerror = function() {
            alert('Dosyanız okunurken bir hata oluştu.');
            submitButton.disabled = false;
            submitButton.innerText = originalButtonText;
        };
    });
}

function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', function(event) {
        event.preventDefault();

        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerText;

        const payload = {
            type: 'contact', // Backend'in formu tanıması için
            name: document.getElementById('contact-name').value,
            email: document.getElementById('contact-email').value,
            phone: document.getElementById('contact-phone').value,
            subject: document.getElementById('contact-subject').value,
            message: document.getElementById('contact-message').value,
        };

        submitButton.disabled = true;
        submitButton.innerText = 'Gönderiliyor...';

        

        fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        })
        .then(res => {
            alert('Mesajınız başarıyla gönderildi. Teşekkür ederiz!');
            form.reset();
        })
        .catch(error => {
            console.error('İletişim Formu Gönderme Hatası:', error);
            alert('Mesajınız gönderilirken bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
        })
        .finally(() => {
            submitButton.disabled = false;
            submitButton.innerText = originalButtonText;
        });
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

    // Create the modal structure on page load
    initSolutionModal();

    // Initialize career form interactions if the form exists on the page
    initCareerForm();

    // Initialize contact form interactions if the form exists on the page
    initContactForm();

    // Initialize the floating action buttons and chatbot widget
    if (typeof initChatWidget === 'function') initChatWidget();
});