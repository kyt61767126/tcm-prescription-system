/*
 * 注入脚本：electronAPI 桥接 shim（云端 APP 页面运行依赖）
 * 语义逐字提取自安卓云端版 MainActivity.injectElectronApiShim（2026-09-01）
 * 作用：在远程云端页面上构造 window.electronAPI，全部代理到 AndroidNative.invoke
 * 注入时机：onPageEnd（与安卓 onPageFinished 一致，先于 video-recorder-inject.js）
 */
(function() {
  if (window.electronAPI && window.electronAPI.__nativeBridgeProxy) return;
  function callNative(name, args) {
    try {
      var r = AndroidNative.invoke(name, JSON.stringify(args));
      if (r === null || r === undefined || r === '' || r === 'null') { return JSON.stringify({success:false, error:'原生桥'+name+'返回空(原生端未捕获异常)'}); }
      return r;
    } catch(e){ return JSON.stringify({success:false,error:String(e)}); }
  }
  function callNativeAsync(name, args) {
    return new Promise(function(resolve, reject) {
      try {
        var r = callNative(name, args);
        var obj = JSON.parse(r);
        if (obj === null || obj === undefined) { resolve({success:false, error:'原生桥'+name+'返回空结果'}); return; }
        resolve(obj);
      } catch(e) { reject(e); }
    });
  }
  // ★ 2026-10-16 一键激活 P0：bnzc 机器码三级口径（bnzcRedeemToken / bnzcAutoActivate
  //   共用同一实现，保证两方法 machineId 完全同源同值；与 auth-core collectDeviceIdentity
  //   同口径，不新造第三种身份）：
  //   ① 桥 getMachineId（当前鸿蒙原生未注册该 case，正则不过自动落 ②）
  //   ② localStorage auth:deviceMachineId 持久化指纹（browser-xxx，与登录心跳同 key 同源）
  //   ③ 缺失时生成并写回（与 auth-core 生成式一字不差）
  function bnzcMachineId() {
    var machineId = '';
    try {
      var hw = String(AndroidNative.invoke('getMachineId', '{}') || '').trim();
      if (/^[A-Za-z0-9_-]{8,64}$/.test(hw)) machineId = hw;
    } catch (e3) { /* 桥异常走指纹兜底 */ }
    if (!machineId) {
      try {
        var KEY = 'auth:deviceMachineId';
        var fp = localStorage.getItem(KEY);
        if (fp && /^[A-Za-z0-9_-]{8,64}$/.test(fp)) {
          machineId = fp;
        } else {
          var rnd = Array.from(crypto.getRandomValues(new Uint8Array(9)))
            .map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
          machineId = 'browser-' + rnd;
          localStorage.setItem(KEY, machineId);
        }
      } catch (e4) {
        machineId = 'browser-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      }
    }
    return machineId;
  }
  window.electronAPI = {
    __nativeBridgeProxy: true,
    isElectron: true,
    isAndroidAPP: true,
    saveUserData: function(key, data) { return new Promise(function(resolve){ try { localStorage.setItem(key, JSON.stringify(data)); resolve(true); } catch(e){ resolve(false); } }); },
    getUserData: function(key) { return new Promise(function(resolve){ try { var v = localStorage.getItem(key); resolve(v ? JSON.parse(v) : null); } catch(e){ resolve(null); } }); },
    loginSuccess: function(user) { return new Promise(function(resolve){ try { localStorage.setItem('currentUser', JSON.stringify(user)); resolve(true); } catch(e){ resolve(false); } }); },
    getCurrentUser: function() { return new Promise(function(resolve){ try { var v = localStorage.getItem('currentUser'); resolve(v ? JSON.parse(v) : null); } catch(e){ resolve(null); } }); },
    saveBackupFile: function(jsonStr, fileName) { return callNativeAsync('saveBackupFile', {jsonStr: jsonStr, fileName: fileName}); },
    listBackupFiles: function() { return callNativeAsync('listBackupFiles', {}); },
    readBackupFile: function(fileName) { return callNativeAsync('readBackupFile', {fileName: fileName}); },
    backupMedia: function() { return callNativeAsync('backupMedia', {}); },
    restoreMedia: function() { return callNativeAsync('restoreMedia', {}); },
    readFileAsBase64: function(filePath) {
      return new Promise(function(resolve){
        try {
          var sr = JSON.parse(callNative('startReadSession', {filePath: filePath}));
          if (sr && sr.success) {
            var sid = sr.sessionId, mime = sr.mimeType || 'application/octet-stream';
            var chunks = [], total = 0;
            function next() {
              var r = JSON.parse(callNative('readNextChunk', {sessionId: sid}));
              if (!r || !r.success) { callNative('closeReadSession', {sessionId: sid}); resolve({success:false, error:'readNextChunk失败: '+(r&&r.error||'未知')}); return; }
              if (r.chunk) { var b = atob(r.chunk); var arr = new Uint8Array(b.length); for (var i=0;i<b.length;i++) arr[i]=b.charCodeAt(i); chunks.push(arr); total += b.length; }
              if (r.eof) {
                callNative('closeReadSession', {sessionId: sid});
                var merged = new Uint8Array(total), off = 0;
                for (var i=0;i<chunks.length;i++) { merged.set(chunks[i], off); off += chunks[i].length; }
                var blob = new Blob([merged], {type: mime});
                if (window.__currentBlobUrl) { try { URL.revokeObjectURL(window.__currentBlobUrl); } catch(e){} }
                var url = URL.createObjectURL(blob);
                window.__currentBlobUrl = url;
                resolve({success: true, data: url});
              } else { setTimeout(next, 0); }
            }
            next();
          } else {
            var r = callNative('readFileAsBase64', {filePath: filePath});
            resolve(JSON.parse(r));
          }
        } catch(e) { resolve({success:false, error:String(e)}); }
      });
    },
    openFile: function(filePath, mimeType) { return callNativeAsync('openFile', {filePath: filePath, mimeType: mimeType||''}); },
    quitApp: function() { callNative('quitApp', {}); },
    printPrescription: function(html, orientation) { return callNativeAsync('printPrescription', {html: html, orientation: orientation||'portrait'}); },
    showToast: function(message) { callNative('showToast', {message: message}); },
    encryptData: function(data, key) { return callNativeAsync('encryptData', {data: data, key: key}); },
    decryptData: function(encryptedData, key) { return callNativeAsync('decryptData', {encryptedData: encryptedData, key: key}); },
    savePrescriptionImage: function(imageData, fileName) { return callNativeAsync('savePrescriptionImage', {imageData: imageData, fileName: fileName}); },
    saveVideoFile: function(base64Data, fileName) { return callNativeAsync('saveVideoFile', {base64Data: base64Data, fileName: fileName}); },
    startMediaSession: function(fileName) { return callNativeAsync('startMediaSession', {fileName: fileName}); },
    appendMediaChunk: function(sessionId, chunkBase64, index, total) { return callNativeAsync('appendMediaChunk', {sessionId: sessionId, chunkBase64: chunkBase64, index: index, total: total}); },
    commitMediaSession: function(sessionId, fileName, type) { return callNativeAsync('commitMediaSession', {sessionId: sessionId, fileName: fileName, type: type||'image'}); },
    findMediaFiles: function(patientName, prescriptionNo, createdAt) { return callNativeAsync('findMediaFiles', {patientName: patientName||'', prescriptionNo: prescriptionNo||'', createdAt: createdAt||''}); },
    renameMediaFiles: function(oldPatientName, newPatientName, oldNo, newNo) { return callNativeAsync('renameMediaFiles', {oldPatientName: oldPatientName||'', newPatientName: newPatientName||'', oldNo: oldNo||'', newNo: newNo||''}); },
    startReadSession: function(filePath) { return callNativeAsync('startReadSession', {filePath: filePath}); },
    readNextChunk: function(sessionId) { return callNativeAsync('readNextChunk', {sessionId: sessionId}); },
    closeReadSession: function(sessionId) { callNative('closeReadSession', {sessionId: sessionId}); },
    // ★ 2026-10-16 一键激活 P0：bnzc:// 深链方法（对齐桌面 Electron electronAPI 契约，
    //   供线上页面 bnzc JS 消费）。getPending/clearPending 代理原生 invoke 暂存；
    //   redeemToken / bnzcAutoActivate 在页面侧同源 fetch 服务端端点——原生 ArkTS http
    //   异步无法同步返回给 registerJavaScriptProxy 的 invoke，故不由原生代理。
    bnzcGetPendingActivation: function() { return callNativeAsync('bnzcGetPending', {}); },
    bnzcClearPendingActivation: function() { return callNativeAsync('bnzcClearPending', {}); },
    bnzcRedeemToken: function(token) {
      return new Promise(function(resolve) {
        try {
          var tk = String(token || '').trim();
          if (!/^[A-Za-z0-9_-]{32,64}$/.test(tk)) {
            resolve({success: false, error: '激活链接格式不正确'});
            return;
          }
          var machineId = bnzcMachineId(); // 三级口径与 bnzcAutoActivate 同源同值（见上方实现）
          // 页面本就加载自 tcm-prescription-system.pages.dev，相对路径同源无 CORS
          fetch('/api/license/activation-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ action: 'redeem', token: tk, machineId: machineId, productClass: 'cloud' })
          }).then(function(resp) {
            return resp.json().catch(function() { return {}; }).then(function(out) {
              if (!resp.ok || !out || out.success !== true) {
                var e2 = { success: false, error: (out && out.error) ? out.error : ('兑换失败（' + resp.status + '）') };
                if (out && out.reason) e2.reason = out.reason;
                resolve(e2);
                return;
              }
              resolve(out); // { success, code, clinic, user, productLock }
            });
          }).catch(function(e5) {
            resolve({ success: false, error: '网络异常：' + String((e5 && e5.message) || e5) });
          });
        } catch (e) {
          resolve({ success: false, error: '兑换异常：' + String(e) });
        }
      });
    },
    // ★ 2026-10-16 一键激活 P0：兑换码直激 bnzcAutoActivate——JS 同源 fetch POST
    //   /api/license/claim，口径对齐云 App MainActivity activateOnline（productClass=
    //   cloud / clientClass=app，桌面为 desktop）。超时 AbortController 40s（对齐桌面
    //   真机 claim 冷启实测 14~23s）。失败透传服务端 error；needClinicName 为防御性
    //   透传：claim 端点当前不返回该标记（渐进式表单仅 validate 端有），保留字段以
    //   兼容未来扩展。成功后 2600ms reload 兜底
    //   （App 无 license.restart，页面重载后云端配置即激活态，时序避开页面 1500ms
    //   restart 窗口）。
    bnzcAutoActivate: function(payload) {
      return new Promise(function(resolve) {
        var ac = null, timer = null;
        try {
          ac = new AbortController();
          timer = setTimeout(function() { try { ac.abort(); } catch (e6) {} }, 40000);
          // 页面本就加载自 tcm-prescription-system.pages.dev，相对路径同源无 CORS
          fetch('/api/license/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
              code: (payload && payload.code) || '',
              machineId: bnzcMachineId(),
              user: (payload && payload.user) || '',
              clinicName: (payload && payload.clinicName) || '',
              productClass: 'cloud',
              clientClass: 'app'
            }),
            signal: ac.signal
          }).then(function(resp) {
            return resp.json().catch(function() { return {}; }).then(function(out) {
              clearTimeout(timer);
              if (!resp.ok || !out || out.success !== true) {
                var e2 = { success: false, error: (out && out.error) ? out.error : '激活失败' };
                if (out && out.needClinicName !== undefined) e2.needClinicName = out.needClinicName; // 防御性透传：claim 端点当前无此标记
                resolve(e2);
                return;
              }
              resolve(out); // { success, license, licenseInfo, ... }
            });
          }).catch(function(e5) {
            clearTimeout(timer);
            var aborted = false;
            try { aborted = !!(ac.signal && ac.signal.aborted); } catch (e7) {}
            resolve({ success: false, error: aborted ? '网络异常：激活请求超时（40s）' : '网络异常：' + String((e5 && e5.message) || e5) });
          });
        } catch (e) {
          if (timer) clearTimeout(timer);
          resolve({ success: false, error: '激活异常：' + String(e) });
        }
      }).then(function(r) { try { if (r && r.success) setTimeout(function() { try { location.reload(); } catch(e){} }, 2600); } catch(e){} return r; });
    },
    onBnzcPendingActivation: function(cb) { window.__bnzcNativeCb = cb; }
  };
  // ★ 2026-10-16 一键激活 P0：原生 onNewWant（EntryAbility → Index → runJavaScript）
  //   直调的转发函数（两份 index.html 均不定义它，由本 shim 提供），转发到页面
  //   经 onBnzcPendingActivation 注册的回调。参数为已 JSON.parse 的对象。
  window.__bnzcEmitFromNative = function(data) {
    try {
      if (typeof window.__bnzcNativeCb === 'function') window.__bnzcNativeCb(data);
    } catch (e) {
      console.warn('[Bnzc] 派发失败', e);
    }
  };
})();
