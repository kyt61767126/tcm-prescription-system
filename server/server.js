require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const prescriptionRoutes = require('./routes/prescription');
const settingsRoutes = require('./routes/settings');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/settings', settingsRoutes);

app.use(express.static(path.join(__dirname, '..')));

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '服务器运行正常', version: 'Cloudflare KV版' });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`🚀 服务器运行在端口 ${PORT}`);
    console.log(`📦 使用 Cloudflare KV 存储`);
});