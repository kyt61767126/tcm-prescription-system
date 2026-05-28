        async function syncFromCloud() {
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
                        prescriptionHistory.forEach(p => {
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
                console.log('⚠️ 云端同步失败:', error.message);
            }
        }
        
        async function syncPrescriptionToCloud(record) {
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
        }