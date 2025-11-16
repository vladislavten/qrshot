const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db/database');

const SECRET = process.env.JWT_SECRET || 'dev_secret';

function normalizeExpiresIn(value, fallback = '12h') {
    if (!value || typeof value !== 'string') {
        return fallback;
    }
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (/^\d+$/.test(trimmed)) {
        return Number(trimmed);
    }
    return trimmed;
}

const TOKEN_TTL = normalizeExpiresIn(process.env.JWT_EXPIRES_IN);
const IDLE_TIMEOUT_RAW = process.env.ADMIN_IDLE_TIMEOUT
    || process.env.ADMIN_IDLE_TIMEOUT_MS
    || process.env.ADMIN_IDLE_TIMEOUT_SECONDS
    || process.env.ADMIN_IDLE_TIMEOUT_MINUTES;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

function parseDurationToMs(value, defaultMs) {
    if (value === undefined || value === null || value === '') return defaultMs;

    if (typeof value === 'number' && !Number.isNaN(value)) {
        return Math.round(value);
    }

    const trimmed = String(value).trim();
    const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i);
    if (!match) return defaultMs;

    const amount = parseFloat(match[1]);
    const unit = (match[2] || 's').toLowerCase();
    const multipliers = {
        ms: 1,
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    };

    const multiplier = multipliers[unit];
    if (!multiplier) return defaultMs;

    return Math.round(amount * multiplier);
}

const TOKEN_TTL_MS = parseDurationToMs(TOKEN_TTL, 60_000);
const IDLE_TIMEOUT_MS = parseDurationToMs(IDLE_TIMEOUT_RAW, DEFAULT_IDLE_TIMEOUT_MS);

function signToken(payload) {
    try {
        return jwt.sign(payload, SECRET, { expiresIn: TOKEN_TTL });
    } catch (error) {
        console.warn('[auth] Invalid JWT_EXPIRES_IN value, falling back to 12h:', error.message);
        return jwt.sign(payload, SECRET, { expiresIn: '12h' });
    }
}

// Login for root (env) and DB users
router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin';

    // Root admin via .env (not stored in DB)
    if (username === adminUser && password === adminPass) {
        const token = signToken({ role: 'root', username, userId: 1 });
        return res.json({ token });
    }

    // Regular users from DB
    db.get(`SELECT id, username, password_hash, role, display_name FROM users WHERE username = ?`, [username], async (err, row) => {
        if (err) {
            return res.status(500).json({ message: 'DB error' });
        }
        if (!row) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }
        try {
            const ok = await bcrypt.compare(String(password), row.password_hash);
            if (!ok) {
                return res.status(401).json({ message: 'Invalid credentials' });
            }
            const role = row.role || 'admin';
            const token = signToken({ role, username: row.username, userId: row.id, name: row.display_name || row.username });
            return res.json({ token });
        } catch (e) {
            return res.status(500).json({ message: 'Auth error' });
        }
    });
});

router.post('/refresh', (req, res) => {
    const authHeader = req.header('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    const token = authHeader.replace('Bearer ', '');
    try {
        const decoded = jwt.verify(token, SECRET);
        const payload = {
            role: decoded.role,
            username: decoded.username,
            userId: decoded.userId,
            name: decoded.name
        };
        const freshToken = signToken(payload);
        return res.json({ token: freshToken });
    } catch (error) {
        return res.status(401).json({ message: 'Authentication required' });
    }
});

router.get('/config', (_req, res) => {
    res.json({
        tokenTtl: TOKEN_TTL,
        tokenTtlMs: TOKEN_TTL_MS,
        idleTimeoutMs: IDLE_TIMEOUT_MS
    });
});

module.exports = router;


