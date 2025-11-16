const router = require('express').Router();
const path = require('path');
const fs = require('fs').promises;
const db = require('../db/database');

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

router.get('/summary', async (req, res) => {
    try {
        const [eventRow, photoRows] = await Promise.all([
            dbGet('SELECT COUNT(*) AS total FROM events'),
            dbAll('SELECT filename FROM photos')
        ]);

        const totalEvents = eventRow?.total || 0;
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

router.get('/uploads-by-day', (req, res) => {
    const limit = parseInt(req.query.limit || '7', 10);
    const boundedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 30) : 7;

    db.all(
        `SELECT DATE(uploaded_at) AS day, COUNT(*) AS total
         FROM photos
         WHERE uploaded_at IS NOT NULL
         GROUP BY day
         ORDER BY day DESC
         LIMIT ?`,
        [boundedLimit],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            const normalized = (rows || [])
                .map(row => ({
                    day: row.day,
                    total: row.total
                }))
                .reverse();
            res.json(normalized);
        }
    );
});

module.exports = router;

