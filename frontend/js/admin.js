// uses global API_CONFIG from config.js

let moderationModal = null;
let moderationModalImage = null;
let uploadsChart = null;
let uploadsChartCtx = null;

const moderationState = {
    events: [],
    currentEventId: null,
    photos: [],
    selected: new Set(),
    pendingCounts: {},
    totalPending: 0
};

let ACTIVE_USERS_POLL_INTERVAL = 12_000;
let SESSION_REFRESH_INTERVAL_MS = 30_000;
let IDLE_TIMEOUT_MS = 60_000;
let TOKEN_REFRESH_THRESHOLD_MS = 40_000;
let FORCE_REFRESH_THRESHOLD_MS = 45_000;
const REFRESH_DEBOUNCE_MS = 10_000;
const MIN_IDLE_TIMEOUT_MS = 10_000;
const MIN_REFRESH_INTERVAL_MS = 15_000;
const MAX_REFRESH_INTERVAL_MS = 5 * 60_000;

let activeUsersPollTimer = null;
let brandingPreviewObjectUrl = null;
let brandingLogoPreviewObjectUrl = null;
let idleTimerId = null;
let refreshTimerId = null;
let lastActivityTimestamp = Date.now();
let activityListenersAttached = false;
let sessionModalShown = false;
let lastRefreshTimestamp = 0;
let sessionConfigLoaded = false;
let eventStatusModal = null;
let eventStatusModalTitle = null;
let eventStatusModalMessage = null;
let eventStatusCancelBtn = null;
let eventStatusConfirmBtn = null;
let pendingEventStatusAction = null;
let cachedEvents = [];

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function revokeBrandingPreviewUrl() {
    if (brandingPreviewObjectUrl) {
        URL.revokeObjectURL(brandingPreviewObjectUrl);
        brandingPreviewObjectUrl = null;
    }
}

function revokeBrandingLogoPreviewUrl() {
    if (brandingLogoPreviewObjectUrl) {
        URL.revokeObjectURL(brandingLogoPreviewObjectUrl);
        brandingLogoPreviewObjectUrl = null;
    }
}

// ===== Управление пользователями (только root) =====
async function loadUsers() {
    if (!isRootAdmin()) return;
    try {
        const token = await ensureAdminToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const users = await res.json();
        renderUsers(users || []);
    } catch (_) {}
}

function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    tbody.innerHTML = (users || []).map(u => {
        const roleLabel = (String(u.role || '').toLowerCase() === 'admin')
            ? 'Пользователь'
            : (String(u.role || '').toLowerCase() === 'root' ? 'Администратор' : (u.role || ''));
        return `
        <tr>
            <td data-label="ID">${u.id}</td>
            <td data-label="Логин">${escapeHtml(u.username)}</td>
            <td data-label="Имя">${escapeHtml(u.displayName || '')}</td>
            <td data-label="Роль">${roleLabel}</td>
            <td data-label="Действия">
                <button class="btn-small" data-user-edit-name="${u.id}"><i class="fas fa-pen"></i> Имя</button>
                <button class="btn-small" data-user-edit-pass="${u.id}"><i class="fas fa-key"></i> Пароль</button>
                <button class="btn-small btn-danger" data-user-delete="${u.id}" title="Удалить"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `;
    }).join('');

    tbody.querySelectorAll('[data-user-edit-name]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-user-edit-name');
            const newName = prompt('Новое имя пользователя:');
            if (newName === null) return;
            await updateUser(id, { displayName: newName });
            await loadUsers();
        });
    });
    tbody.querySelectorAll('[data-user-edit-pass]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-user-edit-pass');
            const newPass = prompt('Новый пароль:');
            if (!newPass) return;
            await updateUser(id, { password: newPass });
            showNotification('Пароль обновлён', 'success');
        });
    });

    // Удаление пользователя с подтверждением в модалке
    const deleteModal = document.getElementById('userDeleteModal');
    const deleteText = document.getElementById('userDeleteText');
    const deleteCancel = document.getElementById('userDeleteCancel');
    const deleteConfirm = document.getElementById('userDeleteConfirm');
    let deleteTargetId = null;

    tbody.querySelectorAll('[data-user-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
            deleteTargetId = btn.getAttribute('data-user-delete');
            const row = btn.closest('tr');
            const username = row ? row.querySelector('td[data-label="Логин"]')?.textContent?.trim() : '';
            if (deleteText) {
                deleteText.textContent = `Удалить пользователя «${username || deleteTargetId}»?`;
            }
            if (deleteModal) {
                deleteModal.style.display = 'flex';
                deleteModal.setAttribute('aria-hidden', 'false');
                document.body.classList.add('modal-open');
            }
        });
    });
    const closeDeleteModal = () => {
        if (deleteModal) {
            deleteModal.style.display = 'none';
            deleteModal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
        }
        deleteTargetId = null;
    };
    if (deleteCancel) deleteCancel.addEventListener('click', closeDeleteModal);
    if (deleteModal) {
        deleteModal.addEventListener('click', (e) => {
            if (e.target === deleteModal) closeDeleteModal();
        });
    }
    if (deleteConfirm) {
        deleteConfirm.addEventListener('click', async () => {
            if (!deleteTargetId) return;
            try {
                const token = await ensureAdminToken();
                const res = await fetch(`${API_CONFIG.baseUrl}/users/${encodeURIComponent(deleteTargetId)}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    showNotification(data?.error || 'Не удалось удалить пользователя', 'error');
                    return;
                }
                showNotification('Пользователь удалён', 'success');
                closeDeleteModal();
                await loadUsers();
            } catch (_) {
                showNotification('Ошибка сервера', 'error');
            }
        });
    }
}

async function updateUser(id, payload) {
    try {
        const token = await ensureAdminToken();
        await fetch(`${API_CONFIG.baseUrl}/users/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
    } catch (_) {}
}

function setupUsersAdmin() {
    const nav = document.getElementById('usersTabNav');
    const section = document.getElementById('users-tab');
    if (isRootAdmin()) {
        if (nav) nav.style.display = '';
        if (section) section.style.display = '';

        const openBtn = document.getElementById('openCreateUserBtn');
        const createUserModal = document.getElementById('createUserModal');
        const closeCreateBtn = createUserModal?.querySelector('[data-close-create-user]');
        if (openBtn && createUserModal) {
            openBtn.addEventListener('click', () => {
                createUserModal.style.display = 'flex';
                createUserModal.setAttribute('aria-hidden', 'false');
                document.body.classList.add('modal-open');
            });
        }
        if (closeCreateBtn && createUserModal) {
            closeCreateBtn.addEventListener('click', () => {
                createUserModal.style.display = 'none';
                createUserModal.setAttribute('aria-hidden', 'true');
                document.body.classList.remove('modal-open');
            });
            createUserModal.addEventListener('click', (e) => {
                if (e.target === createUserModal) {
                    createUserModal.style.display = 'none';
                    createUserModal.setAttribute('aria-hidden', 'true');
                    document.body.classList.remove('modal-open');
                }
            });
        }

        const form = document.getElementById('createUserForm');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const fd = new FormData(form);
                const username = fd.get('username');
                const displayName = fd.get('displayName');
                const password = fd.get('password');
                const passwordConfirm = fd.get('passwordConfirm');
                if (!username || !password) {
                    showNotification('Логин и пароль обязательны', 'error');
                    return;
                }
                if (String(password) !== String(passwordConfirm)) {
                    showNotification('Пароли не совпадают', 'error');
                    return;
                }
                try {
                    const token = await ensureAdminToken();
                    const res = await fetch(`${API_CONFIG.baseUrl}/users`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ username, displayName, password })
                    });
                    if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        showNotification(data?.error || 'Ошибка создания пользователя', 'error');
                        return;
                    }
                    form.reset();
                    showNotification('Пользователь создан', 'success');
                    if (createUserModal) {
                        createUserModal.style.display = 'none';
                        createUserModal.setAttribute('aria-hidden', 'true');
                        document.body.classList.remove('modal-open');
                    }
                    await loadUsers();
                } catch (e) {
                    showNotification('Ошибка сервера', 'error');
                }
            });
        }
        loadUsers();
    } else {
        if (nav) nav.remove();
        if (section) section.remove();
    }
}

function setBrandingPreview(form, url) {
    const preview = form?.querySelector('[data-branding-preview]');
    const image = form?.querySelector('[data-branding-preview-image]');
    const removeBtn = form?.querySelector('[data-remove-background]');
    if (!preview || !image || !removeBtn) return;
    if (url) {
        preview.removeAttribute('hidden');
        preview.style.display = 'block';
        image.style.backgroundImage = `url("${url}")`;
        removeBtn.removeAttribute('hidden');
        removeBtn.style.display = 'block';
    } else {
        preview.setAttribute('hidden', '');
        preview.style.display = 'none';
        image.style.backgroundImage = 'none';
        removeBtn.setAttribute('hidden', '');
        removeBtn.style.display = 'none';
    }
}

function setBrandingLogoPreview(form, url) {
    const removeBtn = form?.querySelector('[data-remove-logo]');
    if (!removeBtn) return;
    if (url) {
        removeBtn.style.display = 'block';
    } else {
        removeBtn.style.display = 'none';
    }
}

function openModerationPreview(index) {
    if (!moderationModal) return;
    const item = moderationState.photos[index];
    if (!item) return;
    
    const isVideo = item.media_type === 'video';
    
    // Скрываем/показываем соответствующие элементы
    if (moderationModalImage) {
        moderationModalImage.style.display = isVideo ? 'none' : 'block';
        if (!isVideo) {
            moderationModalImage.src = item.url;
        } else {
            moderationModalImage.src = '';
        }
    }
    
    if (moderationModalVideo) {
        moderationModalVideo.style.display = isVideo ? 'block' : 'none';
        if (isVideo) {
            moderationModalVideo.src = item.url;
            moderationModalVideo.load();
            // Автоматически запускаем воспроизведение видео
            moderationModalVideo.play().catch(() => {
                // Игнорируем ошибки автовоспроизведения
            });
        } else {
            moderationModalVideo.pause();
            moderationModalVideo.src = '';
        }
    }
    
    moderationModal.classList.add('open');
}

function closeModerationPreview() {
    if (moderationModal) moderationModal.classList.remove('open');
    if (moderationModalImage) {
        moderationModalImage.src = '';
        moderationModalImage.style.display = 'none';
    }
    if (moderationModalVideo) {
        moderationModalVideo.pause();
        moderationModalVideo.src = '';
        moderationModalVideo.style.display = 'none';
    }
}

function formatDateForInputValue(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return '';
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function setupCreateEventDatePicker() {
    const dateInput = document.getElementById('createEventDate');
    if (!dateInput) return null;

    const quickActions = document.getElementById('createEventDateQuickActions');
    const quickButtons = quickActions ? Array.from(quickActions.querySelectorAll('[data-date-offset]')) : [];
    const timeInput = document.getElementById('createEventTime');
    if (timeInput) {
        timeInput.step = '60';
    }

    const setDefaultTime = () => {
        if (!timeInput) return;
        timeInput.value = getDefaultStartTimeValue();
    };

    const updateActiveButtons = (offset) => {
        const normalized = Number.isFinite(offset) ? offset : null;
        quickButtons.forEach((btn) => {
            const btnOffset = Number(btn.dataset.dateOffset);
            btn.classList.toggle('is-active', normalized !== null && btnOffset === normalized);
        });
    };

    const applyOffset = (offset = 0) => {
        const base = new Date();
        base.setHours(12, 0, 0, 0);
        base.setDate(base.getDate() + Number(offset || 0));
        dateInput.value = formatDateForInputValue(base);
        const normalizedOffset = Number(offset);
        updateActiveButtons(Number.isNaN(normalizedOffset) ? null : normalizedOffset);
    };

    quickButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const offset = Number(btn.dataset.dateOffset);
            applyOffset(Number.isNaN(offset) ? 0 : offset);
        });
    });

    dateInput.addEventListener('input', () => {
        updateActiveButtons(null);
    });

    applyOffset(0);
    if (timeInput) {
        setDefaultTime();
    }

    return {
        resetToToday: () => {
            applyOffset(0);
            setDefaultTime();
        },
        setOffset: applyOffset,
        setDefaultTime
    };
}

function formatPendingCount(count, photosCount, videosCount) {
    const photos = Math.max(0, Number(photosCount) || 0);
    return `${photos.toLocaleString('ru-RU')} фото`;
}

function formatPendingVideosCount(videosCount) {
    const videos = Math.max(0, Number(videosCount) || 0);
    return `${videos.toLocaleString('ru-RU')} видео`;
}

function setModerationPendingIndicator(total, photosCount, videosCount) {
    const indicator = document.getElementById('moderationPendingIndicator');
    const videosIndicator = document.getElementById('moderationPendingVideosIndicator');
    
    if (indicator) {
        const formatted = formatPendingCount(total, photosCount, videosCount);
        indicator.textContent = formatted;
        indicator.dataset.pendingTotal = String(Math.max(0, Number(total) || 0));
        indicator.dataset.pendingPhotos = String(Math.max(0, Number(photosCount) || 0));
    }
    
    if (videosIndicator) {
        const videosFormatted = formatPendingVideosCount(videosCount);
        videosIndicator.textContent = videosFormatted;
        videosIndicator.style.display = 'inline-flex';
        videosIndicator.dataset.pendingVideos = String(Math.max(0, Number(videosCount) || 0));
    }
}

async function refreshModerationPendingCounts() {
    const indicator = document.getElementById('moderationPendingIndicator');
    if (!indicator) return;

    try {
        const token = await ensureAdminToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/photos/pending/count`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (res.status === 401) {
            setModerationPendingIndicator(moderationState.totalPending || 0, 0, 0);
            handleAuthError({ message: 'Требуется авторизация' });
            return;
        }

        if (!res.ok) {
            throw new Error('Не удалось получить количество ожиданий модерации');
        }

        const data = await res.json().catch(() => ({}));
        const byEvent = data?.byEvent && typeof data.byEvent === 'object' ? data.byEvent : {};
        moderationState.pendingCounts = {};
        let totalPhotos = 0;
        let totalVideos = 0;
        
        Object.entries(byEvent).forEach(([eventId, value]) => {
            if (typeof value === 'object' && value !== null) {
                moderationState.pendingCounts[String(eventId)] = Number(value.total) || 0;
                totalPhotos += Number(value.photos) || 0;
                totalVideos += Number(value.videos) || 0;
            } else {
                // Обратная совместимость со старым форматом
                const count = Number(value) || 0;
                moderationState.pendingCounts[String(eventId)] = count;
                totalPhotos += count; // Предполагаем, что это фото
            }
        });
        
        moderationState.totalPending = Number(data?.total) || Object.values(moderationState.pendingCounts).reduce((sum, value) => sum + Number(value || 0), 0);
        // Используем данные с сервера, если они есть, иначе используем подсчитанные значения
        const photosCount = Number(data?.totalPhotos) !== undefined ? Number(data.totalPhotos) : totalPhotos;
        const videosCount = Number(data?.totalVideos) !== undefined ? Number(data.totalVideos) : totalVideos;
        setModerationPendingIndicator(moderationState.totalPending, photosCount, videosCount);
    } catch (error) {
        if (typeof handleAuthError === 'function' && handleAuthError(error)) {
            return;
        }
        console.warn('Не удалось обновить количество фото на модерации', error);
        setModerationPendingIndicator(moderationState.totalPending || 0, 0, 0);
    }
}

const EVENT_STATUS_INFO = {
    scheduled: { key: 'scheduled', label: 'Не начато', badgeClass: 'event-status-badge event-status--scheduled' },
    live: { key: 'live', label: 'В эфире', badgeClass: 'event-status-badge event-status--live' },
    paused: { key: 'paused', label: 'Пауза', badgeClass: 'event-status-badge event-status--paused' },
    ended: { key: 'ended', label: 'Завершено', badgeClass: 'event-status-badge event-status--ended' }
};

const EVENT_ACTION_META = {
    live: {
        key: 'live',
        label: 'Старт',
        buttonClass: 'event-state-btn--start',
        icon: 'fa-play',
        title: 'Запуск мероприятия',
        confirmText: 'Старт',
        success: 'Мероприятие запущено',
        message: name => `Запустить мероприятие «${name}»? Участники смогут загружать фотографии.`
    },
    paused: {
        key: 'paused',
        label: 'Пауза',
        buttonClass: 'event-state-btn--pause',
        icon: 'fa-pause',
        title: 'Пауза мероприятия',
        confirmText: 'Пауза',
        success: 'Мероприятие приостановлено',
        message: name => `Поставить мероприятие «${name}» на паузу? Загрузка фотографий временно станет недоступной.`
    },
    ended: {
        key: 'ended',
        label: 'Стоп',
        buttonClass: 'event-state-btn--stop',
        icon: 'fa-stop',
        title: 'Завершение мероприятия',
        confirmText: 'Завершить',
        success: 'Мероприятие завершено',
        message: name => `Завершить мероприятие «${name}»? После завершения его нельзя будет запустить повторно.`
    }
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatEventDate(value) {
    if (!value) return '';
    try {
        return new Date(value).toLocaleDateString('ru-RU');
    } catch (_) {
        return value;
    }
}

function formatEventDateTime(scheduledIso, fallbackDate) {
    if (scheduledIso) {
        const parsed = new Date(scheduledIso);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleString('ru-RU', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }
    }
    return formatEventDate(fallbackDate);
}

function toTimeInputValue(value) {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function getDefaultStartTimeValue() {
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = (Math.ceil(minutes / 15) * 15) % 60;
    if (roundedMinutes === 0 && minutes !== 0) {
        now.setHours(now.getHours() + 1);
    }
    now.setMinutes(roundedMinutes, 0, 0);
    const hoursStr = String(now.getHours()).padStart(2, '0');
    const minutesStr = String(now.getMinutes()).padStart(2, '0');
    return `${hoursStr}:${minutesStr}`;
}

function getEventStatusInfo(status) {
    const key = String(status || 'scheduled').toLowerCase();
    return EVENT_STATUS_INFO[key] || EVENT_STATUS_INFO.scheduled;
}

function getEventActionMeta(action) {
    const key = String(action || '').toLowerCase();
    return EVENT_ACTION_META[key];
}

// ===== Theme Toggle Functionality =====
function initThemeToggle() {
    const themeToggle = document.getElementById('themeToggle');
    const htmlElement = document.documentElement;
    
    // Загружаем сохраненную тему из localStorage
    const savedTheme = localStorage.getItem('adminTheme') || 'light';
    
    // Применяем тему при загрузке
    if (savedTheme === 'dark') {
        htmlElement.setAttribute('data-theme', 'dark');
        if (themeToggle) themeToggle.checked = true;
    } else {
        htmlElement.setAttribute('data-theme', 'light');
        if (themeToggle) themeToggle.checked = false;
    }
    
    // Обработчик переключения темы
    if (themeToggle) {
        themeToggle.addEventListener('change', (e) => {
            const isDark = e.target.checked;
            
            if (isDark) {
                htmlElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('adminTheme', 'dark');
            } else {
                htmlElement.setAttribute('data-theme', 'light');
                localStorage.setItem('adminTheme', 'light');
            }
        });
    }
}

// Инициализируем переключатель темы сразу, до DOMContentLoaded
initThemeToggle();

document.addEventListener('DOMContentLoaded', async () => {
    // Инициализация графика
    uploadsChartCtx = document.getElementById('uploadsChart')?.getContext('2d');
    if (uploadsChartCtx) {
        uploadsChart = new Chart(uploadsChartCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Загрузки фото',
                    data: [],
                    borderColor: '#2a5298',
                    tension: 0.4,
                    fill: true,
                    backgroundColor: 'rgba(42, 82, 152, 0.1)'
                }, {
                    label: 'Загрузки видео',
                    data: [],
                    borderColor: '#e74c3c',
                    tension: 0.4,
                    fill: true,
                    backgroundColor: 'rgba(231, 76, 60, 0.1)'
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: true },
                    tooltip: { mode: 'index' }
                },
                scales: {
                    x: {
                        ticks: { color: '#1e3c72', font: { weight: '600' } }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { precision: 0 }
                    }
                }
            }
        });
    }

    eventStatusModal = document.getElementById('eventStatusModal');
    eventStatusModalTitle = document.getElementById('eventStatusModalTitle');
    eventStatusModalMessage = document.getElementById('eventStatusModalMessage');
    eventStatusCancelBtn = eventStatusModal?.querySelector('[data-event-status-cancel]');
    eventStatusConfirmBtn = eventStatusModal?.querySelector('[data-event-status-confirm]');

    if (eventStatusCancelBtn) {
        eventStatusCancelBtn.addEventListener('click', () => closeEventStatusModal());
    }

    if (eventStatusConfirmBtn) {
        eventStatusConfirmBtn.addEventListener('click', () => {
            if (!pendingEventStatusAction) {
                closeEventStatusModal();
                return;
            }
            updateEventStatus(pendingEventStatusAction.eventId, pendingEventStatusAction.targetStatus);
        });
    }

    eventStatusModal?.addEventListener('click', (e) => {
        if (e.target === eventStatusModal) {
            closeEventStatusModal();
        }
    });

    const createEventDateControls = setupCreateEventDatePicker();

    // Anchor navigation
    const navLinks = Array.from(document.querySelectorAll('.nav-tab'));
    const sections = Array.from(document.querySelectorAll('.tab-content'));
    const header = document.querySelector('.admin-header');
    const root = document.documentElement;
    const adminNavToggle = document.querySelector('.admin-nav-toggle');
    const adminNavContainer = document.getElementById('adminNavControls');

    const updateHeaderHeightVar = () => {
        if (!header) return;
        root.style.setProperty('--admin-header-height', `${header.offsetHeight}px`);
    };

    updateHeaderHeightVar();

    if (header && 'ResizeObserver' in window) {
        const headerResizeObserver = new ResizeObserver(updateHeaderHeightVar);
        headerResizeObserver.observe(header);
    }
    
    const closeAdminMenu = () => {
        if (!adminNavContainer) return;
        adminNavContainer.classList.remove('is-open');
        if (adminNavToggle) {
            adminNavToggle.setAttribute('aria-expanded', 'false');
        }
        document.body.classList.remove('admin-menu-open');
    };

    if (adminNavToggle && adminNavContainer) {
        adminNavToggle.addEventListener('click', (event) => {
            event.stopPropagation();
            const willOpen = !adminNavContainer.classList.contains('is-open');
            adminNavContainer.classList.toggle('is-open', willOpen);
            adminNavToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            document.body.classList.toggle('admin-menu-open', willOpen);
        });

        document.addEventListener('click', (event) => {
            if (!adminNavContainer.classList.contains('is-open')) return;
            if (!adminNavContainer.contains(event.target) && !adminNavToggle.contains(event.target)) {
                closeAdminMenu();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeAdminMenu();
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 900) {
                closeAdminMenu();
            }
        });

        const collapseTargets = adminNavContainer.querySelectorAll('.nav-tab, .create-event-btn, #logoutBtn');
        collapseTargets.forEach((element) => {
            element.addEventListener('click', () => {
                if (window.innerWidth <= 900) {
                    closeAdminMenu();
                }
            });
        });
    }
    
    if (!getAdminToken()) {
        window.location.href = 'index.html';
        return;
    }

    if (!sessionConfigLoaded) {
        await loadSessionConfig();
    }

    setupSessionManagement();

    window.addEventListener('beforeunload', () => {
        stopActiveUsersPolling();
        stopSessionManagement();
    });

    let isManualNav = false; // Флаг для отслеживания ручной навигации
    let scrollSpyTimeout = null; // Таймер для отключения scroll spy
    let scrollSpyEnabled = true; // Флаг для полного отключения scroll spy
    
    const updateActiveNav = (targetId) => {
        // Сначала убираем active со всех ссылок
        navLinks.forEach(link => {
            link.classList.remove('active');
        });
        
        // Затем добавляем active только к нужной ссылке
        navLinks.forEach(link => {
            const hrefId = link.getAttribute('href')?.slice(1);
            if (hrefId === targetId) {
                link.classList.add('active');
            }
        });
    };

    navLinks.forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            const targetId = link.getAttribute('href')?.slice(1);
            if (!targetId) return;
            const targetSection = document.getElementById(targetId);
            if (!targetSection) return;

            // Устанавливаем флаги ручной навигации
            isManualNav = true;
            scrollSpyEnabled = false;
            
            // Отключаем scroll spy на время навигации
            if (scrollSpyTimeout) {
                clearTimeout(scrollSpyTimeout);
            }
            
            // Сразу обновляем активную вкладку - убираем active со всех, добавляем только к кликнутой
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            history.replaceState(null, '', `#${targetId}`);
            
            targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            
            // Включаем обратно scroll spy после завершения прокрутки
            scrollSpyTimeout = setTimeout(() => {
                isManualNav = false;
                scrollSpyEnabled = true;
            }, 2000);
        });
    });

    const handleScrollSpy = () => {
        // Не обновляем навигацию, если scroll spy отключен или пользователь вручную кликнул на вкладку
        if (!scrollSpyEnabled || isManualNav) return;
        
        if (!sections.length) return;
        const headerHeight = (header?.offsetHeight || 0) + 16;
        let currentSectionId = sections[0].id;

        for (const section of sections) {
            const sectionTop = section.getBoundingClientRect().top - headerHeight;
            if (sectionTop <= 0) {
                currentSectionId = section.id;
            } else {
                break;
            }
        }

        updateActiveNav(currentSectionId);
    };

    window.addEventListener('scroll', handleScrollSpy, { passive: true });

    const initialHash = window.location.hash?.slice(1);
    if (initialHash) {
        const targetSection = document.getElementById(initialHash);
        if (targetSection) {
            // Устанавливаем флаг, чтобы scroll spy не переопределил активную вкладку
            isManualNav = true;
            targetSection.scrollIntoView({ block: 'start' });
            updateActiveNav(initialHash);
            setTimeout(() => {
                isManualNav = false;
            }, 500);
        } else {
            handleScrollSpy();
        }
    } else {
        // При первой загрузке без hash активируем первую вкладку
        if (navLinks.length > 0) {
            const firstLink = navLinks[0];
            const firstId = firstLink.getAttribute('href')?.slice(1);
            if (firstId) {
                updateActiveNav(firstId);
            }
        }
        handleScrollSpy();
    }

    // Инициализация управления пользователями (для root)
    setupUsersAdmin();

    // Обработка модальных окон
    const createEventButtons = Array.from(document.querySelectorAll('.create-event-btn'));
    const createEventModal = document.getElementById('createEventModal');
    const settingsModal = document.getElementById('settingsModal');
    const modals = document.querySelectorAll('.modal');
    const sessionExpiredModal = document.getElementById('sessionExpiredModal');
    const sessionExpiredConfirmBtn = sessionExpiredModal?.querySelector('[data-session-expired-confirm]');

    if (sessionExpiredConfirmBtn) {
        sessionExpiredConfirmBtn.addEventListener('click', () => {
            if (!sessionExpiredModal) return;
            sessionExpiredModal.style.display = 'none';
            sessionExpiredModal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
            window.location.href = 'index.html';
        });
    }

    // Кнопка создания события
    if (createEventModal && createEventButtons.length) {
        createEventButtons.forEach((button) => {
            button.addEventListener('click', () => {
                createEventDateControls?.resetToToday();
        createEventModal.style.display = 'flex';
    });
        });
    }

    // Кнопка настроек в карточке события
    document.querySelectorAll('.settings-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            settingsModal.style.display = 'flex';
        });
    });

    // Кнопка QR кода
    document.querySelectorAll('.qr-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showNotification('QR код сгенерирован', 'success');
        });
    });

    // Кнопки галереи для уже существующих элементов (если есть) перенаправляем с id
    document.querySelectorAll('.gallery-btn[data-event-id]')?.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-event-id');
            if (id) window.location.href = `gallery.html?id=${id}`;
        });
    });

    // Закрытие модальных окон при клике вне их
    modals.forEach(modal => {
        if (modal.id === 'sessionExpiredModal') return;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
                if (modal.id === 'createEventModal') {
                    createEventDateControls?.resetToToday();
                }
            }
        });
    });

    // Кнопки закрытия в модальных окнах
    document.querySelectorAll('.cancel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalEl = btn.closest('.modal');
            if (!modalEl) return;
            modalEl.style.display = 'none';
            if (modalEl.id === 'createEventModal') {
                createEventDateControls?.resetToToday();
            }
        });
    });

    // Отправка форм
    let creatingEvent = false;
    document.getElementById('createEventForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (creatingEvent) return;
        creatingEvent = true;
        const formData = new FormData(e.target);
        
        try {
            const token = await ensureAdminToken();

            let response = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.events}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: formData.get('name'),
                    date: formData.get('date'),
                    startTime: formData.get('time'),
                    description: formData.get('description')
                })
            });

            if (response.status === 401) {
                clearAdminToken();
                showNotification('Сессия истекла. Авторизуйтесь заново.', 'error');
                window.location.href = 'index.html';
                return;
            }

            const event = await response.json();
            if (response.ok) {
                // Save for QR page convenience
                try {
                    localStorage.setItem('lastEvent', JSON.stringify({ id: event.id, name: event.name, date: event.date }));
                } catch (_) {}
                
                // Закрываем модальное окно
                document.getElementById('createEventModal').style.display = 'none';
                
                // Очищаем форму
                e.target.reset();
                createEventDateControls?.resetToToday();
                
                // Показываем уведомление
                showNotification('Мероприятие успешно создано', 'success');
                
                // Перезагружаем список событий
                await loadEvents();
            } else {
                showNotification(event.message || 'Ошибка при создании события', 'error');
            }
        } catch (error) {
            if (handleAuthError(error)) return;
            showNotification('Ошибка при создании события', 'error');
        } finally {
            creatingEvent = false;
        }
    });

    document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const eventId = form.dataset.eventId;
        if (!eventId) {
            showNotification('Не найден идентификатор события', 'error');
            return;
        }

        try {
            const token = await ensureAdminToken();
            const backgroundFileInput = form.elements.backgroundFile;
            const backgroundHiddenInput = form.elements.backgroundImage;
            let brandingBackground = '';

            if (form.dataset.removeBackground === 'true') {
                brandingBackground = '';
            } else if (backgroundFileInput && backgroundFileInput.files && backgroundFileInput.files.length) {
                const uploadResult = await uploadBrandingBackground(eventId, backgroundFileInput.files[0]);
                brandingBackground = uploadResult.path || '';
                if (backgroundHiddenInput) backgroundHiddenInput.value = brandingBackground;
                revokeBrandingPreviewUrl();
                setBrandingPreview(form, uploadResult.url || '');
                backgroundFileInput.value = '';
                form.dataset.removeBackground = 'false';
            } else {
                // Если не загружаем новый файл и не удаляем, оставляем текущее значение
                const existingBackground = backgroundHiddenInput?.value || form.dataset.existingBackground || '';
                if (existingBackground && form.dataset.removeBackground !== 'true') {
                    brandingBackground = existingBackground;
                }
            }

            const logoFileInput = form.elements.logoFile;
            let brandingLogo = '';

            if (form.dataset.removeLogo === 'true') {
                brandingLogo = '';
            }

            if (logoFileInput && logoFileInput.files && logoFileInput.files.length) {
                const uploadResult = await uploadBrandingLogo(eventId, logoFileInput.files[0]);
                brandingLogo = uploadResult.path || '';
                revokeBrandingLogoPreviewUrl();
                setBrandingLogoPreview(form, uploadResult.url || '');
                logoFileInput.value = '';
                form.dataset.removeLogo = 'false';
            } else {
                // Если не загружаем новый файл, но и не удаляем, оставляем текущее значение
                const existingLogo = form.dataset.existingLogo || '';
                if (existingLogo && form.dataset.removeLogo !== 'true') {
                    brandingLogo = existingLogo;
                }
            }

            // Валидация Telegram настроек
            const telegramEnabled = form.elements.telegramEnabled?.checked;
            const telegramUsername = form.elements.telegramUsername?.value?.trim() || '';
            const telegramThreshold = form.elements.telegramThreshold?.value || '';
            
            // Убираем классы ошибок перед валидацией
            const telegramUsernameInput = form.elements.telegramUsername;
            const telegramThresholdInput = form.elements.telegramThreshold;
            if (telegramUsernameInput) telegramUsernameInput.classList.remove('field-error');
            if (telegramThresholdInput) telegramThresholdInput.classList.remove('field-error');
            
            let hasErrors = false;
            
            if (telegramEnabled) {
                if (!telegramUsername) {
                    if (telegramUsernameInput) {
                        telegramUsernameInput.classList.add('field-error');
                        hasErrors = true;
                    }
                }
                if (!telegramThreshold || isNaN(parseInt(telegramThreshold, 10)) || parseInt(telegramThreshold, 10) <= 0) {
                    if (telegramThresholdInput) {
                        telegramThresholdInput.classList.add('field-error');
                        hasErrors = true;
                    }
                }
            }
            
            if (hasErrors) {
                showNotification('Заполните все обязательные поля для Telegram уведомлений', 'error');
                return;
            }

            const payload = {
                name: form.elements.eventName?.value || '',
                date: form.elements.eventDate?.value || '',
                start_time: form.elements.eventTime?.value || '',
                description: form.elements.eventDescription?.value || '',
                require_moderation: form.elements.requireModeration.checked ? 1 : 0,
                upload_access: 'all', // Всегда разрешаем загрузку по ссылке
                view_access: form.elements.viewAccess?.value || 'public',
                view_password: form.elements.viewPassword?.value || '',
                auto_delete_days: parseInt(form.elements.deleteAfter?.value || '14', 10),
                notify_before_delete: form.elements.notifyBeforeDelete?.checked ? 1 : 0,
                branding_color: form.elements.primaryColor?.value || '',
                branding_background: brandingBackground,
                branding_logo: brandingLogo,
                telegram_enabled: telegramEnabled ? 1 : 0,
                telegram_username: telegramUsername,
                telegram_threshold: parseInt(telegramThreshold || '10', 10)
            };

            const res = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.events}/${encodeURIComponent(eventId)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || 'Не удалось сохранить настройки');
            }

            settingsModal.style.display = 'none';
            showNotification('Настройки сохранены', 'success');
            await loadEvents();
        } catch (error) {
            if (handleAuthError(error)) return;
            showNotification(error.message || 'Ошибка сохранения настроек', 'error');
        }
    });

    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        const backgroundFileInput = settingsForm.querySelector('input[name="backgroundFile"]');
        const removeBackgroundBtn = settingsForm.querySelector('[data-remove-background]');
        settingsForm.dataset.removeBackground = 'false';

        if (backgroundFileInput) {
            backgroundFileInput.addEventListener('change', () => {
                if (!backgroundFileInput.files || !backgroundFileInput.files.length) return;
                revokeBrandingPreviewUrl();
                const objectUrl = URL.createObjectURL(backgroundFileInput.files[0]);
                brandingPreviewObjectUrl = objectUrl;
                setBrandingPreview(settingsForm, objectUrl);
                settingsForm.dataset.removeBackground = 'false';
            });
        }

        if (removeBackgroundBtn) {
            removeBackgroundBtn.addEventListener('click', () => {
                revokeBrandingPreviewUrl();
                if (backgroundFileInput) backgroundFileInput.value = '';
                const hiddenInput = settingsForm.elements.backgroundImage;
                if (hiddenInput) hiddenInput.value = '';
                setBrandingPreview(settingsForm, '');
                settingsForm.dataset.removeBackground = 'true';
            });
        }

        const logoFileInput = settingsForm.querySelector('input[name="logoFile"]');
        const removeLogoBtn = settingsForm.querySelector('[data-remove-logo]');
        settingsForm.dataset.removeLogo = 'false';

        if (logoFileInput) {
            logoFileInput.addEventListener('change', () => {
                if (!logoFileInput.files || !logoFileInput.files.length) return;
                revokeBrandingLogoPreviewUrl();
                const objectUrl = URL.createObjectURL(logoFileInput.files[0]);
                brandingLogoPreviewObjectUrl = objectUrl;
                const removeBtn = settingsForm.querySelector('[data-remove-logo]');
                if (removeBtn) removeBtn.style.display = 'block';
                settingsForm.dataset.removeLogo = 'false';
            });
        }

        if (removeLogoBtn) {
            removeLogoBtn.addEventListener('click', () => {
                revokeBrandingLogoPreviewUrl();
                if (logoFileInput) logoFileInput.value = '';
                setBrandingLogoPreview(settingsForm, '');
                settingsForm.dataset.removeLogo = 'true';
            });
        }
    }

    // Показ/скрытие поля пароля в зависимости от типа доступа
    const viewAccessSelect = document.getElementById('viewAccessSelect');
    const viewPasswordGroup = document.querySelector('.view-password-group');
    if (viewAccessSelect && viewPasswordGroup) {
        const togglePasswordField = () => {
            viewPasswordGroup.style.display = viewAccessSelect.value === 'private' ? 'block' : 'none';
        };
        viewAccessSelect.addEventListener('change', togglePasswordField);
        togglePasswordField(); // Инициализация при загрузке
    }

    // Вкладки настроек
    const settingsTabs = document.querySelectorAll('.settings-tabs .tab-btn');
    const settingsContents = document.querySelectorAll('.settings-content');
    if (settingsTabs.length && settingsContents.length) {
        settingsTabs.forEach((tab, index) => {
            tab.addEventListener('click', () => {
                settingsTabs.forEach(t => t.classList.remove('active'));
                settingsContents.forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const target = tab.dataset.tab;
                const content = document.getElementById(`${target}-content`) || settingsContents[index];
                if (content) content.classList.add('active');
            });
        });
    }

    moderationModal = document.getElementById('moderationModal');
    moderationModalImage = document.getElementById('moderationModalImage');
    moderationModalVideo = document.getElementById('moderationModalVideo');
    if (moderationModal) {
        const closeBtn = moderationModal.querySelector('.close-modal');
        if (closeBtn) closeBtn.addEventListener('click', closeModerationPreview);
        moderationModal.addEventListener('click', (e) => {
            if (e.target === moderationModal) {
                closeModerationPreview();
            }
        });
    }

    if (!getAdminToken()) {
        window.location.href = 'index.html';
        return;
    }


    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            stopActiveUsersPolling();
            stopSessionManagement();
            clearAdminToken();
            window.location.href = 'index.html';
        });
    }

    setupAdminLanguageDropdown();
    loadEvents();
    loadAnalyticsSummary();
    loadUploadsAnalytics();
    loadEventsOverview();
});

// ======= Auth helpers =======
function getAdminToken() {
    try { return localStorage.getItem('adminToken'); } catch (_) { return null; }
}

function setAdminToken(token) {
    try { localStorage.setItem('adminToken', token); } catch (_) {}
}

function clearAdminToken() {
    try { localStorage.removeItem('adminToken'); } catch (_) {}
}

function stopSessionManagement() {
    if (idleTimerId) {
        clearTimeout(idleTimerId);
        idleTimerId = null;
    }
    if (refreshTimerId) {
        clearInterval(refreshTimerId);
        refreshTimerId = null;
    }
    lastRefreshTimestamp = 0;
}

async function ensureAdminToken() {
    const token = getAdminToken();
    if (token) return token;
    throw new Error('Требуется авторизация');
}

function decodeJwtPayload(token) {
    try {
        const parts = String(token || '').split('.');
        if (parts.length < 2) return null;
        let payload = parts[1];
        // JWT base64url -> base64
        payload = payload.replace(/-/g, '+').replace(/_/g, '/');
        while (payload.length % 4) payload += '=';
        const json = atob(payload);
        return JSON.parse(json);
    } catch (_) {
        return null;
    }
}

function isRootAdmin() {
    const token = getAdminToken();
    const payload = token ? decodeJwtPayload(token) : null;
    return Boolean(payload && payload.role === 'root');
}

function markActivity() {
    lastActivityTimestamp = Date.now();
    if (!sessionModalShown && getAdminToken()) {
        scheduleIdleTimer();
    }
}

function showSessionExpiredModal() {
    if (sessionModalShown) return;
    sessionModalShown = true;

    stopSessionManagement();
    stopActiveUsersPolling();
    clearAdminToken();

    const modal = document.getElementById('sessionExpiredModal');
    const confirmBtn = modal?.querySelector('[data-session-expired-confirm]');

    if (!modal || !confirmBtn) {
        window.location.href = 'index.html';
        return;
    }

    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    confirmBtn.focus({ preventScroll: true });
}

function handleAuthError(error) {
    if (error?.message === 'Требуется авторизация') {
        showSessionExpiredModal();
        return true;
    }
    return false;
}

function openModerationConfirmModal(options) {
    const modal = document.getElementById('moderationConfirmModal');
    const titleEl = modal?.querySelector('#moderationConfirmTitle');
    const messageEl = modal?.querySelector('#moderationConfirmMessage');
    const cancelBtn = modal?.querySelector('[data-moderation-confirm-cancel]');
    const applyBtn = modal?.querySelector('[data-moderation-confirm-apply]');

    if (!modal || !titleEl || !messageEl || !cancelBtn || !applyBtn) {
        if (options?.action) {
            moderateSelected(options.action);
        }
        return;
    }

    titleEl.textContent = options?.title || 'Подтверждение действия';
    messageEl.textContent = options?.message || 'Вы уверены, что хотите выполнить это действие?';
    applyBtn.textContent = options?.confirmText || 'Ок';
    applyBtn.dataset.moderationAction = options?.action || '';

    applyBtn.classList.remove('confirm-approve', 'confirm-reject');
    if (options?.confirmClass) {
        applyBtn.classList.add(options.confirmClass);
    }

    const closeModal = () => {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        cancelBtn.removeEventListener('click', onCancel);
        applyBtn.removeEventListener('click', onApply);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKeydown);
    };

    const onCancel = () => {
        closeModal();
    };

    const onApply = () => {
        const action = applyBtn.dataset.moderationAction;
        closeModal();
        if (action) {
            moderateSelected(action);
        }
    };

    const onBackdrop = (event) => {
        if (event.target === modal) {
            closeModal();
        }
    };

    const onKeydown = (event) => {
        if (event.key === 'Escape') {
            closeModal();
        }
    };

    cancelBtn.addEventListener('click', onCancel);
    applyBtn.addEventListener('click', onApply);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeydown);

    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    applyBtn.focus({ preventScroll: true });
}

function scheduleIdleTimer() {
    if (idleTimerId) clearTimeout(idleTimerId);
    idleTimerId = setTimeout(handleIdleTimeout, IDLE_TIMEOUT_MS);
}

function scheduleRefreshTimer() {
    if (refreshTimerId) clearInterval(refreshTimerId);
    refreshTimerId = setInterval(() => {
        refreshSessionToken().catch(() => {});
    }, SESSION_REFRESH_INTERVAL_MS);
}

function applySessionConfig(config) {
    if (typeof config?.idleTimeoutMs === 'number' && config.idleTimeoutMs > 0) {
        IDLE_TIMEOUT_MS = Math.max(MIN_IDLE_TIMEOUT_MS, config.idleTimeoutMs);
    }

    const tokenTtlMs = typeof config?.tokenTtlMs === 'number' && config.tokenTtlMs > 0
        ? config.tokenTtlMs
        : null;

    if (tokenTtlMs) {
        const maxRefreshByIdle = Math.max(MIN_REFRESH_INTERVAL_MS, IDLE_TIMEOUT_MS - 10_000);
        let baseRefresh = Math.floor(tokenTtlMs * 0.25);
        baseRefresh = clamp(baseRefresh, MIN_REFRESH_INTERVAL_MS, maxRefreshByIdle);
        TOKEN_REFRESH_THRESHOLD_MS = baseRefresh;

        let forceRefresh = Math.floor(tokenTtlMs * 0.35);
        forceRefresh = clamp(
            forceRefresh,
            baseRefresh + 5_000,
            Math.max(baseRefresh + 5_000, IDLE_TIMEOUT_MS - 5_000)
        );
        FORCE_REFRESH_THRESHOLD_MS = forceRefresh;

        let refreshInterval = Math.floor(baseRefresh / 2);
        refreshInterval = clamp(
            refreshInterval,
            MIN_REFRESH_INTERVAL_MS,
            Math.max(MIN_REFRESH_INTERVAL_MS, baseRefresh - 5_000)
        );
        const maxInterval = Math.max(MIN_REFRESH_INTERVAL_MS, TOKEN_REFRESH_THRESHOLD_MS - 5_000);
        SESSION_REFRESH_INTERVAL_MS = clamp(refreshInterval, MIN_REFRESH_INTERVAL_MS, maxInterval);
    } else {
        const maxRefreshByIdle = Math.max(MIN_REFRESH_INTERVAL_MS, IDLE_TIMEOUT_MS - 10_000);
        TOKEN_REFRESH_THRESHOLD_MS = clamp(TOKEN_REFRESH_THRESHOLD_MS, MIN_REFRESH_INTERVAL_MS, maxRefreshByIdle);
        FORCE_REFRESH_THRESHOLD_MS = clamp(
            FORCE_REFRESH_THRESHOLD_MS,
            TOKEN_REFRESH_THRESHOLD_MS + 5_000,
            Math.max(TOKEN_REFRESH_THRESHOLD_MS + 5_000, IDLE_TIMEOUT_MS - 5_000)
        );
        const maxInterval = Math.max(MIN_REFRESH_INTERVAL_MS, TOKEN_REFRESH_THRESHOLD_MS - 5_000);
        SESSION_REFRESH_INTERVAL_MS = clamp(
            SESSION_REFRESH_INTERVAL_MS,
            MIN_REFRESH_INTERVAL_MS,
            maxInterval
        );
    }
}

async function loadSessionConfig() {
    try {
        const res = await fetch(`${API_CONFIG.baseUrl}/auth/config`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!data) return;
        applySessionConfig(data);
        sessionConfigLoaded = true;
    } catch (_) {
        // ignore config fetch errors, defaults stay in place
    }
}

function attachActivityListeners() {
    if (activityListenersAttached) return;
    const events = ['click', 'keydown', 'touchstart', 'scroll', 'input', 'pointerdown'];
    const handler = () => {
        markActivity();
        refreshSessionToken(true).catch(() => {});
    };
    events.forEach(eventName => {
        document.addEventListener(eventName, handler, { passive: true });
    });
    activityListenersAttached = true;
}

async function refreshSessionToken(force = false) {
    if (sessionModalShown) return;
    const token = getAdminToken();
    if (!token) return;

    const now = Date.now();
    if (!force && (now - lastActivityTimestamp) > IDLE_TIMEOUT_MS) {
        return;
    }

    if (now - lastRefreshTimestamp < REFRESH_DEBOUNCE_MS) {
        return;
    }

    const payload = decodeJwtPayload(token);
    if (payload?.exp) {
        const msToExpiry = payload.exp * 1000 - now;
        if (msToExpiry <= 0) {
            showSessionExpiredModal();
            return;
        }
        const threshold = force ? FORCE_REFRESH_THRESHOLD_MS : TOKEN_REFRESH_THRESHOLD_MS;
        if (msToExpiry > threshold) {
            return;
        }
    }

    lastRefreshTimestamp = now;

    try {
        const res = await fetch(`${API_CONFIG.baseUrl}/auth/refresh`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (res.status === 401) {
            showSessionExpiredModal();
            return;
        }

        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (data?.token) {
            setAdminToken(data.token);
            if (force) {
                markActivity();
            }
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Не удалось обновить сессию', error);
    }
}

function handleIdleTimeout() {
    showSessionExpiredModal();
}

function setupSessionManagement() {
    attachActivityListeners();
    markActivity();
    scheduleRefreshTimer();
}

async function performLogin(username, password) {
    const res = await fetch(`${API_CONFIG.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
        const msg = data?.message || 'Ошибка авторизации';
        throw new Error(msg);
    }
    if (data?.token) setAdminToken(data.token);
    return data.token;
}


// Функция показа уведомлений
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check' : 'exclamation'}-circle"></i>
        <span>${message}</span>
    `;
    
    const container = document.getElementById('notifications-container');
    container.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Загрузка событий
async function loadEvents() {
    try {
        const token = await ensureAdminToken();
        const response = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.events}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const events = await response.json();
        renderEvents(events);
        setupModeration(cachedEvents);
        await refreshModerationPendingCounts();
        startActiveUsersPolling();
    } catch (error) {
        stopActiveUsersPolling();
        showNotification('Ошибка при загрузке событий', 'error');
    }
}

// Функция отрисовки событий
function renderEvents(events) {
    const eventGrid = document.querySelector('.event-grid');
    if (!eventGrid) return;

    cachedEvents = Array.isArray(events)
        ? events.map(evt => ({
            ...evt,
            status: String(evt.status || 'scheduled').toLowerCase()
        }))
        : [];

    if (!cachedEvents.length) {
        eventGrid.innerHTML = `
            <div class="empty-events">
                <h2 class="empty-title">Нет созданных мероприятий</h2>
            </div>
        `;
        return;
    }
    
    eventGrid.innerHTML = cachedEvents.map(event => {
        const statusInfo = getEventStatusInfo(event.status);
        const startDisabled = event.status === 'live' || event.status === 'ended';
        const pauseDisabled = event.status !== 'live';
        const stopDisabled = event.status === 'ended';
        const startMeta = EVENT_ACTION_META.live;
        const pauseMeta = EVENT_ACTION_META.paused;
        const stopMeta = EVENT_ACTION_META.ended;
        const ownerMarkup = isRootAdmin()
            ? (() => {
                const name = event.owner_display_name || event.owner_username;
                if (!name) return '';
                return `<div class="event-owner"><i class="fas fa-user"></i> <span>${escapeHtml(name)}</span></div>`;
              })()
            : '';

        return `
        <div class="event-card" data-event-id="${event.id}" data-event-status="${event.status}">
            <div class="event-header">
                <div class="event-header-info">
                    <h3>${escapeHtml(event.name)}</h3>
                    <span class="event-date">${formatEventDateTime(event.scheduled_start_at, event.date)}</span>
            </div>
                <span class="${statusInfo.badgeClass}">${statusInfo.label}</span>
            </div>
            ${ownerMarkup}
            <div class="event-stats">
                <div class="event-stats-item"><i class="fas fa-image"></i> ${event.photo_count || 0} фото</div>
                <div class="event-stats-item"><i class="fas fa-heart"></i> ${event.like_count || 0} лайков</div>
                <div class="event-stats-item event-stats-active">
                    <i class="fas fa-signal"></i>
                    <span data-active-users-value>${Number(event.active_users) || 0}</span> онлайн
                </div>
            </div>
            <div class="event-actions">
                <button class="qr-btn" onclick="window.open('qr-page.html#event=${event.id}&date=${encodeURIComponent(event.date)}', '_blank')"><i class="fas fa-qrcode"></i></button>
                <button class="gallery-btn" onclick="window.open('gallery.html#event=${event.id}', '_blank')"><i class="fas fa-images"></i></button>
                <button class="settings-btn" onclick="openSettings('${event.id}')"><i class="fas fa-cog"></i></button>
                <button class="delete-btn" onclick="deleteEvent('${event.id}')" title="Удалить"><i class="fas fa-trash"></i></button>
            </div>
            <div class="event-state-controls">
                <button class="event-state-btn ${startMeta.buttonClass}" data-action="${startMeta.key}" ${startDisabled ? 'disabled' : ''}>
                    <i class="fas ${startMeta.icon}"></i><span>${startMeta.label}</span>
                </button>
                <button class="event-state-btn ${pauseMeta.buttonClass}" data-action="${pauseMeta.key}" ${pauseDisabled ? 'disabled' : ''}>
                    <i class="fas ${pauseMeta.icon}"></i><span>${pauseMeta.label}</span>
                </button>
                <button class="event-state-btn ${stopMeta.buttonClass}" data-action="${stopMeta.key}" ${stopDisabled ? 'disabled' : ''}>
                    <i class="fas ${stopMeta.icon}"></i><span>${stopMeta.label}</span>
                </button>
        </div>
        </div>
        `;
    }).join('');

    bindEventStateButtons(eventGrid);
}

function bindEventStateButtons(container) {
    if (!container) return;
    const buttons = container.querySelectorAll('.event-state-btn');
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            if (button.disabled) return;
            const action = button.dataset.action;
            if (!action) return;
            const card = button.closest('.event-card');
            if (!card) return;
            const eventId = Number(card.dataset.eventId);
            openEventStatusModal(eventId, action);
        });
    });
}

function closeEventStatusModal() {
    if (!eventStatusModal) return;
    eventStatusModal.style.display = 'none';
    eventStatusModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    pendingEventStatusAction = null;
    if (eventStatusConfirmBtn) {
        eventStatusConfirmBtn.disabled = false;
    }
}

function openEventStatusModal(eventId, targetStatus) {
    if (!eventStatusModal) return;
    const event = cachedEvents.find(evt => Number(evt.id) === Number(eventId));
    const actionMeta = getEventActionMeta(targetStatus);
    if (!event || !actionMeta) {
        showNotification('Событие не найдено', 'error');
        return;
    }

    eventStatusModalTitle.textContent = actionMeta.title;
    eventStatusModalMessage.textContent = actionMeta.message(event.name || '');
    eventStatusConfirmBtn.textContent = actionMeta.confirmText;
    eventStatusConfirmBtn.disabled = false;

    pendingEventStatusAction = { eventId, targetStatus };

    eventStatusModal.style.display = 'flex';
    eventStatusModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    eventStatusConfirmBtn.focus();
}

async function updateEventStatus(eventId, targetStatus) {
    if (!eventStatusConfirmBtn) return;
    eventStatusConfirmBtn.disabled = true;
    try {
        const token = await ensureAdminToken();
        const res = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.events}/${encodeURIComponent(eventId)}/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: targetStatus })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось изменить статус');
        }
        closeEventStatusModal();
        const meta = getEventActionMeta(targetStatus);
        showNotification(meta?.success || 'Статус обновлён', 'success');
        await loadEvents();
    } catch (error) {
        if (handleAuthError(error)) {
            closeEventStatusModal();
            return;
        }
        eventStatusConfirmBtn.disabled = false;
        showNotification(error.message || 'Не удалось изменить статус', 'error');
    }
}

async function fetchActiveUsersCounts() {
    const token = getAdminToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const [activeUsersRes, eventsRes] = await Promise.all([
            fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.events}/active-users`, { headers }),
            fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.events}`, { headers })
        ]);

        if (activeUsersRes.status === 401 || eventsRes.status === 401) {
            stopActiveUsersPolling();
            handleAuthError({ message: 'Требуется авторизация' });
            return;
        }

        if (!activeUsersRes.ok || !eventsRes.ok) return;

        const [activeUsersData, eventsDataRaw] = await Promise.all([
            activeUsersRes.json(),
            eventsRes.json()
        ]);

        if (Array.isArray(eventsDataRaw)) {
            cachedEvents = eventsDataRaw.map(evt => ({
                ...evt,
                status: String(evt.status || 'scheduled').toLowerCase()
            }));

            const cards = document.querySelectorAll('.event-card[data-event-id]');
            cards.forEach(card => {
                const eventId = card.getAttribute('data-event-id');
                const event = cachedEvents.find(evt => String(evt.id) === String(eventId));
                if (!event) return;

                const statusInfo = getEventStatusInfo(event.status);
                const badge = card.querySelector('.event-status-badge');
                const dateEl = card.querySelector('.event-date');
                const startBtn = card.querySelector('.event-state-btn[data-action="live"]');
                const pauseBtn = card.querySelector('.event-state-btn[data-action="paused"]');
                const stopBtn = card.querySelector('.event-state-btn[data-action="ended"]');

                card.dataset.eventStatus = event.status;

                if (badge) {
                    badge.className = `event-status-badge ${statusInfo.badgeClass}`;
                    badge.textContent = statusInfo.label;
                }
                if (dateEl) {
                    dateEl.textContent = formatEventDateTime(event.scheduled_start_at, event.date);
                }
                if (startBtn) {
                    startBtn.disabled = event.status === 'live' || event.status === 'ended';
                }
                if (pauseBtn) {
                    pauseBtn.disabled = event.status !== 'live';
                }
                if (stopBtn) {
                    stopBtn.disabled = event.status === 'ended';
                }
            });
        }

        const cards = document.querySelectorAll('.event-card[data-event-id]');
        cards.forEach(card => {
            const eventId = card.getAttribute('data-event-id');
            const valueEl = card.querySelector('[data-active-users-value]');
            if (!valueEl) return;
            const count = Number(activeUsersData?.[eventId]) || 0;
            valueEl.textContent = count;

            const startBtn = card.querySelector('.event-state-btn[data-action="live"]');
            const pauseBtn = card.querySelector('.event-state-btn[data-action="paused"]');
            const stopBtn = card.querySelector('.event-state-btn[data-action="ended"]');
            if (startBtn) startBtn.disabled = card.dataset.eventStatus === 'live' || card.dataset.eventStatus === 'ended';
            if (pauseBtn) pauseBtn.disabled = card.dataset.eventStatus !== 'live';
            if (stopBtn) stopBtn.disabled = card.dataset.eventStatus === 'ended';
        });
    } catch (_) {
        // ignore network errors
    }
}

async function uploadBrandingBackground(eventId, file) {
    const token = await ensureAdminToken();
    const formData = new FormData();
    formData.append('background', file);
    const res = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.events}/${encodeURIComponent(eventId)}/branding/background`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        },
        body: formData
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
        clearAdminToken();
        throw new Error('Требуется авторизация');
    }
    if (!res.ok) {
        throw new Error(data.error || 'Не удалось загрузить фоновое изображение');
    }
    return data;
}

async function uploadBrandingLogo(eventId, file) {
    const token = await ensureAdminToken();
    const formData = new FormData();
    formData.append('logo', file);
    const res = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.events}/${encodeURIComponent(eventId)}/branding/logo`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`
        },
        body: formData
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
        clearAdminToken();
        throw new Error('Требуется авторизация');
    }
    if (!res.ok) {
        throw new Error(data.error || 'Не удалось загрузить логотип');
    }
    return data;
}

function startActiveUsersPolling() {
    if (activeUsersPollTimer) {
        clearInterval(activeUsersPollTimer);
    }
    fetchActiveUsersCounts();
    activeUsersPollTimer = setInterval(fetchActiveUsersCounts, ACTIVE_USERS_POLL_INTERVAL);
}

function stopActiveUsersPolling() {
    if (activeUsersPollTimer) {
        clearInterval(activeUsersPollTimer);
        activeUsersPollTimer = null;
    }
}

function formatBytesToMB(bytes) {
    if (!bytes || isNaN(bytes)) return '0 МБ';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) {
        return `${mb.toFixed(1)} МБ`;
    }
    const kb = bytes / 1024;
    if (kb >= 1) {
        return `${kb.toFixed(1)} КБ`;
    }
    return `${bytes} Б`;
}

function formatBytesToGB(bytes) {
    if (!bytes || isNaN(bytes)) return '0 ГБ';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) {
        return `${gb.toFixed(2)} ГБ`;
    }
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) {
        return `${mb.toFixed(1)} МБ`;
    }
    const kb = bytes / 1024;
    if (kb >= 1) {
        return `${kb.toFixed(1)} КБ`;
    }
    return `${bytes} Б`;
}

async function loadAnalyticsSummary() {
    const totalPhotosEl = document.getElementById('analyticsTotalPhotos');
    const totalVideosEl = document.getElementById('analyticsTotalVideos');
    const totalSizeEl = document.getElementById('analyticsTotalSize');
    const totalEventsEl = document.getElementById('analyticsTotalEvents');
    if (!totalPhotosEl && !totalVideosEl && !totalSizeEl && !totalEventsEl) return;
    try {
        const token = await ensureAdminToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/analytics/summary`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (totalPhotosEl) totalPhotosEl.textContent = data?.totalPhotos ?? 0;
        if (totalVideosEl) totalVideosEl.textContent = data?.totalVideos ?? 0;
        if (totalEventsEl) totalEventsEl.textContent = data?.totalEvents ?? 0;
        if (totalSizeEl) totalSizeEl.textContent = formatBytesToGB(data?.totalSizeBytes || 0);
    } catch (_) {
        // ignore
    }
}

async function loadUploadsAnalytics() {
    if (!uploadsChart) return;
    try {
        const token = await ensureAdminToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/analytics/uploads-by-day?limit=7`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        const labels = (data || []).map(item => {
            if (!item?.day) return '';
            try {
                return new Date(item.day).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
            } catch (_) {
                return item.day;
            }
        });
        const photoCounts = (data || []).map(item => item?.photos || 0);
        const videoCounts = (data || []).map(item => item?.videos || 0);
        uploadsChart.data.labels = labels;
        uploadsChart.data.datasets[0].data = photoCounts;
        uploadsChart.data.datasets[1].data = videoCounts;
        uploadsChart.update();
    } catch (_) {
        // ignore errors
    }
}

async function loadEventsOverview() {
    const summaryEl = document.getElementById('eventsAnalyticsSummary');
    const bodyEl = document.getElementById('eventsAnalyticsBody');
    if (!summaryEl && !bodyEl) return;

    // Нормализует строку даты из БД (SQLite часто отдаёт 'YYYY-MM-DD HH:mm:ss' в UTC).
    // Преобразуем такие строки к локальному времени корректно.
    const toLocalDateTime = (value) => {
        if (!value) return '';
        const raw = String(value);
        // Если это формат без часового пояса 'YYYY-MM-DD HH:mm:ss' — трактуем как UTC
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
            try {
                const d = new Date(raw.replace(' ', 'T') + 'Z');
                if (!Number.isNaN(d.getTime())) {
                    return d.toLocaleString('ru-RU');
                }
            } catch (_) {}
        }
        // Иначе пытаемся обычным конструктором
        try {
            const d = new Date(raw);
            if (!Number.isNaN(d.getTime())) {
                return d.toLocaleString('ru-RU');
            }
        } catch (_) {}
        return raw;
    };
    try {
        const token = await ensureAdminToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/analytics/events/overview`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        // --- Пользовательский фильтр (только для root) ---
        const filterWrap = document.getElementById('analyticsUserFilterWrap');
        const filterEl = document.getElementById('analyticsUserFilter');
        let selectedUser = null;
        if (filterWrap && filterEl && isRootAdmin()) {
            filterWrap.style.display = '';
            const users = new Set();
            (data?.active || []).forEach(e => { if (e && e.owner_username) users.add(e.owner_username); });
            (data?.deleted || []).forEach(e => { if (e && e.owner_username) users.add(e.owner_username); });
            const prev = filterEl.value || 'all';
            const options = ['all', ...Array.from(users).sort((a,b)=>a.localeCompare(b,'ru'))];
            filterEl.innerHTML = options.map(v => `<option value="${v}" ${v===prev?'selected':''}>${v==='all'?'Все':v}</option>`).join('');
            selectedUser = prev === 'all' ? null : prev;
        } else if (filterWrap) {
            filterWrap.style.display = 'none';
        }

        if (bodyEl) {
            const items = [];
            (data?.active || []).forEach(ev => {
                if (selectedUser && ev?.owner_username !== selectedUser) return;
                const ts = ev.created_at ? Date.parse(ev.created_at) : 0;
                items.push({ kind: 'active', ts: Number.isNaN(ts) ? 0 : ts, ev });
            });
            (data?.deleted || []).forEach(ev => {
                if (selectedUser && ev?.owner_username !== selectedUser) return;
                const ts = ev.deleted_at ? Date.parse(ev.deleted_at) : 0;
                items.push({ kind: 'deleted', ts: Number.isNaN(ts) ? 0 : ts, ev });
            });
            items.sort((a, b) => b.ts - a.ts);

            bodyEl.innerHTML = items.map(item => {
                const ev = item.ev;
                if (item.kind === 'active') {
                    return `
                        <tr>
                            <td>${escapeHtml(ev.owner_username || '')}</td>
                            <td>${escapeHtml(ev.name || '')}</td>
                            <td>${toLocalDateTime(ev.created_at)}</td>
                            <td></td>
                            <td>${ev.photos_total || 0}</td>
                            <td>${ev.photos_deleted || 0}</td>
                            <td>${escapeHtml(String(ev.status || ''))}</td>
                            <td></td>
                        </tr>
                    `;
                }
                return `
                    <tr>
                        <td>${escapeHtml(ev.owner_username || '')}</td>
                        <td>${escapeHtml(ev.name || '')}</td>
                        <td>${toLocalDateTime(ev.created_at)}</td>
                        <td>${toLocalDateTime(ev.deleted_at)}</td>
                        <td>${ev.photos_total_at_delete || 0}</td>
                        <td>${ev.photos_deleted_total || 0}</td>
                        <td>Удалено</td>
                        <td>${isRootAdmin() ? `<button class="btn-small btn-danger" data-ev-del kind="deleted" data-id="${ev.event_id}" title="Удалить запись"><i class="fas fa-trash"></i></button>` : ''}</td>
                    </tr>
                `;
            }).join('');

            // Обновляем счётчики с учётом фильтра
            if (summaryEl) {
                const aCnt = (data?.active || []).filter(e => !selectedUser || e.owner_username === selectedUser).length;
                const dCnt = (data?.deleted || []).filter(e => !selectedUser || e.owner_username === selectedUser).length;
                summaryEl.innerHTML = `Активных: <b>${aCnt}</b> · Удалённых: <b>${dCnt}</b>`;
            }

            // Привязка удаления с подтверждением (однократно, без накапливания обработчиков)
            const delModal = document.getElementById('analyticsDeleteModal');
            const delText = document.getElementById('analyticsDeleteText');
            const delCancel = document.getElementById('analyticsDeleteCancel');
            const delConfirm = document.getElementById('analyticsDeleteConfirm');
            let delTarget = null;

            bodyEl.onclick = (e) => {
                const btn = e.target.closest('[data-ev-del]');
                if (!btn || !bodyEl.contains(btn)) return;
                const kind = btn.getAttribute('kind');
                const id = btn.getAttribute('data-id');
                const row = btn.closest('tr');
                const name = row ? row.children[1]?.textContent?.trim() : '';
                if (kind !== 'deleted') return;
                delTarget = { kind, id };
                if (delText) delText.textContent = `Удалить запись «${name}» из истории удалённых мероприятий?`;
                if (delModal) {
                    delModal.style.display = 'flex';
                    delModal.setAttribute('aria-hidden', 'false');
                    document.body.classList.add('modal-open');
                }
            };

            const closeDel = () => {
                if (delModal) {
                    delModal.style.display = 'none';
                    delModal.setAttribute('aria-hidden', 'true');
                    document.body.classList.remove('modal-open');
                }
                delTarget = null;
            };
            if (delCancel) delCancel.onclick = closeDel;
            if (delModal) {
                delModal.onclick = (e) => { if (e.target === delModal) closeDel(); };
            }
            if (delConfirm) {
                delConfirm.onclick = async () => {
                    if (!delTarget) return;
                    try {
                        const token2 = await ensureAdminToken();
                        const url = `${API_CONFIG.baseUrl}/analytics/events/${encodeURIComponent(delTarget.id)}/audit`;
                        const res2 = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token2}` } });
                        const d2 = await res2.json().catch(() => ({}));
                        if (!res2.ok) {
                            showNotification(d2?.error || 'Ошибка удаления', 'error');
                            return;
                        }
                        showNotification('Удалено', 'success');
                        closeDel();
                        await loadEventsOverview();
                    } catch (_) {
                        showNotification('Ошибка сервера', 'error');
                    }
                };
            }
        }
    } catch (_) {
        // ignore
    }
}

// Перезагрузка аналитики при смене фильтра пользователя
document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'analyticsUserFilter') {
        loadEventsOverview();
    }
});

function setupModeration(events) {
    const moderationContainer = document.querySelector('.moderation-grid');
    if (!moderationContainer) return;

    moderationState.events = Array.isArray(events) ? events : [];
    moderationState.selected.clear();
    const existingIds = new Set(moderationState.events.map(evt => String(evt.id)));
    Object.keys(moderationState.pendingCounts || {}).forEach((key) => {
        if (!existingIds.has(String(key))) {
            delete moderationState.pendingCounts[key];
        }
    });
    moderationState.totalPending = Object.values(moderationState.pendingCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    setModerationPendingIndicator(moderationState.totalPending || 0);

    if (!moderationState.events.length) {
        moderationState.currentEventId = null;
        moderationState.photos = [];
        moderationContainer.innerHTML = '<div class="moderation-empty">Нет мероприятий для модерации</div>';
        setModerationPendingIndicator(0, 0, 0);
        return;
    }

    const hasCurrent = moderationState.events.some(evt => String(evt.id) === String(moderationState.currentEventId));
    if (!moderationState.currentEventId || !hasCurrent) {
        moderationState.currentEventId = moderationState.events[0].id;
    }

    const options = moderationState.events.map(evt => `
        <option value="${evt.id}" ${String(evt.id) === String(moderationState.currentEventId) ? 'selected' : ''}>
            ${evt.name}
        </option>
    `).join('');

    moderationContainer.innerHTML = `
        <div class="moderation-container">
            <div class="moderation-toolbar">
                <label for="moderationEventSelect">Событие:</label>
                <select id="moderationEventSelect">${options}</select>
                <button type="button" id="refreshModerationBtn">Обновить</button>
                <button type="button" id="selectAllModerationBtn" class="selection-btn">
                    <i class="fas fa-check-double"></i> Выбрать все
                </button>
                <button type="button" id="deselectAllModerationBtn" class="selection-btn">
                    <i class="fas fa-times"></i> Убрать выделение
                </button>
                <button type="button" id="approveSelectedBtn" disabled>Одобрить выбранные</button>
                <button type="button" id="rejectSelectedBtn" disabled>Отклонить выбранные</button>
            </div>
            <div class="moderation-photos" id="moderationPhotos"></div>
        </div>
    `;

    const eventSelect = document.getElementById('moderationEventSelect');
    const refreshBtn = document.getElementById('refreshModerationBtn');
    const approveBtn = document.getElementById('approveSelectedBtn');
    const rejectBtn = document.getElementById('rejectSelectedBtn');
    const selectAllBtn = document.getElementById('selectAllModerationBtn');
    const deselectAllBtn = document.getElementById('deselectAllModerationBtn');
    const photosContainer = document.getElementById('moderationPhotos');

    eventSelect.addEventListener('change', () => {
        moderationState.currentEventId = eventSelect.value;
        moderationState.selected.clear();
        loadPendingPhotosForCurrent();
        refreshModerationPendingCounts();
    });

    refreshBtn.addEventListener('click', () => {
        loadPendingPhotosForCurrent();
        refreshModerationPendingCounts();
    });

    approveBtn.addEventListener('click', () => {
        const { photosCount, videosCount, message } = getSelectedMediaCounts();
        openModerationConfirmModal({
            action: 'approve',
            title: 'Одобрить выбранные',
            message: `Одобрить ${message}?`,
            confirmText: 'Одобрить',
            confirmClass: 'confirm-approve'
        });
    });
    rejectBtn.addEventListener('click', () => {
        const { photosCount, videosCount, message } = getSelectedMediaCounts();
        openModerationConfirmModal({
            action: 'reject',
            title: 'Отклонить выбранные',
            message: `Отклонить ${message}?`,
            confirmText: 'Отклонить',
            confirmClass: 'confirm-reject'
        });
    });

    selectAllBtn.addEventListener('click', () => {
        moderationState.photos.forEach(photo => {
            moderationState.selected.add(photo.id);
        });
        renderModerationPhotos();
    });

    deselectAllBtn.addEventListener('click', () => {
        moderationState.selected.clear();
        renderModerationPhotos();
    });

    photosContainer.addEventListener('change', (e) => {
        if (e.target.matches('.moderation-checkbox')) {
            const id = parseInt(e.target.dataset.photoId, 10);
            if (e.target.checked) {
                moderationState.selected.add(id);
            } else {
                moderationState.selected.delete(id);
            }
            e.target.closest('.moderation-item').classList.toggle('selected', e.target.checked);
            updateModerationActions();
        }
    });

    photosContainer.addEventListener('click', (e) => {
        const previewBtn = e.target.closest('.preview-btn');
        if (previewBtn) {
            const idx = parseInt(previewBtn.dataset.index, 10);
            openModerationPreview(idx);
            return;
        }
        const item = e.target.closest('.moderation-item');
        if (!item) return;
        const checkbox = item.querySelector('.moderation-checkbox');
        if (!checkbox) return;
        if (checkbox === e.target) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    photosContainer.addEventListener('dblclick', (e) => {
        const item = e.target.closest('.moderation-item');
        if (!item) return;
        const index = parseInt(item.dataset.index, 10);
        openModerationPreview(index);
    });

    loadPendingPhotosForCurrent();
}

async function loadPendingPhotosForCurrent() {
    const photosContainer = document.getElementById('moderationPhotos');
    if (!photosContainer) return;

    const eventId = moderationState.currentEventId;
    if (!eventId) {
        photosContainer.innerHTML = '<div class="moderation-empty">Выберите событие</div>';
        updateModerationActions();
        return;
    }

    try {
        const token = await ensureAdminToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/photos/event/${encodeURIComponent(eventId)}/pending`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось загрузить фото для модерации');
        }
        moderationState.photos = Array.isArray(data) ? data : [];
        moderationState.selected.clear();
        
        // Обновляем счетчики через API для получения общего количества по всем мероприятиям
        await refreshModerationPendingCounts();
        renderModerationPhotos();
    } catch (error) {
        moderationState.photos = [];
        moderationState.selected.clear();
        renderModerationPhotos();
        if (handleAuthError(error)) return;
        showNotification(error.message || 'Ошибка загрузки фото для модерации', 'error');
    }
}

function renderModerationPhotos() {
    const photosContainer = document.getElementById('moderationPhotos');
    if (!photosContainer) return;

    if (!moderationState.photos.length) {
        photosContainer.innerHTML = '<div class="moderation-empty">Нет фотографий и видео на модерации</div>';
        updateModerationActions();
        return;
    }

    photosContainer.innerHTML = moderationState.photos.map((item, index) => {
        const selected = moderationState.selected.has(item.id);
        const uploadedAt = item.uploaded_at ? new Date(item.uploaded_at).toLocaleString() : '';
        const isVideo = item.media_type === 'video';
        const mediaTypeLabel = isVideo ? 'Видео' : 'Фото';
        
        return `
            <div class="moderation-item ${selected ? 'selected' : ''} ${isVideo ? 'moderation-item--video' : 'moderation-item--photo'}" data-index="${index}" data-media-type="${isVideo ? 'video' : 'photo'}">
                <input type="checkbox" class="moderation-checkbox" data-photo-id="${item.id}" ${selected ? 'checked' : ''} />
                <div class="moderation-media-badge">
                    <i class="fas ${isVideo ? 'fa-video' : 'fa-image'}"></i>
                </div>
                ${isVideo ? `
                    <video src="${item.url}" class="moderation-thumb" preload="metadata" muted></video>
                ` : `
                    <img src="${item.url}" alt="${mediaTypeLabel} ${index + 1}" class="moderation-thumb">
                `}
                <div class="moderation-meta">
                    <small class="moderation-media-type">${mediaTypeLabel}</small>
                    ${uploadedAt ? `<small>${uploadedAt}</small>` : ''}
                    <button type="button" class="preview-btn" data-index="${index}">Просмотр</button>
                </div>
            </div>
        `;
    }).join('');

    updateModerationActions();
}

function getSelectedMediaCounts() {
    const selectedIds = Array.from(moderationState.selected);
    let photosCount = 0;
    let videosCount = 0;
    
    selectedIds.forEach(id => {
        const item = moderationState.photos.find(p => p.id === id);
        if (item) {
            if (item.media_type === 'video') {
                videosCount++;
            } else {
                photosCount++;
            }
        }
    });
    
    const parts = [];
    if (photosCount > 0) {
        parts.push(`${photosCount} фото`);
    }
    if (videosCount > 0) {
        parts.push(`${videosCount} видео`);
    }
    
    let message = '';
    if (parts.length === 0) {
        message = '0 фото';
    } else if (parts.length === 1) {
        message = parts[0];
    } else {
        message = parts.join(' и ');
    }
    
    return { photosCount, videosCount, message };
}

function updateModerationActions() {
    const approveBtn = document.getElementById('approveSelectedBtn');
    const rejectBtn = document.getElementById('rejectSelectedBtn');
    const disabled = moderationState.selected.size === 0;
    if (approveBtn) approveBtn.disabled = disabled;
    if (rejectBtn) rejectBtn.disabled = disabled;
}

async function moderateSelected(action) {
    const ids = Array.from(moderationState.selected);
    if (ids.length === 0) return;

    try {
        const token = await ensureAdminToken();
        const res = await fetch(`${API_CONFIG.baseUrl}/photos/moderate/${action}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ ids })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(data?.error || 'Не удалось выполнить действие');
        }
        showNotification(action === 'approve' ? 'Фото одобрены' : 'Фото отклонены', 'success');
        moderationState.selected.clear();
        // Remove rejected photos from local state immediately for instant UI update
        if (action === 'reject') {
            moderationState.photos = moderationState.photos.filter(p => !ids.includes(p.id));
            renderModerationPhotos();
        }
        // Обновляем счетчики по всем мероприятиям после одобрения или отклонения
        await refreshModerationPendingCounts();
        await loadEvents();
        // Reload pending photos to ensure consistency
        if (action === 'reject') {
            loadPendingPhotosForCurrent();
        } else {
            // После одобрения также обновляем список
            loadPendingPhotosForCurrent();
        }
    } catch (error) {
        if (handleAuthError(error)) return;
        showNotification(error.message || 'Ошибка при модерации фото', 'error');
    }
}

// ======= Admin language dropdown =======
function setupAdminLanguageDropdown() {
    const dropdown = document.getElementById('adminLanguageDropdown');
    if (!dropdown) return;

    const trigger = dropdown.querySelector('.language-trigger');
    const currentEl = trigger?.querySelector('[data-admin-lang]');
    const menu = dropdown.querySelector('.language-menu');
    const items = menu ? Array.from(menu.querySelectorAll('[data-lang]')) : [];

    if (!trigger || !currentEl || !menu) return;

    const DEFAULT_LANG = 'ru';

    function applyLang(lang) {
        const nextLang = items.some(item => item.dataset.lang === lang) ? lang : DEFAULT_LANG;
        if (typeof window.setLanguage === 'function') {
            window.setLanguage(nextLang);
        }
        if (currentEl) currentEl.textContent = nextLang.toUpperCase();
        document.documentElement.lang = nextLang;
        localStorage.setItem('adminLang', nextLang);
        items.forEach(item => {
            item.setAttribute('aria-selected', item.dataset.lang === nextLang ? 'true' : 'false');
        });
    }

    function closeMenu() {
        dropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function openMenu() {
        dropdown.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = trigger.getAttribute('aria-expanded') === 'true';
        if (expanded) closeMenu();
        else openMenu();
    });

    items.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            closeMenu();
            applyLang(item.dataset.lang);
        });
    });

    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) {
            closeMenu();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeMenu();
        }
    });

    const storedLang = localStorage.getItem('adminLang') || localStorage.getItem('landingLang') || DEFAULT_LANG;
    applyLang(storedLang);
}

const preuploadGalleryButton = document.querySelector('[data-branding-preupload]');
const preuploadGalleryInput = document.getElementById('brandingPreuploadInput');
if (preuploadGalleryButton && preuploadGalleryInput) {
    preuploadGalleryButton.addEventListener('click', () => {
        preuploadGalleryInput.click();
    });

    preuploadGalleryInput.addEventListener('change', async (event) => {
        const files = Array.from(event.target.files || []);
        preuploadGalleryInput.value = '';
        if (!files.length) return;

        const settingsForm = document.getElementById('settingsForm');
        const currentEventId = settingsForm?.dataset?.eventId || moderationState.currentEventId || (cachedEvents.length ? cachedEvents[0].id : null);
        if (!currentEventId) {
            showNotification('Сначала выберите событие для загрузки фото', 'error');
            return;
        }

        try {
            const token = await ensureAdminToken();
            const formData = new FormData();
            files.forEach(file => formData.append('photos', file));

            const res = await fetch(`${API_CONFIG.baseUrl}/photos/admin/${encodeURIComponent(currentEventId)}/preupload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (res.status === 401) {
                handleAuthError({ message: 'Требуется авторизация' });
                return;
            }

            if (!res.ok) {
                let errorMessage = 'Не удалось загрузить фото';
                try {
                    const data = await res.json();
                    errorMessage = data?.error || errorMessage;
                } catch (_) {
                    // ignore json parse error
                }
                showNotification(errorMessage, 'error');
                return;
            }

            showNotification('Фото успешно загружены в галерею', 'success');
        } catch (error) {
            if (handleAuthError(error)) return;
            const message = error?.message?.toLowerCase().includes('type')
                ? 'Формат файла не поддерживается'
                : 'Не удалось загрузить фото';
            showNotification(message, 'error');
        }
    });
}

// Вспомогательные функции
function showQRCode(eventId) {
    window.location.href = `qr-page.html?id=${eventId}`;
}

function toggleTelegramSettings(enabled) {
    const telegramSettings = document.querySelectorAll('.telegram-settings');
    telegramSettings.forEach(el => {
        el.style.display = enabled ? 'block' : 'none';
    });
    
    // Убираем классы ошибок при отключении уведомлений
    if (!enabled) {
        const form = document.getElementById('settingsForm');
        if (form) {
            const telegramUsernameInput = form.elements.telegramUsername;
            const telegramThresholdInput = form.elements.telegramThreshold;
            if (telegramUsernameInput) telegramUsernameInput.classList.remove('field-error');
            if (telegramThresholdInput) telegramThresholdInput.classList.remove('field-error');
        }
    }
}

function openSettings(eventId) {
    // Загружаем данные события и открываем модалку настроек
    const settingsModal = document.getElementById('settingsModal');
    const form = document.getElementById('settingsForm');
    if (!settingsModal || !form) return;

    // Сохраняем id события на форме — пригодится при сохранении
    form.dataset.eventId = String(eventId);
    
    // Обработчик для checkbox Telegram
    const telegramCheckbox = form.elements.telegramEnabled;
    if (telegramCheckbox) {
        // Устанавливаем начальное состояние
        toggleTelegramSettings(telegramCheckbox.checked);
        // Добавляем обработчик изменения
        telegramCheckbox.addEventListener('change', (e) => {
            toggleTelegramSettings(e.target.checked);
        });
    }
    
    // Убираем классы ошибок при вводе в поля Telegram
    const telegramUsernameInput = form.elements.telegramUsername;
    const telegramThresholdInput = form.elements.telegramThreshold;
    if (telegramUsernameInput) {
        telegramUsernameInput.addEventListener('input', () => {
            telegramUsernameInput.classList.remove('field-error');
        });
    }
    if (telegramThresholdInput) {
        telegramThresholdInput.addEventListener('input', () => {
            telegramThresholdInput.classList.remove('field-error');
        });
    }

    // Сбрасываем активную вкладку на первую
    document.querySelectorAll('.settings-tabs .tab-btn').forEach((t, idx) => {
        t.classList.toggle('active', idx === 0);
    });
    document.querySelectorAll('.settings-content').forEach((c, idx) => {
        c.classList.toggle('active', idx === 0);
    });

    const backgroundFileInput = form.elements.backgroundFile;
    const backgroundHiddenInput = form.elements.backgroundImage;
    if (backgroundFileInput) backgroundFileInput.value = '';
    if (backgroundHiddenInput) backgroundHiddenInput.value = '';
    form.dataset.removeBackground = 'false';
    form.dataset.existingBackground = '';
    revokeBrandingPreviewUrl();
    setBrandingPreview(form, '');

    const logoFileInput = form.elements.logoFile;
    if (logoFileInput) logoFileInput.value = '';
    form.dataset.removeLogo = 'false';
    form.dataset.existingLogo = '';
    revokeBrandingLogoPreviewUrl();
    setBrandingLogoPreview(form, '');

    // Префилл значений из API
    (async () => {
        try {
            const res = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.events}/${encodeURIComponent(eventId)}`);
            if (!res.ok) throw new Error('Не удалось загрузить данные события');
            const evt = await res.json();
            // Основные данные
            if (form.elements.eventName) form.elements.eventName.value = evt.name || '';
            if (form.elements.eventDate) {
                if (evt.date) {
                    form.elements.eventDate.value = evt.date;
                } else if (evt.scheduled_start_at) {
                    const parsedDate = new Date(evt.scheduled_start_at);
                    if (!Number.isNaN(parsedDate.getTime())) {
                        form.elements.eventDate.value = formatDateForInputValue(parsedDate);
                    }
                }
            }
            if (form.elements.eventTime) {
                form.elements.eventTime.step = '60';
                form.elements.eventTime.value = evt.scheduled_start_at
                    ? toTimeInputValue(evt.scheduled_start_at)
                    : getDefaultStartTimeValue();
            }
            if (form.elements.eventDescription) form.elements.eventDescription.value = evt.description || '';
            // Приватность
            form.elements.requireModeration.checked = Boolean(evt.require_moderation);
            if (form.elements.viewAccess) {
                form.elements.viewAccess.value = evt.view_access || 'public';
                // Обновляем видимость поля пароля
                const viewPasswordGroup = form.querySelector('.view-password-group');
                if (viewPasswordGroup) {
                    viewPasswordGroup.style.display = form.elements.viewAccess.value === 'private' ? 'block' : 'none';
                }
            }
            if (form.elements.viewPassword) {
                form.elements.viewPassword.value = evt.view_password || '';
            }
            // Автоудаление
            if (form.elements.deleteAfter) form.elements.deleteAfter.value = String(evt.auto_delete_days || 14);
            if (form.elements.notifyBeforeDelete) form.elements.notifyBeforeDelete.checked = Boolean(evt.notify_before_delete);
            // Брендинг
            if (form.elements.primaryColor) form.elements.primaryColor.value = evt.branding_color || '#000000';
            if (form.elements.backgroundImage) form.elements.backgroundImage.value = evt.branding_background || '';
            form.dataset.existingBackground = evt.branding_background || '';
            if (evt.branding_background_url) {
                setBrandingPreview(form, evt.branding_background_url);
            } else {
                setBrandingPreview(form, '');
            }
            if (evt.branding_logo_url) {
                setBrandingLogoPreview(form, evt.branding_logo_url);
                form.dataset.existingLogo = evt.branding_logo || '';
            } else {
                setBrandingLogoPreview(form, '');
                form.dataset.existingLogo = '';
            }
            // Telegram настройки
            if (form.elements.telegramEnabled) {
                form.elements.telegramEnabled.checked = Boolean(evt.telegram_enabled);
                toggleTelegramSettings(evt.telegram_enabled);
            }
            if (form.elements.telegramUsername) form.elements.telegramUsername.value = evt.telegram_username || '';
            if (form.elements.telegramThreshold) form.elements.telegramThreshold.value = evt.telegram_threshold || 10;
        } catch (_) {
            // При ошибке просто открываем модалку с дефолтными значениями
        } finally {
            settingsModal.style.display = 'flex';
        }
    })();
}

// Удаление события с подтверждением
async function deleteEvent(eventId) {
    const confirmed = confirm('Удалить мероприятие и все его фото? Это действие необратимо.');
    if (!confirmed) return;
    try {
        const token = await ensureAdminToken();
        const res = await fetch(`${API_CONFIG.baseUrl}${API_CONFIG.endpoints.events}/${encodeURIComponent(eventId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Не удалось удалить мероприятие');
        }
        showNotification('Мероприятие удалено', 'success');
        await loadEvents();
    } catch (e) {
        if (handleAuthError(e)) return;
        showNotification(e.message || 'Ошибка при удалении', 'error');
    }
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && eventStatusModal && eventStatusModal.style.display === 'flex') {
        closeEventStatusModal();
    }
});
