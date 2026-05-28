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
      const cloudData = await res.json();
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

document.addEventListener('DOMContentLoaded', function() {
  console.log("📄 DOM 加载完成，等待登录后同步数据...");
  
  const checkAndSync = setInterval(function() {
    const loginOverlay = document.getElementById('loginOverlay');
    if (loginOverlay) {
      const style = window.getComputedStyle(loginOverlay);
      if (style.display === 'none') {
        clearInterval(checkAndSync);
        console.log("🔓 用户已登录，开始同步云端数据...");
        loadFromCloud();
      }
    }
  }, 500);
});

window.simpleLogin = async function() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorDiv = document.getElementById('loginError');
  
  console.log('🔑 登录按钮点击:', username);
  
  if (!username || !password) {
    errorDiv.textContent = '请输入用户名和密码';
    errorDiv.style.display = 'block';
    return;
  }
  
  try {
    const response = await fetch('https://tcm-prescription-api.61767126.workers.dev/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    console.log('📡 API 返回状态:', response.status);
    const result = await response.json();
    console.log('📡 API 返回数据:', result);
    
    if (response.ok) {
      window.currentUser = result.user;
      localStorage.setItem('currentUser', JSON.stringify(result.user));
      localStorage.setItem('jwtToken', result.token);
      document.getElementById('loginOverlay').style.display = 'none';
      
      const userDisplay = document.getElementById('currentUser');
      if (userDisplay) {
        userDisplay.textContent = result.user.name;
      }
      
      errorDiv.style.display = 'none';
      loadFromCloud();
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

console.log("📦 sync script loaded");