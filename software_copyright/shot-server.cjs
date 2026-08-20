// 软著截图用本地静态服务：承载离线桌面版界面 + 演示种子数据注入 + 状态化演示路由（不改动 app 目录任何文件）
const http = require('http');
const fs = require('fs');
const path = require('path');

const DESKTOP_DIR = 'd:/trae_projects/kyt-zy/app_project/db-offline/desktop';
const PORT = 8765;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

// ===== 种子数据核心逻辑（/__seed 页面与 /__demo 注入共用）=====
const SEED_CORE_JS = `
function __seedLS(){
  var LS = localStorage;
  LS.setItem('local_clinicName','本能堂中医诊所');
  LS.setItem('local_clinicDoctor','王建国');
  LS.setItem('local_defaultDose','7');
  LS.setItem('local_defaultRegFee','10');
  var medicines = [
    {code:'dg',name:'当归',costPrice:0.12,price:0.18,unit:'g',dosage:'10',stock:'500'},
    {code:'bz',name:'白术',costPrice:0.15,price:0.22,unit:'g',dosage:'10',stock:'500'},
    {code:'fl',name:'茯苓',costPrice:0.11,price:0.16,unit:'g',dosage:'10',stock:'500'},
    {code:'hq',name:'黄芪',costPrice:0.20,price:0.28,unit:'g',dosage:'10',stock:'500'},
    {code:'ds',name:'党参',costPrice:0.17,price:0.25,unit:'g',dosage:'10',stock:'500'},
    {code:'gc',name:'甘草',costPrice:0.07,price:0.10,unit:'g',dosage:'6',stock:'500'},
    {code:'cx',name:'川芎',costPrice:0.12,price:0.18,unit:'g',dosage:'9',stock:'500'},
    {code:'bs',name:'白芍',costPrice:0.14,price:0.20,unit:'g',dosage:'12',stock:'500'},
    {code:'sdh',name:'熟地黄',costPrice:0.17,price:0.24,unit:'g',dosage:'12',stock:'500'},
    {code:'gz',name:'桂枝',costPrice:0.10,price:0.15,unit:'g',dosage:'9',stock:'500'},
    {code:'dz',name:'大枣',costPrice:0.08,price:0.12,unit:'g',dosage:'6',stock:'500'},
    {code:'sj',name:'生姜',costPrice:0.05,price:0.08,unit:'g',dosage:'9',stock:'500'},
    {code:'cp',name:'陈皮',costPrice:0.09,price:0.14,unit:'g',dosage:'10',stock:'500'},
    {code:'szr',name:'酸枣仁',costPrice:0.32,price:0.45,unit:'g',dosage:'15',stock:'300'},
    {code:'yz',name:'远志',costPrice:0.21,price:0.30,unit:'g',dosage:'6',stock:'300'},
    {code:'lg',name:'龙骨',costPrice:0.14,price:0.20,unit:'g',dosage:'20',stock:'300'}
  ];
  LS.setItem('local_medicines', JSON.stringify(medicines));
  var formulas = [
    {name:'四君子汤',effect:'益气健脾',indication:'脾胃气虚，食少便溏，气短乏力',
     composition:[{name:'党参',dosage:12},{name:'白术',dosage:10},{name:'茯苓',dosage:10},{name:'甘草',dosage:6}]},
    {name:'归脾汤',effect:'益气补血，健脾养心',indication:'心脾气血两虚，失眠多梦，心悸怔忡',
     composition:[{name:'黄芪',dosage:15},{name:'当归',dosage:12},{name:'酸枣仁',dosage:15},{name:'远志',dosage:6},{name:'白术',dosage:10},{name:'茯苓',dosage:12}]},
    {name:'桂枝汤',effect:'解肌发表，调和营卫',indication:'外感风寒，头痛发热，汗出恶风',
     composition:[{name:'桂枝',dosage:9},{name:'白芍',dosage:9},{name:'甘草',dosage:6},{name:'大枣',dosage:6},{name:'生姜',dosage:9}]}
  ];
  LS.setItem('local_formulas', JSON.stringify(formulas));
}
function __seedRx(no,date,name,gender,age,phone,addr,hist,diag,items,dose,regFee){
  var sum=0; items.forEach(function(it){ it.total=Math.round(it.price*it.dosage*100)/100; sum+=it.total; });
  var total=Math.round((sum*dose+regFee)*100)/100;
  var ts=new Date(date+'T09:30:00').getTime();
  return {id:ts,prescriptionNo:no,date:date,patientName:name,patientGender:gender,patientAge:String(age),
    patientPhone:phone,patientAddress:addr,doctorName:'王建国',medicalHistory:hist,diagnosis:diag,
    items:items,doseCount:dose,totalAmount:total,registrationFee:regFee,createdAt:ts,createdBy:'admin',createdByName:'王建国'};
}
function __seedIt(n,c,d,p){return {code:c,name:n,dosage:d,unit:'g',price:p};}
function __seedPrescriptions(){
  return [
    __seedRx('26080201','2026-08-02','张三','男',45,'13801020304','高碑店市和平路12号','畏寒发热，鼻塞流涕三天','感冒风寒证',[__seedIt('桂枝','gz',12,0.15),__seedIt('白芍','bs',12,0.20),__seedIt('甘草','gc',6,0.10),__seedIt('大枣','dz',6,0.12),__seedIt('生姜','sj',9,0.08)],7,10),
    __seedRx('26080401','2026-08-04','李梅','女',38,'13905060708','高碑店市文化路8号','食少腹胀，便溏半月余','脾胃虚弱证',[__seedIt('党参','ds',12,0.25),__seedIt('白术','bz',10,0.22),__seedIt('茯苓','fl',10,0.16),__seedIt('甘草','gc',6,0.10)],7,10),
    __seedRx('26080701','2026-08-07','张三','男',45,'13801020304','高碑店市和平路12号','药后热退，咳嗽减轻，二诊','感冒风寒证（二诊）',[__seedIt('桂枝','gz',9,0.15),__seedIt('陈皮','cp',10,0.14),__seedIt('茯苓','fl',10,0.16),__seedIt('甘草','gc',6,0.10)],5,10),
    __seedRx('26081001','2026-08-10','王芳','女',52,'13711223344','高碑店市幸福小区3号楼','失眠多梦，心悸健忘月余','不寐（心脾两虚证）',[__seedIt('黄芪','hq',15,0.28),__seedIt('当归','dg',12,0.18),__seedIt('酸枣仁','szr',15,0.45),__seedIt('远志','yz',6,0.30),__seedIt('白术','bz',10,0.22),__seedIt('茯苓','fl',12,0.16)],7,15),
    __seedRx('26081201','2026-08-12','李梅','女',38,'13905060708','高碑店市文化路8号','腹胀减轻，食欲渐增，二诊','脾胃虚弱证（二诊）',[__seedIt('党参','ds',12,0.25),__seedIt('白术','bz',10,0.22),__seedIt('茯苓','fl',10,0.16),__seedIt('陈皮','cp',10,0.14),__seedIt('甘草','gc',6,0.10)],7,10),
    __seedRx('26081501','2026-08-15','刘洋','男',60,'13655667788','高碑店市建设大街21号','腰腿冷痛，遇寒加重两月','痹症（寒湿腰痛）',[__seedIt('独活','dh',10,0.20),__seedIt('桑寄生','sjs',15,0.22),__seedIt('杜仲','dz2',12,0.26),__seedIt('当归','dg',10,0.18),__seedIt('川芎','cx',9,0.18),__seedIt('牛膝','nx',10,0.16)],7,15),
    __seedRx('26081701','2026-08-17','王芳','女',52,'13711223344','高碑店市幸福小区3号楼','睡眠改善，梦减，二诊守方','不寐（心脾两虚证，二诊）',[__seedIt('黄芪','hq',15,0.28),__seedIt('当归','dg',12,0.18),__seedIt('酸枣仁','szr',12,0.45),__seedIt('远志','yz',6,0.30),__seedIt('茯苓','fl',12,0.16)],7,15),
    __seedRx('26081901','2026-08-19','陈静','女',29,'13599887766','高碑店市育才路5号','月经不调，胸胁胀痛','月经不调（肝郁气滞）',[__seedIt('柴胡','ch',10,0.22),__seedIt('当归','dg',10,0.18),__seedIt('白芍','bs',12,0.20),__seedIt('白术','bz',10,0.22),__seedIt('茯苓','fl',12,0.16),__seedIt('甘草','gc',6,0.10)],7,10)
  ];
}
function __seedIDB(cb){
  var req = indexedDB.open('PrescriptionDB', 3);
  req.onupgradeneeded = function(e){
    var db = e.target.result;
    if (!db.objectStoreNames.contains('prescriptions')) db.createObjectStore('prescriptions',{keyPath:'id'});
    if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings',{keyPath:'key'});
    if (!db.objectStoreNames.contains('prescriptions_trash')) db.createObjectStore('prescriptions_trash',{keyPath:'id'});
  };
  req.onsuccess = function(e){
    var db = e.target.result;
    try {
      var tx = db.transaction('prescriptions','readwrite');
      var store = tx.objectStore('prescriptions');
      store.clear();
      __seedPrescriptions().forEach(function(p){ store.put(p); });
      tx.oncomplete = function(){ setTimeout(cb, 300); };
      tx.onerror = function(){ setTimeout(cb, 300); };
    } catch(err){ setTimeout(cb, 300); }
  };
  req.onerror = function(){ setTimeout(cb, 300); };
}
`;

const SEED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>seed</title></head><body><p>seeding...</p><script>
${SEED_CORE_JS}
(function(){
  var mode = location.search.indexOf('mode=mobile') >= 0 ? 'mobile' : 'desktop';
  __seedLS();
  __seedIDB(function(){
    if (mode === 'mobile') {
      localStorage.setItem('isLoggedIn','true');
      localStorage.setItem('currentUser', JSON.stringify({username:'admin',name:'王建国',role:'admin'}));
      localStorage.setItem('user_login_data', JSON.stringify({user:{username:'admin',password:'admin',name:'王建国',role:'admin'},loginTime:Date.now()}));
    }
    location.replace('/index.html');
  });
})();
</script></body></html>`;

// ===== 演示状态注入（追加到 index.html 末尾，仅服务端内存注入，不落盘）=====
// 关键：应用在 DOMContentLoaded → init() → checkLoginStatus() 中会强制重显登录框并置 currentUser=null，
// 因此必须在注入时（早于 DOMContentLoaded）整体替换 window.checkLoginStatus，复刻其 Electron 自动登录分支。
// st=login 仅展示登录界面；st=main 登录+填患者+调用四君子汤；st=medicine/formula/analytics 在 main 基础上打开对应弹窗
const DEMO_BOOTSTRAP = `<script>
${SEED_CORE_JS}
(function(){
  function __mark(s){ try { document.documentElement.setAttribute('data-demo', (document.documentElement.getAttribute('data-demo')||'') + '|' + s); } catch(e){} }
  __mark('start');
  var st = 'login';
  try { st = new URLSearchParams(location.search).get('st') || 'login'; } catch(e){ __mark('sterr'); }
  __mark('st=' + st);
  if (st === 'login') return;
  try { __seedLS(); __mark('seeded'); } catch(e) { __mark('seederr:' + (e && e.message)); }
  function __setVal(id, v){
    var el = document.getElementById(id);
    if (!el) return;
    el.value = v;
    try { el.dispatchEvent(new KeyboardEvent('keyup', {key:'a'})); } catch(e){}
  }
  function __pose(st){
    __mark('pose:' + st);
    try {
      __setVal('patientName','张三');
      __setVal('patientGender','男');
      __setVal('patientAge','45');
      __setVal('diagnosis','脾胃虚弱证');
      __setVal('medicalHistory','食少腹胀，便溏半月余，神疲乏力');
    } catch(e){}
    if (st === 'main' || st === 'medicine' || st === 'formula' || st === 'analytics') {
      try { selectFormula(0); } catch(e){}
    }
    if (typeof updatePrescriptionPaper === 'function') { try { updatePrescriptionPaper(); } catch(e){} }
    if (st === 'medicine') { try { showModal('medicineModal'); if (typeof renderMedicineList === 'function') renderMedicineList(); } catch(e){} }
    if (st === 'formula') { try { showModal('formulaModal'); if (typeof renderFormulaList === 'function') renderFormulaList(); } catch(e){} }
    if (st === 'analytics') {
      try {
        showModal('analyticsModal');
        setTimeout(function(){ try { refreshAnalytics(); } catch(e){} }, 300);
      } catch(e){}
    }
  }
  window.checkLoginStatus = async function(){
    try {
      currentUser = {username:'admin', password:'admin', name:'王建国', role:'admin'};
      localStorage.setItem('isLoggedIn','true');
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      localStorage.setItem('user_login_data', JSON.stringify({user:currentUser, loginTime:Date.now()}));
      document.getElementById('loginOverlay').style.display = 'none';
      document.querySelector('.main-container').style.display = 'flex';
      if (typeof updateUserDisplay === 'function') { try { updateUserDisplay(); } catch(e){} }
    } catch(e) {}
    __seedIDB(function(){
      var done = function(){
        if (typeof refreshUserInterface === 'function') { try { refreshUserInterface(); } catch(e){} }
        setTimeout(function(){ __pose(st); }, 300);
      };
      if (typeof loadData === 'function') {
        try {
          var q = loadData();
          if (q && q.then) { q.then(done).catch(done); } else { done(); }
        } catch(e){ done(); }
      } else { done(); }
    });
  };
  // 兜底（主路径）：若上述覆盖因作用域未被 init() 调用，则在 load 后 1.5s（此时 DOMContentLoaded 的
  // init/checkLoginStatus 必已执行完毕）再次强制复置登录态，确保登录框被隐藏、主界面展示
  function __forceLogin(){
    __mark('force');
    try {
      currentUser = {username:'admin', password:'admin', name:'王建国', role:'admin'};
      localStorage.setItem('isLoggedIn','true');
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
      localStorage.setItem('user_login_data', JSON.stringify({user:currentUser, loginTime:Date.now()}));
      document.getElementById('loginOverlay').style.display = 'none';
      document.querySelector('.main-container').style.display = 'flex';
      if (typeof updateUserDisplay === 'function') { try { updateUserDisplay(); } catch(e){} }
    } catch(e) {}
    __seedIDB(function(){
      var fin = function(){
        if (typeof refreshUserInterface === 'function') { try { refreshUserInterface(); } catch(e){} }
        setTimeout(function(){ __pose(st); }, 300);
      };
      if (typeof loadData === 'function') {
        try {
          var q = loadData();
          if (q && q.then) { q.then(fin).catch(fin); } else { fin(); }
        } catch(e){ fin(); }
      } else { fin(); }
    });
  }
  window.__forceLogin = __forceLogin;
  __mark('reg');
  if (document.readyState === 'complete') { setTimeout(__forceLogin, 1500); __mark('sched-complete'); }
  else { window.addEventListener('load', function(){ __mark('loadev'); setTimeout(__forceLogin, 1500); }); __mark('sched-load'); }
  // 演示专用顶部标题条（仅截图用注入，保证每张截图顶部完整显示软件全称+版本号）
  try {
    var bar = document.createElement('div');
    bar.id = '__sysbar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:32px;background:linear-gradient(90deg,#1a237e,#303f9f);color:#fff;font:700 14px/32px "Microsoft YaHei","SimHei",sans-serif;text-align:center;letter-spacing:2px;z-index:2147483647;box-shadow:0 1px 4px rgba(0,0,0,.3);';
    bar.textContent = '惠康中医诊所管理系统 V1.0.0';
    document.body.appendChild(bar);
    document.body.style.paddingTop = '32px';
    __mark('bar');
  } catch(e){ __mark('barerr'); }
})();
</script>`;

// 覆盖 config.json：诊所名/医师名换为演示真实值（避免界面出现 XXX 占位）
const CONFIG_OVERRIDE = JSON.stringify({ clinicName: '本能堂中医诊所', doctorName: '王建国' });

// 处方打印预览（复刻 index.html printPrescription 生成的 A5 纵向处方笺版式，用于静态截图）
const PRINT_PREVIEW_HTML = `<!DOCTYPE html><html><head><title>打印处方</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>@page { size: A5 portrait; margin: 0; }
body { font-family: 'SimSun', '宋体', serif; width: 148mm; padding: 0; margin: 0 auto; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; line-height: 1.8; -webkit-print-color-adjust: exact; print-color-adjust: exact; color: #000; background: #fff; }
.prescription-paper { width: 148mm; height: 210mm; padding: 28mm 15mm 20mm; margin: 0 auto; box-sizing: border-box; }
.clinic-name { text-align: center; font-size: 16.5pt; font-weight: bold; color: #000; margin-bottom: 10px; letter-spacing: 2px; font-family: 'KaiTi', '楷体_GB2312', '楷体', serif; }
.prescription-title { text-align: center; font-size: 16.5pt; font-weight: bold; color: #000; margin-bottom: 12px; letter-spacing: 4px; font-family: 'KaiTi', '楷体_GB2312', '楷体', serif; }
.prescription-info { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px 2px; margin-bottom: 8px; border-bottom: 1px solid #000; padding-bottom: 4px; font-size: 10.5pt; color: #000; }
.prescription-info > div { white-space: nowrap; text-align: left; min-width: 0; }
.prescription-info > div:nth-child(1) { grid-column: 1 / 3; }
.prescription-info > div:nth-child(2) { grid-column: 3 / 5; }
.prescription-info > div:nth-child(3) { grid-column: 5 / 7; }
.prescription-info > div:nth-child(4) { grid-column: 1 / 3; }
.prescription-info > div:nth-child(5) { grid-column: 3 / 5; }
.prescription-info > div:nth-child(6) { grid-column: 5 / 7; }
.prescription-grid { border-top: 1px solid #000; border-bottom: 1px solid #000; min-height: 200px; margin-top: 8px; }
.prescription-grid-inner { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 2px; }
.prescription-line { padding: 5px 0; font-size: 11.25pt; text-align: center; font-weight: 500; color: #000; }
.rp-mark { font-size: 16.5pt; font-weight: bold; font-style: italic; color: #000; font-family: 'Times New Roman', serif; }
.dose-count { text-align: right; font-size: 11.25pt; color: #000; font-weight: bold; font-family: 'Times New Roman', serif; }
.prescription-footer { margin-top: 8px; padding-top: 4px; border-top: none; font-size: 10.5pt; color: #000; }
.usage-text { margin-bottom: 6px; font-size: 10.5pt; color: #000; font-weight: bold; white-space: nowrap; border: none; text-decoration: none; }
.signature-grid { display: grid; grid-template-columns: 4fr 3fr 3fr; gap: 6px 10px; margin-top: 8px; }
.signature-item { font-size: 10.5pt; color: #000; padding: 2px 0; }
.signature-item:nth-child(1) { text-align: left; }
.signature-item:nth-child(2) { text-align: center; }
.signature-item:nth-child(3) { text-align: right; padding-right: 50%; box-sizing: border-box; }
.sys-header { text-align: center; font-size: 9pt; color: #555; font-family: 'SimHei', '黑体', sans-serif; letter-spacing: 1px; margin-bottom: 6px; }
</style></head><body><div class="prescription-paper"><div class="sys-header">惠康中医诊所管理系统 V1.0.0 · 处方打印预览</div><div class="clinic-name" id="clinicNameDisplay">本能堂中医诊所</div><div class="prescription-title">处 方 笺</div><div class="prescription-info"><div>姓名:<span id="paperName">张三</span></div><div>性别:<span id="paperGender">男</span></div><div>年龄:<span id="paperAge">45</span>岁</div><div>科别:中医科</div><div>门诊号:<span id="paperClinicNo">26082001</span></div><div>日期:<span id="paperDate">2026/08/20</span></div></div><div style="margin-bottom:8px; line-height:1.5;"><span>病史症状:<span id="paperMedicalHistory">食少腹胀，便溏半月余，神疲乏力</span></span><div style="border-bottom:1px solid #000; margin-top:8px;"></div></div><div style="margin-bottom:3px;"><span>诊断:<span id="paperDiagnosis">脾胃虚弱证</span></span><div style="border-bottom:1px solid #000; margin-top:2px;"></div></div><div class="prescription-grid" style="margin-top:3px;"><div class="prescription-line" style="border-bottom:1px solid #000; display:flex; justify-content:space-between; align-items:center;"><div class="rp-mark">RP</div><div></div><div class="dose-count"><span id="paperDoseCount">7</span>剂</div></div><div class="prescription-grid-inner"><div class="prescription-line">党参 12g</div><div class="prescription-line">白术 10g</div><div class="prescription-line">茯苓 10g</div><div class="prescription-line">甘草 6g</div></div></div><div class="prescription-footer" style="margin-top:3px;"><div class="usage-text">用法：水煎服，每日 1 剂，早晚分温服，忌生冷辛辣</div><div class="signature-grid" style="grid-template-columns: 1fr 1fr 1fr;"><div class="signature-item">医师: <span id="paperDoctor">王建国</span></div><div class="signature-item">金额: 8.49元</div><div class="signature-item">审核:</div></div><div class="signature-grid" style="grid-template-columns: 1fr 1fr 1fr; margin-top:4px;"><div class="signature-item">调配:</div><div class="signature-item">核对:</div><div class="signature-item">发药:</div></div></div></div></body></html>`;

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(url.pathname);
    if (p === '/__jstest') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<html><body>BEFORE<script>document.body.innerHTML="AFTER-JS-RAN";document.documentElement.setAttribute("data-js","ran");</script></body></html>');
    }
    if (p === '/__seed') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(SEED_HTML);
    }
    if (p === '/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(CONFIG_OVERRIDE);
    }
    if (p === '/__print_preview') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PRINT_PREVIEW_HTML);
    }
    if (p === '/__arch') {
      const arch = fs.readFileSync('d:/trae_projects/kyt-zy/software_copyright/arch-diagram.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(arch);
    }
    if (p === '/__demo') {
      const html = fs.readFileSync(path.join(DESKTOP_DIR, 'index.html'), 'utf8');
      // ★ 注意：index.html 内部打印模板字符串里还有一个 '</body>'，必须注入到最后一个（真正的文档末尾）
      const idx = html.lastIndexOf('</body>');
      const injected = html.slice(0, idx) + '\n' + DEMO_BOOTSTRAP + '\n' + html.slice(idx);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(injected);
    }
    if (p === '/' || p === '') p = '/index.html';
    const rel = path.normalize(p.replace(/^[/]+/, ''));
    if (rel.includes('..')) { res.writeHead(403); return res.end(); }
    const file = path.join(DESKTOP_DIR, rel);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } else {
      res.writeHead(404); res.end('not found: ' + p);
    }
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.message || e));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('shot-server running at http://127.0.0.1:' + PORT + '/ serving ' + DESKTOP_DIR);
});
