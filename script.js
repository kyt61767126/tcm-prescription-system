// 配置（已写死，无需修改）
const SYNC_PASSWORD = "HuikangTang2026!";
const USERNAME = "admin";
let prescriptions = [];

// 关键函数1：页面加载时，自动从云端拉取数据
async function loadFromCloud() {
  try {
    const res = await fetch("/api/sync", {
      headers: {
        "x-sync-password": SYNC_PASSWORD,
        "x-username": USERNAME
      }
    });

    if (res.ok) {
      const cloudData = await res.json();
      prescriptions = Array.isArray(cloudData) ? cloudData : [];
      localStorage.setItem("prescriptions", JSON.stringify(prescriptions));
      if (typeof renderHistoryList === 'function') {
        renderHistoryList(prescriptions.slice(0, 15));
      }
      console.log("✅ 云端数据加载成功");
    } else {
      console.log("❌ 云端加载失败：" + res.status);
    }
  } catch (e) {
    console.log("❌ 云端同步出错：" + e.message);
    prescriptions = JSON.parse(localStorage.getItem("prescriptions") || "[]");
    if (typeof renderHistoryList === 'function') {
      renderHistoryList(prescriptions.slice(0, 15));
    }
  }
}

// 关键函数2：保存处方时，同时写入本地和云端
async function saveToCloud(prescription) {
  try {
    prescriptions.push(prescription);
    const json = JSON.stringify(prescriptions);

    // 保存到本地
    localStorage.setItem("prescriptions", json);

    // 保存到云端
    const res = await fetch("/api/sync", {
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
        renderHistoryList(prescriptions.slice(0, 15));
      }
      alert("✅ 保存并同步云端成功");
    } else {
      alert("❌ 保存失败：云端同步失败");
    }
  } catch (e) {
    alert("❌ 保存失败：" + e.message);
  }
}

// 关键绑定：页面一打开就执行同步
window.addEventListener("load", loadFromCloud);