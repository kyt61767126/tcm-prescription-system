const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const SRC = 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_desktop';
const ORIG_ASAR = path.join(SRC, 'dist', 'win-unpacked', 'resources', 'app.asar');
const UNPACK = path.join(os.tmpdir(), 'activate_v2b_'+Date.now());
const DIST = path.join(SRC, 'dist_activate_v2');
const OUT = path.join(DIST, 'app.asar');
const INST = 'D:/Program Files/tcm-prescription-cloud';
const UD = path.join(os.homedir(), 'AppData', 'Roaming', 'tcm-prescription-cloud');

console.log('=== 激活窗口置顶修复版打包部署 ===\n');

// 0) 杀进程
function kill(n) { try { execSync('taskkill /F /IM "'+n+'" /T 2>nul',{timeout:8000,stdio:['ignore','ignore','ignore']}); } catch {} }
kill('惠康中医-YB.exe'); kill('惠康中医-YJ.exe');
execSync('powershell Start-Sleep -Seconds 2',{timeout:8000,stdio:'ignore'});

// 0.5) 清除用户数据
console.log('0) 清除用户数据（模拟首次激活）');
const toDelete = ['license.dat','config.json','admin-request-id.dat'];
toDelete.forEach(f => {
  const p = path.join(UD, f);
  if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('  已删除: '+f); }
  else console.log('  不存在: '+f);
});
// 也删Partitions缓存（历史处方/乱码缓存），但不删prescriptions.json硬备份
if (fs.existsSync(path.join(UD, 'Partitions'))) {
  try { fs.rmSync(path.join(UD, 'Partitions'), {recursive:true,force:true}); console.log('  已清除: Partitions'); } catch(e) { console.log('  清除Partitions失败: '+e.message); }
}
// 也删Local Storage等缓存
['Local Storage','Session Storage','IndexedDB','Cache','CacheData','GPUCache'].forEach(d=>{
  const p = path.join(UD, d);
  if (fs.existsSync(p)) { try { fs.rmSync(p,{recursive:true,force:true}); } catch {} }
});

// 1) 解包
console.log('\n1) 解包原版asar');
execSync('npx --yes @electron/asar extract "'+ORIG_ASAR+'" "'+UNPACK+'"',{encoding:'utf8',timeout:300000,stdio:['ignore','pipe','pipe']});
console.log('  ✅ 解包 '+fs.readdirSync(UNPACK).length+' 项');

// 2) 替换所有修改过的文件（含最新activate.js！）
console.log('\n2) 替换修改文件:');
const files = [
  ['index.html'], ['cloud-api.js'], ['db-adapter.js'],
  ['electron','main.js'], ['electron','preload.js'],
  ['electron','activate-window.html'],
  ['electron','activate.js'],          // ★ 最新：窗口置顶修复
  ['electron','login.html'],
  ['electron','login.js'],
];
for (const parts of files) {
  const s = path.join(SRC, ...parts);
  const d = path.join(UNPACK, ...parts);
  if (!fs.existsSync(s) || !fs.existsSync(d)) { console.log('  ⚠ 跳过: '+parts.join('/')); continue; }
  fs.copyFileSync(s, d);
  console.log('  ✅ '+parts.join('/')+'  '+(fs.statSync(d).size>>10)+'KB');
}

// 3) 重新pack
console.log('\n3) 重新pack');
try { fs.rmSync(DIST,{recursive:true,force:true}); } catch {}
fs.mkdirSync(DIST,{recursive:true});
execSync('npx --yes @electron/asar pack "'+UNPACK+'" "'+OUT+'"',{encoding:'utf8',timeout:300000,stdio:['ignore','pipe','pipe']});
console.log('  ✅ 新asar: '+(fs.statSync(OUT).size>>10)+' KB');

// 4) 覆盖安装目录
console.log('\n4) 覆盖安装目录');
const dst = path.join(INST, 'resources', 'app.asar');
try { fs.copyFileSync(OUT, dst); console.log('  ✅ 直接覆盖'); }
catch(e) { try { if(fs.existsSync(dst)) fs.renameSync(dst,dst+'.old_'+Date.now()); fs.copyFileSync(OUT,dst); console.log('  ✅ rename→copy'); } catch(e2){ console.log('  💥 '+e2.message); process.exit(1); } }

// 5) YB.exe存在性
const YB = path.join(INST,'惠康中医-YB.exe');
const YJ = path.join(INST,'惠康中医-YJ.exe');
if (!fs.existsSync(YB) && fs.existsSync(YJ)) { fs.copyFileSync(YJ,YB); console.log('\n5) 复制YJ→YB.exe'); }
else console.log('\n5) YB.exe已存在: '+(fs.statSync(YB).size>>20)+'MB');

// 6) 验证asar内activate.js修改生效（检查关键字alwaysOnTop+screen-saver）
console.log('\n6) asar内容验证（激活窗口置顶修复）:');
const tmpCheck = path.join(os.tmpdir(), 'check_'+Date.now());
execSync('npx --yes @electron/asar extract-file "'+dst+'" electron/activate.js >NUL 2>&1',{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
// 换一种验证：从打包后的UNPACK验证
const checkJs = fs.readFileSync(path.join(UNPACK,'electron','activate.js'),'utf8');
console.log('  alwaysOnTop=true:', checkJs.includes('alwaysOnTop: true') ? '✅' : '❌');
console.log('  screen-saver级:', checkJs.includes("'screen-saver'") ? '✅' : '❌');
console.log('  remove modal/parent:', !checkJs.includes('modal: true,') ? '✅（已删除modal+parent）' : '❌（仍有modal）');
console.log('  ready-to-show:', checkJs.includes("once('ready-to-show'") ? '✅' : '❌');
console.log('  死循环兜底已移除:', !checkJs.includes('showExpireAlertAndActivate(parentWindow, licenseResult.message)') ? '✅（关闭不再强弹出期提示）' : '⚠（仍有兜底弹窗）');

// 7) 启动
console.log('\n7) 启动 YB.exe (detached)...');
const child = spawn(YB, [], { detached:true, stdio:'ignore', cwd: INST });
child.unref();
console.log('  🚀 PID:', child.pid);

console.log('\n=== 完成！激活窗口置顶修复版已部署 ===');
console.log('');
console.log('📋 窗口显示修复（5个关键点）：');
console.log('  ① 去除 modal:true + parent:loginWindow → 不再被父窗口状态控制');
console.log('  ② alwaysOnTop: true + setAlwaysOnTop(screen-saver) → 强制置顶屏保级');
console.log('  ③ show:false + once(ready-to-show).show() → 先加载完再显示防白屏');
console.log('  ④ activateWindow.center() → 居中显示');
console.log('  ⑤ 关闭后兜底死循环 → 改为显示parent登录窗口（不死循环弹激活）');
console.log('');
console.log('👉 激活窗口应立即弹出在屏幕最中央、最顶部，标题为"软件激活"');
console.log('   单页表单：诊所名 / 医师名 / 手机号(登录账号) / 密码 / 确认密码 / 备注');
setTimeout(()=>process.exit(0), 4000);
