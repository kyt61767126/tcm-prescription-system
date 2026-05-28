        async function checkLoginStatus() {
            const sessionUser = sessionStorage.getItem('currentUser');
            const localUser = localStorage.getItem('currentUser');
            const token = localStorage.getItem('jwtToken');
            
            if (sessionUser) {
                try {
                    currentUser = JSON.parse(sessionUser);
                    document.getElementById('loginOverlay').style.display = 'none';
                    updateUserDisplay();
                } catch (e) {
                    console.error('解析用户数据失败:', e);
                    currentUser = null;
                    document.getElementById('loginOverlay').style.display = 'flex';
                }
            } else if (localUser) {
                try {
                    currentUser = JSON.parse(localUser);
                    if (token) {
                        document.getElementById('loginOverlay').style.display = 'none';
                        updateUserDisplay();
                    } else {
                        currentUser = null;
                        document.getElementById('loginOverlay').style.display = 'flex';
                    }
                } catch (e) {
                    console.error('解析用户数据失败:', e);
                    currentUser = null;
                    document.getElementById('loginOverlay').style.display = 'flex';
                }
            } else {
                currentUser = null;
                document.getElementById('loginOverlay').style.display = 'flex';
            }
        }
        
        async function init() {
            await checkLoginStatus();
            await loadData();
            const now = new Date();
            currentPrescriptionDate = now.toDateString();
            document.getElementById('visitDate').value = now.toLocaleDateString('zh-CN');
            const presNo = generatePrescriptionNo();
            document.getElementById('prescriptionNo').value = presNo;
            document.getElementById('paperClinicNo').textContent = presNo;
            document.getElementById('clinicName').value = getUserItem('clinicName') || '惠康堂中医诊所';
            document.getElementById('clinicNameDisplay').textContent = getUserItem('clinicName') || '惠康堂中医诊所';
            document.getElementById('defaultRegFee').value = getUserItem('defaultRegFee') || '0';
            document.getElementById('defaultDose').value = getUserItem('defaultDose') || '7';
            const regFeeVal = getUserItem('defaultRegFee') || '0';
            const regFeeEl = document.getElementById('registrationFee');
            if (regFeeEl) regFeeEl.value = regFeeVal;
            const regFeeEl2 = document.getElementById('registrationFee2');
            if (regFeeEl2) regFeeEl2.value = regFeeVal;
            const doseVal = getUserItem('defaultDose') || '7';
            const doseInput = document.getElementById('doseCountInput');
            if (doseInput) doseInput.value = doseVal;
            const doseInput3 = document.getElementById('doseCountInput3');
            if (doseInput3) doseInput3.value = doseVal;
            document.getElementById('paperDoseCount').textContent = doseVal;
            document.getElementById('doctorName').value = getUserItem('defaultDoctor') || '王桂杰';
            buildMedicineMap();
            updateStats();
            if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
                if (!localStorage.getItem('clearDefaultMedicines')) {
                    localStorage.setItem('medicines', JSON.stringify(defaultMedicines));
                    localStorage.setItem('clearDefaultMedicines', 'true');
                }
            }
            document.addEventListener('keydown', handleKeyDown);
        }
        
        async function loadData() {
            const savedFormulas = getUserItem('formulas');
            const savedHistory = getUserItem('prescriptionHistory');
            const savedDailyCounter = getUserItem('dailyCounter');
            const savedCounterDate = getUserItem('counterDate');
            const savedMedicines = localStorage.getItem('medicines');
            
            formulas = safeParseJSON(savedFormulas, []);
            prescriptionHistory = safeParseJSON(savedHistory, []);
            
            if (currentUser) {
                dailyCounter = parseInt(savedDailyCounter) || 1;
                if (savedCounterDate) {
                    currentPrescriptionDate = savedCounterDate;
                }
            }
            
            if (currentUser && localStorage.getItem('jwtToken')) {
                console.log('🔄 尝试从云端同步数据...');
                await syncFromCloud();
            }
        }
        
        async function syncFromCloud() {
            try {
                const token = localStorage.getItem('jwtToken');
                if (!token) {
                    console.log('⚠️ 没有登录令牌，跳过云端同步');
                    return;
                }
                
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
                        const merged = mergePrescriptions(prescriptionHistory, data.prescriptions);
                        const newCount = merged.length - prescriptionHistory.length;
                        prescriptionHistory = merged;
                        setUserItem('prescriptionHistory', JSON.stringify(prescriptionHistory));
                        renderHistoryList(prescriptionHistory.slice(0, 15));
                        console.log(`✅ 已从云端同步 ${data.prescriptions.length} 条处方记录，新增 ${newCount} 条`);
                    } else {
                        console.log('ℹ️ 云端没有新的处方记录');
                    }
                } else {
                    const error = await response.json().catch(() => ({ error: '未知错误' }));
                    console.log('⚠️ 云端同步失败:', response.status, error.error);
                }
            } catch (error) {
                console.log('⚠️ 云端同步失败，使用本地数据:', error.message);
            }
        }
        
        function mergePrescriptions(localData, cloudData) {
            const map = new Map();
            
            localData.forEach(p => {
                const id = p.id || p._id;
                if (id) map.set(id, p);
            });
            
            cloudData.forEach(p => {
                const id = p.id || p._id;
                if (id) {
                    const existing = map.get(id);
                    if (!existing || (p.updatedAt && (!existing.updatedAt || p.updatedAt > existing.updatedAt))) {
                        map.set(id, p);
                    }
                }
            });
            
            return Array.from(map.values())
                .sort((a, b) => (b.createdAt || b.updatedAt || b.id || 0) - (a.createdAt || a.updatedAt || a.id || 0));
        }
        
        async function syncPrescriptionToCloud(record) {
            try {
                const token = localStorage.getItem('jwtToken');
                if (!token) {
                    console.log('⚠️ 没有登录令牌，跳过云端同步');
                    return false;
                }
                
                const response = await fetch('/api/prescriptions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify(record)
                });
                
                if (response.ok) {
                    console.log('✅ 处方已同步到云端');
                    return true;
                } else {
                    const error = await response.json().catch(() => ({ error: '未知错误' }));
                    console.log('⚠️ 处方同步失败:', response.status, error.error);
                }
            } catch (error) {
                console.log('⚠️ 处方同步到云端失败:', error.message);
            }
            return false;
        }
        
        async function handleLogin() {
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
                    currentUser = result.user;
                    localStorage.setItem('currentUser', JSON.stringify(currentUser));
                    localStorage.setItem('jwtToken', result.token);
                    document.getElementById('loginOverlay').style.display = 'none';
                    updateUserDisplay();
                    errorDiv.style.display = 'none';
                    await loadData();
                    refreshUserInterface();
                    console.log('✅ 登录成功，正在同步云端数据...');
                } else {
                    errorDiv.textContent = result.error || '用户名或密码错误';
                    errorDiv.style.display = 'block';
                }
            } catch (error) {
                errorDiv.textContent = '网络错误，请稍后重试';
                errorDiv.style.display = 'block';
            }
        }