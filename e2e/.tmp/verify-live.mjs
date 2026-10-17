// 线上生效验证：判据与桶内计数无关
//  该码本小时 5 次额度已被打满，因此：
//    用【本机真实 machineId】请求 → 200 = 同机重放豁免已生效；429 = 仍是旧代码
const API = 'https://tcm-prescription-system.pages.dev/api/license/claim';
const CODE = 'BNZC-KLPF-5C28-UK7X-DWZV';
const REAL_MID = '7f5e4f79f30967666d9137b51c3b8217';

(async () => {
    let allOk = true;
    for (let i = 1; i <= 3; i++) {
        const t0 = Date.now();
        const r = await fetch(API, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: CODE, machineId: REAL_MID, phone: '13398111111',
                productClass: 'offline', clientClass: 'desktop'
            })
        });
        const txt = await r.text();
        let j = null; try { j = JSON.parse(txt); } catch (_) {}
        const flag = r.status === 200 ? '✅' : (r.status === 429 ? '❌' : '⚠');
        console.log(`${flag} #${i}  HTTP ${r.status}  ${Date.now() - t0}ms  ${(j && j.error) || ('success=' + (j && j.success))}`);
        if (r.status !== 200) allOk = false;
        await new Promise(res => setTimeout(res, 800));
    }
    console.log('');
    console.log(allOk
        ? '✅ 修复已在线生效：同机重放在额度打满时仍放行（生产域名 tcm-prescription-system.pages.dev）'
        : '❌ 仍未生效，需排查部署是否落到生产域');
})();
