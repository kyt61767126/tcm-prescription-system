require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const prescriptionRoutes = require('./routes/prescription');
const settingsRoutes = require('./routes/settings');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/settings', settingsRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '服务器运行正常' });
});

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/tcm-prescription';

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ MongoDB连接成功');
        app.listen(PORT, () => {
            console.log(`🚀 服务器运行在端口 ${PORT}`);
        });
    })
    .catch(err => {
        console.error('❌ MongoDB连接失败:', err);
        process.exit(1);
    });
