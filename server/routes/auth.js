const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const kv = require('../utils/cloudflareKV');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

const USER_KEY_PREFIX = 'user_';

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

        const existingUser = await kv.get(`${USER_KEY_PREFIX}${username}`);
        if (existingUser) {
            return res.status(400).json({ error: '用户名已存在' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = {
            _id: Date.now().toString(),
            username,
            password: hashedPassword,
            name: name || username,
            role: username === 'admin' ? 'admin' : 'user',
            createdAt: Date.now(),
            lastLogin: null
        };

        await kv.put(`${USER_KEY_PREFIX}${username}`, user);

        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

        res.status(201).json({
            message: '注册成功',
            user: { ...user, password: undefined },
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

        const user = await kv.get(`${USER_KEY_PREFIX}${username}`);
        if (!user) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }

        user.lastLogin = Date.now();
        await kv.put(`${USER_KEY_PREFIX}${username}`, user);

        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            message: '登录成功',
            user: { ...user, password: undefined },
            token
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.post('/init-admin', async (req, res) => {
    try {
        const { username, password, name } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: '请提供用户名和密码' });
        }

        let user = await kv.get(`${USER_KEY_PREFIX}${username}`);
        
        if (user) {
            user.role = 'admin';
            await kv.put(`${USER_KEY_PREFIX}${username}`, user);
        } else {
            const hashedPassword = await bcrypt.hash(password, 10);
            user = {
                _id: Date.now().toString(),
                username,
                password: hashedPassword,
                name: name || username,
                role: 'admin',
                createdAt: Date.now(),
                lastLogin: null
            };
            await kv.put(`${USER_KEY_PREFIX}${username}`, user);
        }

        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            message: '管理员账户初始化成功',
            user: { ...user, password: undefined },
            token
        });
    } catch (error) {
        console.error('初始化管理员错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未授权' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const user = await kv.get(`${USER_KEY_PREFIX}${decoded.username}`);
        if (!user) {
            return res.status(401).json({ error: '用户不存在' });
        }

        res.json({ user: { ...user, password: undefined } });
    } catch (error) {
        console.error('获取用户信息错误:', error);
        res.status(401).json({ error: '无效的token' });
    }
});

router.put('/role', [
    body('username').notEmpty().trim(),
    body('role').isIn(['admin', 'user'])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未授权' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const currentUser = await kv.get(`${USER_KEY_PREFIX}${decoded.username}`);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ error: '无权限' });
        }

        const { username, role } = req.body;
        const user = await kv.get(`${USER_KEY_PREFIX}${username}`);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        user.role = role;
        await kv.put(`${USER_KEY_PREFIX}${username}`, user);

        res.json({ message: '角色更新成功', user: { ...user, password: undefined } });
    } catch (error) {
        console.error('更新角色错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.put('/reset-password', [
    body('username').notEmpty().trim(),
    body('newPassword').isLength({ min: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未授权' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const currentUser = await kv.get(`${USER_KEY_PREFIX}${decoded.username}`);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ error: '无权限，只有管理员可以重置密码' });
        }

        const { username, newPassword } = req.body;
        const user = await kv.get(`${USER_KEY_PREFIX}${username}`);
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        await kv.put(`${USER_KEY_PREFIX}${username}`, user);

        res.json({ message: '密码重置成功' });
    } catch (error) {
        console.error('重置密码错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.put('/password', [
    body('oldPassword').notEmpty(),
    body('newPassword').isLength({ min: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未授权' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const user = await kv.get(`${USER_KEY_PREFIX}${decoded.username}`);
        if (!user) {
            return res.status(401).json({ error: '用户不存在' });
        }

        const { oldPassword, newPassword } = req.body;
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        
        if (!isMatch) {
            return res.status(401).json({ error: '原密码错误' });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        await kv.put(`${USER_KEY_PREFIX}${decoded.username}`, user);

        res.json({ message: '密码修改成功' });
    } catch (error) {
        console.error('修改密码错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.get('/users', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未授权' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const currentUser = await kv.get(`${USER_KEY_PREFIX}${decoded.username}`);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ error: '无权限' });
        }

        const keys = await kv.list(USER_KEY_PREFIX);
        const users = [];
        
        for (const key of keys) {
            const user = await kv.get(key.name);
            if (user) {
                users.push({ ...user, password: undefined });
            }
        }

        users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        res.json({ users });
    } catch (error) {
        console.error('获取用户列表错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.delete('/users/:username', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: '未授权' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const currentUser = await kv.get(`${USER_KEY_PREFIX}${decoded.username}`);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ error: '无权限' });
        }

        const { username } = req.params;
        const user = await kv.get(`${USER_KEY_PREFIX}${username}`);
        
        if (!user) {
            return res.status(404).json({ error: '用户不存在' });
        }

        if (username === 'admin') {
            return res.status(400).json({ error: '不能删除管理员账户' });
        }

        await kv.delete(`${USER_KEY_PREFIX}${username}`);
        res.json({ message: '用户删除成功' });
    } catch (error) {
        console.error('删除用户错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

module.exports = router;
router.get('/users', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'δ��Ȩ' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const currentUser = await kv.get(`${USER_KEY_PREFIX}${decoded.username}`);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ error: '��Ȩ��' });
        }
        const keys = await kv.list(USER_KEY_PREFIX);
        const users = [];
        for (const key of keys) {
            const user = await kv.get(key.name);
            if (user) {
                users.push({ ...user, password: undefined });
            }
        }
        users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        res.json({ users });
    } catch (error) {
        console.error('��ȡ�û��б�����:', error);
        res.status(500).json({ error: '����������' });
    }
});

router.delete('/users/:username', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'δ��Ȩ' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const currentUser = await kv.get(`${USER_KEY_PREFIX}${decoded.username}`);
        if (!currentUser || currentUser.role !== 'admin') {
            return res.status(403).json({ error: '��Ȩ��' });
        }
        const { username } = req.params;
        const user = await kv.get(`${USER_KEY_PREFIX}${username}`);
        if (!user) {
            return res.status(404).json({ error: '�û�������' });
        }
        if (username === 'admin') {
            return res.status(400).json({ error: '����ɾ������Ա�˻�' });
        }
        await kv.delete(`${USER_KEY_PREFIX}${username}`);
        res.json({ message: '�û�ɾ���ɹ�' });
    } catch (error) {
        console.error('ɾ���û�����:', error);
        res.status(500).json({ error: '����������' });
    }
});

module.exports = router;
