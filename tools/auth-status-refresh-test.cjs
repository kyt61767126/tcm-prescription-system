// ============================================================================
//  auth-status-refresh-test.cjs — 「激活/续费成功后主窗口仍显示未激活/已缓存」回归门禁
//  （2026-10-10 P0 第 1 项）
//
//  背景（docs/登录速度分析与优化建议.md 第十一章）：云端客户端基础设置授权区读的是
//  本地登录缓存快照；服务端 get-profile 才是权威，但原实现
//    ① 回写**只补空不覆盖** → 续费后缓存永不更新（停在登录那一刻的到期日）；
//    ② 触发条件只认"缺字段" → clinicStatus='test'/旧缓存形态直接早退，永不再拉服务端；
//  于是"服务端已经对了、客户端永远显示未激活/旧缓存"（客户 15200069705 实证：
//  诊所已续费到 2028-10-07，客户端仍显示旧状态/未激活）。
//
//  本门禁用 tools/auth-core-status-sandbox.cjs 在 vm 里跑**真实上线包**
//  （shared/auth-core.js，由 sync-auth-core.ps1 生成）——不抽函数体、不抄副本，
//  因为被测语义（模块级节流窗口、in-flight Promise 去重、reqId 防重入）都在闭包里。
//
//  断言分组：
//    P1 过时缓存 → 服务端新到期日：缓存**被覆盖**、渲染新天数
//    P2 旧缓存形态（clinicStatus 空）→ 服务端 active：必须渲染「✅ 已激活」（不得再显示旧缓存）
//    P3 安全回退防护：本地/服务端均 'test' → 仍「⏳ 试用期/待审核」，**绝不**误显示已激活
//    P3b 本地 active + 服务端 test → 必须被覆盖为试用期（防"试用用户被显示已激活"回归）
//    P4 网络失败/401：零缓存写入 + 仍是未激活形态
//    P5 换账号竞态：服务端 username ≠ 本地 → 零写入
//    P6 邀请码回写单调性：更旧的到期日不得把权威值改回去
//    P7 并发/在途重开设置：最终渲染必须是权威状态（不得停在 stale）
//    P8 网络失败不吃节流窗口：下一次渲染必须重试
//    P9 无 token 且缓存里也没有 → 不发请求、仍是未激活形态（残留路径，明确记录）
//
//  ★ 时钟口径（2026-10-14）：沙箱冻结在 2026-10-10T00:00:00Z，故 NEW_EXP(2028-10-07)
//    渲染恒为 728 天、OLD_EXP(2027-10-08) 恒为 363 天——天数断言不再随自然时间过期。
//
//  用法: node tools/auth-status-refresh-test.cjs     退出码 0=全过
// ============================================================================
'use strict';
const { makeStatusSandbox, jsonResp, render, readKey, gfHits, seedAll } = require('./auth-core-status-sandbox.cjs');

// ★ 2026-10-14 断尾护栏：本套件必须跑到末尾汇总并显式 process.exit。历史事故——P7
//   用 pending gate 模拟在途请求、而沙箱 setTimeout 是 no-op，事件循环零句柄时 Node
//   静默以 exit 0 退出（P7 后半/P8/P9 全没跑，已有 FAIL 也拦不住推送）。若再发生
//   "没跑到汇总进程就结束"，exit 事件里强制翻成 99，让门禁真正失败。
let __suiteCompleted = false;
process.on('exit', (code) => {
    if (!__suiteCompleted && code === 0) {
        console.error('\nFATAL: 测试套件未跑到汇总即退出（事件循环断尾/挂死），按失败处理');
        process.exitCode = 99;
    }
});

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log('  PASS  ' + name); pass++; }
    else { console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); fail++; }
};

const NEW_EXP = '2028-10-07T00:00:00.000Z';
const OLD_EXP = '2027-10-08T00:00:00.000Z';
const USER = '15200069705';
const CLINIC = '中医诊所·9705';

const serverOk = (over) => {
    over = over || {};
    return jsonResp({
        success: true,
        user: Object.assign({
            username: USER, name: USER, role: 'clinic_admin', clinicId: 'clinic_o67d5eqv1r',
            clinicName: CLINIC, clinicStatus: 'active', clinicEdition: 'cloud_clinic', userType: 'production'
        }, over.user || {}),
        clinicExpiresAt: (over.clinicExpiresAt !== undefined ? over.clinicExpiresAt : NEW_EXP)
    });
};
const serverFail401 = () => jsonResp({ success: false, error: '未登录或登录已失效' }, 401);
const clientCache = (extra) => Object.assign({ username: USER, token: 'tok-1', role: 'clinic_admin', clinicId: 'clinic_o67d5eqv1r' }, extra || {});
const staleCache = () => clientCache({ clinicStatus: 'active', clinicEdition: 'cloud_clinic', clinicExpiresAt: OLD_EXP, clinicName: CLINIC });
const oldCache = () => clientCache();   // 客户实证的「未激活/旧缓存」形态：无 clinicStatus、无到期日

(async () => {
    console.log('=== 被测包: shared/auth-core.js（真实上线包，vm 加载）===');
    {
        const sb = makeStatusSandbox(seedAll(staleCache()), () => serverOk());
        ok('加载后 window.updateLicenseStatusText 为函数', typeof sb.updateLicenseStatusText === 'function');
    }

    console.log('\n--- P1) 过时缓存 → 服务端新到期日：覆盖 + 渲染新天数 ---');
    {
        const sb = makeStatusSandbox(seedAll(staleCache()), () => serverOk());
        const html = await render(sb);
        ok('★ 渲染拿到新到期日（728 天，而非旧值 363 天）', html.indexOf('728') >= 0, html);
        ok('★ 渲染不含旧到期日天数', html.indexOf('363') < 0, html);
        const cu = readKey(sb, 'auth:currentUser');
        ok('★ auth:currentUser 被覆盖为新到期日', cu.clinicExpiresAt === NEW_EXP, cu.clinicExpiresAt);
        ok('currentUser / cloud_currentUser 同步被覆盖',
            readKey(sb, 'currentUser').clinicExpiresAt === NEW_EXP && readKey(sb, 'cloud_currentUser').clinicExpiresAt === NEW_EXP);
        ok('user_login_data.user 被覆盖且 loginTime 结构未破',
            readKey(sb, 'user_login_data').user.clinicExpiresAt === NEW_EXP && typeof readKey(sb, 'user_login_data').loginTime === 'number');
        ok('local_currentUser 被覆盖（第 4 键）', readKey(sb, 'local_currentUser').clinicExpiresAt === NEW_EXP);
    }

    console.log('\n--- P2) 旧缓存形态（clinicStatus 空）→ 服务端 active：必须「✅ 已激活」 ---');
    {
        const sb = makeStatusSandbox(seedAll(oldCache()), () => serverOk());
        const html = await render(sb);
        ok('★ 渲染「✅ 已激活」（不再显示未激活/旧缓存）', html.indexOf('✅ 已激活') >= 0, html);
        ok('★ 渲染不含「未激活/旧缓存」', html.indexOf('未激活/旧缓存') < 0, html);
        ok('★ 确实拉取了服务端（get-profile ≥ 1 次）', gfHits(sb) >= 1, gfHits(sb));
        const cu = readKey(sb, 'auth:currentUser');
        ok('缓存补出 clinicStatus=active', cu.clinicStatus === 'active', cu.clinicStatus);
        ok('缓存补出 clinicName', cu.clinicName === CLINIC, cu.clinicName);
    }

    console.log('\n--- P3) 安全回退防护：试用用户绝不能被显示成已激活 ---');
    {
        const sb = makeStatusSandbox(seedAll(clientCache({ clinicStatus: 'test', clinicEdition: '' })), () => serverOk({ user: { clinicStatus: 'test' }, clinicExpiresAt: null }));
        const html = await render(sb);
        ok('★ 本地/服务端均 test → 仍「⏳ 试用期/待审核」', html.indexOf('试用期/待审核') >= 0, html);
        ok('★ 绝不渲染「✅ 已激活」', html.indexOf('✅ 已激活') < 0, html);
    }
    {
        const sb = makeStatusSandbox(seedAll(clientCache({ clinicStatus: 'active', clinicEdition: 'cloud_clinic', clinicExpiresAt: NEW_EXP })), () => serverOk({ user: { clinicStatus: 'test' }, clinicExpiresAt: null }));
        const html = await render(sb);
        ok('★ 本地 active + 服务端 test → 被覆盖为试用期', html.indexOf('试用期/待审核') >= 0 && html.indexOf('✅ 已激活') < 0, html);
        ok('缓存 clinicStatus 被覆盖为 test', readKey(sb, 'auth:currentUser').clinicStatus === 'test');
    }

    console.log('\n--- P4) 网络失败 / 401：零写入 + 仍是未激活形态 ---');
    {
        const before = seedAll(oldCache());
        const snap = JSON.stringify(before);
        const sb = makeStatusSandbox(before, () => { throw new Error('mock network down'); });
        const html = await render(sb);
        ok('★ 渲染仍是「⏳ 未激活/旧缓存」', html.indexOf('未激活/旧缓存') >= 0, html);
        ok('★ 绝不渲染「✅ 已激活」', html.indexOf('✅ 已激活') < 0, html);
        ok('★ 零缓存写入（5 键与种子逐字节相同）',
            ['auth:currentUser', 'currentUser', 'cloud_currentUser', 'user_login_data', 'local_currentUser']
                .every(k => JSON.stringify(before[k]) === JSON.stringify(JSON.parse(JSON.stringify(before[k])))) &&
            JSON.stringify({
                'auth:currentUser': sb._ls.getItem('auth:currentUser'),
                'currentUser': sb._ls.getItem('currentUser'),
                'cloud_currentUser': sb._ls.getItem('cloud_currentUser'),
                'user_login_data': sb._ls.getItem('user_login_data'),
                'local_currentUser': sb._ls.getItem('local_currentUser'),
            }) === snap, sb._ls.getItem('auth:currentUser'));
        ok('失败后带「联网校验未完成」提示（可行动）', html.indexOf('联网校验未完成') >= 0, html);
    }
    {
        const sb = makeStatusSandbox(seedAll(oldCache()), () => serverFail401());
        const html = await render(sb);
        ok('401 → 渲染仍是未激活形态', html.indexOf('未激活/旧缓存') >= 0 && html.indexOf('✅ 已激活') < 0, html);
        const cu = readKey(sb, 'auth:currentUser');
        ok('401 → 零缓存写入', cu.clinicStatus === undefined && cu.clinicExpiresAt === undefined, cu);
    }

    console.log('\n--- P5) 换账号竞态：服务端 username ≠ 本地 → 零写入 ---');
    {
        const sb = makeStatusSandbox(seedAll(staleCache()), () => serverOk({ user: { username: '13900000000' } }));
        await render(sb);
        const cu = readKey(sb, 'auth:currentUser');
        ok('★ clinicExpiresAt 仍为旧值（未被他人数据覆盖）', cu.clinicExpiresAt === OLD_EXP, cu.clinicExpiresAt);
        ok('★ username 未被改写', cu.username === USER, cu.username);
        ok('user_login_data.user 未被写入', readKey(sb, 'user_login_data').user.clinicExpiresAt === OLD_EXP);
    }

    console.log('\n--- P6) 邀请码回写单调性：更旧的到期日不得改写权威值 ---');
    {
        const expBack = '2027-10-08T00:00:00.000Z';
        const sb = makeStatusSandbox(seedAll(staleCache()), (url) => {
            if (/action=get-profile/.test(String(url))) return serverOk();
            return jsonResp({ success: true, inviteCode: 'ABCD12', inviteCount: 1, rewardDays: 30, clinicExpiresAt: expBack });
        });
        const html = await render(sb);
        ok('★ 权威值保持 2028-10-07（更旧的邀请码值被拒）', readKey(sb, 'auth:currentUser').clinicExpiresAt === NEW_EXP, readKey(sb, 'auth:currentUser').clinicExpiresAt);
        ok('★ 渲染仍是新天数', html.indexOf('728') >= 0, html);
    }

    console.log('\n--- P7) 并发 / 在途重开设置：最终渲染必须是权威状态 ---');
    {
        const sb = makeStatusSandbox(seedAll(oldCache()), () => serverOk());
        await Promise.all([sb.updateLicenseStatusText(), sb.updateLicenseStatusText()]);
        const html = sb._els.licenseStatusText.innerHTML;
        ok('in-flight 去重：只打 1 次 get-profile', gfHits(sb) === 1, gfHits(sb));
        ok('★ 同 tick 并发最终渲染不是「未激活/旧缓存」', html.indexOf('未激活/旧缓存') < 0, html);
    }
    {
        let release;
        const gate = new Promise(r => { release = r; });
        const sb = makeStatusSandbox(seedAll(oldCache()), () => gate.then(() => serverOk()));
        // ★ 2026-10-14 修：gate 必须由**真实宏任务**释放。旧写法「await p2 之后才
        //   release()」是自死锁（p2 等 gate、gate 等 await 之后的代码），且沙箱定时器
        //   曾是 no-op、事件循环零句柄 → Node 静默 exit 0，P7 后半/P8/P9 全部不执行。
        //   真实 setTimeout 既保持事件循环存活，又等价于真实 fetch 的宏任务应答语义。
        const p1 = sb.updateLicenseStatusText();
        const p2 = sb.updateLicenseStatusText();
        setTimeout(release, 5);
        await p2;
        await p1;
        const htmlAfter = sb._els.licenseStatusText.innerHTML;
        ok('★ 在途重开后（响应到达）渲染不是「未激活/旧缓存」', htmlAfter.indexOf('未激活/旧缓存') < 0, htmlAfter);
        ok('★ 缓存已是权威值', readKey(sb, 'auth:currentUser').clinicExpiresAt === NEW_EXP);
    }

    console.log('\n--- P8) 网络失败不吃 6h 节流窗口：下一次渲染必须重试 ---');
    {
        let mode = 'fail';
        const sb = makeStatusSandbox(seedAll(staleCache()), () => { if (mode === 'fail') throw new Error('down'); return serverOk(); });
        await render(sb);
        const gf1 = gfHits(sb);
        mode = 'ok';
        const html2 = await render(sb);
        ok('★ 失败后第二次渲染会重试（get-profile 次数增加）', gfHits(sb) > gf1, { gf1, gf2: gfHits(sb) });
        ok('★ 重试拿到权威值 → 渲染新天数', html2.indexOf('728') >= 0, html2);
        ok('重试成功后缓存已更新', readKey(sb, 'auth:currentUser').clinicExpiresAt === NEW_EXP);
    }

    console.log('\n--- P9) 残留路径（明确记录，不阻断）：无 token 且缓存无 token ---');
    {
        const noToken = { username: USER, name: USER, role: 'clinic_admin', clinicId: 'clinic_o67d5eqv1r' };
        const sb = makeStatusSandbox(seedAll(noToken), () => serverOk());
        const html = await render(sb);
        ok('无 token 时不打 get-profile', gfHits(sb) === 0, gfHits(sb));
        ok('无 token 时仍是未激活形态（需重新登录才能自愈）', html.indexOf('未激活/旧缓存') >= 0, html);
    }

    console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
    __suiteCompleted = true;
    process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('  FAIL  运行异常: ' + (e && e.stack || e)); process.exit(1); });
