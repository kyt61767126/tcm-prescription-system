// 临时脚本：测 entitlement 完整客户端参数（测完即删）
const https = require('https');
function req(path, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {});
    const r = https.request({
      hostname: 'tcm-prescription-system.pages.dev', path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d.slice(0, 800) }); }
      });
    });
    r.on('error', (e) => resolve({ err: e.message }));
    r.write(payload); r.end();
  });
}
(async () => {
  const mid = '5784b5da162946afdeb89fdf3eebb50d';
  // 1. code=空（客户端实际行为）
  console.log('=== code=空（客户端实际）===');
  console.log(JSON.stringify(await req('/api/license/entitlement', {
    machineId: mid, code: '', username: '13398628212', platform: 'android'
  }), null, 2).slice(0, 800));

  // 2. 无 code 字段
  console.log('\n=== 无 code 字段 ===');
  console.log(JSON.stringify(await req('/api/license/entitlement', {
    machineId: mid, username: '13398628212', platform: 'android'
  }), null, 2).slice(0, 800));

  // 3. 带正确 code
  console.log('\n=== 带正确 code ===');
  console.log(JSON.stringify(await req('/api/license/entitlement', {
    machineId: mid, code: 'BNZC-MG3B-FAPS-DEGL-2CSW', username: '13398628212', platform: 'android'
  }), null, 2).slice(0, 800));

  // 4. 带错误 code
  console.log('\n=== 带错误 code ===');
  console.log(JSON.stringify(await req('/api/license/entitlement', {
    machineId: mid, code: 'WRONG-CODE-XXXX', username: '13398628212', platform: 'android'
  }), null, 2).slice(0, 800));
})();
