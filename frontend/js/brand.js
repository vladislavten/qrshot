window.BRAND = window.BRAND || {
    short: 'QR',
    names: {
        ru: 'Фотособорщик',
        en: 'PhotoShare',
        kz: 'Фото жинақ'
    }
};

function getBrandName(lang) {
    const names = window.BRAND.names || {};
    return names[lang] || names.ru || 'Фотособорщик';
}

function updateBrandElements() {
    const html = document.documentElement;
    const currentLang = html?.getAttribute('lang') || 'ru';
    const name = getBrandName(currentLang);
    const short = window.BRAND.short || 'QR';

    document.querySelectorAll('[data-brand-icon]').forEach(el => {
        el.textContent = short;
    });

    document.querySelectorAll('[data-brand-name]').forEach(el => {
        el.textContent = name;
    });
}

document.addEventListener('DOMContentLoaded', updateBrandElements);

document.addEventListener('languagechange', (event) => {
    const lang = event?.detail?.lang;
    if (lang) {
        document.documentElement.setAttribute('lang', lang);
    }
    updateBrandElements();
});

