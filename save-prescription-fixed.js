        async function savePrescription() {
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
                createdAt: Date.now(),
                updatedAt: Date.now()
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
            
            console.log('🔄 正在同步处方到云端...');
            const uploaded = await syncPrescriptionToCloud(record);
            
            if (uploaded) {
                console.log('✅ 处方已上传到云端');
                await syncFromCloud();
            } else {
                console.log('⚠️ 处方上传失败');
            }
            
            savePrescriptionAsImage(record, newPrescriptionNo);
            alert('处方保存成功！');
            searchPatientsQuick({target:{value:name}});
        }