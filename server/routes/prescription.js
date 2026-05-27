const express = require('express');
const Prescription = require('../models/Prescription');
const auth = require('../middleware/auth');

const router = express.Router();

router.use(auth);

router.get('/', async (req, res) => {
    try {
        const prescriptions = await Prescription.find({ userId: req.user._id })
            .sort({ createdAt: -1 })
            .limit(100);

        res.json({ prescriptions });
    } catch (error) {
        console.error('获取处方列表错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const prescription = await Prescription.findOne({
            _id: req.params.id,
            userId: req.user._id
        });

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
        const prescription = new Prescription({
            ...req.body,
            userId: req.user._id
        });

        await prescription.save();

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
        const prescription = await Prescription.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { ...req.body, updatedAt: Date.now() },
            { new: true, runValidators: true }
        );

        if (!prescription) {
            return res.status(404).json({ error: '处方不存在' });
        }

        res.json({
            message: '处方更新成功',
            prescription
        });
    } catch (error) {
        console.error('更新处方错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const prescription = await Prescription.findOneAndDelete({
            _id: req.params.id,
            userId: req.user._id
        });

        if (!prescription) {
            return res.status(404).json({ error: '处方不存在' });
        }

        res.json({ message: '处方删除成功' });
    } catch (error) {
        console.error('删除处方错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

module.exports = router;
