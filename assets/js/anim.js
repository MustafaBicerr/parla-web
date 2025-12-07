document.addEventListener('DOMContentLoaded', () => {
    
    const observerOptions = {
        root: null,
        threshold: 0.15, // Biraz daha içeride tetiklensin
        rootMargin: "0px"
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const element = entry.target;
            
            // Animasyonu devre dışı bırakma kontrolü
            if (element.getAttribute('data-animate') === 'false') {
                element.style.opacity = 1;
                element.style.transform = 'none';
                return;
            }

            if (entry.isIntersecting) {
                element.classList.add('visible');
            } else {
                // Tekrar tekrar çalışması için sınıfı kaldır
                element.classList.remove('visible'); 
            }
        });
    }, observerOptions);

    // Dinamik yüklenen elementleri kontrol et
    setInterval(() => {
        const elements = document.querySelectorAll('.anim-block:not(.observed)');
        if (elements.length > 0) {
            elements.forEach(el => {
                observer.observe(el);
                el.classList.add('observed');
            });
        }
    }, 500);
});