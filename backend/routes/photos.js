const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const auth = require('../middleware/auth');
const db = require('../db/database');
const archiver = require('archiver');

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

function createUploadMiddleware(eventId, eventName, requireModeration) {
    const baseName = eventName ? `${eventId}-${slugify(eventName)}` : String(eventId);
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

    const uploader = createUploadMiddleware(eventId, eventRow.name, Boolean(eventRow.require_moderation));

    uploader(req, res, (uploadErr) => {
        if (uploadErr) {
            return res.status(400).json({ error: uploadErr.message });
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const initialStatus = eventRow.require_moderation ? 'pending' : 'approved';
        const stmt = db.prepare(`INSERT INTO photos (event_id, filename, original_name, status) VALUES (?, ?, ?, ?)`);
        db.serialize(() => {
            req.files.forEach(file => {
                const storedRelative = req.uploadSubdir ? `${req.uploadSubdir}/${file.filename}` : file.filename;
                stmt.run(eventId, storedRelative, file.originalname, initialStatus);
            });
            stmt.finalize((finalizeErr) => {
                if (finalizeErr) {
                    return res.status(500).json({ error: finalizeErr.message });
                }
                db.run(`UPDATE events SET photo_count = photo_count + ? WHERE id = ?`, [req.files.length, eventId]);
                const files = req.files.map(file => {
                    const storedRelative = req.uploadSubdir ? `${req.uploadSubdir}/${file.filename}` : file.filename;
                    return {
                        id: undefined,
                        event_id: eventId,
                        filename: storedRelative,
                        original_name: file.originalname,
                        status: initialStatus,
                        url: getFileUrl(req, storedRelative)
                    };
                });
                res.status(201).json({ uploaded: files });
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

    db.get(`SELECT name, require_moderation, status FROM events WHERE id = ?`, [eventId], (err, eventRow) => {
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

    db.get(`SELECT name, require_moderation, status FROM events WHERE id = ?`, [eventId], (err, eventRow) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!eventRow) {
            return res.status(404).json({ error: 'Event not found' });
        }

        performPhotoUpload({ req, res, eventId, eventRow, skipStatusCheck: true });
    });
});

// List photos by event
router.get('/event/:eventId', (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    const sort = req.query.sort === 'likes' ? 'likes' : 'date';
    const orderClause = sort === 'likes'
        ? `ORDER BY likes DESC, uploaded_at DESC`
        : `ORDER BY uploaded_at DESC`;
    db.all(`SELECT id, event_id, filename, original_name, status, likes, uploaded_at FROM photos WHERE event_id = ? AND status = 'approved' ${orderClause}`, [eventId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const withUrls = rows.map(p => ({
            ...p,
            url: getFileUrl(req, p.filename)
        }));
        res.json(withUrls);
    });
});

// Recent photos (for live wall)
router.get('/recent', (req, res) => {
    const limit = parseInt(req.query.limit || '50', 10);
    db.all(`SELECT id, event_id, filename, original_name, status, likes, uploaded_at FROM photos WHERE status = 'approved' ORDER BY likes DESC, uploaded_at DESC LIMIT ?`, [limit], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const withUrls = rows.map(p => ({
            ...p,
            url: getFileUrl(req, p.filename)
        }));
        res.json(withUrls);
    });
});

// List pending photos (moderation) for an event [protected]
router.get('/event/:eventId/pending', auth, (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    db.all(`SELECT id, event_id, filename, original_name, status, likes, uploaded_at FROM photos WHERE event_id = ? AND status = 'pending' ORDER BY uploaded_at DESC`, [eventId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const withUrls = rows.map(p => ({
            ...p,
            url: getFileUrl(req, p.filename)
        }));
        res.json(withUrls);
    });
});

// Pending photos count overview [protected]
router.get('/pending/count', auth, (_req, res) => {
    db.all(`SELECT event_id, COUNT(*) as total FROM photos WHERE status = 'pending' GROUP BY event_id`, [], (err, rows) => {
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

// Approve photos [protected]
router.post('/moderate/approve', auth, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids are required' });
    const placeholders = ids.map(() => '?').join(',');

    db.all(`SELECT id, event_id, filename FROM photos WHERE id IN (${placeholders})`, ids, (selectErr, rows) => {
        if (selectErr) return res.status(500).json({ error: selectErr.message });
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Photos not found' });

        try {
            rows.forEach(row => {
                if (!row.filename) return;
                const segments = row.filename.split('/').filter(Boolean);
                const pendingIndex = segments.indexOf('pending');
                if (pendingIndex !== -1) {
                    const pendingPath = path.join(uploadsDir, ...segments);
                    const approvedSegments = segments.slice();
                    approvedSegments.splice(pendingIndex, 1);
                    const approvedPath = path.join(uploadsDir, ...approvedSegments);
                    ensureDir(path.dirname(approvedPath));
                    if (fs.existsSync(pendingPath)) {
                        fs.renameSync(pendingPath, approvedPath);
                    }
                    row.newFilename = approvedSegments.join('/');
                } else {
                    row.newFilename = row.filename;
                }
            });
        } catch (moveErr) {
            return res.status(500).json({ error: moveErr.message });
        }

        db.serialize(() => {
            const stmt = db.prepare(`UPDATE photos SET status = 'approved', filename = ? WHERE id = ?`);
            rows.forEach(row => {
                stmt.run(row.newFilename || row.filename, row.id);
            });
            stmt.finalize((finalizeErr) => {
                if (finalizeErr) return res.status(500).json({ error: finalizeErr.message });
                res.json({ updated: rows.length });
            });
        });
    });
});

// Reject (delete) photos [protected]
router.post('/moderate/reject', auth, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids are required' });
    const placeholders = ids.map(() => '?').join(',');

    db.all(`SELECT id, event_id, filename, likes FROM photos WHERE id IN (${placeholders})`, ids, (selectErr, rows) => {
        if (selectErr) return res.status(500).json({ error: selectErr.message });
        if (!rows || rows.length === 0) return res.status(404).json({ error: 'Photos not found' });

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

        // Удаляем файлы с диска
        rows.forEach(row => {
            if (row.filename) {
                const filePath = path.join(uploadsDir, row.filename);
                fs.unlink(filePath, () => {});
            }
        });

        db.run(`DELETE FROM photos WHERE id IN (${placeholders})`, ids, function(err) {
            if (err) return res.status(500).json({ error: err.message });

            const deletedCount = this.changes;

            const entries = Object.entries(countsByEvent);
            if (entries.length === 0) {
                return res.json({ deleted: deletedCount });
            }

            let pending = entries.length;
            let responded = false;

            entries.forEach(([eventId, count]) => {
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
                     WHERE id = ?`,
                    [count, count, likeReduction, likeReduction, eventId],
                    (updateErr) => {
                        if (responded) return;
                        if (updateErr) {
                            responded = true;
                            return res.status(500).json({ error: updateErr.message });
                        }
                        pending -= 1;
                        if (pending === 0 && !responded) {
                            responded = true;
                            res.json({ deleted: deletedCount });
                        }
                    }
                );
            });
        });
    });
});

// Delete a single photo [protected]
router.delete('/:photoId', auth, (req, res) => {
    const photoId = parseInt(req.params.photoId, 10);
    if (!photoId) return res.status(400).json({ error: 'Invalid photo id' });

    db.get(`SELECT filename, event_id, likes FROM photos WHERE id = ?`, [photoId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Photo not found' });

        const filePath = path.join(uploadsDir, row.filename);
        fs.unlink(filePath, () => {}); // Удаляем файл с диска

        db.run(`DELETE FROM photos WHERE id = ?`, [photoId], function(delErr) {
            if (delErr) return res.status(500).json({ error: delErr.message });
            if (row.event_id) {
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
                     WHERE id = ?`,
                    [row.likes || 0, row.likes || 0, row.event_id],
                    (updateErr) => {
                        if (updateErr) return res.status(500).json({ error: updateErr.message });
                        res.json({ deleted: true });
                    }
                );
            } else {
                res.json({ deleted: true });
            }
        });
    });
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


