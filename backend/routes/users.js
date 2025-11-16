const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const auth = require('../middleware/auth');

function requireRoot(req, res, next) {
  if (req.user && req.user.role === 'root') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

// List users (root only) — hide root admin from the list
router.get('/', auth, requireRoot, (req, res) => {
  const rootUser = process.env.ADMIN_USER || 'admin';
  db.all(`SELECT id, username, display_name AS displayName, role, created_at AS createdAt FROM users WHERE username <> ? ORDER BY id ASC`, [rootUser], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Create user (root only)
router.post('/', auth, requireRoot, async (req, res) => {
  const { username, password, displayName, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const userRole = role && role === 'root' ? 'root' : 'admin';
  try {
    const hash = await bcrypt.hash(String(password), 12);
    db.run(
      `INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)`,
      [String(username), hash, displayName || null, userRole],
      function (err) {
        if (err) {
          if (String(err.message || '').includes('UNIQUE')) {
            return res.status(409).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ id: this.lastID, username, displayName: displayName || null, role: userRole });
      }
    );
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (root only)
router.patch('/:id', auth, requireRoot, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });
  const { username, password, displayName, role } = req.body || {};

  db.get(`SELECT * FROM users WHERE id = ?`, [userId], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'User not found' });

    const updates = [];
    const params = [];
    if (username && username !== row.username) {
      updates.push('username = ?'); params.push(String(username));
    }
    if (displayName !== undefined) {
      updates.push('display_name = ?'); params.push(displayName || null);
    }
    if (password) {
      const hash = await bcrypt.hash(String(password), 12);
      updates.push('password_hash = ?'); params.push(hash);
    }
    if (role && (role === 'admin' || role === 'root')) {
      updates.push('role = ?'); params.push(role);
    }
    if (updates.length === 0) {
      return res.json({ ok: true });
    }
    params.push(userId);
    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, function (uErr) {
      if (uErr) {
        if (String(uErr.message || '').includes('UNIQUE')) {
          return res.status(409).json({ error: 'Username already exists' });
        }
        return res.status(500).json({ error: uErr.message });
      }
      res.json({ ok: true });
    });
  });
});

// Delete user (root only)
router.delete('/:id', auth, requireRoot, (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });

  // Нельзя удалить root из .env на всякий случай
  const rootUser = (process.env.ADMIN_USER || 'admin').toLowerCase();
  db.get(`SELECT username FROM users WHERE id = ?`, [userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (String(row.username || '').toLowerCase() === rootUser) {
      return res.status(400).json({ error: 'Нельзя удалить root-пользователя' });
    }
    db.run(`DELETE FROM users WHERE id = ?`, [userId], function (delErr) {
      if (delErr) return res.status(500).json({ error: delErr.message });
      if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
      res.json({ deleted: true });
    });
  });
});

module.exports = router;


