class QRCodeGenerator {
    constructor() {
        this.qrlib = new QRCode(document.createElement('div'), {
            width: 256,
            height: 256,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    generateQR(eventId) {
        const url = `${window.location.origin}/gallery.html?event=${encodeURIComponent(eventId)}`;
        return new Promise((resolve) => {
            this.qrlib.makeCode(url);
            setTimeout(() => {
                const dataUrl = this.qrlib._el.querySelector('canvas').toDataURL('image/png');
                resolve({
                    dataUrl,
                    downloadUrl: this.createDownloadLink(dataUrl, eventId)
                });
            }, 50);
        });
    }

    createDownloadLink(dataUrl, eventId) {
        const link = document.createElement('a');
        link.download = `qr-event-${eventId}.png`;
        link.href = dataUrl;
        return link;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Данные из localStorage больше не используются для построения QR/ссылок,
    // чтобы избежать подмены на последнее созданное событие
    let eventData = null;
    function getEventIdFromLocation() {
        const params = new URLSearchParams(window.location.search);
        const qId = params.get('id') || params.get('event');
        if (qId) return qId;
        const hash = window.location.hash || '';
        if (hash.includes('event=') || hash.includes('id=')) {
            try {
                const hp = new URLSearchParams(hash.replace(/^#/, ''));
                const hv = hp.get('event') || hp.get('id');
                if (hv) return hv;
            } catch (_) {}
        }
        const m = window.location.pathname.match(/(?:^|\/)event\/(\d+)(?:\/|$)/i);
        return m ? m[1] : null;
    }
    function getDateFromLocation() {
        const params = new URLSearchParams(window.location.search);
        if (params.get('date')) return params.get('date');
        const hash = window.location.hash || '';
        if (hash.includes('date=')) {
            try {
                const hp = new URLSearchParams(hash.replace(/^#/, ''));
                const d = hp.get('date');
                if (d) return d;
            } catch (_) {}
        }
        return null;
    }
    const eventId = getEventIdFromLocation();
    const urlDate = getDateFromLocation();
    
    // Заполняем информацию о событии
    // Заголовок будет заполнен после загрузки события из API ниже

    const qrcodeContainer = document.getElementById('qrcode');
    const defaultBodyBackground = document.body.style.background;

    function applyBranding(color, backgroundUrl) {
        document.body.classList.remove('has-branding-image');
        if (backgroundUrl && backgroundUrl.trim()) {
            document.body.classList.add('has-branding-image');
            document.body.style.background = `url("${backgroundUrl}") center / cover no-repeat fixed`;
        } else if (typeof color === 'string' && color.trim()) {
            document.body.style.background = color.trim();
        } else {
            document.body.style.background = defaultBodyBackground;
        }
    }

    // Пытаемся получить уникальный QR из бэкенда (он создаётся при создании события)
    (async () => {
        let dataUrlFromBackend = null;
        let linkUrl = null;
        let eventDateFromApi = null;
        let brandingColorFromApi = null;
        let brandingBackgroundFromApi = null;
        try {
            if (eventId) {
                const res = await fetch(`${API_CONFIG.baseUrl}/events/${encodeURIComponent(eventId)}`);
                if (res.ok) {
                    const evt = await res.json();
                    // Обновим заголовок, если данных из localStorage нет или отличаются
                    document.getElementById('eventName').textContent = evt.name || `Событие #${eventId}`;
                    if (evt.date) {
                        eventDateFromApi = evt.date;
                        document.getElementById('eventDate').textContent = new Date(evt.date).toLocaleDateString('ru-RU');
                    }
                    brandingColorFromApi = evt.branding_color;
                    brandingBackgroundFromApi = evt.branding_background_url;
                    if (evt.branding_logo_url) {
                        const logoContainer = document.getElementById('qrLogoContainer');
                        const logoImg = document.getElementById('qrLogo');
                        if (logoContainer && logoImg) {
                            logoImg.src = evt.branding_logo_url;
                            logoContainer.style.display = 'block';
                        }
                    } else {
                        const logoContainer = document.getElementById('qrLogoContainer');
                        if (logoContainer) {
                            logoContainer.style.display = 'none';
                        }
                    }
                    if (evt && typeof evt.qr_code === 'string' && evt.qr_code.startsWith('data:image')) {
                        dataUrlFromBackend = evt.qr_code;
                    }
                    if (evt && typeof evt.access_link === 'string' && evt.access_link.length > 0) {
                        linkUrl = evt.access_link;
                    }
                }
            }
        } catch (_) { /* ignore network errors */ }

        applyBranding(brandingColorFromApi, brandingBackgroundFromApi);

        // Если по каким-то причинам не удалось получить название
        if (!document.getElementById('eventName').textContent) {
            document.getElementById('eventName').textContent = `Событие #${eventId || ''}`;
        }

        // Если ссылка из БД указывает на другой хост (например, на бэкенд 5000),
        // перепишем её на текущий фронтенд-оригин, сохраняя путь/хэш
        if (linkUrl) {
            try {
                const u = new URL(linkUrl, window.location.origin);
                const sameOrigin = u.origin === window.location.origin;
                if (!sameOrigin) {
                    linkUrl = `${window.location.origin}${u.pathname}${u.search || ''}${u.hash || ''}`;
                }
            } catch (_) {}
        }

        if (dataUrlFromBackend && linkUrl && linkUrl.startsWith(`${window.location.origin}/`)) {
            // Покажем QR из бэкенда (уникален для каждого мероприятия)
            const img = document.createElement('img');
            img.alt = 'QR';
            img.width = 256;
            img.height = 256;
            img.src = dataUrlFromBackend;
            qrcodeContainer.innerHTML = '';
            qrcodeContainer.appendChild(img);
            // Кнопка скачивания будет использовать этот dataURL
            qrcodeContainer.dataset.qrDataUrl = dataUrlFromBackend;
        } else {
            // Фоллбек: сгенерировать на клиенте
            // Используем hash-параметры, чтобы серверы статики не срезали query
            const text = linkUrl || `${window.location.origin}/gallery.html#event=${encodeURIComponent(eventId || '')}&date=${encodeURIComponent(urlDate || eventDateFromApi || '')}`;
            const qrcode = new QRCode(qrcodeContainer, {
                text,
                width: 256,
                height: 256,
                colorDark: '#1e3c72',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
            // небольшая задержка, чтобы canvas успел отрендериться
            setTimeout(() => {
                const canvas = qrcodeContainer.querySelector('canvas');
                if (canvas) qrcodeContainer.dataset.qrDataUrl = canvas.toDataURL();
            }, 50);
            if (!linkUrl) linkUrl = text;
        }
    })();
    
    // Обработчик скачивания QR-кода
    document.getElementById('downloadQR').addEventListener('click', () => {
        const src = document.getElementById('qrcode').dataset.qrDataUrl
            || document.querySelector('#qrcode canvas')?.toDataURL('image/png');
        if (!src) return;
        const safeName = (eventData?.name || '').toString().replace(/[^a-zA-Z0-9_\-]+/g, '_');
        const filename = `qr-event-${eventId || 'unknown'}${safeName ? '-' + safeName : ''}.png`;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const size = 1024;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            // белый фон, чтобы PNG не был прозрачным
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);
            // Растянуть исходный QR до 1024x1024
            ctx.drawImage(img, 0, 0, size, size);
            const out = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = filename;
            link.href = out;
            link.click();
        };
        img.src = src;
    });
    
    // Обработчик печати
    document.getElementById('printQR').addEventListener('click', () => {
        window.print();
    });
});
