const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const UD = path.join(os.homedir(), 'AppData', 'Roaming', 'tcm-prescription-cloud');
const INST = 'D:/Program Files/tcm-prescription-cloud';

console.log('=== 诊断 YB.exe 启动问题 ===\n');

// 1) 检查文件是否存在
const YB = path.join(INST, '惠康中医-YB.exe');
const YJ = path.join(INST, '惠康中医-YJ.exe');
const asar = path.join(INST, 'resources', 'app.asar');
console.log('1) 文件检查:');
console.log('  YB.exe:', fs.existsSync(YB) ? '存在 '+(fs.statSync(YB).size>>10)+'KB' : '❌ 不存在');
console.log('  YJ.exe:', fs.existsSync(YJ) ? '存在 '+(fs.statSync(YJ).size>>10)+'KB' : '❌ 不存在');
console.log('  app.asar:', fs.existsSync(asar) ? '存在 '+(fs.statSync(asar).size>>10)+'KB' : '❌ 不存在');

// 2) 检查userData目录
console.log('\n2) userData目录:');
console.log('  路径:', UD);
console.log('  存在:', fs.existsSync(UD));
if (fs.existsSync(UD)) {
  const files = fs.readdirSync(UD);
  console.log('  文件:', files.join(', ') || '(空)');
  // 检查config.json
  const cp = path.join(UD, 'config.json');
  console.log('  config.json:', fs.existsSync(cp) ? '存在' : '已删除');
  const lp = path.join(UD, 'license.dat');
  console.log('  license.dat:', fs.existsSync(lp) ? '存在' : '已删除');
  // 检查logs
  const logsDir = path.join(UD, 'logs');
  if (fs.existsSync(logsDir)) {
    const logs = fs.readdirSync(logsDir);
    console.log('  logs目录:', logs.join(', '));
    // 读取最新日志
    if (logs.length > 0) {
      const latest = logs.sort().pop();
      const logContent = fs.readFileSync(path.join(logsDir, latest), 'utf8');
      console.log('\n3) 最新日志 ('+latest+') 最后3000字符:');
      console.log(logContent.substring(Math.max(0, logContent.length-3000)));
    }
  } else {
    console.log('  logs目录: 不存在');
  }
}

// 3) 检查是否有进程在运行
console.log('\n4) 进程检查:');
try {
  const out = execSync('tasklist /FI "IMAGENAME eq 惠康中医*" /FO CSV 2>nul', {encoding:'utf8', timeout:8000});
  console.log(out.trim() || '  无相关进程');
} catch(e) {
  console.log('  tasklist失败:', e.message);
}

// 4) 尝试从命令行直接启动YB.exe并捕获输出
console.log('\n5) 尝试命令行启动YB.exe捕获stderr...');
try {
  const result = execSync('"'+YB+'" 2>&1', {
    encoding: 'utf8',
    timeout: 8000,
    cwd: INST,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false
  });
  console.log('  输出:', result || '(无输出)');
} catch(e) {
  console.log('  启动结果:', e.message);
  if (e.stdout) console.log('  stdout:', e.stdout.substring(0, 2000));
  if (e.stderr) console.log('  stderr:', e.stderr.substring(0, 2000));
}

// 5) 检查app.asar是否完整
console.log('\n6) 检查app.asar完整性:');
try {
  const list = execSync('npx --yes @electron/asar list "'+asar+'"', {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const items = list.trim().split('\n');
  console.log('  asar内文件数:', items.length);
  // 检查关键文件
  const keyFiles = ['index.html', 'cloud-api.js', 'electron/activate-window.html', 'electron/activate.js', 'electron/main.js', 'electron/login.html', 'electron/login.js'];
  for (const f of keyFiles) {
    const found = items.some(i => i.includes(f));
    console.log('  '+f+':', found ? '✅' : '❌ 缺失');
  }
} catch(e) {
  console.log('  asar检查失败:', e.message);
}

console.log('\n=== 诊断完成 ===');
setTimeout(() => process.exit(0), 3000);
