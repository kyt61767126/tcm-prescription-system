# 离线版 注册→支付→激活→登入 全流程重构 - 产品需求文档

## Overview
- **Summary**: 对离线 APP（及共享 auth-core 的离线桌面版）的注册后激活付费链路做架构级重构：从"admin-submit 申请 → 跳官网表单重复填单 → 双记录松散关联 → 三条装码路径竞态 → localStorage 单点状态"改为"**客户端直建订单 → 官网仅按订单号展示收款码 → 服务端状态机驱动弹窗步骤 → Java 桥单一装码路径 → config.json 单一事实源**"的线性闭环。
- **Purpose**: 2026-09-06 单日连续 5 轮回归（注册页被劫持、密码表单回退、localStorage 丢失断链、官网字段合并污染、设备版本绑定卡死）证明现有链路拼接脆弱、状态源多、路径竞态，用户体验为"步步卡壳、反复填信息"。需从根本上做到高效、快捷、稳定。
- **Target Users**: 离线 APP / 离线桌面版的新购用户（注册→付款→激活）、重装/换机恢复用户、线下售码用户（激活码）、客服补单用户（工单）。

## Goals
- 注册后激活全程**零表单填写**：信息全部来自注册资料，3 次点击内到达付款二维码页。
- **单一订单记录**：客户端直调 order-submit 建单，官网付款页只凭订单号恢复展示，不再通过 URL 传 cn/n/p 字段、不再重复建单。
- **单一装码路径**：license 安装统一由 Java 桥（桌面为 Electron preload 等价方法）执行，消除 JS 自愈 / JS observer / Java 原生自愈三路竞态。
- **单一事实源**：激活流程状态与注册资料以 config.json（Java 持久层）为准，localStorage 仅作缓存，其丢失不影响任何环节。
- **状态机驱动**：弹窗每次打开先查服务端状态（按 machineId），未下单→选版本、待付款→付款页、审核中→等待页、已激活→装码成功；杀进程/重启后原地恢复。
- **失败可重试不迷路**：任何错误在当前步骤内联提示 + 重试按钮，永不回退到废弃密码表单/空白表单。
- 字段纯净：license 与服务端记录中 clinicName=注册诊所名、adminName=医师名，永不出现"诊所名 / 医师名"拼接串。

## Non-Goals
- 不做 APP 内拉起支付宝/微信支付（维持官网扫码 + 后台人工核对；用户已确认）。
- 不改动受保护的 6 份 index.html / login.html 结构与 CSS（激活弹窗本就是 auth-core JS 动态生成 DOM，重构限 JS 内）。
- 不删除旧 admin-submit 链路与旧版客户端兼容性（已打包旧包仍可激活；新链路为新包优先路径）。
- 不改动定价、后台审核界面、云端版（db-yunduan）激活逻辑。
- 不做多账号/多诊所体系变更。

## Background & Context
- 现状链路（5 轮回归实证）：
  1. 注册：JS→Java `registerLocalUser` 写 config.json；JS 另存 localStorage `license:registrationInfo`（易丢，第四轮断链根因）。
  2. 激活弹窗：版本选择→自动调 **admin-submit**（建第 1 条记录）→ 返回 PAYMENT_REQUIRED → 跳官网 `download.html?mid=&cn=&n=&p=`。
  3. 官网回填把 cn/n **合并进单输入框**→ 自动调 **order-submit**（建第 2 条记录）→ 付款 → 后台核对激活。
  4. 客户端轮询 admin-status（requestId 指向第 1 条永远 pending_payment 的记录，靠 **machineId 兜底扫描**才捡到第 2 条已激活记录）。
  5. 装码三路径竞态：JS observer 装码、JS `healMissingDesktopLicenseFile` 自愈装码、Java `syncLicenseFromServer` 冷启动装码（第一/二轮回归根因）。
- 已确认的服务端事实：order-submit CORS **未放行 Origin:null**（file:// APP WebView 直调会被拦，这是当前必须绕官网表单的原因之一）；order-status 同样未放行且只返回 licenseCode；admin-submit/admin-status 已放行 null 且 admin-status 返回完整 licenseBase64 + machineId 兜底扫描。
- 测试机 machineId `5784b5da162946afdeb89fdf3eebb50d` 已在 `test_machine` 白名单（设备版本绑定校验放开），供反复实测。
- 用户决策（2026-09-06）：①支付维持官网扫码+后台核对；②激活码激活/工单申请保留为弹窗底部折叠次级入口。

## Functional Requirements
- **FR-1 服务端订单接口**：order-submit 放行 Origin:null（对齐 admin-submit/admin-status 的 null 回退）；同 machineId+phone 存在 pending_payment/pending 进行中订单时幂等返回既有订单（不重复建单、不重复占号）；order-status 同步放行 null。
- **FR-2 官网订单恢复页**：download.html 支持 `?orderNo=XXX` 恢复模式——拉 order-status 直接展示付款步骤（收款码、金额、诊所/医师/手机只读、轮询状态、"我已付款"按钮），无任何输入表单；不读取 cn/n/p 参数。public 与 site-official 两副本一致。
- **FR-3 客户端直建订单**：激活弹窗版本选择后，客户端直接 POST order-submit（字段：orderNo 客户端按 BNZC-DZ-yyyyMMddHHmm-XXXX 生成、productKey=local、edition、price 文本、clinicName=注册诊所名、adminName=注册医师名、phone=注册手机号、machineId、dp=app/desktop），成功后进入付款步骤。
- **FR-4 状态机弹窗**：弹窗打开即按 machineId 查 admin-status：activated→装码成功步；pending_payment→付款步（按钮跳 `download.html?orderNo=`，仅订单号+ed/dp）；pending→等待审核步；无记录/拒绝→版本选择步。每步内联状态文案与轮询进度。
- **FR-5 单一装码路径**：JS 任何位置检测到 activated 后，统一调用桥方法 `activate.installLicenseFromServer(machineId)`（APP=Java 复用 syncLicenseFromServer 内核并返回结果；桌面=preload 等价方法）；JS 不再自行 fetch license 并写盘；冷启动 Java 原生自愈保留为唯一兜底。
- **FR-6 状态持久化到 config.json**：桥提供 flowState 读写方法（当前订单 orderNo/requestId、状态、edition、时间戳），弹窗恢复/预填优先读桥 config（users + clinicName/doctorName + flowState），localStorage registrationInfo/adminReqPending 降级为缓存且读不到不报错。
- **FR-7 失败 UX**：网络错误/5xx/4xx（除幂等成功外）在当前步骤显示红色内联提示 + "重试"按钮；禁止回退 adminStepPwd 密码表单；禁止静默停留。
- **FR-8 次级入口**：激活码激活、工单申请收为弹窗底部小字链接（"已有激活码？点此激活 / 联系客服工单申请"），点击展开对应原功能，行为不变。
- **FR-9 桌面一致**：Electron preload 补齐 installLicenseFromServer / flowState 等价方法；桌面共享 auth-core 走同一状态机。
- **FR-10 旧版兼容**：admin-submit / 旧 URL 参数（cn/n/p）官网回填逻辑保留不删，旧包用户链路不受影响。

## Non-Functional Requirements
- **NFR-1 界面保护**：不改 6 份受保护 HTML 结构/CSS；check-interface.bat 通过；弹窗 DOM 变更仅限 auth-core JS 动态生成部分。
- **NFR-2 多端同步**：auth-core 改动经 sync-auth-core.ps1 同步全部副本并 sync-all -VerifyOnly 验证；download.html 两副本一致。
- **NFR-3 安全性不降级**：order-submit 维持速率限制（10次/小时/IP）+ 必填校验 + 设备版本校验（白名单测试机除外）；无认证接口不新增敏感写操作；装码仍走 v3 三因子绑定校验 + config 完整性签名。
- **NFR-4 可观测**：关键节点 console/Logcat 留痕（建单、幂等命中、状态恢复、装码路径、错误重试），含 orderNo/requestId 便于与后台对账。
- **NFR-5 性能**：弹窗打开到可交互 ≤1s（服务端查询异步不阻塞首屏，先展示加载态）；轮询间隔维持 5s。

## Constraints
- **Technical**: Android WebView（file://，Origin:null）；Electron file://；Cloudflare Pages Functions + KV；Java LicenseManager 为 APP 持久/装码权威；界面保护铁律禁改受保护 HTML/CSS。
- **Business**: 支付=官网扫码+后台人工核对；价格/审核流程不变；线下售码与工单渠道必须保留。
- **Dependencies**: 服务端 KV 可读写（wrangler 已认证）；APP 严格模式打包（Java 混淆+签名校验）；Cloudflare Pages 自动部署官网。

## Assumptions
- 注册成功后 config.json 必含：users 中手机号账号（name=医师名、username=手机号）、顶层 clinicName=诊所名（Java registerLocalUser 已写）。
- admin-status 的 machineId 兜底扫描对"客户端直建订单"同样有效（order-submit 记录经 admin-approve 激活后可被扫描命中——现状已验证）。
- 客户端生成 orderNo 与官网生成规则同格式，服务端 orderNo 幂等查重已存在（重复提交返回既有）。

## Acceptance Criteria

### AC-1: 新用户零表单到达付款页
- **Type**: `rule`
- **Given**: 全新安装（删数据）的离线 APP，已完成注册（诊所名/医师名/手机号）
- **When**: 打开激活弹窗 → 选择版本（标准版或机构版）
- **Then**: 不出现任何信息填写表单，直接进入付款步骤（显示"去官网付款"按钮 + 等待状态）
- **Pass Condition**: 从点版本卡片到付款步骤出现，全程无诊所名/医师名/手机号/密码输入框；点击次数 ≤ 2（版本卡片 → 自动建单 → 付款步）
- **Evidence**: 录屏/实测；auth-core 代码中版本选择后直接 order-submit 调用链

### AC-2: 订单字段纯净无拼接
- **Type**: `rule`
- **Given**: 客户端直建订单并完成后台激活
- **When**: 查 KV admin_req 记录与签发的 license
- **Then**: clinicName 严格等于注册诊所名、adminName/user 严格等于注册医师名，均不含 " / " 拼接
- **Pass Condition**: KV 记录 clinicName/adminName 字段无 " / "；licenseBase64 解码后 clinicName/user 字段无 " / "；APP 激活后界面诊所名/医师名分别正确
- **Evidence**: wrangler kv get 记录 + license 解码；APP 截图

### AC-3: 订单幂等不重复
- **Type**: `rule`
- **Given**: 同机同手机号已有 pending_payment/pending 订单
- **When**: 重复选版本提交 / 重开弹窗重试 / 杀进程重进
- **Then**: 服务端返回同一 requestId/orderNo，KV 不新增 admin_req 记录
- **Pass Condition**: 连续 3 次建单请求返回同一 orderNo；admin_req_index 无新增；客户端弹窗恢复到既有订单的付款/等待步
- **Evidence**: 服务端日志 + KV 索引对比；客户端录屏

### AC-4: 官网订单号恢复页无表单
- **Type**: `rule`
- **Given**: 客户端跳转 `download.html?orderNo=BNZC-DZ-...&ed=...&dp=app`
- **When**: 页面加载
- **Then**: 直接显示付款步骤（收款码、金额、订单信息只读、轮询中），无姓名/手机/设备码输入框，URL 不含 cn/n/p 参数
- **Pass Condition**: 页面无 custName/custPhone/custMachineId 可编辑输入框呈现；order-status 请求发出；两副本（pages.dev 部署域）行为一致
- **Evidence**: 浏览器实测截图；代码中 orderNo 恢复分支

### AC-5: 单一装码路径且自动激活及时
- **Type**: `rule`
- **Given**: 客户端处于等待步、后台一键审核通过
- **When**: 轮询检测到 activated
- **Then**: 装码仅由 Java 桥 installLicenseFromServer 执行一次；JS 无独立写 license.dat 行为；60s 内弹窗显示激活成功并引导重启
- **Pass Condition**: logcat 中 license 安装日志仅出现桥路径一次（无并发/重复安装警告）；JS heal 路径代码已改为调桥；激活成功到弹窗提示 ≤ 60s
- **Evidence**: logcat 过滤日志；代码审查；实测录屏

### AC-6: 重启后状态原地恢复
- **Type**: `rule`
- **Given**: 已下单待付款（或审核中）状态下杀掉 APP 进程
- **When**: 重新打开 APP → 打开激活弹窗
- **Then**: 弹窗直接显示付款步/等待步（不回版本选择、不重建订单）
- **Pass Condition**: 弹窗首屏状态与服务端订单状态一致；无新订单产生
- **Evidence**: 实测录屏；桥 flowState 读取日志

### AC-7: localStorage 丢失不影响流程
- **Type**: `rule`
- **Given**: WebView localStorage 被清空（config.json 保留）
- **When**: 打开激活弹窗并走完建单→付款→激活
- **Then**: 注册资料从桥 config 正确读取，流程无断链、无表单回退
- **Pass Condition**: 清除 localStorage 后弹窗仍显示正确诊所名/医师名/手机号并可直建订单
- **Evidence**: 实测（adb 清 WebView 数据或清 localStorage）；代码中桥读取优先链路

### AC-8: 失败内联可重试
- **Type**: `rule`
- **Given**: 断网或服务端 5xx
- **When**: 建单/轮询/装码失败
- **Then**: 当前步骤显示错误提示与"重试"按钮，点击后原地重试；任何情况下不出现密码设置表单
- **Pass Condition**: 飞行模式实测出现内联错误+重试；恢复网络后重试成功；全程无 adminStepPwd 呈现
- **Evidence**: 实测录屏

### AC-9: 次级入口功能保留
- **Type**: `rule`
- **Given**: 弹窗任意步骤
- **When**: 点击底部"激活码激活"/"工单申请"链接
- **Then**: 原激活码表单/工单表单正常展开并可用（激活码激活成功、工单提交成功）
- **Pass Condition**: 两条次级链路功能与重构前一致
- **Evidence**: 实测激活码激活（用后台生成的码）+ 工单提交

### AC-10: 端到端流程顺畅度
- **Type**: `rubric`
- **Dimension**: 新用户从注册完成到激活成功登入的整体体验（点击次数、等待感知、无迷路/无重复填单/无神秘卡住）
- **Scale**: 1-5
- **Anchors**: 1 = 现状（多步表单、反复卡壳、5 轮回归水平）; 3 = 流程可走通但有 1-2 处停顿或提示不清; 5 = 全程直线、状态透明、付款后自动激活登入、零困惑
- **Pass Threshold**: >= 4
- **Evidence**: 完整实测录屏 + 操作者主观评分

### AC-11: 架构简洁性
- **Type**: `rubric`
- **Dimension**: 装码路径数、状态事实源数、跨端数据传递字段数的收敛程度
- **Scale**: 1-5
- **Anchors**: 1 = 三路径装码/三状态源/URL 传 5 字段（现状）; 3 = 主路径收敛但残留兼容分支; 5 = 装码唯一桥路径、状态以 config.json+服务端为准、跳官网仅 orderNo
- **Pass Threshold**: >= 4
- **Evidence**: 代码审查（装码调用点清单、状态读写点清单、URL 参数清单）

### AC-12: 桌面版一致性
- **Type**: `rule`
- **Given**: 离线桌面版打包新 auth-core + preload 桥方法
- **When**: 桌面走注册→选版本→付款→激活全流程
- **Then**: 行为与 APP 一致（零表单、状态恢复、桥装码）
- **Pass Condition**: 桌面打包成功且实测流程一致；preload 方法齐备检查通过
- **Evidence**: 桌面实测；preload 方法清单

### AC-13: 门禁与兼容
- **Type**: `rule`
- **Given**: 全部改动完成
- **When**: 运行 check-interface.bat、sync-all -VerifyOnly、node --check、旧包链路回归
- **Then**: 全部通过；旧版客户端（admin-submit 链路、官网 cn/n 回填）仍正常
- **Pass Condition**: 门禁全绿；旧 URL 参数回填逻辑保留可触发
- **Evidence**: 命令输出；旧链路代码保留审查

## Open Questions
- 无（支付方式与次级入口两个决策点已经用户确认；实现中如发现桌面 preload 不可逾越的限制再行上报）。
