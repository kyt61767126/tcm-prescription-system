const SYNC_PASSWORD = "HuikangTang2026!";
const USERNAME = "admin";
const API_URL = "https://tcm-prescription-api.61767126.workers.dev";

let cloudPrescriptions = [];

async function loadFromCloud() {
  try {
    console.log("🔄 正在从云端加载数据...");
    const res = await fetch(API_URL + "/api/sync", {
      headers: {
        "x-sync-password": SYNC_PASSWORD,
        "x-username": USERNAME
      }
    });

    if (res.ok) {
      const text = await res.text();
      console.log("📥 云端返回原始数据:", text);
      
      let cloudData;
      try {
        cloudData = JSON.parse(text);
      } catch {
        console.log("❌ 云端数据不是有效JSON，使用空数组");
        cloudData = [];
      }
      
      cloudPrescriptions = Array.isArray(cloudData) ? cloudData : [];
      localStorage.setItem("prescriptions", JSON.stringify(cloudPrescriptions));
      console.log("✅ 云端数据加载成功，共 " + cloudPrescriptions.length + " 条记录");
      
      if (typeof renderHistoryList === 'function') {
        const list = cloudPrescriptions.slice(0, 15);
        renderHistoryList(list);
      }
    } else {
      console.log("❌ 云端加载失败：" + res.status);
    }
  } catch (e) {
    console.log("❌ 云端同步出错：" + e.message);
    cloudPrescriptions = JSON.parse(localStorage.getItem("prescriptions") || "[]");
    if (typeof renderHistoryList === 'function') {
      renderHistoryList(cloudPrescriptions.slice(0, 15));
    }
  }
}

async function saveToCloud(prescription) {
  try {
    cloudPrescriptions.push(prescription);
    const json = JSON.stringify(cloudPrescriptions);

    localStorage.setItem("prescriptions", json);

    const res = await fetch(API_URL + "/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-password": SYNC_PASSWORD,
        "x-username": USERNAME
      },
      body: json
    });

    if (res.ok) {
      if (typeof renderHistoryList === 'function') {
        renderHistoryList(cloudPrescriptions.slice(0, 15));
      }
      alert("✅ 保存并同步云端成功");
    } else {
      alert("❌ 保存失败：云端同步失败");
    }
  } catch (e) {
    alert("❌ 保存失败：" + e.message);
  }
}

window.simpleLogin = async function() {
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const errorDiv = document.getElementById('loginError');
  
  if (!usernameInput || !passwordInput) {
    console.error('❌ 找不到登录输入框');
    return;
  }
  
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  
  console.log('🔑 登录按钮点击:', username);
  
  if (!username || !password) {
    errorDiv.textContent = '请输入用户名和密码';
    errorDiv.style.display = 'block';
    return;
  }
  
  try {
    console.log('📡 正在调用登录API...');
    const response = await fetch(API_URL + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    console.log('📡 API 返回状态:', response.status);
    
    const text = await response.text();
    console.log('📡 API 返回原始数据:', text);
    
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      console.error('❌ API返回不是JSON:', text);
      errorDiv.textContent = '服务器返回格式错误';
      errorDiv.style.display = 'block';
      return;
    }
    
    if (response.ok) {
      window.currentUser = result.user;
      localStorage.setItem('currentUser', JSON.stringify(result.user));
      localStorage.setItem('jwtToken', result.token);
      
      const loginOverlay = document.getElementById('loginOverlay');
      if (loginOverlay) {
        loginOverlay.style.display = 'none';
      }
      
      const userDisplay = document.getElementById('currentUser');
      if (userDisplay) {
        userDisplay.textContent = result.user.name;
      }
      
      errorDiv.style.display = 'none';
      
      await loadFromCloud();
      alert('✅ 登录成功！');
    } else {
      errorDiv.textContent = result.error || '用户名或密码错误';
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    console.error('❌ 登录错误:', error);
    errorDiv.textContent = '网络错误，请稍后重试: ' + error.message;
    errorDiv.style.display = 'block';
  }
};

console.log("📦 sync script loaded - simpleLogin function is ready");

window.addEventListener('DOMContentLoaded', function() {
  console.log("📄 DOM 加载完成");
});