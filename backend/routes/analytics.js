const router = require('express').Router();
const path = require('path');
const fs = require('fs').promises;
const db = require('../db/database');
const auth = require('../middleware/auth');

const uploadsDir = path.resolve(path.join(__dirname, '..', 'uploads'));

function dbGet(query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function dbAll(query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

async function calculatePhotosSize(rows) {
    let total = 0;
    if (!Array.isArray(rows) || !rows.length) return total;
    await Promise.all(rows.map(async (row) => {
        if (!row?.filename) return;
        const filePath = path.join(uploadsDir, row.filename);
        try {
            const stat = await fs.stat(filePath);
            total += stat.size;
        } catch (_) {
            // ignore missing files
        }
    }));
    return total;
}

router.get('/summary', auth, async (req, res) => {
    try {
        const isRoot = req.user && req.user.role === 'root';
        let totalEventsRow;
        let photoRows;
        if (isRoot) {
            [totalEventsRow, photoRows] = await Promise.all([
                dbGet('SELECT COUNT(*) AS total FROM events'),
                dbAll('SELECT filename FROM photos')
            ]);
        } else {
            const userId = req.user.userId;
            [totalEventsRow, photoRows] = await Promise.all([
                dbGet('SELECT COUNT(*) AS total FROM events WHERE owner_id = ?', [userId]),
                dbAll(`SELECT p.filename
                       FROM photos p
                       JOIN events e ON e.id = p.event_id
                       WHERE e.owner_id = ?`, [userId])
            ]);
        }

        const totalEvents = totalEventsRow?.total || 0;
        const totalPhotos = photoRows.length;
        const totalSizeBytes = await calculatePhotosSize(photoRows);

        res.json({
            totalEvents,
            totalPhotos,
            totalSizeBytes
        });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to load analytics summary' });
    }
});

router.get('/uploads-by-day', auth, (req, res) => {
    // Диапазон: с 1-го числа текущего месяца до сегодняшнего дня
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    function toDateStr(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    const startStr = toDateStr(start);
    const endStr = toDateStr(end);

    const isRoot = req.user && req.user.role === 'root';
    const params = [startStr, endStr];
    let sql;
    if (isRoot) {
        sql = `
            SELECT DATE(p.uploaded_at) AS day, COUNT(*) AS total
            FROM photos p
            WHERE p.uploaded_at IS NOT NULL
              AND DATE(p.uploaded_at) BETWEEN ? AND ?
            GROUP BY day
            ORDER BY day ASC
        `;
    } else {
        sql = `
            SELECT DATE(p.uploaded_at) AS day, COUNT(*) AS total
            FROM photos p
            JOIN events e ON e.id = p.event_id
            WHERE p.uploaded_at IS NOT NULL
              AND e.owner_id = ?
              AND DATE(p.uploaded_at) BETWEEN ? AND ?
            GROUP BY day
            ORDER BY day ASC
        `;
        params.unshift(req.user.userId);
    }

    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        // Заполняем пропущенные дни нулями
        const countsByDay = new Map((rows || []).map(r => [r.day, Number(r.total) || 0]));
        const result = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const ds = toDateStr(d);
            result.push({ day: ds, total: countsByDay.get(ds) || 0 });
        }
        res.json(result);
    });
});

// Детальный обзор мероприятий (активные и удалённые)
router.get('/events/overview', auth, (req, res) => {
    const isRoot = req.user && req.user.role === 'root';
    const paramsActive = [];
    const paramsDeleted = [];

    let sqlActive = `
        SELECT e.id, e.name, e.owner_id, e.created_at, e.status, e.photo_count, e.deleted_photo_count,
               u.username AS owner_username, u.display_name AS owner_display_name
        FROM events e
        LEFT JOIN users u ON u.id = e.owner_id
    `;
    if (!isRoot) {
        sqlActive += ` WHERE e.owner_id = ?`;
        paramsActive.push(req.user.userId);
    }
    sqlActive += ` ORDER BY e.created_at DESC`;

    let sqlDeleted = `
        SELECT a.event_id, a.name, a.owner_id, a.created_at, a.deleted_at, a.total_photos_at_delete, a.deleted_photos_cumulative,
               u.username AS owner_username, u.display_name AS owner_display_name
        FROM event_audit a
        LEFT JOIN users u ON u.id = a.owner_id
    `;
    if (!isRoot) {
        sqlDeleted += ` WHERE a.owner_id = ?`;
        paramsDeleted.push(req.user.userId);
    }
    sqlDeleted += ` ORDER BY a.deleted_at DESC`;

    db.all(sqlActive, paramsActive, (errActive, activeRows) => {
        if (errActive) return res.status(500).json({ error: errActive.message });
        db.all(sqlDeleted, paramsDeleted, (errDel, delRows) => {
            if (errDel) return res.status(500).json({ error: errDel.message });

            const active = (activeRows || []).map(r => ({
                id: r.id,
                name: r.name,
                owner_id: r.owner_id,
                owner_username: r.owner_username || null,
                owner_display_name: r.owner_display_name || null,
                created_at: r.created_at,
                status: r.status,
                photos_total: Number(r.photo_count || 0),
                photos_deleted: Number(r.deleted_photo_count || 0)
            }));

            const deleted = (delRows || []).map(r => ({
                event_id: r.event_id,
                name: r.name,
                owner_id: r.owner_id,
                owner_username: r.owner_username || null,
                owner_display_name: r.owner_display_name || null,
                created_at: r.created_at,
                deleted_at: r.deleted_at,
                photos_total_at_delete: Number(r.total_photos_at_delete || 0),
                photos_deleted_total: Number(r.deleted_photos_cumulative || 0)
            }));

            res.json({
                totals: {
                    activeCount: active.length,
                    deletedCount: deleted.length
                },
                active,
                deleted
            });
        });
    });
});

// Удалить запись из аудита (только сам владелец или root)
router.delete('/events/:eventId/audit', auth, (req, res) => {
    const eventId = parseInt(req.params.eventId, 10);
    if (!eventId) return res.status(400).json({ error: 'Invalid event id' });

    // Только root-администратор имеет право удалять записи аудита
    if (!req.user || req.user.role !== 'root') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    db.run(`DELETE FROM event_audit WHERE event_id = ?`, [eventId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        // Идемпотентный ответ: 200 даже если записи не было
        return res.json({ deleted: this.changes > 0 });
    });
});

// Подробная информация по созданным и удалённым мероприятиям
router.get('/events', auth, async (req, res) => {
    try {
        const isRoot = req.user && req.user.role === 'root';
        const paramsActive = [];
        const paramsDeleted = [];
        let sqlActive = `
            SELECT e.id, e.name, e.owner_id, e.created_at, NULL as deleted_at,
                   e.photo_count as total_photos, e.deleted_photo_count as deleted_photos,
                   u.username AS owner_username, u.display_name AS owner_display_name,
                   'active' AS type
            FROM events e
            LEFT JOIN users u ON u.id = e.owner_id
        `;
        if (!isRoot) {
            sqlActive += ` WHERE e.owner_id = ?`;
            paramsActive.push(req.user.userId);
        }
        sqlActive += ` ORDER BY e.created_at DESC`;

        let sqlDeleted = `
            SELECT a.event_id AS id, a.name, a.owner_id, a.created_at, a.deleted_at,
                   a.total_photos_at_delete AS total_photos, a.deleted_photos_cumulative AS deleted_photos,
                   u.username AS owner_username, u.display_name AS owner_display_name,
                   'deleted' AS type
            FROM event_audit a
            LEFT JOIN users u ON u.id = a.owner_id
        `;
        if (!isRoot) {
            sqlDeleted += ` WHERE a.owner_id = ?`;
            paramsDeleted.push(req.user.userId);
        }
        sqlDeleted += ` ORDER BY a.deleted_at DESC`;

        const [active, deleted] = await Promise.all([
            new Promise((resolve, reject) => {
                db.all(sqlActive, paramsActive, (err, rows) => err ? reject(err) : resolve(rows || []));
            }),
            new Promise((resolve, reject) => {
                db.all(sqlDeleted, paramsDeleted, (err, rows) => err ? reject(err) : resolve(rows || []));
            })
        ]);

        const totalCreated = (active?.length || 0) + (deleted?.length || 0);
        const totalDeleted = deleted?.length || 0;

        res.json({
            totals: { totalCreated, totalDeleted, active: active.length, deleted: totalDeleted },
            active,
            deleted
        });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to load events analytics' });
    }
});

module.exports = router;

