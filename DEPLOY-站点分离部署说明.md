# 站点分离（官网 / 后台）部署说明

> 规则9 物理拆分执行完成时间：2026-08-08
> 代码拆分：见 `site-official/`（官网）和 `site-admin/`（后台+云端APP）

> ✅ **2026-09-13 重整分离恢复（Cloudflare API 切换 + git push 触发生效）**：此前实测发现三项目
> destination_dir 曾全部漂移为 `public/`（互为完整镜像，违反规则9——官网域服务完整工作站+admin+API）。
> 当日已切换回分离拓扑：**huikang-admin → `site-admin/`（后台+云端APP 站）、
> huikang-official → `site-official/`（纯展示官网）、tcm-prescription-system → `public/`（主站，
> 全部客户端指向不变）**。注意：`huikangzy.com` 三个自定义域名仍无 DNS 解析（域名失效），
> 实际访问入口为 *.pages.dev；管理台控制台子页双副本（public/admin ↔ site-admin/admin）已字节级
> 统一并挂 diff-cross-version `adminconsole` 门禁对（第 4 对）。后端 functions 统一部署自仓库根
> `functions/`（三项目同享，KV/D1 绑定各自项目持有）；后台站页面经 CORS 跨域调用主域 API
> （`CLOUD_API_BASE = tcm-prescription-system.pages.dev/api`，users/prescriptions 等均已带
> OPTIONS 预检与 Access-Control 头）。
>
> ⚠️ **切换 destination_dir 的生效方式（实测坑）**：API `PATCH /pages/projects/{name}`
> 修改 `build_config.destination_dir` 后回读即生效，但随后用 `POST /pages/projects/{name}/deployments`
> （body `{ref:"main"}`）触发的部署**仍按旧目录构建**（实测：official 站部署后仍提供
> `public/` 的 auth-core.js，而 site-official/ 根本没有此文件）——API 重放部署不应用新配置。
> 正确生效方式：**改完 destination_dir 后必须真实 git push 触发 webhook 部署**，新配置才会
> 被构建管线读取。另注意：Cloudflare 构建系统偶发 "unable to submit build job" 临时故障，
> 表现为 initialize 阶段 failure，删除失败部署重试即可。

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

