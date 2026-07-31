#!/usr/bin/env node
// ============================================================================
// minify-js.js — 离线APP JS代码混淆脚本（P0-3安全防护）
//
// 功能：使用 terser 压缩+混淆 assets/public/ 下的所有 JS 文件
// 安全：保留全局变量名和函数名（index.html 内联JS依赖外部JS的全局函数）
// 效果：删除注释+压缩空白+混淆局部变量名，显著增加反编译逆向难度
//
// 用法：node minify-js.js <target_dir>
// 示例：node minify-js.js android/app/src/main/assets/public
// ============================================================================

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// terser 动态加载（首次运行会自动安装到全局缓存）
let terser;
try {
    terser = require('terser');
} catch (e) {
    console.error('[minify] terser 未安装，正在通过 npx 安装...');
    // 如果 terser 不在 node_modules 中，尝试通过 npx 运行
    const { execSync } = require('child_process');
    try {
        execSync('npm install terser --no-save --prefix "' + path.join(__dirname, '..') + '"', { stdio: 'inherit' });
        terser = require(path.join(__dirname, '..', 'node_modules', 'terser'));
    } catch (installErr) {
        console.error('[minify] terser 安装失败，跳过混淆:', installErr.message);
        console.error('[minify] 请手动运行: npm install -g terser');
        process.exit(0); // 不阻断打包
    }
}

// 跳过的文件列表（自动生成或特殊文件）
const SKIP_FILES = [
    'build-time.js',      // 自动生成的构建时间戳
    'afterPack.js',       // Electron 打包钩子脚本
];

// terser 混淆配置
const TERSER_OPTIONS = {
    compress: {
        drop_console: false,    // 保留 console.log（调试需要）
        drop_debugger: true,    // 删除 debugger 语句
        dead_code: true,        // 删除不可达代码
        unused: true,           // 删除未使用的变量
    },
    mangle: {
        toplevel: false,        // ★ 不混淆全局变量名（index.html 依赖外部JS全局函数）
        keep_classnames: true,  // 保留类名（避免反射问题）
        keep_fnames: true,      // 保留函数名（避免 index.html 调用失败）
    },
    format: {
        comments: false,        // 删除所有注释
        beautify: false,        // 不美化输出
    },
    sourceMap: false,           // 不生成 source map（安全考虑）
};

function minifyFile(filePath) {
    const fileName = path.basename(filePath);
    const stat = fs.statSync(filePath);
    const originalSize = stat.size;

    try {
        const code = fs.readFileSync(filePath, 'utf8');

        // 跳过空文件或过小文件
        if (code.trim().length < 50) {
            console.log('  [SKIP] ' + fileName + ' (太小，无需混淆)');
            return { skipped: true };
        }

        const result = terser.minify(code, TERSER_OPTIONS);

        if (result.error) {
            console.warn('  [WARN] ' + fileName + ' 混淆失败: ' + result.error.message);
            return { skipped: true };
        }

        if (!result.code || result.code.length >= originalSize) {
            console.log('  [SKIP] ' + fileName + ' (压缩后无改善)');
            return { skipped: true };
        }

        // 写入混淆后的代码
        fs.writeFileSync(filePath, result.code, 'utf8');
        const newSize = result.code.length;
        const ratio = ((1 - newSize / originalSize) * 100).toFixed(1);
        console.log('  [OK]   ' + fileName + ' ' + originalSize + 'B -> ' + newSize + 'B (-' + ratio + '%)');

        return { skipped: false, originalSize, newSize };
    } catch (e) {
        console.warn('  [WARN] ' + fileName + ' 处理异常: ' + e.message);
        return { skipped: true };
    }
}

function main() {
    const targetDir = process.argv[2];
    if (!targetDir) {
        console.error('[minify] 用法: node minify-js.js <target_dir>');
        process.exit(1);
    }

    const absDir = path.resolve(targetDir);
    if (!fs.existsSync(absDir)) {
        console.error('[minify] 目录不存在: ' + absDir);
        process.exit(1);
    }

    console.log('[minify] 开始混淆 JS 文件: ' + absDir);

    const files = fs.readdirSync(absDir).filter(f => f.endsWith('.js'));
    let totalOriginal = 0;
    let totalMinified = 0;
    let count = 0;

    for (const file of files) {
        if (SKIP_FILES.includes(file)) {
            console.log('  [SKIP] ' + file + ' (在跳过列表中)');
            continue;
        }
        const result = minifyFile(path.join(absDir, file));
        if (!result.skipped) {
            totalOriginal += result.originalSize;
            totalMinified += result.newSize;
            count++;
        }
    }

    if (count > 0) {
        const totalRatio = ((1 - totalMinified / totalOriginal) * 100).toFixed(1);
        console.log('[minify] 完成: ' + count + ' 个文件, ' +
            (totalOriginal / 1024).toFixed(1) + 'KB -> ' +
            (totalMinified / 1024).toFixed(1) + 'KB (-' + totalRatio + '%)');
    } else {
        console.log('[minify] 无文件需要混淆');
    }
}

main();
