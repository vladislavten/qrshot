document.addEventListener('DOMContentLoaded', () => {
    const BRAND_CONFIG = window.BRAND || {
        short: 'QR',
        names: {
            ru: 'QR SHOT',
            en: 'QR SHOT',
            kz: 'QR SHOT'
        }
    };

    const translations = {
        ru: {
            brand: BRAND_CONFIG.names.ru || 'QR SHOT',
            navAdmin: 'Админ-панель',
            navCreate: 'Создать событие',
            heroMessages: [
                'Собирайте фотографии и видео с мероприятий легко',
                'Сканируйте QR код и загружайте ваши фотографии',
                'Просматривайте галерею и скачивайте все фотографии одним ZIP-архивом.'
            ],
            heroSubtitle: 'Создавайте QR-коды для мероприятий, позволяйте гостям загружать фотографии, видео и скачивайте всё одним архивом. Без регистрации и приложений.',
            heroPrimary: 'Создать мероприятие',
            heroSecondary: 'Узнать больше',
            stepsTitle: 'Как это работает',
            stepsSubtitle: 'Простой процесс в три шага',
            step1Title: 'Создайте мероприятие',
            step1Text: 'Войдите в админ-панель, создайте мероприятие и получите уникальный QR-код.',
            step2Title: 'Гости загружают фото',
            step2Text: 'Гости сканируют QR-код и загружают фотографии напрямую со смартфонов.',
            step3Title: 'Скачайте все фото',
            step3Text: 'Просматривайте галерею и скачивайте все фотографии одним ZIP-архивом.',
            featuresTitle: 'Преимущества',
            feature1Title: 'Без приложений',
            feature1Text: 'Гости не устанавливают никаких приложений — просто сканируют QR-код.',
            feature2Title: 'Быстрая загрузка фотографий',
            feature2Text: 'Удобная загрузка нескольких фотографий одновременно.',
            feature3Title: 'Автоматическое удаление',
            feature3Text: 'Фотографии автоматически удаляются через 14 дней.',
            feature4Title: 'Галерея с lightbox',
            feature4Text: 'Удобный просмотр фотографий в полноэкранном режиме.',
            feature5Title: 'ZIP архивы',
            feature5Text: 'Скачивайте все фотографии одним архивом.',
            feature6Title: 'Адаптивный дизайн',
            feature6Text: 'Отлично работает на всех устройствах.',
            ctaTitle: 'Готовы начать?',
            ctaSubtitle: 'Создайте своё первое мероприятие прямо сейчас.',
            ctaButton: 'Создать мероприятие',
            footerTagline: 'Делитесь моментами легко и безопасно',
            loginLoading: 'Выполняем вход...',
            loginSuccess: 'Авторизация успешна',
            loginError: 'Ошибка авторизации',
            loginEmpty: 'Введите логин и пароль'
        },
        en: {
            brand: BRAND_CONFIG.names.en || BRAND_CONFIG.names.ru || 'QR SHOT',
            navAdmin: 'Admin panel',
            navCreate: 'Create event',
            heroMessages: [
                'Collect event photos and videos effortlessly',
                'Scan the QR code and upload your pictures',
                'Browse the gallery and download every photo as one ZIP archive.'
            ],
            heroSubtitle: 'Create QR codes for events, let guests upload photos, videos, and download everything in one archive. No registration or apps needed.',
            heroPrimary: 'Create event',
            heroSecondary: 'Learn more',
            stepsTitle: 'How it works',
            stepsSubtitle: 'A simple three-step process',
            step1Title: 'Create an event',
            step1Text: 'Open the admin panel, create an event, and get a unique QR code.',
            step2Title: 'Guests upload photos',
            step2Text: 'Guests scan the QR code and upload their photos right from their phones.',
            step3Title: 'Download all photos',
            step3Text: 'Browse the gallery and download every photo in a single ZIP archive.',
            featuresTitle: 'Benefits',
            feature1Title: 'No apps required',
            feature1Text: 'Guests don’t install anything — they simply scan the QR code.',
            feature2Title: 'Fast photo upload',
            feature2Text: 'Upload multiple photos at once with ease.',
            feature3Title: 'Automatic cleanup',
            feature3Text: 'Photos are removed automatically after 14 days.',
            feature4Title: 'Gallery with lightbox',
            feature4Text: 'Enjoy a convenient full-screen photo viewer.',
            feature5Title: 'ZIP archives',
            feature5Text: 'Download every photo at once in a single archive.',
            feature6Title: 'Responsive design',
            feature6Text: 'Great experience on phones, tablets, and desktops.',
            ctaTitle: 'Ready to start?',
            ctaSubtitle: 'Create your first event right now.',
            ctaButton: 'Create event',
            footerTagline: 'Share moments easily and safely',
            loginLoading: 'Signing in…',
            loginSuccess: 'Login successful',
            loginError: 'Authentication error',
            loginEmpty: 'Enter username and password'
        },
        kz: {
            brand: BRAND_CONFIG.names.kz || BRAND_CONFIG.names.ru || 'QR SHOT',
            navAdmin: 'Әкімшілік панель',
            navCreate: 'Іс-шара құру',
            heroMessages: [
                'Іс-шара фотоларын және видеоларын оңай жинаңыз',
                'QR кодты сканерлеп, фотоларыңызды жүктеңіз',
                'Галереяны қарап, барлық фотоларды бір ZIP архивімен жүктеп алыңыз.'
            ],
            heroSubtitle: 'Іс-шаралар үшін QR-код жасаңыз, қонақтар суреттерін жүктесін, бәрін бір архивпен жүктеп алыңыз. Тіркелусіз және қосымшасыз.',
            heroPrimary: 'Іс-шара құру',
            heroSecondary: 'Толығырақ',
            stepsTitle: 'Бұл қалай жұмыс істейді',
            stepsSubtitle: 'Үш қадамнан тұратын қарапайым процесс',
            step1Title: 'Іс-шара құрыңыз',
            step1Text: 'Әкімшілік панельге кіріп, іс-шара жасап, бірегей QR-код алыңыз.',
            step2Title: 'Қонақтар фото жүктейді',
            step2Text: 'Қонақтар QR-кодты сканерлеп, фотоларын телефоннан жүктейді.',
            step3Title: 'Барлық фотоны жүктеп алыңыз',
            step3Text: 'Галереяны қарап, барлық фотоларды бір ZIP-архивпен алыңыз.',
            featuresTitle: 'Артықшылықтар',
            feature1Title: 'Қосымшаларсыз',
            feature1Text: 'Қонақтар ештеңе орнатпайды — тек QR-кодты сканерлейді.',
            feature2Title: 'Жылдам фото жүктеу',
            feature2Text: 'Бірнеше фотоны бірден ыңғайлы жүктеңіз.',
            feature3Title: 'Автоөшіру',
            feature3Text: 'Фотолар 14 күннен кейін автоматты түрде өшеді.',
            feature4Title: 'Lightbox галереясы',
            feature4Text: 'Толық экранда фотоларды ыңғайлы көру.',
            feature5Title: 'ZIP архивтері',
            feature5Text: 'Барлық фотоларды бір архивпен жүктеп алыңыз.',
            feature6Title: 'Адаптивті дизайн',
            feature6Text: 'Барлық құрылғыларда тамаша жұмыс істейді.',
            ctaTitle: 'Бастауға дайынсыз ба?',
            ctaSubtitle: 'Алғашқы іс-шараңызды дәл қазір жасаңыз.',
            ctaButton: 'Іс-шара құру',
            footerTagline: 'Сәттерді жеңіл және қауіпсіз бөлісіңіз',
            loginLoading: 'Кіру орындалуда...',
            loginSuccess: 'Сәтті кіру',
            loginError: 'Авторизация қатесі',
            loginEmpty: 'Логин мен құпиясөзді енгізіңіз'
        }
    };

    const typewriterTextEl = document.querySelector('[data-typewriter-text]');
    const defaultHeroMessages = translations.ru.heroMessages;
    const typewriter = createTypewriter(typewriterTextEl);

    function updateHeroMessages(messages) {
        const list = Array.isArray(messages) && messages.length ? messages : defaultHeroMessages;
        typewriter.setMessages(list);
    }

    const modal = document.getElementById('landingAuthModal');
    const form = document.getElementById('landingAuthForm');
    const openButtons = document.querySelectorAll('[data-open-auth]');
    const closeBtn = document.querySelector('[data-close-auth]');
    const messageEl = modal?.querySelector('.auth-message');
    const dropdown = document.getElementById('languageDropdown');
    const trigger = dropdown?.querySelector('.language-trigger');
    const currentLangEl = dropdown?.querySelector('[data-current-lang]');
    const menu = dropdown?.querySelector('.language-menu');
    const menuItems = menu ? Array.from(menu.querySelectorAll('[data-lang]')) : [];
    const nav = document.querySelector('.nav');
    const navToggle = document.querySelector('.nav-toggle');

    if (nav && navToggle) {
        const closeMobileNav = () => {
            nav.classList.remove('nav-open');
            navToggle.setAttribute('aria-expanded', 'false');
        };

        navToggle.addEventListener('click', (event) => {
            event.stopPropagation();
            const isOpen = nav.classList.toggle('nav-open');
            navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        document.addEventListener('click', (event) => {
            if (nav.classList.contains('nav-open') && !nav.contains(event.target)) {
                closeMobileNav();
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768 && nav.classList.contains('nav-open')) {
                closeMobileNav();
            }
        });
    }

    if (!modal || !form || !messageEl || !dropdown || !trigger || !menu) {
        return;
    }

    let currentLang = localStorage.getItem('landingLang') || 'ru';

    function createTypewriter(textEl) {
        if (!textEl) {
            return {
                setMessages: () => {},
                stop: () => {}
            };
        }

        const typingDelay = 45;
        const deletingDelay = 18;
        const pauseDelay = 4000;
        const restartDelay = 400;

        let queue = [];
        let messageIndex = 0;
        let charIndex = 0;
        let isDeleting = false;
        let timerId = null;

        function setCursorActive(active) {
            if (!textEl) return;
            if (active) {
                textEl.classList.remove('cursor-inactive');
            } else {
                textEl.classList.add('cursor-inactive');
            }
        }

        function clearTimer() {
            if (timerId) {
                clearTimeout(timerId);
                timerId = null;
            }
        }

        function render(text) {
            textEl.textContent = text;
        }

        function schedule(delay) {
            timerId = setTimeout(tick, delay);
        }

        function tick() {
            if (!queue.length) {
                setCursorActive(false);
                render('');
                return;
            }

            const message = queue[messageIndex];

            if (!isDeleting && charIndex === message.length) {
                setCursorActive(true);
                isDeleting = true;
                schedule(pauseDelay);
                return;
            }

            if (isDeleting && charIndex === 0) {
                isDeleting = false;
                messageIndex = (messageIndex + 1) % queue.length;
                setCursorActive(true);
                schedule(restartDelay);
                return;
            }

            if (!isDeleting) {
                charIndex += 1;
                render(message.slice(0, charIndex));
                setCursorActive(true);
                schedule(typingDelay);
            } else {
                charIndex -= 1;
                render(message.slice(0, charIndex));
                setCursorActive(true);
                schedule(deletingDelay);
            }
        }

        function start(messages) {
            clearTimer();
            queue = messages;
            messageIndex = 0;
            charIndex = 0;
            isDeleting = false;
            render('');
            setCursorActive(true);
            schedule(300);
        }

        return {
            setMessages(messages) {
                const sanitized = (messages || [])
                    .map(value => (typeof value === 'string' ? value : String(value)))
                    .map(value => value.trim())
                    .filter(Boolean);

                if (!sanitized.length) {
                    render('');
                    setCursorActive(false);
                    clearTimer();
                    return;
                }

                start(sanitized);
            },
            stop() {
                clearTimer();
            }
        };
    }

    function getDict(lang) {
        return translations[lang] || translations.ru;
    }

    function setAdminToken(token) {
        try { localStorage.setItem('adminToken', token); } catch (_) {}
    }

    function getAdminToken() {
        try { return localStorage.getItem('adminToken'); } catch (_) { return null; }
    }

    function setMessage(text, type = 'error') {
        messageEl.textContent = text || '';
        if (type === 'success') {
            messageEl.classList.add('success');
        } else {
            messageEl.classList.remove('success');
        }
    }

    function openModal() {
        setMessage('');
        modal.classList.add('open');
        document.body.classList.add('modal-open');
    }

    function closeModal() {
        modal.classList.remove('open');
        document.body.classList.remove('modal-open');
        form.reset();
        setMessage('');
    }

    async function login(username, password) {
        const res = await fetch(`${API_CONFIG.baseUrl}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data?.message || getDict(currentLang).loginError);
        }
        if (data?.token) {
            setAdminToken(data.token);
        }
    }

    function applyLanguage(lang) {
        const dict = getDict(lang);
        updateHeroMessages(dict.heroMessages);
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (dict[key] !== undefined) {
                el.innerHTML = dict[key];
            }
        });
        if (currentLangEl) currentLangEl.textContent = lang.toUpperCase();
        menuItems.forEach(item => {
            const selected = item.dataset.lang === lang;
            item.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        document.documentElement.lang = lang;
        document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang } }));
    }

    function closeLanguageMenu() {
        dropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function openLanguageMenu() {
        dropdown.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
    }

    function setLanguage(lang) {
        if (!translations[lang]) lang = 'ru';
        currentLang = lang;
        localStorage.setItem('landingLang', lang);
        applyLanguage(lang);
        closeLanguageMenu();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = trigger.getAttribute('aria-expanded') === 'true';
        if (expanded) {
            closeLanguageMenu();
        } else {
            openLanguageMenu();
        }
    });

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            setLanguage(item.dataset.lang);
        });
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            closeLanguageMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeLanguageMenu();
            if (nav?.classList.contains('nav-open')) {
                nav.classList.remove('nav-open');
                navToggle?.setAttribute('aria-expanded', 'false');
            }
            if (modal.classList.contains('open')) {
                closeModal();
            }
        }
    });

    // Разделяем кнопки на админ-панель и создание мероприятия
    openButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const btnText = btn.textContent.trim();
            const isAdminBtn = btnText.includes('Админ') || btnText.includes('Admin') || btnText.includes('Әкімшілік');
            const isCreateBtn = btnText.includes('Создать') || btnText.includes('Create') || btnText.includes('құру');
            
            // Если кнопка "Админ-панель"
            if (isAdminBtn) {
                if (getAdminToken()) {
                    window.location.href = 'admin.html';
                } else {
                    openModal();
                }
            } else if (isCreateBtn) {
                // Для кнопок "Создать мероприятие" открываем форму заявки
                if (typeof window.openContactModal === 'function') {
                    window.openContactModal();
                } else {
                    const contactModal = document.getElementById('contactModal');
                    if (contactModal) {
                        contactModal.classList.add('open');
                        document.body.classList.add('modal-open');
                    }
                }
            } else {
                // По умолчанию открываем форму заявки
                if (typeof window.openContactModal === 'function') {
                    window.openContactModal();
                }
            }
        });
    });

    closeBtn?.addEventListener('click', () => {
        closeModal();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dict = getDict(currentLang);
        const submitBtn = form.querySelector('button[type="submit"]');
        const formData = new FormData(form);
        const username = formData.get('username');
        const password = formData.get('password');
        if (!username || !password) {
            setMessage(dict.loginEmpty);
            return;
        }
        submitBtn.disabled = true;
        setMessage(dict.loginLoading, 'success');
        try {
            await login(username, password);
            setMessage(dict.loginSuccess, 'success');
            setTimeout(() => {
                closeModal();
                window.location.href = 'admin.html';
            }, 500);
        } catch (err) {
            setMessage(err.message || dict.loginError);
        } finally {
            submitBtn.disabled = false;
        }
    });

    applyLanguage(currentLang);
    localStorage.setItem('landingLang', currentLang);
});

