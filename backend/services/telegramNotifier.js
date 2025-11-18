const TelegramBot = require('node-telegram-bot-api');

let bot = null;
let botToken = null;

// Инициализация бота
function initTelegramBot() {
    botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
        console.warn('[Telegram] TELEGRAM_BOT_TOKEN не установлен в .env, уведомления отключены');
        return false;
    }

    try {
        // Включаем polling для получения сообщений от пользователей
        bot = new TelegramBot(botToken, { polling: true });
        
        // Обработчик команды /start - сохраняем chat_id по username
        bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const username = msg.chat.username;
            
            if (username) {
                const db = require('../db/database');
                // Сохраняем или обновляем соответствие username -> chat_id
                db.run(
                    `INSERT OR REPLACE INTO telegram_users (username, chat_id, updated_at) VALUES (?, ?, datetime('now'))`,
                    [username.toLowerCase(), chatId],
                    (err) => {
                        if (err) {
                            console.error('[Telegram] Ошибка сохранения chat_id:', err.message);
                        } else {
                            console.log(`[Telegram] Сохранен chat_id ${chatId} для пользователя @${username}`);
                            bot.sendMessage(chatId, '✅ Уведомления настроены! Теперь вы будете получать уведомления о фото на модерации.');
                        }
                    }
                );
            } else {
                bot.sendMessage(chatId, '❌ У вас не установлен username в Telegram. Пожалуйста, установите username в настройках Telegram и попробуйте снова.');
            }
        });
        
        console.log('[Telegram] Бот инициализирован с polling');
        return true;
    } catch (error) {
        console.error('[Telegram] Ошибка инициализации бота:', error.message);
        return false;
    }
}

// Получение chat_id по username из базы данных
function getChatIdByUsername(username) {
    return new Promise((resolve) => {
        const db = require('../db/database');
        const cleanUsername = username.trim().replace(/^@/, '').toLowerCase();
        
        db.get(
            `SELECT chat_id FROM telegram_users WHERE username = ?`,
            [cleanUsername],
            (err, row) => {
                if (err) {
                    console.error('[Telegram] Ошибка получения chat_id:', err.message);
                    return resolve(null);
                }
                resolve(row?.chat_id || null);
            }
        );
    });
}

// Отправка уведомления пользователю по username
async function sendNotification(username, eventName, pendingCount, threshold) {
    if (!bot || !botToken) {
        if (!initTelegramBot()) {
            return { success: false, error: 'Telegram бот не инициализирован' };
        }
    }

    if (!username || !username.trim()) {
        return { success: false, error: 'Username не указан' };
    }

    // Убираем @ если есть
    const cleanUsername = username.trim().replace(/^@/, '');
    
    const message = `⚠️ Внимание! Модерация фото\n\n` +
                   `Событие: ${eventName}\n` +
                   `На модерации: ${pendingCount} фотографий\n` +
                   `Порог: ${threshold} фотографий\n\n` +
                   `Пожалуйста, проверьте очередь модерации.`;

    try {
        // Получаем chat_id по username из базы данных
        const chatId = await getChatIdByUsername(cleanUsername);
        
        if (!chatId) {
            return { 
                success: false, 
                error: `Пользователь @${cleanUsername} не найден. Попросите пользователя написать боту /start для настройки уведомлений.` 
            };
        }
        
        // Отправляем сообщение по chat_id
        await bot.sendMessage(chatId, message);
        console.log(`[Telegram] Уведомление отправлено пользователю @${cleanUsername} (chat_id: ${chatId})`);
        return { success: true };
    } catch (error) {
        console.error(`[Telegram] Ошибка отправки уведомления пользователю @${cleanUsername}:`, error.message);
        
        // Обработка различных ошибок
        const errorCode = error.response?.body?.error_code;
        if (errorCode === 403) {
            return { success: false, error: 'Пользователь заблокировал бота' };
        } else if (errorCode === 400) {
            return { success: false, error: 'Неверный chat_id. Попросите пользователя написать боту /start снова' };
        }
        
        return { success: false, error: error.message };
    }
}

// Проверка и отправка уведомления если нужно
async function checkAndNotify(eventId, eventName, telegramEnabled, telegramUsername, telegramThreshold) {
    if (!telegramEnabled || !telegramUsername) {
        return { sent: false, reason: 'Уведомления отключены или username не указан' };
    }

    const db = require('../db/database');
    
    return new Promise((resolve) => {
        // Подсчитываем количество фото на модерации для этого события
        db.get(
            `SELECT COUNT(*) as count FROM photos WHERE event_id = ? AND status = 'pending'`,
            [eventId],
            async (err, row) => {
                if (err) {
                    console.error('[Telegram] Ошибка подсчета фото:', err.message);
                    return resolve({ sent: false, error: err.message });
                }

                const pendingCount = row?.count || 0;
                
                if (pendingCount >= telegramThreshold) {
                    const result = await sendNotification(telegramUsername, eventName, pendingCount, telegramThreshold);
                    resolve({ sent: result.success, pendingCount, result });
                } else {
                    resolve({ sent: false, pendingCount, reason: `Количество фото (${pendingCount}) меньше порога (${telegramThreshold})` });
                }
            }
        );
    });
}

module.exports = {
    initTelegramBot,
    sendNotification,
    checkAndNotify
};

