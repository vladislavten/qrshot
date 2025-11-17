const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const auth = require('../middleware/auth');
const path = require('path');
const fsPromises = require('fs').promises;
const uploadsDir = path.resolve(path.join(__dirname, '..', 'uploads'));

// Helper function to delete file with retry (from events.js)
async function deleteFileWithRetry(filePath, maxRetries = 20, delay = 150) {
    let attempts = 0;
    const startTime = Date.now();
    const timeout = 30000;

    while (attempts < maxRetries) {
        attempts++;
        
        if (Date.now() - startTime > timeout) {
            console.warn(`File deletion timeout for ${filePath} after ${attempts} attempts`);
            return false;
        }

        try {
            await fsPromises.unlink(filePath);
            return true;
        } catch (err) {
            if (err.code === 'ENOENT') {
                // File doesn't exist, consider it deleted
                return true;
            }
            
            if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'EACCES') {
                // Non-retryable error
                console.warn(`Failed to delete file ${filePath}:`, err.message);
                return false;
            }

            if (attempts >= maxRetries) {
                console.warn(`Failed to delete file ${filePath} after ${attempts} attempts:`, err.message);
                return false;
            }

            // Exponential backoff with jitter
            const backoffDelay = delay * Math.pow(2, attempts - 1) + Math.random() * 50;
            await new Promise(resolve => setTimeout(resolve, Math.min(backoffDelay, 2000)));
        }
    }

    return false;
}

function slugify(text) {
    return String(text || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\-_.\s]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase();
}

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
router.delete('/:id', auth, requireRoot, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId) return res.status(400).json({ error: 'Invalid user id' });

  // Нельзя удалить root из .env на всякий случай
  const rootUser = (process.env.ADMIN_USER || 'admin').toLowerCase();
  
  db.get(`SELECT username FROM users WHERE id = ?`, [userId], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'User not found' });
    if (String(row.username || '').toLowerCase() === rootUser) {
      return res.status(400).json({ error: 'Нельзя удалить root-пользователя' });
    }

    try {
      // Получаем все мероприятия пользователя
      const events = await new Promise((resolve, reject) => {
        db.all(`SELECT id FROM events WHERE owner_id = ?`, [userId], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      // Удаляем каждое мероприятие (используем логику из events.js)

      for (const event of events) {
        const eventId = event.id;
        
        // Получаем данные мероприятия
        const eventRow = await new Promise((resolve, reject) => {
          db.get(`SELECT id, name, created_at, branding_background, owner_id, deleted_photo_count FROM events WHERE id = ?`, [eventId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (!eventRow) continue;

        // Получаем все фото мероприятия
        const photoRows = await new Promise((resolve, reject) => {
          db.all(`SELECT id, filename, preview_filename FROM photos WHERE event_id = ?`, [eventId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          });
        });

        const deletedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const removedPhotos = photoRows.length;

        // Удаляем фото из базы данных
        db.run(`DELETE FROM photos WHERE event_id = ?`, [eventId]);

        // Удаляем событие из базы данных
        db.run(`DELETE FROM events WHERE id = ?`, [eventId]);

        // Логируем удаление в event_audit
        db.run(`INSERT INTO event_audit (event_id, owner_id, name, created_at, deleted_at, total_photos_at_delete, deleted_photos_cumulative) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [eventRow.id, eventRow.owner_id, eventRow.name || '', eventRow.created_at || null, deletedAt, removedPhotos, Number(eventRow.deleted_photo_count) || 0]);

        // Удаляем файлы в фоне (fire-and-forget)
        (async () => {
          // Определяем путь к папке мероприятия
          let eventFolderPath = null;
          
          if (photoRows.length > 0 && photoRows[0].filename) {
            const segments = photoRows[0].filename.split('/').filter(Boolean);
            if (segments.length > 0) {
              eventFolderPath = path.join(uploadsDir, segments[0]);
            }
          } else if (eventRow.branding_background) {
            const segments = eventRow.branding_background.split('/').filter(Boolean);
            if (segments.length > 0) {
              eventFolderPath = path.join(uploadsDir, segments[0]);
            }
          }
          
          // Если не удалось определить из путей, пытаемся построить из eventId, name и created_at
          if (!eventFolderPath) {
            let dateStr = '';
            if (eventRow.created_at) {
              try {
                const date = new Date(eventRow.created_at);
                if (!isNaN(date.getTime())) {
                  dateStr = date.toISOString().split('T')[0];
                }
              } catch (e) {
                dateStr = new Date().toISOString().split('T')[0];
              }
            } else {
              dateStr = new Date().toISOString().split('T')[0];
            }
            
            const eventNameSlug = eventRow.name ? slugify(eventRow.name) : 'event';
            const baseName = `${eventId}-event_${eventNameSlug}_${dateStr}`;
            eventFolderPath = path.join(uploadsDir, baseName);
          }

          // Удаляем все файлы фото
          for (const photoRow of photoRows) {
            if (photoRow.filename) {
              const filePath = path.join(uploadsDir, photoRow.filename);
              await deleteFileWithRetry(filePath);
            }
            if (photoRow.preview_filename) {
              const previewPath = path.join(uploadsDir, photoRow.preview_filename);
              await deleteFileWithRetry(previewPath);
            }
            // Небольшая задержка между удалениями
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          // Удаляем файл брендинга
          if (eventRow.branding_background) {
            const brandingPath = path.join(uploadsDir, eventRow.branding_background);
            await deleteFileWithRetry(brandingPath);
          }

          // Ждем немного, чтобы все файлы были удалены
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Удаляем папку мероприятия рекурсивно с повторными попытками
          if (eventFolderPath && path.resolve(eventFolderPath) !== uploadsDir) {
            let folderDeleted = false;
            let attempts = 0;
            const maxAttempts = 10;
            
            while (!folderDeleted && attempts < maxAttempts) {
              attempts++;
              try {
                await fsPromises.access(eventFolderPath, fsPromises.constants.F_OK);
                await fsPromises.rm(eventFolderPath, { recursive: true, force: true });
                console.log(`Deleted event folder: ${eventFolderPath}`);
                folderDeleted = true;
              } catch (err) {
                if (err.code === 'ENOENT') {
                  folderDeleted = true;
                } else if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
                  if (attempts < maxAttempts) {
                    const delay = Math.min(500 * attempts, 2000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                  } else {
                    console.warn(`Failed to delete event folder ${eventFolderPath} after ${attempts} attempts:`, err.message);
                  }
                } else {
                  console.warn(`Failed to delete event folder ${eventFolderPath}:`, err.message);
                  break;
                }
              }
            }
          }
        })();
      }

      // Удаляем пользователя
      db.run(`DELETE FROM users WHERE id = ?`, [userId], function (delErr) {
        if (delErr) return res.status(500).json({ error: delErr.message });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ deleted: true, eventsDeleted: events.length });
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to delete user' });
    }
  });
});

module.exports = router;


