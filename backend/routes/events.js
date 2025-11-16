const router = require('express').Router();
const db = require('../db/database');
const auth = require('../middleware/auth');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const ACTIVE_USER_TTL_MS = 45 * 1000;
const activeUsers = new Map();
const uploadsDir = path.resolve(path.join(__dirname, '..', 'uploads'));

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

ensureDir(uploadsDir);

function slugify(text) {
    return String(text || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\-_.\s]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase();
}

function toPosixPath(parts) {
    return parts.join('/').replace(/\\/g, '/');
}

function buildBackgroundPaths(eventId, eventName) {
    const baseName = eventName ? `${eventId}-${slugify(eventName)}` : String(eventId);
    const segments = [baseName, 'branding'];
    const destPath = path.join(uploadsDir, ...segments);
    ensureDir(destPath);
    const posixDir = toPosixPath(segments);
    return { destPath, posixDir };
}

function getUploadsUrl(req, relativePath) {
    if (!relativePath) return '';
    const clean = String(relativePath).replace(/^\/+/, '');
    return `${req.protocol}://${req.get('host')}/uploads/${clean}`;
}

function attachBrandingUrl(req, row) {
    if (!row) return;
    row.branding_background_url = row.branding_background ? getUploadsUrl(req, row.branding_background) : '';
}

function cleanupInactiveUsers(eventId, now = Date.now()) {
    const key = String(eventId);
    const registry = activeUsers.get(key);
    if (!registry) return 0;

    for (const [clientId, timestamp] of registry.entries()) {
        if (!timestamp || now - timestamp > ACTIVE_USER_TTL_MS) {
            registry.delete(clientId);
        }
    }

    if (registry.size === 0) {
        activeUsers.delete(key);
        return 0;
    }

    return registry.size;
}

function registerActiveUser(eventId, clientId) {
    if (!clientId) return 0;
    const key = String(eventId);
    const now = Date.now();
    const registry = activeUsers.get(key) || new Map();
    registry.set(clientId, now);
    activeUsers.set(key, registry);
    return cleanupInactiveUsers(eventId, now);
}

function unregisterActiveUser(eventId, clientId) {
    const key = String(eventId);
    const registry = activeUsers.get(key);
    if (!registry) return 0;

    registry.delete(clientId);
    if (registry.size === 0) {
        activeUsers.delete(key);
        return 0;
    }
    return cleanupInactiveUsers(eventId);
}

function getActiveUsersSnapshot() {
    const now = Date.now();
    const snapshot = {};
    for (const [eventId, registry] of activeUsers.entries()) {
        const count = cleanupInactiveUsers(eventId, now);
        if (count > 0) {
            snapshot[eventId] = count;
        }
    }
    return snapshot;
}

const { getAutoEndDurationMs } = require('../utils/eventTiming');

const EVENT_STATUSES = ['scheduled', 'live', 'paused', 'ended'];

function normalizeEventStatus(status) {
    const normalized = String(status || '').toLowerCase();
    return EVENT_STATUSES.includes(normalized) ? normalized : 'scheduled';
}

function canTransitionStatus(current, next) {
    if (current === next) return false;
    if (current === 'ended') return false;
    switch (next) {
        case 'live':
            return current === 'scheduled' || current === 'paused';
        case 'paused':
            return current === 'live';
        case 'ended':
            return current === 'scheduled' || current === 'live' || current === 'paused';
        default:
            return false;
    }
}

function combineDateAndTime(dateStr, timeStr) {
    if (!dateStr) return null;
    const safeDate = String(dateStr).trim();
    let safeTime = String(timeStr ?? '').trim();
    // нормализуем возможные пробелы в выражении времени вида '19 : 30'
    if (/^\d{1,2}\s*:\s*\d{2}$/.test(safeTime)) {
        safeTime = safeTime.replace(/\s+/g, '');
    }
    const isoCandidate = safeTime
        ? `${safeDate}T${safeTime.length === 5 ? `${safeTime}:00` : safeTime}`
        : `${safeDate}T00:00:00`;
    const parsed = new Date(isoCandidate);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

function ensureAutoEnd(currentAutoEnd, fallbackBaseMs) {
    const parsed = currentAutoEnd ? Date.parse(currentAutoEnd) : NaN;
    if (!Number.isNaN(parsed) && parsed > Date.now()) {
        return new Date(parsed).toISOString();
    }
    const baseMs = Number.isFinite(fallbackBaseMs) ? fallbackBaseMs : Date.now();
    return new Date(baseMs + getAutoEndDurationMs()).toISOString();
}

// Создание нового события
router.post('/', auth, async (req, res) => {
    const body = req.body || {};
    const name = body.name;
    const date = body.date;
    const description = body.description;
    const startTime = body.startTime ?? body.time ?? body.start_time;
    const defaultBrandingColor = '#f5f5f5';
    const scheduledStartAt = combineDateAndTime(date, startTime);
    const autoEndAt = null;
    
    try {
        const ownerId = req.user && req.user.userId ? req.user.userId : null;
        db.run(
            `INSERT INTO events (name, date, description, branding_color, scheduled_start_at, auto_end_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, date, description, defaultBrandingColor, scheduledStartAt, autoEndAt, ownerId],
            function(err) {
                if (err) {
                    return res.status(400).json({ error: err.message });
                }
                
                const eventId = this.lastID;
                // Используем hash-параметры, чтобы статические сервера не срезали query
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'; //заменить когда буду переходить на боевой режим
                const accessLink = `${frontendUrl}/gallery.html#event=${eventId}&date=${encodeURIComponent(date || '')}`;
                
                QRCode.toDataURL(accessLink, (err, qrCode) => {
                    const qrValue = err ? '' : qrCode;
                    db.run(
                        `UPDATE events SET qr_code = ?, access_link = ? WHERE id = ?`,
                        [qrValue, accessLink, eventId],
                        (uErr) => {
                            if (uErr) {
                                return res.status(201).json({
                                    id: eventId,
                                    name,
                                    date,
                                    description,
                                    qrCode: qrValue,
                                    access_link: accessLink,
                                    status: 'scheduled',
                                    scheduled_start_at: scheduledStartAt,
                                    auto_end_at: autoEndAt,
                                    warning: 'created_without_qr'
                                });
                            }
                            res.status(201).json({
                                id: eventId,
                                name,
                                date,
                                description,
                                qrCode: qrValue,
                                access_link: accessLink,
                                status: 'scheduled',
                                scheduled_start_at: scheduledStartAt,
                                auto_end_at: autoEndAt
                            });
                        }
                    );
                });
            }
        );
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Получение всех событий (требует авторизации; обычный пользователь видит только свои)
router.get('/', auth, (req, res) => {
    const isRoot = req.user && req.user.role === 'root';
    const params = [];
    let sql;
    if (isRoot) {
        sql = `
            SELECT e.*,
                   u.username AS owner_username,
                   u.display_name AS owner_display_name
            FROM events e
            LEFT JOIN users u ON u.id = e.owner_id
            ORDER BY e.created_at DESC
        `;
    } else {
        sql = `
            SELECT e.*
            FROM events e
            WHERE e.owner_id = ?
            ORDER BY e.created_at DESC
        `;
        params.push(req.user.userId);
    }

    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const now = Date.now();
        (rows || []).forEach(row => {
            row.active_users = cleanupInactiveUsers(row.id, now);
            attachBrandingUrl(req, row);
            // если по какой-то причине ссылка отсутствует — сгенерируем заново (используем обычный id)
            if (!row.access_link) {
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                row.access_link = `${frontendUrl}/gallery.html#event=${row.id}&date=${encodeURIComponent(row.date || '')}`;
            }
        });
        res.json((rows || []).map(row => ({
            ...row,
            status: normalizeEventStatus(row.status)
        })));
    });
});

router.get('/active-users', auth, (req, res) => {
    res.json(getActiveUsersSnapshot());
});

// Получение конкретного события
router.get('/:id', (req, res) => {
    db.get(`SELECT * FROM events WHERE id = ?`, [req.params.id], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Событие не найдено' });
        }
        row.active_users = cleanupInactiveUsers(row.id);
        attachBrandingUrl(req, row);
        row.status = normalizeEventStatus(row.status);
        res.json(row);
    });
});

router.post('/:id/status', auth, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    if (!eventId) {
        return res.status(400).json({ error: 'Invalid event id' });
    }

    const requestedStatus = normalizeEventStatus(req.body?.status);
    if (!['live', 'paused', 'ended'].includes(requestedStatus)) {
        return res.status(400).json({ error: 'Недопустимый статус мероприятия' });
    }

    db.get(`SELECT id, name, status, scheduled_start_at, auto_end_at, owner_id FROM events WHERE id = ?`, [eventId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            return res.status(404).json({ error: 'Событие не найдено' });
        }
        const isRoot = req.user && req.user.role === 'root';
        if (!isRoot && row.owner_id !== req.user.userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const currentStatus = normalizeEventStatus(row.status);
        if (currentStatus === 'ended' && requestedStatus !== 'ended') {
            return res.status(400).json({ error: 'Мероприятие завершено и не может быть запущено заново' });
        }

        if (currentStatus === requestedStatus) {
            return res.json({ id: row.id, status: currentStatus });
        }

        if (!canTransitionStatus(currentStatus, requestedStatus)) {
            return res.status(400).json({ error: 'Недопустимый переход статуса' });
        }

        const now = Date.now();
        const nowIso = new Date(now).toISOString();
        const startMs = row.scheduled_start_at ? Date.parse(row.scheduled_start_at) : NaN;

        if (requestedStatus === 'live') {
            const scheduledStartAt = row.scheduled_start_at || nowIso;
            const baseMs = Number.isNaN(startMs) ? now : startMs;
            const autoEndAt = ensureAutoEnd(row.auto_end_at, baseMs);

            db.run(
                `UPDATE events SET status = ?, scheduled_start_at = ?, auto_end_at = ? WHERE id = ?`,
                [requestedStatus, scheduledStartAt, autoEndAt, eventId],
                (updateErr) => {
                    if (updateErr) {
                        return res.status(500).json({ error: updateErr.message });
                    }
                    res.json({ id: eventId, status: requestedStatus, scheduled_start_at: scheduledStartAt, auto_end_at: autoEndAt });
                }
            );
            return;
        }

        if (requestedStatus === 'ended') {
            const autoEndAt = ensureAutoEnd(row.auto_end_at, now);
            db.run(
                `UPDATE events SET status = ?, auto_end_at = ? WHERE id = ?`,
                [requestedStatus, autoEndAt, eventId],
                (updateErr) => {
                    if (updateErr) {
                        return res.status(500).json({ error: updateErr.message });
                    }
                    activeUsers.delete(String(eventId));
                    res.json({ id: eventId, status: requestedStatus, auto_end_at: autoEndAt });
                }
            );
            return;
        }

        // requestedStatus === 'paused'
        db.run(`UPDATE events SET status = ? WHERE id = ?`, [requestedStatus, eventId], (updateErr) => {
            if (updateErr) {
                return res.status(500).json({ error: updateErr.message });
            }
            res.json({ id: eventId, status: requestedStatus });
        });
    });
});

// (Удалены маршруты share/resolve; возвращаемся к id в ссылке)

router.post('/:id/branding/background', auth, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    if (!eventId) {
        return res.status(400).json({ error: 'Invalid event id' });
    }
    db.get(`SELECT id, name, branding_background, owner_id FROM events WHERE id = ?`, [eventId], (err, eventRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!eventRow) return res.status(404).json({ error: 'Событие не найдено' });
        const isRoot = req.user && req.user.role === 'root';
        if (!isRoot && eventRow.owner_id !== req.user.userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { destPath, posixDir } = buildBackgroundPaths(eventRow.id, eventRow.name);
        const storage = multer.diskStorage({
            destination: (reqUpload, file, cb) => cb(null, destPath),
            filename: (reqUpload, file, cb) => {
                const ext = path.extname(file.originalname) || '.jpg';
                cb(null, `background-${Date.now()}${ext}`);
            }
        });
        const upload = multer({
            storage,
            limits: { fileSize: 10 * 1024 * 1024 },
            fileFilter: (reqUpload, file, cb) => {
                const isImage = /^image\/(jpe?g|png|webp|gif)$/i.test(file.mimetype);
                cb(isImage ? null : new Error('Неверный формат изображения'), isImage);
            }
        }).single('background');

        upload(req, res, (uploadErr) => {
            if (uploadErr) {
                return res.status(400).json({ error: uploadErr.message });
            }
            if (!req.file) {
                return res.status(400).json({ error: 'Файл не найден' });
            }

            const storedRelative = `${posixDir}/${req.file.filename}`;
            const previousBackground = eventRow.branding_background ? path.join(uploadsDir, eventRow.branding_background) : null;

            db.run(`UPDATE events SET branding_background = ? WHERE id = ?`, [storedRelative, eventId], function(updateErr) {
                if (updateErr) {
                    // попытаться удалить загруженный файл при ошибке
                    try { fs.unlinkSync(path.join(destPath, req.file.filename)); } catch (_) {}
                    return res.status(500).json({ error: updateErr.message });
                }
                if (previousBackground && previousBackground !== path.join(destPath, req.file.filename)) {
                    fs.unlink(previousBackground, () => {});
                }
                const url = getUploadsUrl(req, storedRelative);
                res.json({ path: storedRelative, url });
            });
        });
    });
});

router.post('/:id/active', (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    const clientId = req.body?.clientId;
    if (!eventId || !clientId) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }
    const count = registerActiveUser(eventId, clientId);
    res.json({ count });
});

router.post('/:id/active/leave', (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    const clientId = req.body?.clientId;
    if (!eventId || !clientId) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }
    const count = unregisterActiveUser(eventId, clientId);
    res.json({ count });
});

// Обновление настроек события [protected]
router.put('/:id', auth, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });

    db.get(`SELECT * FROM events WHERE id = ?`, [eventId], (selectErr, existingRow) => {
        if (selectErr) return res.status(500).json({ error: selectErr.message });
        if (!existingRow) return res.status(404).json({ error: 'Событие не найдено' });
        const isRoot = req.user && req.user.role === 'root';
        if (!isRoot && existingRow.owner_id !== req.user.userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const body = req.body || {};
        const name = body.name || '';
        const date = body.date || '';
        const description = body.description || '';
        const startTime = body.start_time || body.startTime || body.time || '';
        const requireModerationRaw = body.require_moderation ?? body.requireModeration;
        const uploadAccess = body.upload_access || body.uploadAccess || 'all';
        const viewAccess = body.view_access || body.viewAccess || 'link';
        const autoDeleteDaysRaw = body.auto_delete_days ?? body.autoDeleteDays;
        const brandingColor = body.branding_color || body.primaryColor || body.brandingColor || '';
        const brandingBackground = body.branding_background || body.backgroundImage || body.brandingBackground || '';
        const notifyBeforeDelete = (body.notify_before_delete ?? body.notifyBeforeDelete) ? 1 : 0;

        const requireModeration = requireModerationRaw ? 1 : 0;
        let autoDeleteDays = parseInt(autoDeleteDaysRaw ?? 14, 10);
        if (!Number.isFinite(autoDeleteDays) || autoDeleteDays < 0) autoDeleteDays = 0;

        let scheduledStartAt = existingRow.scheduled_start_at;
        if (date && startTime) {
            const combined = combineDateAndTime(date, startTime);
            if (combined) {
                scheduledStartAt = combined;
            }
        } else if (!scheduledStartAt && date) {
            const combined = combineDateAndTime(date, startTime || '00:00');
            if (combined) {
                scheduledStartAt = combined;
            }
        }

        const currentStatus = normalizeEventStatus(existingRow.status);
        let autoEndAt = existingRow.auto_end_at;
        if (currentStatus === 'scheduled') {
            autoEndAt = null;
        } else if (!autoEndAt && (currentStatus === 'live' || currentStatus === 'paused')) {
            const baseMs = scheduledStartAt ? Date.parse(scheduledStartAt) : Date.now();
            autoEndAt = ensureAutoEnd(null, Number.isNaN(baseMs) ? Date.now() : baseMs);
        }

        db.run(
            `UPDATE events
             SET name = ?,
                 date = ?,
                 description = ?,
                 require_moderation = ?,
                 upload_access = ?,
                 view_access = ?,
                 auto_delete_days = ?,
                 branding_color = ?,
                 branding_background = ?,
                 notify_before_delete = ?,
                 scheduled_start_at = ?,
                 auto_end_at = ?
             WHERE id = ?`,
            [name, date, description, requireModeration, uploadAccess, viewAccess, autoDeleteDays, brandingColor, brandingBackground, notifyBeforeDelete, scheduledStartAt, autoEndAt, eventId],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: 'Событие не найдено' });

                const previousBackground = existingRow.branding_background || '';
                const newBackground = brandingBackground || '';
                if (previousBackground && previousBackground !== newBackground) {
                    fs.unlink(path.join(uploadsDir, previousBackground), () => {});
                }

                db.get(`SELECT * FROM events WHERE id = ?`, [eventId], (getErr, row) => {
                    if (getErr) return res.status(500).json({ error: getErr.message });
                    attachBrandingUrl(req, row);
                    res.json(row);
                });
            }
        );
    });
});

// Удаление события и связанных фото [protected]
router.delete('/:id', auth, (req, res) => {
    const eventId = parseInt(req.params.id, 10);
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });

    db.serialize(() => {
        db.get(`SELECT id, name, created_at, branding_background, owner_id, deleted_photo_count FROM events WHERE id = ?`, [eventId], (brandingErr, brandingRow) => {
            if (brandingErr) return res.status(500).json({ error: brandingErr.message });
            if (!brandingRow) return res.status(404).json({ error: 'Событие не найдено' });
            const isRoot = req.user && req.user.role === 'root';
            if (!isRoot && brandingRow.owner_id !== req.user.userId) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            db.all(`SELECT filename FROM photos WHERE event_id = ?`, [eventId], (selectErr, rows) => {
                if (selectErr) return res.status(500).json({ error: selectErr.message });

                const dirsToRemove = new Set();
                (rows || []).forEach(r => {
                    const rel = r.filename || '';
                    const filePath = path.join(uploadsDir, rel);
                    const dirPath = path.dirname(filePath);
                    dirsToRemove.add(dirPath);
                    fs.unlink(filePath, () => {});
                });

                const brandingPath = brandingRow?.branding_background
                    ? path.join(uploadsDir, brandingRow.branding_background)
                    : null;
                if (brandingPath) {
                    fs.unlink(brandingPath, () => {});
                    dirsToRemove.add(path.dirname(brandingPath));
                }

                const removedPhotos = (rows || []).length;

                db.run(`DELETE FROM photos WHERE event_id = ?`, [eventId], (photosErr) => {
                    if (photosErr) return res.status(500).json({ error: photosErr.message });
                    db.run(`DELETE FROM events WHERE id = ?`, [eventId], function(eventErr) {
                        if (eventErr) return res.status(500).json({ error: eventErr.message });
                        if (this.changes === 0) return res.status(404).json({ error: 'Событие не найдено' });
                        activeUsers.delete(String(eventId));

                        // Аудит удаления мероприятия
                        const deletedAt = new Date().toISOString();
                        db.run(
                            `INSERT INTO event_audit (event_id, owner_id, name, created_at, deleted_at, total_photos_at_delete, deleted_photos_cumulative)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [brandingRow.id, brandingRow.owner_id, brandingRow.name || '', brandingRow.created_at || null, deletedAt, removedPhotos, Number(brandingRow.deleted_photo_count) || 0]
                        );

                        dirsToRemove.forEach(dir => {
            if (dir && path.resolve(dir) !== uploadsDir) {
                                fs.rm(dir, { recursive: true, force: true }, () => {});
                            }
                        });
                        res.json({ deleted: true });
                    });
                });
            });
        });
    });
});

module.exports = router;
