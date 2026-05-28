const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.')));

const SYNC_PASSWORD = process.env.SYNC_PASSWORD || 'HuikangTang2026!';
let prescriptions = {};

app.get('/api/sync', (req, res) => {
  const pass = req.headers['x-sync-password'];
  const user = req.headers['x-username'];
  
  if (pass !== SYNC_PASSWORD || !user) {
    return res.status(401).send('Unauthorized');
  }
  
  const key = 'prescriptions_' + user;
  res.json(prescriptions[key] || []);
});

app.post('/api/sync', (req, res) => {
  const pass = req.headers['x-sync-password'];
  const user = req.headers['x-username'];
  
  if (pass !== SYNC_PASSWORD || !user) {
    return res.status(401).send('Unauthorized');
  }
  
  const key = 'prescriptions_' + user;
  prescriptions[key] = req.body;
  res.send('ok');
});

app.post('/api/auth/init-admin', (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '缺少参数' });
  }
  res.json({ message: '管理员账户初始化成功', user: { username, name, role: 'admin' } });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin') {
    const token = 'mock-jwt-token-' + Date.now();
    res.json({ token, user: { username, name: '管理员', role: 'admin' } });
  } else {
    res.status(401).json({ error: '用户名或密码错误' });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});