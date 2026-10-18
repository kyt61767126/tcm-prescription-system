#!/usr/bin/env node
// ============================================================================
//  act-session-test.cjs — 激活会话端点回归（2026-10-17 S1b-②）
//  对象：functions/api/license/activation-session.js（start/complete/status 幂等与核销时点）
//  方法：源码替换 import → 临时 .mjs → 动态 import；token/claim 按真实契约 mock。
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
const MID = 'a'.repeat(32);
const MID2 = 'b'.repeat(32);
const CODE = 'BNZC-AAAA-BBBB-CCCC-DDDD';

function makeKv() {
    return {
        store: new Map(),
        async get(k, type) { const v = this.store.get(k); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; },
        async put(k, v) { this.store.set(k, v); },
        async delete(k) { this.store.delete(k); }
    };
}

const MOCK_CORE = `
export const getKV = () => global.__KV;
export async function checkRateLimit() { return { allowed: global.__rateDeny ? false : true }; }
`;
const MOCK_TOKEN = `
async function tokenMockOnRequest(context) {
    const body = await context.request.json().catch(() => ({}));
    (global.__tokenCalls = global.__tokenCalls || []).push(body);
    const r = (global.__tokenResp && global.__tokenResp[body.action]) || {
        status: 200, json: { success: true, code: '${CODE}', clinic: '本能堂', user: '张三', productLock: null }
    };
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } });
}
const tokenOnRequest = tokenMockOnRequest;
export { tokenOnRequest };
`;
const MOCK_CLAIM = `
async function claimMockOnRequest(context) {
    const body = await context.request.json().catch(() => ({}));
    (global.__claimCalls = global.__claimCalls || []).push(body);
    const r = global.__claimResp || {
        status: 200,
        json: { success: true, code: '${CODE}', license: 'LIC_B64', licenseInfo: { type: 'pro', clinicName: '本能堂' }, message: '激活成功' }
    };
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'Content-Type': 'application/json' } });
}
const claimOnRequest = claimMockOnRequest;
export { claimOnRequest };
`;
fs.copyFileSync(path.join(ROOT, 'functions/api/license/_lib/schema-guard.js'), path.join(TMP, 'act-schema-guard2.mjs'));
const src = fs.readFileSync(path.join(ROOT, 'functions/api/license/activation-session.js'), 'utf8');
const mocked = src
    .replace(/import \{[\s\S]*?\} from '\.\/_lib\/license-core\.js';/, MOCK_CORE)
    .replace("from './_lib/schema-guard.js'", "from './act-schema-guard2.mjs'")
    .replace("import { onRequest as tokenOnRequest } from './activation-token.js';", MOCK_TOKEN)
    .replace("import { onRequest as claimOnRequest } from './claim.js';", MOCK_CLAIM);
fs.writeFileSync(path.join(TMP, 'act-session.mock.mjs'), mocked);
const modUrl = 'file:///' + path.join(TMP, 'act-session.mock.mjs').replace(/\\/g, '/');

async function call(mod, kv, body, opts = {}) {
    global.__KV = kv;
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' };
    let request;
    if ((opts.method || 'POST') === 'POST') {
        request = new Request('https://tcm-prescription-system.pages.dev/api/license/activation-session', {
            method: 'POST', headers, body: JSON.stringify(body)
        });
    } else {
        request = new Request('https://tcm-prescription-system.pages.dev/api/license/activation-session', { method: opts.method, headers });
    }
    const res = await mod.onRequest({ request, env: {} });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json: json };
}
function reset() { global.__tokenCalls = []; global.__claimCalls = []; global.__tokenResp = null; global.__claimResp = null; global.__rateDeny = false; }
async function startSession(mod, kv) {
    return await call(mod, kv, { action: 'start', token: 'x'.repeat(43), machineId: MID, productClass: 'offline', clientClass: 'app', identity: { user: '张三', clinicName: '本能堂', phone: '13800138000' } });
}

(async () => {
    const mod = await import(modUrl);
    try { fs.unlinkSync(path.join(TMP, 'act-schema-guard2.mjs')); } catch (e) {}
    try { fs.unlinkSync(path.join(TMP, 'act-session.mock.mjs')); } catch (e) {}

    console.log('=== 方法/参数 ===');
    { const kv = makeKv(); reset(); const r = await call(mod, kv, {}, { method: 'OPTIONS' }); t('OPTIONS → 204', r.status === 204, r.status); }
    { const kv = makeKv(); reset(); const r = await call(mod, kv, {}, { method: 'GET' }); t('GET → 405', r.status === 405, r.status); }
    { const kv = makeKv(); reset(); const r = await call(mod, kv, { action: 'hack' }); t('未知 action → 400', r.status === 400, r.status); }
    { const kv = makeKv(); reset(); global.__rateDeny = true; const r = await call(mod, kv, { action: 'start', token: 'x'.repeat(43), machineId: MID, productClass: 'offline' }); t('频控 → 429', r.status === 429, r.status); }

    console.log('=== start ===');
    {
        const kv = makeKv(); reset();
        const r = await startSession(mod, kv);
        t('start 成功返回 sid（不泄露裸码）', r.status === 200 && r.json.success && /^[a-f0-9]{32}$/.test(r.json.sid) && r.json.code === undefined, JSON.stringify(r.json).slice(0, 120));
        t('start 调 token redeem 且 deferConsume=true', global.__tokenCalls.length === 1 && global.__tokenCalls[0].action === 'redeem' && global.__tokenCalls[0].deferConsume === true);
        const sess = JSON.parse(kv.store.get('act_session:' + r.json.sid));
        t('会话落库 status=code_issued 且含 code/machine', sess.status === 'code_issued' && sess.code === CODE && sess.machineId === MID && sess.expiresAt > Date.now());
    }
    {
        const kv = makeKv(); reset();
        global.__tokenResp = { redeem: { status: 409, json: { success: false, error: '该链接已在其他设备打开', reason: 'linked_other' } } };
        const r = await startSession(mod, kv);
        t('start token 失败透传（不建会话）', r.status === 409 && r.json.success === false && kv.store.size === 0);
    }

    console.log('=== complete ===');
    {
        const kv = makeKv(); reset();
        const s = await startSession(mod, kv);
        const r = await call(mod, kv, { action: 'complete', sid: s.json.sid, machineId: MID });
        t('complete claim 成功 → receipt + 已核销令牌', r.status === 200 && r.json.success && r.json.receipt && r.json.receipt.license === 'LIC_B64' && global.__tokenCalls.some(x => x.action === 'consume'), JSON.stringify(r.json).slice(0, 140));
        const sess = JSON.parse(kv.store.get('act_session:' + s.json.sid));
        t('会话状态 completed', sess.status === 'completed');
        t('claim 请求体带 code/machine/productClass/clientClass', global.__claimCalls.length === 1 && global.__claimCalls[0].code === CODE && global.__claimCalls[0].machineId === MID && global.__claimCalls[0].productClass === 'offline' && global.__claimCalls[0].clientClass === 'app');
        const before = global.__claimCalls.length + global.__tokenCalls.length;
        const r2 = await call(mod, kv, { action: 'complete', sid: s.json.sid, machineId: MID });
        t('重复 complete 幂等（不再 claim/consume）', r2.status === 200 && r2.json.idempotent === true && (global.__claimCalls.length + global.__tokenCalls.length) === before);
    }
    {
        const kv = makeKv(); reset();
        const s = await startSession(mod, kv);
        global.__claimResp = { status: 400, json: { success: false, error: '此激活码已绑定诊所，激活时必须提供 clinicName', needClinicName: true } };
        const r = await call(mod, kv, { action: 'complete', sid: s.json.sid, machineId: MID });
        const sess = JSON.parse(kv.store.get('act_session:' + s.json.sid));
        t('claim 失败 → retry:true 且【不核销令牌】', r.status === 400 && r.json.success === false && r.json.retry === true && !global.__tokenCalls.some(x => x.action === 'consume') && sess.status === 'claim_failed');
        // 重试成功
        global.__claimResp = { status: 200, json: { success: true, code: CODE, license: 'LIC2', licenseInfo: { type: 'pro' } } };
        const r2 = await call(mod, kv, { action: 'complete', sid: s.json.sid, machineId: MID });
        const sess2 = JSON.parse(kv.store.get('act_session:' + s.json.sid));
        t('claim 失败后重试成功 → completed + 核销', r2.status === 200 && r2.json.success && sess2.status === 'completed' && global.__tokenCalls.some(x => x.action === 'consume'));
    }
    {
        const kv = makeKv(); reset();
        const s = await startSession(mod, kv);
        const r = await call(mod, kv, { action: 'complete', sid: s.json.sid, machineId: MID2 });
        t('跨机 complete → 403', r.status === 403, r.status);
    }
    {
        const kv = makeKv(); reset();
        const r = await call(mod, kv, { action: 'complete', sid: 'f'.repeat(32), machineId: MID });
        t('sid 不存在 → 404', r.status === 404, r.status);
    }
    {
        const kv = makeKv(); reset();
        const s = await startSession(mod, kv);
        const sess = JSON.parse(kv.store.get('act_session:' + s.json.sid));
        sess.expiresAt = Date.now() - 1000;
        kv.store.set('act_session:' + s.json.sid, JSON.stringify(sess));
        const r = await call(mod, kv, { action: 'complete', sid: s.json.sid, machineId: MID });
        t('会话过期 → 410', r.status === 410, r.status);
    }
    {
        // claim 成功但 consume 失败 → consumePending；再次 complete 只补核销
        const kv = makeKv(); reset();
        const s = await startSession(mod, kv);
        global.__tokenResp = { consume: { status: 500, json: { success: false, error: 'KV busy' } } };
        const r = await call(mod, kv, { action: 'complete', sid: s.json.sid, machineId: MID });
        t('claim 成功+核销失败 → success + consumePending', r.status === 200 && r.json.success === true && r.json.consumePending === true, JSON.stringify(r.json).slice(0, 120));
        global.__tokenResp = null;
        const r2 = await call(mod, kv, { action: 'complete', sid: s.json.sid, machineId: MID });
        t('再次 complete 只补核销 → completed/idempotent', r2.status === 200 && r2.json.success && r2.json.idempotent === true && global.__claimCalls.length === 1 && global.__tokenCalls.filter(x => x.action === 'consume').length === 2);
    }
    {
        const kv = makeKv(); reset();
        const s = await startSession(mod, kv);
        const r = await call(mod, kv, { action: 'status', sid: s.json.sid, machineId: MID });
        t('status 返回 code_issued', r.status === 200 && r.json.status === 'code_issued' && r.json.completed === false);
    }

    console.log('==============================');
    console.log('激活会话端点测试：' + pass + ' PASS / ' + fail + ' FAIL');
    if (fail > 0) process.exit(1);
})().catch(e => { console.error('[FATAL]', e); process.exit(2); });
