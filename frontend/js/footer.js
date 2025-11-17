/**
 * Единый компонент футера для всех страниц
 * При изменении здесь, футер обновится на всех страницах
 */

(function() {
    'use strict';

    // Конфигурация футера
    const footerConfig = {
        // tagline будет браться из переводов через data-i18n
        copyright: 'Все права защищены. Атырау 2026',
        logoText: 'SHOT',
        logoIcon: 'QR'
    };

    /**
     * Создает HTML футера
     * @param {Object} options - Опции для кастомизации футера
     * @param {boolean} options.showTagline - Показывать ли tagline
     * @param {string} options.additionalClasses - Дополнительные CSS классы для footer
     * @param {string} options.innerClasses - Дополнительные CSS классы для footer-inner
     * @param {string} options.logoHref - Ссылка для логотипа (по умолчанию #top)
     * @returns {string} HTML код футера
     */
    function createFooter(options = {}) {
        const {
            showTagline = true,
            additionalClasses = '',
            innerClasses = '',
            logoHref = '#top'
        } = options;

        const taglineHTML = showTagline 
            ? `<p data-i18n="footerTagline">Делитесь моментами легко и безопасно</p>`
            : '';

        return `
    <footer class="footer ${additionalClasses}">
        <div class="footer-inner ${innerClasses}">
            <a class="app-logo" href="${logoHref}">
                <span class="app-logo-icon" data-brand-icon>${footerConfig.logoIcon}</span>
                <span class="app-logo-text">${footerConfig.logoText}</span>
            </a>
            ${taglineHTML}
        </div>
        <p class="footer-note">${footerConfig.copyright}</p>
    </footer>`;
    }

    /**
     * Определяет конфигурацию футера в зависимости от страницы
     * @returns {Object} Опции для футера
     */
    function getFooterOptions() {
        const path = window.location.pathname;
        const filename = path.split('/').pop() || 'index.html';

        // Для страницы галереи
        if (filename === 'gallery.html' || path.includes('gallery')) {
            return {
                showTagline: false,
                additionalClasses: 'gallery-footer',
                innerClasses: 'footer-inner--centered',
                logoHref: 'index.html'
            };
        }

        // Для админ панели
        if (filename === 'admin.html' || path.includes('admin')) {
            return {
                showTagline: true,
                additionalClasses: '',
                innerClasses: '',
                logoHref: '#top'
            };
        }

        // Для главной страницы (по умолчанию)
        return {
            showTagline: true,
            additionalClasses: '',
            innerClasses: '',
            logoHref: '#top'
        };
    }

    /**
     * Инициализирует футер на странице
     */
    function initFooter() {
        // Ищем контейнер для футера
        const footerContainer = document.querySelector('footer.footer');
        
        if (!footerContainer) {
            console.warn('Footer container not found');
            return;
        }

        // Получаем опции для текущей страницы
        const options = getFooterOptions();
        
        // Заменяем содержимое футера
        footerContainer.outerHTML = createFooter(options);

        // Небольшая задержка для применения брендинга и переводов
        setTimeout(() => {
            // Если есть функция перевода, вызываем её
            if (typeof translatePage === 'function') {
                translatePage();
            }

            // Обновляем брендинг (используется updateBrandElements из brand.js)
            if (typeof updateBrandElements === 'function') {
                updateBrandElements();
            }
        }, 10);
    }

    // Инициализация при загрузке DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFooter);
    } else {
        initFooter();
    }

    // Экспортируем функции для глобального доступа
    window.FooterComponent = {
        create: createFooter,
        init: initFooter,
        config: footerConfig,
        updateConfig: function(newConfig) {
            Object.assign(footerConfig, newConfig);
            initFooter();
        }
    };

})();

