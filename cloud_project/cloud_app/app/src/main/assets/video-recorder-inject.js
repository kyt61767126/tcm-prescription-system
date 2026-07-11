/**
 * 云端APP录像拍照注入脚本
 *
 * 功能：
 * 1. 注入 window.electronAPI shim（调用 AndroidNative 桥接）
 * 2. 注入 CSS 样式（overlay/modal/toast）
 * 3. 实现录像 overlay（摄像头预览、录制控制、前后摄像头切换）
 * 4. 实现拍照 overlay
 * 5. 保存到本地文件系统（按月份分类 YYYY-MM）
 *
 * 注意：拍照/录像按钮由 React ActionBar 组件渲染，本脚本仅提供 overlay 和保存功能。
 * ActionBar 通过 window.openPhotoOverlay() / window.openRecordingOverlay() 调用本脚本。
 *
 * 保存路径（图片视频统一目录，方便导出）：
 *   Pictures/本能中医处方/YYYY-MM/患者姓名_处方编号_photo.png
 *   Pictures/本能中医处方/YYYY-MM/患者姓名_处方编号_video.webm
 */
(function () {
    'use strict';
    if (window.__videoRecorderInjected) return;
    window.__videoRecorderInjected = true;

    // ========================================================================
    // 1. 注入 window.electronAPI shim
    // ========================================================================
    function injectElectronAPIShim() {
        if (window.electronAPI && window.electronAPI.__injected) return;
        var N = window.AndroidNative;
        if (!N) {
            console.warn('[云端APP] AndroidNative 桥接未找到，录像拍照功能不可用');
            return false;
        }
        function P(v) { return Promise.resolve(v); }
        function callNative(name, json) {
            return JSON.parse(N.invoke(name, json || '{}'));
        }
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
                        var r = callNative('savePrescriptionImage', JSON.stringify({ imageData: imageData, fileName: fileName }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            saveVideoFile: function (arrayBuffer, fileName) {
                return new Promise(function (resolve) {
                    try {
                        var bytes = new Uint8Array(arrayBuffer);
                        var chunkSize = 8192;
                        var binary = '';
                        for (var i = 0; i < bytes.length; i += chunkSize) {
                            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
                        }
                        var base64Data = btoa(binary);
                        var r = callNative('saveVideoFile', JSON.stringify({ base64Data: base64Data, fileName: fileName }));
                        resolve(r);
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
            findMediaFiles: function (patientName, prescriptionNo) {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('findMediaFiles', JSON.stringify({ patientName: patientName, prescriptionNo: prescriptionNo }));
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
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('readFileAsBase64', JSON.stringify({ filePath: filePath }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e) }); }
                });
            },
            renameMediaFiles: function (patientName, oldNo, newNo) {
                return new Promise(function (resolve) {
                    try {
                        var r = callNative('renameMediaFiles', JSON.stringify({ patientName: patientName, oldNo: oldNo, newNo: newNo }));
                        resolve(r);
                    } catch (e) { resolve({ success: false, error: String(e), renamed: 0 }); }
                });
            },
            quitApp: function () {
                try { if (N.quitApp) N.quitApp(); } catch (e) {}
                return P({ success: true });
            }
        };
        console.log('[云端APP] electronAPI shim 已注入');
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
                background: #fff; border-radius: 10px; padding: 20px;\
                width: 720px; max-width: 95vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);\
            }\
            .cloud-vr-modal-header {\
                display: flex; justify-content: space-between; align-items: center;\
                margin-bottom: 12px; font-size: 16px; font-weight: 600; color: #333;\
            }\
            .cloud-vr-close-btn {\
                background: none; border: none; font-size: 22px; cursor: pointer;\
                color: #999; line-height: 1;\
            }\
            .cloud-vr-preview-wrap {\
                position: relative; width: 100%; background: #000;\
                border-radius: 6px; overflow: hidden; aspect-ratio: 4/3;\
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

        var noEl = document.querySelector('input[name="prescriptionNo"], #prescriptionNo, [data-field="prescriptionNo"]');
        if (noEl) {
            prescriptionNo = (noEl.value || noEl.textContent || '').trim();
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

        var ext = type === 'video' ? 'webm' : 'jpg';
        var sub = subtype ? '_' + subtype : '';
        return cleanName + '_' + identifier + '_' + type + sub + '.' + ext;
    }

    // ========================================================================
    // 6. 录像 Overlay
    // ========================================================================
    window.openRecordingOverlay = function () {
        var existing = document.getElementById('cloudVrOverlay');
        if (existing) existing.remove();

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

            var constraints = {
                video: {
                    width: { ideal: VIDEO_WIDTH },
                    height: { ideal: VIDEO_HEIGHT },
                    frameRate: { ideal: VIDEO_FPS },
                    facingMode: currentFacingMode
                },
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            };

            try {
                mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (audioErr) {
                console.warn('[视频录制] 音频获取失败，尝试仅视频:', audioErr);
                constraints.audio = false;
                mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
                statusEl.textContent = '注意：麦克风不可用，将录制无声视频';
            }

            var videoEl = document.getElementById('cloudVrPreview');
            videoEl.srcObject = mediaStream;

            statusEl.textContent = '摄像头已就绪，点击"开始录制"';
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
            'video/webm'
        ];
        var selectedMime = '';
        for (var i = 0; i < mimeTypes.length; i++) {
            if (MediaRecorder.isTypeSupported(mimeTypes[i])) {
                selectedMime = mimeTypes[i];
                break;
            }
        }

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
        var blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
        var sizeMB = (blob.size / 1024 / 1024).toFixed(2);

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
            var arrayBuffer = await blob.arrayBuffer();
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
            setStatus('保存失败：' + err.message, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = '保存视频';
        }
    }

    // ========================================================================
    // 7. 拍照 Overlay
    // ========================================================================
    window.openPhotoOverlay = function () {
        var existing = document.getElementById('cloudVrOverlay');
        if (existing) existing.remove();

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

            mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: VIDEO_WIDTH },
                    height: { ideal: VIDEO_HEIGHT },
                    frameRate: { ideal: VIDEO_FPS },
                    facingMode: currentFacingMode
                },
                audio: false
            });

            var videoEl = document.getElementById('cloudVrPreview');
            videoEl.srcObject = mediaStream;

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

    function capturePhoto() {
        var videoEl = document.getElementById('cloudVrPreview');
        var canvasEl = document.getElementById('cloudVrPhotoCanvas');
        if (!videoEl || !canvasEl || !mediaStream) {
            setStatus('摄像头未就绪', 'error');
            return;
        }

        if (!videoEl.videoWidth || !videoEl.videoHeight) {
            setStatus('视频流尚未就绪，请稍候', 'error');
            return;
        }

        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;

        var ctx = canvasEl.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

        var dataUrl = canvasEl.toDataURL('image/jpeg', 0.8);
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

    // ========================================================================
    // 9. 初始化（仅注入 shim 和样式，按钮由 React ActionBar 渲染）
    // ========================================================================
    function init() {
        if (!injectElectronAPIShim()) {
            setTimeout(init, 500);
            return;
        }
        injectStyles();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    setTimeout(init, 2000);

    console.log('[云端APP] 录像拍照注入脚本已加载');
})();
