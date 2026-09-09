#!/usr/bin/env node
// ============================================================================
//  device-reset.cjs — 测试设备后台记录一键清理（开发者自用）
//
//  用途：把已激活/已试用过的测试设备恢复到「新客户」后台状态（配客户端本地
//        清理：桌面跑 测试重置.bat，手机卸载重装）。
//
//  用法：
//    node tools/device-reset.cjs <machineId|手机号|hwFp>            ← 演练（只列清单，不删）
//    node tools/device-reset.cjs <machineId|手机号|hwFp> --confirm  ← 执行删除
//
//  ⚠️ 仅限测试设备！脚本会显示每条记录的诊所名/手机号/状态，
//     确认清单里没有真实客户（有 orderNo/paidAt 的多为付费客户）再 --confirm。
//
//  扫描范围（与 .trae/KNOWLEDGE.md 清理 Runbook 一致）：
//    trial_fp:{hwFp}          试用指纹（value.machineId 辅助字段关联）
//    admin_req:{id}           激活申请（license 唯一恢复源，删前三思）
//    license:{code}           license 记录 + license_log:{code}
//    device_version:{machineId}
//    admin_phone:{手机号}
//    clinic:{clinicId}:users  诊所云端账号（按 clinicName 关联 system:clinics）
//    三个索引：admin_req_index / system:license_index / system:clinics
//
//  字段结构（2026-09-09 实测确认）：
//    admin_req:  phone, machineId, clinicName, licenseCode, status, orderNo
//    license:    phone, machineId, clinicName, code, status
//    trial_fp:   hwFp(key 后缀), machineId
//    clinics表:  id, name（无 phone，靠 clinicName 桥接）
// ============================================================================

const { execSync } = require('child_process');
const path = require('path');

const NS = 'b1ab3e4b683341958cef369fcbf94933';
const ROOT = path.resolve(__dirname, '..');

// ---------- wrangler 封装 ----------
function wrangler(args) {
    const out = execSync(`npx wrangler ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim();
}

function kvGet(key) {
    try {
        const out = wrangler(`kv key get --namespace-id=${NS} "${key}" --remote`);
        return JSON.parse(out);
    } catch (e) {
        return null; // 键不存在或非 JSON
    }
}

function kvList(prefix) {
    const out = wrangler(`kv key list --namespace-id=${NS} --prefix "${prefix}" --remote`);
    const arr = JSON.parse(out);
    return arr.map(k => k.name);
}

function kvDelete(key) {
    wrangler(`kv key delete --namespace-id=${NS} "${key}" --remote --force`);
}

function kvPut(key, value) {
    const tmp = path.join(__dirname, '_tmp_device_reset.json');
    require('fs').writeFileSync(tmp, typeof value === 'string' ? value : JSON.stringify(value));
    wrangler(`kv key put --namespace-id=${NS} "${key}" --path "${tmp}" --remote`);
    require('fs').unlinkSync(tmp);
}

// ---------- 主流程 ----------
const input = process.argv[2];
const confirm = process.argv.includes('--confirm');

if (!input || input.startsWith('--')) {
    console.log('用法: node tools/device-reset.cjs <machineId|手机号|hwFp> [--confirm]');
    console.log('  不带 --confirm = 演练模式（只列清单不删除）');
    process.exit(1);
}

const inputKind = /^1[3-9]\d{9}$/.test(input) ? '手机号'
    : /^[a-f0-9]{64}$/i.test(input) ? 'hwFp（试用指纹）'
    : 'machineId';

console.log('============================================================');
console.log('  测试设备后台记录清理（' + (confirm ? '★执行模式' : '演练模式（未加 --confirm，只列不删）') + '）');
console.log('  输入: ' + input + '  （识别为 ' + inputKind + '）');
console.log('============================================================\n');

const toDelete = [];   // { key, desc, warn }
const clinicsToRemove = new Map(); // clinicId -> clinicName

// 1. 试用指纹
console.log('[1/6] 扫描试用指纹 trial_fp:* ...');
for (const key of kvList('trial_fp:')) {
    const v = kvGet(key);
    if (!v) continue;
    if (v.machineId === input || key === 'trial_fp:' + input) {
        toDelete.push({
            key,
            desc: `试用指纹（${v.trialCount} 次，首试 ${v.firstTrialAt || '?'}，${v.appMode || '?'} 平台）`,
            warn: false
        });
    }
}

// 2. 激活申请
console.log('[2/6] 扫描激活申请 admin_req:* ...');
let reqIndex = kvGet('admin_req_index') || [];
const newReqIndex = [];
for (const id of reqIndex) {
    const key = 'admin_req:' + id;
    const v = kvGet(key);
    if (!v) { newReqIndex.push(id); continue; } // 脏索引保持原样，不借机清理（保守）
    if (v.phone === input || v.machineId === input) {
        toDelete.push({
            key,
            desc: `激活申请 ${v.status || '?'}｜${v.clinicName || '?'}｜${v.phone || '?'}｜${v.licenseCode || '无码'}`,
            warn: !!v.orderNo || v.status === 'activated'
        });
        if (v.clinicName) clinicsToRemove.set(v.clinicName, null);
    } else {
        newReqIndex.push(id);
    }
}

// 3. License 记录
console.log('[3/6] 扫描 license:* ...');
let licIndex = kvGet('system:license_index') || [];
const newLicIndex = [];
for (const code of licIndex) {
    const key = 'license:' + code;
    const v = kvGet(key);
    if (!v) { newLicIndex.push(code); continue; }
    if (v.phone === input || v.machineId === input) {
        toDelete.push({ key, desc: `license ${v.status || '?'}｜${v.clinicName || v.user || '?'}｜${v.phone || '?'}`, warn: v.status === 'used' });
        toDelete.push({ key: 'license_log:' + code, desc: '对应 license 日志', warn: false });
        if (v.clinicName) clinicsToRemove.set(v.clinicName, null);
    } else {
        newLicIndex.push(code);
    }
}

// 4. 设备版本键 + 手机号索引（直探测）
console.log('[4/6] 直探测 device_version / admin_phone ...');
const dvKey = 'device_version:' + input;
if (kvGet(dvKey)) toDelete.push({ key: dvKey, desc: '设备版本绑定', warn: false });
const apKey = 'admin_phone:' + input;
if (kvGet(apKey)) toDelete.push({ key: apKey, desc: '手机号登录索引', warn: false });

// 5. 诊所账号（按 clinicName 桥接 system:clinics）
console.log('[5/6] 关联诊所账号 system:clinics ...');
let clinics = kvGet('system:clinics') || [];
const newClinics = [];
const resolvedClinics = new Map();
for (const c of clinics) {
    if (clinicsToRemove.has(c.name)) {
        resolvedClinics.set(c.id, c.name);
        const uk = 'clinic:' + c.id + ':users';
        if (kvGet(uk)) toDelete.push({ key: uk, desc: `诊所云端账号（${c.name}）`, warn: c.status === 'active' });
    } else {
        newClinics.push(c);
    }
}

// 6. 汇总清单
console.log('[6/6] 汇总清单：\n');
if (toDelete.length === 0) {
    console.log('  未找到任何关联记录——该输入可能已是干净状态，或 ID 有误。');
    console.log('\n提示：trial_fp 的键是 64 位 hwFp（不是 32 位 machineId）；');
    console.log('      两者可从设备「关于/激活窗口」或历史申请记录中获取。');
    process.exit(0);
}

for (const item of toDelete) {
    console.log('  ' + (item.warn ? '⚠️ ' : '  ') + item.key);
    console.log('      ' + item.desc + (item.warn ? '  ← 疑似真实客户/已付款，删前务必确认！' : ''));
}
console.log('\n  索引更新（随删除同步）：');
if (newReqIndex.length !== reqIndex.length) console.log('  - admin_req_index: ' + reqIndex.length + ' → ' + newReqIndex.length + ' 条');
if (newLicIndex.length !== licIndex.length) console.log('  - system:license_index: ' + licIndex.length + ' → ' + newLicIndex.length + ' 条');
if (newClinics.length !== clinics.length) console.log('  - system:clinics: ' + clinics.length + ' → ' + newClinics.length + ' 家（' + [...resolvedClinics.values()].join('、') + '）');

if (!confirm) {
    console.log('\n============================================================');
    console.log('  演练结束，未删除任何数据。');
    console.log('  确认无误后执行: node tools/device-reset.cjs ' + input + ' --confirm');
    console.log('\n  ★ 后台清理完成后，客户端还需本地清理才能当新设备：');
    console.log('    桌面：运行 测试重置.bat（仓库根目录）；手机：卸载重装 APP');
    console.log('============================================================');
    process.exit(0);
}

// ---------- 执行删除 ----------
console.log('\n开始删除...');
for (const item of toDelete) {
    kvDelete(item.key);
    console.log('  ✓ 已删 ' + item.key);
}
if (newReqIndex.length !== reqIndex.length) { kvPut('admin_req_index', newReqIndex); console.log('  ✓ 已更新 admin_req_index'); }
if (newLicIndex.length !== licIndex.length) { kvPut('system:license_index', newLicIndex); console.log('  ✓ 已更新 system:license_index'); }
if (newClinics.length !== clinics.length) { kvPut('system:clinics', newClinics); console.log('  ✓ 已更新 system:clinics'); }

// 复验
console.log('\n复验（已删键应全部查无）：');
let fail = 0;
for (const item of toDelete) {
    if (kvGet(item.key) !== null) { console.log('  ✗ 仍存在: ' + item.key); fail++; }
}
console.log(fail === 0 ? '  ✓ 全部清除成功' : '  ✗ ' + fail + ' 个键未删净，请重跑检查');

console.log('\n============================================================');
console.log('  ✅ 后台清理完成。');
console.log('  最后一步——客户端本地清理（缺这步设备仍显示旧状态）：');
console.log('    桌面：运行 测试重置.bat ｜ 手机：卸载重装 APP');
console.log('  之后联网首启 = 全新客户（新试用 7 天）体验。');
console.log('============================================================');
process.exit(fail === 0 ? 0 : 1);
