# Настройка формы заявки

## Переменные окружения

Добавьте следующие переменные в файл `backend/.env`:

```env
# SMTP настройки для отправки email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# reCaptcha ключи
RECAPTCHA_SITE_KEY=your-recaptcha-site-key
RECAPTCHA_SECRET_KEY=your-recaptcha-secret-key
```

## Настройка Gmail

**ВАЖНО:** Для Gmail НЕЛЬЗЯ использовать обычный пароль! Нужен пароль приложения.

1. Включите двухфакторную аутентификацию в вашем Google аккаунте:
   - Перейдите на https://myaccount.google.com/security
   - Включите "Двухэтапная аутентификация"

2. Создайте пароль приложения:
   - Перейдите на https://myaccount.google.com/apppasswords
   - Или: Настройки аккаунта → Безопасность → Двухэтапная аутентификация → Пароли приложений
   - Выберите "Почта" и "Другое устройство"
   - Введите название: "QR SHOT Server"
   - Нажмите "Создать"
   - Скопируйте 16-значный пароль (без пробелов)
   - Используйте этот пароль в `SMTP_PASS` в файле `.env`

**Текущая ошибка:** "Application-specific password required" означает, что вы используете обычный пароль вместо пароля приложения.

## Настройка reCaptcha

1. Перейдите на https://www.google.com/recaptcha/admin/create
2. Выберите reCaptcha v2 → "Я не робот"
3. Добавьте домен вашего сайта (например: qrshot.kz)
4. Скопируйте Site Key и Secret Key
5. Добавьте Site Key в `frontend/js/contact-form.js` (замените `YOUR_RECAPTCHA_SITE_KEY`)
6. Добавьте Secret Key в `backend/.env` как `RECAPTCHA_SECRET_KEY`

## Обновление frontend

В файле `frontend/js/contact-form.js` замените:
```javascript
'sitekey': 'YOUR_RECAPTCHA_SITE_KEY',
```
на ваш реальный Site Key от Google reCaptcha.

## Тестирование

После настройки:
1. Перезапустите backend сервер
2. Откройте главную страницу
3. Нажмите "Создать мероприятие"
4. Заполните форму и отправьте заявку
5. Проверьте почту vladislav.ten1987@gmail.com

