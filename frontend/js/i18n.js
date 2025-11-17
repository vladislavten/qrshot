const BRAND_CONFIG = window.BRAND || {
    short: 'QR',
    names: {
        ru: 'Фотособорщик',
        en: 'PhotoShare',
        kz: 'Фото жинақ'
    }
};

const translations = {
    ru: {
        brand: BRAND_CONFIG.names.ru || 'Фотособорщик',
        events: 'События',
        moderation: 'Модерация',
        analytics: 'Аналитика',
        createEvent: 'Создать событие',
        footerTagline: 'Делитесь моментами легко и безопасно'
    },
    en: {
        brand: BRAND_CONFIG.names.en || BRAND_CONFIG.names.ru || 'PhotoShare',
        events: 'Events',
        moderation: 'Moderation',
        analytics: 'Analytics',
        createEvent: 'Create event',
        footerTagline: 'Share moments easily and safely'
    },
    kz: {
        brand: BRAND_CONFIG.names.kz || BRAND_CONFIG.names.ru || 'Фото жинақ',
        events: 'Оқиғалар',
        moderation: 'Модерация',
        analytics: 'Талдау',
        createEvent: 'Оқиға жасау',
        footerTagline: 'Сәттерді жеңіл және қауіпсіз бөлісіңіз'
    }
};

let currentLang = 'ru';

function setLanguage(lang) {
    currentLang = translations[lang] ? lang : 'ru';
    translatePage();
}

function translatePage() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        element.textContent = translations[currentLang][key] || key;
    });
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', translatePage);
}