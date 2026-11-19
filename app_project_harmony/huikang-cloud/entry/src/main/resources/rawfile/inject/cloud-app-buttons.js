/*
 * 注入脚本：APP 专属按钮布局（顶部5按钮 + 底部5按钮，云端 APP 动态修改，网页版不变）
 * 语义逐字提取自安卓云端版 MainActivity.injectAppButtonLayout（2026-09-01）
 * 注入时机：onPageEnd 立即一次 + 1500ms 重试一次（应对 React 异步渲染）
 */
(function() {
  // ★ 2026-11-19 验方列表按钮布局与离线 APP 同步（仅 APP 注入，网页/桌面不变）
  var __fc = document.getElementById('appFormulaCss');
  if (!__fc) {
    __fc = document.createElement('style');
    __fc.id = 'appFormulaCss';
    __fc.textContent =
      '#formulaList>div>div[style*="justify-content:space-between"]{flex-wrap:wrap}' +
      '#formulaList>div>div[style*="justify-content:space-between"]>div:first-child{width:100%}' +
      '#formulaList>div>div[style*="justify-content:space-between"]>div:last-child{width:100%;display:flex;gap:6px;margin-top:8px}' +
      '#formulaList>div>div[style*="justify-content:space-between"]>div:last-child .small-btn{flex:1;height:32px;font-size:12px;padding:0 4px;margin:0}';
    document.head.appendChild(__fc);
  }
  var topTabs = document.querySelector('.top-tabs-left');
  if (topTabs && !topTabs.getAttribute('data-app-modified')) {
    topTabs.setAttribute('data-app-modified', 'true');
    topTabs.style.display = 'flex';
    topTabs.innerHTML =
      '<div class="tab-left-item active" style="flex:1;text-align:center;">填资料</div>' +
      '<button class="action-btn" onclick="showModal(\'formulaModal\')" style="flex:1;padding:4px 0;font-size:12px;">验方设置</button>' +
      '<button class="action-btn" onclick="showModal(\'analyticsModal\')" style="flex:1;padding:4px 0;font-size:12px;">统计</button>' +
      '<button class="action-btn" onclick="printPrescription(\'portrait\')" style="flex:1;padding:4px 0;font-size:12px;">纵向打印</button>' +
      '<button class="action-btn" onclick="printPrescription(\'landscape\')" style="flex:1;padding:4px 0;font-size:12px;">横向打印</button>';
  }
  var actionBar = document.getElementById('mobileActionBar');
  if (actionBar && !actionBar.getAttribute('data-app-modified')) {
    actionBar.setAttribute('data-app-modified', 'true');
    var btns = actionBar.querySelector('.action-buttons');
    if (btns) {
      btns.style.display = 'flex';
      btns.innerHTML =
        '<button class="action-btn" style="flex:1;" onclick="if(window.openRecordingOverlay)window.openRecordingOverlay();else alert(\'录像功能加载中，请稍候\')">🎥 录像</button>' +
        '<button class="action-btn" style="flex:1;" onclick="if(window.openPhotoOverlay)window.openPhotoOverlay();else alert(\'拍照功能加载中，请稍候\')">📷 拍照</button>' +
        '<button class="action-btn primary" style="flex:1;" onclick="savePrescription()">💾 保存</button>' +
        '<button class="action-btn" style="flex:1;" onclick="clearPrescription()">🗑️ 清空</button>' +
        '<button class="action-btn" style="flex:1;" id="mobileActionBtn2" onclick="showChangePwdModal()">🔐 改密</button>';
    }
  }
  var __appFixBtn = function() {
    var btn2 = document.getElementById('mobileActionBtn2');
    if (!btn2) return;
    var u = (typeof currentUser !== 'undefined') ? currentUser : window.currentUser;
    var canManage = false;
    if (u) {
      try {
        if (window.Permission && Permission.shouldShowUserManage) {
          canManage = Permission.shouldShowUserManage(u);
        } else if (window.AuthCore && AuthCore.isClinicAdmin) {
          canManage = AuthCore.isClinicAdmin(u) || AuthCore.isPlatformAdmin(u);
        } else {
          canManage = (u.role === 'admin' || u.role === 'clinic_admin' || u.role === 'platform_admin');
        }
      } catch (e) { canManage = (u.role === 'admin' || u.role === 'clinic_admin' || u.role === 'platform_admin'); }
    }
    if (canManage) {
      btn2.innerHTML = '👤 用户';
      btn2.onclick = function() { showUserManageModal(); };
    } else {
      btn2.innerHTML = '🔐 改密';
      btn2.onclick = function() { showChangePwdModal(); };
    }
    btn2.style.display = '';
  };
  window.updateMobileActionButtons = __appFixBtn;
  __appFixBtn();
  setInterval(__appFixBtn, 500);
})();
