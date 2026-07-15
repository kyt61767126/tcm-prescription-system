/**
 * APK 签名哈希获取工具
 *
 * 用法：
 *   1. 打包 APK 并安装到手机
 *   2. 手机连接电脑，确保 adb 可用
 *   3. 运行: node tools/get-apk-sign-hash.js
 *
 * 工具会：
 *   1. 清除 logcat
 *   2. 启动 APP（触发签名校验日志）
 *   3. 读取 logcat 中的 "签名首次锁定" 日志
 *   4. 输出签名哈希值
 *
 * 将获取的哈希值填入 MainActivity.java 的 expectedHash 即可启用严格模式
 */

const { execSync } = require('child_process');

// APP 包名映射
const PACKAGES = {
    'db-bendi': 'com.benneng.pres',
    'db-dingzhi': 'com.benneng.pres',
    'db-shouji': 'com.benneng.pres',
    'cloud_app': 'com.tcm.prescription'
};

console.log('\n========================================');
console.log('  APK 签名哈希获取工具');
console.log('========================================\n');

// 检查 adb
try {
    execSync('adb version', { stdio: 'pipe' });
} catch (e) {
    console.error('[ERROR] adb 未找到，请确保 Android SDK platform-tools 已安装并在 PATH 中');
    process.exit(1);
}

// 检查设备连接
try {
    const devices = execSync('adb devices', { encoding: 'utf8' });
    if (!devices.includes('\tdevice')) {
        console.error('[ERROR] 未检测到已连接的 Android 设备');
        console.error('请确保手机已通过 USB 连接并启用了 USB 调试');
        process.exit(1);
    }
    console.log('[OK] 设备已连接');
} catch (e) {
    console.error('[ERROR] 无法检测设备:', e.message);
    process.exit(1);
}

// 获取包名
const pkgArg = process.argv[2];
let packageName = null;

if (pkgArg && PACKAGES[pkgArg]) {
    packageName = PACKAGES[pkgArg];
} else {
    // 尝试自动检测已安装的包
    for (const [name, pkg] of Object.entries(PACKAGES)) {
        try {
            execSync(`adb shell pm list packages ${pkg}`, { stdio: 'pipe' });
            packageName = pkg;
            console.log(`[OK] 检测到已安装: ${name} (${pkg})`);
            break;
        } catch (e) {
            // 包未安装，继续检测
        }
    }
}

if (!packageName) {
    console.log('\n未自动检测到已安装的 APP，请指定版本:');
    console.log('  node tools/get-apk-sign-hash.js db-bendi');
    console.log('  node tools/get-apk-sign-hash.js db-dingzhi');
    console.log('  node tools/get-apk-sign-hash.js db-shouji');
    console.log('  node tools/get-apk-sign-hash.js cloud_app');
    process.exit(1);
}

console.log(`\n正在获取 ${packageName} 的签名哈希...\n`);

try {
    // 清除 logcat
    execSync('adb logcat -c', { stdio: 'pipe' });

    // 强制停止 APP
    execSync(`adb shell am force-stop ${packageName}`, { stdio: 'pipe' });

    // 启动 APP
    execSync(`adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`, { stdio: 'pipe' });

    // 等待 2 秒让 APP 启动
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    sleep(2000).then(() => {
        try {
            // 读取 logcat
            const log = execSync('adb logcat -d', { encoding: 'utf8' });

            // 查找签名哈希
            const match = log.match(/签名首次锁定:\s*([a-f0-9]{64})/);
            if (match) {
                console.log('========================================');
                console.log('  签名哈希获取成功！');
                console.log('========================================\n');
                console.log(`哈希值: ${match[1]}\n`);
                console.log('使用方法:');
                console.log('  1. 打开 MainActivity.java');
                console.log('  2. 找到 verifySignature() 方法');
                console.log('  3. 将 expectedHash = "" 改为:');
                console.log(`     String expectedHash = "${match[1]}";`);
                console.log('  4. 重新打包 APK\n');
                console.log('注意: 首次锁定模式已提供基础防护，严格模式可防止清除数据后重置。');
            } else {
                // 检查是否有签名校验失败日志
                const failMatch = log.match(/签名校验失败.*actual=([a-f0-9]{64})/);
                if (failMatch) {
                    console.log('========================================');
                    console.log('  检测到签名校验失败！');
                    console.log('========================================\n');
                    console.log(`当前签名哈希: ${failMatch[1]}\n`);
                    console.log('这说明 APP 可能被二次打包，或之前锁定的签名与当前不一致。');
                    console.log('如需更新锁定签名，请清除 APP 数据后重新运行此工具。');
                } else {
                    console.log('[WARN] 未在 logcat 中找到签名哈希日志');
                    console.log('可能原因:');
                    console.log('  1. APP 未正确启动');
                    console.log('  2. 签名校验代码未包含在此版本中');
                    console.log('  3. 已经锁定过签名（非首次运行）');
                    console.log('\n请尝试清除 APP 数据后重新运行:');
                    console.log(`  adb shell pm clear ${packageName}`);
                    console.log(`  node tools/get-apk-sign-hash.js ${pkgArg || ''}`);
                }
            }
        } catch (e) {
            console.error('[ERROR] 读取 logcat 失败:', e.message);
        }
    });
} catch (e) {
    console.error('[ERROR] 操作失败:', e.message);
}
