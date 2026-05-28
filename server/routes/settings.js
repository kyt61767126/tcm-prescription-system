const express = require('express');
const jwt = require('jsonwebtoken');
const kv = require('../utils/cloudflareKV');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

const SETTINGS_KEY_PREFIX = 'settings_';

async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未授权' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        req.user = {
            _id: decoded.userId,
            username: decoded.username
        };
        
        next();
    } catch (error) {
        console.error('认证错误:', error);
        res.status(401).json({ error: '无效的token' });
    }
}

router.use(authenticate);

router.get('/', async (req, res) => {
    try {
        const key = `${SETTINGS_KEY_PREFIX}${req.user.username}`;
        let settings = await kv.get(key);

        if (!settings) {
            settings = {
                clinicName: '惠康堂中医诊所',
                defaultDoctor: '',
                defaultRegFee: 0,
                defaultDose: 7,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            await kv.put(key, settings);
        }

        res.json({ settings });
    } catch (error) {
        console.error('获取设置错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.put('/', async (req, res) => {
    try {
        const key = `${SETTINGS_KEY_PREFIX}${req.user.username}`;
        const existing = await kv.get(key);

        const settings = {
            ...(existing || { createdAt: Date.now() }),
            ...req.body,
            updatedAt: Date.now()
        };

        await kv.put(key, settings);

        res.json({
            message: '设置保存成功',
            settings
        });
    } catch (error) {
        console.error('保存设置错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

module.exports = router;