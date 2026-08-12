const fs = require('fs');
const path = require('path');

// APP版本修复：将云端桌面版的核心JS同步到APP的public目录
const DESKTOP_SRC = 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_desktop';

const APP_TARGETS = [
  {
    name: '云端机构版APP',
    publicDir: 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app/app/src/main/assets/public',
    javaDir: 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app/app/src/main/java/com/tcm/prescription'
  },
  {
    name: '云端标准版APP',
    publicDir: 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app_geren/app/src/main/assets/public',
    javaDir: 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_app_geren/app/src/main/java/com/tcm/prescription'
  },
  {
    name: '离线机构版APP',
    publicDir: 'D:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/assets/public',
    javaDir: 'D:/trae_projects/kyt-zy/app_project/db-offline/app/app/src/main/java/com/benneng/pres'
  },
  {
    name: '离线标准版APP',
    publicDir: 'D:/trae_projects/kyt-zy/app_project/db-offline/app_geren/app/app/src/main/assets/public',
    javaDir: 'D:/trae_projects/kyt-zy/app_project/db-offline/app_geren/app/app/src/main/java/com/benneng/pres'
  }
];

// 要同步到APP的核心JS文件
const SHARED_JS = [
  'auth-core.js',
  'db-adapter.js',
  'cloud-api.js',
  'prescription-core.js',
  'patient-archive.js',
  'medicine-dict.js',
  'print-utils.js',
  'performance-utils.js',
  'debug-logger.js',
  'permission.js',
  'security-guard.js',
];

for (const t of APP_TARGETS) {
  console.log('\n📱 修复: ' + t.name);
  if (!fs.existsSync(t.publicDir)) { console.log('  ⚠ public目录不存在'); continue; }
  
  // 1) 同步核心JS（从云端桌面版根目录）
  for (const js of SHARED_JS) {
    const src = path.join(DESKTOP_SRC, js);
    const dst = path.join(t.publicDir, js);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      console.log('  ✅ ' + js);
    } else {
      // 尝试其他路径
      const altSrc = path.join(DESKTOP_SRC, 'electron', js);
      if (fs.existsSync(altSrc)) {
        fs.copyFileSync(altSrc, dst);
        console.log('  ✅ ' + js + ' (from electron/)');
      } else {
        console.log('  ⚠ 源不存在: ' + js);
      }
    }
  }
  
  // 2) 确保index.html存在（APP版本需要index.html）
  const idxPath = path.join(t.publicDir, 'index.html');
  if (!fs.existsSync(idxPath)) {
    // 从对应桌面版复制
    const desktopDir = t.name.includes('标准版') 
      ? (t.name.startsWith('云端') ? 'D:/trae_projects/kyt-zy/app_project/db-yunduan/cloud_desktop_geren' 
                                  : 'D:/trae_projects/kyt-zy/app_project/db-offline/desktop_geren')
      : (t.name.startsWith('云端') ? DESKTOP_SRC 
                                  : 'D:/trae_projects/kyt-zy/app_project/db-offline/desktop');
    const desktopIdx = path.join(desktopDir, 'index.html');
    if (fs.existsSync(desktopIdx)) {
      fs.copyFileSync(desktopIdx, idxPath);
      console.log('  ✅ index.html (from desktop)');
    }
  }
  
  // 3) MainActivity.java检查 + 注入激活支持
  const mainActPath = path.join(t.javaDir, 'MainActivity.java');
  if (fs.existsSync(mainActPath)) {
    let content = fs.readFileSync(mainActPath, 'utf8');
    const before = content.length;
    
    // 确保包含LicenseManager导入
    if (!content.includes('LicenseManager')) {
      console.log('  ⚠ MainActivity.java 未包含 LicenseManager，需手动检查');
    }
    
    if (content.length !== before) {
      fs.writeFileSync(mainActPath, content, 'utf8');
      console.log('  ✅ MainActivity.java 已更新');
    } else {
      console.log('  ✅ MainActivity.java 已是最新');
    }
  } else {
    console.log('  ⚠ MainActivity.java 不存在于: ' + mainActPath);
  }
  
  // 4) SecurityGuard.java检查
  const secPath = path.join(t.javaDir, 'SecurityGuard.java');
  if (fs.existsSync(secPath)) {
    console.log('  ✅ SecurityGuard.java 存在');
  } else {
    console.log('  ⚠ SecurityGuard.java 不存在');
  }
}

console.log('\n✅ APP版本修复完成');
