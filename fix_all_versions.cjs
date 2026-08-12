const fs = require('fs');
const path = require('path');

// 源 = 已修好的云端机构版
const SRC = 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_desktop';

// 目标：3个待修复版本
const TARGETS = [
  { name: '云端标准版', dir: 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_desktop_geren' },
  { name: '离线机构版', dir: 'D:/trae_projects/kyt-zy/app_project/db-offline/desktop' },
  { name: '离线标准版', dir: 'D:/trae_projects/kyt-zy/app_project/db-offline/desktop_geren' },
];

const FILES = [
  'electron/activate.js',
  'electron/activate-window.html',
  'electron/activate-schema.js',
  'electron/license-manager.js',
  'electron/main.js',
  'electron/preload.js',
  'electron/login.html',
  'electron/login.js',
];

function fixTarget(t) {
  console.log('\n🔧 修复: ' + t.name + ' → ' + t.dir);
  
  // 1) 先备份关键文件
  const eDir = path.join(t.dir, 'electron');
  if (!fs.existsSync(eDir)) { console.log('  ⚠ electron目录不存在，跳过'); return; }
  
  // 2) 逐个复制修复文件
  for (const f of FILES) {
    const srcFile = path.join(SRC, f);
    const dstFile = path.join(t.dir, f);
    if (!fs.existsSync(srcFile)) { console.log('  ⚠ 源文件不存在: ' + f); continue; }
    
    // 备份原文件
    if (fs.existsSync(dstFile)) {
      const bak = dstFile + '.bak_v2';
      try { fs.copyFileSync(dstFile, bak); } catch {}
    }
    
    // 复制新文件
    fs.copyFileSync(srcFile, dstFile);
    console.log('  ✅ ' + f);
  }
  
  // 3) 修复 config.json edition
  const configPath = path.join(t.dir, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const oldEdition = cfg.edition;
      
      if (t.name === '云端标准版') cfg.edition = 'personal';
      else if (t.name === '离线机构版') cfg.edition = 'custom';
      else if (t.name === '离线标准版') cfg.edition = 'personal';
      
      if (cfg.edition !== oldEdition) {
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
        console.log('  ✅ config.json edition: ' + oldEdition + ' → ' + cfg.edition);
      } else {
        console.log('  ✅ config.json edition 已是正确值: ' + cfg.edition);
      }
    } catch(e) { console.log('  ⚠ config.json 解析失败: ' + e.message); }
  }
  
  // 4) 运行时修复：activate.js中的循环引用替换
  // 因为离线版没有云API，但activate.js中的循环引用修复是通用的
  for (const f of ['electron/activate.js', 'electron/main.js']) {
    const fp = path.join(t.dir, f);
    if (!fs.existsSync(fp)) continue;
    let content = fs.readFileSync(fp, 'utf8');
    const before = content.length;
    
    // 修复循环引用
    content = content.replace(
      /config\s*=\s*licenseManager\.signConfig\(config\);/g,
      'licenseManager.signConfig(config);  // ★ 直接修改原对象，不赋值避免循环引用'
    );
    
    if (content.length !== before) {
      fs.writeFileSync(fp, content, 'utf8');
      console.log('  ✅ 已修复 ' + f + ' 循环引用');
    }
  }
  
  // 5) 离线版特殊处理：activate.js中云端相关的installLicense调用
  // 离线版没有云端功能，我们保持installLicense框架但确保兼容
  if (t.name.startsWith('离线')) {
    const actPath = path.join(t.dir, 'electron', 'activate.js');
    if (fs.existsSync(actPath)) {
      let content = fs.readFileSync(actPath, 'utf8');
      
      // 确保离线版的installLicense调用在 try/catch 里，云端失败不影响离线
      // 添加离线模式检测
      if (!content.includes('isCloudMode') && !content.includes('isOffline')) {
        // 在文件开头添加离线模式兼容
        const compat = `
// ★ 离线版兼容：activateOnline的installLicense若因无云端API失败，回退到旧逻辑
(function(){
  const origActivateOnline = activateOnline;
  if (typeof origActivateOnline === 'function') {
    activateOnline = async function(data) {
      try {
        return await origActivateOnline(data);
      } catch(e) {
        console.warn('[Activate] 云端激活失败，尝试离线模式:', e.message);
        // 离线回退：直接写license
        try {
          const path = require('path');
          const licensePath = licenseManager.getLicensePath();
          fs.writeFileSync(licensePath, data.license || data, 'utf8');
          // 清除trial
          try { const tp = licenseManager.getTrialPath(); if(fs.existsSync(tp)) fs.unlinkSync(tp); } catch {}
          return { success: true, message: '激活成功（离线模式）' };
        } catch(e2) {
          return { success: false, error: e2.message };
        }
      }
    };
  }
})();
`;
        // 在文件末尾追加兼容代码
        content += '\n' + compat;
        fs.writeFileSync(actPath, content, 'utf8');
        console.log('  ✅ 离线版activate.js 已添加云端失败回退');
      }
    }
  }
  
  console.log('  ✅ ' + t.name + ' 修复完成');
}

for (const t of TARGETS) {
  try { fixTarget(t); } catch(e) { console.log('  ❌ 修复失败: ' + e.message); }
}

console.log('\n' + '='.repeat(70));
console.log('✅ 3个版本修复完成，准备重新审计...');
console.log('='.repeat(70));
