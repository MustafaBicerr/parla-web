/**
 * Parla BT Hero Section 3D Carousel
 * Handles the infinite loop, auto-play, and 3D positioning of cards.
 */

(function() {
    const carouselData = [
        {
            titleKey: 'home.hero.carousel.0.title',
            imageAltKey: 'home.hero.carousel.0.imageAlt',
            image: '/assets/img/sap/sap-1.png',
            link: '/pages/organisation/sap-implementation.html',
            placeholder: false
        },
        {
            titleKey: 'home.hero.carousel.1.title',
            imageAltKey: 'home.hero.carousel.1.imageAlt',
            image: '/assets/img/sap/sap-7.png',
            link: '/pages/solutions/s4hana-transformation.html',
            placeholder: false
        },
        {
            titleKey: 'home.hero.carousel.2.title',
            imageAltKey: 'home.hero.carousel.2.imageAlt',
            image: '/assets/img/sap/sap-10.png',
            link: '/pages/solutions/sap-extra-modules.html',
            placeholder: false
        },
        {
            titleKey: 'home.hero.carousel.3.title',
            imageAltKey: 'home.hero.carousel.3.imageAlt',
            image: '/assets/img/sap/sap-4.png',
            link: '/pages/solutions/sap-support-continuity.html',
            placeholder: false
        },
        {
            titleKey: 'home.hero.carousel.4.title',
            imageAltKey: 'home.hero.carousel.4.imageAlt',
            image: '/assets/img/sap/sap-13.png',
            link: '/pages/solutions/unfinished-projects.html',
            placeholder: false
        },
        {
            titleKey: 'home.hero.carousel.5.title',
            imageAltKey: 'home.hero.carousel.5.imageAlt',
            image: '/assets/img/sap/sap-11.png',
            link: '#',
            placeholder: true
        },
        {
            titleKey: 'home.hero.carousel.6.title',
            imageAltKey: 'home.hero.carousel.6.imageAlt',
            image: '/assets/img/sap/sap-12.png',
            link: '#',
            placeholder: true
        },
        {
            titleKey: 'home.hero.carousel.7.title',
            imageAltKey: 'home.hero.carousel.7.imageAlt',
            image: '/assets/img/sap/sap-9.png',
            link: '#',
            placeholder: true
        },
        {
            titleKey: 'home.hero.carousel.8.title',
            imageAltKey: 'home.hero.carousel.8.imageAlt',
            image: '/assets/img/sap/sap-8.png',
            link: '#',
            placeholder: true
        }
    ];

    let currentIndex = 0;
    let autoPlayInterval;
    const AUTO_PLAY_DELAY = 3000;

    function getByPath(path, obj) {
        if (!path || !obj) return null;
        return path.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : null, obj);
    }

    function applyCarouselAccessibility() {
        const container = document.getElementById('hero-3d-carousel');
        if (!container || !window.__i18n || !window.__i18n.t) return;
        const t = window.__i18n.t;
        container.querySelectorAll('.carousel-card').forEach((card, index) => {
            const item = carouselData[index];
            if (!item) return;
            const img = card.querySelector('img');
            if (img && item.imageAltKey) {
                const alt = getByPath(item.imageAltKey, t);
                if (alt) img.setAttribute('alt', alt);
            }
        });
    }

    function initCarousel() {
        const container = document.getElementById('hero-3d-carousel');
        const prevBtn = document.getElementById('hero-prev');
        const nextBtn = document.getElementById('hero-next');

        if (!container) return;
        if (container.dataset.carouselInited === '1') return;
        container.dataset.carouselInited = '1';

        container.innerHTML = carouselData.map((item, index) => `
            <a href="${item.placeholder ? '#' : item.link}" class="carousel-card${item.placeholder ? ' carousel-card-placeholder' : ''}" data-index="${index}">
                <img src="${item.image}" alt="">
                <h3 data-i18n="${item.titleKey}">Loading...</h3>
            </a>
        `).join('');

        container.querySelectorAll('.carousel-card').forEach((card, index) => {
            const item = carouselData[index];
            if (item && item.placeholder) {
                card.addEventListener('click', (e) => e.preventDefault());
                card.setAttribute('aria-disabled', 'true');
            }
        });

        updateCarousel();

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                movePrev();
                resetAutoPlay();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                moveNext();
                resetAutoPlay();
            });
        }

        startAutoPlay();

        if (window.__i18n && typeof window.__i18n.setLanguage === 'function') {
            const currentLang = localStorage.getItem('site_lang') || 'tr';
            window.__i18n.setLanguage(currentLang);
        }
        applyCarouselAccessibility();
    }

    function updateCarousel() {
        const cards = document.querySelectorAll('.carousel-card');
        const total = cards.length;

        cards.forEach((card, index) => {
            card.className = 'carousel-card';
            if (carouselData[index] && carouselData[index].placeholder) {
                card.classList.add('carousel-card-placeholder');
            }

            if (index === currentIndex) {
                card.classList.add('center');
            } else if (index === (currentIndex - 1 + total) % total) {
                card.classList.add('left');
            } else if (index === (currentIndex + 1) % total) {
                card.classList.add('right');
            } else {
                card.classList.add('hidden');
            }
        });
    }

    function moveNext() {
        currentIndex = (currentIndex + 1) % carouselData.length;
        updateCarousel();
    }

    function movePrev() {
        currentIndex = (currentIndex - 1 + carouselData.length) % carouselData.length;
        updateCarousel();
    }

    function startAutoPlay() {
        autoPlayInterval = setInterval(moveNext, AUTO_PLAY_DELAY);
    }

    function resetAutoPlay() {
        clearInterval(autoPlayInterval);
        startAutoPlay();
    }

    document.addEventListener('parla-i18n-applied', () => {
        applyCarouselAccessibility();
    });

    const observer = new MutationObserver((mutations) => {
        if (document.getElementById('hero-3d-carousel')) {
            initCarousel();
            observer.disconnect();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.getElementById('hero-3d-carousel')) initCarousel();
        });
    } else {
        if (document.getElementById('hero-3d-carousel')) initCarousel();
    }
})();
