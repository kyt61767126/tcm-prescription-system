window.addEventListener('DOMContentLoaded', function() {
  const version = '2.1.0-cloud';
  
  function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  function getDefaultUsers() {
    return [
      {username: 'admin', password: hashPassword('admin123'), name: '管理员', role: 'admin'},
      {username: 'doctor1', password: hashPassword('doctor123'), name: '张医生', role: 'user'},
      {username: 'doctor2', password: hashPassword('doctor123'), name: '李医生', role: 'user'}
    ];
  }

  function getUsers() {
    const saved = localStorage.getItem('cloudUsers');
    return saved ? JSON.parse(saved) : getDefaultUsers();
  }

  function saveUsers(users) {
    localStorage.setItem('cloudUsers', JSON.stringify(users));
  }

  function renderLogin() {
    const html = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Microsoft YaHei', 'SimSun', sans-serif; background: #f0f0f0; font-size: 13px; overflow: hidden; }
        .login-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; justify-content: center; align-items: center; z-index: 9999; }
        .login-box { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); width: 350px; text-align: center; }
        .login-title { font-size: 24px; font-weight: bold; color: #333; margin-bottom: 30px; }
        .login-input { width: 100%; padding: 12px 15px; margin: 10px 0; border: 2px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
        .login-input:focus { border-color: #667eea; outline: none; }
        .login-btn { width: 100%; padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 15px; }
        .login-btn:hover { opacity: 0.9; }
        .login-error { color: #ff4444; font-size: 12px; margin-top: 10px; display: none; }
        .version-tag { color: #008000; font-weight: bold; margin-bottom: 20px; }
      </style>
      <div id="loginOverlay" class="login-overlay">
        <div class="login-box">
          <div class="login-title">🏥 本能中医处方系统</div>
          <div class="version-tag">【云端版 v${version}】</div>
          <input type="text" id="loginUsername" class="login-input" placeholder="请输入用户名">
          <input type="password" id="loginPassword" class="login-input" placeholder="请输入密码" onkeypress="if(event.key==='Enter')handleLogin()">
          <button class="login-btn" onclick="handleLogin()">登 录</button>
          <div id="loginError" class="login-error"></div>
        </div>
      </div>
    `;
    document.body.innerHTML = html;
  }

  function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    if (!username || !password) {
      errorDiv.textContent = '请输入用户名和密码';
      errorDiv.style.display = 'block';
      return;
    }
    
    const users = getUsers();
    const hashedPassword = hashPassword(password);
    const user = users.find(u => u.username === username && u.password === hashedPassword);
    
    if (user) {
      localStorage.setItem('currentUser', JSON.stringify(user));
      renderMain(user);
    } else {
      errorDiv.textContent = '用户名或密码错误';
      errorDiv.style.display = 'block';
    }
  }

  function handleLogout() {
    localStorage.removeItem('currentUser');
    sessionStorage.removeItem('currentUser');
    renderLogin();
  }

  function renderMain(user) {
    const html = `
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        @page { size: A5; margin: 0; }
        @media print {
          body { background: white; }
          .top-tabs, .left-panel, .right-panel, .bottom-bar, .tab-left-item, .action-buttons-section, .section-hint, .patient-section, .symptom-section, .diagnosis-section { display: none !important; }
          .main-container { display: block !important; height: auto !important; width: 100% !important; overflow: visible !important; }
          .center-panel { background: white !important; padding: 0 !important; margin: 0 auto !important; width: 148mm !important; display: block !important; min-width: auto !important; }
          .prescription-paper { width: 148mm !important; height: 210mm !important; padding: 15mm !important; margin: 0 auto !important; box-shadow: none !important; page-break-after: always !important; }
        }
        body { font-family: 'Microsoft YaHei', 'SimSun', sans-serif; background: #f0f0f0; font-size: 13px; overflow: hidden; }
        .top-tabs { background: #c0c0c0; border-bottom: 2px solid #808080; display: flex; padding: 3px 5px 0 5px; flex-wrap: wrap; align-items: center; }
        .tab-item { background: #e0e0e0; padding: 4px 15px; cursor: pointer; border: 1px solid #808080; border-bottom: none; margin-right: 2px; border-radius: 3px 3px 0 0; font-weight: bold; font-size: 12px; white-space: nowrap; }
        .tab-item:hover { background: #d0d0d0; }
        .tab-hint { font-size: 10px; color: #555; padding-left: 10px; line-height: 26px; flex: 1; }
        .main-container { display: flex; height: calc(100vh - 38px); width: 100vw; overflow: hidden; }
        .left-panel { width: 40%; min-width: 340px; max-width: 440px; background: #e0e0e0; border-right: 2px solid #808080; display: flex; flex-direction: column; height: 100%; overflow: hidden; }
        .top-tabs-left { background: #e0e0e0; display: flex; border-bottom: 2px solid #808080; }
        .tab-left-item { background: #d0d0d0; padding: 3px 12px; cursor: pointer; border: 1px solid #808080; border-bottom: none; margin-right: 2px; font-size: 11px; }
        .tab-left-item.active { background: white; }
        .patient-section { background: white; padding: 5px; border-bottom: 2px solid #808080; flex-shrink: 0; }
        .patient-row { display: flex; margin-bottom: 6px; align-items: center; gap: 5px; }
        .patient-label { width: 50px; text-align: right; padding-right: 6px; font-size: 11px; flex-shrink: 0; }
        .patient-input { flex: 1; padding: 4px 6px; border: 1px solid #808080; font-size: 12px; min-width: 30px; height: 22px; box-sizing: border-box; }
        .patient-input.x-small { flex: 0 0 50px; }
        .patient-input.xx-small { flex: 0 0 80px; }
        .patient-input.xxx-small { flex: 0 0 110px; }
        .patient-input.small { flex: 0 0 120px; }
        .symptom-section { background: white; padding: 4px 8px; border-bottom: 2px solid #808080; flex-shrink: 0; }
        .symptom-textarea { width: 100%; height: 30px; border: 1px solid #808080; padding: 2px; resize: none; font-size: 10px; }
        .diagnosis-section { background: white; padding: 2px 4px; border-bottom: 2px solid #808080; flex-shrink: 0; }
        .action-buttons-section { background: white; padding: 4px 8px; border-bottom: 2px solid #808080; flex-shrink: 0; }
        .small-btn { padding: 2px 8px; background: #e0e0e0; border: 1px solid #808080; cursor: pointer; font-size: 10px; }
        .medicine-section { flex: 1; background: white; overflow: hidden; display: flex; flex-direction: column; min-height: 180px; }
        .medicine-table-container { flex: 1; overflow: auto; }
        .medicine-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .medicine-table th { background: #e0e0e0; border: 1px solid #808080; padding: 3px; font-weight: normal; font-size: 10px; }
        .medicine-table td { border: 1px solid #d0d0d0; padding: 1px; }
        .medicine-table input { width: 100%; border: none; padding: 2px; text-align: center; font-size: 11px; }
        .medicine-table input:focus { background: #e8f5e9; }
        .center-panel { flex: 1; background: #b0b0b0; padding: 10px; overflow: auto; display: flex; justify-content: center; align-items: flex-start; min-width: 350px; }
        .prescription-paper { background: white; width: 148mm; height: 210mm; padding: 15mm; box-shadow: 3px 3px 10px rgba(0,0,0,0.3); font-family: 'SimSun', serif; box-sizing: border-box; }
        .clinic-name { text-align: center; font-size: 18px; font-weight: bold; color: #2c5530; margin-bottom: 10px; }
        .prescription-title { text-align: center; font-size: 18px; font-weight: bold; color: #8b0000; margin-bottom: 12px; }
        .prescription-info { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 10px; border-bottom: 1px solid #000; padding-bottom: 6px; font-size: 12px; }
        .prescription-grid { border-top: 1px solid #000; border-bottom: 1px solid #000; min-height: 180px; }
        .rp-mark { font-size: 22px; font-weight: bold; font-style: italic; color: #8b0000; }
        .dose-count { text-align: right; font-size: 13px; color: #000080; }
        .prescription-footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #000; font-size: 12px; }
        .signature-row { display: flex; justify-content: space-between; }
        .right-panel { width: 32%; min-width: 220px; max-width: 340px; background: white; border-left: 2px solid #808080; display: flex; flex-direction: column; height: 100%; }
        .history-header { background: #000080; color: white; padding: 6px 8px; font-weight: bold; font-size: 12px; flex-shrink: 0; }
        .history-list { flex: 1; overflow-y: auto; }
        .history-item { padding: 6px 8px; border-bottom: 1px solid #d0d0d0; cursor: pointer; font-size: 11px; }
        .history-item:hover { background: #e8f5e9; }
        .bottom-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #c0c0c0; border-top: 2px solid #808080; padding: 5px 10px; display: flex; justify-content: space-between; align-items: center; z-index: 100; }
        .price-summary { display: flex; gap: 10px; flex-wrap: wrap; }
        .price-item { font-weight: bold; font-size: 11px; }
        .price-item span { color: #8b0000; font-size: 13px; }
        .action-buttons { display: flex; gap: 5px; }
        .action-btn { padding: 4px 10px; background: #e0e0e0; border: 2px solid #808080; cursor: pointer; font-weight: bold; font-size: 11px; }
        .action-btn.primary { background: #008000; color: white; border-color: #006000; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); justify-content: center; align-items: center; z-index: 2000; }
        .modal-content { background: #e0e0e0; border: 3px solid #808080; width: 80%; max-width: 900px; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; }
        .modal-header { background: #000080; color: white; padding: 8px 15px; display: flex; justify-content: space-between; align-items: center; }
        .modal-body { flex: 1; overflow: auto; padding: 15px; background: white; }
        .modal-footer { padding: 10px 15px; background: #e0e0e0; display: flex; justify-content: flex-end; gap: 10px; border-top: 2px solid #808080; }
        .close-btn { font-size: 24px; cursor: pointer; line-height: 1; }
        .user-modal-content { width: 350px; }
        .form-group { margin: 15px 0; text-align: left; }
        .form-group label { display: block; margin-bottom: 5px; font-weight: bold; font-size: 12px; color: #333; }
        .form-group input { width: 100%; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 13px; box-sizing: border-box; }
        .user-list { max-height: 200px; overflow-y: auto; margin: 15px 0; border: 1px solid #ddd; border-radius: 6px; }
        .user-item { display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee; }
        .user-item:last-child { border-bottom: none; }
        .user-item-btn { padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; }
        .btn-danger { background: #ff4444; color: white; }
      </style>
      <div class="top-tabs">
        <div class="tab-item" onclick="showModal('settingsModal')">【基础设置】</div>
        <div class="tab-item" onclick="showModal('caseModal')">【病例管理】</div>
        <div class="tab-item" onclick="showModal('medicineModal')">【药品管理】</div>
        <div class="tab-item" onclick="showModal('formulaModal')">【验方设置】</div>
        <div class="tab-item" onclick="showModal('statsModal')">【数据管理】</div>
        <div class="tab-item" id="userManageBtn" onclick="showUserManageModal()">【用户管理】</div>
        <div class="tab-item" onclick="showHelp()">【系统帮助】</div>
        <div class="tab-item" style="background:#ffdddd;color:#8b0000;" onclick="handleLogout()">【退出登录】</div>
        <div class="tab-item" onclick="showChangePwdModal()">【修改密码】</div>
        <div class="tab-hint">
          当前用户: <span style="color:#008000;font-weight:bold;">${user.name}</span> | 
          <span style="color:#008000;font-weight:bold;">【云端版 v${version}】</span>
        </div>
      </div>
      <div class="main-container">
        <div class="left-panel">
          <div class="top-tabs-left">
            <div class="tab-left-item active">填资料</div>
            <div class="tab-left-item">调原方</div>
            <div class="tab-left-item">调病历</div>
            <div class="tab-left-item">同病搜</div>
          </div>
          <div class="patient-section">
            <div class="patient-row">
              <span class="patient-label" style="width: 45px;">处方<br/>编号</span>
              <input type="text" id="prescriptionNo" class="patient-input xxx-small" readonly>
              <span class="patient-label">性别</span>
              <select id="patientGender" class="patient-input.x-small" onchange="updatePrescriptionPaper()">
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
              <span class="patient-label">日期</span>
              <input type="text" id="visitDate" class="patient-input.x-small" readonly style="width:90px;">
            </div>
            <div class="patient-row">
              <span class="patient-label">姓名</span>
              <input type="text" id="patientName" class="patient-input" onkeyup="updatePrescriptionPaper()">
              <span class="patient-label">年龄</span>
              <input type="text" id="patientAge" class="patient-input xx-small" onkeyup="updatePrescriptionPaper()">
              <span class="patient-label">电话</span>
              <input type="text" id="patientPhone" class="patient-input small">
            </div>
            <div class="patient-row">
              <span class="patient-label">编号</span>
              <input type="text" id="clinicNo" class="patient-input xx-small" onkeyup="updatePrescriptionPaper()">
              <span class="patient-label">住址</span>
              <input type="text" id="patientAddress" class="patient-input" style="flex: 1.2;">
            </div>
          </div>
          <div class="symptom-section">
            <textarea id="medicalHistory" class="symptom-textarea" placeholder="病史症状"></textarea>
          </div>
          <div class="diagnosis-section">
            <div class="patient-row">
              <span class="patient-label">诊断</span>
              <input type="text" id="diagnosis" class="patient-input" style="flex: 1;" onkeyup="updatePrescriptionPaper()">
              <span class="patient-label">金额</span>
              <input type="text" class="patient-input.x-small" id="tempAmount" readonly style="width: 45px;">
              <span class="patient-label">医师</span>
              <input type="text" id="doctorName" class="patient-input.x-small" onkeyup="updatePrescriptionPaper()" style="width: 55px;">
            </div>
          </div>
          <div class="action-buttons-section">
            <button class="small-btn" onclick="clearAllMedicines()">一键删除所有药物</button>
          </div>
          <div class="medicine-section">
            <div style="background:#d0d0d0;padding:3px 8px;font-size:10px;border-bottom:1px solid #808080;">
              提示: 在简码栏输入简码，在药名栏输入药名
            </div>
            <div class="medicine-table-container">
              <table class="medicine-table" id="prescriptionTable">
                <thead>
                  <tr>
                    <th style="width:25px;">#</th>
                    <th style="width:45px;">简码</th>
                    <th style="width:90px;">药物</th>
                    <th style="width:40px;">数量</th>
                    <th style="width:30px;">单位</th>
                    <th style="width:40px;">单价</th>
                    <th style="width:45px;">合计</th>
                    <th style="width:30px;">删</th>
                  </tr>
                </thead>
                <tbody id="prescriptionBody">
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="center-panel">
          <div class="prescription-paper" id="prescriptionPaper">
            <div class="clinic-name" id="clinicNameDisplay">惠康堂中医诊所</div>
            <div class="prescription-title">处 方 笺</div>
            <div class="prescription-info">
              <div>姓名: <span id="paperName"></span></div>
              <div>性别: <span id="paperGender"></span></div>
              <div>年龄: <span id="paperAge"></span>岁</div>
              <div>科别: 中医内科</div>
              <div>门诊号: <span id="paperClinicNo"></span></div>
              <div>日期: <span id="paperDate"></span></div>
            </div>
            <div style="margin-bottom:8px;">
              <span>诊断: <span id="paperDiagnosis"></span></span>
            </div>
            <div class="prescription-grid">
              <div style="border-bottom:1px solid #000; display:flex; justify-content:space-between; align-items:center;">
                <div class="rp-mark">RP</div>
                <div></div>
                <div class="dose-count"><span id="paperDoseCount">7</span>剂</div>
              </div>
              <div id="prescriptionLines"></div>
            </div>
            <div class="prescription-footer">
              <div>用法: 水煎服，日一剂，早晚分服</div>
              <div class="signature-row">
                <span>医师: <span id="paperDoctor"></span>（签字）</span>
                <span>配方: ________ 复核: ________</span>
              </div>
            </div>
          </div>
        </div>
        <div class="right-panel">
          <div class="history-header">处方历史</div>
          <div class="history-list" id="historyList">
            <div style="text-align:center;color:#999;padding:20px;font-size:11px;">请输入患者姓名</div>
          </div>
        </div>
      </div>
      <div class="bottom-bar">
        <div class="price-summary">
          <div class="price-item">每剂: <span id="perDosePrice" style="color:red;font-weight:bold;">0.00</span>元</div>
          <div class="price-item">药费: <span id="totalPrice">0.00</span>元</div>
          <div class="price-item">剂数: <input type="number" id="doseCountInput" value="7" style="width:40px;padding:2px;font-weight:bold;" onchange="updateDoseCount()">剂</div>
          <div class="price-item">诊疗费: <input type="number" id="registrationFee" value="0" style="width:40px;padding:2px;" onchange="calculateAmount()">元</div>
          <div class="price-item">总计: <span id="grandTotal" style="color:red;font-weight:bold;">0.00</span>元</div>
        </div>
        <div class="action-buttons">
          <button class="action-btn" onclick="clearPrescription()">重输</button>
          <button class="action-btn" onclick="saveAsFormula()">存验方</button>
          <button class="action-btn" onclick="printPrescription('portrait')">纵向打印</button>
          <button class="action-btn" onclick="printPrescription('landscape')">横向打印</button>
          <button class="action-btn primary" onclick="savePrescription()">保存</button>
        </div>
      </div>
      <div class="modal" id="changePwdModal">
        <div class="modal-content user-modal-content">
          <div class="modal-header">
            <span>修改密码</span>
            <span class="close-btn" onclick="closeModal('changePwdModal')">&times;</span>
          </div>
          <div class="modal-body">
            <div class="form-group"><label>原密码</label><input type="password" id="oldPwd" placeholder="请输入原密码"></div>
            <div class="form-group"><label>新密码</label><input type="password" id="newPwd" placeholder="请输入新密码"></div>
            <div class="form-group"><label>确认新密码</label><input type="password" id="confirmNewPwd" placeholder="请再次输入新密码"></div>
          </div>
          <div class="modal-footer">
            <button class="action-btn" onclick="closeModal('changePwdModal')">取消</button>
            <button class="action-btn primary" onclick="handleChangePassword()">修改</button>
          </div>
        </div>
      </div>
      <div class="modal" id="userManageModal">
        <div class="modal-content user-modal-content">
          <div class="modal-header">
            <span>用户管理</span>
            <span class="close-btn" onclick="closeModal('userManageModal')">&times;</span>
          </div>
          <div class="modal-body">
            <div id="userList" class="user-list"></div>
            <div class="form-group" style="margin-top:15px;">
              <label>添加新用户</label>
              <input type="text" id="newUserUsername" placeholder="用户名">
              <input type="password" id="newUserPassword" placeholder="密码" style="margin-top:5px;">
              <input type="text" id="newUserName" placeholder="姓名/昵称" style="margin-top:5px;">
            </div>
          </div>
          <div class="modal-footer">
            <button class="action-btn" onclick="closeModal('userManageModal')">关闭</button>
            <button class="action-btn primary" onclick="handleAddUser()">添加用户</button>
          </div>
        </div>
      </div>
      <div class="modal" id="settingsModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>F1 基础设置</h3>
            <span class="close-btn" onclick="closeModal('settingsModal')">&times;</span>
          </div>
          <div class="modal-body">
            <div style="margin-bottom:12px;">
              <label>诊所名称:</label>
              <input type="text" id="clinicName" style="width:100%;padding:6px;margin-top:4px;">
            </div>
            <div style="margin-bottom:12px;">
              <label>医师姓名:</label>
              <input type="text" id="defaultDoctor" style="width:100%;padding:6px;margin-top:4px;">
            </div>
            <div style="margin-bottom:12px;">
              <label>默认挂号费:</label>
              <input type="number" id="defaultRegFee" style="width:100%;padding:6px;margin-top:4px;">
            </div>
            <div style="margin-bottom:12px;">
              <label>默认剂数:</label>
              <input type="number" id="defaultDose" style="width:100%;padding:6px;margin-top:4px;">
            </div>
            <hr style="margin:15px 0;">
            <div style="text-align:center;">
              <button class="action-btn" onclick="backupData()">备份数据</button>
              <button class="action-btn" onclick="restoreData()">恢复数据</button>
              <button class="action-btn" onclick="clearAllData()" style="background:#ffdddd;">清空数据</button>
            </div>
          </div>
          <div class="modal-footer">
            <button class="action-btn" onclick="closeModal('settingsModal')">取消</button>
            <button class="action-btn primary" onclick="saveSettings()">保存</button>
          </div>
        </div>
      </div>
      <div class="modal" id="medicineModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>F2 药品管理</h3>
            <span class="close-btn" onclick="closeModal('medicineModal')">&times;</span>
          </div>
          <div class="modal-body">
            <input type="text" id="medicineSearch" placeholder="搜索药品" style="width:100%;padding:6px;margin-bottom:10px;">
            <button class="action-btn" onclick="showAddMedicineForm()">新增药品</button>
            <div id="medicineList" style="margin-top:10px;"></div>
          </div>
          <div class="modal-footer">
            <button class="action-btn" onclick="closeModal('medicineModal')">关闭</button>
          </div>
        </div>
      </div>
      <div class="modal" id="formulaModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>F3 验方设置</h3>
            <span class="close-btn" onclick="closeModal('formulaModal')">&times;</span>
          </div>
          <div class="modal-body">
            <input type="text" id="formulaSearch" placeholder="搜索验方" style="width:100%;padding:6px;margin-bottom:10px;">
            <button class="action-btn" onclick="showAddFormulaForm()">新增验方</button>
            <div id="formulaList" style="margin-top:10px;"></div>
          </div>
          <div class="modal-footer">
            <button class="action-btn" onclick="closeModal('formulaModal')">关闭</button>
          </div>
        </div>
      </div>
      <div class="modal" id="caseModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>病例管理</h3>
            <span class="close-btn" onclick="closeModal('caseModal')">&times;</span>
          </div>
          <div class="modal-body">
            <input type="text" id="caseNameSearch" placeholder="患者姓名" style="width:100%;padding:6px;margin-bottom:10px;">
            <button class="action-btn" onclick="searchCases()">搜索</button>
            <div id="caseList" style="margin-top:10px;"></div>
          </div>
          <div class="modal-footer">
            <button class="action-btn" onclick="closeModal('caseModal')">关闭</button>
          </div>
        </div>
      </div>
      <div class="modal" id="statsModal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>数据管理</h3>
            <span class="close-btn" onclick="closeModal('statsModal')">&times;</span>
          </div>
          <div class="modal-body">
            <div id="statsContent"></div>
            <div style="margin-top:20px;padding-top:15px;border-top:1px solid #ccc;">
              <button class="action-btn" onclick="exportData()" style="background:#4CAF50;color:white;">📥 下载数据文件</button>
              <button class="action-btn" onclick="importData()" style="background:#2196F3;color:white;">📤 导入数据</button>
              <button class="action-btn" onclick="clearAllData()" style="background:#f44336;color:white;">🗑️ 清空数据</button>
            </div>
          </div>
          <div class="modal-footer">
            <button class="action-btn" onclick="closeModal('statsModal')">关闭</button>
          </div>
        </div>
      </div>
    `;
    document.body.innerHTML = html;
    
    if (user.role !== 'admin') {
      document.getElementById('userManageBtn').style.display = 'none';
    }
    
    initPrescriptionSystem();
  }

  function showChangePwdModal() {
    document.getElementById('oldPwd').value = '';
    document.getElementById('newPwd').value = '';
    document.getElementById('confirmNewPwd').value = '';
    document.getElementById('changePwdModal').style.display = 'flex';
  }

  function handleChangePassword() {
    const oldPwd = document.getElementById('oldPwd').value;
    const newPwd = document.getElementById('newPwd').value;
    const confirmNewPwd = document.getElementById('confirmNewPwd').value;
    
    if (!oldPwd || !newPwd || !confirmNewPwd) {
      alert('请填写所有字段');
      return;
    }
    
    if (newPwd !== confirmNewPwd) {
      alert('新密码两次输入不一致');
      return;
    }
    
    const users = getUsers();
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    const userIndex = users.findIndex(u => u.username === currentUser.username);
    
    if (users[userIndex].password !== hashPassword(oldPwd)) {
      alert('原密码错误');
      return;
    }
    
    users[userIndex].password = hashPassword(newPwd);
    saveUsers(users);
    localStorage.setItem('currentUser', JSON.stringify(users[userIndex]));
    alert('密码修改成功！');
    closeModal('changePwdModal');
  }

  function showUserManageModal() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    if (!currentUser || currentUser.role !== 'admin') {
      alert('只有管理员可以管理用户');
      return;
    }
    renderUserList();
    document.getElementById('newUserUsername').value = '';
    document.getElementById('newUserPassword').value = '';
    document.getElementById('newUserName').value = '';
    document.getElementById('userManageModal').style.display = 'flex';
  }

  function renderUserList() {
    const users = getUsers();
    const listDiv = document.getElementById('userList');
    
    let html = '';
    users.forEach(user => {
      html += `
        <div class="user-item">
          <div>
            <div style="font-weight:bold;">${user.name} (${user.username})</div>
            <div style="font-size:11px;color:#666;">${user.role === 'admin' ? '管理员' : '普通用户'}</div>
          </div>
          <div>
            ${user.username !== 'admin' ? '<button class="user-item-btn btn-danger" onclick="handleDeleteUser(\'' + user.username + '\')">删除</button>' : ''}
          </div>
        </div>
      `;
    });
    
    listDiv.innerHTML = html || '暂无用户';
  }

  function handleAddUser() {
    const username = document.getElementById('newUserUsername').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const name = document.getElementById('newUserName').value.trim();
    
    if (!username || !password || !name) {
      alert('请填写完整信息');
      return;
    }
    
    const users = getUsers();
    if (users.find(u => u.username === username)) {
      alert('用户名已存在');
      return;
    }
    
    users.push({username, password: hashPassword(password), name, role: 'user'});
    saveUsers(users);
    renderUserList();
    document.getElementById('newUserUsername').value = '';
    document.getElementById('newUserPassword').value = '';
    document.getElementById('newUserName').value = '';
    alert('用户添加成功！');
  }

  function handleDeleteUser(username) {
    if (!confirm('确定删除该用户？')) return;
    const users = getUsers().filter(u => u.username !== username);
    saveUsers(users);
    renderUserList();
  }

  function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
  }

  function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
  }

  function showHelp() {
    alert('系统帮助：\n\nF1 - 基础设置\nF2 - 药品管理\nF3 - 验方设置\nF7 - 重输\nF8 - 打印\nF9 - 保存');
  }

  function initPrescriptionSystem() {
    const today = new Date();
    document.getElementById('visitDate').value = today.toLocaleDateString('zh-CN');
    document.getElementById('prescriptionNo').value = 'CF' + today.getFullYear() + String(today.getMonth()+1).padStart(2,'0') + String(today.getDate()).padStart(2,'0') + '001';
    
    const clinicName = localStorage.getItem('cloudClinicName') || '惠康堂中医诊所';
    const defaultDoctor = localStorage.getItem('cloudDefaultDoctor') || '';
    document.getElementById('clinicNameDisplay').textContent = clinicName;
    document.getElementById('clinicName').value = clinicName;
    document.getElementById('defaultDoctor').value = defaultDoctor;
    document.getElementById('doctorName').value = defaultDoctor;
    document.getElementById('defaultRegFee').value = localStorage.getItem('cloudDefaultRegFee') || '0';
    document.getElementById('defaultDose').value = localStorage.getItem('cloudDefaultDose') || '7';
    
    updatePrescriptionPaper();
    addMedicineRow();
  }

  function addMedicineRow() {
    const tbody = document.getElementById('prescriptionBody');
    const rowCount = tbody.children.length + 1;
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${rowCount}</td>
      <td><input type="text" class="medicine-code" placeholder="简码" onkeyup="searchMedicine(this)"></td>
      <td><input type="text" class="medicine-name" placeholder="药名" onkeyup="updateMedicineInfo(this)"></td>
      <td><input type="number" class="medicine-dosage" value="10" onchange="calculateRowTotal(this)"></td>
      <td><input type="text" class="medicine-unit" value="g" readonly></td>
      <td><input type="number" class="medicine-price" value="0" step="0.1" onchange="calculateRowTotal(this)"></td>
      <td><span class="medicine-total">0.00</span></td>
      <td><button class="small-btn" onclick="deleteMedicineRow(this)">删</button></td>
    `;
    tbody.appendChild(row);
  }

  function deleteMedicineRow(btn) {
    btn.parentElement.parentElement.remove();
    updateRowNumbers();
    calculateAmount();
  }

  function updateRowNumbers() {
    const rows = document.querySelectorAll('#prescriptionBody tr');
    rows.forEach((row, index) => {
      row.querySelector('td:first-child').textContent = index + 1;
    });
  }

  function searchMedicine(input) {
    const code = input.value.toLowerCase();
    const medicines = getMedicines();
    const medicine = medicines.find(m => m.code.toLowerCase() === code);
    if (medicine) {
      const row = input.parentElement.parentElement;
      row.querySelector('.medicine-name').value = medicine.name;
      row.querySelector('.medicine-price').value = medicine.price;
      row.querySelector('.medicine-unit').value = medicine.unit;
      row.querySelector('.medicine-dosage').value = medicine.dosage || 10;
      calculateRowTotal(row.querySelector('.medicine-price'));
    }
  }

  function updateMedicineInfo(input) {
    const name = input.value;
    const medicines = getMedicines();
    const medicine = medicines.find(m => m.name === name);
    if (medicine) {
      const row = input.parentElement.parentElement;
      row.querySelector('.medicine-code').value = medicine.code;
      row.querySelector('.medicine-price').value = medicine.price;
      row.querySelector('.medicine-unit').value = medicine.unit;
      calculateRowTotal(row.querySelector('.medicine-price'));
    }
  }

  function calculateRowTotal(input) {
    const row = input.parentElement.parentElement;
    const dosage = parseFloat(row.querySelector('.medicine-dosage').value) || 0;
    const price = parseFloat(row.querySelector('.medicine-price').value) || 0;
    const total = (dosage * price).toFixed(2);
    row.querySelector('.medicine-total').textContent = total;
    calculateAmount();
  }

  function calculateAmount() {
    let total = 0;
    document.querySelectorAll('.medicine-total').forEach(el => {
      total += parseFloat(el.textContent) || 0;
    });
    const doseCount = parseInt(document.getElementById('doseCountInput').value) || 1;
    const regFee = parseFloat(document.getElementById('registrationFee').value) || 0;
    const perDose = total.toFixed(2);
    const grandTotal = (total * doseCount + regFee).toFixed(2);
    
    document.getElementById('perDosePrice').textContent = perDose;
    document.getElementById('totalPrice').textContent = perDose;
    document.getElementById('tempAmount').value = grandTotal;
    document.getElementById('grandTotal').textContent = grandTotal;
  }

  function updateDoseCount() {
    calculateAmount();
    document.getElementById('paperDoseCount').textContent = document.getElementById('doseCountInput').value;
  }

  function updatePrescriptionPaper() {
    document.getElementById('paperName').textContent = document.getElementById('patientName').value || '________';
    document.getElementById('paperGender').textContent = document.getElementById('patientGender').value;
    document.getElementById('paperAge').textContent = document.getElementById('patientAge').value || '__';
    document.getElementById('paperClinicNo').textContent = document.getElementById('clinicNo').value || '________';
    document.getElementById('paperDate').textContent = document.getElementById('visitDate').value;
    document.getElementById('paperDiagnosis').textContent = document.getElementById('diagnosis').value || '________________';
    document.getElementById('paperDoctor').textContent = document.getElementById('doctorName').value || '________';
    updatePrescriptionLines();
  }

  function updatePrescriptionLines() {
    const lines = [];
    document.querySelectorAll('#prescriptionBody tr').forEach(row => {
      const name = row.querySelector('.medicine-name').value;
      const dosage = row.querySelector('.medicine-dosage').value;
      const unit = row.querySelector('.medicine-unit').value;
      if (name) {
        lines.push(`${name} ${dosage}${unit}`);
      }
    });
    document.getElementById('prescriptionLines').innerHTML = lines.map(line => `<div style="padding:3px 0;font-size:13px;text-align:center;">${line}</div>`).join('');
  }

  function clearPrescription() {
    document.getElementById('prescriptionBody').innerHTML = '';
    document.getElementById('patientName').value = '';
    document.getElementById('patientAge').value = '';
    document.getElementById('patientGender').value = '男';
    document.getElementById('patientPhone').value = '';
    document.getElementById('clinicNo').value = '';
    document.getElementById('patientAddress').value = '';
    document.getElementById('diagnosis').value = '';
    document.getElementById('medicalHistory').value = '';
    addMedicineRow();
    calculateAmount();
    updatePrescriptionPaper();
  }

  function clearAllMedicines() {
    document.getElementById('prescriptionBody').innerHTML = '';
    addMedicineRow();
    calculateAmount();
    updatePrescriptionPaper();
  }

  function savePrescription() {
    const prescription = {
      id: Date.now(),
      patientName: document.getElementById('patientName').value,
      patientAge: document.getElementById('patientAge').value,
      patientGender: document.getElementById('patientGender').value,
      clinicNo: document.getElementById('clinicNo').value,
      patientPhone: document.getElementById('patientPhone').value,
      patientAddress: document.getElementById('patientAddress').value,
      diagnosis: document.getElementById('diagnosis').value,
      medicalHistory: document.getElementById('medicalHistory').value,
      doctorName: document.getElementById('doctorName').value,
      visitDate: document.getElementById('visitDate').value,
      doseCount: document.getElementById('doseCountInput').value,
      registrationFee: document.getElementById('registrationFee').value,
      totalAmount: document.getElementById('grandTotal').textContent,
      createdAt: new Date().toISOString(),
      medicines: []
    };
    
    document.querySelectorAll('#prescriptionBody tr').forEach(row => {
      const name = row.querySelector('.medicine-name').value;
      if (name) {
        prescription.medicines.push({
          name,
          dosage: row.querySelector('.medicine-dosage').value,
          unit: row.querySelector('.medicine-unit').value,
          price: row.querySelector('.medicine-price').value,
          total: row.querySelector('.medicine-total').textContent
        });
      }
    });
    
    const history = JSON.parse(localStorage.getItem('cloudPrescriptionHistory') || '[]');
    history.unshift(prescription);
    localStorage.setItem('cloudPrescriptionHistory', JSON.stringify(history));
    
    alert('处方保存成功！');
  }

  function saveAsFormula() {
    const formulaName = prompt('请输入验方名称：');
    if (!formulaName) return;
    
    const compositions = [];
    document.querySelectorAll('#prescriptionBody tr').forEach(row => {
      const name = row.querySelector('.medicine-name').value;
      if (name) {
        compositions.push({
          name,
          dosage: parseInt(row.querySelector('.medicine-dosage').value)
        });
      }
    });
    
    const formula = {
      id: Date.now(),
      name: formulaName,
      code: formulaName.replace(/\s/g, '').substring(0, 6),
      effect: '',
      indication: '',
      compositions
    };
    
    const formulas = JSON.parse(localStorage.getItem('cloudFormulas') || '[]');
    formulas.push(formula);
    localStorage.setItem('cloudFormulas', JSON.stringify(formulas));
    
    alert('验方保存成功！');
  }

  function printPrescription(orientation = 'portrait') {
    const printContent = document.getElementById('prescriptionPaper').innerHTML;
    const isLandscape = orientation === 'landscape';
    const pageSize = isLandscape ? 'A5 landscape' : 'A5 portrait';
    const paperWidth = isLandscape ? '210mm' : '148mm';
    const paperHeight = isLandscape ? '148mm' : '210mm';
    const newWindow = window.open('', '_blank');
    newWindow.document.write(`<!DOCTYPE html>
<html>
<head>
    <title>打印处方</title>
    <style>
        @page { size: ${pageSize}; margin: 0; }
        body { font-family: SimSun, serif; padding: 0; margin: 0; }
        .prescription-paper { width: ${paperWidth}; height: ${paperHeight}; padding: 15mm; margin: 0 auto; box-sizing: border-box; }
        .clinic-name { text-align: center; font-size: 18px; font-weight: bold; color: #2c5530; margin-bottom: 10px; }
        .prescription-title { text-align: center; font-size: 18px; font-weight: bold; color: #8b0000; margin-bottom: 12px; }
        .prescription-info { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 10px; border-bottom: 1px solid #000; padding-bottom: 6px; font-size: 12px; }
        .prescription-grid { border-top: 1px solid #000; border-bottom: 1px solid #000; min-height: 180px; margin-top: 8px; }
        .prescription-grid-inner { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 2px; }
        .prescription-line { padding: 3px 0; font-size: 13px; text-align: center; }
        .rp-mark { font-size: 22px; font-weight: bold; font-style: italic; color: #8b0000; }
        .dose-count { text-align: right; font-size: 13px; color: #000080; }
        .prescription-footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #000; font-size: 12px; }
        .usage-text { margin-bottom: 10px; }
        .signature-row { display: flex; justify-content: space-between; }
    </style>
</head>
<body>
    <div class="prescription-paper">${printContent}</div>
</body>
</html>`);
    newWindow.document.close();
    newWindow.print();
  }

  function getMedicines() {
    const saved = localStorage.getItem('cloudMedicines');
    if (saved) return JSON.parse(saved);
    return [
      {name:'人参',code:'rs',price:8.0,unit:'g',dosage:10},
      {name:'党参',code:'ds',price:0.8,unit:'g',dosage:15},
      {name:'黄芪',code:'hq',price:0.5,unit:'g',dosage:15},
      {name:'白术',code:'bz',price:0.5,unit:'g',dosage:10},
      {name:'山药',code:'sy',price:0.4,unit:'g',dosage:15},
      {name:'甘草',code:'gc',price:0.2,unit:'g',dosage:6},
      {name:'当归',code:'dg',price:0.6,unit:'g',dosage:10},
      {name:'熟地',code:'sd',price:0.6,unit:'g',dosage:15},
      {name:'白芍',code:'bs',price:0.4,unit:'g',dosage:12},
      {name:'川芎',code:'cx',price:0.5,unit:'g',dosage:10},
      {name:'丹参',code:'ds',price:0.6,unit:'g',dosage:15},
      {name:'红花',code:'hh',price:1.0,unit:'g',dosage:6},
      {name:'桃仁',code:'tr',price:0.5,unit:'g',dosage:10},
      {name:'柴胡',code:'ch',price:0.5,unit:'g',dosage:10},
      {name:'黄芩',code:'hq',price:0.6,unit:'g',dosage:10},
      {name:'黄连',code:'hl',price:1.2,unit:'g',dosage:6}
    ];
  }

  function saveSettings() {
    localStorage.setItem('cloudClinicName', document.getElementById('clinicName').value);
    localStorage.setItem('cloudDefaultDoctor', document.getElementById('defaultDoctor').value);
    localStorage.setItem('cloudDefaultRegFee', document.getElementById('defaultRegFee').value);
    localStorage.setItem('cloudDefaultDose', document.getElementById('defaultDose').value);
    document.getElementById('clinicNameDisplay').textContent = document.getElementById('clinicName').value;
    alert('设置保存成功！');
    closeModal('settingsModal');
  }

  function backupData() {
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + 
                   String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                   String(now.getDate()).padStart(2, '0');
    const timeStr = String(now.getHours()).padStart(2, '0') + '-' + 
                   String(now.getMinutes()).padStart(2, '0') + '-' +
                   String(now.getSeconds()).padStart(2, '0');
    
    const userObj = currentUser;
    const exportUserName = userObj?.name || userObj?.username || '未知用户';
    const fileName = `云端_${exportUserName}_${dateStr}_${timeStr}.json`;
    
    const data = {
      users: getUsers(),
      medicines: JSON.parse(localStorage.getItem('cloudMedicines') || '[]'),
      formulas: JSON.parse(localStorage.getItem('cloudFormulas') || '[]'),
      prescriptions: JSON.parse(localStorage.getItem('cloudPrescriptionHistory') || '[]'),
      settings: {
        clinicName: localStorage.getItem('cloudClinicName'),
        defaultDoctor: localStorage.getItem('cloudDefaultDoctor'),
        defaultRegFee: localStorage.getItem('cloudDefaultRegFee'),
        defaultDose: localStorage.getItem('cloudDefaultDose')
      },
      exportInfo: {
        version: '本能中医处方系统 - 云端版',
        versionCode: 'v2.1.0',
        versionType: '云端',
        exportTime: now.toLocaleString('zh-CN'),
        exportUser: exportUserName,
        exportDate: dateStr,
        exportTimeOnly: timeStr
      }
    };
    downloadFile(JSON.stringify(data, null, 2), fileName, 'application/json');
  }

  function restoreData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function(e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
          try {
            const data = JSON.parse(event.target.result);
            if (data.users) saveUsers(data.users);
            if (data.medicines) localStorage.setItem('cloudMedicines', JSON.stringify(data.medicines));
            if (data.formulas) localStorage.setItem('cloudFormulas', JSON.stringify(data.formulas));
            if (data.prescriptions) localStorage.setItem('cloudPrescriptionHistory', JSON.stringify(data.prescriptions));
            if (data.settings) {
              if (data.settings.clinicName) localStorage.setItem('cloudClinicName', data.settings.clinicName);
              if (data.settings.defaultDoctor) localStorage.setItem('cloudDefaultDoctor', data.settings.defaultDoctor);
              if (data.settings.defaultRegFee) localStorage.setItem('cloudDefaultRegFee', data.settings.defaultRegFee);
              if (data.settings.defaultDose) localStorage.setItem('cloudDefaultDose', data.settings.defaultDose);
            }
            alert('数据恢复成功！');
          } catch (error) {
            alert('数据恢复失败：' + error.message);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }

  function exportData() {
    const now = new Date();
    const dateStr = now.getFullYear() + '-' + 
                   String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                   String(now.getDate()).padStart(2, '0');
    const timeStr = String(now.getHours()).padStart(2, '0') + '-' + 
                   String(now.getMinutes()).padStart(2, '0') + '-' +
                   String(now.getSeconds()).padStart(2, '0');
    
    const currentUserStr = localStorage.getItem('currentUser');
    let exportUserName = '未知用户';
    let currentUser = null;
    if (currentUserStr) {
      try {
        currentUser = JSON.parse(currentUserStr);
        exportUserName = currentUser.name || currentUser.username || '未知用户';
      } catch {
        exportUserName = currentUserStr;
      }
    }
    
    const clinicName = localStorage.getItem('cloudClinicName') || '未知诊所';
    const doctorName = localStorage.getItem('cloudDefaultDoctor') || '未知医师';
    
    const userRole = currentUser?.role || 'user';
    const userRoleDisplay = (userRole === 'admin') ? '管理员' : '普通用户';
    
    const medicines = JSON.parse(localStorage.getItem('cloudMedicines') || '[]');
    const formulas = JSON.parse(localStorage.getItem('cloudFormulas') || '[]');
    const prescriptionHistory = JSON.parse(localStorage.getItem('cloudPrescriptionHistory') || '[]');
    
    const data = {
      exportInfo: {
        version: '本能中医处方系统 - 云端版',
        versionCode: 'v2.1.0',
        versionType: '云版',
        exportTime: now.toLocaleString('zh-CN'),
        exportTimeUTC: now.toISOString(),
        exportDate: dateStr,
        exportTimeOnly: timeStr,
        exportUser: exportUserName,
        userInfo: {
          username: currentUser?.username || '未知',
          name: currentUser?.name || exportUserName,
          role: currentUser?.role || 'user',
          roleDisplay: userRoleDisplay
        },
        clinicName: clinicName,
        doctorName: doctorName,
        exportType: 'full',
        formatVersion: '1.0',
        dataStatistics: {
          medicinesCount: medicines.length,
          formulasCount: formulas.length,
          prescriptionCount: prescriptionHistory.length
        },
        systemInfo: {
          platform: 'cloud',
          platformType: '网页版',
          lastModified: localStorage.getItem('lastModified') || now.toISOString()
        }
      },
      medicines: medicines,
      formulas: formulas,
      prescriptionHistory: prescriptionHistory
    };
    
    downloadFile(JSON.stringify(data, null, 2), `云端_${exportUserName}_${dateStr}_${timeStr}.json`, 'application/json');
  }

  function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function(e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
          try {
            const data = JSON.parse(event.target.result);
            // 兼容新格式（包含 exportInfo）和旧格式
            const medicines = data.medicines || (data.exportInfo ? data.medicines : null);
            const formulas = data.formulas || (data.exportInfo ? data.formulas : null);
            const prescriptions = data.prescriptions || data.prescriptionHistory || (data.exportInfo ? data.prescriptionHistory : null);
            
            if (medicines) localStorage.setItem('cloudMedicines', JSON.stringify(medicines));
            if (formulas) localStorage.setItem('cloudFormulas', JSON.stringify(formulas));
            if (prescriptions) localStorage.setItem('cloudPrescriptionHistory', JSON.stringify(prescriptions));
            if (data.users) saveUsers(data.users);
            
            let message = '数据导入成功！';
            if (data.exportInfo) {
              message += '\n\n导出信息：';
              if (data.exportInfo.version) message += '\n版本：' + data.exportInfo.version;
              if (data.exportInfo.exportUser) message += '\n导出用户：' + data.exportInfo.exportUser;
              if (data.exportInfo.exportTime) message += '\n导出时间：' + data.exportInfo.exportTime;
            }
            alert(message);
          } catch (error) {
            alert('数据导入失败：' + error.message);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }

  function clearAllData() {
    if (!confirm('确定要清空所有数据吗？此操作不可恢复！')) return;
    localStorage.removeItem('cloudUsers');
    localStorage.removeItem('cloudMedicines');
    localStorage.removeItem('cloudFormulas');
    localStorage.removeItem('cloudPrescriptionHistory');
    localStorage.removeItem('cloudClinicName');
    localStorage.removeItem('cloudDefaultDoctor');
    localStorage.removeItem('cloudDefaultRegFee');
    localStorage.removeItem('cloudDefaultDose');
    alert('数据已清空！');
    handleLogout();
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], {type: type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const savedUser = localStorage.getItem('currentUser');
  if (savedUser) {
    renderMain(JSON.parse(savedUser));
  } else {
    renderLogin();
  }
});
