// ============================================================================
//  video-recorder.js - 问诊视频录制 + 拍照模块（由 main.js 在 dom-ready 时注入）
//
//  【视频录制】
//  1. 在历史处方栏 history-header 中注入 🎥 录制按钮
//  2. 点击弹出录制浮层：摄像头实时预览 + 开始/停止 + 倒计时
//  3. 使用 MediaRecorder (WebM/VP9) 录制，1280×720 / 30fps / 3Mbps（720p高清）
//  4. 单条最长 60 秒，停止后自动保存到 downloads/YYYY-MM/ 目录（图片视频统一目录，方便导出）
//  5. 视频文件名格式：video_YYYYMMDD_HHmmss.webm
//
//  【拍照】
//  6. 在历史处方栏注入 📷 拍照按钮（与 🎥 并排）
//  7. 点击弹出拍照浮层：摄像头实时预览 + 拍照 + 预览 + 保存/重拍
//  8. 使用 Canvas 捕获当前帧，保存为 PNG（复用 savePrescriptionImage IPC）
//  9. 照片文件名格式：photo_YYYYMMDD_HHmmss.png
//
//  依赖：window.electronAPI.saveVideoFile / savePrescriptionImage（preload.js 暴露）
//  兼容：Electron Chromium 内核，原生支持 getUserMedia + MediaRecorder + Canvas
// ============================================================================
(function () {
    'use strict';

    // 防止重复注入
    if (window.__videoRecorderInjected) return;
    window.__videoRecorderInjected = true;

    // 录制参数
    const MAX_DURATION = 60;           // 最长录制秒数
    const VIDEO_WIDTH = 1280;
    const VIDEO_HEIGHT = 720;
    const VIDEO_FPS = 30;
    const VIDEO_BITRATE = 3000000;     // 3 Mbps → 60秒约 22.5MB（720p高清）

    let mediaStream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let timerInterval = null;
    let recordingStartTime = 0;
    let currentFacingMode = 'environment';

    // ─── 样式注入 ───────────────────────────────────────────
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
                    `;
        document.head.appendChild(style);
    }

    // ─── 按钮注入 ───────────────────────────────────────────
    function injectButton() {
        const header = document.querySelector('.history-header');
        if (!header) return false;
        if (document.getElementById('videoRecBtn')) return true;

        // 拍照按钮
        const photoBtn = document.createElement('button');
        photoBtn.id = 'photoCaptureBtn';
        photoBtn.className = 'video-rec-btn';
        photoBtn.innerHTML = '📷';
        photoBtn.title = '拍照';
        photoBtn.onclick = function (e) {
            e.preventDefault();
            openPhotoOverlay();
        };

        // 录制按钮
        const videoBtn = document.createElement('button');
        videoBtn.id = 'videoRecBtn';
        videoBtn.className = 'video-rec-btn';
        videoBtn.innerHTML = '🎥';
        videoBtn.title = '录制问诊视频';
        videoBtn.onclick = function (e) {
            e.preventDefault();
            openRecordingOverlay();
        };

        // 插入到刷新按钮前面（📷 在 🎥 左边）
        const refreshBtn = header.querySelector('.history-refresh-btn');
        if (refreshBtn) {
            header.insertBefore(photoBtn, refreshBtn);
            header.insertBefore(videoBtn, refreshBtn);
        } else {
            header.appendChild(photoBtn);
            header.appendChild(videoBtn);
        }
        return true;
    }

    // ─── 录制浮层 ───────────────────────────────────────────
    function openRecordingOverlay() {
        // 移除已有浮层
        const existing = document.getElementById('videoOverlay');
        if (existing) existing.remove();

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

        // 绑定事件
        document.getElementById('videoCloseBtn').onclick = closeOverlay;
        document.getElementById('videoStartBtn').onclick = startRecording;
        document.getElementById('videoStopBtn').onclick = stopRecording;
        document.getElementById('videoSaveBtn').onclick = saveVideo;
        document.getElementById('videoSwitchBtn').onclick = switchCamera;

        // 点击遮罩关闭
        overlay.onclick = function (e) {
            if (e.target === overlay) closeOverlay();
        };

        // 立即启动摄像头预览
        initCamera();
    }

    // ─── 摄像头初始化 ──────────────────────────────────────
    async function initCamera() {
        const statusEl = document.getElementById('videoStatus');
        const startBtn = document.getElementById('videoStartBtn');

        try {
            statusEl.textContent = '正在请求摄像头权限...';
            statusEl.className = 'video-status';

            const constraints = {
                video: {
                    width: { ideal: VIDEO_WIDTH },
                    height: { ideal: VIDEO_HEIGHT },
                    frameRate: { ideal: VIDEO_FPS },
                    facingMode: { ideal: currentFacingMode }
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
            }

            const videoEl = document.getElementById('videoPreview');
            videoEl.srcObject = mediaStream;

            if (mediaStream.getAudioTracks().length > 0) {
                statusEl.textContent = '摄像头已就绪，点击"开始录制"';
            } else {
                statusEl.textContent = '摄像头已就绪（无音频），点击"开始录制"';
            }
            startBtn.disabled = false;
        } catch (err) {
            console.error('[视频录制] 摄像头初始化失败:', err);
            statusEl.textContent = '摄像头初始化失败：' + (err.message || err.name || '未知错误');
            statusEl.className = 'video-status error';
            startBtn.disabled = true;
        }
    }

    // ─── 切换摄像头 ────────────────────────────────────────
    function switchCamera() {
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        initCamera();
    }

    // ─── 开始录制 ──────────────────────────────────────────
    function startRecording() {
        if (!mediaStream) {
            setStatus('摄像头未就绪，请重试', 'error');
            return;
        }

        // 选择支持的编码格式
        const mimeTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        let selectedMime = '';
        for (const mt of mimeTypes) {
            if (MediaRecorder.isTypeSupported(mt)) {
                selectedMime = mt;
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

        // 每 1 秒收集一次数据，避免内存堆积
        mediaRecorder.start(1000);
        recordingStartTime = Date.now();

        // 更新 UI
        document.getElementById('videoStartBtn').disabled = true;
        document.getElementById('videoStopBtn').disabled = false;
        document.getElementById('videoRecIndicator').classList.add('active');
        document.getElementById('videoTimer').style.display = 'block';

        setStatus('录制中...', '');

        // 启动计时器
        timerInterval = setInterval(updateTimer, 200);

        // 最大时长自动停止
        setTimeout(function () {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                stopRecording();
            }
        }, MAX_DURATION * 1000);
    }

    // ─── 停止录制 ──────────────────────────────────────────
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

    // ─── 录制停止回调 ──────────────────────────────────────
    function onRecordingStop(mimeType) {
        const blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
        const sizeMB = (blob.size / 1024 / 1024).toFixed(2);

        // 生成文件名：患者姓名_处方编号_video.webm（如：张三_26070701_video.webm）
        const fileName = generateFileName('video');

        // 暂存 blob 供保存按钮使用
        window.__pendingVideoBlob = blob;
        window.__pendingVideoFileName = fileName;

        document.getElementById('videoSaveBtn').disabled = false;
        setStatus('录制完成，大小 ' + sizeMB + ' MB，正在自动保存...', 'success');
        setTimeout(saveVideo, 300);
    }

    // ─── 保存视频 ──────────────────────────────────────────
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
            const arrayBuffer = await blob.arrayBuffer();
            const result = await window.electronAPI.saveVideoFile(arrayBuffer, fileName);

            if (result.success) {
                setStatus('视频已保存：' + result.fileName, 'success');
                if (typeof showToast === 'function') {
                    showToast('视频已保存到 downloads/' + getCurrentMonthFolder() + '/' + result.fileName);
                }
                // 保存成功后关闭浮层
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

    let currentCaptureStep = 1;
    let capturedPhotos = [];

    // ─── 拍照浮层 ───────────────────────────────────────────
    function openPhotoOverlay() {
        // 移除已有浮层（包括录制浮层）
        const existing = document.getElementById('videoOverlay');
        if (existing) existing.remove();

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

        // 绑定事件
        document.getElementById('videoCloseBtn').onclick = closeOverlay;
        document.getElementById('photoCaptureBtn2').onclick = capturePhoto;
        document.getElementById('photoSaveBtn').onclick = savePhoto;
        document.getElementById('photoRetakeBtn').onclick = retakePhoto;
        document.getElementById('photoSwitchBtn').onclick = switchCameraForPhoto;
        document.getElementById('photoNextBtn').onclick = nextCaptureStep;

        // 点击遮罩关闭
        overlay.onclick = function (e) {
            if (e.target === overlay) closeOverlay();
        };

        // 启动摄像头（拍照不需要音频）
        initCameraForPhoto();
    }

    // ─── 拍照用摄像头初始化（无音频） ─────────────────────
    async function initCameraForPhoto() {
        const statusEl = document.getElementById('videoStatus');
        const captureBtn = document.getElementById('photoCaptureBtn2');

        try {
            statusEl.textContent = '正在请求摄像头权限...';
            statusEl.className = 'video-status';

            mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: VIDEO_WIDTH },
                    height: { ideal: VIDEO_HEIGHT },
                    frameRate: { ideal: VIDEO_FPS },
                    facingMode: { ideal: currentFacingMode }
                },
                audio: false
            });

            const videoEl = document.getElementById('videoPreview');
            videoEl.srcObject = mediaStream;

            statusEl.textContent = '摄像头已就绪，点击"拍照"';
            captureBtn.disabled = false;
        } catch (err) {
            console.error('[拍照] 摄像头初始化失败:', err);
            statusEl.textContent = '摄像头初始化失败：' + (err.message || err.name || '未知错误');
            statusEl.className = 'video-status error';
            captureBtn.disabled = true;
        }
    }

    // ─── 拍照切换摄像头 ────────────────────────────────────
    function switchCameraForPhoto() {
        currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        initCameraForPhoto();
    }

    // ─── 拍照：捕获当前帧到 Canvas ─────────────────────────
    function capturePhoto() {
        const videoEl = document.getElementById('videoPreview');
        const canvasEl = document.getElementById('photoCanvas');
        if (!videoEl || !canvasEl || !mediaStream) {
            setStatus('摄像头未就绪', 'error');
            return;
        }

        // 等待 video 元素准备好
        if (!videoEl.videoWidth || !videoEl.videoHeight) {
            setStatus('视频流尚未就绪，请稍候', 'error');
            return;
        }

        // 设置 canvas 尺寸为视频原始尺寸
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;

        // 绘制当前帧到 canvas
        const ctx = canvasEl.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

        // 保存当前照片数据
        const dataUrl = canvasEl.toDataURL('image/jpeg', 0.8);
        capturedPhotos[currentCaptureStep - 1] = dataUrl;

        // 闪光效果
        const flash = document.getElementById('photoFlash');
        if (flash) {
            flash.classList.add('active');
            setTimeout(function () { flash.classList.remove('active'); }, 150);
        }

        // 切换显示：隐藏 video，显示 canvas
        videoEl.style.display = 'none';
        canvasEl.style.display = 'block';

        // 隐藏示意图
        const guideOverlay = document.getElementById('photoGuideOverlay');
        if (guideOverlay) guideOverlay.style.display = 'none';

        // 更新按钮状态
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

    // ─── 下一步：切换到第二采集步骤 ──────────────────────
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

        // 更新步骤指示
        const stepItems = document.querySelectorAll('.step-item');
        if (stepItems[0]) stepItems[0].classList.remove('active');
        if (stepItems[1]) stepItems[1].classList.add('active');

        // 更新示意图
        updatePhotoGuide(2);

        // 恢复摄像头预览
        const videoEl = document.getElementById('videoPreview');
        const canvasEl = document.getElementById('photoCanvas');
        if (videoEl) videoEl.style.display = '';
        if (canvasEl) canvasEl.style.display = 'none';

        // 更新按钮状态
        document.getElementById('photoCaptureBtn2').disabled = false;
        document.getElementById('photoNextBtn').style.display = 'none';
        document.getElementById('photoRetakeBtn').disabled = true;

        setStatus('请采集舌下络脉图像，点击"拍照"', '');
    }

    // ─── 保存照片：Canvas → PNG → IPC 写文件 ──────────────
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
                } else {
                    console.error('[拍照] 保存失败:', result.error);
                }
            }

            if (successCount === capturedPhotos.length) {
                setStatus('照片已全部保存', 'success');
                if (typeof showToast === 'function') {
                    showToast('照片已保存到 downloads/' + getCurrentMonthFolder() + '/');
                }
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

    // ─── 重拍：恢复摄像头预览 ──────────────────────────────
    function retakePhoto() {
        const videoEl = document.getElementById('videoPreview');
        const canvasEl = document.getElementById('photoCanvas');
        if (videoEl) videoEl.style.display = '';
        if (canvasEl) canvasEl.style.display = 'none';

        document.getElementById('photoCaptureBtn2').disabled = false;
        document.getElementById('photoRetakeBtn').disabled = true;
        document.getElementById('photoNextBtn').style.display = 'none';
        document.getElementById('photoSaveBtn').style.display = 'none';

        // 显示示意图
        updatePhotoGuide(currentCaptureStep);

        if (currentCaptureStep === 1) {
            setStatus('摄像头已就绪，点击"拍照"采集舌面图像', '');
        } else {
            setStatus('摄像头已就绪，点击"拍照"采集舌下络脉图像', '');
        }
    }

    // ─── 工具函数 ──────────────────────────────────────────
    function generateFileName(type, subtype = '') {
        let patientName = '';
        
        patientName = patientName || (document.getElementById('patientName')?.value || '').trim();
        patientName = patientName || (document.getElementById('paperName')?.textContent || '').trim();
        
        const prescriptionNo = (document.getElementById('prescriptionNo')?.value || '').trim() || 
                               (document.getElementById('clinicNo')?.value || '').trim();
        
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

        const ext = type === 'video' ? 'webm' : 'jpg';
        const sub = subtype ? '_' + subtype : '';
        return identifier + '_' + cleanName + '_' + type + sub + '.' + ext;
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
        // 停止录制（如果进行中）
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
        }
        // 释放摄像头
        if (mediaStream) {
            mediaStream.getTracks().forEach(function (t) { t.stop(); });
            mediaStream = null;
        }
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        // 移除浮层
        const overlay = document.getElementById('videoOverlay');
        if (overlay) overlay.remove();
        // 清理暂存
        window.__pendingVideoBlob = null;
        window.__pendingVideoFileName = null;
        // 清理拍照状态
        currentCaptureStep = 1;
        capturedPhotos = [];
    }

    // ─── 初始化 ────────────────────────────────────────────
    function init() {
        injectStyles();
        // 尝试注入按钮，若历史栏尚未渲染则重试
        if (!injectButton()) {
            var retryCount = 0;
            var retryTimer = setInterval(function () {
                if (injectButton() || ++retryCount > 30) {
                    clearInterval(retryTimer);
                }
            }, 1000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
