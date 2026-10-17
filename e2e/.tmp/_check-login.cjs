// 临时脚本：查 MG3B 码状态 + entitlement 裁决（测完即删）
const https = require('https');

function req(path, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body || {});
    const r = https.request({
      hostname: 'tcm-prescription-system.pages.dev', path,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d.slice(0, 500) }); } });
    });
    r.on('error', (e) => resolve({ err: e.message }));
    r.write(payload); r.end();
  });
}

(async () => {
  // 1. entitlement 裁决
  const ent = await req('/api/license/entitlement', {
    machineId: '5784b5da162946afdeb89fdf3eebb50d', platform: 'android', username: '13398628212'
  });
  console.log('=== entitlement ===');
  console.log(JSON.stringify(ent, null, 2).slice(0, 2000));

  // 2. validate 裁决（用 redeemedDevices 豁免）
  const val = await req('/api/license/validate', {
    code: 'BNZC-MG3B-FAPS-DEGL-2CSW', machineId: '5784b5da162946afdeb89fdf3eebb50d', platform: 'android', phone: '13398628212'
  });
  console.log('\n=== validate ===');
  console.log(JSON.stringify(val, null, 2).slice(0, 1500));
})();
