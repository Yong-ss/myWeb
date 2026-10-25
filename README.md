# SquirrelAPI

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

没有正式域名配置、付费服务或自动部署。页面 noindex 只是避免搜索索引，不是访问控制。部署后确认首页返回 200、随机不存在路径返回 404、CSS/JS 正常加载，再请朋友从大陆网络验证。

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
