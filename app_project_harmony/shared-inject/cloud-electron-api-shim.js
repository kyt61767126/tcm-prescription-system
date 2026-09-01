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
    closeReadSession: function(sessionId) { callNative('closeReadSession', {sessionId: sessionId}); }
  };
})();
