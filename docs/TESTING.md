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

**Club 权限 V1 的 7 个迁移例外：不用 `supabase db push`**（它逐个文件提交，中途失败会留下半个迁移），改按 `docs/CLUB_PERMISSIONS_PLAN.md` 7.3 用 `psql --single-transaction` 执行 7 个原始文件加 `scripts/club-v1-structure-check.mjs` 生成的检查，成功后才运行 `supabase migration repair --status applied <7 个版本号>`。执行前的只读预检查是 `scripts/club-v1-precheck.sql`（只读事务，结束时回滚，每行 `ok` 都应为 true）。

迁移先于 Worker 发布，期间（以及发布失败或回滚时）正式环境是“旧 Worker + 新数据库”。含迁移的改动在 Push 前运行 `pnpm test:compat`：用已部署版本（默认 `origin/main`）的 Worker 和它自己的真实集成测试，跑在加上全部新迁移的本地隔离 Supabase 上；Club 权限 V1 的 7 个待部署迁移按「只有 A」「A～C」「A～E」「全部」四种数据库状态分别运行（模拟迁移中途停止），`pnpm test:compat origin/main all` 可只跑一种。旧测试中只因迁移有意改变的期望值（超管完整权限列表、`platform_users` 字段、`platform_overview.alliances`）和 P4 违反单职位规则的测试数据按状态精确替换，每处替换必须恰好匹配一次，否则直接失败；超管真实 TOTP、P2、平台面板和 P4 的原子性、并发、重放、撤销断言照常运行。只有一条测试整条排除（多职位合并，本身就违反单职位规则），原因写在 `scripts/test-compat.mjs`。已应用的迁移若被改动则直接失败。

## 备份与恢复（Supabase 免费版没有自动备份，2026-11-03 本地实测）

依据 Supabase 官方 [Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)。只由本人在本机执行，CI 和 AI 不执行。连接串（含数据库密码）只在当前终端输入，不写进文件或命令历史以外的地方。

### 备份（每次重要导入后、每周一次、每次正式迁移前）

在仓库外新建一个目录（例如 `D:\club-backups\2026-11-03\`）再执行，`$DB` 为正式库 Session pooler 连接串：

```powershell
supabase db dump --db-url $DB -f roles.sql --role-only
supabase db dump --db-url $DB -f schema.sql
supabase db dump --db-url $DB -f data.sql --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
supabase db dump --db-url $DB -f history_schema.sql --schema supabase_migrations
supabase db dump --db-url $DB -f history_data.sql --use-copy --data-only --schema supabase_migrations
```

- `data.sql` 包含 `auth.users`、`auth.mfa_factors`、`auth.sessions` 等认证数据（密码哈希、TOTP 密钥、刷新令牌）和全部成员资料，属于最敏感文件：先生成 LF 换行的 `manifest.sha256`（PowerShell 的 `Set-Content` 会写成 CRLF，`sha256sum -c` 读不出文件名，实测失败），再用 `tar` 打包、`gpg --symmetric --cipher-algo AES256` 加密（口令存密码管理器），放在仓库和 OneDrive 同步目录以外，另存一份离线副本；明文文件用完即删。`backups/` 已在 `.gitignore`，但不要依赖它。
- 每个文件不能为空：`schema.sql` 应含 `club_private`，`data.sql` 应含 `COPY "auth"."users"` 和 `COPY "public"."club_memberships"`，`history_data.sql` 的行数等于生产已应用的迁移数（Club V1 正式迁移前为 15；7 个 V1 迁移执行并 repair 后为 22，此后与 `supabase/migrations` 文件数一致）。
- 一致性：5 条命令是 5 次独立的 `pg_dump`，各自一个快照；`data.sql` 内部是同一快照，所有表彼此一致。文件之间只有在备份期间发生 DDL 或迁移时才会不一致，所以备份期间不做迁移、导入和职位修改。登录仍会改动 `auth.sessions` 等，这只影响 `data.sql` 内的那一个快照，不影响一致性。
- Auth：`data.sql` 包含 `auth` 下的全部数据（用户、身份、MFA、会话、刷新令牌）；`schema.sql` 不含 `auth` 的表结构（由 GoTrue 管理），`roles.sql` 不含角色密码。所以恢复目标必须先有与生产同版本的 GoTrue 表结构（版本见 `supabase/.temp/gotrue-version`）。

### 恢复（只恢复到新的空 Supabase 项目；恢复覆盖正式库前需 owner 决定，会丢失备份后的数据）

```powershell
node scripts/club-v1-structure-check.mjs > check.sql   # 只在 V1 迁移已上线后加入
psql --single-transaction -v ON_ERROR_STOP=1 `
  -f roles.sql -f scripts/club-restore-pre.sql -f schema.sql `
  -c "SET session_replication_role = replica" -f data.sql -c "SET session_replication_role = origin" `
  -f check.sql --dbname $NEW_DB
```

- **必须加 `scripts/club-restore-pre.sql`**：新项目对 `public` 的默认授权是 anon/authenticated 拥有一切，而 dump 只写 `GRANT`，不写迁移里对 anon 的 `REVOKE`。只按官方命令恢复时，实测所有表和函数都对 anon、authenticated 开放（RLS 仍开启，但 `security definer` 函数的权限检查全靠执行权限和函数内检查），结构检查会报错并整体回滚。
- 迁移记录：`history_schema.sql` 中若有 `OWNER TO "supabase_admin"`，按官方说明注释掉（2026-11-03 的正式备份里 owner 已是 `postgres`，无需修改），再执行 `psql --single-transaction -v ON_ERROR_STOP=1 -f history_schema.sql -f history_data.sql --dbname $NEW_DB`。
- 任何一步出错：整体回滚，新项目保持空库。查明原因后修改命令重跑，不要手工补半个库。官方列出的已知错误（`supabase_admin` 所有者、`cli_login_postgres`）按官方说明处理。

### 正式备份的本机恢复演练（方案 A，owner 2026-11-03 选定；不新建 Supabase 项目）

只由本人执行。用本机已有的 Docker 和 Git 自带的 GnuPG（`C:\Program Files\Git\usr\bin\gpg.exe`），不安装 Windows psql 或 7-Zip。

- **隔离**：`docker network create --internal club-rehearsal-net`，容器只加入这个网络，不加 `-p`。2026-11-03 实测：容器访问外网报 `Network unreachable`，宿主机也连不上它。所以演练库连不到正式库，正式库也连不到演练库。
- **不落盘**：数据目录和 `/restore` 都用 `--tmpfs`，备份明文只在内存里。解密直接通过管道写进容器（`gpg -d … | docker exec -i <容器> tar -x -C /restore`），宿主机上没有明文文件。
- **目标结构**：镜像 `public.ecr.aws/supabase/postgres:17.11.0.003`（与生产相同），先用 `public.ecr.aws/supabase/gotrue:v2.197.0 auth migrate` 建出生产版本的 auth 表（实测 75 条迁移，`auth.users` 35 列，`postgres` 对 auth 下的数据表都有 INSERT 权限）。GoTrue 需要 `supabase_auth_admin` 的密码，只给演练库设一个一次性密码。
- **恢复**：`/restore` 里依次执行 `roles.sql` → `scripts/club-restore-pre.sql` → `schema.sql` → replica 模式下的 `data.sql`（单事务，`ON_ERROR_STOP=1`），然后按上文恢复迁移记录（15 条）。V1 上线前的备份不加 `check.sql`。
- **真实正式备份演练中发现的三处修正（2026-11-03，演练成功）**：
  1. `roles.sql` 里有 `GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin"`。本地镜像没有这个角色，而且只有 `supabase_admin` 能授予参数权限。先 `create role supabase_realtime_admin nologin noinherit`，再用 `-U supabase_admin` 单独执行 `roles.sql`；其余文件仍用 `postgres` 执行。
  2. `data.sql` 里有 5 个 `storage.*` 的 `COPY` 块（buckets、buckets_analytics、objects、s3_multipart_uploads、s3_multipart_uploads_parts），本地没有 storage 表结构。Club 不使用 Storage，这 5 个块都是 0 行。先确认都是 0 行，再在容器里生成去掉这些块的 `data.restore.sql`（只删块头和 `\.`），原文件不改。如果以后某个块不是 0 行，不能删，要先用 storage-api 镜像建表。
  3. 迁移记录表的 owner 已经是 `postgres`，不需要注释 `OWNER TO` 行。
- **演练结果**：44 张表 1088 行逐表一致；15 条迁移记录；48 个外键没有孤儿行（replica 模式会跳过外键检查，所以要单独查）；超管验证器指向已验证的 TOTP；public 下所有表都开了 RLS，anon 没有表权限，实际读取成员表和超管验证器表都被拒绝。
- **验证**（只输出表名和行数）：在容器里用 awk 统计 `data.sql` 每个 `COPY` 块的行数，生成 `select count(*)` 查询，到恢复库里逐表比对，必须完全一致（2026-11-03 用合成数据实测：31 张表 206 行一致）。比对只用备份文件本身，不连正式库。另外抽查 `auth.users`、`auth.mfa_factors`、`platform_super_admin_factors` 的行数大于 0，迁移记录为 15 条。
- **清理**：`docker rm -f -v <容器>`，`docker network rm club-rehearsal-net`，再确认 `docker ps -a`、`docker network ls` 里没有残留。tmpfs 随容器删除。不碰 fyp-supabase 的容器。
- 演练失败时，单事务会整体回滚（实测回滚后 public 0 张表、auth.users 0 行）。删除容器后查明原因，不要在半个库上手工修补。

### 恢复后人工确认（数据库备份不包含）

- Auth 设置：网站 URL、重定向白名单、邮件模板（`docs/email-templates/`）、SMTP、MFA/TOTP 开关、注册开关。
- API：新项目的 URL 与 publishable key 写入 Worker 配置并重新部署（`wrangler.jsonc` 中的 `SUPABASE_URL` 等）；旧 key 不再使用。
- Storage 文件、Edge Functions、Database Webhooks、Realtime：Club 目前都不使用，确认仍然如此。
- Vault/pgsodium 根密钥：Club 不使用加密列；若以后使用，须按官方说明在旧项目暂停前另外导出。
- 平台日志中会有恢复前的完整记录；恢复本身不写日志（触发器在 replica 模式下关闭）。
- 超管验证器：`auth.mfa_factors` 随数据恢复，`platform_super_admin_factors` 的 id 一致；用真实 TOTP 登录一次确认。

### 本地实测结果（2026-11-03，合成数据，容器用完已删除，未动 fyp-supabase）

- 源库：Supabase 官方镜像 `postgres:17.11.0.004`，执行全部 22 个迁移，补上 GoTrue 平时创建的 `auth.jwt()`、`mfa_factors`、`sessions`（最小结构），合成数据含 2 个俱乐部、4 个 auth 账户（含未验证）、TOTP、超管、平台管理员、联盟与会长、俱乐部默认/个人/上限设置、导入与 50 名玩家，以及触发器自动写的 36 条平台日志。
- 用上面的 5 条官方 `supabase db dump` 命令备份，恢复到另一个全新容器。
- 对比源库与恢复库（`.test-runtime/stage4/fingerprint.sql`，438 行）：33 张表的行数、auth 账户与 TOTP 数据摘要、职位/日志/玩家数据摘要、全部约束与外键、RLS 状态、14 条策略（含 USING 原文）、81 个函数（definer、search_path、函数体、执行权限、所有者）、25 张表的权限、39 个触发器、54 个索引、schema 权限、API 角色设置、扩展、22 条迁移记录 —— 全部一致。唯一差异是 3 个 CHECK 约束的括号写法（PostgreSQL 重新解析后的打印差异，含义相同）。
- 恢复库上 V1 结构检查通过；RLS 行为抽查与源库一致（anon 被拒、管理员看不到别的俱乐部、公会长能看到自己的俱乐部）。
- 失败处理：① 只用官方命令（不加 `club-restore-pre.sql`）并把结构检查放在同一事务中 → 检查报告 API 角色有表权限，整体回滚，新库没有任何 Club 表；② 截断的 `data.sql` → 出错后整体回滚，Club 表和 auth 账户都是 0。
- 无法用本地 PostgreSQL 证明：真实 GoTrue 的 auth 表结构与版本（本地是官方镜像的旧结构加最小补丁）、托管环境的角色权限、Auth/API 配置、pooler 连接、托管项目的恢复耗时。第一次在正式环境操作时，建议先恢复到一个新的免费临时项目，用 Worker 本地预览登录一次，再删除该项目。（2026-11-03 owner 决定 Club V1 不用这种方式，改用上文的本机方案 A；真实 GoTrue 表结构已由 GoTrue 镜像覆盖，托管环境的配置和 pooler 仍未验证。）

## 错误日志

Worker 的意外异常仍返回 502，同时用 `console.error` 输出一行 JSON（`event`、`path`、错误类型和消息），不含 Cookie、Token 或请求内容。可用 `wrangler tail squirrelapi-club` 实时查看；持久保存需另行开启 Workers Logs（`observability`，待确认）。

下文带日期的章节是历史验证记录，若与本节冲突，以本节为准。

## P3.1 本地回归范围 — 2026-10-31

`supabase/tests/platform_player_counts.sql` 使用一次性数据库覆盖纯在会、明确退会、暂离、待确认、完整名单判定的其他不在会、重新出现、不完整名单、同日新版本、删除最新日期／全部观察、无快照、真实零值与多俱乐部隔离；历史身份总数不变。现有 `platform_admin.sql` 保留全部 MFA／权限检查并更新新响应契约。`tests/integration/authz.spec.mjs` 使用真实 TOTP、确认设备、Worker 和 REST，对每个俱乐部的总览结果与现有名单 RPC 逐类核对，并保留所有拒绝路径。

`tests/browser/admin.spec.mjs` 覆盖 1440／390／320 宽度、人数详情键盘展开／收起、未知与零的区别、旧响应不误报历史总数和管理账户分离；`club-visual-review.spec.mjs` 增加 Admin 页面截图。仅使用合成数据，不连接生产。实际执行结果以本次交付报告为准。

## P4 本地验证范围 — 2026-11-01

新增 platform_role_assignments SQL fixtures 验证任命、撤销、恢复、单用户多角色、默认上限、最后公会长保护、原子转让、幂等、旧版本拒绝、未验证目标与失败后角色／版本／审计完整回滚。Worker 测试验证独立平台权限、活跃 Super Admin 门、输入白名单、同源保护、409 传递；共享 clubApi 错误保留状态供界面要求重新确认。

role-assignment.spec.mjs 使用真实本地 Auth TOTP／确认设备／Worker／REST，验证并发争夺管理员名额及并发转让仅一个成功、撤销立即失效、其他角色及其他俱乐部不变、旧请求重放不会重新授予已撤销权限、审计和 MFA 移除后拒绝。等待 advisory lock、目标账户行锁及旧请求重放期间撤销验证器的回归，验证取得锁后再次授权，不写角色或成功日志。admin 浏览器用例覆盖 1440／390／320、撤销恢复、转让、未验证账户、重试／冲突以及键盘焦点。只用合成数据。

本地最终验证：127 项全仓 Node 测试、8 个 SQL 套件、79 项全量浏览器、22 项真实集成通过；test:compat 旧 Worker／新数据库 20 项通过（沿用既有一项旧 MFA 断言排除规则）。原有 80,000 行可选基准未启用。分页修复后重新执行 lint、类型检查、构建、127 项单元及79 项浏览器；数据库／安全逻辑不再变化。test:affected 在分页收尾前通过完整检查。新迁移只能在所有检查通过、本人验收和单独授权后人工应用。

## 日常命令

Windows 每个新终端先运行 `. ./scripts/env.ps1`，将缓存和临时文件放在 Global_Env 或工作区。

| 场景 | 命令 |
|---|---|
| 只运行受当前已跟踪／新增改动影响的检查 | `pnpm test:affected` |
| 所有 Node.js 单元及接口测试 | `pnpm test:unit` |
| 保留原有 Club 检查、类型、测试、构建及 dry-run | `pnpm club:check` |
| 已构建 Club 后运行关键浏览器流程 | `pnpm test:e2e` |
| 只运行登录或导入浏览器流程 | `pnpm test:e2e auth.spec.mjs` / `pnpm test:e2e import.spec.mjs` |
| 隔离数据库迁移、RLS 和事务测试（含 `supabase/tests/upgrade/` 升级检查：在对应迁移之前写入旧数据，迁移后断言） | `pnpm test:db` |
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

另一个终端有 PostgreSQL 客户端后执行 `pnpm test:db`（SQL 套件之后运行 `scripts/test-db-race.mjs`：两个真实会话的确定性锁竞争，在独立的临时数据库 `squirrelapi_race` 中提交数据，结束时删除；`PSQL_DOCKER=<容器名>` 只对这一步有效，可改用容器内的 psql）；`PSQL_BIN` 可指定客户端程序路径，两步都生效。本机没有 psql 时，可在 WSL 中把 `PSQL_BIN` 指向一个转调 `docker.exe exec -i <容器> psql "$@"` 的脚本，从而原样运行 `test-db.mjs` 与 `test-db-race.mjs`（2026-11-03 阶段 6 用此方式实测）。此固定密码仅用于可丢弃的本机／CI 测试容器。

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

发布记录（2026-11-02，Club 阶段 2）：本人用 `supabase db push --linked` 在正式 myWeb Supabase 应用 `20261101163647_club_my_context.sql`（dry-run 仅此一项）。验证全部通过：迁移记录共 15 项且无遗漏；函数 checksum `ok`；security definer、`search_path=""`，仅 authenticated 可执行；PostgREST 匿名调用返回 401 `42501`（非 `PGRST202`，schema cache 已识别）；以本人身份只读事务调用返回预期账户上下文（aal1 时平台权限为空）。之后才把 `CLUB_SCHEMA_VERSION` 更新为 `20261101163647`。发布前本地：SQL 9 组、Club 单元 110、真实集成 28（后续针对性 5）、旧 Worker 兼容 24 均通过。
