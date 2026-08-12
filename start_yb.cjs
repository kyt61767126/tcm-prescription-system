const { spawn } = require('child_process');
const fs = require('fs');

const YB = 'D:/Program Files/tcm-prescription-cloud/惠康中医-YB.exe';

// 先杀掉可能残留的进程
try { require('child_process').execSync('taskkill /F /IM "惠康中医-YB.exe" /T 2>nul', {timeout:8000,stdio:'ignore'}); } catch {}
try { require('child_process').execSync('taskkill /F /IM "惠康中医-YJ.exe" /T 2>nul', {timeout:8000,stdio:'ignore'}); } catch {}
try { require('child_process').execSync('powershell Start-Sleep -Seconds 2', {timeout:8000,stdio:'ignore'}); } catch {}

// 确认config.json和license.dat已删除
const path = require('path');
const os = require('os');
const UD = path.join(os.homedir(), 'AppData', 'Roaming', 'tcm-prescription-cloud');
const cp = path.join(UD, 'config.json');
const lp = path.join(UD, 'license.dat');
console.log('config.json:', fs.existsSync(cp) ? '存在(需删除)' : '✅已删除');
console.log('license.dat:', fs.existsSync(lp) ? '存在(需删除)' : '✅已删除');
if (fs.existsSync(cp)) { fs.unlinkSync(cp); console.log('已删除config.json'); }
if (fs.existsSync(lp)) { fs.unlinkSync(lp); console.log('已删除license.dat'); }

// 用detached方式启动，不会被父进程退出影响
console.log('\n启动 YB.exe (detached)...');
const child = spawn(YB, [], {
  detached: true,
  stdio: 'ignore',
  cwd: 'D:/Program Files/tcm-prescription-cloud'
});
child.unref();

console.log('✅ YB.exe PID:', child.pid);
console.log('👉 程序已启动，请等待几秒后查看屏幕上是否弹出激活窗口');
console.log('   激活窗口应该显示：诊所名/医师名/手机号/密码/确认密码 表单');

setTimeout(() => process.exit(0), 3000);
