// ============================================================================
//  E2E 专用旁路 —— 模板（★ 不在打包 files 白名单内，永不进正式包）
//
//  用途：build.bat 在 Phase 1 打包前把本文件复制为 electron/e2e-bypass.cjs，
//        让 Playwright E2E 能拿回远程调试、隔离 userData、跳过试用登记；
//        E2E 通过后 build.bat 删除该副本并重新打包 asar，
//        因此正式安装包/便携包里既没有 e2e-enabled.marker 判定、
//        也没有 BNZC_E2E 环境变量判定，不存在可被外部构造的旁路。
//
//  安全边界（2026-11-12 P1-1）：
//   · 本文件只在构建机存在，且只在 E2E 阶段被复制进 electron/；
//   · 正式包 require('./e2e-bypass.cjs') 会抛 MODULE_NOT_FOUND，被 main.js 吞掉；
//   · 全局标志 __BNZC_E2E_BYPASS 在正式包内永远为 undefined。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function installE2EBypass(app) {
    try {
        if (process.env.BNZC_E2E !== '1') return false;

        let markerPath;
        try {
            markerPath = path.join(path.dirname(process.execPath), 'e2e-enabled.marker');
        } catch (e) {
            return false;
        }
        if (!fs.existsSync(markerPath)) return false;

        // 全局标志：license 的 debugger 检测、试用登记、完整性上报据此刻意跳过
        global.__BNZC_E2E_BYPASS = true;
        console.warn('[E2E] 命中 e2e 旁路（BNZC_E2E=1 + marker），放行远程调试');

        // 隔离 userData，避免 E2E 读写污染真实数据目录
        if (process.env.BNZC_E2E_DATA) {
            try {
                fs.mkdirSync(process.env.BNZC_E2E_DATA, { recursive: true });
                app.setPath('userData', process.env.BNZC_E2E_DATA);
                console.warn('[E2E] userData 已隔离至: ' + process.env.BNZC_E2E_DATA);
            } catch (e) {
                console.warn('[E2E] userData 隔离失败:', e.message);
            }
        }
        return true;
    } catch (e) {
        return false;
    }
};
