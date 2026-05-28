const fs = require('fs');
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>中医处方系统</title>
<style>
body{font-family:Microsoft YaHei;margin:0;background:#f0f0f0}
.login{display:flex;justify-content:center;align-items:center;height:100vh;background:linear-gradient(135deg,#667eea,#764ba2)}
.login-box{background:white;padding:40px;border-radius:15px;box-shadow:0 20px 60px rgba(0,0,0,0.3);min-width:320px}
.login-title{font-size:24px;font-weight:bold;text-align:center;margin-bottom:20px}
.login-field{margin-bottom:20px}
.login-field label{display:block;margin-bottom:5px}
.login-field input{width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:16px}
.login-btn{width:100%;padding:14px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;border-radius:8px;font-size:16px;cursor:pointer}
.login-error{color:red;margin-top:15px;font-size:14px;display:none}
.main{display:none;height:100vh;flex-direction:column}
.top{background:#4a5568;color:white;padding:10px 20px;display:flex;justify-content:space-between}
.nav{display:flex;background:#2d3748}
.nav-item{padding:12px 20px;color:white;cursor:pointer;border-right:1px solid #4a5568}
.nav-item.active{background:#4a5568}
.content{flex:1;padding:20px}
table{width:100%;border-collapse:collapse;margin-top:20px}
table th,table td{padding:10px;border-bottom:1px solid #ddd}
table th{background:#f7fafc}
.btn{padding:10px 20px;border:none;border-radius:4px;cursor:pointer}
.btn-primary{background:#3182ce;color:white}
.form-group{margin-bottom:15px}
.form-group label{display:block;margin-bottom:5px}
.form-group input{width:100%;padding:10px;border:1px solid #ddd;border-radius:4px}
.form-row{display:flex;gap:20px}
.form-row .form-group{flex:1}
</style>
</head>
<body>
<div id="login" class="login">
  <div class="login-box">
    <div class="login-title">🏥 中医处方系统</div>
    <div class="login-field"><label>用户名:</label><input type="text" id="user"></div>
    <div class="login-field"><label>密码:</label><input type="password" id="pwd"></div>
    <button class="login-btn" onclick="login()">登录</button>
    <div id="error" class="login-error"></div>
  </div>
</div>
<div id="main" class="main">
  <div class="top"><h1>中医处方系统</h1><button class="btn" style="background:#e53e3e;color:white" onclick="logout()">退出</button></div>
  <div class="nav">
    <div class="nav-item active" onclick="showTab('pres')">处方管理</div>
    <div class="nav-item" onclick="showTab('users')">用户管理</div>
  </div>
  <div class="content">
    <div id="pres">
      <h2>处方管理</h2>
      <div class="form-row">
        <div class="form-group"><label>处方号</label><input type="text" id="presNo" readonly></div>
        <div class="form-group"><label>日期</label><input type="date" id="presDate"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>姓名</label><input type="text" id="patientName"></div>
        <div class="form-group"><label>诊断</label><input type="text" id="diagnosis"></div>
      </div>
      <button class="btn btn-primary" onclick="savePres()">保存处方</button>
      <table>
        <thead><tr><th>处方号</th><th>患者</th><th>诊断</th></tr></thead>
        <tbody id="presList"></tbody>
      </table>
    </div>
    <div id="users" style="display:none">
      <h2>用户管理</h2>
      <table>
        <thead><tr><th>用户名</th><th>姓名</th><th>角色</th></tr></thead>
        <tbody id="userList"></tbody>
      </table>
    </div>
  </div>
</div>
<script>
let token=null;
async function api(url,m,d){
  const o={method:m,headers:{"Content-Type":"application/json"}};
  if(token) o.headers.Authorization="Bearer "+token;
  if(d) o.body=JSON.stringify(d);
  const r=await fetch("/api"+url,o);
  return {success:r.ok,...await r.json()};
}
async function login(){
  const u=document.getElementById("user").value;
  const p=document.getElementById("pwd").value;
  if(!u||!p){
    document.getElementById("error").textContent="请输入用户名和密码";
    document.getElementById("error").style.display="block";
    return;
  }
  const r=await api("/auth/login","POST",{username:u,password:p});
  if(r.success){
    token=r.token;
    document.getElementById("login").style.display="none";
    document.getElementById("main").style.display="flex";
    loadPres();
    loadUsers();
  }else{
    document.getElementById("error").textContent=r.error;
    document.getElementById("error").style.display="block";
  }
}
function logout(){
  token=null;
  document.getElementById("main").style.display="none";
  document.getElementById("login").style.display="flex";
}
function showTab(t){
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
  document.getElementById("pres").style.display="none";
  document.getElementById("users").style.display="none";
  event.target.classList.add("active");
  document.getElementById(t).style.display="block";
}
async function savePres(){
  const d={
    prescriptionNo:document.getElementById("presNo").value,
    date:document.getElementById("presDate").value,
    patientName:document.getElementById("patientName").value,
    diagnosis:document.getElementById("diagnosis").value
  };
  const r=await api("/prescriptions","POST",d);
  if(r.success){alert("保存成功");loadPres();}
  else{alert(r.error);}
}
async function loadPres(){
  const r=await api("/prescriptions","GET");
  const t=document.getElementById("presList");
  t.innerHTML="";
  if(r.success&&r.prescriptions)
    r.prescriptions.forEach(p=>{
      const row=t.insertRow();
      row.innerHTML="<td>"+p.prescriptionNo+"</td><td>"+p.patientName+"</td><td>"+p.diagnosis+"</td>";
    });
}
async function loadUsers(){
  const r=await api("/auth/users","GET");
  const t=document.getElementById("userList");
  t.innerHTML="";
  if(r.success&&r.users)
    r.users.forEach(u=>{
      const row=t.insertRow();
      row.innerHTML="<td>"+u.username+"</td><td>"+u.name+"</td><td>"+(u.role=="admin"?"管理员":"用户")+"</td>";
    });
}
document.addEventListener("DOMContentLoaded",()=>{
  const now=new Date();
  document.getElementById("presNo").value=now.getFullYear()+String(now.getMonth()+1).padStart(2,"0")+String(now.getDate()).padStart(2,"0")+String(Math.floor(Math.random()*10000)).padStart(4,"0");
  document.getElementById("presDate").value=now.toISOString().split("T")[0];
});
</script>
</body>
</html>`;
fs.writeFileSync("index.html", html, "utf-8");
console.log("Done!");