const express = require('express');
const jwt = require('jsonwebtoken');
const kv = require('../utils/cloudflareKV');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

const PRESCRIPTION_KEY_PREFIX = 'prescription_';

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
        const prefix = `${PRESCRIPTION_KEY_PREFIX}${req.user.username}_`;
        const keys = await kv.list(prefix);
        
        const prescriptions = [];
        for (const key of keys) {
            const prescription = await kv.get(key.name);
            if (prescription) {
                prescriptions.push(prescription);
            }
        }

        prescriptions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        res.json({ prescriptions });
    } catch (error) {
        console.error('获取处方列表错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const key = `${PRESCRIPTION_KEY_PREFIX}${req.user.username}_${req.params.id}`;
        const prescription = await kv.get(key);

        if (!prescription) {
            return res.status(404).json({ error: '处方不存在' });
        }

        res.json({ prescription });
    } catch (error) {
        console.error('获取处方详情错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.post('/', async (req, res) => {
    try {
        const id = Date.now().toString();
        const prescription = {
            _id: id,
            ...req.body,
            userId: req.user._id,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        const key = `${PRESCRIPTION_KEY_PREFIX}${req.user.username}_${id}`;
        await kv.put(key, prescription);

        res.status(201).json({
            message: '处方保存成功',
            prescription
        });
    } catch (error) {
        console.error('保存处方错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const key = `${PRESCRIPTION_KEY_PREFIX}${req.user.username}_${req.params.id}`;
        const existing = await kv.get(key);

        if (!existing) {
            return res.status(404).json({ error: '处方不存在' });
        }

        const updatedPrescription = {
            ...existing,
            ...req.body,
            updatedAt: Date.now()
        };

        await kv.put(key, updatedPrescription);

        res.json({
            message: '处方更新成功',
            prescription: updatedPrescription
        });
    } catch (error) {
        console.error('更新处方错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const key = `${PRESCRIPTION_KEY_PREFIX}${req.user.username}_${req.params.id}`;
        const existing = await kv.get(key);

        if (!existing) {
            return res.status(404).json({ error: '处方不存在' });
        }

        await kv.delete(key);

        res.json({ message: '处方删除成功' });
    } catch (error) {
        console.error('删除处方错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

module.exports = router;