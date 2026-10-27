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
| 真实本地 Auth／Worker／REST／数据库集成 | `pnpm test:integration` |
| 重要阶段／正式发布前完整回归 | `pnpm test:full` |

Playwright 使用 Club 的静态构建，所以单独运行浏览器测试前先运行 `pnpm --filter @squirrelapi/club build`。`test:affected` 会在需要时构建；无改动时仅检查测试选择规则。尚未安装浏览器的机器运行 `node --import ./tests/runtime-env.mjs ./node_modules/@playwright/test/cli.js install --only-shell chromium`。

## 当前覆盖

- 主站原有 6 项登录／权限测试保持使用。
- Club Node.js 测试覆盖独立 Cookie、身份和有效成员关系、撤销权限、跨来源拒绝、会话刷新、导入数据类型及大小边界、人工身份确认、null/0、合并逻辑、旧预览冲突、服务端俱乐部选择和 Prompt 正文一致性。
- 4 条 Playwright 测试覆盖登录失败／成功、刷新与退出、未登录跳转、JSON 文件上传／粘贴、预览修正、未确认身份拒绝、完整性默认值、null/0、最终确认、失败后沿用同一提交编号重试及旧版本冲突。
- 复用 `supabase/tests/club_security.sql` 与 `club_import.sql`，在 PostgreSQL 17 执行实际迁移，验证匿名拒绝、跨俱乐部隔离、角色边界、撤销权限、约束、版本保留、合并／替换、重复提交、失败回滚与审计。
- 测试选择器与连接安全另有 Node.js 检查，防止共享代码漏检、误启重型测试或连接到非测试环境。

## 安全边界

快速浏览器测试使用只绑定 `127.0.0.1:8791` 的静态服务器，Auth 和业务 API 为每个测试独立的模拟响应；浏览器上下文阻止所有外部请求，服务端没有数据库凭证、生产域名配置或远程 API 转发。它验证网页交互；下面的真实集成测试另行验证实际 Auth／Cookie／REST 链路。

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
- 登录、账户、导入等重要流程／数据库／共享基础设施改动：再运行真实 Supabase 集成；仅 CSS、首页文案或布局改动不启动 Supabase。
- 锁文件、CI、测试基础设施、未知目录或共享配置改动：保守运行完整套件。
- 手动 Full（默认开启）及发布／checkpoint 标签：完整回归。

使用一个 Chromium headless shell、一个测试进程、无自动重试，并缓存依赖与浏览器；不建立浏览器矩阵、定时轮询或收费服务。真实集成需要时才安装固定版本 Supabase CLI 并启动四个核心服务，首次 CI 需拉取镜像（合计约 2.0 GB 解压大小，并非下载流量）。私有仓库仍会消耗账户已有 Actions 免费分钟，额度用尽时不应开通付费预算。

成功只报告数量／结论。失败才保留 Trace、截图及详细错误；CI 仅在失败时上传浏览器资料，保留 3 天。产物在 `.test-artifacts/`，缓存和临时文件不进入 Git。Trace 采用 `retain-on-failure`，截图采用 `only-on-failure`，不录视频。[Playwright 配置说明](https://playwright.dev/docs/test-use-options)

## C～E 开发规则与剩余风险

每完成一个功能，针对其业务判断、权限或失败恢复补有价值的测试；沿用 Node.js、SQL 和这组 Playwright，避免逐层重复测试同一规则。日常运行相关检查，完成重要阶段、正式发布前及 A～E 全部完成时执行完整回归。重要发布可先手动运行完整 CI，成功后再执行既有的人工部署流程。

目前已有真实 Supabase Auth／REST／刷新令牌与数据库链路测试；仍未覆盖云端服务配置差异、Cloudflare 边缘运行时与本地 workerd 的差异、正式证书／域名、邮件邀请／密码恢复投递、真实截图识别准确度、跨浏览器／视觉效果、长期性能及大陆网络。C/D/E 尚未开发的功能没有预先假装覆盖。视觉和自动化无法覆盖的问题才使用 Computer Use。

## 真实 Supabase 集成测试

`pnpm test:integration` 自动构建 Club，启动独立本地 Supabase、创建合成账号和数据、应用现有迁移、启动实际 HTTPS Worker、执行 Playwright 并停止专用服务／删除测试数据卷。无需手工登录或点击，原有快速套件保留。前置条件是 Docker Engine 正在运行、Supabase CLI 2.120.0 和现有 Playwright Chromium；Windows 复用 Global_Env 中的 CLI，其他安装位置可通过 `SUPABASE_BIN` 指定可执行文件。CI 使用官方 `supabase/setup-cli@v3` 固定安装 2.120.0，不需要云账号或生产 secrets。

- 专用项目名：`squirrelapi-club-integration`；API `http://127.0.0.1:56321`，数据库端口 `56322`，Worker `https://127.0.0.1:8792`，检查端口 `9232`。与现有本地项目端口分离。
- 仅运行真实 PostgreSQL、GoTrue Auth、PostgREST 和 Kong；Studio、邮件、Storage、Realtime、分析与 Edge Runtime 均关闭。
- 配置模板在 `tests/integration/supabase/config.toml`，实际 CLI 工作目录固定为 `.test-runtime/integration/project`；不使用根目录的项目连接信息，不读取正式 Worker 配置。
- 先通过真实本地 Auth Admin API 创建四个已确认邮箱的合成账号，再复制并以 `supabase migration up --local` 应用原有迁移：这是因为首个业务迁移显式引用了初始 Owner 的用户 ID。测试账号复用该 UUID，但邮箱／密码完全是合成资料。
- 初始化两个俱乐部、Owner／Admin／未授权账号／另一俱乐部 Owner，以及两名种子玩家；测试中新建数据均属于此栈。真实 JWT 由本地 Auth 签发，不伪造待测的 Auth 或业务 API。
- Worker 使用应用原有源码及 workerd，测试专用配置只含固定本地 URL／publishable key／俱乐部 ID。管理 key 只在初始化进程内存中使用，不传入网页或 Worker，也不提交或上传状态文件。
- Playwright 只对固定本地 HTTPS 地址忽略自签证书错误，以实际测试 `__Host-`／Secure／HttpOnly／SameSite Cookie；不改变正式 TLS 配置。
- HTTP 辅助函数拒绝其他 Supabase 地址、其他端口及跳转；Docker 必须为本机 Unix socket／Windows pipe；CLI 拒绝 linked／db-url／project-ref／all 等参数。SQL 写入再次验证专用容器标签和数据库中的测试标记。没有 `supabase link`、远程 migration push 或正式 key。
- 断网恢复通过浏览器离线／上线实现，不返回伪造 API 响应；重复提交和并发旧预览通过实际 Worker／REST／数据库验证。

六条真实流程覆盖：Owner 登录、Cookie、刷新与退出撤销；Owner 文件导入／修正后的实际存储、重复提交和并发冲突；Admin 导入但不能修改角色、撤销即时生效；已确认但未授权账号及另一俱乐部 Owner 被拒绝；跨俱乐部 REST/RPC 隔离及错误身份写入回滚；断网后保持同一提交编号恢复并仅保存一次。

每轮使用专用锁避免并行重置；正常结束和测试失败都会停止专用栈并删除其数据卷，其他本地项目不受影响。强制终止进程或断电可能留下锁／容器；确认没有测试运行后，可执行 `supabase stop --project-id squirrelapi-club-integration --no-backup`，再删除 `.test-runtime/integration/run.lock`。不要使用 `--all`。

成功只输出简短结论；失败保留 Playwright Trace、截图及已去除 key／JWT 的专用服务尾部日志，CI 保留 3 天。状态文件及生成配置在 `.test-runtime/`，不会进入 Git；测试结束清除运行状态和临时变量文件。
