document.addEventListener('DOMContentLoaded', () => {
    const photosGrid = document.getElementById('photosGrid');
    const videosGrid = document.getElementById('videosGrid');
    const modal = document.getElementById('photoModal');
    const modalImage = document.getElementById('modalImage');
    const modalVideo = document.getElementById('modalVideo');
    const headerTitle = document.getElementById('eventTitle');
    const headerDate = document.getElementById('eventDate');
    const modalLikeBtn = document.getElementById('modalLikeBtn');
    const modalLikeCount = document.getElementById('modalLikeCount');
    const shareButtonsContainer = document.getElementById('modalShareButtons');
    const shareToggleBtn = document.getElementById('modalShareToggle');
    const downloadBtn = document.getElementById('modalDownloadBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadBtnText = document.getElementById('uploadBtnText');
    const fileInput = document.getElementById('fileInput');
    const sortSelect = document.querySelector('.sort-select');
    const downloadAllBtn = document.querySelector('.download-all');
    const uploadBtnInitialHtml = uploadBtn ? uploadBtn.innerHTML : '';
    const uploadProgressBar = document.getElementById('galleryUploadProgress');
    const uploadProgressInner = uploadProgressBar?.querySelector('.gallery-upload-progress__inner');
    const galleryStatusContainer = document.getElementById('galleryStatusContainer');
    const galleryStatusBadge = document.getElementById('galleryStatusBadge');
    const galleryStatusMessage = document.getElementById('galleryStatusMessage');
    const galleryLoader = document.getElementById('galleryLoader');
    const scrollSentinel = document.getElementById('galleryScrollSentinel');
    const photoTab = document.getElementById('photoTab');
    const videoTab = document.getElementById('videoTab');
    let currentPhotoIndex = 0;
    let photos = [];
    let videos = [];
    let currentTab = 'photo'; // 'photo' или 'video'
    let videoPlayCount = 0; // Счетчик воспроизведений видео
    const MAX_VIDEO_PLAYS = 5; // Максимальное количество воспроизведений
    let isAdmin = false;
    let isUploading = false;
    let uploadProgress = 0;
    let currentEventStatus = 'scheduled';
    const ACTIVE_HEARTBEAT_INTERVAL = 15000;
    const MASONRY_MIN_COLUMN_WIDTH = 220;
    const MASONRY_COLUMN_GAP = 8;
    const MASONRY_MOBILE_MAX_WIDTH = 540;
    let activeEventId = null;
    let activeClientId = null;
    let activeHeartbeatTimer = null;
    let visibilityListenerAttached = false;
    const defaultBodyBackground = document.body.style.background;
    let touchStartX = null;
    let touchStartY = null;
    const SWIPE_THRESHOLD = 40;
    let isSwiping = false;
    let swipeDirection = null;

    const PHOTOS_PAGE_SIZE = 20;
    const INITIAL_PHOTOS_COUNT = 50;
    let renderedPhotosCount = 0;
    let isLoadingMorePhotos = false;
    let infiniteObserver = null;
    let masonryRaf = null;
    let resizeDebounce = null;

    // Проверяем, есть ли токен админа
    function checkAdminToken() {
        try {
            const token = localStorage.getItem('adminToken');
            isAdmin = Boolean(token);
        } catch (_) {
            isAdmin = false;
        }
        updateModalLikeDisplay();
    }
    checkAdminToken();

    const GALLERY_STATUS_INFO = {
        scheduled: {
            key: 'scheduled',
            badge: 'Не начато',
            badgeClass: 'gallery-status-badge--scheduled',
            message: '⏳ Мероприятие ещё не началось. Ожидайте начала организатора.',
            disableUpload: true,
            uploadHint: 'Мероприятие ещё не началось. Загрузка недоступна.'
        },
        live: {
            key: 'live',
            badge: 'В эфире',
            badgeClass: 'gallery-status-badge--live',
            message: '🟢 Можно загружать фотографии.',
            disableUpload: false,
            uploadHint: ''
        },
        paused: {
            key: 'paused',
            badge: 'Пауза',
            badgeClass: 'gallery-status-badge--paused',
            message: '⏸ Загрузка фотографий временно недоступна.',
            disableUpload: true,
            uploadHint: 'Мероприятие на паузе. Загрузка временно недоступна.'
        },
        ended: {
            key: 'ended',
            badge: 'Завершено',
            badgeClass: 'gallery-status-badge--ended',
            message: '🏁 Загрузка фотографий больше недоступна.',
            disableUpload: true,
            uploadHint: 'Мероприятие завершено. Загрузка недоступна.'
        }
    };

    function normalizeEventStatus(status) {
        return String(status || 'scheduled').toLowerCase();
    }

    function applyGalleryEventStatus(status) {
        const normalized = normalizeEventStatus(status);
        currentEventStatus = normalized;
        const info = GALLERY_STATUS_INFO[normalized] || GALLERY_STATUS_INFO.scheduled;

        if (galleryStatusBadge) {
            galleryStatusBadge.textContent = info.badge;
            galleryStatusBadge.className = `gallery-status-badge ${info.badgeClass}`;
        }

        if (galleryStatusMessage) {
            if (info.message) {
                galleryStatusMessage.textContent = info.message;
                galleryStatusMessage.classList.remove('is-hidden');
            } else {
                galleryStatusMessage.textContent = '';
                galleryStatusMessage.classList.add('is-hidden');
            }
        }

        if (galleryStatusContainer) {
            const hide = !info.badge && !info.message;
            galleryStatusContainer.classList.toggle('is-hidden', hide);
            galleryStatusContainer.setAttribute('aria-hidden', hide ? 'true' : 'false');
        }

        if (uploadBtn) {
            const shouldDisable = Boolean(info.disableUpload) || Boolean(isUploading);
            uploadBtn.disabled = shouldDisable;
            uploadBtn.setAttribute('aria-disabled', shouldDisable ? 'true' : 'false');
            if (shouldDisable && info.uploadHint) {
                uploadBtn.title = info.uploadHint;
            } else {
                uploadBtn.removeAttribute('title');
            }
        }
    }

    applyGalleryEventStatus(currentEventStatus);

    function updateModalLikeDisplay() {
        if (!modalLikeBtn || !modalLikeCount) return;
        const current = currentTab === 'photo' ? photos[currentPhotoIndex] : videos[currentPhotoIndex];
        if (!current) return;
        modalLikeCount.textContent = current.likes || 0;
    }

    function setUploadProgress(value, show) {
        if (!uploadProgressBar) return;
        uploadProgress = Math.min(Math.max(value, 0), 100);
        if (show) {
            uploadProgressBar.classList.add('is-visible');
            uploadProgressBar.setAttribute('aria-hidden', 'false');
        } else if (uploadProgress === 0) {
            uploadProgressBar.classList.remove('is-visible');
            uploadProgressBar.setAttribute('aria-hidden', 'true');
        }
        if (uploadProgressInner) {
            uploadProgressInner.style.width = `${uploadProgress}%`;
        }
    }

    function finishUploadProgress(success) {
        if (success) {
            setUploadProgress(100, true);
            setTimeout(() => setUploadProgress(0, false), 600);
        } else {
            setUploadProgress(0, true);
            setTimeout(() => setUploadProgress(0, false), 400);
        }
    }

    function showGalleryLoader() {
        if (!galleryLoader) return;
        galleryLoader.classList.add('is-visible');
        galleryLoader.setAttribute('aria-hidden', 'false');
    }

    function hideGalleryLoader() {
        if (!galleryLoader) return;
        galleryLoader.classList.remove('is-visible');
        galleryLoader.setAttribute('aria-hidden', 'true');
    }

    function updateInfiniteScrollState() {
        if (!scrollSentinel) return;
        if (photos.length === 0 || renderedPhotosCount >= photos.length) {
            scrollSentinel.classList.add('is-hidden');
            scrollSentinel.setAttribute('aria-hidden', 'true');
            hideGalleryLoader();
        } else {
            scrollSentinel.classList.remove('is-hidden');
            scrollSentinel.setAttribute('aria-hidden', 'false');
        }
    }

    function loadMorePhotos() {
        if (isLoadingMorePhotos) return;
        if (renderedPhotosCount >= photos.length) {
            updateInfiniteScrollState();
            return;
        }
        isLoadingMorePhotos = true;
        showGalleryLoader();
        requestAnimationFrame(() => {
            renderPhotos(false);
            hideGalleryLoader();
            isLoadingMorePhotos = false;
        });
    }

    function initInfiniteScroll() {
        if (!scrollSentinel) return;
        if (infiniteObserver) {
            infiniteObserver.disconnect();
        }
        infiniteObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    loadMorePhotos();
                }
            });
        }, {
            root: null,
            rootMargin: '0px 0px 200px 0px',
            threshold: 0.01
        });
        infiniteObserver.observe(scrollSentinel);
    }

    function scheduleMasonryLayout(afterLayout) {
        if (!photosGrid || photosGrid.classList.contains('is-empty')) {
            if (photosGrid) photosGrid.style.height = '';
            if (typeof afterLayout === 'function') afterLayout(new Map());
            return;
        }
        if (masonryRaf) cancelAnimationFrame(masonryRaf);
        masonryRaf = requestAnimationFrame(() => {
            masonryRaf = null;
            const positions = layoutMasonry();
            if (typeof afterLayout === 'function') afterLayout(positions);
        });
    }

    function layoutMasonry() {
        if (!photosGrid || photosGrid.classList.contains('is-empty')) {
            if (photosGrid) photosGrid.style.height = '';
            return;
        }
        const items = Array.from(photosGrid.querySelectorAll('.photo-item'));
        if (!items.length) {
            photosGrid.style.height = '';
            return;
        }

        const containerWidth = photosGrid.clientWidth;
        if (!containerWidth) return;

        let columnCount;
        if (containerWidth <= MASONRY_MOBILE_MAX_WIDTH) {
            columnCount = Math.min(3, Math.max(1, photos.length || 1));
            if (photos.length >= 3) {
                columnCount = 3;
            }
        } else {
            columnCount = Math.min(5, Math.max(1, Math.floor((containerWidth + MASONRY_COLUMN_GAP) / (MASONRY_MIN_COLUMN_WIDTH + MASONRY_COLUMN_GAP))));
        }
        const gap = MASONRY_COLUMN_GAP;
        const columnWidths = new Array(columnCount).fill(0);
        const columnPositions = new Array(columnCount).fill(0);
        const columnHeights = new Array(columnCount).fill(0);
        const positionsMap = new Map();

        if (containerWidth <= MASONRY_MOBILE_MAX_WIDTH) {
            const totalGapWidth = gap * Math.max(columnCount - 1, 0);
            const baseWidth = Math.max(1, Math.floor((containerWidth - totalGapWidth) / columnCount));
            let remainder = containerWidth - (baseWidth * columnCount + totalGapWidth);
            let currentX = 0;
            for (let i = 0; i < columnCount; i += 1) {
                const extra = remainder > 0 ? 1 : 0;
                if (remainder > 0) remainder -= 1;
                const width = baseWidth + extra;
                columnWidths[i] = width;
                columnPositions[i] = currentX;
                currentX += width + gap;
            }
        } else {
            const totalGapWidth = gap * Math.max(columnCount - 1, 0);
            const availableWidth = containerWidth - totalGapWidth;
            const widthPerColumn = availableWidth / columnCount;
            let currentX = 0;
            for (let i = 0; i < columnCount; i += 1) {
                columnWidths[i] = widthPerColumn;
                columnPositions[i] = currentX;
                currentX += widthPerColumn + gap;
            }
        }

        items.forEach((item) => {
            let columnIndex = 0;
            let minHeight = columnHeights[0];
            for (let i = 1; i < columnCount; i += 1) {
                if (columnHeights[i] < minHeight) {
                    minHeight = columnHeights[i];
                    columnIndex = i;
                }
            }

            const columnWidth = columnWidths[columnIndex];
            const x = columnPositions[columnIndex];
            const y = columnHeights[columnIndex];

            item.style.width = `${columnWidth}px`;
            item.style.left = `${x}px`;
            item.style.top = `${y}px`;
            item.style.opacity = '1';

            const rect = item.getBoundingClientRect();
            const itemHeight = rect.height || item.offsetHeight;
            columnHeights[columnIndex] = y + itemHeight + gap;
            positionsMap.set(item, { x, y });
        });

        const maxHeight = Math.max(...columnHeights) - gap;
        photosGrid.style.height = `${Math.max(maxHeight, 0)}px`;
        updateInfiniteScrollState();
        return positionsMap;
    }

    function uploadPhotosWithProgress(url, formData) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);

            xhr.upload.onprogress = (event) => {
                if (!event.lengthComputable) return;
                const percent = (event.loaded / event.total) * 100;
                setUploadProgress(percent, true);
            };

            xhr.onreadystatechange = () => {
                if (xhr.readyState !== XMLHttpRequest.DONE) return;
                const status = xhr.status;
                if (status >= 200 && status < 300) {
                    let responseData = null;
                    try {
                        responseData = xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText || '{}');
                    } catch (_) {
                        responseData = null;
                    }
                    resolve(responseData);
                } else {
                    let errorMessage = 'Не удалось загрузить фото';
                    try {
                        const errorData = JSON.parse(xhr.responseText || '{}');
                        if (errorData?.error) {
                            errorMessage = errorData.error;
                        }
                    } catch (_) {}
                    reject(new Error(errorMessage));
                }
            };

            xhr.onerror = () => {
                reject(new Error('Ошибка сети при загрузке фото'));
            };

            xhr.send(formData);
        });
    }

    function clearShareLinks() {
        if (!shareButtonsContainer) return;
        shareButtonsContainer.querySelectorAll('.share-btn').forEach(btn => {
            btn.removeAttribute('data-share-url');
        });
        closeShareMenu();
    }

    function openShareMenu() {
        if (!shareButtonsContainer) return;
        shareButtonsContainer.hidden = false;
    }

    function closeShareMenu() {
        if (!shareButtonsContainer) return;
        shareButtonsContainer.hidden = true;
    }

    setUploadProgress(0, false);

    function updateShareButtons(photo) {
        if (!shareButtonsContainer || !photo) return;
        const shareUrl = photo.url || photo.originalUrl || '';
        const pageUrl = `${window.location.origin}/gallery.html?event=${encodeURIComponent(getEventIdFromLocation() || '')}`;
        const caption = `Посмотрите фото события: ${pageUrl}`;
        closeShareMenu();
        shareButtonsContainer.querySelectorAll('.share-btn').forEach(btn => {
            const target = btn.dataset.shareTarget;
            let url = '';
            if (target === 'instagram') {
                url = `https://www.instagram.com/?url=${encodeURIComponent(shareUrl)}`;
            } else if (target === 'tiktok') {
                url = `https://www.tiktok.com/share?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(caption)}`;
            } else if (target === 'whatsapp') {
                // Используем прямой URL к изображению - WhatsApp автоматически предпросмотрит его
                url = `https://api.whatsapp.com/send?text=${encodeURIComponent(caption + '\n\n' + shareUrl)}`;
            } else if (target === 'telegram') {
                url = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(caption)}`;
            }
            btn.dataset.shareUrl = url;
            // Сохраняем URL изображения для Web Share API
            btn.dataset.shareImageUrl = shareUrl;
        });
    }

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

    function applyGalleryBranding(color, backgroundUrl) {
        // На странице галереи применяем только цвет из "Цветовая схема"
        // Загруженный фон (backgroundUrl) игнорируется и применяется только на QR странице
        document.body.classList.remove('has-branding-color', 'has-branding-image');
        if (color && color.trim()) {
            document.body.classList.add('has-branding-color');
            document.body.style.background = color.trim();
        } else {
            document.body.style.background = defaultBodyBackground;
        }
    }

    function getActiveClientStorageKey(eventId) {
        return `galleryActiveClient:${eventId}`;
    }

    function generateClientId() {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function getOrCreateActiveClientId(eventId) {
        const key = getActiveClientStorageKey(eventId);
        try {
            let stored = sessionStorage.getItem(key);
            if (!stored) {
                stored = `${eventId}-${generateClientId()}`;
                sessionStorage.setItem(key, stored);
            }
            return stored;
        } catch (_) {
            return `${eventId}-${generateClientId()}`;
        }
    }

    function sendActiveHeartbeat() {
        if (!activeEventId || !activeClientId) return;
        fetch(`${API_CONFIG.baseUrl}/events/${encodeURIComponent(activeEventId)}/active`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId: activeClientId })
        }).catch(() => {});
    }

    function sendActiveLeave() {
        if (!activeEventId || !activeClientId) return;
        const url = `${API_CONFIG.baseUrl}/events/${encodeURIComponent(activeEventId)}/active/leave`;
        const payload = JSON.stringify({ clientId: activeClientId });
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon(url, blob);
        } else {
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            }).catch(() => {});
        }
    }

    function stopActiveTracking(sendLeave = false) {
        if (activeHeartbeatTimer) {
            clearInterval(activeHeartbeatTimer);
            activeHeartbeatTimer = null;
        }
        if (sendLeave) {
            sendActiveLeave();
        }
    }

    function handleVisibilityChange() {
        if (document.visibilityState === 'hidden') {
            stopActiveTracking(true);
        } else if (document.visibilityState === 'visible' && activeEventId) {
            startActiveTracking(activeEventId);
        }
    }

    function startActiveTracking(eventId) {
        if (!eventId) return;
        activeEventId = eventId;
        activeClientId = getOrCreateActiveClientId(eventId);
        stopActiveTracking(false);
        sendActiveHeartbeat();
        activeHeartbeatTimer = setInterval(sendActiveHeartbeat, ACTIVE_HEARTBEAT_INTERVAL);
        if (!visibilityListenerAttached) {
            document.addEventListener('visibilitychange', handleVisibilityChange);
            window.addEventListener('pagehide', () => stopActiveTracking(true), { once: false });
            visibilityListenerAttached = true;
        }
    }

    window.addEventListener('beforeunload', () => {
        stopActiveTracking(true);
    });

    // Переключение вкладок
    function switchTab(tab) {
        currentTab = tab;
        
        // Обновляем активную вкладку
        if (photoTab && videoTab) {
            photoTab.classList.toggle('active', tab === 'photo');
            videoTab.classList.toggle('active', tab === 'video');
        }
        
        // Показываем/скрываем соответствующие контейнеры
        if (photosGrid && videosGrid) {
            photosGrid.style.display = tab === 'photo' ? '' : 'none';
            videosGrid.style.display = tab === 'video' ? '' : 'none';
        }
        
        // Обновляем текст кнопки загрузки
        if (uploadBtnText) {
            uploadBtnText.textContent = tab === 'photo' ? 'Загрузить фото' : 'Загрузить видео';
        }
        
        // Загружаем данные для выбранной вкладки
        if (tab === 'photo') {
            if (photos.length === 0) {
                loadPhotos();
            } else {
                renderPhotos(true);
            }
        } else {
            if (videos.length === 0) {
                loadVideos();
            } else {
                renderVideos();
            }
        }
    }
    
    if (photoTab) {
        photoTab.addEventListener('click', () => switchTab('photo'));
    }
    if (videoTab) {
        videoTab.addEventListener('click', () => switchTab('video'));
    }

    async function loadPhotos() {
        const eventId = getEventIdFromLocation();
        if (!eventId) return;
        try {
            const res = await fetch(`${API_CONFIG.baseUrl}/photos/event/${encodeURIComponent(eventId)}?sort=likes&media_type=photo`);
            const data = await res.json();
            const apiOrigin = API_CONFIG.baseUrl.replace(/\/api\/?$/, '');
            function toAbsoluteUrl(u) {
                if (!u) return '';
                if (/^https?:\/\//i.test(u)) return u;
                const path = String(u).startsWith('/') ? u : `/${u}`;
                return `${apiOrigin}${path}`;
            }
            photos = (Array.isArray(data) ? data : []).map(p => {
                const previewUrl = toAbsoluteUrl(p.preview_url || p.url || p.filename);
                const originalUrl = toAbsoluteUrl(p.url || p.filename);
                return {
                    id: p.id,
                    url: previewUrl,
                    originalUrl,
                    date: p.uploaded_at,
                    likes: p.likes || 0,
                    original_name: p.original_name
                };
            });
            renderedPhotosCount = 0;
            const currentSort = sortSelect?.value || 'newest';
            sortPhotos(currentSort);
            renderPhotos();
        } catch (_) {
            // noop
        }
    }

    async function loadVideos() {
        const eventId = getEventIdFromLocation();
        if (!eventId) return;
        try {
            const res = await fetch(`${API_CONFIG.baseUrl}/photos/event/${encodeURIComponent(eventId)}?sort=likes&media_type=video`);
            const data = await res.json();
            const apiOrigin = API_CONFIG.baseUrl.replace(/\/api\/?$/, '');
            function toAbsoluteUrl(u) {
                if (!u) return '';
                if (/^https?:\/\//i.test(u)) return u;
                const path = String(u).startsWith('/') ? u : `/${u}`;
                return `${apiOrigin}${path}`;
            }
            videos = (Array.isArray(data) ? data : []).map(v => {
                const url = toAbsoluteUrl(v.url || v.filename);
                return {
                    id: v.id,
                    url: url,
                    date: v.uploaded_at,
                    likes: v.likes || 0,
                    original_name: v.original_name
                };
            });
            renderVideos();
        } catch (_) {
            // noop
        }
    }

    function renderVideos() {
        if (!videosGrid) return;
        videosGrid.innerHTML = '';
        
        if (videos.length === 0) {
            videosGrid.classList.add('is-empty');
            videosGrid.innerHTML = `
                <div class="empty-gallery" role="status">
                    <div class="empty-emoji" aria-hidden="true">😢</div>
                    <h2 class="empty-title">Тут пока нет ни одного видео</h2>
                    <p class="empty-subtitle">Стань первым, кто загрузит свое видео!</p>
                </div>
            `;
            return;
        }
        
        videosGrid.classList.remove('is-empty');
        
        videos.forEach((video, index) => {
            const videoItem = document.createElement('div');
            videoItem.className = 'video-item';
            videoItem.dataset.videoId = video.id;
            videoItem.dataset.videoIndex = index;
            
            const videoEl = document.createElement('video');
            videoEl.src = video.url;
            videoEl.preload = 'metadata';
            videoEl.muted = true;
            videoEl.setAttribute('playsinline', 'true');
            videoEl.setAttribute('webkit-playsinline', 'true');
            
            const overlay = document.createElement('div');
            overlay.className = 'video-overlay';
            
            const playIcon = document.createElement('div');
            playIcon.className = 'play-icon';
            playIcon.innerHTML = '<i class="fas fa-play"></i>';
            overlay.appendChild(playIcon);
            
            const likesEl = document.createElement('div');
            likesEl.className = 'video-likes';
            likesEl.innerHTML = `<i class="fas fa-heart"></i> ${video.likes || 0}`;
            
            videoItem.appendChild(videoEl);
            videoItem.appendChild(overlay);
            videoItem.appendChild(likesEl);
            
            // Добавляем кнопку удаления для админов
            if (isAdmin) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-video-btn';
                deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
                deleteBtn.title = 'Удалить видео';
                deleteBtn.onclick = (e) => {
                    e.stopPropagation(); // Предотвращаем открытие модального окна
                    deleteVideo(video.id, index);
                };
                videoItem.appendChild(deleteBtn);
            }
            
            videoItem.addEventListener('click', () => {
                openVideoModal(video);
            });
            
            videosGrid.appendChild(videoItem);
        });
    }

    function openVideoModal(video) {
        if (!modal || !modalVideo) return;
        
        // Сбрасываем счетчик воспроизведений при открытии нового видео
        videoPlayCount = 0;
        
        // Скрываем изображение, показываем видео
        if (modalImage) modalImage.style.display = 'none';
        modalVideo.style.display = 'block';
        
        modalVideo.src = video.url;
        modalVideo.loop = false; // Отключаем стандартный loop
        modalVideo.setAttribute('playsinline', 'true');
        modalVideo.setAttribute('webkit-playsinline', 'true');
        modalVideo.load();
        
        // Удаляем старые обработчики события ended, если они есть
        modalVideo.removeEventListener('ended', handleVideoEnd);
        
        // Добавляем обработчик окончания видео
        modalVideo.addEventListener('ended', handleVideoEnd);
        
        // Обновляем счетчик лайков
        if (modalLikeCount) {
            modalLikeCount.textContent = video.likes || 0;
        }
        
        // Обновляем индекс для навигации
        currentPhotoIndex = videos.findIndex(v => v.id === video.id);
        
        modal.style.display = 'block';
        modal.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        
        // Обновляем кнопки навигации
        if (navPrev) {
            navPrev.style.display = currentPhotoIndex > 0 ? 'block' : 'none';
        }
        if (navNext) {
            navNext.style.display = currentPhotoIndex < videos.length - 1 ? 'block' : 'none';
        }
        
        // Воспроизводим видео
        modalVideo.play().catch(() => {
            // Игнорируем ошибки автовоспроизведения
        });
    }
    
    function handleVideoEnd() {
        if (!modalVideo) return;
        
        videoPlayCount++;
        
        if (videoPlayCount < MAX_VIDEO_PLAYS) {
            // Перезапускаем видео
            modalVideo.currentTime = 0;
            modalVideo.play().catch(() => {
                // Игнорируем ошибки автовоспроизведения
            });
        } else {
            // После 5 воспроизведений останавливаем видео
            modalVideo.pause();
            videoPlayCount = 0; // Сбрасываем счетчик
        }
    }

    // Функции для работы с паролем
    function getPasswordAuthKey(eventId) {
        return `galleryPasswordAuth:${eventId}`;
    }

    function isPasswordAuthorized(eventId) {
        const key = getPasswordAuthKey(eventId);
        try {
            const stored = sessionStorage.getItem(key);
            if (!stored) return false;
            const { timestamp } = JSON.parse(stored);
            const now = Date.now();
            const threeHours = 3 * 60 * 60 * 1000; // 3 часа в миллисекундах
            return (now - timestamp) < threeHours;
        } catch (_) {
            return false;
        }
    }

    function savePasswordAuth(eventId) {
        const key = getPasswordAuthKey(eventId);
        try {
            sessionStorage.setItem(key, JSON.stringify({ timestamp: Date.now() }));
        } catch (_) {
            // Игнорируем ошибки
        }
    }

    function showPasswordModal() {
        const passwordModal = document.getElementById('passwordModal');
        if (passwordModal) {
            passwordModal.style.display = 'flex';
            const passwordInput = document.getElementById('passwordInput');
            if (passwordInput) {
                passwordInput.focus();
            }
        }
    }

    function hidePasswordModal() {
        const passwordModal = document.getElementById('passwordModal');
        if (passwordModal) {
            passwordModal.style.display = 'none';
        }
    }

    async function checkPassword(eventId, password) {
        try {
            const res = await fetch(`${API_CONFIG.baseUrl}/events/${encodeURIComponent(eventId)}/check-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                savePasswordAuth(eventId);
                hidePasswordModal();
                return true;
            } else {
                const errorDiv = document.getElementById('passwordError');
                if (errorDiv) {
                    errorDiv.textContent = data.error || 'Неверный пароль';
                    errorDiv.style.display = 'block';
                }
                return false;
            }
        } catch (error) {
            const errorDiv = document.getElementById('passwordError');
            if (errorDiv) {
                errorDiv.textContent = 'Ошибка при проверке пароля';
                errorDiv.style.display = 'block';
            }
            return false;
        }
    }

    async function loadEventHeader() {
        const eventId = getEventIdFromLocation();
        if (!eventId) return;
        applyGalleryBranding(null, null);
        try {
            const res = await fetch(`${API_CONFIG.baseUrl}/events/${encodeURIComponent(eventId)}`);
            if (!res.ok) {
                applyGalleryEventStatus('scheduled');
                return;
            }
            const evt = await res.json();
            
            // Проверяем, требуется ли пароль
            if (evt.view_access === 'private') {
                if (!isPasswordAuthorized(eventId)) {
                    showPasswordModal();
                    return; // Не загружаем галерею до ввода пароля
                }
            }
            if (headerTitle) {
                headerTitle.textContent = evt?.name ? evt.name : `Событие #${eventId}`;
            }
            if (headerDate) {
                if (evt?.scheduled_start_at) {
                    const start = new Date(evt.scheduled_start_at);
                    if (!Number.isNaN(start.getTime())) {
                        // На странице галереи показываем только дату, без времени
                        headerDate.textContent = start.toLocaleDateString('ru-RU', {
                            day: '2-digit',
                            month: 'long',
                            year: 'numeric'
                        });
                    } else if (evt?.date) {
                        headerDate.textContent = new Date(evt.date).toLocaleDateString('ru-RU');
                    } else {
                        headerDate.textContent = '';
                    }
                } else if (evt?.date) {
                    headerDate.textContent = new Date(evt.date).toLocaleDateString('ru-RU');
                } else {
                    headerDate.textContent = '';
                }
            }
            applyGalleryEventStatus(evt?.status);
            applyGalleryBranding(evt?.branding_color, evt?.branding_background_url);
        } catch (_) {
            if (headerTitle) headerTitle.textContent = `Событие #${eventId}`;
            if (headerDate) headerDate.textContent = '';
            applyGalleryBranding(null, null);
            applyGalleryEventStatus('scheduled');
        }
    }

    function renderPhotos(reset = true) {
        if (!photosGrid) return;

        let previousRendered = renderedPhotosCount;
        if (reset) {
            hideGalleryLoader();
            previousRendered = renderedPhotosCount;
            renderedPhotosCount = 0;
            photosGrid.innerHTML = '';
            photosGrid.classList.remove('is-empty');
            photosGrid.style.height = '0px';
        }

        if (photos.length === 0) {
            renderedPhotosCount = 0;
            photosGrid.classList.add('is-empty');
            photosGrid.style.height = 'auto';
            photosGrid.innerHTML = `
                <div class="empty-gallery" role="status">
                    <div class="empty-emoji" aria-hidden="true">😢</div>
                    <h2 class="empty-title">Тут пока нет ни одной фотографии</h2>
                    <p class="empty-subtitle">Стань первым, кто загрузит свою фотографию!</p>
                </div>
            `;
            updateInfiniteScrollState();
            scheduleMasonryLayout();
            return;
        }

        photosGrid.classList.remove('is-empty');

        const startIndex = renderedPhotosCount;
        const baseTarget = reset
            ? Math.max(INITIAL_PHOTOS_COUNT, previousRendered || INITIAL_PHOTOS_COUNT)
            : renderedPhotosCount + PHOTOS_PAGE_SIZE;
        const targetCount = Math.min(photos.length, baseTarget);

        if (startIndex >= targetCount) {
            updateInfiniteScrollState();
            scheduleMasonryLayout();
            return;
        }

        const slice = photos.slice(startIndex, targetCount);
        const markup = slice.map((photo, offset) => {
            const actualIndex = startIndex + offset;
            return `
                <div class="photo-item" data-index="${actualIndex}">
                    <div class="photo-image-wrapper" onclick="openPhoto(${actualIndex})">
                        <img src="${photo.url}" alt="Фото ${actualIndex + 1}" loading="lazy">
                        <div class="photo-overlay"></div>
                    </div>
                    <div class="photo-likes">
                        <i class="fas fa-heart"></i> ${photo.likes || 0}
                    </div>
                    ${isAdmin ? `<div class="photo-actions"><button class="delete-photo-btn" onclick="deletePhoto(${photo.id}, ${actualIndex})" title="Удалить фото"><i class="fas fa-trash"></i></button></div>` : ''}
                </div>
            `;
        }).join('');

        if (markup) {
            const fragment = document.createElement('div');
            fragment.innerHTML = markup;
            const newItems = Array.from(fragment.children);

            newItems.forEach((item) => {
                const img = item.querySelector('img');
                if (img && !(img.complete && img.naturalWidth !== 0)) {
                    img.addEventListener('load', () => scheduleMasonryLayout(), { once: true });
                    img.addEventListener('error', (e) => {
                        // If preview fails to load, try original
                        const photoIndex = parseInt(item.dataset.index);
                        const photo = photos[photoIndex];
                        if (photo && photo.originalUrl && img.src !== photo.originalUrl) {
                            img.src = photo.originalUrl;
                        } else {
                            scheduleMasonryLayout();
                        }
                    }, { once: true });
                }
            });

            while (fragment.firstChild) {
                photosGrid.appendChild(fragment.firstChild);
            }
        }

        renderedPhotosCount = targetCount;
        updateInfiniteScrollState();
        scheduleMasonryLayout();
    }

    window.openPhoto = (index) => {
        currentPhotoIndex = index;
        const photo = photos[index];
        if (!photo) return;
        
        // Скрываем видео, показываем изображение
        if (modalVideo) {
            modalVideo.pause();
            modalVideo.src = '';
            modalVideo.style.display = 'none';
        }
        if (modalImage) {
            modalImage.src = photo.originalUrl || photo.url;
            modalImage.style.display = 'block';
        }
        
        if (modal) {
            modal.style.display = 'block';
            modal.classList.add('is-open');
        }
        document.body.style.overflow = 'hidden';
        
        // Обновляем кнопки навигации
        if (navPrev) {
            navPrev.style.display = currentPhotoIndex > 0 ? 'block' : 'none';
        }
        if (navNext) {
            navNext.style.display = currentPhotoIndex < photos.length - 1 ? 'block' : 'none';
        }
        
        updateModalLikeDisplay();
        updateShareButtons(photos[index]);
    };

    // Навигация по фото/видео
    const navPrev = document.querySelector('.nav-prev');
    const navNext = document.querySelector('.nav-next');
    
    if (navPrev) {
        navPrev.onclick = () => {
            if (currentTab === 'photo') {
                if (currentPhotoIndex > 0) {
                    openPhoto(currentPhotoIndex - 1);
                }
            } else {
                if (currentPhotoIndex > 0) {
                    openVideoModal(videos[currentPhotoIndex - 1]);
                }
            }
        };
    }
    
    if (navNext) {
        navNext.onclick = () => {
            if (currentTab === 'photo') {
                if (currentPhotoIndex < photos.length - 1) {
                    openPhoto(currentPhotoIndex + 1);
                }
            } else {
                if (currentPhotoIndex < videos.length - 1) {
                    openVideoModal(videos[currentPhotoIndex + 1]);
                }
            }
        };
    }

    // Закрытие модального окна
    const closeModalBtn = document.querySelector('.close-modal');
    if (closeModalBtn) {
        closeModalBtn.onclick = () => {
            if (modalVideo) {
                modalVideo.pause();
                modalVideo.src = '';
            }
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('is-open');
            }
            document.body.style.overflow = '';
            clearShareLinks();
        };
    }

    // Закрытие при клике вне изображения/видео
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                if (modalVideo) {
                    modalVideo.pause();
                    modalVideo.src = '';
                }
                modal.style.display = 'none';
                modal.classList.remove('is-open');
                document.body.style.overflow = '';
                clearShareLinks();
            }
        });
    }

    if (shareButtonsContainer) {
        shareButtonsContainer.addEventListener('click', async (e) => {
            const btn = e.target.closest('.share-btn');
            if (!btn) return;
            const target = btn.dataset.shareTarget;
            const shareUrl = btn.dataset.shareUrl;
            const imageUrl = btn.dataset.shareImageUrl;
            
            // Для WhatsApp на мобильных устройствах используем Web Share API для отправки изображения
            if (target === 'whatsapp' && navigator.share && imageUrl) {
                try {
                    // Загружаем изображение как blob для Web Share API
                    const response = await fetch(imageUrl);
                    const blob = await response.blob();
                    const file = new File([blob], 'photo.jpg', { type: blob.type });
                    
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: 'Фото из галереи события',
                            text: 'Посмотрите это фото!'
                        });
                        closeShareMenu();
                        return;
                    }
                } catch (shareError) {
                    // Если Web Share API не сработал, используем обычный способ
                    console.log('Web Share API не доступен, используем обычный способ:', shareError);
                }
            }
            
            // Обычный способ - открываем URL
            if (shareUrl) {
                window.open(shareUrl, '_blank', 'noopener');
            }
            closeShareMenu();
        });
    }

    if (shareToggleBtn) {
        shareToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!shareButtonsContainer) return;
            if (shareButtonsContainer.hidden) {
                openShareMenu();
            } else {
                closeShareMenu();
            }
        });
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (currentTab === 'photo') {
                const photo = photos[currentPhotoIndex];
                const src = photo?.originalUrl || photo?.url;
                if (!src) return;
                const link = document.createElement('a');
                link.href = src;
                const filename = photo.original_name || `photo-${photo.id || currentPhotoIndex + 1}.jpg`;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                const video = videos[currentPhotoIndex];
                const src = video?.url;
                if (!src) return;
                const link = document.createElement('a');
                link.href = src;
                const filename = video.original_name || `video-${video.id || currentPhotoIndex + 1}.mp4`;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (!shareButtonsContainer || shareButtonsContainer.hidden) return;
        if (!e.target.closest('.modal-share-wrapper')) {
            closeShareMenu();
        }
    });

    modal.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isSwiping = true;
        swipeDirection = null;
    }, { passive: true });

    modal.addEventListener('touchend', (e) => {
        if (touchStartX === null || touchStartY === null) return;
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;

        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > SWIPE_THRESHOLD) {
            if (currentTab === 'photo') {
                if (diffX < 0 && currentPhotoIndex < photos.length - 1) {
                    swipeDirection = 'left';
                    animateSwipe('left', () => openPhoto(currentPhotoIndex + 1));
                } else if (diffX > 0 && currentPhotoIndex > 0) {
                    swipeDirection = 'right';
                    animateSwipe('right', () => openPhoto(currentPhotoIndex - 1));
                }
            } else {
                if (diffX < 0 && currentPhotoIndex < videos.length - 1) {
                    swipeDirection = 'left';
                    animateSwipe('left', () => openVideoModal(videos[currentPhotoIndex + 1]));
                } else if (diffX > 0 && currentPhotoIndex > 0) {
                    swipeDirection = 'right';
                    animateSwipe('right', () => openVideoModal(videos[currentPhotoIndex - 1]));
                }
            }
        }
        touchStartX = null;
        touchStartY = null;
        isSwiping = false;
    }, { passive: true });

    function animateSwipe(direction, callback) {
        if (!modal) return;
        modal.classList.remove('swipe-left', 'swipe-right', 'swipe-reset');
        if (direction === 'left') {
            modal.classList.add('swipe-left');
        } else if (direction === 'right') {
            modal.classList.add('swipe-right');
        }
        setTimeout(() => {
            if (typeof callback === 'function') {
                callback();
            }
            modal.classList.remove('swipe-left', 'swipe-right');
            modal.classList.add('swipe-reset');
            setTimeout(() => {
                modal.classList.remove('swipe-reset');
            }, 180);
        }, 160);
    }

    // Сортировка
    function sortPhotos(sortType) {
        photos.sort((a, b) => {
            if (sortType === 'mostLiked') {
                const likeDiff = (b.likes || 0) - (a.likes || 0);
                if (likeDiff !== 0) return likeDiff;
                return new Date(b.date) - new Date(a.date);
            }
            if (sortType === 'oldest') {
                return new Date(a.date) - new Date(b.date);
            }
            // newest by default
            return new Date(b.date) - new Date(a.date);
        });
    }

    function validateFiles(fileList) {
        const files = Array.from(fileList || []);
        const valid = [];
        const rejected = [];
        const maxSize = currentTab === 'video' ? 100 * 1024 * 1024 : 10 * 1024 * 1024; // 100MB для видео, 10MB для фото
        const allowedTypes = currentTab === 'video' 
            ? ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo']
            : ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        
        files.forEach(file => {
            const isImage = file.type.startsWith('image/');
            const isVideo = file.type.startsWith('video/');
            
            if (currentTab === 'photo' && !isImage) {
                rejected.push(`${file.name} — не изображение`);
                return;
            }
            if (currentTab === 'video' && !isVideo) {
                rejected.push(`${file.name} — не видео`);
                return;
            }
            if (!allowedTypes.includes(file.type)) {
                rejected.push(`${file.name} — неподдерживаемый формат`);
                return;
            }
            if (file.size > maxSize) {
                const maxSizeMB = Math.round(maxSize / (1024 * 1024));
                rejected.push(`${file.name} — больше ${maxSizeMB} МБ`);
                return;
            }
            valid.push(file);
        });
        return { valid, rejected };
    }

    function triggerFileSelection() {
        if (isUploading || uploadBtn?.disabled) return;
        fileInput?.click();
    }

    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', triggerFileSelection);

        fileInput.addEventListener('change', async (e) => {
            const { valid, rejected } = validateFiles(e.target?.files);
            fileInput.value = '';

            if (rejected.length) {
                alert(`Некоторые файлы не будут загружены:\n${rejected.join('\n')}`);
            }
            if (valid.length === 0) {
                return;
            }

            const mediaType = currentTab === 'photo' ? 'фотографий' : 'видео';
            const confirmed = confirm(`Подтверждаете согласие на обработку выбранных ${mediaType}?`);
            if (!confirmed) {
                return;
            }

            const eventId = getEventIdFromLocation();
            if (!eventId) {
                alert('Не удалось определить событие');
                return;
            }

            isUploading = true;
            setUploadProgress(0, true);
            uploadBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Загрузка...';
            applyGalleryEventStatus(currentEventStatus);

            try {
                const form = new FormData();
                valid.forEach(file => form.append('photos', file));

                await uploadPhotosWithProgress(
                    `${API_CONFIG.baseUrl}/photos/upload?event=${encodeURIComponent(eventId)}`,
                    form
                );

                finishUploadProgress(true);

                // Проверяем, требуется ли модерация для этого события
                let requiresModeration = false;
                try {
                    const eventRes = await fetch(`${API_CONFIG.baseUrl}/events/${encodeURIComponent(eventId)}`);
                    if (eventRes.ok) {
                        const eventData = await eventRes.json();
                        requiresModeration = Boolean(eventData.require_moderation);
                        if (eventData?.status) {
                            applyGalleryEventStatus(eventData.status);
                        }
                    }
                } catch (_) {}

                if (requiresModeration) {
                    const mediaType = currentTab === 'photo' ? 'Фото' : 'Видео';
                    alert(`${mediaType} успешно загружены! Они находятся на модерации и появятся в галерее после одобрения администратором.`);
                } else {
                    const mediaType = currentTab === 'photo' ? 'Фото' : 'Видео';
                    alert(`${mediaType} успешно загружены! После обработки они появятся в галерее.`);
                }
                if (currentTab === 'photo') {
                    await loadPhotos();
                } else {
                    await loadVideos();
                }
            } catch (err) {
                alert(`Ошибка загрузки: ${err.message || err}`);
                finishUploadProgress(false);
            } finally {
                isUploading = false;
                uploadBtn.innerHTML = uploadBtnInitialHtml;
                applyGalleryEventStatus(currentEventStatus);
            }
        });
    }

    if (sortSelect) {
        sortSelect.value = sortSelect.value || 'newest';
        sortSelect.addEventListener('change', (e) => {
            sortPhotos(e.target.value);
            renderPhotos();
            updateModalLikeDisplay();
        });
    }

    if (modalLikeBtn) {
        modalLikeBtn.addEventListener('click', () => {
            window.likePhoto(null, currentPhotoIndex, { fromModal: true });
        });
    }

    // Загрузка всех фото
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', () => {
        const eventId = getEventIdFromLocation();
        if (!eventId) {
            alert('Не удалось определить событие');
            return;
        }
        if (photos.length === 0) {
            alert('Нет ни одной фотографии для скачивания');
            return;
        }
        const downloadUrl = `${API_CONFIG.baseUrl}/photos/event/${encodeURIComponent(eventId)}/download`;
        window.location.href = downloadUrl;
        });
    }

    // Функция удаления фото (только для админа)
    window.deletePhoto = async (photoId, index) => {
        if (!confirm('Удалить эту фотографию? Это действие необратимо.')) return;
        
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                alert('Требуется авторизация администратора');
                return;
            }

            const res = await fetch(`${API_CONFIG.baseUrl}/photos/${photoId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Не удалось удалить фото');
            }

            // Удаляем фото из локального массива и перерисовываем
            photos.splice(index, 1);
            renderPhotos();
        } catch (err) {
            alert('Ошибка при удалении: ' + err.message);
        }
    };

    // Функция удаления видео (только для админа)
    window.deleteVideo = async (videoId, index) => {
        if (!confirm('Удалить это видео? Это действие необратимо.')) return;
        
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                alert('Требуется авторизация администратора');
                return;
            }

            const res = await fetch(`${API_CONFIG.baseUrl}/photos/${videoId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Не удалось удалить видео');
            }

            // Удаляем видео из локального массива и перерисовываем
            videos.splice(index, 1);
            renderVideos();
            
            // Если модальное окно открыто с этим видео, закрываем его
            if (modal && modal.style.display === 'block' && modalVideo && modalVideo.style.display !== 'none') {
                const currentVideo = videos[currentPhotoIndex];
                if (!currentVideo || currentVideo.id === videoId) {
                    modal.style.display = 'none';
                    modal.classList.remove('is-open');
                    document.body.style.overflow = '';
                    if (modalVideo) {
                        modalVideo.pause();
                        modalVideo.src = '';
                    }
                }
            }
        } catch (err) {
            alert('Ошибка при удалении: ' + err.message);
        }
    };

    window.likePhoto = async (event, index, options = {}) => {
        if (event?.stopPropagation) event.stopPropagation();
        if (event?.preventDefault) event.preventDefault();
        
        // Определяем, работаем ли мы с фото или видео
        const isVideo = currentTab === 'video';
        const mediaArray = isVideo ? videos : photos;
        const mediaItem = mediaArray[index];
        
        if (!mediaItem) return;

        // Сохраняем состояние воспроизведения видео, если оно открыто
        let wasPlaying = false;
        let currentTime = 0;
        if (isVideo && modalVideo && modalVideo.style.display !== 'none') {
            wasPlaying = !modalVideo.paused;
            currentTime = modalVideo.currentTime;
        }

        try {
            const res = await fetch(`${API_CONFIG.baseUrl}/photos/${mediaItem.id}/like`, {
                method: 'POST'
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Не удалось поставить лайк');
            }
            const data = await res.json();
            const newLikes = data.likes ?? ((mediaItem.likes || 0) + 1);
            mediaArray[index].likes = newLikes;

            // Обновляем только счетчик лайков в модальном окне, без перерисовки всего контента
            if (options.fromModal || (modal && modal.style.display === 'block')) {
                updateModalLikeDisplay();
                
                // Если это видео и оно было открыто, восстанавливаем воспроизведение
                if (isVideo && modalVideo && modalVideo.style.display !== 'none') {
                    if (wasPlaying) {
                        modalVideo.currentTime = currentTime;
                        modalVideo.play().catch(() => {
                            // Игнорируем ошибки автовоспроизведения
                        });
                    }
                }
            }
            
            // Обновляем счетчик лайков в галерее (только для текущего элемента, без перерисовки)
            if (!isVideo) {
                // Для фото обновляем только если не в модальном окне
                if (!options.fromModal) {
                    const photoItem = photosGrid?.querySelector(`[data-index="${index}"]`);
                    if (photoItem) {
                        const likesEl = photoItem.querySelector('.photo-likes');
                        if (likesEl) {
                            likesEl.innerHTML = `<i class="fas fa-heart"></i> ${newLikes}`;
                        }
                    }
                }
            } else {
                // Для видео обновляем счетчик в галерее
                const videoItem = videosGrid?.querySelector(`[data-video-id="${mediaItem.id}"]`);
                if (videoItem) {
                    const likesEl = videoItem.querySelector('.video-likes');
                    if (likesEl) {
                        likesEl.innerHTML = `<i class="fas fa-heart"></i> ${newLikes}`;
                    }
                }
            }
        } catch (err) {
            alert('Ошибка: ' + err.message);
        }
    };

    window.addEventListener('resize', () => {
        clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(() => {
            scheduleMasonryLayout();
        }, 150);
    });

    window.addEventListener('orientationchange', () => {
        scheduleMasonryLayout();
    });

    // Обработчик формы ввода пароля
    const passwordForm = document.getElementById('passwordForm');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const eventId = getEventIdFromLocation();
            if (!eventId) return;
            const passwordInput = document.getElementById('passwordInput');
            const password = passwordInput?.value || '';
            if (!password) return;
            
            const errorDiv = document.getElementById('passwordError');
            if (errorDiv) {
                errorDiv.style.display = 'none';
            }
            
            const success = await checkPassword(eventId, password);
            if (success) {
                // Перезагружаем событие и галерею после успешной авторизации
                loadEventHeader();
                loadPhotos();
                const initialEventId = getEventIdFromLocation();
                if (initialEventId) {
                    startActiveTracking(initialEventId);
                }
            } else {
                if (passwordInput) {
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            }
        });
    }

    initInfiniteScroll();
    loadEventHeader();
    loadPhotos();

    const initialEventId = getEventIdFromLocation();
    if (initialEventId) {
        startActiveTracking(initialEventId);
    }
});
