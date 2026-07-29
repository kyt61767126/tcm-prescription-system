// ============================================================================
//  prescription-counter.js — 处方数量计数器（v2 版本管理）
//  功能：按月统计处方数量，试用版限制 30 张/月，超过则拒绝保存
//  存储：userData/prescription-count.json（XOR 混淆，防直接查看）
//  调用：渲染进程通过 IPC 调用 canPrescribe()/increment()/getStatus()
// ============================================================================

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const licenseManager = require('./license-manager');

const COUNT_KEY = 'bnzc_prescription_count_v1';
const COUNT_FILE = 'prescription-count.dat';

// ============================================================================
//  XOR 混淆（与 license-manager.js 一致，防止用户直接查看计数文件）
// ============================================================================
function xorEncrypt(text, key) {
    const buf = Buffer.from(text, 'utf8');
    const keyBuf = Buffer.from(key, 'utf8');
    const result = Buffer.alloc(buf.length);
    for (let i = 0; i < buf.length; i++) {
        result[i] = buf[i] ^ keyBuf[i % keyBuf.length];
    }
    return result.toString('base64');
}

function xorDecrypt(base64, key) {
    try {
        const buf = Buffer.from(base64, 'base64');
        const keyBuf = Buffer.from(key, 'utf8');
        const result = Buffer.alloc(buf.length);
        for (let i = 0; i < buf.length; i++) {
            result[i] = buf[i] ^ keyBuf[i % keyBuf.length];
        }
        return result.toString('utf8');
    } catch (e) {
        return null;
    }
}

// ============================================================================
//  路径与文件读写
// ============================================================================
function getCountPath() {
    return path.join(app.getPath('userData'), COUNT_FILE);
}

function readCounts() {
    try {
        const countPath = getCountPath();
        if (!fs.existsSync(countPath)) return {};
        const content = fs.readFileSync(countPath, 'utf8').trim();
        const json = xorDecrypt(content, COUNT_KEY);
        if (!json) return {};
        const data = JSON.parse(json);
        return (data && typeof data === 'object') ? data : {};
    } catch (e) {
        console.error('[PrescriptionCounter] 读取计数失败:', e.message);
        return {};
    }
}

function writeCounts(counts) {
    try {
        const countPath = getCountPath();
        const json = JSON.stringify(counts);
        const encrypted = xorEncrypt(json, COUNT_KEY);
        fs.writeFileSync(countPath, encrypted, 'utf8');
    } catch (e) {
        console.error('[PrescriptionCounter] 写入计数失败:', e.message);
    }
}

// ============================================================================
//  月份工具
// ============================================================================
function getCurrentMonthKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return year + '-' + month;  // 例：2026-07
}

// ============================================================================
//  核心逻辑
// ============================================================================

// 获取当前月份的处方数量
function getCount(monthKey) {
    const key = monthKey || getCurrentMonthKey();
    const counts = readCounts();
    return counts[key] || 0;
}

// 获取当前 license 的处方限制（0 = 无限）
function getMaxPrescriptions() {
    const license = licenseManager.readLicense();
    if (!license) {
        // 无 license，试用模式
        return licenseManager.LICENSE_TYPE_CONFIG.trial.maxPrescriptions;
    }
    const normalized = licenseManager.normalizeLicense(license);
    return normalized.maxPrescriptions;
}

// 检查是否可以开处方（试用版超限则拒绝）
// 返回 { allowed: boolean, current: number, max: number, remaining: number }
function canPrescribe() {
    const current = getCount();
    const max = getMaxPrescriptions();
    if (max === 0) {
        // 0 = 无限
        return { allowed: true, current: current, max: 0, remaining: -1 };
    }
    const remaining = Math.max(0, max - current);
    return {
        allowed: current < max,
        current: current,
        max: max,
        remaining: remaining
    };
}

// 处方保存成功后自增计数
function increment() {
    const key = getCurrentMonthKey();
    const counts = readCounts();
    counts[key] = (counts[key] || 0) + 1;
    writeCounts(counts);
    return counts[key];
}

// 处方删除后自减计数（不跨月递减，仅当本月删除时才减）
function decrement() {
    const key = getCurrentMonthKey();
    const counts = readCounts();
    if (counts[key] && counts[key] > 0) {
        counts[key]--;
        writeCounts(counts);
    }
    return counts[key] || 0;
}

// 获取完整状态（供 UI 显示）
function getStatus() {
    const current = getCount();
    const max = getMaxPrescriptions();
    const licenseType = licenseManager.getLicenseType();
    return {
        current: current,
        max: max,
        remaining: max === 0 ? -1 : Math.max(0, max - current),
        licenseType: licenseType,
        month: getCurrentMonthKey()
    };
}

module.exports = {
    canPrescribe,
    increment,
    decrement,
    getCount,
    getMaxPrescriptions,
    getStatus,
    getCurrentMonthKey
};
