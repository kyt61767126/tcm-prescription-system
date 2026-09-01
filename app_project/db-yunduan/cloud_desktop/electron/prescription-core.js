// ============================================================================
// prescription-core.js — 处方业务逻辑共享模块
// 提取 8 个 index.html 中重复的处方工具函数
// 包含：价格格式化、HTML转义、处方排序、金额计算、处方校验、记录构建
// ============================================================================
// 设计原则：
//   1. 无状态工具函数：不依赖外部变量，纯函数易于测试
//   2. 向后兼容：保留原有函数签名，各端可渐进式迁移
//   3. 不含 DOM 操作：DOM 操作由各端自行处理（避免破坏现有交互）
// ============================================================================
(function (global) {
    'use strict';

    // ==================== 价格格式化 ====================

    // 格式化价格为2位小数（与 cloud/cloud_desktop formatPrice 一致）
    function formatPrice(val) {
        if (val === '' || val === null || val === undefined) return '';
        const num = parseFloat(val);
        if (isNaN(num)) return '';
        return num.toFixed(2);
    }

    // ==================== HTML 转义 ====================

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ==================== 处方排序 ====================

    // 处方按时间倒序排序（最新的在上），与 getAllUserPrescriptions 排序逻辑一致
    function sortPrescriptionsByTimeDesc(list) {
        if (!Array.isArray(list)) return list;
        return list.sort((a, b) => {
            const timeA = new Date(a.createdAt || a.date || a.id || 0).getTime();
            const timeB = new Date(b.createdAt || b.date || b.id || 0).getTime();
            return timeB - timeA;
        });
    }

    // 处方按编号倒序排序（与云端 API prescriptions.js 排序一致）
    function sortPrescriptionsByNoDesc(list) {
        if (!Array.isArray(list)) return list;
        return list.sort((a, b) => {
            const noA = a.outpatientNo || a.prescriptionNo || '';
            const noB = b.outpatientNo || b.prescriptionNo || '';
            return noB.localeCompare(noA);
        });
    }

    // ==================== 药品对象工具 ====================

    // 创建空药品对象（与各端 createEmptyMedicine 一致）
    function createEmptyMedicine() {
        return { code: '', name: '', dosage: '', unit: 'g', price: '', total: '', jianfa: '' };
    }

    // 计算单味药合计金额
    function calculateItemTotal(price, dosage) {
        const p = parseFloat(price) || 0;
        const d = parseFloat(dosage) || 0;
        return p * d;
    }

    // ==================== 处方金额计算 ====================

    // 计算处方药品总金额（所有药品合计之和）
    function calculateMedicineTotal(items) {
        if (!Array.isArray(items)) return 0;
        return items.reduce((sum, item) => {
            if (!item || !item.name) return sum;
            return sum + (parseFloat(item.total) || calculateItemTotal(item.price, item.dosage));
        }, 0);
    }

    // 计算处方总金额（药品总额 × 剂数 + 诊费）
    function calculatePrescriptionTotal(items, doseCount, registrationFee) {
        const medicineTotal = calculateMedicineTotal(items);
        const dose = parseInt(doseCount) || 1;
        const fee = parseFloat(registrationFee) || 0;
        return medicineTotal * dose + fee;
    }

    // 计算每剂金额
    function calculatePerDosePrice(items) {
        return calculateMedicineTotal(items);
    }

    // ==================== 处方校验 ====================

    // 校验处方必填字段
    // 返回 { valid: boolean, error: string }
    function validatePrescription(record) {
        if (!record) return { valid: false, error: '处方数据为空' };
        if (!record.patientName) return { valid: false, error: '请输入患者姓名' };
        if (!record.items || !Array.isArray(record.items) || record.items.length === 0) {
            return { valid: false, error: '请至少添加一味药品' };
        }
        const hasValidItem = record.items.some(item => item && item.name);
        if (!hasValidItem) return { valid: false, error: '请至少添加一味药品' };
        if (!record.doseCount || parseInt(record.doseCount) <= 0) {
            return { valid: false, error: '剂数必须大于0' };
        }
        return { valid: true };
    }

    // ==================== 处方记录构建 ====================

    // 构建标准化处方记录（字段统一）
    // formData: { id, date, patientName, patientGender, patientAge, patientPhone,
    //             patientAddress, doctorName, medicalHistory, diagnosis, items,
    //             doseCount, totalAmount, registrationFee, createdBy, createdAt }
    function buildPrescriptionRecord(formData) {
        const now = new Date().toISOString();
        const items = (formData.items || []).filter(item => item && item.name).map(item => ({
            code: item.code || '',
            name: item.name || '',
            dosage: item.dosage || '',
            unit: item.unit || 'g',
            price: parseFloat(item.price) || 0,
            jianfa: item.jianfa || '',
            total: parseFloat(item.total) || calculateItemTotal(item.price, item.dosage)
        }));

        const doseCount = parseInt(formData.doseCount) || 7;
        const registrationFee = parseFloat(formData.registrationFee) || 0;
        const medicineTotal = calculateMedicineTotal(items);
        const totalAmount = medicineTotal * doseCount + registrationFee;

        return {
            id: formData.id || Date.now(),
            date: formData.date || new Date().toISOString().split('T')[0],
            patientName: formData.patientName || '',
            patientGender: formData.patientGender || '',
            patientAge: formData.patientAge || '',
            patientPhone: formData.patientPhone || '',
            patientAddress: formData.patientAddress || '',
            doctorName: formData.doctorName || '',
            medicalHistory: formData.medicalHistory || '',
            diagnosis: formData.diagnosis || '',
            items: items,
            doseCount: doseCount,
            medicineTotal: medicineTotal,
            perDosePrice: medicineTotal,
            registrationFee: registrationFee,
            totalAmount: totalAmount,
            createdBy: formData.createdBy || 'unknown',
            createdAt: formData.createdAt || now,
            updatedAt: now
        };
    }

    // ==================== 药品使用频率统计 ====================

    // 加载药品使用频率（从 localStorage）
    function loadMedicineFrequency(storageKey) {
        const key = storageKey || 'local_medicineFrequency';
        try {
            const saved = global.localStorage ? global.localStorage.getItem(key) : null;
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    }

    // 保存药品使用频率（到 localStorage）
    function saveMedicineFrequency(frequency, storageKey) {
        const key = storageKey || 'local_medicineFrequency';
        try {
            if (global.localStorage) {
                global.localStorage.setItem(key, JSON.stringify(frequency));
            }
        } catch (e) {
            console.warn('[PrescriptionCore] 保存药品频率失败:', e);
        }
    }

    // 更新药品使用频率（传入 items 数组，返回更新后的频率对象）
    function updateMedicineFrequency(items, frequency, storageKey) {
        const freq = frequency || {};
        (items || []).forEach(item => {
            if (item && item.name) {
                freq[item.name] = (freq[item.name] || 0) + 1;
            }
        });
        if (storageKey !== false) saveMedicineFrequency(freq, storageKey);
        return freq;
    }

    // ==================== 处方编号生成 ====================

    // 生成离线版处方编号（YYMMDD + 2位序号）
    // date: Date 对象，seq: 序号
    function generateOfflinePrescriptionNo(date, seq) {
        const d = date || new Date();
        const yy = String(d.getFullYear()).slice(2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const seqStr = String(seq || 1).padStart(2, '0');
        return yy + mm + dd + seqStr;
    }

    // 生成统计编号（年2位 + 序号6位）
    function generateStatisticsNo(date, total) {
        const d = date || new Date();
        const yy = String(d.getFullYear()).slice(2);
        const count = parseInt(total) || 0;
        return yy + String(count + 1).padStart(6, '0');
    }

    // ==================== 处方摘要生成 ====================

    // 生成处方摘要文本（用于历史列表显示）
    function generatePrescriptionSummary(record) {
        if (!record) return '';
        const date = record.date || '';
        const name = record.patientName || '';
        const diagnosis = record.diagnosis || '';
        const fee = formatPrice(record.totalAmount);
        return date + ' - ' + name + ' | ' + diagnosis + (fee ? ' | 诊费:' + fee + '元' : '');
    }

    // ==================== 导出 ====================
    const PrescriptionCore = {
        formatPrice,
        escapeHtml,
        sortPrescriptionsByTimeDesc,
        sortPrescriptionsByNoDesc,
        createEmptyMedicine,
        calculateItemTotal,
        calculateMedicineTotal,
        calculatePrescriptionTotal,
        calculatePerDosePrice,
        validatePrescription,
        buildPrescriptionRecord,
        loadMedicineFrequency,
        saveMedicineFrequency,
        updateMedicineFrequency,
        generateOfflinePrescriptionNo,
        generateStatisticsNo,
        generatePrescriptionSummary
    };

    global.PrescriptionCore = PrescriptionCore;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
