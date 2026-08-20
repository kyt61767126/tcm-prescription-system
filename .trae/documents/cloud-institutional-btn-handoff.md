# 交接：云端机构版桌面"修改密码"→"用户管理" 优化（未完成，待接续）

> 日期：2026-08-20
> 状态：**已定位根因、已写诊断，代码修改未完成、未提交**。切换到下一个 work 账户后，请先 Read 本文件再继续。

## 一、用户诉求
云端机构版桌面 登录后操作界面应显示【👥 用户管理】，却显示【🔐 修改密码】。要求优化改正并**举一反三**，让全部版本符合规范显示要求（机构版=用户管理，标准版=修改密码）。

## 二、根因（已查明，勿重复排查）
标题栏版本标签正确显示"云端机构版"，但按钮却显示"修改密码"，属**【版本标签 vs 权限判断分道扬镳】**。权威判断在 `permission.js`：

1. `isInstitutional()`（各副本第 71 行）机构版列表为：
   ```js
   ['clinic_custom','offline','clinic','cloud_clinic','offline_clinic']
   ```
   **缺 `'cloud'`**。云端机构版 edition 解析为 `'cloud'`（旧兼容 key）时被判为"非机构版" → `canManageUsersByRole` 返回 false → 显示修改密码。

2. `_isStandardEditionForced()` 内 `INST_ED`（第 124 行）：
   ```js
   ['clinic','offline_clinic','clinic_custom','offline','cloud_clinic']
   ```
   **同样缺 `'cloud'`**。edition=`'cloud'` 时不进入机构版豁免，落到 DOM 锚点判据 → 命中 `_force_standard_edition_marker_` → 强制标准版。

注意：`getEditionTag` / `refreshVersionTags` / `enforceStandardEditionButtons` 的 inst 列表（index.html 639/648/2121/2134 行）**已含 `'cloud'`**，所以标签显示正确、按钮却被 permission 误判——权限逻辑是唯一落伍处。

## 三、待完成修改（读完后 Step 可照做）
1. **`permission.js` 全部 11 份副本**，两处各加 `'cloud'`：
   - `isInstitutional()` 列表追加 `'cloud'`
   - `INST_ED` 列表追加 `'cloud'`
   涉及文件（isInstitutional 行内统一 71 行、INST_ED 统一 124 行）：
   - `shared/permission.js`、`site-admin/permission.js`、`site-admin/electron/permission.js`
   - `public/permission.js`、`public/electron/permission.js`
   - `app_project/db-yunduan/cloud_desktop/permission.js`、`cloud_desktop/electron/permission.js`
   - `app_project/db-yunduan/cloud_app/app/src/main/assets/public/permission.js`
   - `app_project/db-offline/desktop/permission.js`、`desktop/electron/permission.js`
   - `app_project/db-offline/app/app/src/main/assets/public/permission.js`
2. **index.html 的 INST_ED（云端与网页版）**：`cloud_desktop/index.html` 第 2134 行、`public/index.html` 对应位置追加 `'cloud'`（保留其它 guard，防抖动）。
3. **DOM 锚点**：云端产品（`cloud_desktop/index.html` 第 7727 行、`public/index.html`）的 `_force_standard_edition_marker_` 描述文本写的是"惠康中医-本地"，与云端身份不符；保留与否之前需评估 `enforceStandard` guard（机构版部署已会跳过）。**离线版（db-offline）的锚点必须保留**（那是永久离线标准版）。

## 四、验证
- 云端桌面：重新 `build.bat` 打包 exe，登录机构版管理员账号 → 顶部应显示【👥 用户管理】、底部 btn2 显示【👤 用户管理】。
- 标准版不受影响（cloud_personal 非机构版仍显示 修改密码）。
- 每个 index.html 的 Edit 后必须用 Grep 验证（并行 Edit 可能静默失败）。

## 五、当前 git 未提交文件（切账户前务必先 commit+push）
`git status` 显示已修改但未提交的：
- `public/permission.js`、`public/electron/permission.js`、`shared/permission.js`、`site-admin/permission.js`、`site-admin/electron/permission.js`
- `app_project/db-offline/*/auth-core.js` ×3、`desktop/package.json`
> 交接文档本身也需一并 commit。修改武汉若未 push，换账户后 code 状态会丢失，务必推送。