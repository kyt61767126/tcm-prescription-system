/**
 * 离线APP录像拍照注入脚本
 *
 * 功能：
 * 1. 注入 window.electronAPI shim（调用 AndroidNative 桥接）
 * 2. 注入 CSS 样式（overlay/modal/toast）
 * 3. 实现录像 overlay（摄像头预览、录制控制、前后摄像头切换）
 * 4. 实现拍照 overlay（舌诊拍照，两步采集：舌面+舌下络脉）
 * 5. 保存到本地文件系统（按月份分类 YYYY-MM）
 *
 * 注意：拍照/录像按钮由网页 ActionBar 组件渲染，本脚本仅提供 overlay 和保存功能。
 * ActionBar 通过 window.openPhotoOverlay() / window.openRecordingOverlay() 调用本脚本。
 *
 * 保存路径（图片视频统一目录，方便导出）：
 *   Pictures/惠康中医处方/YYYY-MM/患者姓名_处方编号_photo.png
 *   Pictures/惠康中医处方/YYYY-MM/患者姓名_处方编号_video.webm
 */
(function () {
    'use strict';
    if (window.__videoRecorderInjected) return;
    window.__videoRecorderInjected = true;

    // ========================================================================
    // 1. 注入 window.electronAPI shim
    // ========================================================================
    function injectElectronAPIShim() {
        var N = window.AndroidNative;
        if (!N) {
            console.warn('[离线APP] AndroidNative 桥接未找到');
            return false;
        }

        function P(v) { return Promise.resolve(v); }
        function callNative(name, json) {
            try {
                var result = N.invoke(name, json || '{}');
                if (typeof result !== 'string' || result.length === 0) {
                    console.error('[离线APP] NativeBridge.' + name + ' 返回非字符串:', typeof result, result);
                    return { success: false, error: 'NativeBridge 返回无效（Java端可能抛异常）' };
                }
                console.log('[离线APP] NativeBridge.' + name + ' 返回长度:', result.length);
                return JSON.parse(result);
            } catch (e) {
                console.error('[离线APP] NativeBridge.' + name + ' 调用异常:', e);
                return { success: false, error: String(e) };
            }
        }

        // Uint8Array → base64 编码（避免 btoa 不支持 >127 字节的问题）
        // btoa 只支持 ASCII 字符（0-127），视频二进制数据包含 >127 的字节会失败
        var _base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        function _uint8ArrayToBase64(bytes) {
            var len = bytes.length;
            var base64 = '';
            var i = 0;
            while (i < len) {
                var b1 = bytes[i++] || 0;
                var b2 = i < len ? bytes[i++] : 0;
                var b3 = i < len ? bytes[i++] : 0;
                var group = (b1 << 16) | (b2 << 8) | b3;
                base64 += _base64Chars[(group >> 18) & 0x3F];
                base64 += _base64Chars[(group >> 12) & 0x3F];
                base64 += _base64Chars[(group >> 6) & 0x3F];
                base64 += _base64Chars[group & 0x3F];
            }
            var padLen = (3 - (len % 3)) % 3;
            if (padLen > 0) {
                base64 = base64.substring(0, base64.length - padLen) + '=='.substring(0, padLen);
            }
            return base64;
        }

        // 分片上传：解决 Binder 事务 1MB 限制
        // ★ 优化：分片大小从 256KB 提升到 512KB，减少分片次数约 50%，提升整体传输速度
        // 512KB base64 解码后约 384KB，加 JSON 包装仍远低于 1MB Binder 限制，安全可靠
        var CHUNK_SIZE = 512 * 1024; // 512KB 一片（base64 解码后 384KB，加 JSON 包装远低于 1MB）
        function chunkedUpload(base64Data, fileName, type) {
            return new Promise(function (resolve) {
                var startR = callNative('startMediaSession', JSON.stringify({ fileName: fileName }));
                if (!startR || !startR.success) {
                    resolve(startR || { success: false, error: 'startMediaSession 返回无效' });
                    return;
                }
                var sessionId = startR.sessionId;
                var total = Math.ceil(base64Data.length / CHUNK_SIZE);
                var idx = 0;

                function nextChunk() {
                    if (idx >= total) {
                        var commitR = callNative('commitMediaSession', JSON.stringify({
                            sessionId: sessionId,
                            fileName: fileName,
                            type: type
                        }));
                        resolve(commitR);
                        return;
                    }
                    var chunk = base64Data.substring(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE);
                    var r = callNative('appendMediaChunk', JSON.stringify({
                        sessionId: sessionId,
                        chunkBase64: chunk,
                        index: idx,
                        total: total
                    }));
                    if (!r || !r.success) {
                        resolve(r || { success: false, error: 'appendMediaChunk 返回无效' });
                        return;
                    }
                    idx++;
                    setTimeout(nextChunk, 0);
                }
                nextChunk();
            });
        }

        // 保存旧引用（如果 injectElectronApiShim 已抢先注入简单版本）
        var oldAPI = window.electronAPI;

        window.electronAPI = {
            __injected: true,
            isElectron: true,
            saveUserData: function (k, d) { return P({ success: true }); },
            getUserData: function (k) { return P({ success: false, data: null }); },
            saveBackupFile: function (jsonStr, fileName) {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('saveBackupFile', JSON.stringify({ jsonStr: jsonStr, fileName: fileName }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            savePrescriptionImage: function (imageData, fileName) {
                return new Promise(function (resolve) {
                    try {
                        var base64 = imageData;
                        var commaIdx = base64.indexOf(',');
                        if (base64.indexOf('data:') === 0 && commaIdx > 0 && commaIdx < 50) {
                            base64 = base64.substring(commaIdx + 1);
                        }
                        if (base64.length >= 512 * 1024) {
                            console.log('[离线APP] 图片分片上传: ' + base64.length + ' 字节');
                            chunkedUpload(base64, fileName, 'image').then(resolve);
                        } else {
                            var r = callNative('savePrescriptionImage', JSON.stringify({ imageData: imageData, fileName: fileName }));
                            resolve(r);
                        }
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            saveVideoFile: function (arrayBuffer, fileName) {
                return new Promise(function (resolve) {
                    try {
                        var bytes = new Uint8Array(arrayBuffer);
                        // ★ 优化：用 _uint8ArrayToBase64 代替 btoa
                        // 1. btoa 不支持 >127 字节，视频二进制数据会失败
                        // 2. _uint8ArrayToBase64 直接按位计算，省去 String.fromCharCode.apply + btoa 两步开销
                        var base64Data = _uint8ArrayToBase64(bytes);
                        console.log('[离线APP] 视频总大小: ' + base64Data.length + ' 字节 base64');
                        // ★ 优化：小文件（<512KB 原始，base64 后约 683KB）直接走原生 API，避免分片开销
                        // 加 JSON 包装后约 700KB，远低于 1MB Binder 限制，安全可靠
                        if (bytes.length < 512 * 1024) {
                            var r = callNative('saveVideoFile', JSON.stringify({
                                base64Data: base64Data,
                                fileName: fileName
                            }));
                            resolve(r);
                        } else {
                            // 大视频走分片上传
                            chunkedUpload(base64Data, fileName, 'video').then(resolve);
                        }
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            getVideoDirectory: function () {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('getVideoDirectory', '{}');
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            findMediaFiles: function (patientName, prescriptionNo, createdAt) {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('findMediaFiles', JSON.stringify({ patientName: patientName, prescriptionNo: prescriptionNo, createdAt: createdAt || '' }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e), files: [] }); }
                });
            },
            openFile: function (filePath, mimeType) {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('openFile', JSON.stringify({ filePath: filePath, mimeType: mimeType || '' }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            readFileAsBase64: function (filePath) {
                // 统一走分片读取，避免 Binder 1MB 限制
                // 最终用 base64 data URL（Blob URL 在 file:// 协议下不稳定）
                // 使用自定义 Uint8Array → base64 函数，避免 btoa 不支持 >127 字节的问题
                return new Promise(function (resolve) {
                    try {
                        var startR = callNative('startReadSession', JSON.stringify({ filePath: filePath }));
                        if (!startR || !startR.success) {
                            console.error('[离线APP] startReadSession 失败:', startR && startR.error);
                            resolve({ success: false, error: 'startReadSession 失败: ' + (startR && startR.error || '未知') });
                            return;
                        }
                        var sessionId = startR.sessionId;
                        var mimeType = startR.mimeType || 'application/octet-stream';
                        var fileSize = startR.fileSize || 0;
                        console.log('[离线APP] 分片读取文件: ' + filePath + ', 大小=' + fileSize + ', mime=' + mimeType);
                        var uint8Arrays = [];
                        var totalBytes = 0;
                        var chunkRetryCount = 0;
                        var MAX_CHUNK_RETRY = 2;

                        function nextChunk() {
                            var r = callNative('readNextChunk', JSON.stringify({ sessionId: sessionId }));
                            if (!r || !r.success) {
                                if (chunkRetryCount < MAX_CHUNK_RETRY) {
                                    chunkRetryCount++;
                                    console.warn('[离线APP] readNextChunk 失败，重试 ' + chunkRetryCount + '/' + MAX_CHUNK_RETRY + ':', r && r.error);
                                    setTimeout(nextChunk, 50);
                                    return;
                                }
                                callNative('closeReadSession', JSON.stringify({ sessionId: sessionId }));
                                console.error('[离线APP] readNextChunk 最终失败:', r && r.error);
                                resolve(r || { success: false, error: 'readNextChunk 返回无效' });
                                return;
                            }
                            chunkRetryCount = 0;
                            if (r.chunk) {
                                try {
                                    var binary = atob(r.chunk);
                                    var len = binary.length;
                                    var bytes = new Uint8Array(len);
                                    for (var i = 0; i < len; i++) {
                                        bytes[i] = binary.charCodeAt(i);
                                    }
                                    uint8Arrays.push(bytes);
                                    totalBytes += len;
                                } catch (e) {
                                    console.error('[离线APP] base64 解码失败:', e);
                                }
                            }
                            if (r.eof) {
                                callNative('closeReadSession', JSON.stringify({ sessionId: sessionId }));
                                try {
                                    // 合并所有 Uint8Array
                                    var allBytes = new Uint8Array(totalBytes);
                                    var offset = 0;
                                    for (var j = 0; j < uint8Arrays.length; j++) {
                                        allBytes.set(uint8Arrays[j], offset);
                                        offset += uint8Arrays[j].length;
                                    }
                                    // 用自定义 base64 编码函数（避免 btoa 不支持 >127 字节）
                                    var fullBase64 = _uint8ArrayToBase64(allBytes);
                                    var dataUrl = 'data:' + mimeType + ';base64,' + fullBase64;
                                    console.log('[离线APP] 分片读取完成，data URL 长度=' + dataUrl.length + ', 片数=' + uint8Arrays.length + ', 总字节=' + totalBytes);
                                    resolve({ success: true, base64: dataUrl, data: dataUrl });
                                } catch (e) {
                                    console.error('[离线APP] 转 base64 失败:', e);
                                    resolve({ success: false, error: '转 base64 失败: ' + String(e) });
                                }
                                return;
                            }
                            setTimeout(nextChunk, 0);
                        }
                        nextChunk();
                    } catch (e) {
                        resolve({ success: false, error: String(e) });
                    }
                });
            },
            renameMediaFiles: function (oldPatientName, newPatientName, oldNo, newNo) {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('renameMediaFiles', JSON.stringify({
                            oldPatientName: oldPatientName,
                            newPatientName: newPatientName,
                            oldNo: oldNo,
                            newNo: newNo
                        }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e), renamed: 0 }); }
                });
            },
            deleteFile: function (filePath) {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('deleteFile', JSON.stringify({ filePath: filePath }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            quitApp: function () {
                try { if (N.quitApp) N.quitApp(); } catch (e) {}
                return P({ success: true });
            }
        };

        // 如果 injectElectronApiShim 已抢先注入了简单版本的 electronAPI，
        // 用增强版方法覆盖关键方法（readFileAsBase64/savePrescriptionImage/saveVideoFile 等
        // 解决"图片无法加载，视频可以播放"的问题：图片走简单版 readFileAsBase64 超出 data URL 限制
        if (oldAPI && (oldAPI.__injected || oldAPI.__nativeBridgeProxy)) {
            console.log('[离线APP] electronAPI 已存在（injectElectronApiShim 先注入），覆盖增强版方法到旧对象');
            var newAPI = window.electronAPI;
            oldAPI.savePrescriptionImage = newAPI.savePrescriptionImage;
            oldAPI.saveVideoFile = newAPI.saveVideoFile;
            oldAPI.readFileAsBase64 = newAPI.readFileAsBase64;
            oldAPI.findMediaFiles = newAPI.findMediaFiles;
            oldAPI.openFile = newAPI.openFile;
            oldAPI.deleteFile = newAPI.deleteFile;
            oldAPI.renameMediaFiles = newAPI.renameMediaFiles;
            oldAPI.getVideoDirectory = newAPI.getVideoDirectory;
            oldAPI.__videoRecorderEnhanced = true;
            // 恢复旧对象为 electronAPI
            window.electronAPI = oldAPI;
        }

        console.log('[离线APP] electronAPI shim 已成功注入');
        return true;
    }

    // ========================================================================
    // 2. 常量与状态
    // ========================================================================
    var MAX_DURATION = 60;
    var VIDEO_WIDTH = 1280;
    var VIDEO_HEIGHT = 720;
    var VIDEO_FPS = 30;
    var VIDEO_BITRATE = 3000000;
    var mediaStream = null;
    var mediaRecorder = null;
    var recordedChunks = [];
    var timerInterval = null;
    var recordingStartTime = 0;
    var currentFacingMode = 'environment';
    var currentCaptureStep = 1;
    var capturedPhotos = [];

    // ========================================================================
    // 3. CSS 样式注入（仅 overlay/modal/toast，按钮样式由 React 控制）
    // ========================================================================
    function injectStyles() {
        if (document.getElementById('cloud-video-recorder-styles')) return;
        var style = document.createElement('style');
        style.id = 'cloud-video-recorder-styles';
        style.textContent = '\
            .cloud-vr-overlay {\
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;\
                background: rgba(0,0,0,0.7); z-index: 99998;\
                display: flex; align-items: center; justify-content: center;\
            }\
            .cloud-vr-modal {\
                background: #fff; border-radius: 10px; padding: 16px;\
                width: 90vw; max-width: 640px; max-height: 90vh;\
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);\
                display: flex; flex-direction: column;\
                overflow: hidden;\
            }\
            .cloud-vr-modal-header {\
                position: relative;\
                margin-bottom: 10px; font-size: 16px; font-weight: 600; color: #333;\
                padding-right: 40px;\
            }\
            .cloud-vr-close-btn {\
                background: rgba(0,0,0,0.5); border: none; font-size: 20px; cursor: pointer;\
                color: #fff; line-height: 1; width: 32px; height: 32px;\
                border-radius: 50%; display: flex; align-items: center; justify-content: center;\
                position: absolute; top: 8px; right: 8px; z-index: 100;\
            }\
            .cloud-vr-preview-wrap {\
                position: relative; width: 100%; background: #000;\
                border-radius: 6px; overflow: hidden;\
                flex: 1; min-height: 0;\
            }\
            .cloud-vr-preview-wrap video {\
                width: 100%; height: 100%; object-fit: contain;\
            }\
            .cloud-vr-rec-indicator {\
                position: absolute; top: 10px; left: 10px;\
                display: none; align-items: center; gap: 6px;\
                background: rgba(220,53,69,0.9); color: #fff;\
                padding: 3px 10px; border-radius: 12px; font-size: 13px;\
            }\
            .cloud-vr-rec-indicator.active { display: flex; }\
            .cloud-vr-rec-dot {\
                width: 8px; height: 8px; background: #fff; border-radius: 50%;\
                animation: cloud-vr-pulse 1s infinite;\
            }\
            @keyframes cloud-vr-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }\
            .cloud-vr-timer {\
                position: absolute; top: 10px; right: 10px;\
                background: rgba(0,0,0,0.6); color: #fff;\
                padding: 3px 10px; border-radius: 4px; font-size: 14px;\
                font-family: monospace;\
            }\
            .cloud-vr-switch-btn {\
                position: absolute; bottom: 10px; right: 10px;\
                width: 40px; height: 40px;\
                background: rgba(0,0,0,0.6); color: #fff;\
                border: none; border-radius: 50%;\
                font-size: 18px; cursor: pointer;\
                display: flex; align-items: center; justify-content: center;\
            }\
            .cloud-vr-controls {\
                display: flex; justify-content: center; gap: 12px; margin-top: 16px;\
            }\
            .cloud-vr-ctrl-btn {\
                padding: 10px 28px; border: none; border-radius: 6px;\
                font-size: 15px; cursor: pointer; transition: opacity 0.2s;\
            }\
            .cloud-vr-ctrl-btn:disabled { opacity: 0.5; cursor: not-allowed; }\
            .cloud-vr-start-btn { background: #dc3545; color: #fff; }\
            .cloud-vr-stop-btn { background: #6c757d; color: #fff; }\
            .cloud-vr-save-btn { background: #28a745; color: #fff; }\
            .cloud-vr-capture-btn { background: #007bff; color: #fff; }\
            .cloud-vr-retake-btn { background: #ffc107; color: #333; }\
            .cloud-vr-status {\
                text-align: center; margin-top: 10px; font-size: 13px; color: #666;\
            }\
            .cloud-vr-status.error { color: #dc3545; }\
            .cloud-vr-status.success { color: #28a745; }\
            .cloud-vr-preview-wrap canvas {\
                width: 100%; height: 100%; object-fit: contain;\
            }\
            .cloud-vr-flash {\
                position: absolute; top: 0; left: 0; right: 0; bottom: 0;\
                background: #fff; opacity: 0; pointer-events: none;\
                transition: opacity 0.15s;\
            }\
            .cloud-vr-flash.active { opacity: 0.8; transition: none; }\
            .cloud-vr-guide-overlay {\
                position: absolute; top: 0; left: 0; right: 0; bottom: 0;\
                pointer-events: none; z-index: 100;\
                display: flex; flex-direction: column; align-items: center; justify-content: center;\
            }\
            .cloud-vr-guide-svg {\
                width: 65%; max-width: 280px;\
                opacity: 0.75;\
            }\
            .cloud-vr-guide-text {\
                position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);\
                background: rgba(0,0,0,0.7); color: #fff;\
                padding: 8px 20px; border-radius: 20px; font-size: 14px;\
                pointer-events: none; white-space: nowrap;\
                z-index: 101;\
            }\
            .cloud-vr-step-indicator {\
                display: flex; justify-content: center; gap: 16px; margin-top: 10px;\
            }\
            .cloud-vr-step-item {\
                font-size: 13px; color: #999; padding: 4px 12px; border-radius: 16px;\
                background: #f0f0f0;\
            }\
            .cloud-vr-step-item.active {\
                color: #fff; background: #007bff;\
            }\
            .cloud-vr-next-btn { background: #28a745; color: #fff; }\
            .cloud-vr-next-btn:hover:not(:disabled) { background: #218838; }\
            .cloud-vr-toast {\
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);\
                background: rgba(0,0,0,0.85); color: #fff;\
                padding: 16px 24px; border-radius: 8px; z-index: 99999;\
                font-size: 14px; max-width: 90vw; text-align: center;\
                word-break: break-all; line-height: 1.5;\
            }\
        ';
        document.head.appendChild(style);
    }

    // ========================================================================
    // 4. Toast 提示
    // ========================================================================
    function showToast(msg) {
        var existing = document.getElementById('cloudVrToast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = 'cloudVrToast';
        toast.className = 'cloud-vr-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 4000);
    }

    // ========================================================================
    // 5. 文件名生成
    // ========================================================================

    // 预查最近保存处方的患者姓名和编号（支持先拍照后录入姓名的流程）
    // 异步查询 IndexedDB，结果写入 window.__latestPrescriptionPatientName / __latestPrescriptionNo
    function preloadLatestPrescriptionInfo() {
        try {
            if (typeof getAllUserPrescriptions !== 'function') return;
            getAllUserPrescriptions().then(function (prescriptions) {
                if (!prescriptions || !prescriptions.length) return;
                // 按 createdAt 降序找最近一条
                var latest = prescriptions[0];
                for (var i = 1; i < prescriptions.length; i++) {
                    if ((prescriptions[i].createdAt || 0) > (latest.createdAt || 0)) {
                        latest = prescriptions[i];
                    }
                }
                if (latest.patientName) {
                    window.__latestPrescriptionPatientName = latest.patientName;
                }
                if (latest.prescriptionNo) {
                    window.__latestPrescriptionNo = latest.prescriptionNo;
                }
            }).catch(function (e) {
                console.warn('[video-recorder] 预查最近处方失败:', e);
            });
        } catch (e) {
            console.warn('[video-recorder] preloadLatestPrescriptionInfo 异常:', e);
        }
    }

    function generateFileName(type, subtype) {
        var patientName = '';
        var prescriptionNo = '';

        var nameEl = document.querySelector('input[name="patientName"], #patientName, [data-field="patientName"]');
        if (nameEl) {
            patientName = (nameEl.value || nameEl.textContent || '').trim();
        }
        if (!patientName) {
            var nameSpan = document.querySelector('.patient-name, [data-patient-name]');
            if (nameSpan) patientName = (nameSpan.textContent || '').trim();
        }
        // 回退1：表单为空时，使用最近保存处方的患者姓名（支持先拍照后录入姓名的流程）
        if (!patientName && window.__latestPrescriptionPatientName) {
            patientName = window.__latestPrescriptionPatientName;
        }

        var noEl = document.querySelector('input[name="prescriptionNo"], #prescriptionNo, [data-field="prescriptionNo"]');
        if (noEl) {
            prescriptionNo = (noEl.value || noEl.textContent || '').trim();
        }
        // 回退1：表单为空时，使用最近保存处方的编号
        if (!prescriptionNo && window.__latestPrescriptionNo) {
            prescriptionNo = window.__latestPrescriptionNo;
        }

        var sanitizeStr = function (s) {
            return (s || '').trim().replace(/[\/\\:*?"<>|]/g, '_').replace(/ /g, '');
        };
        var cleanName = sanitizeStr(patientName) || 'unknown';

        var identifier = sanitizeStr(prescriptionNo);
        if (!identifier) {
            var now = new Date();
            var pad = function (n) { return String(n).padStart(2, '0'); };
            identifier = String(now.getFullYear()).slice(-2) +
                pad(now.getMonth() + 1) + pad(now.getDate()) + '_' +
                pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
        }

        window.__lastUsedMediaIdentifier = identifier;
        window.__lastUsedMediaPatientName = cleanName;
        try {
            localStorage.setItem('lastUsedMediaIdentifier', identifier);
            localStorage.setItem('lastUsedMediaPatientName', cleanName);
        } catch (e) { /* 忽略localStorage写入错误 */ }

        var ext = type === 'video' ? (window.__currentVideoExt || 'webm') : 'jpg';
        var sub = subtype ? '_' + subtype : '';
        var _fileName = cleanName + '_' + identifier + '_' + type + sub + '.' + ext;
        return _fileName;
    }

    // ========================================================================
    // 6. 录像 Overlay
    // ========================================================================
    window.openRecordingOverlay = function () {
        injectStyles();
        var existing = document.getElementById('cloudVrOverlay');
        if (existing) existing.remove();

        // 预查最近保存处方的患者姓名（支持先拍照后录入姓名的流程）
        preloadLatestPrescriptionInfo();

        var overlay = document.createElement('div');
        overlay.id = 'cloudVrOverlay';
        overlay.className = 'cloud-vr-overlay';
        overlay.innerHTML = '\
            <div class="cloud-vr-modal">\
                <div class="cloud-vr-modal-header">\
                    <span>🎥 问诊视频录制</span>\
                    <button class="cloud-vr-close-btn" id="cloudVrCloseBtn">&times;</button>\
                </div>\
                <div class="cloud-vr-preview-wrap">\
                    <video id="cloudVrPreview" autoplay muted playsinline></video>\
                    <button class="cloud-vr-switch-btn" id="cloudVrSwitchBtn" title="切换摄像头">🔄</button>\
                    <div class="cloud-vr-rec-indicator" id="cloudVrRecIndicator">\
                        <span class="cloud-vr-rec-dot"></span>录制中\
                    </div>\
                    <div class="cloud-vr-timer" id="cloudVrTimer" style="display:none;">00:00</div>\
                </div>\
                <div class="cloud-vr-controls">\
                    <button class="cloud-vr-ctrl-btn cloud-vr-start-btn" id="cloudVrStartBtn">开始录制</button>\
                    <button class="cloud-vr-ctrl-btn cloud-vr-stop-btn" id="cloudVrStopBtn" disabled>停止录制</button>\
                    <button class="cloud-vr-ctrl-btn cloud-vr-save-btn" id="cloudVrSaveBtn" disabled>保存视频</button>\
                </div>\
                <div class="cloud-vr-status" id="cloudVrStatus">\
                    点击"开始录制"启动摄像头（最长 ' + MAX_DURATION + ' 秒）\
                </div>\
            </div>\
        ';
        document.body.appendChild(overlay);

        document.getElementById('cloudVrCloseBtn').onclick = closeOverlay;
        document.getElementById('cloudVrStartBtn').onclick = startRecording;
        document.getElementById('cloudVrStopBtn').onclick = stopRecording;
        document.getElementById('cloudVrSaveBtn').onclick = saveVideo;
        document.getElementById('cloudVrSwitchBtn').onclick = switchCamera;

        overlay.onclick = function (e) {
            if (e.target === overlay) closeOverlay();
        };

        initCamera();
    };

    async function initCamera() {
        var statusEl = document.getElementById('cloudVrStatus');
        var startBtn = document.getElementById('cloudVrStartBtn');

        try {
            statusEl.textContent = '正在请求摄像头权限...';
            statusEl.className = 'cloud-vr-status';

            var constraintOptions = [
                {
                    video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT }, frameRate: { ideal: VIDEO_FPS }, facingMode: currentFacingMode },
                    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
                },
                {
                    video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT }, frameRate: { ideal: VIDEO_FPS }, facingMode: currentFacingMode },
                    audio: false
                },
                {
                    video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT }, frameRate: { ideal: VIDEO_FPS } },
                    audio: false
                },
                {
                    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
                    audio: false
                },
                { video: true, audio: false }
            ];

            var mediaStreamResult = null;
            var lastError = null;
            var usedConfig = '';

            for (var i = 0; i < constraintOptions.length; i++) {
                try {
                    mediaStreamResult = await navigator.mediaDevices.getUserMedia(constraintOptions[i]);
                    usedConfig = i === 0 ? '高清' : (i < 3 ? '标准' : '兼容');
                    console.log('[视频录制] 使用约束组合', i + 1, '成功');
                    break;
                } catch (err) {
                    lastError = err;
                    console.warn('[视频录制] 约束组合', i + 1, '失败:', err.message || err.name);
                }
            }

            if (!mediaStreamResult) {
                if (lastError && (lastError.name === 'NotAllowedError' || lastError.name === 'SecurityError')) {
                    throw new Error('摄像头权限被拒绝，请在手机设置→应用管理中授予摄像头和麦克风权限');
                }
                throw lastError || new Error('无法获取摄像头权限');
            }

            mediaStream = mediaStreamResult;

            var videoEl = document.getElementById('cloudVrPreview');
            videoEl.srcObject = mediaStream;

            statusEl.textContent = '正在初始化摄像头...';
            startBtn.disabled = true;

            await new Promise(function (resolve, reject) {
                var timeout = setTimeout(function () {
                    reject(new Error('摄像头初始化超时'));
                }, 5000);

                videoEl.addEventListener('loadeddata', function onLoaded() {
                    clearTimeout(timeout);
                    videoEl.removeEventListener('loadeddata', onLoaded);
                    resolve();
                }, { once: true });

                var checkReady = setInterval(function () {
                    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
                        clearTimeout(timeout);
                        clearInterval(checkReady);
                        resolve();
                    }
                }, 100);
            });

            await new Promise(function (r) { setTimeout(r, 200); });

            var audioStatus = mediaStream.getAudioTracks().length > 0 ? '' : '（无声）';
            statusEl.textContent = '摄像头已就绪' + audioStatus + '，点击"开始录制" [' + usedConfig + ']';
            startBtn.disabled = false;
        } catch (err) {
            console.error('[视频录制] 摄像头初始化失败:', err);
            statusEl.textContent = '摄像头初始化失败：' + (err.message || err.name || '未知错误');
            statusEl.className = 'cloud-vr-status error';
            startBtn.disabled = true;
        }
    }

    function switchCamera() {
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
        if (mediaStream) {
            mediaStream.getTracks().forEach(function (track) { track.stop(); });
            mediaStream = null;
        }
        initCamera();
    }

    function startRecording() {
        if (!mediaStream) {
            setStatus('摄像头未就绪，请重试', 'error');
            return;
        }

        var mimeTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4;codecs=h264,aac',
            'video/mp4;codecs=h264',
            'video/mp4'
        ];
        var selectedMime = '';
        for (var i = 0; i < mimeTypes.length; i++) {
            if (MediaRecorder.isTypeSupported(mimeTypes[i])) {
                selectedMime = mimeTypes[i];
                break;
            }
        }

        window.__currentVideoExt = selectedMime.indexOf('mp4') >= 0 ? 'mp4' : 'webm';

        try {
            mediaRecorder = new MediaRecorder(mediaStream, {
                mimeType: selectedMime || undefined,
                videoBitsPerSecond: VIDEO_BITRATE,
                audioBitsPerSecond: 128000
            });
        } catch (err) {
            console.error('[视频录制] MediaRecorder 创建失败:', err);
            setStatus('录制器创建失败：' + err.message, 'error');
            return;
        }

        recordedChunks = [];
        mediaRecorder.ondataavailable = function (e) {
            if (e.data && e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };
        mediaRecorder.onstop = function () {
            onRecordingStop(selectedMime);
        };
        mediaRecorder.onerror = function (e) {
            console.error('[视频录制] MediaRecorder 错误:', e.error);
            setStatus('录制出错：' + (e.error ? e.error.message : '未知'), 'error');
        };

        mediaRecorder.start(1000);
        recordingStartTime = Date.now();

        document.getElementById('cloudVrStartBtn').disabled = true;
        document.getElementById('cloudVrStopBtn').disabled = false;
        document.getElementById('cloudVrRecIndicator').classList.add('active');
        document.getElementById('cloudVrTimer').style.display = 'block';

        setStatus('录制中...', '');

        timerInterval = setInterval(updateTimer, 200);

        setTimeout(function () {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                stopRecording();
            }
        }, MAX_DURATION * 1000);
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

        document.getElementById('cloudVrStopBtn').disabled = true;
        document.getElementById('cloudVrRecIndicator').classList.remove('active');
    }

    function onRecordingStop(mimeType) {
        if (!recordedChunks || recordedChunks.length === 0) {
            setStatus('录制数据为空，请重新录制', 'error');
            var startBtn2 = document.getElementById('cloudVrStartBtn');
            if (startBtn2) startBtn2.disabled = false;
            return;
        }

        var blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
        var sizeMB = (blob.size / 1024 / 1024).toFixed(2);

        if (blob.size < 1024) {
            console.error('[视频录制] 录制数据过小: ' + blob.size + ' bytes');
            setStatus('录制数据异常（' + blob.size + ' 字节），请重新录制', 'error');
            var startBtn3 = document.getElementById('cloudVrStartBtn');
            if (startBtn3) startBtn3.disabled = false;
            return;
        }

        var fileName = generateFileName('video');

        window.__pendingVideoBlob = blob;
        window.__pendingVideoFileName = fileName;

        document.getElementById('cloudVrSaveBtn').disabled = false;
        setStatus('录制完成，大小 ' + sizeMB + ' MB，正在自动保存...', 'success');
        setTimeout(saveVideo, 300);
    }

    async function saveVideo() {
        var blob = window.__pendingVideoBlob;
        var fileName = window.__pendingVideoFileName;
        if (!blob || !fileName) {
            setStatus('没有可保存的视频', 'error');
            return;
        }

        var saveBtn = document.getElementById('cloudVrSaveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        try {
            var arrayBuffer = await new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onload = function () { resolve(reader.result); };
                reader.onerror = function () { reject(reader.error || new Error('FileReader 读取失败')); };
                try {
                    reader.readAsArrayBuffer(blob);
                } catch (e) {
                    reject(e);
                }
            });

            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                throw new Error('视频数据为空（arrayBuffer.byteLength = 0）');
            }

            console.log('[视频录制] 视频数据读取成功，大小: ' + (arrayBuffer.byteLength / 1024 / 1024).toFixed(2) + ' MB');

            var result = await window.electronAPI.saveVideoFile(arrayBuffer, fileName);

            if (result.success) {
                var savePath = result.directory || result.filePath || '';
                setStatus('视频已保存：' + (result.fileName || fileName), 'success');
                showToast('视频已保存到：' + savePath);
                setTimeout(closeOverlay, 1500);
            } else {
                setStatus('保存失败：' + (result.error || '未知错误'), 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = '保存视频';
            }
        } catch (err) {
            console.error('[视频录制] 保存失败:', err);
            setStatus('保存失败：' + (err.message || err), 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = '保存视频';
        }
    }

    // ========================================================================
    // 7. 拍照 Overlay
    // ========================================================================
    window.openPhotoOverlay = function () {
        injectStyles();
        var existing = document.getElementById('cloudVrOverlay');
        if (existing) existing.remove();

        // 预查最近保存处方的患者姓名（支持先拍照后录入姓名的流程）
        preloadLatestPrescriptionInfo();

        currentCaptureStep = 1;
        capturedPhotos = [];

        var overlay = document.createElement('div');
        overlay.id = 'cloudVrOverlay';
        overlay.className = 'cloud-vr-overlay';
        overlay.innerHTML = '\
            <div class="cloud-vr-modal">\
                <div class="cloud-vr-modal-header">\
                    <span>📷 舌诊拍照</span>\
                    <button class="cloud-vr-close-btn" id="cloudVrCloseBtn">&times;</button>\
                </div>\
                <div class="cloud-vr-preview-wrap">\
                    <video id="cloudVrPreview" autoplay muted playsinline></video>\
                    <button class="cloud-vr-switch-btn" id="cloudVrSwitchBtn" title="切换摄像头">🔄</button>\
                    <canvas id="cloudVrPhotoCanvas" style="display:none;"></canvas>\
                    <div class="cloud-vr-flash" id="cloudVrFlash"></div>\
                    <div class="cloud-vr-guide-overlay" id="cloudVrGuideOverlay">\
                        <svg class="cloud-vr-guide-svg" id="cloudVrGuideSvg1" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">\
                            <defs>\
                                <linearGradient id="tg1" x1="0%" y1="0%" x2="0%" y2="100%">\
                                    <stop offset="0%" style="stop-color:#ffb6c1;stop-opacity:0.6" />\
                                    <stop offset="100%" style="stop-color:#ff69b4;stop-opacity:0.6" />\
                                </linearGradient>\
                            </defs>\
                            <ellipse cx="150" cy="180" rx="60" ry="80" fill="url(#tg1)" stroke="#fff" stroke-width="3"/>\
                            <line x1="150" y1="120" x2="150" y2="220" stroke="#fff" stroke-width="2" stroke-dasharray="8,4"/>\
                            <circle cx="120" cy="160" r="8" fill="#ff4444" opacity="0.8"/>\
                            <circle cx="180" cy="160" r="8" fill="#ff4444" opacity="0.8"/>\
                            <circle cx="150" cy="200" r="6" fill="#ff8888" opacity="0.8"/>\
                            <text x="150" y="270" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold">伸出舌头，舌尖朝上</text>\
                        </svg>\
                        <svg class="cloud-vr-guide-svg" id="cloudVrGuideSvg2" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="display:none;">\
                            <defs>\
                                <linearGradient id="tg2" x1="0%" y1="0%" x2="0%" y2="100%">\
                                    <stop offset="0%" style="stop-color:#ffb6c1;stop-opacity:0.6" />\
                                    <stop offset="100%" style="stop-color:#ff69b4;stop-opacity:0.6" />\
                                </linearGradient>\
                                <linearGradient id="vg2" x1="0%" y1="0%" x2="100%" y2="0%">\
                                    <stop offset="0%" style="stop-color:#ff4444;stop-opacity:0.7" />\
                                    <stop offset="100%" style="stop-color:#cc0000;stop-opacity:0.7" />\
                                </linearGradient>\
                            </defs>\
                            <ellipse cx="150" cy="180" rx="50" ry="70" fill="url(#tg2)" stroke="#fff" stroke-width="3"/>\
                            <line x1="150" y1="130" x2="150" y2="230" stroke="#fff" stroke-width="2" stroke-dasharray="8,4"/>\
                            <path d="M 130 150 Q 150 170 170 150" stroke="url(#vg2)" stroke-width="4" fill="none"/>\
                            <path d="M 125 165 Q 150 185 175 165" stroke="url(#vg2)" stroke-width="3" fill="none"/>\
                            <path d="M 135 180 Q 150 195 165 180" stroke="url(#vg2)" stroke-width="2" fill="none"/>\
                            <text x="150" y="270" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold">卷起舌头，展示舌下络脉</text>\
                        </svg>\
                        <div class="cloud-vr-guide-text" id="cloudVrGuideText">请将舌头伸出，对准虚线位置</div>\
                    </div>\
                </div>\
                <div class="cloud-vr-step-indicator">\
                    <span class="cloud-vr-step-item active" id="cloudVrStep1">1. 采集舌面图像</span>\
                    <span class="cloud-vr-step-item" id="cloudVrStep2">2. 采集舌下络脉</span>\
                </div>\
                <div class="cloud-vr-controls">\
                    <button class="cloud-vr-ctrl-btn cloud-vr-capture-btn" id="cloudVrCaptureBtn">📷 拍照</button>\
                    <button class="cloud-vr-ctrl-btn cloud-vr-next-btn" id="cloudVrNextBtn" style="display:none;">下一步</button>\
                    <button class="cloud-vr-ctrl-btn cloud-vr-save-btn" id="cloudVrPhotoSaveBtn" disabled>保存照片</button>\
                    <button class="cloud-vr-ctrl-btn cloud-vr-retake-btn" id="cloudVrRetakeBtn" disabled>重拍</button>\
                </div>\
                <div class="cloud-vr-status" id="cloudVrStatus">\
                    点击"拍照"采集舌面图像\
                </div>\
            </div>\
        ';
        document.body.appendChild(overlay);

        document.getElementById('cloudVrCloseBtn').onclick = closeOverlay;
        document.getElementById('cloudVrCaptureBtn').onclick = capturePhoto;
        document.getElementById('cloudVrPhotoSaveBtn').onclick = savePhoto;
        document.getElementById('cloudVrRetakeBtn').onclick = retakePhoto;
        document.getElementById('cloudVrSwitchBtn').onclick = switchCameraForPhoto;
        document.getElementById('cloudVrNextBtn').onclick = nextCaptureStep;

        overlay.onclick = function (e) {
            if (e.target === overlay) closeOverlay();
        };

        initCameraForPhoto();
    };

    async function initCameraForPhoto() {
        var statusEl = document.getElementById('cloudVrStatus');
        var captureBtn = document.getElementById('cloudVrCaptureBtn');

        try {
            statusEl.textContent = '正在请求摄像头权限...';
            statusEl.className = 'cloud-vr-status';

            var constraintOptions = [
                { video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT }, frameRate: { ideal: VIDEO_FPS }, facingMode: currentFacingMode }, audio: false },
                { video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT }, frameRate: { ideal: VIDEO_FPS } }, audio: false },
                { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false },
                { video: true, audio: false }
            ];

            var mediaStreamResult = null;
            var lastError = null;

            for (var i = 0; i < constraintOptions.length; i++) {
                try {
                    mediaStreamResult = await navigator.mediaDevices.getUserMedia(constraintOptions[i]);
                    console.log('[拍照] 使用约束组合', i + 1, '成功');
                    break;
                } catch (err) {
                    lastError = err;
                    console.warn('[拍照] 约束组合', i + 1, '失败:', err.message || err.name);
                }
            }

            if (!mediaStreamResult) {
                if (lastError && (lastError.name === 'NotAllowedError' || lastError.name === 'SecurityError')) {
                    throw new Error('摄像头权限被拒绝，请在手机设置→应用管理中授予摄像头权限');
                }
                throw lastError || new Error('无法获取摄像头权限');
            }

            mediaStream = mediaStreamResult;

            var videoEl = document.getElementById('cloudVrPreview');
            videoEl.srcObject = mediaStream;

            statusEl.textContent = '正在初始化摄像头...';
            captureBtn.disabled = true;

            await new Promise(function (resolve, reject) {
                var timeout = setTimeout(function () {
                    reject(new Error('摄像头初始化超时'));
                }, 8000);

                var frameCount = 0;
                var checkFrames = setInterval(function () {
                    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
                        frameCount++;
                        if (frameCount >= 3) {
                            clearTimeout(timeout);
                            clearInterval(checkFrames);
                            resolve();
                        }
                    }
                }, 100);

                videoEl.addEventListener('playing', function onPlaying() {
                    clearTimeout(timeout);
                    clearInterval(checkFrames);
                    videoEl.removeEventListener('playing', onPlaying);
                    setTimeout(resolve, 300);
                }, { once: true });
            });

            await new Promise(function (r) { setTimeout(r, 500); });

            statusEl.textContent = '摄像头已就绪，点击"拍照"';
            captureBtn.disabled = false;
        } catch (err) {
            console.error('[拍照] 摄像头初始化失败:', err);
            statusEl.textContent = '摄像头初始化失败：' + (err.message || err.name || '未知错误');
            statusEl.className = 'cloud-vr-status error';
            captureBtn.disabled = true;
        }
    }

    function switchCameraForPhoto() {
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
        if (mediaStream) {
            mediaStream.getTracks().forEach(function (track) { track.stop(); });
            mediaStream = null;
        }
        initCameraForPhoto();
    }

    function capturePhoto(retryCount) {
        retryCount = retryCount || 0;
        var videoEl = document.getElementById('cloudVrPreview');
        var canvasEl = document.getElementById('cloudVrPhotoCanvas');
        if (!videoEl || !canvasEl || !mediaStream) {
            setStatus('摄像头未就绪', 'error');
            return;
        }

        if (!videoEl.videoWidth || !videoEl.videoHeight || videoEl.readyState < 2) {
            if (retryCount < 5) {
                setStatus('视频流正在就绪... (' + (retryCount + 1) + '/5)', '');
                setTimeout(function () { capturePhoto(retryCount + 1); }, 100);
            } else {
                setStatus('视频流未就绪，请重试', 'error');
            }
            return;
        }

        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;

        var ctx = canvasEl.getContext('2d');
        if (!ctx) {
            setStatus('Canvas 2D 上下文获取失败', 'error');
            return;
        }

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

        if (videoEl.readyState < 2) {
            if (retryCount < 5) {
                setStatus('视频帧未就绪，重试中... (' + (retryCount + 1) + '/5)', '');
                setTimeout(function () { capturePhoto(retryCount + 1); }, 100);
                return;
            }
            setStatus('视频帧未就绪，请重试', 'error');
            return;
        }

        try {
            ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
        } catch (drawErr) {
            console.error('[拍照] drawImage 失败:', drawErr);
            setStatus('拍照失败：' + (drawErr.message || 'drawImage异常'), 'error');
            return;
        }

        if (isBlackFrame(ctx, canvasEl.width, canvasEl.height)) {
            if (retryCount < 5) {
                console.warn('[拍照] 检测到黑屏帧，重试中 (' + (retryCount + 1) + '/5)');
                setStatus('图像捕获异常，重试中... (' + (retryCount + 1) + '/5)', '');
                setTimeout(function () { capturePhoto(retryCount + 1); }, 150);
                return;
            }
            setStatus('图像捕获失败，请重试', 'error');
            return;
        }

        var dataUrl = canvasEl.toDataURL('image/jpeg', 0.8);

        if (dataUrl.length < 500) {
            if (retryCount < 5) {
                console.warn('[拍照] 捕获图像过小 (' + dataUrl.length + ' bytes)，重试中');
                setStatus('图像捕获异常，重试中... (' + (retryCount + 1) + '/5)', '');
                setTimeout(function () { capturePhoto(retryCount + 1); }, 100);
                return;
            }
            setStatus('图像捕获失败，请重试', 'error');
            return;
        }

        capturedPhotos[currentCaptureStep - 1] = dataUrl;

        var flash = document.getElementById('cloudVrFlash');
        if (flash) {
            flash.classList.add('active');
            setTimeout(function () { flash.classList.remove('active'); }, 150);
        }

        videoEl.style.display = 'none';
        canvasEl.style.display = 'block';

        var guideOverlay = document.getElementById('cloudVrGuideOverlay');
        if (guideOverlay) guideOverlay.style.display = 'none';

        document.getElementById('cloudVrCaptureBtn').disabled = true;
        document.getElementById('cloudVrRetakeBtn').disabled = false;

        if (currentCaptureStep === 1) {
            document.getElementById('cloudVrNextBtn').style.display = 'block';
            document.getElementById('cloudVrPhotoSaveBtn').style.display = 'none';
            setStatus('已捕获舌面图像，点击"下一步"采集舌下络脉', 'success');
        } else {
            document.getElementById('cloudVrNextBtn').style.display = 'none';
            document.getElementById('cloudVrPhotoSaveBtn').style.display = 'block';
            document.getElementById('cloudVrPhotoSaveBtn').disabled = false;
            setStatus('已捕获舌下络脉图像，正在自动保存...', 'success');
            setTimeout(savePhoto, 300);
        }
    }

    function updatePhotoGuide(step) {
        var svg1 = document.getElementById('cloudVrGuideSvg1');
        var svg2 = document.getElementById('cloudVrGuideSvg2');
        var textEl = document.getElementById('cloudVrGuideText');
        var overlay = document.getElementById('cloudVrGuideOverlay');

        if (overlay) overlay.style.display = 'flex';
        if (svg1 && svg2) {
            if (step === 1) {
                svg1.style.display = '';
                svg2.style.display = 'none';
            } else {
                svg1.style.display = 'none';
                svg2.style.display = '';
            }
        }
        if (textEl) {
            textEl.textContent = (step === 1) ? '请将舌头伸出，对准虚线位置' : '请卷起舌头，对准虚线位置拍摄舌下';
        }
    }

    function nextCaptureStep() {
        currentCaptureStep = 2;

        var step1 = document.getElementById('cloudVrStep1');
        var step2 = document.getElementById('cloudVrStep2');
        if (step1) step1.classList.remove('active');
        if (step2) step2.classList.add('active');

        updatePhotoGuide(2);

        var videoEl = document.getElementById('cloudVrPreview');
        var canvasEl = document.getElementById('cloudVrPhotoCanvas');
        if (videoEl) videoEl.style.display = '';
        if (canvasEl) canvasEl.style.display = 'none';

        document.getElementById('cloudVrCaptureBtn').disabled = false;
        document.getElementById('cloudVrNextBtn').style.display = 'none';
        document.getElementById('cloudVrRetakeBtn').disabled = true;

        setStatus('请采集舌下络脉图像，点击"拍照"', '');
    }

    async function savePhoto() {
        if (capturedPhotos.length === 0) {
            setStatus('没有可保存的照片', 'error');
            return;
        }

        var saveBtn = document.getElementById('cloudVrPhotoSaveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        try {
            var successCount = 0;
            var photoTypes = ['tongue_front', 'tongue_under'];

            for (var i = 0; i < capturedPhotos.length; i++) {
                var dataUrl = capturedPhotos[i];
                var fileName = generateFileName('photo', photoTypes[i]);
                var result = await window.electronAPI.savePrescriptionImage(dataUrl, fileName);

                if (result.success) {
                    successCount++;
                }
            }

            if (successCount === capturedPhotos.length) {
                setStatus('照片已全部保存', 'success');
                showToast('照片已保存');
                setTimeout(closeOverlay, 1500);
            } else {
                setStatus('部分照片保存失败', 'error');
                saveBtn.disabled = false;
                saveBtn.textContent = '保存照片';
            }
        } catch (err) {
            console.error('[拍照] 保存失败:', err);
            setStatus('保存失败：' + err.message, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = '保存照片';
        }
    }

    function retakePhoto() {
        var videoEl = document.getElementById('cloudVrPreview');
        var canvasEl = document.getElementById('cloudVrPhotoCanvas');
        if (videoEl) videoEl.style.display = '';
        if (canvasEl) canvasEl.style.display = 'none';

        document.getElementById('cloudVrCaptureBtn').disabled = false;
        document.getElementById('cloudVrRetakeBtn').disabled = true;
        document.getElementById('cloudVrNextBtn').style.display = 'none';
        document.getElementById('cloudVrPhotoSaveBtn').style.display = 'none';

        updatePhotoGuide(currentCaptureStep);

        if (currentCaptureStep === 1) {
            setStatus('摄像头已就绪，点击"拍照"采集舌面图像', '');
        } else {
            setStatus('摄像头已就绪，点击"拍照"采集舌下络脉图像', '');
        }
    }

    // ========================================================================
    // 8. 工具函数
    // ========================================================================
    function updateTimer() {
        var elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        var remaining = MAX_DURATION - elapsed;
        var min = String(Math.floor(elapsed / 60)).padStart(2, '0');
        var sec = String(elapsed % 60).padStart(2, '0');
        var timerEl = document.getElementById('cloudVrTimer');
        if (timerEl) {
            timerEl.textContent = min + ':' + sec + ' / ' + MAX_DURATION + 's';
            if (remaining <= 10) {
                timerEl.style.color = '#ffc107';
            }
        }
    }

    function setStatus(text, type) {
        var el = document.getElementById('cloudVrStatus');
        if (el) {
            el.textContent = text;
            el.className = 'cloud-vr-status' + (type ? ' ' + type : '');
        }
    }

    function closeOverlay() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach(function (t) { t.stop(); });
            mediaStream = null;
        }
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        var overlay = document.getElementById('cloudVrOverlay');
        if (overlay) overlay.remove();
        window.__pendingVideoBlob = null;
        window.__pendingVideoFileName = null;
    }

    function isBlackFrame(ctx, width, height) {
        try {
            var imageData = ctx.getImageData(0, 0, width, height);
            var data = imageData.data;
            var totalBrightness = 0;
            var sampleCount = 0;
            
            for (var i = 0; i < data.length; i += 40) {
                totalBrightness += (data[i] + data[i+1] + data[i+2]) / 3;
                sampleCount++;
            }
            
            var avgBrightness = totalBrightness / sampleCount;
            return avgBrightness < 10;
        } catch (e) {
            console.error('[拍照] isBlackFrame 检测失败:', e);
            return false;
        }
    }

    // ========================================================================
    // 9. 初始化
    // ========================================================================
    function init() {
        console.log('[离线APP] 录像拍照脚本开始初始化');

        var nativeBridge = window.AndroidNative;
        if (!nativeBridge) {
            console.warn('[离线APP] AndroidNative 桥接未找到，等待500ms重试');
            setTimeout(init, 500);
            return;
        }

        console.log('[离线APP] AndroidNative 桥接已找到，开始注入 shim');

        var shimSuccess = injectElectronAPIShim();
        if (!shimSuccess) {
            console.error('[离线APP] electronAPI shim 注入失败');
            setTimeout(init, 1000);
            return;
        }

        console.log('[离线APP] 录像拍照脚本初始化完成（样式延迟到首次打开overlay时注入）');
    }

    function tryInit() {
        try {
            init();
        } catch (e) {
            console.error('[离线APP] 录像拍照脚本初始化异常:', e);
            setTimeout(tryInit, 1000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }

    console.log('[离线APP] 录像拍照注入脚本已加载');
})();