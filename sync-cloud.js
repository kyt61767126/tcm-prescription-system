// 云端同步脚本
const SYNC_PASSWORD = "HuikangTang2026!";
const USERNAME = "admin";

async function initSync() {
  try {
    const res = await fetch("/api/sync", {
      headers: {
        "x-sync-password": SYNC_PASSWORD,
        "x-username": USERNAME
      }
    });

    if (res.ok) {
      const cloudData = await res.json();
      if (Array.isArray(cloudData) && cloudData.length > 0) {
        const map = new Map();
        window.prescriptionHistory.forEach(p => map.set(p.id || p._id, p));
        cloudData.forEach(p => {
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
        console.log("✅ 已从云端同步处方");
      }
    } else {
      console.log("云端同步失败，状态码：" + res.status);
    }
  } catch (e) {
    console.log("云端同步出错：" + e.message);
  }
}

async function syncToCloud() {
  try {
    const jsonData = JSON.stringify(window.prescriptionHistory);

    const res = await fetch("/api/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-password": SYNC_PASSWORD,
        "x-username": USERNAME
      },
      body: jsonData
    });

    if (res.ok) {
      console.log("✅ 处方已同步云端");
      return true;
    } else {
      console.log("云端同步失败：" + res.status);
      return false;
    }
  } catch (e) {
    console.log("云端同步出错：" + e.message);
    return false;
  }
}

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
  
  await syncToCloud();
  
  window.savePrescriptionAsImage(record, newPrescriptionNo);
  alert('处方保存成功！');
  window.searchPatientsQuick({target:{value:name}});
};

window.addEventListener("load", initSync);