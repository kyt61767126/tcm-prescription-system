<script>
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
            
            setTimeout(async function() {
                if (currentUser && localStorage.getItem('jwtToken')) {
                    await syncFromCloud();
                }
            }, 500);
        } else {
            errorDiv.textContent = result.error || '用户名或密码错误';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        errorDiv.textContent = '网络错误，请稍后重试';
        errorDiv.style.display = 'block';
    }
}

async function syncFromCloud() {
    try {
        const token = localStorage.getItem('jwtToken');
        if (!token) return;
        
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
                prescriptionHistory.forEach(p => map.set(p.id || p._id, p));
                data.prescriptions.forEach(p => {
                    const id = p.id || p._id;
                    const existing = map.get(id);
                    if (!existing || (p.updatedAt && (!existing.updatedAt || p.updatedAt > existing.updatedAt))) {
                        map.set(id, p);
                    }
                });
                prescriptionHistory = Array.from(map.values()).sort((a, b) => 
                    (b.createdAt || b.updatedAt || b.id || 0) - (a.createdAt || a.updatedAt || a.id || 0)
                );
                setUserItem('prescriptionHistory', JSON.stringify(prescriptionHistory));
                renderHistoryList(prescriptionHistory.slice(0, 15));
            }
        }
    } catch (error) {
        console.log('同步失败:', error.message);
    }
}

async function syncPrescriptionToCloud(record) {
    try {
        const token = localStorage.getItem('jwtToken');
        if (!token) return;
        
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
        }
    } catch (error) {
        console.log('上传失败:', error.message);
    }
}

function savePrescription() {
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
        items: prescriptionItems.filter(item => item.name),
        doseCount: doseCount,
        totalAmount: parseFloat(grandTotalEl ? grandTotalEl.textContent : 0),
        createdAt: Date.now()
    };
    prescriptionHistory.unshift(record);
    if (prescriptionHistory.length > 100000) {
        prescriptionHistory = prescriptionHistory.slice(0, 100000);
    }
    setUserItem('prescriptionHistory', JSON.stringify(prescriptionHistory));
    dailyCounter++;
    setUserItem('dailyCounter', dailyCounter);
    setUserItem('counterDate', currentPrescriptionDate);
    const newPrescriptionNo = generatePrescriptionNo();
    document.getElementById('prescriptionNo').value = newPrescriptionNo;
    document.getElementById('paperClinicNo').textContent = newPrescriptionNo;
    renderHistoryList(prescriptionHistory.slice(0, 15));
    
    syncPrescriptionToCloud(record);
    
    setTimeout(async function() {
        if (currentUser && localStorage.getItem('jwtToken')) {
            await syncFromCloud();
        }
    }, 500);
    
    savePrescriptionAsImage(record, newPrescriptionNo);
    alert('处方保存成功！');
    searchPatientsQuick({target:{value:name}});
}
</script>