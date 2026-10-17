// 临时脚本：验证 P40 设备的服务端 entitlement 裁决态（测完即删）
const https = require('https');
const payload = JSON.stringify({ machineId: '5784b5da162946afdeb89fdf3eebb50d', platform: 'android' });
const req = https.request({
  hostname: 'tcm-prescription-system.pages.dev',
  path: '/api/license/entitlement',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
}, (res) => {
  let body = '';
  res.on('data', (c) => { body += c; });
  res.on('end', () => {
    console.log('HTTP', res.statusCode);
    try { console.log(JSON.stringify(JSON.parse(body), null, 2).slice(0, 1500)); }
    catch (e) { console.log('RAW:', body.slice(0, 800)); }
  });
});
req.on('error', (e) => console.error('ERR', e.message));
req.write(payload);
req.end();
