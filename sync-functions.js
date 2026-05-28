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
                await syncFromCloud();
            }
        }
        
        async function syncFromCloud() {
            try {
                const token = localStorage.getItem('jwtToken');
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
                        prescriptionHistory = merged;
                        setUserItem('prescriptionHistory', JSON.stringify(prescriptionHistory));
                        renderHistoryList(prescriptionHistory.slice(0, 15));
                        console.log('✅ 已从云端同步 ' + data.prescriptions.length + ' 条处方记录');
                    }
                } else {
                    console.log('⚠️ 云端同步失败:', response.status);
                }
            } catch (error) {
                console.log('⚠️ 云端同步失败，使用本地数据:', error.message);
            }
        }
        
        function mergePrescriptions(localData, cloudData) {
            const map = new Map();
            
            localData.forEach(p => {
                map.set(p.id || p._id, p);
            });
            
            cloudData.forEach(p => {
                const id = p.id || p._id;
                const existing = map.get(id);
                if (!existing || (p.createdAt && (!existing.createdAt || p.createdAt > existing.createdAt))) {
                    map.set(id, p);
                }
            });
            
            return Array.from(map.values())
                .sort((a, b) => (b.createdAt || b.id || 0) - (a.createdAt || a.id || 0));
        }
        
        async function syncPrescriptionToCloud(record) {
            try {
                const token = localStorage.getItem('jwtToken');
                if (!token) return false;
                
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
                    const result = await response.json();
                    console.log('⚠️ 处方同步失败:', result.error || response.status);
                }
            } catch (error) {
                console.log('⚠️ 处方同步到云端失败:', error.message);
            }
            return false;
        }