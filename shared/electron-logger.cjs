// ============================================================================
// electron-logger.cjs — Electron 主进程滚动文件日志（P0-[6.3] logger 统一+日志滚动）
//
// 职责：
//   1. 统一主进程日志入口：console + 文件双写（userData/logs/app.log）
//   2. 日志滚动：app.log 达到 2MB 自动轮转，保留最近 5 份（app.log.1 ~ app.log.5）
//   3. 脱敏：password/token/activationCode 等敏感字段值统一打码，防泄露
//   4. 崩溃日志复用同一滚动文件（替代旧的"每崩溃一个文件"方案，防止日志无限累积）
//
// 说明：文件名用 .cjs 后缀，确保在任意 package.json 作用域（含根目录 type:module）
//       下都按 CommonJS 解析，避免 require 返回空对象。
//
// 用法：
//   const logger = require('./electron-logger.cjs');
//   logger.info('module', 'action', { ... });   // 业务日志
//   logger.warn('module', 'action', 'msg');
//   logger.error('module', 'action', errOrMsg);
//   logger.crash('uncaughtException', err);     // 崩溃专用（含 stack）
// ============================================================================
'use strict';

const path = require('path');
const fs = require('fs');

const MAX_LOG_SIZE = 2 * 1024 * 1024;   // 2 MB
const MAX_ROTATE_FILES = 5;              // app.log + app.log.1 ~ app.log.5

// 敏感字段名（键名匹配，值统一打码；不匹配具体值避免误伤）
const SENSITIVE_KEY_RE = /(password|pwd|passwd|token|secret|activation|authcode|auth_code|apikey|api_key|accesskey|access_key|cookie|credential|authorization|signature|privatekey|private_key)/i;

function getLogDir() {
    // 惰性获取 userData（app 模块在主进程可用后再 require）
    let userData;
    try {
        const { app } = require('electron');
        userData = app.getPath('userData');
    } catch (e) {
        userData = process.env.APPDATA || os_tmp();
    }
    return path.join(userData, 'logs');
}

function os_tmp() {
    try { return require('os').tmpdir(); } catch (e) { return '.'; }
}

// 递归脱敏：对象/数组按敏感键打码，字符串按常见密钥格式打码
function redact(value, depth) {
    depth = depth || 0;
    if (depth > 6) return '[depth]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(v => redact(v, depth + 1));
    }
    if (typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) {
            if (SENSITIVE_KEY_RE.test(k)) {
                const v = value[k];
                out[k] = (v === null || v === undefined) ? v : '***';
            } else {
                out[k] = redact(value[k], depth + 1);
            }
        }
        return out;
    }
    return value;
}

function rotateIfNeeded(logPath) {
    try {
        const st = fs.statSync(logPath);
        if (!st || st.size < MAX_LOG_SIZE) return;
        const dir = path.dirname(logPath);
        // 删除最旧
        const oldest = path.join(dir, 'app.log.' + MAX_ROTATE_FILES);
        if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
        // 依次后移 app.log.(n) -> app.log.(n+1)
        for (let i = MAX_ROTATE_FILES - 1; i >= 1; i--) {
            const from = path.join(dir, 'app.log.' + i);
            const to = path.join(dir, 'app.log.' + (i + 1));
            if (fs.existsSync(from)) fs.renameSync(from, to);
        }
        fs.renameSync(logPath, path.join(dir, 'app.log.1'));
    } catch (e) {
        // 轮转失败不阻塞业务
    }
}

function write(level, module, action, data) {
    const ts = new Date().toISOString();
    let payload = data;
    if (data instanceof Error) {
        payload = { message: data.message, stack: data.stack };
    } else if (typeof data === 'string') {
        payload = data;
    }
    let line;
    try {
        line = JSON.stringify({
            ts: ts,
            level: level,
            module: module,
            action: action,
            data: redact(payload)
        });
    } catch (e) {
        line = JSON.stringify({ ts: ts, level: level, module: module, action: action, data: String(payload) });
    }
    line += os_eol();

    // console 镜像（主进程控制台，便于开发期观察）
    if (level === 'ERROR') console.error('[electron-logger][' + module + '] ' + action, payload);
    else if (level === 'WARN') console.warn('[electron-logger][' + module + '] ' + action, payload);
    else console.log('[electron-logger][' + module + '] ' + action, payload);

    // 文件写入（滚动）
    try {
        const dir = getLogDir();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const logPath = path.join(dir, 'app.log');
        rotateIfNeeded(logPath);
        fs.appendFileSync(logPath, line, 'utf8');
    } catch (e) {
        // 文件写失败仅控制台，不抛异常影响业务
    }
}

function os_eol() {
    return process.platform === 'win32' ? '\r\n' : '\n';
}

module.exports = {
    info: function (module, action, data) { write('INFO', module, action, data); },
    warn: function (module, action, data) { write('WARN', module, action, data); },
    error: function (module, action, data) { write('ERROR', module, action, data); },
    crash: function (type, err) { write('CRASH', 'crash', type, err); },
    redact: redact
};
