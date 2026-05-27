const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

router.post('/register', [
    body('username').isLength({ min: 3, max: 50 }).trim().escape(),
    body('password').isLength({ min: 6 }),
    body('name').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, password, name } = req.body;

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: '用户名已存在' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({
            username,
            password: hashedPassword,
            name: name || username
        });

        await user.save();

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
            message: '注册成功',
            user: user.toJSON(),
            token
        });
    } catch (error) {
        console.error('注册错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.post('/login', [
    body('username').notEmpty().trim(),
    body('password').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, password } = req.body;

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        user.lastLogin = Date.now();
        await user.save();

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            message: '登录成功',
            user: user.toJSON(),
            token
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.get('/me', auth, async (req, res) => {
    try {
        res.json({ user: req.user.toJSON() });
    } catch (error) {
        res.status(500).json({ error: '服务器错误' });
    }
});

module.exports = router;
