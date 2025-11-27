document.addEventListener('DOMContentLoaded', () => {
    const contactModal = document.getElementById('contactModal');
    const contactForm = document.getElementById('contactForm');
    const closeBtn = document.querySelector('[data-close-contact]');
    const messageEl = contactModal?.querySelector('.contact-message');
    let recaptchaWidgetId = null;

    if (!contactModal || !contactForm || !messageEl) {
        return;
    }

    // Функция для инициализации reCAPTCHA (вызывается только при открытии модального окна)
    function initRecaptcha() {
        const container = document.getElementById('recaptcha-container');
        if (!container) return;
        
        // Если уже инициализирована, не делаем ничего
        if (recaptchaWidgetId !== null) return;
        
        // Проверяем готовность reCAPTCHA
        function tryRender() {
            if (typeof grecaptcha === 'undefined' || !grecaptcha.render) {
                // Если еще не загружена, ждем
                setTimeout(tryRender, 200);
                return;
            }
            
            try {
                // Очищаем контейнер перед рендерингом
                container.innerHTML = '';
                recaptchaWidgetId = grecaptcha.render('recaptcha-container', {
                    'sitekey': '6Leo4BksAAAAAMExLM0getPEHFAbLp3obeQW06rw',
                    'theme': 'light',
                    'size': 'normal'
                });
            } catch (error) {
                // Игнорируем ошибки рендеринга, если виджет уже создан
                if (error.message && error.message.includes('already been rendered')) {
                    // Виджет уже создан, получаем его ID
                    const existingWidget = container.querySelector('[data-sitekey]');
                    if (existingWidget) {
                        // Пытаемся найти существующий виджет
                        recaptchaWidgetId = 0; // Используем первый виджет
                    }
                } else {
                    console.error('reCAPTCHA render error:', error);
                    recaptchaWidgetId = null;
                }
            }
        }
        
        // Используем grecaptcha.ready если доступно
        if (typeof grecaptcha !== 'undefined' && grecaptcha.ready) {
            grecaptcha.ready(tryRender);
        } else {
            // Иначе пробуем через небольшую задержку
            setTimeout(tryRender, 300);
        }
    }

    // Глобальная функция для загрузки reCaptcha (не инициализируем сразу)
    window.onRecaptchaLoad = function() {
        // Не инициализируем reCAPTCHA при загрузке страницы
        // Она будет инициализирована только при открытии модального окна
    };

    function setMessage(text, type = 'error') {
        messageEl.textContent = text || '';
        messageEl.className = 'contact-message';
        if (type === 'success') {
            messageEl.classList.add('success');
        }
    }

    function openModal() {
        setMessage('');
        contactForm.reset();
        
        contactModal.classList.add('open');
        document.body.classList.add('modal-open');
        
        // Инициализируем reCAPTCHA только после открытия модального окна
        // Используем задержку, чтобы DOM обновился и reCAPTCHA была готова
        setTimeout(() => {
            if (recaptchaWidgetId !== null && typeof grecaptcha !== 'undefined') {
                // Если уже инициализирована, просто сбрасываем
                try {
                    grecaptcha.reset(recaptchaWidgetId);
                } catch (e) {
                    // Если ошибка сброса, переинициализируем
                    recaptchaWidgetId = null;
                    initRecaptcha();
                }
            } else {
                // Инициализируем впервые
                initRecaptcha();
            }
        }, 300);
    }

    function closeModal() {
        contactModal.classList.remove('open');
        document.body.classList.remove('modal-open');
        contactForm.reset();
        setMessage('');
        if (recaptchaWidgetId !== null) {
            grecaptcha.reset(recaptchaWidgetId);
        }
    }

    closeBtn?.addEventListener('click', () => {
        closeModal();
    });

    contactModal.addEventListener('click', (e) => {
        if (e.target === contactModal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && contactModal.classList.contains('open')) {
            closeModal();
        }
    });

    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = contactForm.querySelector('button[type="submit"]');
        const formData = new FormData(contactForm);
        const name = formData.get('name');
        const phone = formData.get('phone');
        const message = formData.get('message');

        if (!name || !phone || !message) {
            setMessage('Пожалуйста, заполните все поля');
            return;
        }

        // Проверка reCaptcha
        let recaptchaResponse = null;
        if (recaptchaWidgetId !== null) {
            recaptchaResponse = grecaptcha.getResponse(recaptchaWidgetId);
            if (!recaptchaResponse) {
                setMessage('Пожалуйста, подтвердите, что вы не робот');
                return;
            }
        }

        submitBtn.disabled = true;
        setMessage('Отправка заявки...', 'success');

        try {
            const response = await fetch(`${API_CONFIG.baseUrl}/contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    phone,
                    message,
                    recaptcha: recaptchaResponse
                })
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                console.error('Contact form error:', data);
                throw new Error(data?.error || `Ошибка при отправке заявки (${response.status})`);
            }

            setMessage('Заявка успешно отправлена! Мы свяжемся с вами в ближайшее время.', 'success');
            setTimeout(() => {
                closeModal();
            }, 2000);
        } catch (err) {
            console.error('Contact form submission error:', err);
            setMessage(err.message || 'Ошибка при отправке заявки. Попробуйте позже.');
        } finally {
            submitBtn.disabled = false;
            if (recaptchaWidgetId !== null) {
                grecaptcha.reset(recaptchaWidgetId);
            }
        }
    });

    // Экспортируем функции для открытия модального окна из других скриптов
    window.openContactModal = openModal;
});

