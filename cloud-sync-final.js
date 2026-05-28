// ==================== 云端同步配置 ====================
const SYNC_PASSWORD = "HuikangTang2026!";
const USERNAME = "admin";

// 从云端拉取处方
async function syncFromCloud() {
    try {
        const response = await fetch("/api/sync", {
            headers: {
                "x-sync-password": SYNC_PASSWORD,
                "x-username": USERNAME
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data && data.length > 0) {
                const map = new Map();
                window.prescriptionHistory.forEach(p => map.set(p.id || p._id, p));
                data.forEach(p => {
                    const id = p.id || p._id;
                    if (!map.has(id)) {
                        map.set(id, p);
                    }
                });
                window.prescriptionHistory = Array.from(map.values()).sort((a, b) => 
                    (b.createdAt || b.id || 0) - (a.createdAt || a.id || 0)
                );
                window.setUserItem('prescriptionHistory', JSON.stringify(window.prescriptionHistory));
                window.renderHistoryList(window.prescriptionHistory.slice(0, 15));
                console.log("✅ 已从云端同步所有处方");
            }
        }
    } catch (e) {
        console.log("云端同步失败:", e.message);
    }
}

// 保存到处云端
async function syncPrescriptionToCloud(record) {
    try {
        window.prescriptionHistory.unshift(record);
        const json = JSON.stringify(window.prescriptionHistory);
        
        await fetch("/api/sync", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-sync-password": SYNC_PASSWORD,
                "x-username": USERNAME
            },
            body: json
        });
        
        console.log("✅ 处方已保存并同步云端");
        return true;
    } catch (e) {
        console.log("同步失败:", e.message);
        return false;
    }
}

// 修复登录后的同步
const originalHandleLogin = window.handleLogin;
window.handleLogin = async function() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    if (!username || !password) {
        errorDiv.textContent = '请输入用户名和密码';
        errorDiv.style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            window.currentUser = result.user;
            localStorage.setItem('currentUser', JSON.stringify(window.currentUser));
            localStorage.setItem('jwtToken', result.token);
            document.getElementById('loginOverlay').style.display = 'none';
            window.updateUserDisplay();
            errorDiv.style.display = 'none';
            
            await window.loadData();
            window.refreshUserInterface();
            
            // 登录后同步云端数据
            setTimeout(() => syncFromCloud(), 500);
        } else {
            errorDiv.textContent = result.error || '用户名或密码错误';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        errorDiv.textContent = '网络错误，请稍后重试';
        errorDiv.style.display = 'block';
    }
};

// 修复保存函数
const originalSavePrescription = window.savePrescription;
window.savePrescription = async function() {
    const name = document.getElementById('patientName').value;
    if (!name) {alert('请输入患者姓名！'); document.getElementById('patientName').focus(); return;}
    const currentDate = new Date().toISOString().split('T')[0];
    document.getElementById('visitDate').value = currentDate;
    document.getElementById('paperDate').textContent = currentDate;
    const doseInput = document.getElementById('doseCountInput') || document.getElementById('doseCountInput3');
    const doseCount = parseInt(doseInput ? doseInput.value : 7) || 7;
    const grandTotalEl = document.getElementById('grandTotal') || document.getElementById('grandTotal2');
    const record = {
        id: Date.now(),
        prescriptionNo: document.getElementById('prescriptionNo').value,
        date: document.getElementById('visitDate').value,
        patientName: name,
        patientGender: document.getElementById('patientGender').value,
        patientAge: document.getElementById('patientAge').value,
        patientPhone: document.getElementById('patientPhone').value,
        patientAddress: document.getElementById('patientAddress').value,
        clinicNo: document.getElementById('clinicNo').value,
        doctorName: document.getElementById('doctorName').value,
        medicalHistory: document.getElementById('medicalHistory').value,
        diagnosis: document.getElementById('diagnosis').value,
        items: window.prescriptionItems.filter(item => item.name),
        doseCount: doseCount,
        totalAmount: parseFloat(grandTotalEl ? grandTotalEl.textContent : 0),
        createdAt: Date.now()
    };
    
    window.prescriptionHistory.unshift(record);
    if (window.prescriptionHistory.length > 100000) {
        window.prescriptionHistory = window.prescriptionHistory.slice(0, 100000);
    }
    window.setUserItem('prescriptionHistory', JSON.stringify(window.prescriptionHistory));
    window.dailyCounter++;
    window.setUserItem('dailyCounter', window.dailyCounter);
    window.setUserItem('counterDate', window.currentPrescriptionDate);
    const newPrescriptionNo = window.generatePrescriptionNo();
    document.getElementById('prescriptionNo').value = newPrescriptionNo;
    document.getElementById('paperClinicNo').textContent = newPrescriptionNo;
    window.renderHistoryList(window.prescriptionHistory.slice(0, 15));
    
    // 同步到云端
    await syncPrescriptionToCloud(record);
    
    window.savePrescriptionAsImage(record, newPrescriptionNo);
    alert('处方保存成功！');
    window.searchPatientsQuick({target:{value:name}});
};

console.log('✅ 云端同步脚本已加载');