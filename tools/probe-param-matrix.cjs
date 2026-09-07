#!/usr/bin/env node
// ============================================================================
//  probe-param-matrix.cjs — 激活/登录链路参数完整性静态探针（2026-09-07 P0-②）
//
//  背景：激活登录问题反复的三大结构根因——①账号创建漏传参数（Tab2 只传
//    code+user 不带 phone/password，Mate 70 二次案例）②载体误判（APP 被判
//    desktop，判据必须用端独有 API showExpireAlert）③断点续传/明文密码/
//    IIFE 跨段引用回退。历史修复已闭环，本探针把事故史固化成断言库，
//    每次 push 前自动防回退。
//
//  扫描对象（权威源，副本由 sync-auth-core/sync-all 保证一致）：
//    shared/auth-core/offline.js（离线端：离线APP/离线桌面）
//    shared/auth-core/cloud.js（云端端：网页/云桌面/云端APP/鸿蒙）
//    functions/api/license/_lib/schema-guard.js（服务端，仅跨端一致性断言）
//    functions/api/license/entitlement.js（P1-① 统一裁决端点，F 组）
//    functions/api/license/claim.js（P1-② 统一认领门面，F 组）
//    activate.js ×3 + LicenseManager.java（P2-① 激活入口，G 组）
//    shared/license/license-manager.js（P2-③ 撤销检查，G 组）
//
//  规则来源：KNOWLEDGE 条目（Tab2盲区/断点续传/明文密码/IIFE/脏键/指纹/
//    条目三十六 P1 服务端收口 / 条目三十七 P2 客户端切换收口）
//
//  用法：node tools/probe-param-matrix.cjs
//  退出码：0 = 全部通过；1 = 有 FAIL（附修复指引）
//  新增规则：往 RULES 数组加一条即可（id 唯一 + source 注明出处条目）
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = {
    offline: path.join(ROOT, 'shared/auth-core/offline.js'),
    cloud: path.join(ROOT, 'shared/auth-core/cloud.js'),
    schemaGuard: path.join(ROOT, 'functions/api/license/_lib/schema-guard.js'),
    entitlement: path.join(ROOT, 'functions/api/license/entitlement.js'),
    claim: path.join(ROOT, 'functions/api/license/claim.js'),
    // P2 G 组（客户端切换收口，条目三十七）
    activateRoot: path.join(ROOT, 'activate.js'),
    activateOfflineDesktop: path.join(ROOT, 'app_project/db-offline/desktop/electron/activate.js'),
    activateCloudDesktop: path.join(ROOT, 'app_project/db-yunduan/cloud_desktop/electron/activate.js'),
    licenseManager: path.join(ROOT, 'shared/license/license-manager.js'),
    licenseJava: path.join(ROOT, 'app_project/db-offline/app/app/src/main/java/com/benneng/pres/LicenseManager.java')
};

function readSrc(p) { return fs.readFileSync(p, 'utf8'); }

// --- 工具：枚举函数调用点并取后续窗口 ---
function callSites(src, fnName, win) {
    const sites = [];
    const needle = fnName + '(';
    let i = -1;
    while ((i = src.indexOf(needle, i + 1)) !== -1) {
        sites.push({ index: i, window: src.slice(i, i + win) });
    }
    return sites;
}

// ============================================================================
// 规则库（每条：id / desc / source / run(sources) => { pass, detail }）
// ============================================================================
const RULES = [
    // ---------- A 载体判据（Tab2 载体误判事故） ----------
    {
        id: 'A1', desc: '禁止旧载体判据（electronAPI.activate 直接推 desktop）',
        source: 'KNOWLEDGE 2026-09-03 Tab2 载体误判根治',
        run: (s) => {
            const hits = [];
            for (const [name, src] of [['offline', s.offline], ['cloud', s.cloud]]) {
                for (const m of src.matchAll(/electronAPI\.activate\)[^;{}]{0,80}/g)) {
                    if (/['"]desktop['"]/.test(m[0])) hits.push(name + ' @' + m.index);
                }
            }
            return hits.length === 0
                ? { pass: true }
                : { pass: false, detail: '残留旧判据：' + hits.join(', ') + ' —— 跨端判别必须用桌面独有 electronAPI.activate.showExpireAlert' };
        }
    },
    {
        id: 'A2', desc: 'offline.js 正确判据 showExpireAlert ≥ 4 处（4 处已改基线）',
        source: 'KNOWLEDGE 2026-09-03 4 处载体判据全改',
        run: (s) => {
            const n = (s.offline.match(/showExpireAlert/g) || []).length;
            return n >= 4 ? { pass: true, detail: n + ' 处' }
                : { pass: false, detail: '仅 ' + n + ' 处（基线 ≥4）——判据可能被误改回旧版' };
        }
    },

    // ---------- B 账号创建三参数（Tab2 盲区事故） ----------
    {
        id: 'B1', desc: 'installAdminLicense 每个调用点必带 phone + password',
        source: 'KNOWLEDGE 2026-09-03：任何新建本地账号的激活路径必须携带手机号+密码',
        run: (s) => {
            const bad = [];
            for (const [name, src] of [['offline', s.offline], ['cloud', s.cloud]]) {
                for (const c of callSites(src, 'installAdminLicense', 450)) {
                    const w = c.window;
                    const ok = /\bphone\b/.test(w) && /\bpassword(Enc)?\b/.test(w);
                    if (!ok) bad.push(name + ' @' + c.index);
                }
            }
            return bad.length === 0
                ? { pass: true }
                : { pass: false, detail: '缺 phone/password 的调用点：' + bad.join(', ') };
        }
    },
    {
        id: 'B2', desc: 'addLocalActivationUser 每个调用点必带 phone + password',
        source: '同 B1（addLocalActivationUser 为 Tab2 补建账号时新增）',
        run: (s) => {
            const bad = [];
            for (const [name, src] of [['offline', s.offline], ['cloud', s.cloud]]) {
                for (const c of callSites(src, 'addLocalActivationUser', 450)) {
                    const w = c.window;
                    const ok = /\bphone\b/.test(w) && /\bpassword(Enc)?\b/.test(w);
                    if (!ok) bad.push(name + ' @' + c.index);
                }
            }
            return bad.length === 0
                ? { pass: true }
                : { pass: false, detail: '缺 phone/password 的调用点：' + bad.join(', ') };
        }
    },

    // ---------- C 断点续传与密码安全 ----------
    {
        id: 'C1', desc: 'offline.js 断点续传三件套齐全（resumeAdminPendingRequest/_resumeCompleteActivation/adminReqPending 持久化键）',
        source: 'KNOWLEDGE 2026-09-03（四）requestId 仅存内存事故',
        run: (s) => {
            const missing = [];
            if (!s.offline.includes('resumeAdminPendingRequest')) missing.push('resumeAdminPendingRequest');
            if (!s.offline.includes('_resumeCompleteActivation')) missing.push('_resumeCompleteActivation');
            if (!s.offline.includes('license:adminReqPending')) missing.push('license:adminReqPending');
            return missing.length === 0 ? { pass: true }
                : { pass: false, detail: '缺失：' + missing.join(', ') };
        }
    },
    {
        id: 'C2', desc: 'cloud.js 断点续传三件套齐全（含 _cloudResumeCompleteActivation 独立收尾）',
        source: 'KNOWLEDGE 2026-09-03（五）云端 4 处遗漏补齐',
        run: (s) => {
            const missing = [];
            if (!s.cloud.includes('resumeAdminPendingRequest')) missing.push('resumeAdminPendingRequest');
            if (!s.cloud.includes('_cloudResumeCompleteActivation')) missing.push('_cloudResumeCompleteActivation');
            if (!s.cloud.includes('license:adminReqPending')) missing.push('license:adminReqPending');
            return missing.length === 0 ? { pass: true }
                : { pass: false, detail: '缺失：' + missing.join(', ') };
        }
    },
    {
        id: 'C3', desc: 'adminReqPending 持久化禁止明文 password 键（必须 passwordEnc）',
        source: 'KNOWLEDGE 2026-09-03（五）① 密码明文持久化红线',
        run: (s) => {
            const bad = [];
            for (const [name, src] of [['offline', s.offline], ['cloud', s.cloud]]) {
                let i = -1;
                while ((i = src.indexOf('license:adminReqPending', i + 1)) !== -1) {
                    const before = src.slice(Math.max(0, i - 120), i);
                    const after = src.slice(i, i + 400);
                    if (/setItem/.test(before) && /['"]password['"]\s*:/.test(after)) {
                        bad.push(name + ' @' + i);
                    }
                }
            }
            return bad.length === 0 ? { pass: true }
                : { pass: false, detail: '明文 password 命中：' + bad.join(', ') + ' —— 持久化必须用 passwordEnc（加密失败 fail-safe 不存）' };
        }
    },

    // ---------- D machineId 卫生（脏键事故 + P0-③ 指纹稳定） ----------
    {
        id: 'D1', desc: '双源 normalizeMachineIdResult 白名单正则存在（8-64 位字母数字下划线短横）',
        source: 'KNOWLEDGE 条目三十三 脏键事故 + 2026-09-05 客户端归一化',
        run: (s) => {
            const re = /\[A-Za-z0-9_-\]\{8,64\}/;
            const bad = [];
            if (!re.test(s.offline)) bad.push('offline');
            if (!re.test(s.cloud)) bad.push('cloud');
            return bad.length === 0 ? { pass: true }
                : { pass: false, detail: '白名单正则缺失：' + bad.join(', ') };
        }
    },
    {
        id: 'D2', desc: '客户端与服务端 machineId 白名单正则一致（防两头漂移）',
        source: '条目三十三④ 数据反证方法论——校验规则两端必须同源',
        run: (s) => {
            const m = s.schemaGuard.match(/machineId:\s*\/(.+?)\//);
            if (!m) return { pass: false, detail: 'schema-guard.js 中 RE.machineId 未找到' };
            const serverRe = m[1];                       // ^[A-Za-z0-9_-]{8,64}$
            const clientOk = s.offline.includes(serverRe.replace(/\^|\\\$/g, '')) || /A-Za-z0-9_-\{8,64\}/.test(s.offline);
            const cloudOk = s.cloud.includes(serverRe.replace(/\^|\\\$/g, '')) || /A-Za-z0-9_-\{8,64\}/.test(s.cloud);
            if (clientOk && cloudOk) return { pass: true, detail: '服务端 /' + serverRe + '/ 与双源一致' };
            return { pass: false, detail: '两端白名单漂移：服务端 /' + serverRe + '/，客户端未匹配——改校验必须两端同步' };
        }
    },
    {
        id: 'D3', desc: '指纹稳定兜底存在（__deviceFpFallback 会话缓存，StorageAdapter 抛错时指纹不漂移）',
        source: '2026-09-07 架构方案 P0-③：最终 catch 三级兜底',
        run: (s) => {
            const bad = [];
            const nOff = (s.offline.match(/__deviceFpFallback/g) || []).length;
            const nCloud = (s.cloud.match(/__deviceFpFallback/g) || []).length;
            if (nOff < 2) bad.push('offline(' + nOff + ')');
            if (nCloud < 2) bad.push('cloud(' + nCloud + ')');
            return bad.length === 0 ? { pass: true, detail: 'offline ' + nOff + ' 处 / cloud ' + nCloud + ' 处' }
                : { pass: false, detail: '兜底标记不足：' + bad.join(', ') + ' —— collectDeviceIdentity 最终 catch 必须有会话级稳定指纹' };
        }
    },

    // ---------- E IIFE 跨段挂载（ReferenceError 静默吞错事故） ----------
    {
        id: 'E1', desc: 'offline.js 四个 global 挂载齐全（StorageAdapter/normalizeMachineIdResult/encryptSensitive/decryptSensitive）',
        source: 'KNOWLEDGE 条目三十二 跨 IIFE 作用域断裂事故',
        run: (s) => {
            const missing = [];
            for (const g of ['global.StorageAdapter =', 'global.normalizeMachineIdResult =', 'global.encryptSensitive =', 'global.decryptSensitive =']) {
                if (!s.offline.includes(g)) missing.push(g);
            }
            return missing.length === 0 ? { pass: true }
                : { pass: false, detail: '缺失挂载：' + missing.join(', ') + ' —— IIFE-2 裸引用将 ReferenceError 被 catch 静默吞掉' };
        }
    },

    // ---------- F P1 服务端收口（条目三十六：entitlement 统一裁决 + claim 统一认领） ----------
    {
        id: 'F1', desc: 'entitlement.js 四态枚举唯一来源（ENTITLEMENT_STATES 冻结导出，四态齐全）',
        source: 'KNOWLEDGE 条目三十六 P1-①：状态判定只此一份，客户端只消费不自算',
        run: (s) => {
            const src = s.entitlement;
            const missing = [];
            if (!/export const ENTITLEMENT_STATES\s*=\s*Object\.freeze\(\{/.test(src)) {
                missing.push('Object.freeze 导出缺失');
            } else {
                for (const k of ['LICENSED', 'NO_LICENSE', 'LICENSE_EXPIRED', 'LICENSE_REVOKED']) {
                    if (!new RegExp(k + "\\s*:\\s*'" + k + "'").test(src)) missing.push(k);
                }
            }
            return missing.length === 0 ? { pass: true }
                : { pass: false, detail: '缺失：' + missing.join(', ') + ' —— 四态是全项目唯一权威定义，改枚举必须先过自测 S1-S8' };
        }
    },
    {
        id: 'F2', desc: 'claim.js 统一认领门面存在（转发 validate + schema-guard 前置守门 + 400 拒绝分支）',
        source: 'KNOWLEDGE 条目三十六 P1-②：激活入口归一，垃圾 machineId 进不了 devices',
        run: (s) => {
            const missing = [];
            if (!s.claim.includes("import { onRequest as validateActivate } from './validate.js'")) missing.push('转发 validate');
            if (!/isValidMachineId/.test(s.claim)) missing.push('schema-guard 守门');
            if (!/status:\s*400/.test(s.claim)) missing.push('守门 400 拒绝分支');
            return missing.length === 0 ? { pass: true }
                : { pass: false, detail: '缺失：' + missing.join(', ') + ' —— 门面 = validate 转发 + 门口白名单，二者缺一即失去收口意义' };
        }
    },
    {
        id: 'F3', desc: 'entitlement.js 纯只读铁律（剥注释后零写调用：kv.put/kv.delete/updateLicense/saveLicense/setDeviceVersion/appendLicenseLog）',
        source: 'KNOWLEDGE 条目三十六 P1-①：裁决幂等/可重试/无副作用，机器可查',
        run: (s) => {
            // 剥注释后检查，防"注释里提到写调用"假阳；URL 字符串不受影响（写调用不可能出现在其同行尾部）
            const code = s.entitlement.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
            const hits = [];
            const patterns = [
                [/kv\.put\(/, 'kv.put('], [/kv\.delete\(/, 'kv.delete('],
                [/\bupdateLicense\(/, 'updateLicense('], [/\bsaveLicense\(/, 'saveLicense('],
                [/\bsetDeviceVersion\(/, 'setDeviceVersion('], [/\bappendLicenseLog\(/, 'appendLicenseLog(']
            ];
            for (const [re, label] of patterns) {
                if (re.test(code)) hits.push(label);
            }
            return hits.length === 0 ? { pass: true }
                : { pass: false, detail: '发现写调用：' + hits.join(', ') + ' —— 裁决端点绝不写 KV（端形态上报走 heartbeat），写调用会破坏幂等与可重试性' };
        }
    },

    // ---------- G P2 客户端切换收口（条目三十七：五端消费 claim/entitlement） ----------
    {
        id: 'G1', desc: '激活 URL 收口：全部激活入口走 claim 门面（3 个 activate.js + 离线APP Java + auth-core 双源无桥分支），validate 直连归零',
        source: 'KNOWLEDGE 条目三十七 P2-①：激活入口归一，绕过 claim = 绕过 schema-guard 守门',
        run: (s) => {
            const bad = [];
            const claimJs = /ACTIVATE_API_URL\s*=\s*'https:\/\/tcm-prescription-system\.pages\.dev\/api\/license\/claim'/;
            const validateJs = /ACTIVATE_API_URL\s*=\s*'[^']*\/api\/license\/validate'/;
            const claimJava = /ACTIVATE_API_URL\s*=\s*"https:\/\/tcm-prescription-system\.pages\.dev\/api\/license\/claim"/;
            const validateJava = /ACTIVATE_API_URL\s*=\s*"[^"]*\/api\/license\/validate"/;
            for (const [name, src] of [
                ['activate.js(根)', s.activateRoot],
                ['activate.js(离线桌面)', s.activateOfflineDesktop],
                ['activate.js(云桌面)', s.activateCloudDesktop]
            ]) {
                if (!claimJs.test(src)) bad.push(name + ' 未走 claim');
                if (validateJs.test(src)) bad.push(name + ' 残留 validate 直连');
            }
            if (!claimJava.test(s.licenseJava)) bad.push('LicenseManager.java(离线APP) 未走 claim');
            if (validateJava.test(s.licenseJava)) bad.push('LicenseManager.java(离线APP) 残留 validate 直连');
            for (const [name, src] of [['offline', s.offline], ['cloud', s.cloud]]) {
                if (!src.includes('/api/license/claim')) bad.push('auth-core/' + name + ' 无桥激活分支未走 claim');
                if (src.includes('/api/license/validate')) bad.push('auth-core/' + name + ' 残留 validate 直连');
            }
            return bad.length === 0
                ? { pass: true, detail: '6 处激活入口全部收口 claim' }
                : { pass: false, detail: bad.join('；') + ' —— 激活必须走 claim（validate 业务 + machineId 门口 400 守门），直连 validate 会把垃圾 machineId 写进 devices' };
        }
    },
    {
        id: 'G2', desc: '双源 performHeartbeatCheck 裁决收口：entitlement 四态主裁决 + 三态失效映射 + 心跳回退保留',
        source: 'KNOWLEDGE 条目三十七 P2-②：状态判定唯一来源 = entitlement 四态，heartbeat 仅上报+回退',
        run: (s) => {
            const bad = [];
            for (const [name, src] of [['offline', s.offline], ['cloud', s.cloud]]) {
                if (!src.includes('/api/license/entitlement')) bad.push(name + ' 未调 entitlement');
                if (!src.includes("entState === 'LICENSED'")) bad.push(name + ' 缺 LICENSED 主路径');
                if (!src.includes("'LICENSE_EXPIRED': '授权已过期")) bad.push(name + ' 缺 EXPIRED 映射');
                if (!src.includes("'LICENSE_REVOKED': '授权已被禁用")) bad.push(name + ' 缺 REVOKED 映射');
                if (!src.includes("'NO_LICENSE': '授权信息无效")) bad.push(name + ' 缺 NO_LICENSE 映射');
                if (!src.includes("data.action === 'ok'")) bad.push(name + ' 缺心跳回退判定（entitlement 不可达时兜底）');
            }
            return bad.length === 0
                ? { pass: true, detail: '双源四态主裁决 + 回退齐全' }
                : { pass: false, detail: bad.join('；') + ' —— 回退删除前老接口必须先退役，否则断网即误判' };
        }
    },
    {
        id: 'G3', desc: 'license-manager 撤销检查收口：entitlement 主裁决 + status 回退 + REVOKED/EXPIRED 唯一退出条件（NO_LICENSE 不退出）',
        source: 'KNOWLEDGE 条目三十七 P2-③：四态消费唯一退出条件，试用/未绑定机器零影响',
        run: (s) => {
            const src = s.licenseManager;
            const missing = [];
            if (!src.includes("const ENTITLEMENT_API_URL = 'https://tcm-prescription-system.pages.dev/api/license/entitlement'")) missing.push('entitlement 主裁决 URL');
            if (!src.includes("const HEARTBEAT_API_URL = 'https://tcm-prescription-system.pages.dev/api/license/status'")) missing.push('status 回退 URL');
            const quitLine = src.match(/result\.state === 'LICENSE_REVOKED'[^\n]*/);
            if (!quitLine) {
                missing.push('四态退出条件');
            } else if (!/result\.state === 'LICENSE_EXPIRED'/.test(quitLine[0])) {
                missing.push('退出条件缺 EXPIRED');
            } else if (/NO_LICENSE/.test(quitLine[0])) {
                missing.push('NO_LICENSE 误入退出条件（试用用户会被强退）');
            }
            if (!/app\.quit\(\)/.test(src)) missing.push('app.quit() 退出机制');
            return missing.length === 0
                ? { pass: true, detail: '主裁决+回退+四态退出条件齐全' }
                : { pass: false, detail: '缺失：' + missing.join(', ') + ' —— 撤销检查切 entitlement 后回退与退出边界必须与老接口对拍（未找到绑定不退出）' };
        }
    }
];

// ============================================================================
// 主流程
// ============================================================================
function main() {
    for (const [k, p] of Object.entries(SRC)) {
        if (!fs.existsSync(p)) {
            console.error('[probe-param-matrix] 源文件缺失: ' + p);
            process.exit(1);
        }
    }
    const s = {
        offline: readSrc(SRC.offline),
        cloud: readSrc(SRC.cloud),
        schemaGuard: readSrc(SRC.schemaGuard),
        entitlement: readSrc(SRC.entitlement),
        claim: readSrc(SRC.claim),
        activateRoot: readSrc(SRC.activateRoot),
        activateOfflineDesktop: readSrc(SRC.activateOfflineDesktop),
        activateCloudDesktop: readSrc(SRC.activateCloudDesktop),
        licenseManager: readSrc(SRC.licenseManager),
        licenseJava: readSrc(SRC.licenseJava)
    };

    console.log('============================================');
    console.log('  激活/登录链路参数完整性探针（P0-②）');
    console.log('  offline ' + (s.offline.match(/\n/g) || []).length + ' 行 / cloud ' + (s.cloud.match(/\n/g) || []).length + ' 行');
    console.log('============================================');

    let fail = 0, pass = 0;
    for (const rule of RULES) {
        let r;
        try { r = rule.run(s); }
        catch (e) { r = { pass: false, detail: '规则执行异常: ' + e.message }; }
        if (r.pass) {
            pass++;
            console.log('  [PASS] ' + rule.id + ' ' + rule.desc + (r.detail ? '  (' + r.detail + ')' : ''));
        } else {
            fail++;
            console.log('  [FAIL] ' + rule.id + ' ' + rule.desc);
            console.log('         原因: ' + (r.detail || '未满足断言'));
            console.log('         出处: ' + rule.source);
        }
    }

    console.log('============================================');
    if (fail === 0) {
        console.log('  [OK] ' + pass + '/' + RULES.length + ' 断言全部通过');
        process.exit(0);
    } else {
        console.log('  [FAIL] ' + fail + ' 条断言未通过（' + pass + ' 通过）');
        console.log('  修复后重新提交；紧急绕过：git push --no-verify（事后必须补修）');
        process.exit(1);
    }
}

main();
