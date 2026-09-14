// ============================================================================
//  video-recorder.js - 问诊视频录制 + 拍照模块（由 main.js 在 dom-ready 时注入）
//
//  【视频录制】
//  1. 在历史处方栏 history-header 中注入 🎥 录制按钮
//  2. 点击弹出录制浮层：摄像头实时预览 + 开始/停止 + 倒计时
//  3. 使用 MediaRecorder (WebM/VP9/MP4) 录制，1280×720 / 30fps / 3Mbps（720p高清）
//  4. 单条最长 60 秒，停止后自动保存到 downloads/YYYY-MM/ 目录（图片视频统一目录，方便导出）
//  5. 视频文件名格式：患者姓名_处方编号_video.webm/mp4（如：张三_26070701_video.webm）
//
//  【拍照】
//  6. 在历史处方栏注入 📷 拍照按钮（与 🎥 并排）
//  7. 点击弹出拍照浮层：摄像头实时预览 + 拍照 + 预览 + 保存/重拍
//  8. 使用 Canvas 捕获当前帧，保存为 JPEG（复用 savePrescriptionImage IPC）
//  9. 照片文件名格式：患者姓名_处方编号_photo_tongue_front.jpg / photo_tongue_under.jpg
//
//  优化特性：
//  - 多级分辨率兜底（适配不同手机型号）
//  - MP4编码支持（自动检测）
//  - 录制数据验证（非空检查、blob大小检查）
//  - 拍照重试机制（最多5次）和黑屏帧检测
//  - Toast提示功能
//  - FileReader兼容性修复（替代blob.arrayBuffer()）
//
//  依赖：window.electronAPI.saveVideoFile / savePrescriptionImage（preload.js 暴露）
//  兼容：Electron Chromium 内核，原生支持 getUserMedia + MediaRecorder + Canvas
// ============================================================================
(function () {
    'use strict';

    if (window.__videoRecorderInjected) return;
    window.__videoRecorderInjected = true;

    const MAX_DURATION = 60;
    const VIDEO_WIDTH = 1280;
    const VIDEO_HEIGHT = 720;
    const VIDEO_FPS = 30;
    const VIDEO_BITRATE = 3000000;

    let mediaStream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let timerInterval = null;
    let recordingStartTime = 0;
    let currentFacingMode = 'environment';
    let currentCaptureStep = 1;
    let capturedPhotos = [];

    function injectStyles() {
        if (document.getElementById('video-recorder-styles')) return;
        const style = document.createElement('style');
        style.id = 'video-recorder-styles';
        style.textContent = `
            .video-rec-btn {
                background: transparent; border: none; cursor: pointer;
                font-size: 18px; padding: 2px 6px; border-radius: 4px;
                transition: background 0.2s; line-height: 1;
            }
            .video-rec-btn:hover { background: rgba(255,255,255,0.2); }
            .video-overlay {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.7); z-index: 99998;
                display: flex; align-items: center; justify-content: center;
            }
            .video-modal {
                background: #fff; border-radius: 10px; padding: 16px;
                width: 90vw; max-width: 640px; max-height: 90vh;
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                display: flex; flex-direction: column;
                overflow: hidden;
            }
            .video-modal-header {
                position: relative;
                margin-bottom: 10px; font-size: 16px; font-weight: 600; color: #333;
                padding-right: 40px;
            }
            .video-close-btn {
                background: rgba(0,0,0,0.5); border: none; font-size: 20px; cursor: pointer;
                color: #fff; line-height: 1; width: 32px; height: 32px;
                border-radius: 50%; display: flex; align-items: center; justify-content: center;
                position: absolute; top: 8px; right: 8px; z-index: 100;
            }
            .video-close-btn:hover { background: rgba(0,0,0,0.7); color: #fff; }
            .video-preview-wrap {
                position: relative; width: 100%; background: #000;
                border-radius: 6px; overflow: hidden;
                flex: 1; min-height: 0;
            }
            .video-preview-wrap video {
                width: 100%; height: 100%; object-fit: contain;
            }
            .video-rec-indicator {
                position: absolute; top: 10px; left: 10px;
                display: none; align-items: center; gap: 6px;
                background: rgba(220,53,69,0.9); color: #fff;
                padding: 3px 10px; border-radius: 12px; font-size: 13px;
            }
            .video-rec-indicator.active { display: flex; }
            .video-rec-dot {
                width: 8px; height: 8px; background: #fff; border-radius: 50%;
                animation: video-pulse 1s infinite;
            }
            @keyframes video-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
            .video-timer {
                position: absolute; top: 10px; right: 10px;
                background: rgba(0,0,0,0.6); color: #fff;
                padding: 3px 10px; border-radius: 4px; font-size: 14px;
                font-family: monospace;
            }
            .video-switch-btn {
                position: absolute; bottom: 10px; right: 10px;
                width: 40px; height: 40px;
                background: rgba(0,0,0,0.6); color: #fff;
                border: none; border-radius: 50%;
                font-size: 18px; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
            }
            .video-switch-btn:hover { background: rgba(0,0,0,0.8); }
            .video-controls {
                display: flex; justify-content: center; gap: 12px;
                margin-top: 16px;
            }
            .video-ctrl-btn {
                padding: 10px 28px; border: none; border-radius: 6px;
                font-size: 15px; cursor: pointer; transition: opacity 0.2s;
            }
            .video-ctrl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .video-start-btn { background: #dc3545; color: #fff; }
            .video-start-btn:hover:not(:disabled) { background: #c82333; }
            .video-stop-btn { background: #6c757d; color: #fff; }
            .video-stop-btn:hover:not(:disabled) { background: #5a6268; }
            .video-save-btn { background: #28a745; color: #fff; }
            .video-save-btn:hover:not(:disabled) { background: #218838; }
            .video-status {
                text-align: center; margin-top: 10px; font-size: 13px; color: #666;
            }
            .video-status.error { color: #dc3545; }
            .video-status.success { color: #28a745; }
            .photo-capture-btn { background: #007bff; color: #fff; }
            .photo-capture-btn:hover:not(:disabled) { background: #0056b3; }
            .photo-retake-btn { background: #ffc107; color: #333; }
            .photo-retake-btn:hover:not(:disabled) { background: #e0a800; }
            .video-preview-wrap canvas {
                width: 100%; height: 100%; object-fit: contain;
            }
            .photo-flash {
                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                background: #fff; opacity: 0; pointer-events: none;
                transition: opacity 0.15s;
            }
            .photo-flash.active { opacity: 0.8; transition: none; }
            .photo-guide-overlay {
                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                pointer-events: none; z-index: 10;
                display: flex; align-items: center; justify-content: center;
            }
            .photo-guide-svg {
                width: 80%; height: 80%;
                opacity: 0.7;
            }
            .photo-guide-text {
                position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
                background: rgba(0,0,0,0.6); color: #fff;
                padding: 6px 16px; border-radius: 20px; font-size: 14px;
                pointer-events: none; white-space: nowrap;
            }
            .photo-step-indicator {
                display: flex; justify-content: center; gap: 20px; margin-top: 12px;
            }
            .step-item {
                font-size: 14px; color: #999; padding: 4px 12px; border-radius: 16px;
                background: #f0f0f0;
            }
            .step-item.active {
                color: #fff; background: #007bff;
            }
            .photo-next-btn { background: #28a745; color: #fff; }
            .photo-next-btn:hover:not(:disabled) { background: #218838; }
            .video-toast {
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(0,0,0,0.85); color: #fff;
                padding: 16px 24px; border-radius: 8px; z-index: 99999;
                font-size: 14px; max-width: 90vw; text-align: center;
                word-break: break-all; line-height: 1.5;
            }
        `;
        document.head.appendChild(style);
    }

    function showToast(msg) {
        var existing = document.getElementById('videoToast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.id = 'videoToast';
        toast.className = 'video-toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 4000);
    }

    function injectButton() {
        const header = document.querySelector('.history-header');
        if (!header) return false;
        if (document.getElementById('videoRecBtn')) return true;

        const photoBtn = document.createElement('button');
        photoBtn.id = 'photoCaptureBtn';
        photoBtn.className = 'video-rec-btn';
        photoBtn.innerHTML = '📷';
        photoBtn.title = '拍照';
        photoBtn.onclick = function (e) {
            e.preventDefault();
            openPhotoOverlay();
        };

        const videoBtn = document.createElement('button');
        videoBtn.id = 'videoRecBtn';
        videoBtn.className = 'video-rec-btn';
        videoBtn.innerHTML = '🎥';
        videoBtn.title = '录制问诊视频';
        videoBtn.onclick = function (e) {
            e.preventDefault();
            openRecordingOverlay();
        };

        const refreshBtn = header.querySelector('.history-refresh-btn');
        if (refreshBtn && refreshBtn.parentNode) {
            // ★修复：使用 refreshBtn.parentNode 而非 header，兼容 refreshBtn 嵌套在子 div 中的结构
            // 旧代码 header.insertBefore(photoBtn, refreshBtn) 当 refreshBtn 不是 header 直接子元素时抛 NotFoundError
            refreshBtn.parentNode.insertBefore(videoBtn, refreshBtn);
            refreshBtn.parentNode.insertBefore(photoBtn, refreshBtn);
        } else {
            header.appendChild(photoBtn);
            header.appendChild(videoBtn);
        }
        return true;
    }

    function openRecordingOverlay() {
        injectStyles();
        const existing = document.getElementById('videoOverlay');
        if (existing) existing.remove();

        // 预查最近保存处方的患者姓名（支持先拍照后录入姓名的流程）
        preloadLatestPrescriptionInfo();

        const overlay = document.createElement('div');
        overlay.id = 'videoOverlay';
        overlay.className = 'video-overlay';
        overlay.innerHTML = `
            <div class="video-modal">
                <div class="video-modal-header">
                    <span>🎥 问诊视频录制</span>
                    <button class="video-close-btn" id="videoCloseBtn">&times;</button>
                </div>
                <div class="video-preview-wrap">
                    <video id="videoPreview" autoplay muted playsinline></video>
                    <button class="video-switch-btn" id="videoSwitchBtn" title="切换摄像头">🔄</button>
                    <div class="video-rec-indicator" id="videoRecIndicator">
                        <span class="video-rec-dot"></span>录制中
                    </div>
                    <div class="video-timer" id="videoTimer" style="display:none;">00:00</div>
                </div>
                <div class="video-controls">
                    <button class="video-ctrl-btn video-start-btn" id="videoStartBtn">开始录制</button>
                    <button class="video-ctrl-btn video-stop-btn" id="videoStopBtn" disabled>停止录制</button>
                    <button class="video-ctrl-btn video-save-btn" id="videoSaveBtn" disabled>保存视频</button>
                </div>
                <div class="video-status" id="videoStatus">
                    点击"开始录制"启动摄像头（最长 ${MAX_DURATION} 秒）
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('videoCloseBtn').onclick = closeOverlay;
        document.getElementById('videoStartBtn').onclick = startRecording;
        document.getElementById('videoStopBtn').onclick = stopRecording;
        document.getElementById('videoSaveBtn').onclick = saveVideo;
        document.getElementById('videoSwitchBtn').onclick = switchCamera;

        overlay.onclick = function (e) {
            if (e.target === overlay) closeOverlay();
        };

        initCamera();
    }

    async function initCamera() {
        const statusEl = document.getElementById('videoStatus');
        const startBtn = document.getElementById('videoStartBtn');

        try {
            statusEl.textContent = '正在请求摄像头权限...';
            statusEl.className = 'video-status';

            const constraintOptions = [
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

            let mediaStreamResult = null;
            let lastError = null;
            let usedConfig = '';

            for (let i = 0; i < constraintOptions.length; i++) {
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
                    throw new Error('摄像头权限被拒绝，请在系统设置中允许本程序访问摄像头');
                }
                throw lastError || new Error('无法获取摄像头权限');
            }

            mediaStream = mediaStreamResult;

            const videoEl = document.getElementById('videoPreview');
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
            statusEl.className = 'video-status error';
            startBtn.disabled = true;
        }
    }

    function switchCamera() {
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        initCamera();
    }

    function startRecording() {
        if (!mediaStream) {
            setStatus('摄像头未就绪，请重试', 'error');
            return;
        }

        const mimeTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4;codecs=h264,aac',
            'video/mp4;codecs=h264',
            'video/mp4'
        ];
        let selectedMime = '';
        for (const mt of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mt)) {
                selectedMime = mt;
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

        document.getElementById('videoStartBtn').disabled = true;
        document.getElementById('videoStopBtn').disabled = false;
        document.getElementById('videoRecIndicator').classList.add('active');
        document.getElementById('videoTimer').style.display = 'block';

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

        document.getElementById('videoStopBtn').disabled = true;
        document.getElementById('videoRecIndicator').classList.remove('active');
    }

    function onRecordingStop(mimeType) {
        if (!recordedChunks || recordedChunks.length === 0) {
            setStatus('录制数据为空，请重新录制', 'error');
            var startBtn2 = document.getElementById('videoStartBtn');
            if (startBtn2) startBtn2.disabled = false;
            return;
        }

        var blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
        var sizeMB = (blob.size / 1024 / 1024).toFixed(2);

        if (blob.size < 1024) {
            console.error('[视频录制] 录制数据过小: ' + blob.size + ' bytes');
            setStatus('录制数据异常（' + blob.size + ' 字节），请重新录制', 'error');
            var startBtn3 = document.getElementById('videoStartBtn');
            if (startBtn3) startBtn3.disabled = false;
            return;
        }

        var fileName = generateFileName('video');

        window.__pendingVideoBlob = blob;
        window.__pendingVideoFileName = fileName;

        document.getElementById('videoSaveBtn').disabled = false;
        setStatus('录制完成，大小 ' + sizeMB + ' MB，正在自动保存...', 'success');
        setTimeout(saveVideo, 300);
    }

    async function saveVideo() {
        const blob = window.__pendingVideoBlob;
        const fileName = window.__pendingVideoFileName;
        if (!blob || !fileName) {
            setStatus('没有可保存的视频', 'error');
            return;
        }

        const saveBtn = document.getElementById('videoSaveBtn');
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
                var videoInfo = getCurrentPrescriptionInfo();
                saveMediaToDB({
                    patientName: videoInfo.patientName || 'unknown',
                    prescriptionNo: videoInfo.prescriptionNo || '',
                    createdAt: new Date().toISOString(),
                    timestamp: Date.now(),
                    name: fileName,
                    type: 'video',
                    blob: blob,
                    dataUrl: '',
                    size: blob.size
                }).catch(function (e) { console.warn('[video-recorder] IndexedDB存储失败:', e); });
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

    function openPhotoOverlay() {
        injectStyles();
        const existing = document.getElementById('videoOverlay');
        if (existing) existing.remove();

        // 预查最近保存处方的患者姓名（支持先拍照后录入姓名的流程）
        preloadLatestPrescriptionInfo();

        currentCaptureStep = 1;
        capturedPhotos = [];

        const overlay = document.createElement('div');
        overlay.id = 'videoOverlay';
        overlay.className = 'video-overlay';
        overlay.innerHTML = `
            <div class="video-modal">
                <div class="video-modal-header">
                    <span>📷 舌诊拍照</span>
                    <button class="video-close-btn" id="videoCloseBtn">&times;</button>
                </div>
                <div class="video-preview-wrap">
                    <video id="videoPreview" autoplay muted playsinline></video>
                    <button class="video-switch-btn" id="photoSwitchBtn" title="切换摄像头">🔄</button>
                    <canvas id="photoCanvas" style="display:none;"></canvas>
                    <div class="photo-flash" id="photoFlash"></div>
                    <div class="photo-guide-overlay" id="photoGuideOverlay">
                        <svg class="photo-guide-svg" id="photoGuideSvg1" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                                <linearGradient id="tg1" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" style="stop-color:#ffb6c1;stop-opacity:0.6" />
                                    <stop offset="100%" style="stop-color:#ff69b4;stop-opacity:0.6" />
                                </linearGradient>
                            </defs>
                            <ellipse cx="150" cy="180" rx="60" ry="80" fill="url(#tg1)" stroke="#fff" stroke-width="3"/>
                            <line x1="150" y1="120" x2="150" y2="220" stroke="#fff" stroke-width="2" stroke-dasharray="8,4"/>
                            <circle cx="120" cy="160" r="8" fill="#ff4444" opacity="0.8"/>
                            <circle cx="180" cy="160" r="8" fill="#ff4444" opacity="0.8"/>
                            <circle cx="150" cy="200" r="6" fill="#ff8888" opacity="0.8"/>
                            <text x="150" y="270" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold">伸出舌头，舌尖朝上</text>
                        </svg>
                        <svg class="photo-guide-svg" id="photoGuideSvg2" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="display:none;">
                            <defs>
                                <linearGradient id="tg2" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" style="stop-color:#ffb6c1;stop-opacity:0.6" />
                                    <stop offset="100%" style="stop-color:#ff69b4;stop-opacity:0.6" />
                                </linearGradient>
                                <linearGradient id="vg2" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" style="stop-color:#ff4444;stop-opacity:0.7" />
                                    <stop offset="100%" style="stop-color:#cc0000;stop-opacity:0.7" />
                                </linearGradient>
                            </defs>
                            <ellipse cx="150" cy="180" rx="50" ry="70" fill="url(#tg2)" stroke="#fff" stroke-width="3"/>
                            <line x1="150" y1="130" x2="150" y2="230" stroke="#fff" stroke-width="2" stroke-dasharray="8,4"/>
                            <path d="M 130 150 Q 150 170 170 150" stroke="url(#vg2)" stroke-width="4" fill="none"/>
                            <path d="M 125 165 Q 150 185 175 165" stroke="url(#vg2)" stroke-width="3" fill="none"/>
                            <path d="M 135 180 Q 150 195 165 180" stroke="url(#vg2)" stroke-width="2" fill="none"/>
                            <text x="150" y="270" text-anchor="middle" fill="#fff" font-size="14" font-weight="bold">卷起舌头，展示舌下络脉</text>
                        </svg>
                        <div class="photo-guide-text" id="photoGuideText">请将舌头伸出，对准虚线位置</div>
                    </div>
                </div>
                <div class="photo-step-indicator" id="photoStepIndicator">
                    <span class="step-item active">1. 采集舌面图像</span>
                    <span class="step-item">2. 采集舌下络脉</span>
                </div>
                <div class="video-controls" id="photoControls">
                    <button class="video-ctrl-btn photo-capture-btn" id="photoCaptureBtn2">📷 拍照</button>
                    <button class="video-ctrl-btn photo-next-btn" id="photoNextBtn" style="display:none;">下一步</button>
                    <button class="video-ctrl-btn video-save-btn" id="photoSaveBtn" disabled>保存照片</button>
                    <button class="video-ctrl-btn photo-retake-btn" id="photoRetakeBtn" disabled>重拍</button>
                </div>
                <div class="video-status" id="videoStatus">
                    点击"拍照"采集舌面图像
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('videoCloseBtn').onclick = closeOverlay;
        document.getElementById('photoCaptureBtn2').onclick = capturePhoto;
        document.getElementById('photoSaveBtn').onclick = savePhoto;
        document.getElementById('photoRetakeBtn').onclick = retakePhoto;
        document.getElementById('photoSwitchBtn').onclick = switchCameraForPhoto;
        document.getElementById('photoNextBtn').onclick = nextCaptureStep;

        overlay.onclick = function (e) {
            if (e.target === overlay) closeOverlay();
        };

        initCameraForPhoto();
    }

    async function initCameraForPhoto() {
        const statusEl = document.getElementById('videoStatus');
        const captureBtn = document.getElementById('photoCaptureBtn2');

        try {
            statusEl.textContent = '正在请求摄像头权限...';
            statusEl.className = 'video-status';

            const constraintOptions = [
                { video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT }, frameRate: { ideal: VIDEO_FPS }, facingMode: currentFacingMode }, audio: false },
                { video: { width: { ideal: VIDEO_WIDTH }, height: { ideal: VIDEO_HEIGHT }, frameRate: { ideal: VIDEO_FPS } }, audio: false },
                { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false },
                { video: true, audio: false }
            ];

            let mediaStreamResult = null;
            let lastError = null;

            for (let i = 0; i < constraintOptions.length; i++) {
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
                    throw new Error('摄像头权限被拒绝，请在系统设置中允许本程序访问摄像头');
                }
                throw lastError || new Error('无法获取摄像头权限');
            }

            mediaStream = mediaStreamResult;

            const videoEl = document.getElementById('videoPreview');
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
            statusEl.className = 'video-status error';
            captureBtn.disabled = true;
        }
    }

    function switchCameraForPhoto() {
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        initCameraForPhoto();
    }

    function capturePhoto(retryCount) {
        retryCount = retryCount || 0;
        const videoEl = document.getElementById('videoPreview');
        const canvasEl = document.getElementById('photoCanvas');
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

        const ctx = canvasEl.getContext('2d');
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

        var flash = document.getElementById('photoFlash');
        if (flash) {
            flash.classList.add('active');
            setTimeout(function () { flash.classList.remove('active'); }, 150);
        }

        videoEl.style.display = 'none';
        canvasEl.style.display = 'block';

        var guideOverlay = document.getElementById('photoGuideOverlay');
        if (guideOverlay) guideOverlay.style.display = 'none';

        document.getElementById('photoCaptureBtn2').disabled = true;
        document.getElementById('photoRetakeBtn').disabled = false;

        if (currentCaptureStep === 1) {
            document.getElementById('photoNextBtn').style.display = 'block';
            document.getElementById('photoSaveBtn').style.display = 'none';
            setStatus('已捕获舌面图像，点击"下一步"采集舌下络脉', 'success');
        } else {
            document.getElementById('photoNextBtn').style.display = 'none';
            document.getElementById('photoSaveBtn').style.display = 'block';
            document.getElementById('photoSaveBtn').disabled = false;
            setStatus('已捕获舌下络脉图像，正在自动保存...', 'success');
            setTimeout(savePhoto, 300);
        }
    }

    function isBlackFrame(ctx, width, height) {
        try {
            var imageData = ctx.getImageData(0, 0, width, height);
            var data = imageData.data;
            var totalBrightness = 0;
            var sampleCount = 0;

            for (var i = 0; i < data.length; i += 40) {
                totalBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
                sampleCount++;
            }

            var avgBrightness = totalBrightness / sampleCount;
            return avgBrightness < 10;
        } catch (e) {
            console.error('[拍照] isBlackFrame 检测失败:', e);
            return false;
        }
    }

    function updatePhotoGuide(step) {
        const svg1 = document.getElementById('photoGuideSvg1');
        const svg2 = document.getElementById('photoGuideSvg2');
        const textEl = document.getElementById('photoGuideText');
        const overlay = document.getElementById('photoGuideOverlay');

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

        const stepItems = document.querySelectorAll('.step-item');
        if (stepItems[0]) stepItems[0].classList.remove('active');
        if (stepItems[1]) stepItems[1].classList.add('active');

        updatePhotoGuide(2);

        const videoEl = document.getElementById('videoPreview');
        const canvasEl = document.getElementById('photoCanvas');
        if (videoEl) videoEl.style.display = '';
        if (canvasEl) canvasEl.style.display = 'none';

        document.getElementById('photoCaptureBtn2').disabled = false;
        document.getElementById('photoNextBtn').style.display = 'none';
        document.getElementById('photoRetakeBtn').disabled = true;

        setStatus('请采集舌下络脉图像，点击"拍照"', '');
    }

    async function savePhoto() {
        if (capturedPhotos.length === 0) {
            setStatus('没有可保存的照片', 'error');
            return;
        }

        const saveBtn = document.getElementById('photoSaveBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        try {
            let successCount = 0;
            const photoTypes = ['tongue_front', 'tongue_under'];

            for (let i = 0; i < capturedPhotos.length; i++) {
                const dataUrl = capturedPhotos[i];
                const fileName = generateFileName('photo', photoTypes[i]);
                const result = await window.electronAPI.savePrescriptionImage(dataUrl, fileName);

                if (result.success) {
                    successCount++;
                    var photoInfo = getCurrentPrescriptionInfo();
                    saveMediaToDB({
                        patientName: photoInfo.patientName || 'unknown',
                        prescriptionNo: photoInfo.prescriptionNo || '',
                        createdAt: new Date().toISOString(),
                        timestamp: Date.now(),
                        name: fileName,
                        type: 'image',
                        blob: null,
                        dataUrl: dataUrl,
                        size: 0
                    }).catch(function (e) { console.warn('[video-recorder] IndexedDB存储失败:', e); });
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
        const videoEl = document.getElementById('videoPreview');
        const canvasEl = document.getElementById('photoCanvas');
        if (videoEl) videoEl.style.display = '';
        if (canvasEl) canvasEl.style.display = 'none';

        document.getElementById('photoCaptureBtn2').disabled = false;
        document.getElementById('photoRetakeBtn').disabled = true;
        document.getElementById('photoNextBtn').style.display = 'none';
        document.getElementById('photoSaveBtn').style.display = 'none';

        updatePhotoGuide(currentCaptureStep);

        if (currentCaptureStep === 1) {
            setStatus('摄像头已就绪，点击"拍照"采集舌面图像', '');
        } else {
            setStatus('摄像头已就绪，点击"拍照"采集舌下络脉图像', '');
        }
    }

    // 预查最近保存处方的患者姓名和编号（支持先拍照后录入姓名的流程）
    // 异步查询 IndexedDB，结果写入 window.__latestPrescriptionPatientName / __latestPrescriptionNo
    function preloadLatestPrescriptionInfo() {
        try {
            if (typeof getAllUserPrescriptions !== 'function') return;
            getAllUserPrescriptions().then(function (prescriptions) {
                if (!prescriptions || !prescriptions.length) return;
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

    function generateFileName(type, subtype = '') {
        let patientName = '';

        var nameEl = document.querySelector('input[name="patientName"], #patientName, [data-field="patientName"]');
        if (nameEl) {
            patientName = (nameEl.value || nameEl.textContent || '').trim();
        }
        if (!patientName) {
            var nameSpan = document.querySelector('.patient-name, [data-patient-name]');
            if (nameSpan) patientName = (nameSpan.textContent || '').trim();
        }
        patientName = patientName || (document.getElementById('paperName')?.textContent || '').trim();
        // 回退1：表单为空时，使用最近保存处方的患者姓名（支持先拍照后录入姓名的流程）
        if (!patientName && window.__latestPrescriptionPatientName) {
            patientName = window.__latestPrescriptionPatientName;
        }

        var noEl = document.querySelector('input[name="prescriptionNo"], #prescriptionNo, [data-field="prescriptionNo"]');
        var prescriptionNo = '';
        if (noEl) {
            prescriptionNo = (noEl.value || noEl.textContent || '').trim();
        }
        prescriptionNo = prescriptionNo || (document.getElementById('clinicNo')?.value || '').trim() ||
                         (document.getElementById('paperClinicNo')?.textContent || '').trim();
        // 回退1：表单为空时，使用最近保存处方的编号
        if (!prescriptionNo && window.__latestPrescriptionNo) {
            prescriptionNo = window.__latestPrescriptionNo;
        }

        const sanitizeStr = s => (s || '').trim().replace(/[\/\\:*?"<>|]/g, '_').replace(/ /g, '');
        const cleanName = sanitizeStr(patientName) || 'unknown';

        let identifier = sanitizeStr(prescriptionNo);
        if (!identifier) {
            const now = new Date();
            const pad = n => String(n).padStart(2, '0');
            identifier = String(now.getFullYear()).slice(-2) +
                         pad(now.getMonth() + 1) + pad(now.getDate()) + '_' +
                         pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
        }

        window.__lastUsedMediaIdentifier = identifier;
        window.__lastUsedMediaPatientName = cleanName;
        try {
            localStorage.setItem('lastUsedMediaIdentifier', identifier);
            localStorage.setItem('lastUsedMediaPatientName', cleanName);
        } catch (e) { }

        const ext = type === 'video' ? (window.__currentVideoExt || 'webm') : 'jpg';
        const sub = subtype ? '_' + subtype : '';
        return cleanName + '_' + identifier + '_' + type + sub + '.' + ext;
    }

    function updateTimer() {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const remaining = MAX_DURATION - elapsed;
        const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
        const sec = String(elapsed % 60).padStart(2, '0');
        const timerEl = document.getElementById('videoTimer');
        if (timerEl) {
            timerEl.textContent = min + ':' + sec + ' / ' + MAX_DURATION + 's';
            if (remaining <= 10) {
                timerEl.style.color = '#ffc107';
            }
        }
    }

    function setStatus(text, type) {
        const el = document.getElementById('videoStatus');
        if (el) {
            el.textContent = text;
            el.className = 'video-status' + (type ? ' ' + type : '');
        }
    }

    function getCurrentMonthFolder() {
        const now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
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
        const overlay = document.getElementById('videoOverlay');
        if (overlay) overlay.remove();
        window.__pendingVideoBlob = null;
        window.__pendingVideoFileName = null;
        currentCaptureStep = 1;
        capturedPhotos = [];
    }

    // ========================================================================
    // IndexedDB 存储（网页版：替代桌面版 electronAPI 文件查找）
    // ========================================================================
    var MEDIA_DB_NAME = 'PrescriptionMediaDB';
    var MEDIA_DB_VERSION = 1;
    var MEDIA_STORE = 'media_files';
    var _mediaDB = null;

    function openMediaDB() {
        if (_mediaDB) return Promise.resolve(_mediaDB);
        return new Promise(function (resolve, reject) {
            try {
                var req = indexedDB.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);
                req.onupgradeneeded = function (e) {
                    var db = e.target.result;
                    if (!db.objectStoreNames.contains(MEDIA_STORE)) {
                        var store = db.createObjectStore(MEDIA_STORE, { keyPath: 'id', autoIncrement: true });
                        store.createIndex('patientName', 'patientName', { unique: false });
                        store.createIndex('prescriptionNo', 'prescriptionNo', { unique: false });
                        store.createIndex('createdAt', 'createdAt', { unique: false });
                        store.createIndex('timestamp', 'timestamp', { unique: false });
                    }
                };
                req.onsuccess = function () {
                    _mediaDB = req.result;
                    resolve(_mediaDB);
                };
                req.onerror = function () { reject(req.error); };
            } catch (e) { reject(e); }
        });
    }

    function saveMediaToDB(entry) {
        return openMediaDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(MEDIA_STORE, 'readwrite');
                var store = tx.objectStore(MEDIA_STORE);
                store.put(entry);
                tx.oncomplete = function () { resolve(true); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function findMediaInDB(patientName, prescriptionNo, createdAt) {
        return openMediaDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(MEDIA_STORE, 'readonly');
                var store = tx.objectStore(MEDIA_STORE);
                var request = store.getAll();
                request.onsuccess = function () {
                    var all = request.result || [];
                    var cleanPatient = (patientName || '').trim();
                    var cleanNo = (prescriptionNo || '').trim();
                    var results = all.filter(function (r) {
                        if (!r || !r.patientName) return false;
                        var matchPatient = cleanPatient && r.patientName.indexOf(cleanPatient) >= 0;
                        var matchNo = cleanNo && r.prescriptionNo && r.prescriptionNo.indexOf(cleanNo) >= 0;
                        if (matchPatient && matchNo) return true;
                        if (matchPatient && !cleanNo) return true;
                        return false;
                    });
                    results.sort(function (a, b) {
                        return (b.timestamp || 0) - (a.timestamp || 0);
                    });
                    var files = results.map(function (r) {
                        return {
                            name: r.name,
                            type: r.type,
                            blob: r.blob,
                            dataUrl: r.dataUrl,
                            size: r.size || 0,
                            lastModified: r.timestamp || 0,
                            patientName: r.patientName,
                            prescriptionNo: r.prescriptionNo
                        };
                    });
                    resolve({ success: true, files: files });
                };
                request.onerror = function () { reject(request.error); };
            });
        });
    }

    window.findMediaFilesWeb = findMediaInDB;

    function getCurrentPrescriptionInfo() {
        var patientName = '';
        var nameEl = document.querySelector('input[name="patientName"], #patientName, [data-field="patientName"]');
        if (nameEl) patientName = nameEl.value || nameEl.textContent || '';
        var prescriptionNo = '';
        var rxNoEl = document.querySelector('input[name="prescriptionNo"], #prescriptionNo, [data-field="prescriptionNo"]');
        if (rxNoEl) prescriptionNo = rxNoEl.value || rxNoEl.textContent || '';
        var info = {
            patientName: patientName,
            prescriptionNo: prescriptionNo,
            createdAt: new Date().toISOString()
        };
        try {
            if (window.__prescriptionData) {
                var pd = window.__prescriptionData;
                if (pd.patientName) info.patientName = pd.patientName;
                if (pd.prescriptionNo) info.prescriptionNo = pd.prescriptionNo;
                if (pd.createdAt) info.createdAt = pd.createdAt;
            }
            if (window.__currentPrescription) {
                var cp = window.__currentPrescription;
                if (cp.patientName) info.patientName = cp.patientName;
                if (cp.prescriptionNo) info.prescriptionNo = cp.prescriptionNo;
                if (cp.createdAt) info.createdAt = cp.createdAt;
            }
            var nameEls = document.querySelectorAll('[data-patient-name], [data-field="patientName"]');
            for (var i = 0; i < nameEls.length; i++) {
                var v = nameEls[i].getAttribute('data-patient-name') || nameEls[i].textContent || '';
                if (v) { info.patientName = v; break; }
            }
        } catch(e) {}
        return info;
    }

    function init() {
        injectStyles();
        if (!injectButton()) {
            var retryCount = 0;
            var retryTimer = setInterval(function () {
                if (injectButton() || ++retryCount > 30) {
                    clearInterval(retryTimer);
                }
            }, 1000);
        }
        // ★P5-3 暴露到 window，启用移动端底部录像/拍照按钮（同步云端 cloud_desktop）
        // 移动端底部按钮初始 disabled，此处暴露后由 index.html 的 enableMediaButtons 启用
        window.openRecordingOverlay = openRecordingOverlay;
        window.openPhotoOverlay = openPhotoOverlay;
        try {
            if (typeof window.enableMediaButtons === 'function') window.enableMediaButtons();
        } catch(e) { console.warn('[video-recorder] enableMediaButtons 调用失败:', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();