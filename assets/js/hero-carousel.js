/**
 * Parla BT Hero Section 3D Carousel
 * Handles the infinite loop, auto-play, and 3D positioning of cards.
 */

(function() {
    // Data Structure
    const carouselData = [
        {
            titleKey: "home.hero.carousel.0.title",
            image: "assets/img/sap/sap-1.png", // Using existing assets as placeholders
            link: "/pages/organisation/sap-implementation.html"
        },
        {
            titleKey: "home.hero.carousel.1.title",
            image: "assets/img/sap/sap-2.png",
            link: "/pages/solutions/e-transformation.html"
        },
        {
            titleKey: "home.hero.carousel.2.title",
            image: "assets/img/sap/sap-3.png",
            link: "/pages/solutions/financial-accounting.html"
        },
        {
            titleKey: "home.hero.carousel.3.title",
            image: "assets/img/sap/sap-4.png",
            link: "/pages/academy/corporate-workshops.html"
        },
        {
            titleKey: "home.hero.carousel.4.title",
            image: "assets/img/sap/sap-5.png",
            link: "/pages/solutions/mobile-automation.html"
        }
    ];

    let currentIndex = 0;
    let autoPlayInterval;
    const AUTO_PLAY_DELAY = 3000;

    function initCarousel() {
        const container = document.getElementById('hero-3d-carousel');
        const prevBtn = document.getElementById('hero-prev');
        const nextBtn = document.getElementById('hero-next');

        if (!container) return;

        // Render Items
        container.innerHTML = carouselData.map((item, index) => `
            <a href="${item.link}" class="carousel-card" data-index="${index}">
                <img src="${item.image}" alt="Icon">
                <h3 data-i18n="${item.titleKey}">Loading...</h3>
            </a>
        `).join('');

        // Initial Update
        updateCarousel();

        // Event Listeners
        prevBtn.addEventListener('click', () => {
            movePrev();
            resetAutoPlay();
        });

        nextBtn.addEventListener('click', () => {
            moveNext();
            resetAutoPlay();
        });

        // Start Auto Play
        startAutoPlay();

        // Trigger translation update if i18n is available
        if (window.__i18n && typeof window.__i18n.setLanguage === 'function') {
             // Re-apply current language to translate new elements
             const currentLang = localStorage.getItem('site_lang') || 'tr';
             window.__i18n.setLanguage(currentLang);
        }
    }

    function updateCarousel() {
        const cards = document.querySelectorAll('.carousel-card');
        const total = cards.length;

        cards.forEach((card, index) => {
            card.className = 'carousel-card'; // Reset classes

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

    // Observer to detect when hero.html is loaded into the DOM
    const observer = new MutationObserver((mutations) => {
        if (document.getElementById('hero-3d-carousel')) {
            initCarousel();
            observer.disconnect();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback in case it's already there
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.getElementById('hero-3d-carousel')) initCarousel();
        });
    } else {
        if (document.getElementById('hero-3d-carousel')) initCarousel();
    }
})();