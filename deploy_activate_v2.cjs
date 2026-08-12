const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const SRC = 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_desktop';
const ORIG_ASAR = path.join(SRC, 'dist', 'win-unpacked', 'resources', 'app.asar');
const UNPACK = path.join(os.tmpdir(), 'activate_v2_'+Date.now());
const DIST = path.join(SRC, 'dist_activate_v2');
const OUT = path.join(DIST, 'app.asar');
const INST = 'D:/Program Files/tcm-prescription-cloud';

console.log('=== 激活流程优化版打包部署 ===\n');

// 0) 杀进程
console.log('0) 杀掉运行中的进程');
function kill(n) { try { execSync('taskkill /F /IM "'+n+'" /T 2>nul',{timeout:8000,stdio:['ignore','ignore','ignore']}); } catch {} }
kill('惠康中医-YB.exe'); kill('惠康中医-YJ.exe');
execSync('powershell Start-Sleep -Seconds 2',{timeout:8000,stdio:'ignore'});

// 1) 解包完整原版asar
console.log('\n1) 解包原版完整asar');
execSync('npx --yes @electron/asar extract "'+ORIG_ASAR+'" "'+UNPACK+'"',{encoding:'utf8',timeout:300000,stdio:['ignore','pipe','pipe']});
console.log('  ✅ 解包 '+fs.readdirSync(UNPACK).length+' 项');

// 2) 替换修改过的文件
console.log('\n2) 替换修改过的文件');
const files = [
  ['index.html'],
  ['cloud-api.js'],
  ['db-adapter.js'],
  ['electron','main.js'],
  ['electron','preload.js'],
  ['electron','activate-window.html'],  // ★ 激活窗口重新设计
  ['electron','activate.js'],            // ★ 激活逻辑增加密码+自动创建账户
  ['electron','login.html'],             // ★ 登录页标签改为手机号/用户名
  ['electron','login.js'],               // ★ 跳过注册向导
];
for (const parts of files) {
  const s = path.join(SRC, ...parts);
  const d = path.join(UNPACK, ...parts);
  if (!fs.existsSync(s)) { console.log('  ⚠ 源文件不存在: '+parts.join('/')); continue; }
  if (!fs.existsSync(d)) { console.log('  ⚠ 目标路径不存在: '+parts.join('/')); continue; }
  fs.copyFileSync(s, d);
  console.log('  ✅ '+parts.join('/')+' '+(fs.statSync(d).size>>10)+'KB');
}

// 3) 重新pack
console.log('\n3) 重新pack asar');
try { fs.rmSync(DIST,{recursive:true,force:true}); } catch {}
fs.mkdirSync(DIST,{recursive:true});
execSync('npx --yes @electron/asar pack "'+UNPACK+'" "'+OUT+'"',{encoding:'utf8',timeout:300000,stdio:['ignore','pipe','pipe']});
console.log('  ✅ 新asar: '+(fs.statSync(OUT).size>>10)+' KB');

// 4) 覆盖安装目录
console.log('\n4) 覆盖安装目录');
const dst = path.join(INST, 'resources', 'app.asar');
try { fs.copyFileSync(OUT, dst); console.log('  ✅ 直接覆盖OK'); }
catch(e) {
  try { if(fs.existsSync(dst)) fs.renameSync(dst,dst+'.old_'+Date.now()); fs.copyFileSync(OUT,dst); console.log('  ✅ rename→copy OK'); }
  catch(e2) { console.log('  💥 覆盖失败: '+e2.message); process.exit(1); }
}

// 5) 补YB.exe
console.log('\n5) 确保YB.exe存在');
const YB = path.join(INST,'惠康中医-YB.exe');
const YJ = path.join(INST,'惠康中医-YJ.exe');
if (!fs.existsSync(YB) && fs.existsSync(YJ)) { try { fs.copyFileSync(YJ,YB); console.log('  ✅ 复制YJ→YB'); } catch(e){ console.log('  ⚠ '+e.message); } }
else { console.log('  ✅ YB.exe已存在'); }

// 6) 启动
console.log('\n6) 启动 YB.exe');
if (fs.existsSync(YB)) {
  try { execSync('powershell -NoProfile -Command "Start-Process -FilePath \''+YB+'\'"',{timeout:15000,stdio:['ignore','ignore','ignore']}); console.log('  🚀 YB.exe 启动成功!'); }
  catch(e) { try { const c = spawn(YB,[],{detached:true,stdio:'ignore'}); c.unref(); console.log('  🚀 spawn OK'); } catch(e2){ console.log('  启动失败: '+e2.message); } }
}

console.log('\n=== 完成! 激活流程优化版已部署 ===');
console.log('修改内容:');
console.log('  ① 激活窗口：双Tab合并为单页表单，增加密码+确认密码字段');
console.log('  ② 激活码模式：折叠为"已有激活码？"链接');
console.log('  ③ 激活通过后：自动创建管理员账户（手机号=用户名，SHA256哈希密码）');
console.log('  ④ 登录页：跳过注册向导，标签改为"手机号/用户名"');
console.log('  ⑤ 轮询超时：不再resetForm死循环，显示友好提示');
console.log('\n👉 测试流程:');
console.log('  1. 删除config.json中的users数组（模拟首次激活）');
console.log('  2. 删除license.dat（模拟未激活）');
console.log('  3. 启动YB.exe → 激活窗口 → 填写诊所名+医师名+手机号+密码 → 提交');
console.log('  4. 管理员审核通过 → 自动激活 → 重启');
console.log('  5. 登录页直接显示，用手机号+密码登录（无需注册向导）');
setTimeout(()=>process.exit(0), 8000);
