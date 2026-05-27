const express = require('express');
const Settings = require('../models/Settings');
const auth = require('../middleware/auth');

const router = express.Router();

router.use(auth);

router.get('/', async (req, res) => {
    try {
        let settings = await Settings.findOne({ userId: req.user._id });

        if (!settings) {
            settings = new Settings({ userId: req.user._id });
            await settings.save();
        }

        res.json({ settings });
    } catch (error) {
        console.error('获取设置错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.put('/', async (req, res) => {
    try {
        const settings = await Settings.findOneAndUpdate(
            { userId: req.user._id },
            { ...req.body, updatedAt: Date.now() },
            { new: true, upsert: true, runValidators: true }
        );

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
