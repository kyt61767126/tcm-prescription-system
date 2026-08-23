# 站点分离（官网 / 后台）部署说明

> 规则9 物理拆分执行完成时间：2026-08-08
> 代码拆分：见 `site-official/`（官网）和 `site-admin/`（后台+云端APP）

## 1. 两站点各自的构建输出根目录

| 站点 | 根目录 | Pages / Nginx 指向 |
|---|---|---|
| 官网 | `site-official/` | `/var/www/kyt-zy/site-official` 或 Cloudflare Pages 项目 `huikang-official` |
| 后台+云端APP | `site-admin/` | `/var/www/kyt-zy/site-admin` 或 Cloudflare Pages 项目 `huikang-admin` |

## 2. 两个 Pages 项目（Cloudflare）

### 2.1 huikang-official（纯展示）
- 绑定域名：`www.huikangzy.com`
- 构建命令：无（纯静态）
- 输出目录：`site-official`
- 路由/头：已经在 `site-official/_routes.json` 和 `site-official/_headers` 写好（敏感路径 /admin /api /auth-core 一律 301 跳后台域）

### 2.2 huikang-admin（带鉴权）
- 绑定域名：`admin.huikangzy.com`
- 构建命令：无（纯静态）
- 输出目录：`site-admin`
- 需要在 Pages 上绑定 Worker：对所有 `/admin/*` 路由加平台管理员 JWT 校验（role=platform_admin），无登录态一律跳转到 `/admin/index.html#login`

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

