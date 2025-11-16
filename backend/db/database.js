const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'qr_photoshare.db');
const db = new sqlite3.Database(dbPath);

// Инициализация таблиц
db.serialize(() => {
    // Таблица событий
    db.run(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        date TEXT NOT NULL,
        description TEXT,
        qr_code TEXT,
        access_link TEXT,
        require_moderation INTEGER DEFAULT 0,
        upload_access TEXT DEFAULT 'all',
        view_access TEXT DEFAULT 'link',
        auto_delete_days INTEGER DEFAULT 14,
        photo_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        branding_color TEXT,
        branding_background TEXT,
        notify_before_delete INTEGER DEFAULT 0,
        status TEXT DEFAULT 'scheduled',
        scheduled_start_at TEXT,
        auto_end_at TEXT,
        visitor_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`ALTER TABLE events ADD COLUMN like_count INTEGER DEFAULT 0`, (err) => {
        // ignore if exists
    });
    db.run(`ALTER TABLE events ADD COLUMN branding_color TEXT`, () => {});
    db.run(`ALTER TABLE events ADD COLUMN branding_background TEXT`, () => {});
    db.run(`ALTER TABLE events ADD COLUMN notify_before_delete INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE events ADD COLUMN status TEXT DEFAULT 'scheduled'`, () => {});
    db.run(`ALTER TABLE events ADD COLUMN scheduled_start_at TEXT`, () => {});
    db.run(`ALTER TABLE events ADD COLUMN auto_end_at TEXT`, () => {});

    // Таблица фотографий
    db.run(`CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER,
        filename TEXT NOT NULL,
        original_name TEXT,
        status TEXT DEFAULT 'pending',
        likes INTEGER DEFAULT 0,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events (id)
    )`);

    // Добавляем колонку likes, если база уже была создана
    db.run(`ALTER TABLE photos ADD COLUMN likes INTEGER DEFAULT 0`, (err) => {
        // Игнорируем ошибку при существующей колонке
    });
});

module.exports = db;
