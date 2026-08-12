const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const SRC = 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_desktop';
const ORIG_ASAR = path.join(SRC, 'dist', 'win-unpacked', 'resources', 'app.asar');
const UNPACK = path.join(os.tmpdir(), 'final3_'+Date.now());
const DIST = path.join(SRC, 'dist_final3');
const OUT = path.join(DIST, 'app.asar');
const INST = 'D:/Program Files/tcm-prescription-cloud';
const UD = path.join(os.homedir(),'AppData','Roaming','tcm-prescription-cloud');

console.log('0) kill YB');
function kill(n) { try { execSync('taskkill /F /IM "'+n+'" /T 2>nul',{timeout:8000,stdio:['ignore','ignore','ignore']}); } catch {} }
kill('惠康中医-YB.exe'); kill('惠康中医-YJ.exe');
execSync('powershell Start-Sleep -Seconds 2',{timeout:8000,stdio:'ignore'});

console.log('1) 清理旧乱码缓存');
const idbDir = path.join(UD, 'Partitions', 'tcm-prescription-dingzhi', 'IndexedDB');
if (fs.existsSync(idbDir)) { try { fs.rmSync(idbDir, {recursive:true,force:true}); console.log('  del IndexedDB'); } catch(e){} }
const idbDefault = path.join(UD, 'IndexedDB');
if (fs.existsSync(idbDefault)) { try { fs.rmSync(idbDefault, {recursive:true,force:true}); console.log('  del default IndexedDB'); } catch(e){} }
const lsDir = path.join(UD, 'Partitions', 'tcm-prescription-dingzhi', 'Local Storage', 'leveldb');
if (fs.existsSync(lsDir)) { try { fs.rmSync(lsDir, {recursive:true,force:true}); console.log('  del LocalStorage leveldb'); } catch(e){} }
const lsDefault = path.join(UD, 'Local Storage', 'leveldb');
if (fs.existsSync(lsDefault)) { try { fs.rmSync(lsDefault, {recursive:true,force:true}); console.log('  del default LocalStorage'); } catch(e){} }

console.log('\n2) 解包完整asar → 替换5文件 → repack');
execSync('npx --yes @electron/asar extract "'+ORIG_ASAR+'" "'+UNPACK+'"',{encoding:'utf8',timeout:300000,stdio:['ignore','pipe','pipe']});
console.log('  unpack '+fs.readdirSync(UNPACK).length+' items');
for (const parts of [['index.html'],['cloud-api.js'],['db-adapter.js'],['electron','main.js'],['electron','preload.js']]) {
  fs.copyFileSync(path.join(SRC, ...parts), path.join(UNPACK, ...parts));
}
console.log('  replaced 5 files');
try { fs.rmSync(DIST,{recursive:true,force:true}); } catch {}
fs.mkdirSync(DIST,{recursive:true});
execSync('npx --yes @electron/asar pack "'+UNPACK+'" "'+OUT+'"',{encoding:'utf8',timeout:300000,stdio:['ignore','pipe','pipe']});
console.log('  new asar: '+(fs.statSync(OUT).size>>10)+' KB');

console.log('\n3) 覆盖安装目录');
const dst = path.join(INST, 'resources', 'app.asar');
try { fs.copyFileSync(OUT, dst); console.log('  copy OK'); }
catch(e) { try { if(fs.existsSync(dst)) fs.renameSync(dst,dst+'.old_'+Date.now()); fs.copyFileSync(OUT,dst); console.log('  rename->copy OK'); } catch(e2){ console.log('  FAIL '+e2.message); process.exit(1); } }

console.log('\n4) 启动 YB');
const YB = path.join(INST,'惠康中医-YB.exe');
const YJ = path.join(INST,'惠康中医-YJ.exe');
if (!fs.existsSync(YB) && fs.existsSync(YJ)) { try { fs.copyFileSync(YJ,YB); } catch{} }
if (fs.existsSync(YB)) {
  try { execSync('powershell -NoProfile -Command "Start-Process -FilePath \''+YB+'\'"',{timeout:15000,stdio:['ignore','ignore','ignore']}); console.log('  YB started'); }
  catch(e) { try { const c = spawn(YB,[],{detached:true,stdio:'ignore'}); c.unref(); console.log('  spawn OK'); } catch(e2){ console.log('  fail: '+e2.message); } }
}
console.log('\nDONE! Login wgj/123456');
setTimeout(()=>process.exit(0), 8000);
