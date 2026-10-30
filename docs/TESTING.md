# 自动化测试

## 当前发布流程（Current State，唯一有效）

本地开发 → 本地 `pnpm test:affected` → 直接 Push 到 `main` → GitHub Actions 测试 → 全部成功后自动发布。不需要 PR、分支或审批。

- 只有 `push` 到 `main` 且本次运行全部检查成功才发布；任一检查失败、被取消、PR、标签或手动运行都不发布。
- 改动范围从“上一次成功的 main 运行”算起：失败或取消的运行未发布的改动，会自动包含在下一次运行中，不会被文档提交“吞掉”。
- main 的运行排队执行、不互相取消；只有 PR 运行会被新提交取消。旧运行（例如手动重跑旧提交）若 main 已有更新提交，会拒绝发布，避免旧版本覆盖新版本。
- 只按“会改变线上产物”的文件发布：`apps/club/**` → Club，`apps/web/**` → 主站，依赖／工作区配置／未知路径 → 两者。所有 `*.md`、`docs/**`、`*.test.mjs`、`tests/**`、`scripts/**`、`.github/**`、`supabase/**` 只运行相应测试，不发布。没有新增付费服务。

一次性在 GitHub 仓库 Settings → Secrets and variables → Actions 配置：Secret `CLOUDFLARE_API_TOKEN`；Variables `CLOUDFLARE_ACCOUNT_ID`、`CLUB_SCHEMA_VERSION`。API Token 仅授予当前账户的 Workers 发布权限及 `squirrelapi.org` 的路由管理／读取权限，不能使用 Supabase 管理密钥或把 Token 写进仓库。[Cloudflare 官方配置说明](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)

数据库迁移永远人工执行，CI 不连接正式数据库。正式迁移成功后，将 `CLUB_SCHEMA_VERSION` 更新为已应用的最新迁移文件编号，再重跑最新一次 main 工作流。版本不一致或缺少部署凭据时明确报错并停止发布。迁移本身不触发 Worker 重新发布；若同一批改动包含 Club 代码，未先迁移会令发布失败，迁移后重跑即可。

正式迁移后、更新 `CLUB_SCHEMA_VERSION` 前，在 Supabase SQL Editor 只读执行 `select version from supabase_migrations.schema_migrations order by version;`，确认每个 `supabase/migrations` 文件都已应用、没有遗漏中间版本。该变量只是人工确认，CI 不会读取正式数据库。

执行迁移只用仓库原始文件，不手动转写 SQL（2026-10-30 曾因转写把 `'{}'::jsonb` 写成 `''::jsonb` 导致正式函数出错）。首选本人在本机运行 `supabase db push`（读取原文件并保留文件编号）；Supabase MCP `apply_migration` 需要把 SQL 复制进参数且会生成新编号，仅作备选，用后须把文件改名为生成的编号。`supabase db push` 前必须先确认目标与内容：`supabase/.temp/project-ref` 等于正式项目 `lnwifbsjfwchshtxyzcu`，并运行 `supabase db push --dry-run` 核对待执行的迁移列表只含预期文件，确认后再去掉 `--dry-run`。执行后运行 `node scripts/migration-checksums.mjs supabase/migrations/<文件>`，把输出的只读查询贴到 SQL Editor，每个函数都必须是 `ok` 才能更新 `CLUB_SCHEMA_VERSION`。该检查只覆盖函数体；表、约束、策略仍按上面的版本列表人工确认。

迁移先于 Worker 发布，期间（以及发布失败或回滚时）正式环境是“旧 Worker + 新数据库”。含迁移的改动在 Push 前运行 `pnpm test:compat`：用已部署版本（默认 `origin/main`）的 Worker 和它自己的真实集成测试，跑在加上全部新迁移的本地隔离 Supabase 上；被新迁移有意收紧的旧断言在 `scripts/test-compat.mjs` 中逐条列出并说明由哪个新测试覆盖。已应用的迁移若被改动则直接失败。

## 备份（Supabase 免费版没有自动备份）

由本人在本机执行，CI 和 AI 不执行；连接串含数据库密码，只在当前终端输入，不写入仓库。每次重要导入后或每周一次：

```powershell
supabase db dump --db-url "<正式库连接串>" -f club-schema.sql
supabase db dump --db-url "<正式库连接串>" --data-only -f club-data.sql
```

文件含成员资料，加密后保存在仓库以外。`auth.users` 不在导出范围内，恢复后需重新确认账户与 Owner 关系。首次备份后，在可丢弃的本地 PostgreSQL 试恢复一次，确认文件可用。免费项目连续 7 天无活动会被暂停，留意 Supabase 提醒邮件。

## 错误日志

Worker 的意外异常仍返回 502，同时用 `console.error` 输出一行 JSON（`event`、`path`、错误类型和消息），不含 Cookie、Token 或请求内容。可用 `wrangler tail squirrelapi-club` 实时查看；持久保存需另行开启 Workers Logs（`observability`，待确认）。

下文带日期的章节是历史验证记录，若与本节冲突，以本节为准。

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

`.github/workflows/ci.yml` 在 main 推送、指向 main 的 PR、手动运行和 `v*`／`checkpoint-*` 标签触发；只在上述条件下发布，部署凭据只提供给发布步骤。工作流只有内容／Actions 读取权限，单个 Linux job 最长 10 分钟；main 运行排队不取消，PR 运行新取代旧。

- 仅文档改动：只验证测试选择规则，不安装依赖或浏览器、不运行 SQL；服务容器随短任务销毁。
- 主站改动：主站 lint、类型、原有 Node.js 测试和构建。
- Club 改动：复用 `pnpm club:check`，并运行全部浏览器流程（导入相关回归分散在多个 spec，不再按文件名挑选）。
- Worker／共享导入逻辑／SQL 改动：增加隔离 SQL 检查。
- 登录、账户、导入等重要流程／数据库／共享基础设施改动：再运行真实 Supabase 集成；仅 CSS、首页文案或布局改动不启动 Supabase。
- 锁文件、CI、测试基础设施、未知目录或共享配置改动：保守运行完整套件。
- 手动 Full（默认开启）及发布／checkpoint 标签：完整回归。

使用一个 Chromium headless shell、一个测试进程、无自动重试，并缓存依赖与浏览器；不建立浏览器矩阵、定时轮询或收费服务。真实集成需要时才安装固定版本 Supabase CLI 并启动四个核心服务，首次 CI 需拉取镜像（合计约 2.0 GB 解压大小，并非下载流量）。私有仓库仍会消耗账户已有 Actions 免费分钟，额度用尽时不应开通付费预算。

成功只报告数量／结论。失败才保留 Trace、截图及详细错误；CI 仅在失败时上传浏览器资料，保留 3 天。产物在 `.test-artifacts/`，缓存和临时文件不进入 Git。Trace 采用 `retain-on-failure`，截图采用 `only-on-failure`，不录视频。[Playwright 配置说明](https://playwright.dev/docs/test-use-options)

## C～E 开发规则与剩余风险

每完成一个功能，针对其业务判断、权限或失败恢复补有价值的测试；沿用 Node.js、SQL 和这组 Playwright，避免逐层重复测试同一规则。日常运行相关检查，完成重要阶段、正式发布前及 A～E 全部完成时执行完整回归。重要发布可先手动运行完整 CI（不发布），确认后再按常规 Push。

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

九条真实流程覆盖：Owner 登录、Cookie、刷新与退出撤销；Owner 文件导入／修正后的实际存储、重复提交和并发冲突；Admin 导入但不能修改角色、撤销即时生效；已确认但未授权账号及另一俱乐部 Owner 被拒绝；跨俱乐部 REST/RPC 隔离及错误身份写入回滚；断网后保持同一提交编号恢复并仅保存一次；79 人批量建档后次日自动匹配及 71 人缺漏提醒；别名人工记忆、次日自动关联、原始昵称／正式昵称分离与错误关联解除；真实别名冲突、同名不同人和缺席后重新加入保留 UUID。

B 身份匹配另有纯函数测试：79 人准确匹配、确认／未确认别名、准确昵称与别名冲突、重复目标、装饰／形近字、数字证据不能证明身份、等级／途径／评分／繁荣度／入会天数异常。Worker 测试验证别名接口必须明确确认并使用服务端俱乐部；`club_identity.sql` 验证实际事务、别名冲突、撤销、重新加入、原始昵称保留和拒绝直接写表。新增 migration 后仍执行原有 SQL 套件，保护快照、幂等和 RLS。

身份匹配属于敏感业务改动，运行 `pnpm club:check`、`pnpm test:unit`、`pnpm test:db`、`pnpm test:e2e` 和 `pnpm test:integration`；发布前使用完整 CI 回归。这里只验证身份恢复和快照保留，离会状态／成员历史查询仍待 C 阶段开发。人工把两个不同的人确认为同一身份无法由算法保证纠正；通过别名撤销和同日修正版保留可追溯纠错路径。

每轮使用专用锁避免并行重置；正常结束和测试失败都会停止专用栈并删除其数据卷，其他本地项目不受影响。强制终止进程或断电可能留下锁／容器；确认没有测试运行后，可执行 `supabase stop --project-id squirrelapi-club-integration --no-backup`，再删除 `.test-runtime/integration/run.lock`。不要使用 `--all`。

成功只输出简短结论；失败保留 Playwright Trace、截图及已去除 key／JWT 的专用服务尾部日志，CI 保留 3 天。状态文件及生成配置在 `.test-runtime/`，不会进入 Git；测试结束清除运行状态和临时变量文件。

## C 名单查询测试
新增 Worker 测试覆盖登录边界、固定俱乐部过滤、只读版本查询、非法参数、分页和超限拒绝；Playwright 覆盖日期、旧版本、搜索及 0 显示；现有真实导入测试增加查询实际保存名单及页面读取断言。沿用隔离测试栈，不写正式测试数据。本轮按用户此前指示未运行测试，发布前仍需执行相关检查和真实集成测试。

## Club 动效样板 — 2026-10-28
成员页新增 members-motion.spec.mjs：四种尺寸、hover/active/focus、初始 loading、禁用、失败重试、菜单键盘循环和焦点归还、触摸反复开关、reduced-motion，以及返回旧首页的主题隔离。合成数据由 Playwright 拦截提供，不连接正式 Auth／数据库。已使用本地 Next dev 页面和真实 Chromium 运行 8 项浏览器检查（含原有成员查询 UI 测试），以及 4 项成员 Worker 单元测试；Club lint 与 TypeScript 检查通过。桌面／手机截图已人工审阅。此次未运行 SQL／真实 Supabase 集成／全站回归，因仅呈现层试点及类型标注修正；没有宣称这些套件通过。后续正常静态构建后的 test:e2e 会包含新测试。


## 共享组件迁移验证 — 2026-10-28

新增 account-ui.spec.mjs：四种尺寸的账户信息、导航高亮、入口链接、键盘焦点、页面溢出、Loading 期间禁止重复退出、错误恢复及按钮尺寸稳定。沿用 auth.spec.mjs 验证原有登录失败／重载／退出／未授权重定向。fixture 根据 Playwright 配置限定本地来源，可复用静态服务或本地开发服务，仍拦截全部测试 API。迁移不涉及业务契约或数据库结构，不用正式数据库进行自动化操作。


## 导入交互视觉验证 — 2026-10-28

import-ui.spec.mjs 补四种尺寸的准备／身份弹窗／最终预览、整页溢出检查，以及定制原生 Select 的打开、键盘选项、Escape 和手机触摸。截图只含合成资料，存放于忽略的测试输出目录。与既有 import.spec.mjs 一起保护 JSON 解析、身份选择、null/0、确认保存、失败重试幂等和同日版本冲突。沿用 Chromium；未验证所有浏览器的 base-select 支持，旧浏览器原生回退不算视觉等价。


## C 成员状态与个人历史测试 — 2026-10-28

新增 presence.test.mjs 覆盖不完整不判离会、完整缺席、离会后持续缺席、原 UUID 重返、首次记录之前的日期、null／0／百分比以及周活跃重置提示。public-ui.spec.mjs 与 player-history.spec.mjs 使用合成资料检查首页／登录桌面和手机、档案事件与表格。

presence.spec.mjs 在既有隔离 Supabase 中通过真实 RPC 建立两位合成玩家和四天名单，以真实 Worker／REST 验证暂未识别→暂离→重返、截止日期、Owner/Admin 与未授权／跨俱乐部隔离，并打开个人档案页；所有写入仅发生在现有专用可销毁数据库。集成脚本支持传入测试筛选：`pnpm test:integration -- presence.spec.mjs`；完整命令仍不变。身份／状态推断不能替代管理员正确确认完整名单。

本批验证结果：Club lint、TypeScript、32 项 Club 单元测试、13 项相关浏览器测试通过；首次真实集成运行的既有 9 项通过，新增场景在修正测试用的 Response API 与独立 Cookie 上下文后，使用筛选命令单独通过。未重跑独立 SQL 套件／test:full，不将分批通过描述为一次完整回归。隔离测试栈已自动停止。

发布前发现并修正断网恢复用例的随机依赖：此前并发评分更新可能触发身份人工确认，测试不能假设记录一定出现在自动匹配区。现在固定建立评分基线，覆盖异常后的人工确认和原有断网重试断言；业务匹配规则不变。

## 名称设置与总览 — 2026-10-28
本批 Club lint、TypeScript、33 项单元测试及 17 项相关浏览器测试通过（总览、设置持久化契约、账户、登录、手机导航／键盘／减少动态效果）。settings.spec.mjs 的 1 项真实集成场景通过：真实登录、设置页保存、PostgreSQL 读取、刷新保持、旧值冲突、空值、Admin／无权用户／跨俱乐部拒绝、直接表更新拒绝及改名审计。测试只使用专用本地 Supabase，自动清理该测试栈；未写正式库。初次因 Docker 未启动中止，启动后重跑通过；旧预览测试因服务未开失败，改用既有自动启动测试服务器后通过。未运行 test:full 或独立 SQL 套件，未应用正式迁移、Push 或部署。

## 读取性能基础 — 2026-10-28
Club lint／类型检查／构建／Worker dry-run、39 项 Club 单元测试、8 项测试选择与隔离安全测试通过。浏览器本轮原 31 项中 26 项通过；修正名称接口模拟误返回 403 后，失败所在的 members-motion 7 项单独全部通过（分批覆盖，不描述为一次全绿运行）。真实隔离回归的 11 项业务场景通过；大数据基准修正 Windows 基线模块加载后单独 1 项通过，生成 80,000 行并验证 RPC 游标、跨租户 RLS 和 EXPLAIN。无正式数据写入。完整 pnpm test:full 未运行；独立 pnpm test:db 因本机缺少 psql 及专用 PostgreSQL 服务未能执行，迁移已在真实隔离 Supabase 验证，独立 SQL 夹具仍待 CI。GitHub 尚未 Push，不能声称 CI 已通过。性能规范与实际数据见 PERFORMANCE.md。

发布前增量验证：最终 43 项 Club 单元测试及 lint 通过；闪动修复后构建和 5 项档案／名单／总览浏览器测试通过。已获正式迁移及 main 发布授权，迁移已完成，CI 将负责独立 SQL 夹具及整套相关回归。

## Club Loading Kit — 2026-10-28

UI-only integration: existing 34 browser scenarios passed across batches after updating the empty-state locator; 7 new scenarios cover local Lottie SVG playback, reduced-motion (no animation JSON request), animation request failure fallback, fast requests (no PageLoader animation), table error/retry/empty at 1440/320px, and settings read failure/retry without writes. Existing account tests cover loading logout and duplicate-request blocking; import flow tests retain retry/idempotency checks. The player background-refresh case additionally asserts no ProfileSkeleton replaces loaded data. Latest focused run: 9 passed (7 new + 2 brand cases). Club lint, TypeScript generation and production build passed; desktop animated and 320px table screenshots were inspected.

All browser APIs use synthetic fixtures and the existing local static server; no production APIs or business data were accessed. No Worker, RLS, migration, data-access or auth logic changed; SQL / real Supabase suites / test:full were not run for this UI-only batch. No push, CI run or deployment. CodeGraph sync was attempted twice but another process (PID 13124) holds its index lock; not forcibly unlocked. Real-device Safari/Firefox and assistive-technology reading remain unverified; static fallback and text are retained.

加载自然度增量验证：已增加总览图表／排名加载前后 bounding box 一致断言，成员搜索栏以文档坐标验证加载前后位置（避免把浏览器自动滚动误判为布局变化）。导入完成卡用原版本消息维持同一成功播报。14 项相关用例中修正了新增状态导致的重复 status 以及坐标测量后，相关用例分批通过；最终布局以最后一轮记录为准。未 Push／部署，全部为本地合成 API。

最终增量：17 项导入／加载／名单／总览／档案浏览器用例在同一轮全部通过，含桌面及手机布局位置断言；lint、类型及构建通过。

共享页头增量：19 项账户／导航／登录／总览相关用例分批通过；最新一轮 14 项全部通过，覆盖五个私人页面同样页头、滚动固定、桌面／手机宽度、抽屉焦点与退出失败重试和重复点击保护。错误移至页头后的测试定位已同步。lint、类型及构建通过；未 Push／部署。
常驻根布局增量：最新 13 项账户、登录、公开页及页头测试同轮通过，验证慢速权限校验期间设置不位移、软导航不重挂页头、五个私人页面仅有一套导航。
本次发布前验证：pnpm club:check 通过（lint、类型、43 项单元测试、生产构建、Worker dry-run），全部 45 项浏览器测试同轮通过，含桌面侧栏滚动固定断言。未重跑 SQL／真实 Supabase 集成套件，本批未修改业务 API 或数据库。CodeGraph 同步因另一进程 PID 51372 持锁未完成，未强制解锁。

## 删除导入与操作日志 — 2026-10-28
- `pnpm club:check` 通过：lint、类型、44 项单元测试、静态构建及 Worker dry-run。
- 14 项相关浏览器用例同轮通过，覆盖删除日期确认、失败重试、日志读取失败／重试、分页／空状态、既有名单和导航；已审阅桌面日志及手机删除弹窗截图。随后仅调整弹窗按钮间距（使用已有 spacing token），该版本在真实集成构建及 UI 删除流程中验证。
- 真实隔离回归：原有 11 项业务场景通过；新 activity 场景初次因测试辅助 SQL 缺分号中断，修正后 `pnpm test:integration activity.spec.mjs` 单独通过。分批共覆盖 12 项，不描述为一次完整绿灯；可选 80,000 行性能基准未开启（1 项跳过）。
- 新场景验证真实 Admin UI 删除、Owner/Admin RPC、跨俱乐部拒绝、过期版本冲突、所有版本／原始输入／个人历史不可见、重复删除只记一次、日志不可插入或删除、原请求重放冲突、重新导入沿用第三版、50 条游标无重复遗漏，以及已撤权会话失效。所有写入仅专用本地 Supabase，测试栈自动停止。
- `pnpm test:db` 因本机无 psql（ENOENT）及专用 squirrelapi_test 数据库未能运行；新 migration 已由真实隔离 Supabase 应用和验证。没有运行 test:full，没有 CI／Push／正式迁移或部署。
发布记录：用户确认后已将同一迁移应用到正式 myWeb Supabase；工具生成的迁移元数据版本已对齐仓库 20261028133444（文件与 SQL 未改名／重写）。已只读检查权限，匿名不可执行删除、应用角色不可删除日志；未在正式库测试删除或写入业务样本。CLUB_SCHEMA_VERSION 已更新，等待本次 main CI。
CI 修复：简化 PostgreSQL Auth fixture 补齐真实 auth.users 的 email 列及合成邮箱；增加导入审计邮箱／当时角色断言。真实 Supabase 无此缺列问题，正式迁移与业务代码不变；由 CI 隔离 PostgreSQL 执行该 SQL 套件。

## 导入弹窗更正正式昵称 — 2026-10-28
- pnpm club:check 通过：lint、类型、45 项单元测试、构建、Worker dry-run。
- 11 项导入相关浏览器用例同轮通过，含 1440／390 更正昵称草稿、空名称阻止确认、最终预览及实际提交 metadata；审阅手机截图，复用原弹窗滚动与主题。
- 真实隔离 Supabase 回归 13 项同轮通过（可选 80,000 行性能基准未开启，1 项跳过）。新增用例通过真实 Admin UI：首次错名、第二天选原身份更正、预览前不写入、最终提交更新正式名且历史不变、审计保留当时角色、重复提交不重复日志、变更重试内容拒绝、后续无权行导致整批回滚、过期昵称／跨俱乐部／同名冲突拒绝，下一次身份上下文使用新名且不自动记住旧错名。
- 无生产数据写入／正式迁移／Push／部署；未运行独立 test:db（本机缺 psql）或 test:full，migration 已在真实隔离库自动应用并验证。隔离栈已停止。

## 第二步缺席核对 — 2026-10-28
- Club lint、类型、构建和 Worker dry-run 通过；单元测试更新为新 RPC 的两次请求预算后 48 项通过，包含逐人退会、页边界离会保持、缺席输入验证和旧 schema 提前阻止核对。
- 7 项缺席／导入／昵称浏览器用例通过；随后 9 项缺席／名单／总览／个人历史同轮通过。审阅手机缺席区域截图，桌面／手机选择、部分合并不误报、完整名单互斥及最终提交字段通过。未改业务数据的模拟 API 用于浏览器层。
- 真实 Supabase：初轮因新增 SQL 中变量与列同名失败，限定列名后修复；新增用例修正 Playwright APIResponse 的测试读取方式后，完整回归 13 项通过、1 项既有名单断言受新夹具历史记录影响失败，可选大数据性能项 1 项跳过。修正断言只检查当天 present 行，并为并发预览更新基线版本后，缺席＋Club 7 项同轮通过；最终日志仅记录本次实际选择及拒绝多余字段的版本，新增缺席用例又单独通过。分批覆盖 14 个业务场景，不称一次完整全绿。
- 真实验证 Admin UI 缺席选择、完整名单冲突、重复提交去重、基线冲突、漏确认拒绝、同日修正保持已离会、后续不完整名单保持状态、再次出现沿用 UUID、分页及旧个人历史接口一致、跨俱乐部拒绝、直接表写拒绝、操作日志角色与实际选择。隔离测试栈自动停止，未写正式数据。
- 独立 test:db 因已知本机无 psql 未运行，未执行 test:full 或 80,000 行性能基准；新 migration 已在隔离 Supabase 实际应用并验证。未 Push／CI／正式迁移／部署。正式库仍需依序应用 20261028140238 昵称更正与 20261028142025 缺席核对。
发布记录：用户确认 Push 后，正式 myWeb Supabase 已依次应用两项经过隔离验证的 migration（昵称更正 20261028140238、缺席核对 20261028142025）；仅将工具分配的迁移元数据编号对齐现有文件版本，未改文件名。正式库只检查结构和权限，未执行测试导入／改名／退会写入；CLUB_SCHEMA_VERSION 已更新，CI 状态以本次 GitHub 运行结果为准。
人数图表视觉增量：lint、类型及构建通过；最新 8 项图表／总览浏览器用例同轮通过，包含 1440／390／320 宽度、键盘 Tab／Escape、鼠标、真实触摸模拟、单点零值、reduced-motion、提示框边界及加载前后面板尺寸。审阅桌面／小屏截图并修复全局按钮样式覆盖数据点。未运行数据库／真实集成或完整套件（纯图表 UI，数据请求及业务未改），未 Push／部署。
人数总览文案／交互收尾：删除原标题与说明，提示卡固定横向位置避免两端跳动；最新 lint、含 TypeScript 的构建和 8 项相关 Playwright 用例通过，检查桌面／手机截图。未运行无关数据库／完整回归，未 Push 或部署。
零起点增量：构建（含类型检查）及 8 项图表／总览浏览器用例通过，验证展示基准节点、单日真实零值、触摸与窄屏；不改业务数据。
