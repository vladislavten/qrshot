document.addEventListener('DOMContentLoaded', () => {
    // Intersection Observer для анимации появления секций
    const observerOptions = {
        threshold: 0.2,
        rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);

    // Наблюдаем за всеми секциями шагов
    const stepSections = document.querySelectorAll('.step-section');
    stepSections.forEach(section => {
        observer.observe(section);
    });

    // Анимация Live Wall
    const livewallPhotos = document.querySelectorAll('.livewall-photo');
    if (livewallPhotos.length > 0) {
        let currentPhoto = 0;
        
        setInterval(() => {
            livewallPhotos[currentPhoto].classList.remove('active');
            currentPhoto = (currentPhoto + 1) % livewallPhotos.length;
            livewallPhotos[currentPhoto].classList.add('active');
        }, 3000);
    }

    // Плавная прокрутка для навигации
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Прокрутка по секциям при скролле колесом мыши
    let isScrolling = false;
    // Включаем все секции: hero, step-sections, benefits, cta, footer
    const allSections = document.querySelectorAll('.hero-section, .step-section, .benefits-section, .cta-section, .presentation-footer');
    
    function findCurrentSection() {
        const scrollPosition = window.scrollY + window.innerHeight / 3;
        
        for (let i = 0; i < allSections.length; i++) {
            const section = allSections[i];
            const sectionTop = section.offsetTop;
            const sectionBottom = sectionTop + section.offsetHeight;
            
            if (scrollPosition >= sectionTop && scrollPosition <= sectionBottom) {
                return i;
            }
        }
        return 0;
    }
    
    
    function scrollToSection(index, direction) {
        if (isScrolling) return;
        
        const targetIndex = direction === 'down' 
            ? Math.min(index + 1, allSections.length - 1)
            : Math.max(index - 1, 0);
        
        if (targetIndex === index) return;
        
        isScrolling = true;
        allSections[targetIndex].scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
        
        setTimeout(() => {
            isScrolling = false;
        }, 800);
    }
    
    let lastScrollTime = 0;
    const scrollDelay = 600; // Минимальная задержка между прокрутками (мс)
    
    window.addEventListener('wheel', (e) => {
        if (isScrolling) {
            e.preventDefault();
            return;
        }
        
        const currentTime = Date.now();
        if (currentTime - lastScrollTime < scrollDelay) {
            e.preventDefault();
            return;
        }
        
        const direction = e.deltaY > 0 ? 'down' : 'up';
        const currentSectionIndex = findCurrentSection();
        
        e.preventDefault();
        lastScrollTime = currentTime;
        scrollToSection(currentSectionIndex, direction);
    }, { passive: false });
});

