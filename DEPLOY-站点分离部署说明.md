# 站点分离（官网 / 后台）部署说明

> 规则9 物理拆分执行完成时间：2026-08-08
> 代码拆分：见 `site-official/`（官网）和 `site-admin/`（后台+云端APP）

> ✅ **2026-09-13 重整分离恢复（root_dir 方案 + wrangler 直传兜底，已全量线上验证）**：此前三项目
> 互为完整镜像（官网域服务完整工作站+admin+API，违反规则9）。当日恢复分离拓扑并验证：
> **huikang-admin → `site-admin/`（后台+云端APP 站）、huikang-official → `site-official/`
> （纯展示官网）、tcm-prescription-system → `public/`（主站，全部客户端指向不变）**。
> `huikangzy.com` 自定义域名仍无 DNS 解析（域名失效），实际入口为 *.pages.dev；管理台控制台
> 子页双副本（public/admin ↔ site-admin/admin）字节级统一并挂 `adminconsole` 门禁对（第 4 对）。
> 后台站页面经 CORS 跨域调用主域 API（`CLOUD_API_BASE` 指向主域，已带 OPTIONS 预检）。
>
> 🔑 **根因与机制（本次实测核心结论，务必先读再动部署）**：
> 1. **根 `wrangler.toml` 的 `pages_build_output_dir = "public"` 会覆盖所有 Pages 项目的
>    Dashboard/API destination_dir**——这就是「三站镜像」的真正根因（不是 destination_dir
>    漂移）。Git 集成构建在 checkout 后从 root_dir（默认仓库根）读 wrangler.toml，命中即用。
> 2. **分离拓扑的正确配置是 root_dir，不是 destination_dir**：
>    - huikang-admin：`root_dir="site-admin"`（`site-admin/wrangler.toml` 的
>      `pages_build_output_dir="."` 接管输出）；
>    - huikang-official：`root_dir="site-official"` + `destination_dir="."`；
>    - 主站：root_dir 空 + 根 wrangler.toml（`public`），不变。
>    root_dir 生效后 functions 从 root_dir 下查找（子站无 functions → 子站 /api 退场，
>    页面全部跨域调主域，已验证零依赖）。API `PATCH build_config` 回读即生效。
> 3. **Cloudflare 免费计划 Git 构建配额 500 次/月耗尽**（每 push × 3 项目 × 多次/天）：
>    表现为主站 initialize 阶段 "unable to submit build job" 连续失败、子站部署卡
>    queued 15 分钟以上。**兜底方案：`wrangler pages deploy <目录> --project-name=<项目>
>    --branch=main` 直接上传**（不占 Git 构建配额，在仓库根运行会自动携带根 functions）。
>    直传前必须用 `git archive --format=zip -o sites.zip HEAD site-xxx` 抽出**入库内容**
>    （本地未入库的 exe/apk 超 25 MiB 会被 Pages 拒收；Git 构建不受影响因其 checkout 无此文件）。
>    注意：直传部署同样读取 CWD 下 wrangler.toml 的绑定配置，行为与 Git 部署等价。

## 1. 两站点各自的构建输出根目录

| 站点 | 根目录 | Pages / Nginx 指向 |
|---|---|---|
| 官网 | `site-official/` | Cloudflare Pages 项目 `huikang-official`（入口 `huikang-official.pages.dev`） |
| 后台+云端APP | `site-admin/` | Cloudflare Pages 项目 `huikang-admin`（入口 `huikang-admin.pages.dev`） |
| 主站（医师工作站） | `public/` | Cloudflare Pages 项目 `tcm-prescription-system`（客户端全部指向此域） |

## 2. 两个 Pages 项目（Cloudflare）

### 2.1 huikang-official（纯展示）
- 入口：`huikang-official.pages.dev`（自定义域名 `www.huikangzy.com` 已失效待续费重绑）
- 构建命令：无（纯静态）
- 输出目录：`site-official`
- 路由/头：`site-official/_routes.json` 与 `site-official/_headers`（注意其中 `rules` 字段为
  _redirects 风格历史设计，Pages 实际不解析——敏感路径隔离由分离拓扑本身保证：site-official/
  目录内不含 auth-core/permission/admin 等文件，repo 根 functions 仍会部署到本项目 /api/*，
  与切换前一致无回归）

### 2.2 huikang-admin（带鉴权）
- 入口：`huikang-admin.pages.dev`（自定义域名 `admin.huikangzy.com` 已失效待续费重绑）
- 构建命令：无（纯静态）
- 输出目录：`site-admin`
- `/admin/*` 平台管理员 JWT 校验 Worker：**未实施**——现状与主域一致，控制台页面为客户端登录门
  （JWT 存 localStorage），数据接口由服务端 Bearer JWT 把关；如需静态层硬门禁再立项

## 3. 自托管 Nginx

参考 docs 中的 `规则9-官网后台分离实施计划.md` 第 4.1 节直接复制 Nginx 配置。

## 4. 流水线发布同步

> ★ 2026-08-23 更新：8 包已合并为 4 包（云端统一包 + 离线统一包，标准版/机构版由运行时激活码决定），
> latest.json 收敛为 cloud / dingzhi 两个 key。历史上规划的 cloud_personal / cloud_clinic /
> personal / clinic 四目录方案已废弃，未曾上线。

打包完成后由发布工具链自动同步（无需手动复制）：

1. `tools/auto-update-downloads.js <target> --confirm --push` — 复制 APK 到
   `public/downloads/`，计算 SHA-256 并更新 `hash-manifest.json`，推送触发 Pages 部署
2. `tools/publish-release.js <tag> --confirm [--push]` — 上传 APK/EXE 到 GitHub Release，
   并自动更新 `public/updates/{key}/latest.json`（url / portableUrl / version / releaseNotes）

需要人工同步的双副本（public/ 与 site-official/ 各一份）：

1. `hash-manifest.json` — 下载页读取的 SHA-256 清单
2. `updates/cloud/latest.json` — 云端版（桌面 exe 链接 + 版本号，APP 卡片版本号同源）
3. `updates/dingzhi/latest.json` — 离线版（同上）

> 注意：latest.json 中的 forceUpdate / minVersion / rolloutPercentage 为灰度发布预留字段，
> 2026-08-17 桌面版自动更新机制移除后（commit 22343bc5）暂无客户端消费，仅版本号/链接/日志
> 被下载页使用。桌面程序更新方式为官网手动下载覆盖安装（见 download.html「桌面程序更新方案」）。

## 5. 规则9验收对照

- [x] 官网站点根目录下不存在 `admin/` 目录
- [x] 官网站点根目录下不存在 `auth-core.js` / `permission.js` / `security-guard.js`
- [x] 官网 index.html 显式声明"本站仅下载 + 规则2 隐私承诺"，并清理 localStorage/cookie
- [x] 官网 `_routes.json` 把 `/admin/* /api/* /auth-core.js /permission.js /login.html` 全部 301 跳后台域
- [x] 后台站点根目录存在 `admin/ticket-approval.html`、`admin/build-queue.html`、`admin/activation-codes.html` 导航入口
- [x] 工单审批页 machineId 显示前后各 6 位 + 中间打码（不泄露完整哈希给操作员，符合规则3）

