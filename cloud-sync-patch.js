// ==Cloud Sync Fix Script==
// 修复云端同步问题

(function() {
    'use strict';
    
    // 保存原始函数
    const originalHandleLogin = window.handleLogin;
    const originalSavePrescription = window.savePrescription;
    const originalSyncFromCloud = window.syncFromCloud;
    
    // 修复后的同步函数
    window.syncFromCloud = async function() {
        try {
            const token = localStorage.getItem('jwtToken');
            if (!token) {
                console.log('⚠️ 没有登录令牌');
                return;
            }
            
            console.log('🔄 正在从云端同步数据...');
            const response = await fetch('/api/prescriptions', {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.prescriptions && data.prescriptions.length > 0) {
                    const map = new Map();
                    window.prescriptionHistory.forEach(p => {
                        const id = p.id || p._id;
                        if (id) map.set(id, p);
                    });
                    
                    data.prescriptions.forEach(p => {
                        const id = p.id || p._id;
                        if (id) {
                            const existing = map.get(id);
                            if (!existing || (p.updatedAt && (!existing.updatedAt || p.updatedAt > existing.updatedAt))) {
                                map.set(id, p);
                            }
                        }
                    });
                    
                    const merged = Array.from(map.values()).sort((a, b) => 
                        (b.createdAt || b.updatedAt || b.id || 0) - (a.createdAt || a.updatedAt || a.id || 0)
                    );
                    
                    const newCount = merged.length - window.prescriptionHistory.length;
                    window.prescriptionHistory = merged;
                    window.setUserItem('prescriptionHistory', JSON.stringify(window.prescriptionHistory));
                    window.renderHistoryList(window.prescriptionHistory.slice(0, 15));
                    console.log(`✅ 已从云端同步 ${data.prescriptions.length} 条处方记录，新增 ${newCount} 条`);
                } else {
                    console.log('ℹ️ 云端没有新的处方记录');
                }
            } else {
                const error = await response.json().catch(() => ({ error: '未知错误' }));
                console.log('⚠️ 云端同步失败:', response.status, error.error);
            }
        } catch (error) {
            console.log('⚠️ 云端同步失败:', error.message);
        }
    };
    
    // 修复后的上传函数
    window.syncPrescriptionToCloud = async function(record) {
        try {
            const token = localStorage.getItem('jwtToken');
            if (!token) {
                console.log('⚠️ 没有登录令牌');
                return false;
            }
            
            console.log('🔄 正在上传处方到云端...');
            const response = await fetch('/api/prescriptions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token
                },
                body: JSON.stringify(record)
            });
            
            if (response.ok) {
                console.log('✅ 处方已上传到云端');
                return true;
            } else {
                const error = await response.json().catch(() => ({ error: '未知错误' }));
                console.log('⚠️ 处方上传失败:', response.status, error.error);
            }
        } catch (error) {
            console.log('⚠️ 处方上传失败:', error.message);
        }
        return false;
    };
    
    // 修复后的登录函数
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
                
                // 登录后延迟同步云端数据
                setTimeout(async function() {
                    if (window.currentUser && localStorage.getItem('jwtToken')) {
                        await window.syncFromCloud();
                    }
                }, 500);
                
                console.log('✅ 登录成功！');
            } else {
                errorDiv.textContent = result.error || '用户名或密码错误';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            errorDiv.textContent = '网络错误，请稍后重试';
            errorDiv.style.display = 'block';
        }
    };
    
    // 修复后的保存函数
    window.savePrescription = function() {
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
        
        // 上传到云端
        window.syncPrescriptionToCloud(record);
        
        // 上传后刷新云端数据
        setTimeout(async function() {
            if (window.currentUser && localStorage.getItem('jwtToken')) {
                await window.syncFromCloud();
            }
        }, 500);
        
        window.savePrescriptionAsImage(record, newPrescriptionNo);
        alert('处方保存成功！');
        window.searchPatientsQuick({target:{value:name}});
    };
    
    console.log('✅ 云端同步修复脚本已加载');
})();