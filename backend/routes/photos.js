const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const multer = require('multer');
const auth = require('../middleware/auth');
const db = require('../db/database');
const archiver = require('archiver');
const sharp = require('sharp');
const telegramNotifier = require('../services/telegramNotifier');

// Ensure uploads directory exists
const uploadsDir = path.resolve(path.join(__dirname, '..', 'uploads'));

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

ensureDir(uploadsDir);

function slugify(text) {
    return String(text || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '') // remove diacritics
        .replace(/[^a-zA-Z0-9\-_.\s]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase();
}

const uploadLimits = {
    fileSize: 10 * 1024 * 1024 // 10MB
};

function fileFilter(req, file, cb) {
    const isImage = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype);
    cb(isImage ? null : new Error('Invalid file type'), isImage);
}

function toPosixPath(parts) {
    return parts.join('/').replace(/\\/g, '/');
}

function createUploadMiddleware(eventId, eventName, requireModeration, createdAt) {
    // Форматируем дату создания в формат YYYY-MM-DD
    let dateStr = '';
    if (createdAt) {
        try {
            const date = new Date(createdAt);
            if (!isNaN(date.getTime())) {
                dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
            }
        } catch (e) {
            // Если не удалось распарсить дату, используем текущую дату
            dateStr = new Date().toISOString().split('T')[0];
        }
    } else {
        dateStr = new Date().toISOString().split('T')[0];
    }
    
    // Формат: id-event_имя-мероприятия_дата-создания
    const eventNameSlug = eventName ? slugify(eventName) : 'event';
    const baseName = `${eventId}-event_${eventNameSlug}_${dateStr}`;
    const segments = [baseName];
    if (requireModeration) {
        segments.push('pending');
    }
    const destPath = path.join(uploadsDir, ...segments);
    ensureDir(destPath);
    const posixSubdir = toPosixPath(segments);

    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            req.uploadSubdir = posixSubdir;
            cb(null, destPath);
        },
        filename: (req, file, cb) => {
            const safeOriginal = path.basename(file.originalname).replace(/[^a-zA-Z0-9_.\-]+/g, '_');
            cb(null, `${Date.now()}-${safeOriginal}`);
        }
    });

    return multer({ storage, limits: uploadLimits, fileFilter }).array('photos');
}

function getFileUrl(req, filename) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return `${origin}/uploads/${filename}`;
}

async function generatePreviewForFile(file, uploadSubdir) {
    const ext = path.extname(file.filename) || '.jpg';
    const baseName = path.basename(file.filename, ext);
    const previewFileName = `${baseName}-preview.jpg`;
    const previewRelative = uploadSubdir ? `${uploadSubdir}/${previewFileName}` : previewFileName;
    const previewAbsPath = path.join(uploadsDir, previewRelative);

    // Use sharp with proper cleanup - read file as buffer to avoid keeping descriptor open
    let fileBuffer = null;
    let sharpInstance = null;
    try {
        // Read entire file into buffer first, then close the file descriptor
        fileBuffer = await fsPromises.readFile(file.path);
        
        // Process with sharp using buffer instead of file path
        sharpInstance = sharp(fileBuffer);
        await sharpInstance
            .rotate()
            .resize({
                width: 1024,
                height: 1024,
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: 75 })
            .toFile(previewAbsPath);
    } finally {
        // Clear buffer reference to help GC
        fileBuffer = null;
        
        // Ensure sharp instance is properly cleaned up
        if (sharpInstance) {
            try {
                sharpInstance.destroy();
            } catch (destroyErr) {
                // Ignore destroy errors
            }
        }
        
        // Additional delay to ensure file descriptors are released
        await new Promise(resolve => setTimeout(resolve, 150));
    }

    return previewRelative;
}

function performPhotoUpload({ req, res, eventId, eventRow, skipStatusCheck = false }) {
    if (!skipStatusCheck) {
        const status = String(eventRow.status || '').toLowerCase();
        if (status === 'ended') {
            res.status(403).json({ error: 'Мероприятие завершено. Загрузка фотографий недоступна.' });
            return;
        }
        if (status === 'scheduled') {
            res.status(403).json({ error: 'Мероприятие еще не началось. Загрузка фотографий недоступна.' });
            return;
        }
        if (status === 'paused') {
            res.status(403).json({ error: 'Мероприятие приостановлено. Загрузка фотографий недоступна.' });
            return;
        }
    }

    const uploader = createUploadMiddleware(eventId, eventRow.name, Boolean(eventRow.require_moderation), eventRow.created_at);

    uploader(req, res, async (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({ error: uploadErr.message });
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        let filesWithPreviews;
        try {
            filesWithPreviews = await Promise.all(
                req.files.map(async (file) => {
                    const storedRelative = req.uploadSubdir ? `${req.uploadSubdir}/${file.filename}` : file.filename;
                    let previewRelative = null;
                    try {
                        previewRelative = await generatePreviewForFile(file, req.uploadSubdir);
                    } catch (previewErr) {
                        // Если не удалось создать превью, продолжаем только с оригиналом
                        previewRelative = null;
                    }
                    
                    return { 
                        file, 
                        storedRelative, 
                        previewRelative
                    };
                })
            );
        } catch (err) {
            return res.status(500).json({ error: err.message || 'Failed to generate previews' });
        }

        // Определяем начальный статус: если требуется модерация - ставим pending
        const initialStatus = eventRow.require_moderation ? 'pending' : 'approved';

        // Получаем owner_id события для истории загрузок
        db.get(`SELECT owner_id FROM events WHERE id = ?`, [eventId], (err, eventOwnerRow) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            const ownerId = eventOwnerRow?.owner_id || null;

            const stmt = db.prepare(`INSERT INTO photos (event_id, filename, original_name, status, preview_filename) VALUES (?, ?, ?, ?, ?)`);
            const historyStmt = db.prepare(`INSERT INTO photo_uploads_history (event_id, photo_id, owner_id, uploaded_at) VALUES (?, ?, ?, datetime('now'))`);
            
            let insertedCount = 0;
            let errorCount = 0;
            const files = [];
            
            db.serialize(() => {
                filesWithPreviews.forEach(({ file, storedRelative, previewRelative }) => {
                    stmt.run(eventId, storedRelative, file.originalname, initialStatus, previewRelative, function(insertErr) {
                        if (insertErr) {
                            console.error('Error inserting photo:', insertErr);
                            errorCount++;
                            // Проверяем, все ли операции завершены (включая ошибки)
                            if (insertedCount + errorCount === filesWithPreviews.length) {
                                stmt.finalize();
                                historyStmt.finalize();
                                if (errorCount === filesWithPreviews.length) {
                                    return res.status(500).json({ error: 'Failed to insert photos' });
                                }
                                // Если хотя бы одна фото вставлена, обновляем счетчик
                                if (insertedCount > 0) {
                                    db.run(`UPDATE events SET photo_count = photo_count + ? WHERE id = ?`, [insertedCount, eventId], (updateErr) => {
                                        if (updateErr) {
                                            console.error('Error updating photo_count:', updateErr);
                                        }
                                        res.status(201).json({ uploaded: files });
                                    });
                                } else {
                                    res.status(201).json({ uploaded: files });
                                }
                            }
                            return;
                        }
                        const photoId = this.lastID;
                        // Записываем в историю загрузок
                        historyStmt.run(eventId, photoId, ownerId, (historyErr) => {
                            if (historyErr) {
                                console.error('Error inserting into photo_uploads_history:', historyErr);
                            }
                        });
                        insertedCount++;
                        
                        files.push({
                            id: photoId,
                            event_id: eventId,
                            filename: storedRelative,
                            original_name: file.originalname,
                            status: initialStatus,
                            url: getFileUrl(req, storedRelative),
                            preview_url: previewRelative ? getFileUrl(req, previewRelative) : getFileUrl(req, storedRelative)
                        });
                        
                        // Когда все фото обработаны
                        if (insertedCount + errorCount === filesWithPreviews.length) {
                            stmt.finalize();
                            historyStmt.finalize((historyErr) => {
                                if (historyErr) {
                                    console.error('Error finalizing history stmt:', historyErr);
                                }
                                if (insertedCount > 0) {
                                    db.run(`UPDATE events SET photo_count = photo_count + ? WHERE id = ?`, [insertedCount, eventId], (updateErr) => {
                                        if (updateErr) {
                                            return res.status(500).json({ error: updateErr.message });
                                        }
                                        res.status(201).json({ uploaded: files });
                                        
                                        // Проверяем и отправляем Telegram уведомление в фоне
                                        (async () => {
                                            try {
                                                db.get(`SELECT name, telegram_enabled, telegram_username, telegram_threshold FROM events WHERE id = ?`, [eventId], async (err, eventRow) => {
                                                    if (!err && eventRow) {
                                                        await telegramNotifier.checkAndNotify(
                                                            eventId,
                                                            eventRow.name,
                                                            eventRow.telegram_enabled,
                                                            eventRow.telegram_username,
                                                            eventRow.telegram_threshold
                                                        );
                                                    }
                                                });
                                            } catch (notifyErr) {
                                                console.error('[Telegram] Ошибка при проверке уведомлений:', notifyErr.message);
                                            }
                                        })();
                                    });
                                } else {
                                    res.status(201).json({ uploaded: files });
                                }
                            });
                        }
                    });
                });
            });
        });
    });
}

// Upload photos for an event
router.post('/upload', (req, res) => {
    const eventId = parseInt(req.query.event, 10);
    if (!eventId) {
        return res.status(400).json({ error: 'event query parameter is required' });
    }

    db.get(`SELECT name, require_moderation, status, created_at FROM events WHERE id = ?`, [eventId], (err, eventRow) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!eventRow) {
            return res.status(404).json({ error: 'Event not found' });
        }

        performPhotoUpload({ req, res, eventId, eventRow, skipStatusCheck: false });
    });
});

router.post('/admin/:eventId/preupload', auth, (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    if (!eventId) {
        return res.status(400).json({ error: 'Invalid event id' });
    }

    db.get(`SELECT id, name, require_moderation, status, owner_id, created_at FROM events WHERE id = ?`, [eventId], (err, eventRow) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!eventRow) {
            return res.status(404).json({ error: 'Event not found' });
        }

        const isRoot = req.user && req.user.role === 'root';
        if (!isRoot && eventRow.owner_id !== req.user.userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        performPhotoUpload({ req, res, eventId, eventRow, skipStatusCheck: true });
    });
});

// Helper function to get file URL with fallback to pending if file doesn't exist
// Note: This is a synchronous check, but it's fast for file existence
function getFileUrlWithFallback(req, filename) {
    if (!filename) return '';
    try {
        const filePath = path.join(uploadsDir, filename);
        // Check if file exists, if not, try pending version
        if (!fs.existsSync(filePath) && !filename.includes('pending')) {
            const segments = filename.split('/').filter(Boolean);
            const pendingFilename = [...segments.slice(0, -1), 'pending', segments[segments.length - 1]].join('/');
            const pendingPath = path.join(uploadsDir, pendingFilename);
            if (fs.existsSync(pendingPath)) {
                return getFileUrl(req, pendingFilename);
            }
        }
    } catch (err) {
        // If check fails, just return original URL
        console.warn(`Error checking file existence for ${filename}:`, err.message);
    }
    return getFileUrl(req, filename);
}

// List photos by event
router.get('/event/:eventId', (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    const sort = req.query.sort === 'likes' ? 'likes' : 'date';
    const orderClause = sort === 'likes'
        ? `ORDER BY likes DESC, uploaded_at DESC`
        : `ORDER BY uploaded_at DESC`;
    db.all(`SELECT id, event_id, filename, original_name, status, likes, uploaded_at, preview_filename FROM photos WHERE event_id = ? AND status = 'approved' ${orderClause}`, [eventId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const withUrls = rows.map(p => {
            const url = getFileUrlWithFallback(req, p.filename);
            const previewUrl = p.preview_filename 
                ? getFileUrlWithFallback(req, p.preview_filename) 
                : url;
            return {
                ...p,
                url,
                preview_url: previewUrl
            };
        });
        res.json(withUrls);
    });
});

// Recent photos (for live wall)
router.get('/recent', (req, res) => {
    const limit = parseInt(req.query.limit || '50', 10);
    db.all(`SELECT id, event_id, filename, original_name, status, likes, uploaded_at, preview_filename FROM photos WHERE status = 'approved' ORDER BY likes DESC, uploaded_at DESC LIMIT ?`, [limit], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const withUrls = rows.map(p => ({
            ...p,
            url: getFileUrl(req, p.filename),
            preview_url: p.preview_filename ? getFileUrl(req, p.preview_filename) : getFileUrl(req, p.filename)
        }));
        res.json(withUrls);
    });
});

// List pending photos (moderation) for an event [protected]
router.get('/event/:eventId/pending', auth, (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    db.all(`SELECT id, event_id, filename, original_name, status, likes, uploaded_at, preview_filename FROM photos WHERE event_id = ? AND status = 'pending' ORDER BY uploaded_at DESC`, [eventId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const withUrls = rows.map(p => ({
            ...p,
            url: getFileUrl(req, p.filename),
            preview_url: p.preview_filename ? getFileUrl(req, p.preview_filename) : getFileUrl(req, p.filename)
        }));
        res.json(withUrls);
    });
});

// Pending photos count overview [protected]
router.get('/pending/count', auth, (req, res) => {
    const isRoot = req.user && req.user.role === 'root';
    const params = [];
    let sql = `
        SELECT p.event_id AS event_id, COUNT(*) AS total
        FROM photos p
        JOIN events e ON e.id = p.event_id
        WHERE p.status = 'pending'
    `;
    if (!isRoot) {
        sql += ` AND e.owner_id = ?`;
        params.push(req.user.userId);
    }
    sql += ` GROUP BY p.event_id`;

    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        let total = 0;
        const byEvent = {};
        (rows || []).forEach((row) => {
            const count = Number(row?.total) || 0;
            total += count;
            if (row?.event_id) {
                byEvent[row.event_id] = count;
            }
        });
        res.json({ total, byEvent });
    });
});

// File operation utilities with robust error handling
async function safeFileOperation(operation, filePath, options = {}) {
    const {
        maxRetries = 20,
        initialDelay = 100,
        maxDelay = 3000,
        backoffMultiplier = 1.5,
        timeout = 30000
    } = options;

    let attempts = 0;
    const startTime = Date.now();

    while (attempts < maxRetries) {
        attempts++;
        
        // Check timeout
        if (Date.now() - startTime > timeout) {
            console.warn(`File operation timeout for ${filePath} after ${attempts} attempts`);
            return false;
        }

        try {
            // Check if file exists before operation
            try {
                await fsPromises.access(filePath, fs.constants.F_OK);
            } catch (accessErr) {
                // File doesn't exist, operation is considered successful
                return true;
            }

            // Perform the operation
            await operation(filePath);
            return true;

        } catch (err) {
            const isRetryableError = err.code === 'EBUSY' || 
                                   err.code === 'EPERM' || 
                                   err.code === 'EACCES' || 
                                   err.code === 'ENOENT' ||
                                   err.code === 'EMFILE' ||
                                   err.code === 'ENFILE';

            if (isRetryableError && attempts < maxRetries) {
                // Exponential backoff with jitter
                const baseDelay = Math.min(
                    initialDelay * Math.pow(backoffMultiplier, attempts - 1),
                    maxDelay
                );
                const jitter = Math.random() * 50; // Add randomness to avoid thundering herd
                const delay = baseDelay + jitter;
                
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // Non-retryable error or max retries reached
            if (attempts >= maxRetries) {
                console.warn(`File operation failed for ${filePath} after ${attempts} attempts:`, err.message);
            }
            return false;
        }
    }

    return false;
}

// Delete file with retry
async function deleteFileWithRetry(filePath) {
    return safeFileOperation(
        async (path) => {
            await fsPromises.unlink(path);
        },
        filePath,
        { maxRetries: 20, initialDelay: 150, maxDelay: 2000 }
    );
}

// Move file with retry
async function moveFileWithRetry(sourcePath, destPath) {
    // Ensure destination directory exists
    const destDir = path.dirname(destPath);
    try {
        await fsPromises.mkdir(destDir, { recursive: true });
    } catch (mkdirErr) {
        // Directory might already exist, continue
    }

    let attempts = 0;
    const maxRetries = 25;
    const initialDelay = 200;
    const maxDelay = 3000;
    const backoffMultiplier = 1.5;
    const startTime = Date.now();
    const timeout = 30000;

    while (attempts < maxRetries) {
        attempts++;
        
        // Check timeout
        if (Date.now() - startTime > timeout) {
            console.warn(`File move timeout for ${sourcePath} after ${attempts} attempts`);
            return false;
        }

        try {
            // Check if source exists
            try {
                await fsPromises.access(sourcePath, fs.constants.F_OK);
            } catch (accessErr) {
                // Source doesn't exist - check if destination exists
                try {
                    await fsPromises.access(destPath, fs.constants.F_OK);
                    // Destination exists, consider it moved
                    return true;
                } catch (destErr) {
                    // Neither exists, might be already processed
                    return true;
                }
            }

            // Try rename first (atomic operation)
            try {
                await fsPromises.rename(sourcePath, destPath);
                return true;
            } catch (renameErr) {
                // If rename fails due to cross-device or busy, try copy + delete
                if (renameErr.code === 'EXDEV' || renameErr.code === 'EBUSY') {
                    try {
                        await fsPromises.copyFile(sourcePath, destPath);
                        await fsPromises.unlink(sourcePath);
                        return true;
                    } catch (copyErr) {
                        // If copy fails, treat as retryable error
                        if (copyErr.code === 'EBUSY' || copyErr.code === 'EPERM' || copyErr.code === 'EACCES') {
                            throw copyErr;
                        }
                        throw renameErr;
                    }
                } else {
                    throw renameErr;
                }
            }
        } catch (err) {
            const isRetryableError = err.code === 'EBUSY' || 
                                   err.code === 'EPERM' || 
                                   err.code === 'EACCES' || 
                                   err.code === 'ENOENT' ||
                                   err.code === 'EMFILE' ||
                                   err.code === 'ENFILE';

            if (isRetryableError && attempts < maxRetries) {
                // Exponential backoff with jitter
                const baseDelay = Math.min(
                    initialDelay * Math.pow(backoffMultiplier, attempts - 1),
                    maxDelay
                );
                const jitter = Math.random() * 50;
                const delay = baseDelay + jitter;
                
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // Non-retryable error or max retries reached
            if (attempts >= maxRetries) {
                console.warn(`Failed to move file ${sourcePath} to ${destPath} after ${attempts} attempts:`, err.message);
            }
            return false;
        }
    }

    return false;
}


// Approve photos [protected]
router.post('/moderate/approve', auth, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids are required' });
    const placeholders = ids.map(() => '?').join(',');

    try {
        // Get photos from database
        const rows = await new Promise((resolve, reject) => {
            db.all(`SELECT id, event_id, filename, preview_filename FROM photos WHERE id IN (${placeholders})`, ids, (err, result) => {
                if (err) reject(err);
                else resolve(result || []);
            });
        });

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Photos not found' });
        }

        // Move files first, then update database
        // This ensures files exist at new locations before DB update
        for (const row of rows) {
            if (!row.filename) continue;
            
            const segments = row.filename.split('/').filter(Boolean);
            const pendingIndex = segments.indexOf('pending');
            
            if (pendingIndex !== -1) {
                // Move original file
                const pendingPath = path.join(uploadsDir, ...segments);
                const approvedSegments = segments.slice();
                approvedSegments.splice(pendingIndex, 1);
                const approvedPath = path.join(uploadsDir, ...approvedSegments);
                
                const moved = await moveFileWithRetry(pendingPath, approvedPath);
                if (moved) {
                    row.newFilename = approvedSegments.join('/');
                } else {
                    // If move failed, keep original path (file stays in pending)
                    row.newFilename = row.filename;
                    console.warn(`Failed to move file ${pendingPath}, keeping in pending`);
                }
                
                // Move preview file if it exists
                if (row.preview_filename) {
                    const previewSegments = row.preview_filename.split('/').filter(Boolean);
                    const previewPendingIndex = previewSegments.indexOf('pending');
                    if (previewPendingIndex !== -1) {
                        const previewPendingPath = path.join(uploadsDir, ...previewSegments);
                        const previewApprovedSegments = previewSegments.slice();
                        previewApprovedSegments.splice(previewPendingIndex, 1);
                        const previewApprovedPath = path.join(uploadsDir, ...previewApprovedSegments);
                        
                        const previewMoved = await moveFileWithRetry(previewPendingPath, previewApprovedPath);
                        if (previewMoved) {
                            row.newPreviewFilename = previewApprovedSegments.join('/');
                        } else {
                            // If preview move failed, keep original path
                            row.newPreviewFilename = row.preview_filename;
                            console.warn(`Failed to move preview ${previewPendingPath}, keeping in pending`);
                        }
                    } else {
                        row.newPreviewFilename = row.preview_filename;
                    }
                }
            } else {
                row.newFilename = row.filename;
                row.newPreviewFilename = row.preview_filename;
            }
            
            // Small delay between operations to let Windows release locks
            // Also gives time for any file descriptors to be released
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Update database after files are moved
        // Only update paths if files were successfully moved
        await new Promise((resolve, reject) => {
            db.serialize(() => {
                const stmt = db.prepare(`UPDATE photos SET status = 'approved', filename = ?, preview_filename = ? WHERE id = ?`);
                rows.forEach(row => {
                    // Only update filename if it was successfully moved (newFilename is different from original)
                    const finalFilename = (row.newFilename && row.newFilename !== row.filename) 
                        ? row.newFilename 
                        : row.filename;
                    const finalPreviewFilename = (row.newPreviewFilename && row.newPreviewFilename !== row.preview_filename)
                        ? row.newPreviewFilename
                        : row.preview_filename;
                    
                    stmt.run(
                        finalFilename,
                        finalPreviewFilename,
                        row.id
                    );
                });
                stmt.finalize((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });

        res.json({ updated: rows.length });
        
        // Проверяем и отправляем Telegram уведомление в фоне (если количество pending изменилось)
        if (rows.length > 0) {
            const eventId = rows[0].event_id;
            (async () => {
                try {
                    db.get(`SELECT name, telegram_enabled, telegram_username, telegram_threshold FROM events WHERE id = ?`, [eventId], async (err, eventRow) => {
                        if (!err && eventRow) {
                            await telegramNotifier.checkAndNotify(
                                eventId,
                                eventRow.name,
                                eventRow.telegram_enabled,
                                eventRow.telegram_username,
                                eventRow.telegram_threshold
                            );
                        }
                    });
                } catch (notifyErr) {
                    console.error('[Telegram] Ошибка при проверке уведомлений:', notifyErr.message);
                }
            })();
        }
    } catch (err) {
        console.error('Error approving photos:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

// Reject (delete) photos [protected]
router.post('/moderate/reject', auth, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids are required' });
    const placeholders = ids.map(() => '?').join(',');

    try {
        // Get photos from database
        const rows = await new Promise((resolve, reject) => {
            db.all(`SELECT id, event_id, filename, preview_filename, likes FROM photos WHERE id IN (${placeholders})`, ids, (err, result) => {
                if (err) reject(err);
                else resolve(result || []);
            });
        });

        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Photos not found' });
        }

        const countsByEvent = rows.reduce((acc, row) => {
            if (row.event_id) {
                acc[row.event_id] = (acc[row.event_id] || 0) + 1;
            }
            return acc;
        }, {});

        const likesByEvent = rows.reduce((acc, row) => {
            if (row.event_id) {
                acc[row.event_id] = (acc[row.event_id] || 0) + (row.likes || 0);
            }
            return acc;
        }, {});

        // Delete files in background (fire-and-forget) for instant UI response
        (async () => {
            try {
                for (const row of rows) {
                    // Delete original file
                    if (row.filename) {
                        const filePath = path.join(uploadsDir, row.filename);
                        deleteFileWithRetry(filePath).catch(err => {
                            console.error(`Failed to delete file ${filePath}:`, err);
                        });
                    }
                    
                    // Delete preview file if it exists
                    if (row.preview_filename) {
                        const previewPath = path.join(uploadsDir, row.preview_filename);
                        deleteFileWithRetry(previewPath).catch(err => {
                            console.error(`Failed to delete preview ${previewPath}:`, err);
                        });
                    }
                    
                    // Small delay between deletions
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
            } catch (err) {
                console.error('Error in background file deletion process:', err);
            }
        })();

        // Update database immediately without waiting for file deletion
        const deletedCount = await new Promise((resolve, reject) => {
            db.run(`DELETE FROM photos WHERE id IN (${placeholders})`, ids, function(err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        // Log deletions and update event counters
        const nowIso = new Date().toISOString();
        await new Promise((resolve) => {
            const insertDel = db.prepare(`INSERT INTO photo_deletions (event_id, photo_id, deleted_at) VALUES (?, ?, ?)`);
            rows.forEach(row => {
                insertDel.run(row.event_id || null, row.id || null, nowIso);
            });
            insertDel.finalize(() => resolve());
        });

        // Update event counters
        const entries = Object.entries(countsByEvent);
        if (entries.length === 0) {
            return res.json({ deleted: deletedCount });
        }

        await Promise.all(
            entries.map(([eventId, count]) => {
                return new Promise((resolve) => {
                    const likeReduction = likesByEvent[eventId] || 0;
                    db.run(
                        `UPDATE events 
                         SET photo_count = CASE 
                            WHEN photo_count >= ? THEN photo_count - ? 
                            ELSE 0 
                         END,
                         like_count = CASE 
                            WHEN like_count >= ? THEN like_count - ? 
                            ELSE 0 
                         END
                         , deleted_photo_count = deleted_photo_count + ?
                         WHERE id = ?`,
                        [count, count, likeReduction, likeReduction, count, eventId],
                        (err) => {
                            if (err) console.error(`Error updating event ${eventId}:`, err);
                            resolve();
                        }
                    );
                });
            })
        );

        res.json({ deleted: deletedCount });
        
        // Проверяем и отправляем Telegram уведомление в фоне (если количество pending изменилось)
        if (entries.length > 0) {
            const eventId = entries[0][0];
            (async () => {
                try {
                    db.get(`SELECT name, telegram_enabled, telegram_username, telegram_threshold FROM events WHERE id = ?`, [eventId], async (err, eventRow) => {
                        if (!err && eventRow) {
                            await telegramNotifier.checkAndNotify(
                                eventId,
                                eventRow.name,
                                eventRow.telegram_enabled,
                                eventRow.telegram_username,
                                eventRow.telegram_threshold
                            );
                        }
                    });
                } catch (notifyErr) {
                    console.error('[Telegram] Ошибка при проверке уведомлений:', notifyErr.message);
                }
            })();
        }
    } catch (err) {
        console.error('Error rejecting photos:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

// Delete a single photo [protected]
router.delete('/:photoId', auth, async (req, res) => {
    const photoId = parseInt(req.params.photoId, 10);
    if (!photoId) return res.status(400).json({ error: 'Invalid photo id' });

    try {
        // Get photo from database
        const row = await new Promise((resolve, reject) => {
            db.get(`SELECT filename, preview_filename, event_id, likes FROM photos WHERE id = ?`, [photoId], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        if (!row) {
            return res.status(404).json({ error: 'Photo not found' });
        }

        // Delete files in background (fire-and-forget) for instant UI response
        (async () => {
            try {
                // Delete original file
                if (row.filename) {
                    const filePath = path.join(uploadsDir, row.filename);
                    deleteFileWithRetry(filePath).catch(err => {
                        console.error(`Failed to delete file ${filePath}:`, err);
                    });
                }
                
                // Delete preview file if it exists
                if (row.preview_filename) {
                    const previewPath = path.join(uploadsDir, row.preview_filename);
                    deleteFileWithRetry(previewPath).catch(err => {
                        console.error(`Failed to delete preview ${previewPath}:`, err);
                    });
                }
            } catch (err) {
                console.error('Error in background file deletion process:', err);
            }
        })();

        // Update database immediately without waiting for file deletion
        await new Promise((resolve, reject) => {
            db.run(`DELETE FROM photos WHERE id = ?`, [photoId], function(err) {
                if (err) reject(err);
                else resolve();
            });
        });

        if (row.event_id) {
            // Log deletion
            await new Promise((resolve) => {
                db.run(`INSERT INTO photo_deletions (event_id, photo_id, deleted_at) VALUES (?, ?, datetime('now'))`, [row.event_id, photoId], () => resolve());
            });

            // Update event counters
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE events 
                     SET photo_count = CASE 
                        WHEN photo_count > 0 THEN photo_count - 1 
                        ELSE 0 
                     END,
                     like_count = CASE 
                        WHEN like_count >= ? THEN like_count - ? 
                        ELSE 0 
                     END
                     , deleted_photo_count = deleted_photo_count + 1
                     WHERE id = ?`,
                    [row.likes || 0, row.likes || 0, row.event_id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }

        res.json({ deleted: true });
    } catch (err) {
        console.error('Error deleting photo:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
    }
});

// Like a photo
router.post('/:photoId/like', (req, res) => {
    const photoId = parseInt(req.params.photoId, 10);
    if (!photoId) return res.status(400).json({ error: 'Invalid photo id' });

    db.run(`UPDATE photos SET likes = likes + 1 WHERE id = ?`, [photoId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Photo not found' });

        db.get(`SELECT likes, event_id FROM photos WHERE id = ?`, [photoId], (selectErr, row) => {
            if (selectErr) return res.status(500).json({ error: selectErr.message });
            if (!row) return res.status(404).json({ error: 'Photo not found' });

            if (row.event_id) {
                db.run(`UPDATE events SET like_count = like_count + 1 WHERE id = ?`, [row.event_id]);
            }

            res.json({ likes: row?.likes ?? 0 });
        });
    });
});

// Download all photos of an event as ZIP
router.get('/event/:eventId/download', (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });

    db.all(`SELECT filename FROM photos WHERE event_id = ? AND status = 'approved'`, [eventId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'No photos found for this event' });
        }

        // Получаем название события для имени архива
        db.get(`SELECT name FROM events WHERE id = ?`, [eventId], (evtErr, evt) => {
            const eventName = evt?.name || `event-${eventId}`;
            const safeName = eventName.replace(/[^a-zA-Z0-9_\-]+/g, '_');
            const zipFilename = `${safeName}-photos.zip`;

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.on('error', (archiveErr) => {
                res.status(500).json({ error: archiveErr.message });
            });

            archive.pipe(res);

            rows.forEach((row, idx) => {
                const filePath = path.join(uploadsDir, row.filename);
                if (fs.existsSync(filePath)) {
                    const ext = path.extname(row.filename);
                    archive.file(filePath, { name: `photo-${idx + 1}${ext}` });
                }
            });

            archive.finalize();
        });
    });
});

module.exports = router;
