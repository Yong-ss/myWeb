# SquirrelAPI

## 个人登录（2026-10-27）

主站接入 `/login`、`/account` 和登录/退出接口，仅允许已配置的本人账户。用户已确认测试站登录、刷新和退出正常，并授权发布正式域名；目前只有本人使用，后续普通更新可检查后直接发布主站，无需先发测试站。

本地完整验证：先 `. ./scripts/env.ps1`，再 `pnpm build`、`pnpm preview`，访问 http://127.0.0.1:8787/login。仅 `pnpm dev` 不运行 Worker 登录接口。
本地需在 `apps/web/.dev.vars` 设置 `OWNER_USER_ID="你的 Supabase 用户 ID"`（已忽略，不提交）；URL 和公开 publishable key 在测试配置中，禁止放 service-role key 或密码。

权限测试：`node --test apps/web/worker/auth.test.mjs`。预览发布：`pnpm deploy:preview`。首次需为测试 Worker 配置 `OWNER_USER_ID`。
用户已确认测试站实际登录、刷新保持登录和退出正常。正式发布使用 `pnpm deploy:production`，正式 Worker 也需配置 `OWNER_USER_ID`。正式站和测试站不共享浏览器登录状态，首次需要重新登录。密码恢复仍未实现或验证。

正式发布记录：2026-10-27，版本 `e2e44250-0fb9-41aa-b272-5d0c4f29e6d3`。构建和正式配置 dry-run 通过；首页、登录页、账户页外壳为 200，无登录账户接口 401 且 no-store，跨来源登录 403，空登录输入 400，不存在页面 404。正式域名实际密码登录尚未由用户验证。

第一阶段：pnpm Monorepo + Next.js 静态主站，没有登录、Admin、数据库或其他应用。

## 本地运行

需要 Node.js 24、pnpm 12.15.0。在仓库根目录打开 PowerShell：

```powershell
. ./scripts/env.ps1
pnpm install --frozen-lockfile
pnpm dev
```

打开 http://localhost:3000，Ctrl+C 停止。每个新终端都先载入 env.ps1；换电脑时先调整其中的 Global_Env 路径，再安装依赖，不复制 node_modules。缓存、配置、临时文件保存在 Global_Env，项目依赖链接和构建产物保存在当前工作区。

## 检查与本地部署验证

```powershell
. ./scripts/env.ps1
pnpm check
pnpm --filter @squirrelapi/web deploy:check
pnpm preview
```

check 执行 ESLint、类型检查和静态构建。deploy:check 只检查打包，不上传。preview 使用本地 Cloudflare 环境，打开 http://localhost:8787，检查首页、导航、窄屏显示和不存在路径的 404 页面。

构建输出位于 apps/web/out；静态导出不使用 next start。当前无业务逻辑，不引入单元测试框架。

## 手动部署到免费预览地址

先确认 Cloudflare 账户使用 Free 套餐：

```powershell
. ./scripts/env.ps1
pnpm --filter @squirrelapi/web exec wrangler login
pnpm deploy:preview
```

该命令会真实发布到公开的 squirrelapi-web-preview.<账户子域>.workers.dev，以输出 URL 为准；再次执行更新同名站点，不会自动删除。这不是私密预览。仅上传 apps/web/out，不上传仓库源码和 docs。

此预览命令不会更新正式站，没有付费服务或自动部署。页面 noindex 只是避免搜索索引，不是访问控制。部署后确认首页返回 200、随机不存在路径返回 404、CSS/JS 正常加载，再请朋友从大陆网络验证。

## 根域名正式站

地址：https://squirrelapi.org 。2026-10-26 经用户授权绑定，使用独立 Worker `squirrelapi-web` 和 `apps/web/wrangler.production.jsonc`；原 workers.dev 测试站继续保留。

仅在确认需要发布正式站时执行：

```powershell
. ./scripts/env.ps1
pnpm deploy:production
```

这会构建并更新根域名站点。`pnpm deploy:preview` 只更新测试站。两者共用源码但独立发布，无需复制应用。Cloudflare 管理根域名 DNS 与 HTTPS 证书；没有配置 www 跳转。

本次正式部署版本：`b2761717-7c15-4708-9d15-cee2e3b22783`。HTTPS 首页及引用资源为 200、自定义 404 正常，原测试站仍为 200；仍保留 noindex。

## 项目边界

- apps/web：唯一应用，Next.js + TypeScript + 普通 CSS，无外部字体或图片依赖。
- scripts/env.ps1：本地可移植环境配置。
- docs：需求、架构和决策。

有第二个应用再添加 apps/<name>；出现真实复用再建立 packages。静态模式不支持动态 API、Server Actions 或服务端会话判断，后续需要重新确认设计。

ESLint 暂用 9.39.5：Next.js 的 React/import/accessibility 插件尚未声明兼容 ESLint 10；安装时会看到 ESLint 9 的弃用提示，待插件兼容后统一升级。

参考：[Next.js 静态导出](https://nextjs.org/docs/app/guides/static-exports)、[Cloudflare 静态路由](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)。

## 本次验证记录（2026-10-26）
- 锁文件安装、ESLint、TypeScript、静态构建、Wrangler dry-run 均通过。
- 本地 Cloudflare：首页 200，不存在页面 404，首页引用的 CSS/JS 均为 200。
- 内置浏览器窄屏显示与应用锚点导航通过，首页未捕获到控制台 warning/error。
- 输出约 0.60 MiB；未实际上传 Cloudflare、未绑定域名，桌面宽屏和大陆网络尚未实测。

## 首次云端部署（2026-10-26）
- 已根据用户提供的订阅截图确认 Workers Free 为 Active。
- 实际地址：https://squirrelapi-web-preview.sungshen1.workers.dev
- 部署源码提交：ef0fc7e；Cloudflare 版本：3791a61d-c72a-415f-b6c0-ac10298d9024。
- HTTPS 首页与引用的 CSS/JS 均为 200；不存在路径返回自定义 404；线上浏览器显示正常，未捕获 warning/error。
- 仅部署静态文件，未绑定正式域名、未创建 Supabase 项目、未启用付费服务。
- 上述结果更新了此前“尚未云端部署”的状态；大陆网络仍需实测。
