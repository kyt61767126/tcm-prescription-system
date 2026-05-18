console.log('系统加载中...');

window.addEventListener('DOMContentLoaded', function() {
  console.log('DOM加载完成');
  
  const version = '2.1.0-cloud';
  
  function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  function getDefaultUsers() {
    return [
      {username: 'admin', password: hashPassword('admin123'), name: '管理员', role: 'admin'},
      {username: 'doctor1', password: hashPassword('doctor123'), name: '张医生', role: 'user'},
      {username: 'doctor2', password: hashPassword('doctor123'), name: '李医生', role: 'user'}
    ];
  }

  function getUsers() {
    const saved = localStorage.getItem('cloudUsers');
    return saved ? JSON.parse(saved) : getDefaultUsers();
  }

  function saveUsers(users) {
    localStorage.setItem('cloudUsers', JSON.stringify(users));
  }

  function renderLogin() {
    console.log('渲染登录页面');
    const html = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Microsoft YaHei', sans-serif; background: #f0f0f0; }
        .login-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; justify-content: center; align-items: center; }
        .login-box { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); width: 350px; text-align: center; }
        .login-title { font-size: 24px; font-weight: bold; color: #333; margin-bottom: 30px; }
        .login-input { width: 100%; padding: 12px 15px; margin: 10px 0; border: 2px solid #ddd; border-radius: 6px; font-size: 14px; }
        .login-input:focus { border-color: #667eea; outline: none; }
        .login-btn { width: 100%; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 15px; }
        .version-tag { color: #008000; font-weight: bold; margin-bottom: 20px; }
      </style>
      <div id="loginOverlay" class="login-overlay">
        <div class="login-box">
          <div class="login-title">🏥 本能中医处方系统</div>
          <div class="version-tag">【云端版 v${version}】</div>
          <input type="text" id="loginUsername" class="login-input" placeholder="用户名: admin">
          <input type="password" id="loginPassword" class="login-input" placeholder="密码: admin123">
          <button class="login-btn" onclick="handleLogin()">登 录</button>
        </div>
      </div>
    `;
    document.body.innerHTML = html;
  }

  function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    const users = getUsers();
    const hashedPassword = hashPassword(password);
    const user = users.find(u => u.username === username && u.password === hashedPassword);
    
    if (user) {
      localStorage.setItem('currentUser', JSON.stringify(user));
      alert('登录成功！欢迎 ' + user.name);
    } else {
      alert('用户名或密码错误');
    }
  }

  const savedUser = localStorage.getItem('currentUser');
  if (savedUser) {
    alert('欢迎回来！');
  } else {
    renderLogin();
  }
  
  console.log('初始化完成');
});
