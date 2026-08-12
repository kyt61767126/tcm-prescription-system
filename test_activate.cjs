const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const UD = path.join(os.homedir(), 'AppData', 'Roaming', 'tcm-prescription-cloud');
const lp = path.join(UD, 'license.dat');
const cp = path.join(UD, 'config.json');
const ap = path.join(UD, 'admin-request-id.dat');

// 杀进程
function kill(n) { try { execSync('taskkill /F /IM "'+n+'" /T 2>nul', {timeout:8000, stdio:['ignore','ignore','ignore']}); } catch {} }
kill('惠康中医-YB.exe');
kill('惠康中医-YJ.exe');
execSync('powershell Start-Sleep -Seconds 2', {timeout:8000, stdio:'ignore'});

// 删除文件
[lp, cp, ap].forEach(f => {
  if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('已删除: ' + path.basename(f)); }
  else { console.log('不存在: ' + path.basename(f)); }
});

// 备份一份config.json以防万一
// 不备份了，用户说已清除

// 启动YB.exe
console.log('\n--- 启动 YB.exe ---');
const YB = 'D:/Program Files/tcm-prescription-cloud/惠康中医-YB.exe';
if (fs.existsSync(YB)) {
  try {
    execSync('powershell -NoProfile -Command "Start-Process -FilePath \''+YB+'\'"', {timeout:15000, stdio:['ignore','ignore','ignore']});
    console.log('🚀 YB.exe 启动成功!');
  } catch(e) {
    try { const c = spawn(YB, [], {detached:true, stdio:'ignore'}); c.unref(); console.log('🚀 spawn OK'); }
    catch(e2) { console.log('启动失败: ' + e2.message); }
  }
}

console.log('\n✅ 已清除 license.dat + config.json + admin-request-id.dat');
console.log('👉 YB.exe 应弹出激活窗口（单页表单：诊所名+医师名+手机号+密码+确认密码）');
console.log('👉 请查看激活窗口是否正常显示，告诉我您看到的内容');
setTimeout(() => process.exit(0), 5000);
