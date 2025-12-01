document.addEventListener('DOMContentLoaded', () => {
    const MIN_PHOTOS_REQUIRED = 5;
    const PHOTO_DISPLAY_DURATION = 4000; // 4 секунды
    const POLL_INTERVAL = 5000; // Обновление каждые 5 секунд
    
    // Сначала объявляем все DOM элементы
    const loadingScreen = document.getElementById('loadingScreen');
    const errorScreen = document.getElementById('errorScreen');
    const photoDisplay = document.getElementById('photoDisplay');
    const currentPhoto = document.getElementById('currentPhoto');
    const photoCountEl = document.getElementById('photoCount');
    const eventNameEl = document.getElementById('eventName');
    const backBtn = document.getElementById('backBtn');
    const errorMessage = document.getElementById('errorMessage');

    let photos = [];
    let displayedPhotoIds = new Set();
    let currentPhotoIndex = -1;
    let photoChangeTimer = null;
    let pollTimer = null;
    let lastPhotoId = null;
    let currentDisplayingPhotoId = null; // Защита от повторных вызовов onImageLoad
    let isTimerSet = false; // Флаг, что таймер уже установлен для текущего фото
    let timerPhotoId = null; // ID фото, для которого установлен таймер
    let photoDisplayStartTime = null; // Время начала отображения текущего фото (для восстановления после сворачивания)

    // Используем только одну мягкую анимацию
    const animationClass = 'animation-soft';

    // Получаем eventId из разных источников (как в gallery.js)
    function getEventIdFromLocation() {
    const params = new URLSearchParams(window.location.search);
        const qId = params.get('id') || params.get('event');
        if (qId) return qId;
        const hash = window.location.hash || '';
        if (hash.includes('event=')) {
            try {
                const hp = new URLSearchParams(hash.replace(/^#/, ''));
                const hv = hp.get('event') || hp.get('id');
                if (hv) return hv;
            } catch (_) {}
        }
        const m = window.location.pathname.match(/(?:^|\/)event\/(\d+)(?:\/|$)/i);
        return m ? m[1] : null;
    }
    
    // Получаем параметр from из hash (откуда пришли: qr или gallery)
    function getFromParameter() {
        const hash = window.location.hash || '';
        if (hash.includes('from=')) {
            try {
                const hp = new URLSearchParams(hash.replace(/^#/, ''));
                return hp.get('from');
            } catch (_) {}
        }
        return null;
    }
    
    const eventId = getEventIdFromLocation();
    
    console.log('Live Wall - Event ID:', eventId);
    console.log('Live Wall - URL:', window.location.href);
    console.log('Live Wall - Search:', window.location.search);
    console.log('Live Wall - Hash:', window.location.hash);
    
    // Функция показа ошибки (должна быть объявлена до использования)
    function showError(message) {
        if (loadingScreen) loadingScreen.style.display = 'none';
        if (errorScreen) {
            errorScreen.style.display = 'flex';
            if (errorMessage) {
                errorMessage.textContent = message;
            }
        }
        if (photoDisplay) photoDisplay.style.display = 'none';
    }
    
    if (!eventId) {
        console.error('Event ID not found in URL');
        showError('ID мероприятия не указан. Перейдите на страницу фотостены из галереи мероприятия.');
        return;
    }

    // Инициализация
    init();

    function init() {
        // Обработчик кнопки "Назад"
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                // Получаем event ID заново, чтобы убедиться, что он актуален
                const currentEventId = getEventIdFromLocation();
                const fromParam = getFromParameter();
                
                if (currentEventId) {
                    let backUrl;
                    
                    // Определяем, куда возвращаться в зависимости от параметра from
                    if (fromParam === 'qr') {
                        // Возвращаемся на страницу QR-кода
                        backUrl = `qr-page.html#event=${encodeURIComponent(currentEventId)}`;
                        console.log('Navigating back to QR page with event ID:', currentEventId, 'URL:', backUrl);
                    } else {
                        // По умолчанию возвращаемся в галерею (from=gallery или параметр отсутствует)
                        backUrl = `gallery.html#event=${encodeURIComponent(currentEventId)}`;
                        console.log('Navigating back to gallery with event ID:', currentEventId, 'URL:', backUrl);
                    }
                    
                    window.location.href = backUrl;
                } else {
                    // Если event ID не найден, просто переходим на gallery
                    console.warn('Event ID not found, navigating to gallery without event ID');
                    window.location.href = 'gallery.html';
                }
            });
        }

        // Загружаем данные события
        loadEventInfo();
        
        // Загружаем фотографии
        loadPhotos();
    }

    async function loadEventInfo() {
        try {
            const res = await fetch(`${API_CONFIG.baseUrl}/events/${encodeURIComponent(eventId)}`);
            if (res.ok) {
                const event = await res.json();
                if (eventNameEl && event.name) {
                    eventNameEl.textContent = `Live: ${event.name}`;
                }
            }
        } catch (error) {
            console.error('Error loading event info:', error);
        }
    }

    async function loadPhotos() {
        try {
            const url = `${API_CONFIG.baseUrl}/photos/event/${encodeURIComponent(eventId)}?sort=date&media_type=photo`;
            const res = await fetch(url);
            
            if (!res.ok) {
                throw new Error('Failed to load photos');
            }

            const data = await res.json();
            console.log('Loaded photos data:', data);
            
            const apiOrigin = API_CONFIG.baseUrl.replace(/\/api\/?$/, '');
            
            function toAbsoluteUrl(u) {
                if (!u) return '';
                if (/^https?:\/\//i.test(u)) return u;
                const path = String(u).startsWith('/') ? u : `/${u}`;
                return `${apiOrigin}${path}`;
            }

            // API уже возвращает только approved фото, поэтому просто маппим
            const approvedPhotos = (Array.isArray(data) ? data : [])
                .filter(p => {
                    // Фильтруем только фото (не видео) и только approved
                    const isPhoto = (p.media_type === 'photo' || !p.media_type);
                    const isApproved = (p.status === 'approved' || !p.status);
                    return isPhoto && isApproved;
                })
                .map(p => ({
                    id: p.id,
                    url: toAbsoluteUrl(p.url || p.filename),
                    previewUrl: toAbsoluteUrl(p.preview_url || p.url || p.filename),
                    uploadedAt: p.uploaded_at
                }));

            console.log('Processed photos:', approvedPhotos.length, approvedPhotos);

            // Обновляем счетчик сразу
            if (photoCountEl) {
                photoCountEl.textContent = approvedPhotos.length;
            }
            
            // Проверяем количество фотографий
            if (approvedPhotos.length < MIN_PHOTOS_REQUIRED) {
                showError(`Недостаточно фотографий для отображения фотостены. Текущее количество: ${approvedPhotos.length}`);
                return;
            }

            // Обновляем список фотографий
            updatePhotosList(approvedPhotos);
            
            // Показываем фотостену
            showPhotoWall();

            // Запускаем отображение ТОЛЬКО если фото еще не отображается
            // КРИТИЧЕСКИ ВАЖНО: Не вызываем displayNextPhoto() если фото уже отображается ИЛИ в процессе загрузки/анимации
            if (photos.length > 0) {
                // Строгая проверка: таймер должен быть null И флаг должен быть false И currentDisplayingPhotoId должен быть null
                if (!photoChangeTimer && !isTimerSet && timerPhotoId === null && currentDisplayingPhotoId === null) {
                    displayNextPhoto();
                } else {
                    console.log('Photo already displaying or loading, skipping initial displayNextPhoto(). Timer:', !!photoChangeTimer, 'Flag:', isTimerSet, 'Timer ID:', timerPhotoId, 'Current ID:', currentDisplayingPhotoId);
                }
            } else {
                console.error('No photos to display after updatePhotosList');
            }

            // Запускаем polling для обновления
            startPolling();

        } catch (error) {
            console.error('Error loading photos:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                eventId: eventId,
                url: `${API_CONFIG.baseUrl}/photos/event/${encodeURIComponent(eventId)}?sort=date&media_type=photo`
            });
            showError(`Ошибка при загрузке фотографий: ${error.message}`);
        }
    }

    function updatePhotosList(newPhotos) {
        // Объединяем старые и новые фотографии
        const existingIds = new Set(photos.map(p => p.id));
        const newPhotosToAdd = newPhotos.filter(p => !existingIds.has(p.id));
        
        if (newPhotosToAdd.length > 0) {
            photos = [...photos, ...newPhotosToAdd];
            console.log(`Добавлено ${newPhotosToAdd.length} новых фотографий. Всего: ${photos.length}`);
        } else if (photos.length === 0) {
            // Если это первая загрузка, просто устанавливаем список
            photos = newPhotos;
            console.log(`Первая загрузка: ${photos.length} фотографий`);
        } else {
            // Обновляем существующие фотографии (на случай изменения URL)
            photos = newPhotos;
            console.log(`Обновлен список: ${photos.length} фотографий`);
        }
        
        // Всегда обновляем счетчик
        if (photoCountEl) {
            photoCountEl.textContent = photos.length;
        }
    }

    function showPhotoWall() {
        if (loadingScreen) loadingScreen.style.display = 'none';
        if (errorScreen) errorScreen.style.display = 'none';
        if (photoDisplay) photoDisplay.style.display = 'flex';
        // Счетчик уже обновлен в updatePhotosList
    }

    function getRandomPhoto() {
        if (photos.length === 0) return null;

        // Выбираем случайное фото, которое еще не показывали
        let availablePhotos = photos.filter(p => !displayedPhotoIds.has(p.id));
        
        // Если все фото уже показаны, сбрасываем список и используем все
        if (availablePhotos.length === 0) {
            console.log('All photos shown, resetting displayedPhotoIds');
            displayedPhotoIds.clear();
            availablePhotos = photos;
        }

        const randomIndex = Math.floor(Math.random() * availablePhotos.length);
        const selectedPhoto = availablePhotos[randomIndex];
        
        console.log('Selected photo:', selectedPhoto.id, 'from', availablePhotos.length, 'available photos');
        displayedPhotoIds.add(selectedPhoto.id);
        return selectedPhoto;
    }


    function displayNextPhoto() {
        // КРИТИЧЕСКИ ВАЖНО: Если флаги установлены, но таймер отсутствует - это ошибка состояния, сбрасываем флаги
        if (isTimerSet && timerPhotoId !== null && !photoChangeTimer) {
            console.warn('WARNING: Timer flags are set but timer is null! Resetting flags. Timer ID:', timerPhotoId, 'Current ID:', currentDisplayingPhotoId);
            isTimerSet = false;
            timerPhotoId = null;
            // Если currentDisplayingPhotoId установлен, но таймер отсутствует, возможно фото застряло
            // Сбрасываем currentDisplayingPhotoId, чтобы разблокировать слайдшоу
            if (currentDisplayingPhotoId !== null) {
                console.warn('Resetting currentDisplayingPhotoId to unblock slideshow');
                currentDisplayingPhotoId = null;
            }
        }
        
        // КРИТИЧЕСКИ ВАЖНО: Если фото уже отображается (таймер активен ИЛИ фото в процессе загрузки/анимации), НЕ прерываем его
        // Это предотвращает преждевременное переключение фото
        // Проверяем не только таймер, но и currentDisplayingPhotoId, чтобы блокировать вызовы во время fade-in
        if ((photoChangeTimer && isTimerSet && timerPhotoId !== null) || currentDisplayingPhotoId !== null) {
            console.log('Photo is currently displaying or loading, skipping displayNextPhoto(). Current photo ID:', currentDisplayingPhotoId || timerPhotoId, 'Timer:', !!photoChangeTimer, 'Flag:', isTimerSet);
            return;
        }
        
        // Очищаем предыдущий таймер ПЕРЕД началом (только если он не активен)
        if (photoChangeTimer) {
            clearTimeout(photoChangeTimer);
            photoChangeTimer = null;
        }
        
        // ВАЖНО: Сбрасываем защиту от повторных вызовов ТОЛЬКО если мы действительно переключаемся на новое фото
        isTimerSet = false; // Сбрасываем флаг таймера
        timerPhotoId = null; // Сбрасываем ID фото для таймера
        photoDisplayStartTime = null; // Сбрасываем время начала отображения

        let photo = getRandomPhoto();
        if (!photo || !currentPhoto) {
            // Если нет фотографий, пытаемся загрузить снова через некоторое время
            photoChangeTimer = setTimeout(() => {
                loadPhotos();
            }, POLL_INTERVAL);
            return;
        }
        
        // Проверяем, не пытаемся ли показать то же самое фото
        if (lastPhotoId === photo.id && photos.length > 1) {
            console.log('Same photo selected, getting another one. Last ID:', lastPhotoId, 'Selected ID:', photo.id);
            displayedPhotoIds.delete(photo.id);
            let attempts = 0;
            let newPhoto = getRandomPhoto();
            while (newPhoto && newPhoto.id === photo.id && attempts < 5) {
                displayedPhotoIds.delete(newPhoto.id);
                newPhoto = getRandomPhoto();
                attempts++;
            }
            if (newPhoto && newPhoto.id !== photo.id) {
                photo = newPhoto;
                console.log('Got different photo:', newPhoto.id);
            } else {
                console.log('Could not get different photo, will show same one');
            }
        }

        // КРИТИЧЕСКИ ВАЖНО: Устанавливаем currentDisplayingPhotoId СРАЗУ после выбора фото,
        // ДО начала загрузки изображения, чтобы заблокировать повторные вызовы displayNextPhoto()
        // во время загрузки и fade-in
        currentDisplayingPhotoId = photo.id;

        // Устанавливаем новое фото
        const imageUrl = photo.previewUrl || photo.url;
        console.log('Displaying photo:', photo.id, 'Previous photo ID:', lastPhotoId, 'URL:', imageUrl);
        
        // Сначала скрываем текущее фото и сбрасываем все стили и классы
        currentPhoto.classList.remove('fade-in', 'fade-out', 'visible', animationClass);
        // Убираем inline стили, чтобы CSS мог управлять анимациями
        currentPhoto.style.opacity = '';
        currentPhoto.style.transform = '';
        currentPhoto.style.visibility = '';
        currentPhoto.style.animation = '';
        
        // Обработчик успешной загрузки изображения
        // ВАЖНО: Сохраняем ID фото в локальную переменную ДО создания обработчика,
        // чтобы избежать проблем с замыканиями, если photo изменится
        const photoIdForThisLoad = photo.id;
        
        const onImageLoad = () => {
            // Защита от повторных вызовов: проверяем, что это все еще то же фото
            if (currentDisplayingPhotoId !== photoIdForThisLoad) {
                console.log('Photo changed during image load, ignoring onImageLoad. Current ID:', currentDisplayingPhotoId, 'Expected ID:', photoIdForThisLoad);
                return;
            }
            
            // currentDisplayingPhotoId уже установлен в displayNextPhoto(), просто проверяем, что он совпадает
            console.log('Image loaded successfully:', imageUrl, 'Photo ID:', photoIdForThisLoad);
            
            // Очищаем предыдущий таймер ПЕРЕД установкой нового
            if (photoChangeTimer) {
                clearTimeout(photoChangeTimer);
                photoChangeTimer = null;
            }
            
            // Сбрасываем все стили и классы
            // ВАЖНО: Убираем inline стили, чтобы не конфликтовать с CSS анимациями
            currentPhoto.style.opacity = '';
            currentPhoto.style.visibility = '';
            currentPhoto.style.animation = '';
            currentPhoto.style.transform = '';
            currentPhoto.className = '';
            currentPhoto.classList.remove('fade-in', 'fade-out', 'visible');
            
            // Принудительно перерисовываем для сброса анимации
            void currentPhoto.offsetHeight; // trigger reflow
            
            // Добавляем класс анимации
            currentPhoto.className = animationClass;
            
            // Еще раз проверяем, что это все еще то же фото (на случай если уже переключились)
            // Используем локальную переменную для надежности
            if (currentDisplayingPhotoId !== photoIdForThisLoad) {
                console.log('Photo changed during load, ignoring display for:', photoIdForThisLoad, 'Current ID:', currentDisplayingPhotoId);
                return;
            }
            
            // КРИТИЧЕСКИ ВАЖНО: Проверяем флаг и таймер, чтобы таймер не устанавливался дважды
            if (isTimerSet && photoChangeTimer) {
                console.log('Timer already set for photo:', photo.id, 'ignoring duplicate timer setup');
                return;
            }
            
            // Если флаг установлен, но таймера нет - сбрасываем флаг (возможно, таймер был очищен)
            if (isTimerSet && !photoChangeTimer) {
                console.log('Timer flag was set but timer is null, resetting flag. Photo ID:', photo.id);
                isTimerSet = false;
            }
            
            // Убеждаемся, что таймер не установлен
            if (photoChangeTimer) {
                clearTimeout(photoChangeTimer);
                photoChangeTimer = null;
            }
            
            // ВАЖНО: НЕ устанавливаем флаг здесь, он будет установлен только когда таймер реально установится
            
            // ВАЖНО: Сначала устанавливаем начальное состояние (невидимо)
            currentPhoto.style.opacity = '0';
            currentPhoto.style.visibility = 'visible';
            currentPhoto.style.transform = 'scale(0.98)';
            
            // Используем requestAnimationFrame для гарантии применения стилей перед анимацией
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    // Принудительно удаляем класс, если он был (для перезапуска анимации)
                    currentPhoto.classList.remove('fade-in');
                    // Принудительно перерисовываем
                    void currentPhoto.offsetHeight;
                    // Теперь добавляем класс для запуска анимации
                    currentPhoto.classList.add('fade-in');
                    console.log('Starting fade-in animation for photo:', photo.id);
                });
            });
            
            // После завершения fade-in (1.2 сек), фото становится видимым
            setTimeout(() => {
                // Используем локальную переменную для проверки
                if (currentDisplayingPhotoId !== photoIdForThisLoad) {
                    console.log('Photo changed during fade-in, canceling. Current ID:', currentDisplayingPhotoId, 'Expected ID:', photoIdForThisLoad);
                    return;
                }
                
                // КРИТИЧЕСКИ ВАЖНО: Проверяем, не установлен ли уже таймер для этого фото
                if (isTimerSet && photoChangeTimer && timerPhotoId === photoIdForThisLoad) {
                    console.log('Timer already set for this photo during fade-in completion, skipping. Photo ID:', photoIdForThisLoad);
                    return;
                }
                
                // Если таймер установлен для другого фото - очищаем его
                if (photoChangeTimer && timerPhotoId !== photoIdForThisLoad) {
                    console.log('Clearing timer for different photo. Old ID:', timerPhotoId, 'New ID:', photoIdForThisLoad);
                    clearTimeout(photoChangeTimer);
                    photoChangeTimer = null;
                    isTimerSet = false;
                    timerPhotoId = null;
                }
                
                // Переключаемся на класс "visible" для статичного отображения
                currentPhoto.classList.remove('fade-in');
                // Убираем inline стили, чтобы CSS мог управлять
                currentPhoto.style.opacity = '';
                currentPhoto.style.transform = '';
                currentPhoto.classList.add('visible');
                const displayStartTime = Date.now();
                photoDisplayStartTime = displayStartTime; // Сохраняем время начала отображения
                console.log('Photo visible, starting display timer. Photo ID:', photoIdForThisLoad, 'Time:', new Date().toISOString());
                
                // КРИТИЧЕСКИ ВАЖНО: Финальная проверка перед установкой таймера
                // Если таймер уже установлен для этого фото - не устанавливаем повторно
                if (isTimerSet && photoChangeTimer && timerPhotoId === photoIdForThisLoad) {
                    console.log('ERROR: Timer already set for this exact photo! This should not happen. Photo ID:', photoIdForThisLoad);
                    return;
                }
                
                // Убеждаемся, что предыдущий таймер очищен
                if (photoChangeTimer) {
                    console.log('Clearing existing timer before setting new one. Old timer ID:', timerPhotoId, 'New photo ID:', photoIdForThisLoad);
                    clearTimeout(photoChangeTimer);
                    photoChangeTimer = null;
                    isTimerSet = false;
                    timerPhotoId = null;
                }
                
                // КРИТИЧЕСКИ ВАЖНО: Устанавливаем флаг и ID фото ТОЛЬКО когда таймер реально устанавливается
                isTimerSet = true;
                timerPhotoId = photoIdForThisLoad;
                
                console.log('Setting timer for photo:', photoIdForThisLoad, 'Duration: 4000ms');
                
                // Устанавливаем таймер на отображение фото (4 секунды)
                // Сохраняем ID фото в локальную переменную для проверки в таймере
                const timerPhotoIdLocal = photoIdForThisLoad;
                const displayStartTimeLocal = displayStartTime;
                
                photoChangeTimer = setTimeout(() => {
                    // КРИТИЧЕСКИ ВАЖНО: Проверяем, что таймер все еще установлен для этого фото
                    // и что фото не изменилось
                    if (timerPhotoId !== timerPhotoIdLocal || currentDisplayingPhotoId !== timerPhotoIdLocal) {
                        console.log('Photo changed during display, canceling timer. Timer ID:', timerPhotoId, 'Expected ID:', timerPhotoIdLocal, 'Current ID:', currentDisplayingPhotoId);
                        return;
                    }
                    
                    // Дополнительная проверка: убеждаемся, что таймер не был очищен
                    // ВАЖНО: Внутри колбэка setTimeout photoChangeTimer все еще должен быть установлен
                    // Но если он был очищен извне, сбрасываем флаги и выходим
                    if (!photoChangeTimer) {
                        console.warn('Timer was cleared during display, resetting flags and canceling fade-out');
                        isTimerSet = false;
                        timerPhotoId = null;
                        currentDisplayingPhotoId = null;
                        return;
                    }
                    
                    const displayDuration = Date.now() - displayStartTimeLocal;
                    console.log('Photo display time ended, starting fade-out. Current photo ID:', lastPhotoId, 'Timer photo ID:', timerPhotoId, 'Displayed for:', displayDuration, 'ms');
                    
                    // Дополнительная проверка: если фото отображалось меньше 3.5 секунд - это ошибка
                    if (displayDuration < 3500) {
                        console.error('WARNING: Photo displayed for less than 3.5 seconds! Duration:', displayDuration, 'ms. Photo ID:', timerPhotoIdLocal);
                    }
                    
                    // Начинаем анимацию исчезновения
                    // ВАЖНО: Убеждаемся, что фото видимо перед fade-out
                    currentPhoto.style.opacity = '1';
                    currentPhoto.style.visibility = 'visible';
                    currentPhoto.style.transform = 'scale(1)';
                    currentPhoto.classList.remove('visible');
                    
                    // Используем requestAnimationFrame для гарантии применения стилей
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            // Принудительно удаляем класс, если он был (для перезапуска анимации)
                            currentPhoto.classList.remove('fade-out');
                            // Принудительно перерисовываем
                            void currentPhoto.offsetHeight;
                            // Теперь добавляем класс для запуска анимации
                            currentPhoto.classList.add('fade-out');
                        });
                    });
                    
                    // После завершения fade-out (0.8 сек) переключаемся на следующее фото
                    setTimeout(() => {
                        // Очищаем таймер перед переключением
                        photoChangeTimer = null;
                        currentDisplayingPhotoId = null;
                        isTimerSet = false; // Сбрасываем флаг таймера
                        photoDisplayStartTime = null; // Сбрасываем время начала отображения
                        
                        // Скрываем фото полностью
                        currentPhoto.classList.remove('fade-out', 'visible');
                        // Убираем inline стили, чтобы не конфликтовать с CSS
                        currentPhoto.style.opacity = '';
                        currentPhoto.style.visibility = '';
                        currentPhoto.style.animation = '';
                        currentPhoto.style.transform = '';
                        
                        console.log('Calling displayNextPhoto()');
                        displayNextPhoto();
                    }, 1200); // Длительность fade-out анимации (1.2 сек)
                }, PHOTO_DISPLAY_DURATION);
            }, 1200); // Длительность fade-in анимации (1.2 сек)
        };
        
        // Обработчик ошибки загрузки
        const onImageError = () => {
            console.error('Failed to load image:', imageUrl);
            // Сбрасываем флаги при ошибке загрузки
            currentDisplayingPhotoId = null;
            isTimerSet = false;
            timerPhotoId = null;
            photoDisplayStartTime = null; // Сбрасываем время начала отображения
            // Пробуем следующее фото
            setTimeout(() => {
                displayNextPhoto();
            }, 500);
        };
        
        // Сначала удаляем старые обработчики, чтобы избежать двойных вызовов
        currentPhoto.onload = null;
        currentPhoto.onerror = null;
        
        // Устанавливаем обработчики ПЕРЕД установкой src
        currentPhoto.onload = onImageLoad;
        currentPhoto.onerror = onImageError;
        
        // ВАЖНО: Если это то же самое изображение, принудительно перезагружаем
        // Но сначала полностью очищаем src
        if (currentPhoto.src && (currentPhoto.src === imageUrl || currentPhoto.src.endsWith(imageUrl.split('/').pop()))) {
            console.log('Same image URL detected, forcing reload');
            // Временно удаляем обработчики при очистке
            currentPhoto.onload = null;
            currentPhoto.onerror = null;
            currentPhoto.src = '';
            // Ждем, чтобы браузер успел очистить изображение
            setTimeout(() => {
                // Устанавливаем обработчики ПЕРЕД установкой src
                currentPhoto.onload = onImageLoad;
                currentPhoto.onerror = onImageError;
                currentPhoto.src = imageUrl;
            }, 50);
        } else {
            // Устанавливаем src (это запустит загрузку)
            currentPhoto.src = imageUrl;
        }
        currentPhoto.alt = `Photo ${photo.id}`;

        // Обновляем индекс
        currentPhotoIndex = photos.findIndex(p => p.id === photo.id);
        lastPhotoId = photo.id;

        // Таймер теперь устанавливается внутри onImageLoad, после того как фото отобразилось
        // Это гарантирует синхронизацию таймера с моментом начала отображения
    }

    function startPolling() {
        // Очищаем предыдущий таймер
        if (pollTimer) {
            clearInterval(pollTimer);
        }

        // Запускаем polling
        pollTimer = setInterval(() => {
            loadPhotos();
        }, POLL_INTERVAL);
    }

    // Обработка видимости страницы
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            // Возобновляем polling
            startPolling();
            
            // Если фото отображается, проверяем, сколько времени прошло
            if (photoDisplayStartTime && timerPhotoId !== null && currentDisplayingPhotoId === timerPhotoId) {
                const elapsed = Date.now() - photoDisplayStartTime;
                const remaining = PHOTO_DISPLAY_DURATION - elapsed;
                
                console.log('Tab became visible. Photo ID:', timerPhotoId, 'Elapsed:', elapsed, 'ms', 'Remaining:', remaining, 'ms');
                
                if (remaining > 0) {
                    // Фото еще должно отображаться, восстанавливаем таймер на оставшееся время
                    if (photoChangeTimer) {
                        clearTimeout(photoChangeTimer);
                    }
                    
                    photoChangeTimer = setTimeout(() => {
                        // Вызываем логику fade-out из основного таймера
                        if (timerPhotoId !== null && currentDisplayingPhotoId === timerPhotoId) {
                            // Находим фото в массиве для получения ID
                            const photo = photos.find(p => p.id === timerPhotoId);
                            if (photo) {
                                // Запускаем fade-out
                                currentPhoto.style.opacity = '1';
                                currentPhoto.style.visibility = 'visible';
                                currentPhoto.style.transform = 'scale(1)';
                                currentPhoto.classList.remove('visible');
                                
                                requestAnimationFrame(() => {
                                    requestAnimationFrame(() => {
                                        currentPhoto.classList.remove('fade-out');
                                        void currentPhoto.offsetHeight;
                                        currentPhoto.classList.add('fade-out');
                                    });
                                });
                                
                                // После fade-out переключаемся на следующее фото
                                setTimeout(() => {
                                    photoChangeTimer = null;
                                    currentDisplayingPhotoId = null;
                                    isTimerSet = false;
                                    timerPhotoId = null;
                                    photoDisplayStartTime = null;
                                    
                                    currentPhoto.classList.remove('fade-out', 'visible');
                                    currentPhoto.style.opacity = '';
                                    currentPhoto.style.visibility = '';
                                    currentPhoto.style.animation = '';
                                    currentPhoto.style.transform = '';
                                    
                                    console.log('Calling displayNextPhoto() after tab restore');
                                    displayNextPhoto();
                                }, 1200);
                            }
                        }
                    }, remaining);
                    
                    isTimerSet = true;
                    console.log('Restored timer for remaining time:', remaining, 'ms');
                } else {
                    // Время отображения истекло, переключаемся на следующее фото
                    console.log('Photo display time expired while tab was hidden, switching to next photo');
                    if (photoChangeTimer) {
                        clearTimeout(photoChangeTimer);
                        photoChangeTimer = null;
                    }
                    currentDisplayingPhotoId = null;
                    isTimerSet = false;
                    timerPhotoId = null;
                    photoDisplayStartTime = null;
                    displayNextPhoto();
                }
            } else if (photos.length > 0 && !photoChangeTimer && !isTimerSet && timerPhotoId === null && currentDisplayingPhotoId === null) {
                // Фото не отображается, запускаем слайдшоу
                displayNextPhoto();
            }
        } else {
            // Вкладка скрыта - сохраняем состояние, но не очищаем таймеры полностью
            // Очищаем только polling, таймер фото оставляем (он может работать в фоне)
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            // НЕ очищаем photoChangeTimer - он должен продолжить работу
            // Но сохраняем время, чтобы при возврате можно было восстановить состояние
            console.log('Tab hidden. Photo ID:', timerPhotoId, 'Start time:', photoDisplayStartTime);
        }
    });

    // Обработка изменения hash (если пользователь переходит по ссылке с hash после загрузки)
    window.addEventListener('hashchange', () => {
        const newEventId = getEventIdFromLocation();
        if (newEventId && newEventId !== eventId) {
            console.log('Hash changed, reloading with new eventId:', newEventId);
            window.location.reload();
        }
    });

    // Очистка при закрытии страницы
    window.addEventListener('beforeunload', () => {
        if (photoChangeTimer) {
            clearTimeout(photoChangeTimer);
        }
        if (pollTimer) {
            clearInterval(pollTimer);
        }
    });
});
