#!/usr/bin/env node
// ============================================================================
//  act-reconcile-test.cjs — 授权对账端点回归（2026-10-17 S1-O3）
//
//  对象：functions/api/license/reconcile.js（认证/actions/repair/只读/脱敏/码探测面）
//  方法：源码替换 import → 临时 .mjs → 动态 import（与 activation-token-test 同模式），
//        schema-guard 用真源，license-core/entitlement/auth 按真实口径 mock。
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = __dirname;
let pass = 0, fail = 0;
function t(name, cond, extra) {
    if (cond) { pass++; console.log('  [PASS] ' + name); }
    else { fail++; console.error('  [FAIL] ' + name + (extra ? '  [' + extra + ']' : '')); }
}

function makeKv() {
    return {
        store: new Map(),
        puts: [],
        deletes: [],
        async get(key, type) {
            const v = this.store.get(key);
            if (v === undefined) return null;
            return type === 'json' ? JSON.parse(v) : v;
        },
        async put(key, value) { this.puts.push(key); this.store.set(key, value); },
        async delete(key) { this.deletes.push(key); this.store.delete(key); }
    };
}

const MOCK_CORE = `
export const getKV = () => global.__testKV;
export async function getLicense(kv, code) {
    const raw = kv.store.get('license:' + code);
    return raw ? JSON.parse(raw) : null;
}
export async function saveLicense(kv, record) {
    kv.puts.push('license:' + record.code);
    kv.store.set('license:' + record.code, JSON.stringify(record));
    return true;
}
export async function appendLicenseLog(kv, code, entry) {
    (global.__logs || (global.__logs = [])).push({ code: code, entry: entry });
    return true;
}
export function getDevices(record) {
    if (!record) return [];
    if (Array.isArray(record.devices) && record.devices.length) return record.devices;
    return record.machineId ? [{ machineId: record.machineId }] : [];
}
export function getMaxDevices(record) { return (record && record.maxDevices) || 1; }
export async function checkRateLimit() { return { allowed: true }; }
export async function checkCodeRateLimit() { return global.__codeRateDeny ? { allowed: false } : { allowed: true }; }
export async function findLicensesByMachine(kv, machineId, opts) {
    global.__repairCalls = global.__repairCalls || [];
    global.__repairCalls.push({ machineId: machineId, opts: opts || {} });
    return global.__repairHits || [];
}
export async function getDeviceBlock() { return global.__testBlock || null; }
export function versionOf(v) {
    const s = String(v || '').toLowerCase();
    return ['pro', 'institution', 'clinic', 'clinic_custom', 'cloud_clinic', 'offline_clinic', 'institutional'].includes(s) ? 'institution' : 'standard';
}
`;

const MOCK_ENT = `
export const ENTITLEMENT_STATES = Object.freeze({
    LICENSED: 'LICENSED', NO_LICENSE: 'NO_LICENSE', LICENSE_EXPIRED: 'LICENSE_EXPIRED', LICENSE_REVOKED: 'LICENSE_REVOKED'
});
export async function adjudicate(kv, machineId, code) {
    // 与真实口径同构：带 code 走码快路径（测试可注入 __testEnt）；code='' 走 mid 索引（__testEntMid）
    if (!code) return Object.assign({ success: true, state: 'NO_LICENSE', licenseCode: null }, global.__testEntMid || {});
    return Object.assign({ success: true, state: 'NO_LICENSE', licenseCode: code }, global.__testEnt || {});
}
`;

const MOCK_AUTH = `
export async function parseAuthHeader(request, env) {
    const h = request.headers.get('Authorization') || '';
    if (h === 'Bearer admin') return { username: 'admin_tester', role: 'platform_admin' };
    return null;
}
export function isPlatformAdmin(u) { return !!u && u.role === 'platform_admin'; }
`;

// 真源 schema-guard
fs.copyFileSync(path.join(ROOT, 'functions/api/license/_lib/schema-guard.js'),
    path.join(TMP, 'act-schema-guard.mjs'));

const src = fs.readFileSync(path.join(ROOT, 'functions/api/license/reconcile.js'), 'utf8');
// 注意替换顺序：先替换"独占一行"的 entitlement/auth（精确串），再替换多行 license-core，
// 最后换 schema-guard import —— 否则非贪婪多行正则会跨 import 语句吞掉 schema-guard。
const mocked = src
    .replace("import { adjudicate, ENTITLEMENT_STATES } from './entitlement.js';", MOCK_ENT)
    .replace("import { parseAuthHeader, isPlatformAdmin } from '../_lib/auth.js';", MOCK_AUTH)
    .replace(/import \{[\s\S]*?\} from '\.\/_lib\/license-core\.js';/, MOCK_CORE)
    .replace("from './_lib/schema-guard.js'", "from './act-schema-guard.mjs'");
fs.writeFileSync(path.join(TMP, 'act-reconcile.mock.mjs'), mocked);
const modUrl = 'file:///' + path.join(TMP, 'act-reconcile.mock.mjs').replace(/\\/g, '/');

const MID = 'a'.repeat(32);
const MID2 = 'b'.repeat(32);
const CODE = 'BNZC-AAAA-BBBB-CCCC-DDDD';
const OTHER = 'BNZC-EEEE-FFFF-GGGG-HHHH';

async function call(mod, kv, body, opts = {}) {
    global.__testKV = kv;
    global.__repairCalls = [];
    global.__logs = [];
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': opts.ip || '1.2.3.4' };
    if (opts.auth) headers.Authorization = 'Bearer admin';
    let request;
    if ((opts.method || 'POST') === 'POST') {
        request = new Request('https://tcm-prescription-system.pages.dev/api/license/reconcile', {
            method: 'POST', headers,
            body: opts.rawBody !== undefined ? opts.rawBody : JSON.stringify(body)
        });
    } else {
        request = new Request('https://tcm-prescription-system.pages.dev/api/license/reconcile', { method: opts.method, headers });
    }
    const res = await mod.onRequest({ request, env: {} });
    let json = null;
    try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
}

function seed(kv) {
    kv.store.set('license:' + CODE, JSON.stringify({
        code: CODE, status: 'used', type: 'pro', maxDevices: 5,
        clinicName: '本能堂', phone: '13800138000', user: '张三',
        devices: [{ machineId: MID, productClass: 'offline', clientClass: 'app' }]
    }));
    kv.store.set('license:' + OTHER, JSON.stringify({
        code: OTHER, status: 'unused', type: 'personal', maxDevices: 2, devices: []
    }));
}

function resetGlobals() {
    global.__testEnt = null;
    global.__testEntMid = null;
    global.__repairHits = [];
    global.__codeRateDeny = false;
    global.__testBlock = null;
}

(async () => {
    const mod = await import(modUrl);
    try { fs.unlinkSync(path.join(TMP, 'act-schema-guard.mjs')); } catch (e) {}
    try { fs.unlinkSync(path.join(TMP, 'act-reconcile.mock.mjs')); } catch (e) {}

    console.log('=== 方法/入参 ===');
    {
        const kv = makeKv(); resetGlobals();
        const r = await call(mod, kv, {}, { method: 'OPTIONS' });
        t('OPTIONS → 204', r.status === 204, r.status);
    }
    {
        const kv = makeKv(); resetGlobals();
        const r = await call(mod, kv, {}, { method: 'GET' });
        t('GET → 405 且带 traceId', r.status === 405 && !!r.json.traceId, r.status);
    }
    {
        const kv = makeKv(); resetGlobals();
        const r = await call(mod, kv, { machineId: 'unknown' });
        t('非法 machineId → 400', r.status === 400 && r.json.success === false, r.status);
    }
    {
        const kv = makeKv(); resetGlobals();
        const r = await call(mod, kv, { machineId: MID, code: 'bad/../code' });
        t('非法激活码格式 → 400', r.status === 400, r.status);
    }
    {
        const kv = makeKv(); resetGlobals();
        const r = await call(mod, kv, null, { rawBody: 'null' });
        t('body=null → 400（不 500）', r.status === 400, r.status);
    }
    {
        const kv = makeKv(); resetGlobals(); global.__codeRateDeny = true;
        const r = await call(mod, kv, { machineId: MID, code: CODE });
        t('匿名码级频控超限 → 429', r.status === 429, r.status);
    }

    console.log('=== actions 判定 ===');
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSED', licenseCode: CODE, edition: 'institution' };
        const r = await call(mod, kv, { machineId: MID, code: OTHER, client: { licenseStatus: 'valid', code: OTHER } });
        t('LICENSED + 本地码错位 → CLEAR_STALE_CODE', r.status === 200 &&
            r.json.state === 'LICENSED' && r.json.actions.includes('CLEAR_STALE_CODE') &&
            !r.json.actions.includes('REINSTALL_LICENSE'), JSON.stringify(r.json.actions));
        t('LICENSED 权威码摘要且脱敏（无 phone/user/licenseBase64）',
            r.json.license && r.json.license.code === CODE &&
            !('phone' in r.json.license) && !('user' in r.json.license) && !('licenseBase64' in r.json.license),
            JSON.stringify(r.json.license));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSED', licenseCode: CODE };
        const r = await call(mod, kv, { machineId: MID, code: CODE, client: { licenseStatus: 'missing', code: '' } });
        t('LICENSED + 本地文件缺失 → REINSTALL_LICENSE', r.json.actions.includes('REINSTALL_LICENSE'), JSON.stringify(r.json.actions));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSED', licenseCode: CODE };
        const r = await call(mod, kv, { machineId: MID, code: CODE, client: { licenseStatus: 'valid', code: CODE } });
        t('LICENSED + 一致 → NO_ACTION', r.json.actions.length === 1 && r.json.actions[0] === 'NO_ACTION', JSON.stringify(r.json.actions));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSED', licenseCode: CODE };
        const r = await call(mod, kv, { machineId: MID, code: CODE });
        t('LICENSED + 未上报 client → NO_ACTION', r.json.actions.length === 1 && r.json.actions[0] === 'NO_ACTION', JSON.stringify(r.json.actions));
    }
    {
        // ★ 安全审查：匿名 + 未绑定码 → 只回 codeExists，不回任何记录摘要（防码探测 oracle）
        const kv = makeKv(); seed(kv); resetGlobals();
        const r = await call(mod, kv, { machineId: MID2, code: CODE });
        t('匿名 + 他机码 → codeExists=true 但 codeRecord/license 均为 null',
            r.status === 200 && r.json.codeExists === true && r.json.codeRecord === null && r.json.license === null,
            JSON.stringify({ codeExists: r.json.codeExists, codeRecord: r.json.codeRecord, license: r.json.license }));
        t('匿名 + 他机码 → 无 clinicName/到期等信息泄露',
            JSON.stringify(r.json).indexOf('本能堂') === -1, JSON.stringify(r.json).slice(0, 160));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'NO_LICENSE', licenseCode: null };
        const r = await call(mod, kv, { machineId: MID, code: OTHER }, { auth: true });
        t('管理员 + 码未激活 → codeRecord 可见 + COMPLETE_ACTIVATION',
            r.json.codeRecord && r.json.codeRecord.status === 'unused' && r.json.actions.includes('COMPLETE_ACTIVATION'),
            JSON.stringify({ a: r.json.actions, c: r.json.codeRecord }));
    }
    {
        // ★ 代码审查修正：带码 NO_LICENSE 时用 mid 二次裁决，打通 CLEAR_STALE_CODE
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'NO_LICENSE', licenseCode: null };
        global.__testEntMid = { state: 'LICENSED', licenseCode: CODE, edition: 'institution' };
        const r = await call(mod, kv, { machineId: MID, code: OTHER, client: { licenseStatus: 'valid', code: OTHER } });
        t('码错位（mid 有绑定）→ 二次裁决 LICENSED + CLEAR_STALE_CODE',
            r.json.state === 'LICENSED' && r.json.license && r.json.license.code === CODE &&
            r.json.actions.includes('CLEAR_STALE_CODE'), JSON.stringify({ s: r.json.state, a: r.json.actions }));
    }
    {
        // ★ P40 分裂：本地 license 有效 + 服务端 mid/码均无授权 → 只诊断，不自动修复
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'NO_LICENSE', licenseCode: null };
        global.__testEntMid = { state: 'NO_LICENSE', licenseCode: null };
        const r = await call(mod, kv, { machineId: MID, code: '', client: { licenseStatus: 'valid', code: '' } });
        t('P40 型分裂 → SERVER_RECORD_MISMATCH（不返回可自动修复 action）',
            r.json.actions.length === 1 && r.json.actions[0] === 'SERVER_RECORD_MISMATCH', JSON.stringify(r.json.actions));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'NO_LICENSE', licenseCode: null };
        global.__testEntMid = { state: 'NO_LICENSE', licenseCode: null };
        const r = await call(mod, kv, { machineId: MID });
        t('NO_LICENSE + 无码 → REACTIVATE', r.json.actions.includes('REACTIVATE'), JSON.stringify(r.json.actions));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSE_EXPIRED', licenseCode: CODE };
        const r = await call(mod, kv, { machineId: MID, code: CODE });
        t('EXPIRED → RENEW', r.json.actions.includes('RENEW'), JSON.stringify(r.json.actions));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSE_REVOKED', licenseCode: CODE };
        const r = await call(mod, kv, { machineId: MID, code: CODE });
        t('REVOKED → CONTACT_SUPPORT', r.json.actions.includes('CONTACT_SUPPORT'), JSON.stringify(r.json.actions));
    }

    console.log('=== 只读 / repair 边界 ===');
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSED', licenseCode: CODE };
        const r = await call(mod, kv, { machineId: MID, code: CODE });
        t('默认不写授权业务键', kv.puts.length === 0 && kv.deletes.length === 0, 'puts=' + kv.puts.length);
        t('默认不重建索引', global.__repairCalls.length === 0);
        t('traceId 存在', typeof r.json.traceId === 'string' && r.json.traceId.startsWith('rec-'), r.json.traceId);
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSED', licenseCode: CODE };
        const r = await call(mod, kv, { machineId: MID, repair: true });
        t('repair 无鉴权 → repairDenied(admin_required) 且零写', r.json.repairDenied === true &&
            r.json.repairReason === 'admin_required' && global.__repairCalls.length === 0 && kv.puts.length === 0,
            JSON.stringify(r.json));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSED', licenseCode: CODE };
        const r = await call(mod, kv, { machineId: MID, code: CODE, repair: true }, { auth: true });
        t('repair LICENSED 无命中 → repairFailed(no_bound_record)，不写空索引', r.json.repairFailed === true &&
            r.json.repairReason === 'no_bound_record' && kv.puts.length === 0, JSON.stringify(r.json));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSED', licenseCode: CODE };
        global.__repairHits = [{ code: CODE }];
        const r = await call(mod, kv, { machineId: MID, code: CODE, repair: true }, { auth: true });
        t('repair LICENSED 有命中 → mid_index_refresh + 审计日志', r.json.repaired.includes('mid_index_refresh') &&
            global.__repairCalls.length === 1 && global.__repairCalls[0].opts.forceScan === true &&
            global.__logs.some(x => x.entry.action === 'reconcile-index-refresh'), JSON.stringify(r.json));
        t('repair 索引刷新不改授权记录', !kv.puts.some(k => String(k).indexOf('license:') === 0), JSON.stringify(kv.puts));
    }
    {
        // P40 受控修复：码 unused + redeemedDevices 台账含本机 → 补绑（有审计）
        const kv = makeKv(); seed(kv); resetGlobals();
        kv.store.set('license:' + OTHER, JSON.stringify({
            code: OTHER, status: 'unused', type: 'personal', maxDevices: 2, devices: [],
            clinicName: '本能堂', redeemedDevices: [MID]
        }));
        global.__testEnt = { state: 'NO_LICENSE', licenseCode: null };
        global.__testEntMid = { state: 'NO_LICENSE', licenseCode: null };
        const r = await call(mod, kv, { machineId: MID, code: OTHER, repair: true, clientClass: 'app' }, { auth: true });
        const rec = JSON.parse(kv.store.get('license:' + OTHER));
        t('repair 凭 redeemedDevices 台账补绑成功（有审计）', r.json.repaired.includes('rebind_by_redeem_ledger') &&
            rec.status === 'used' && rec.devices.some(d => d.machineId === MID) &&
            global.__logs.some(x => x.entry.action === 'reconcile-rebind'),
            JSON.stringify({ repaired: r.json.repaired, status: rec.status, logs: global.__logs.map(x => x.entry.action) }));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'NO_LICENSE', licenseCode: null };
        global.__testEntMid = { state: 'NO_LICENSE', licenseCode: null };
        const r = await call(mod, kv, { machineId: MID, code: OTHER, repair: true }, { auth: true });
        t('repair 无台账证据 → repairFailed(no_redeem_evidence) 且不写授权', r.json.repairFailed === true &&
            r.json.repairReason === 'no_redeem_evidence' && !kv.puts.some(k => String(k).indexOf('license:') === 0),
            JSON.stringify(r.json));
    }
    {
        const kv = makeKv(); seed(kv); resetGlobals();
        global.__testEnt = { state: 'LICENSED', licenseCode: CODE };
        global.__testBlock = { reason: 'tamper' };
        const r = await call(mod, kv, { machineId: MID });
        t('已封锁设备 → 403', r.status === 403, r.status);
    }

    console.log('==============================');
    console.log('授权对账端点测试：' + pass + ' PASS / ' + fail + ' FAIL');
    if (fail > 0) process.exit(1);
})().catch(e => { console.error('[FATAL]', e); process.exit(2); });

