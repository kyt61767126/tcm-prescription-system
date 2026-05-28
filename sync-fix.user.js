// ==UserScript==
// @name         中医处方系统云端同步修复
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  修复云端同步问题
// @author       You
// @match        https://599cb7b0.tcm-prescription-system.pages.dev/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    window.addEventListener('load', function() {
        console.log('🔧 同步修复脚本已加载');
        
        const originalSavePrescription = window.savePrescription;
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
            
            syncPrescriptionToCloudFixed(record);
            
            window.savePrescriptionAsImage(record, newPrescriptionNo);
            alert('处方保存成功！');
            window.searchPatientsQuick({target:{value:name}});
        };
        
        async function syncPrescriptionToCloudFixed(record) {
            try {
                const token = localStorage.getItem('jwtToken');
                if (!token) {
                    console.log('⚠️ 没有登录令牌');
                    return false;
                }
                
                console.log('🔄 正在同步处方到云端...');
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
        
        window.syncFromCloudFixed = async function() {
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
                        const merged = mergePrescriptionsFixed(window.prescriptionHistory, data.prescriptions);
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
        
        function mergePrescriptionsFixed(localData, cloudData) {
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
        
        setTimeout(() => {
            if (window.currentUser && localStorage.getItem('jwtToken')) {
                window.syncFromCloudFixed();
            }
        }, 1000);
    });
})();