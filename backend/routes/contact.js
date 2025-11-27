const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const axios = require('axios');
require('dotenv').config();

// Создаем транспортер для отправки email
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true для 465, false для других портов
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Проверка подключения к SMTP при запуске
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter.verify(function(error, success) {
        if (error) {
            console.error('SMTP connection error:', error);
        } else {
            console.log('SMTP server is ready to send emails');
        }
    });
} else {
    console.warn('SMTP credentials not configured. Email sending will fail.');
}

// Проверка reCaptcha
async function verifyRecaptcha(token) {
    if (!token) {
        console.error('reCAPTCHA token is missing');
        return false;
    }

    if (!process.env.RECAPTCHA_SECRET_KEY) {
        console.error('RECAPTCHA_SECRET_KEY is not configured');
        return false;
    }

    try {
        const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
            params: {
                secret: process.env.RECAPTCHA_SECRET_KEY,
                response: token
            }
        });

        console.log('reCAPTCHA verification response:', {
            success: response.data.success,
            'error-codes': response.data['error-codes']
        });

        return response.data.success === true;
    } catch (error) {
        console.error('reCaptcha verification error:', error.message);
        if (error.response) {
            console.error('reCAPTCHA API response:', error.response.data);
        }
        return false;
    }
}

// Отправка заявки
router.post('/', async (req, res) => {
    try {
        const { name, phone, message, recaptcha } = req.body;

        console.log('Contact form submission:', { name, phone, hasMessage: !!message, hasRecaptcha: !!recaptcha });

        // Валидация
        if (!name || !phone || !message) {
            return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
        }

        // Проверка reCaptcha
        if (!recaptcha) {
            return res.status(400).json({ error: 'Пожалуйста, подтвердите, что вы не робот' });
        }

        const isRecaptchaValid = await verifyRecaptcha(recaptcha);
        if (!isRecaptchaValid) {
            console.error('reCAPTCHA verification failed');
            return res.status(400).json({ error: 'Ошибка проверки reCaptcha. Попробуйте еще раз.' });
        }

        console.log('reCAPTCHA verified successfully');

    // Формируем email
    const mailOptions = {
        from: process.env.SMTP_USER,
        to: 'vladislav.ten1987@gmail.com',
        subject: 'Новая заявка с сайта QR SHOT',
        html: `
            <h2>Новая заявка с сайта QR SHOT</h2>
            <p><strong>Имя:</strong> ${escapeHtml(name)}</p>
            <p><strong>Телефон:</strong> ${escapeHtml(phone)}</p>
            <p><strong>Сообщение:</strong></p>
            <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
            <hr>
            <p style="color: #666; font-size: 12px;">Дата отправки: ${new Date().toLocaleString('ru-RU')}</p>
        `
    };

        try {
            await transporter.sendMail(mailOptions);
            console.log('Contact form email sent successfully');
            res.json({ success: true, message: 'Заявка успешно отправлена' });
        } catch (error) {
            console.error('Email sending error:', error);
            console.error('Error details:', {
                message: error.message,
                code: error.code,
                response: error.response
            });
            res.status(500).json({ 
                error: error.message || 'Ошибка при отправке заявки. Попробуйте позже.',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    } catch (error) {
        console.error('Contact form route error:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Функция для экранирования HTML
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

module.exports = router;

