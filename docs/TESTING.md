# 自动化测试

## 日常命令

Windows 每个新终端先运行 `. ./scripts/env.ps1`，将缓存和临时文件放在 Global_Env 或工作区。

| 场景 | 命令 |
|---|---|
| 只运行受当前已跟踪／新增改动影响的检查 | `pnpm test:affected` |
| 所有 Node.js 单元及接口测试 | `pnpm test:unit` |
| 保留原有 Club 检查、类型、测试、构建及 dry-run | `pnpm club:check` |
| 已构建 Club 后运行关键浏览器流程 | `pnpm test:e2e` |
| 只运行登录或导入浏览器流程 | `pnpm test:e2e auth.spec.mjs` / `pnpm test:e2e import.spec.mjs` |
| 隔离数据库迁移、RLS 和事务测试 | `pnpm test:db` |
| 重要阶段／正式发布前完整回归 | `pnpm test:full` |

Playwright 使用 Club 的静态构建，所以单独运行浏览器测试前先运行 `pnpm --filter @squirrelapi/club build`。`test:affected` 会在需要时构建；无改动时仅检查测试选择规则。尚未安装浏览器的机器运行 `node --import ./tests/runtime-env.mjs ./node_modules/@playwright/test/cli.js install --only-shell chromium`。

## 当前覆盖

- 主站原有 6 项登录／权限测试保持使用。
- Club Node.js 测试覆盖独立 Cookie、身份和有效成员关系、撤销权限、跨来源拒绝、会话刷新、导入数据类型及大小边界、人工身份确认、null/0、合并逻辑、旧预览冲突、服务端俱乐部选择和 Prompt 正文一致性。
- 4 条 Playwright 测试覆盖登录失败／成功、刷新与退出、未登录跳转、JSON 文件上传／粘贴、预览修正、未确认身份拒绝、完整性默认值、null/0、最终确认、失败后沿用同一提交编号重试及旧版本冲突。
- 复用 `supabase/tests/club_security.sql` 与 `club_import.sql`，在 PostgreSQL 17 执行实际迁移，验证匿名拒绝、跨俱乐部隔离、角色边界、撤销权限、约束、版本保留、合并／替换、重复提交、失败回滚与审计。
- 测试选择器另有 4 项 Node.js 测试，防止共享代码或未知新目录漏检。

## 安全边界

浏览器测试使用只绑定 `127.0.0.1:8791` 的静态服务器，Auth 和业务 API 为每个测试独立的模拟响应；浏览器上下文阻止所有外部请求，服务端没有数据库凭证、生产域名配置或远程 API 转发。它验证真实网页交互，不代表真实 Supabase Auth／Cookie／REST 的整套端到端集成；Worker 的授权逻辑由原有 Node.js 测试验证。

数据库命令不接受连接 URL、主机、数据库名或 Supabase 项目链接，只能连接 `127.0.0.1:55432` 的 `squirrelapi_test`（可用 `TEST_DB_PORT` 改本地端口）。测试 SQL 本身也检查数据库名称，禁止复制到正式项目执行。整个初始化、迁移和各测试套件放在事务及独立保存点中，结束时回滚；不能以“最后会回滚”为理由在正式数据库运行测试。

测试数据库初始化只模拟迁移依赖的 `auth.users`／`auth.uid()` 接口，并非完整 Auth 服务。相同 UUID 只是合成测试身份，不包含实际邮箱、密码或用户数据。新建的测试数据库应为空，已有 Auth schema／角色会令初始化失败。

本地无 `psql` 或隔离数据库时，SQL 测试会明确失败，不静默跳过；可以先运行 Node.js／Playwright，并以 GitHub Actions 的隔离 PostgreSQL 结果验证 SQL。可选本地容器（仅在 Docker 已配置且接受下载镜像时）：

```powershell
docker run --rm --name squirrelapi-test-db -e POSTGRES_DB=squirrelapi_test -e POSTGRES_PASSWORD=test-only-local -p 127.0.0.1:55432:5432 postgres:17
```

另一个终端有 PostgreSQL 客户端后执行 `pnpm test:db`；`PSQL_BIN` 可指定客户端程序路径。此固定密码仅用于可丢弃的本机／CI 测试容器。

## CI 与费用控制

`.github/workflows/ci.yml` 在 main 推送、指向 main 的 PR、手动运行和 `v*`／`checkpoint-*` 标签触发；不部署网站，不提供生产密钥。工作流仅有内容读取权限，单个 Linux job 最长 10 分钟，同一分支新运行取消旧运行。

- 仅文档改动：只验证测试选择规则，不安装依赖或浏览器、不运行 SQL；服务容器随短任务销毁。
- 主站改动：主站 lint、类型、原有 Node.js 测试和构建。
- Club 改动：复用 `pnpm club:check`，并选择登录、导入或全部 4 条浏览器流程。
- Worker／共享导入逻辑／SQL 改动：增加隔离 SQL 检查。
- 锁文件、CI、测试基础设施、未知目录或共享配置改动：保守运行完整套件。
- 手动 Full（默认开启）及发布／checkpoint 标签：完整回归。

使用一个 Chromium headless shell、一个测试进程、无自动重试，并缓存依赖与浏览器；不建立浏览器矩阵、定时轮询或收费服务。私有仓库仍会消耗账户已有 Actions 免费分钟，额度用尽时不应开通付费预算。

成功只报告数量／结论。失败才保留 Trace、截图及详细错误；CI 仅在失败时上传浏览器资料，保留 3 天。产物在 `.test-artifacts/`，缓存和临时文件不进入 Git。Trace 采用 `retain-on-failure`，截图采用 `only-on-failure`，不录视频。[Playwright 配置说明](https://playwright.dev/docs/test-use-options)

## C～E 开发规则与剩余风险

每完成一个功能，针对其业务判断、权限或失败恢复补有价值的测试；沿用 Node.js、SQL 和这组 Playwright，避免逐层重复测试同一规则。日常运行相关检查，完成重要阶段、正式发布前及 A～E 全部完成时执行完整回归。重要发布可先手动运行完整 CI，成功后再执行既有的人工部署流程。

目前未覆盖真实 Supabase Auth／REST／刷新令牌与真实数据库的完整浏览器链路、邮件邀请／密码恢复、真实截图识别准确度、跨浏览器／视觉效果、真实网络及大陆可用性；需要完整隔离 Supabase 栈及合成账号后才能安全增加真实集成测试。C/D/E 尚未开发的功能没有预先假装覆盖。视觉和自动化无法覆盖的问题才使用 Computer Use。
