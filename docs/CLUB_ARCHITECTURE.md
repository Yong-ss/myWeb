# Club 平台架构（2026-11-01）

本文描述 Club 的目标架构与演进路线。决策记录见 `DECISIONS.md`，需求见 `CLUB_REQUIREMENTS.md`。

## 1. 现状问题的根因（已核实）

| 现象 | 性质 | 根因 |
|---|---|---|
| 登录后总是进入 `/account` | UX 缺陷 | `LoginPage` 写死跳转，没有按身份决定入口。 |
| Super Admin 未完成 TOTP 时只显示「公会长」 | 显示逻辑缺陷，**不是权限问题** | `roleLabel` 只返回一个标签：未验证时先找俱乐部角色。数据库行为正确：aal1 时 `platform_permissions` 为空，只保留普通成员权限（D-034）。 |
| 平台入口混在俱乐部页面里 | 信息架构缺陷 | 只有一个 Shell、一个导航列表；`/admin` 只是俱乐部页里的一个按钮。 |
| 只能管理一个俱乐部 | 架构限制 | Worker 以环境变量 `CLUB_ID` 作为唯一俱乐部上下文；`/api/account` 也只针对这一个俱乐部回答「你是谁」。 |

数据库层已为多俱乐部做好准备：`club_my_access(p_club)`、`can()`、`readable_clubs()`、各业务 RPC 和 RLS 都显式接收或校验 `club_id`。**限制主要在 Worker 和前端的上下文传递，而不在权限模型。**

## 2. 三个独立概念

1. **平台身份**：`platform_super_admins` 中的成员；只有可信验证器 + aal2 会话时，平台权限才生效（`super_admin_active`）。
2. **俱乐部角色**：`club_memberships`，可多角色叠加，按俱乐部计算权限。
3. **当前俱乐部**：本次请求操作的是哪个俱乐部。它只是一个**被每次请求验证**的参数，绝不是权限来源。

`/api/account` 现在把三者都返回（`super_admin`、`mfa_verified`／`mfa_session`、`roles`／`permissions`、`club_id`），界面显示两者（例如「超级管理员（待两步验证） · 公会长」），不再互相覆盖。

## 3. 目标架构

```
               登录 ──► landingPath(account)
                         │
        ┌────────────────┴────────────────┐
  平台工作空间 (/admin…)            俱乐部工作空间 (/account…)
  · 总览 / 俱乐部列表「进入管理」     · 总览 / 分析 / 成员 / 导入 / 日志
  · 用户与角色 / 角色权限 / 平台日志   · 俱乐部设置
  · 未验证 TOTP → 引导页              · 头部「平台管理中心」切换（仅 Super Admin）
        └──── 同一 AppShell，按 workspace 切换品牌、侧栏、切换按钮 ────┘
                         │
          Worker：routes 表（权限声明）→ club_my_access(club) → RPC/RLS
```

- **一个 Shell，两个工作空间**：`navigation.ts` 为每个路由登记 `workspace`；`AppShell` 据此切换品牌、侧栏和切换按钮。不复制布局，不在页面里写角色判断。
- **入口规则集中在 `landingPath()`**：Super Admin → 平台；其他人 → 俱乐部。Super Admin 即使未验证也进平台，由平台页解释需要完成的步骤。
- **工作空间切换不登录、不提权**：只是导航；每个 API 照常由 Worker（`routes` 表）和数据库检查。

## 4. 多俱乐部演进方向（P5 起，需批准）

1. **身份接口与俱乐部无关**：新增只读 RPC `club_my_clubs()`（列出有权进入的俱乐部及角色），`/api/account` 不再依赖 `CLUB_ID`。这样「只在其他俱乐部有角色」的用户不会在登录时被拒（当前会被拒，见 §6）。
2. **当前俱乐部进入 URL**：`/c/<club_id>/members` 等。Worker 从路径读取 `club_id`，替换 `env.CLUB_ID`，传给已有的 `club_my_access(p_club)` 和 handler 的 `club` 参数。handler 签名已经是 `(request, club, …)`，无需改业务处理文件。
3. **俱乐部选择器**：多于一个俱乐部时，登录后进入选择页；只有一个时直接进入。平台「进入管理」改为链接到 `/c/<id>/account`。
4. `CLUB_ID` 退化为「默认俱乐部」，最后删除。缓存作用域键已包含 club id，无需修改。

不建议的方案：用 Cookie 或 localStorage 保存「当前俱乐部」——会让多个标签页互相覆盖，也难以分享链接；也不建议为每个俱乐部部署一个 Worker。

## 5. 分阶段计划

| 阶段 | 内容 | 数据库 | 状态 |
|---|---|---|---|
| 1 | 身份感知入口、平台/俱乐部工作空间、TOTP 引导、身份标签、诚实的「进入管理」 | 无 | **本地完成** |
| 2 | 账户安全（TOTP）移入平台工作空间；`club_my_clubs()`；`/api/account` 去 `CLUB_ID` | 新增只读 RPC | 待批准 |
| 3 | URL 携带俱乐部、Worker 按请求校验、俱乐部选择器 | 无（复用 `club_my_access`） | 待批准 |
| 4 | 平台创建俱乐部、自动邀请（需服务端特权方案） | 新 RPC / 边缘函数 | 待设计 |
| 5+ | 联盟、自定义角色（P6–P8，按 D-033） | — | 未开始 |

## 6. 风险与已知限制

- **只在其他俱乐部有角色的用户无法登录**：`/api/login` 用 `CLUB_ID` 判断访问权限。当前只有一个俱乐部，所以没有实际影响；阶段 2 解决。
- **账户安全已移到平台工作空间**（`/admin/security`，`features/security`）：没有任何俱乐部成员身份的 Super Admin 也能绑定和验证 TOTP；俱乐部 `/settings` 只保留俱乐部设置。页头的设置入口按工作空间切换。
- **会话与 MFA**：可信 TOTP 属于 Supabase Auth 会话（`auth.sessions.aal`），不属于某个 access token。刷新 access token 时，Auth 会把 aal2 带进新 token。因此在 refresh Cookie 有效期（7 天，每次刷新顺延）内重开浏览器、刷新页面都不需要重新验证；退出登录或重新输入密码登录会建立新的 aal1 会话，必须重新验证。`/login` 在已登录时直接转到对应工作空间，避免误把 aal2 会话换成 aal1。
- **已修复（阶段 1 验收中发现）**：没有俱乐部权限的账户打开俱乐部页面时，页面会同时请求成员和俱乐部名称，两个都被拒绝（403）。先返回的拒绝会清空缓存，另一个请求因此被误报为「数据已更新，请重试」。现在 401/403 一律原样显示。这只是显示问题，权限从未放宽。
- **兼容性**：阶段 1 没有改动 API 契约、Worker 路由、数据库和主站；旧版前端与新版 Worker 完全兼容。
- **安全**：所有切换按钮只用于显示；`platform: true` 路由和 `can_platform()` 继续把关，aal1 会话访问平台接口会收到 403（已有测试）。

## 7. 验证

- 单元测试：`navigation.test.mjs` 覆盖入口规则与工作空间划分。
- 浏览器测试：`tests/browser/admin.spec.mjs` 覆盖未验证 Super Admin 同时显示两种身份、TOTP 引导、不请求平台数据，以及「进入管理」只对本部署俱乐部开放。
- 真实集成测试：`platform-only.spec.mjs` 覆盖没有任何俱乐部成员身份的 Super Admin：登录进入平台、aal1 时看到引导且平台接口一律 403、俱乐部页面不跳转且业务接口与 RLS 拒绝、只有可信 TOTP 后才获得平台权限。Super Admin（同时是 Owner）登录后进入平台；普通 Owner/Admin 进入俱乐部；平台接口 aal1 拒绝、跨俱乐部隔离（既有 `authz`、`role-assignment` 测试）。

## 8. 阶段 2：账户上下文与 CLUB_ID 解耦（本地完成，待批准迁移）

### 四个概念的落点

| 概念 | 来源 | 用在哪里 |
|---|---|---|
| 身份（Authentication） | Supabase Auth 会话 → `auth.uid()` | 所有请求 |
| 平台授权 | `club_my_context()` / `club_my_access()` 中的 `super_admin`、`super_admin_active`、`platform_permissions`（可信 TOTP + aal2，由 `super_admin_active()` 判断） | 平台路由、`/api/mfa` |
| 俱乐部授权 | `club_my_access(p_club)` → `can()` | 每个俱乐部业务请求，按目标俱乐部重新检查 |
| 俱乐部上下文 | 目前仍是 Worker 的 `CLUB_ID`；阶段 3 改为 URL | 业务路由的 `club` 参数 |

### 新接口：`public.club_my_context()`（迁移 `20261101163647_club_my_context.sql`）

- 只读、无参数、`security definer`、`search_path = ''`；`revoke` PUBLIC / anon，只 `grant` authenticated。
- 返回 `{super_admin, session_aal2, super_admin_active, platform_permissions, clubs:[{id,name,roles}]}`。
- `clubs` 只来自调用者本人的有效 membership，且该俱乐部 `club_my_permissions()` 非空；即使是已生效的 Super Admin 也不列出无 membership 的俱乐部。
- 邮箱未验证：`super_admin=false`、`clubs=[]`。
- 不新增表、策略、角色，不改任何已有函数或数据。

### Worker 契约

- **登录**：`club_my_access(CLUB_ID)` 有权限或是 Super Admin，或 `club_my_context().clubs` 非空，才允许登录；否则仍 403 并撤销会话。
- **`/api/account`**：保留全部旧字段，新增 `clubs`。在本俱乐部没有权限、但在其他俱乐部有角色的人，会得到 `permissions: []` 的账户信息。
- **其他路由**：授权逻辑不变，仍由 `club_my_access(CLUB_ID)` 和路由权限表决定。只在其他俱乐部有角色的人访问这里的路由会得到 403，但会话保留；完全没有授权的人，会话会被清除。
- 常规请求仍只调用一次 RPC；只有 `/api/account`（并行）和「本俱乐部无权限」的请求会多调用一次 `club_my_context()`。

### 前端

- `landingPath`：Super Admin → `/admin`；本俱乐部有权限 → `/account`；否则 → `/clubs`（新的「我的俱乐部」页，hub 工作空间）。
- `/clubs` 只列出账户的俱乐部：本部署的俱乐部可「进入俱乐部」，其他显示「暂未开放」。页头在有其他俱乐部时显示「我的俱乐部」。

### 测试证据

- SQL：`supabase/tests/club_context.sql` 覆盖匿名不可调用、definer + 空 search_path、无参数；仅 B、A+B 各自角色、撤销即时生效、无角色、邮箱未验证；Super Admin 的 aal1 / aal2 未确认 / 可信 / 伪造 session。用 4 处故意破坏验证过：忽略 user_id、去掉邮箱检查、用 aal 代替可信会话、把执行权限授予 anon，测试均会失败。
- Worker 单元测试：只在其他俱乐部有角色的人可以登录并读取账户，其他路由一律 403；没有任何角色仍然被拒绝。去掉登录时的上下文检查，测试会失败。
- 真实集成测试（`club-context.spec.mjs`、`platform-only.spec.mjs`）：
  - 只在 B 有角色：进入 `/clubs`，A 的 Worker 接口、RPC、RLS 都拒绝，刷新会话后仍有效；
  - A+B 同时有角色；撤销 B 后立即消失；
  - 没有角色的账户无法登录；
  - 匿名调用 RPC 被拒绝，传入多余参数也被拒绝；
  - 没有 membership 的 Super Admin，`clubs` 始终为空。
- 兼容性：`pnpm test:compat`，即已部署的 Worker 连接加了新迁移的数据库，24 个测试通过。

### 发布顺序

1. 在生产只执行原始文件 `20261101163647_club_my_context.sql`（只新增函数，不手工转写）。旧 Worker 不调用它，不受影响（compat 已验证）。
2. 核对：运行 `scripts/migration-checksums.mjs`，并只读查询 `supabase_migrations.schema_migrations`，确认版本 `20261101163647` 已登记。
3. **PostgREST 可用性检查（部署 Worker 前必做）**：数据库里有了这个函数，不代表 API 的 schema cache 已经识别。用 publishable key 做两次只读请求：
   - 不带用户 token：`POST {SUPABASE_URL}/rest/v1/rpc/club_my_context`，body `{}`，只带 `apikey` 头。预期返回 401/403（拒绝匿名）。**不应**返回 404 或 `PGRST202`，这两种表示 schema cache 还没识别这个函数。
   - 用一个自己的已登录 access token（例如本人登录后在浏览器开发者工具中读取的请求，或 Supabase 控制台 API 示例）调用同一地址，预期返回 200，且 JSON 含 `clubs` 字段。

   如果返回 404 或 `PGRST202`，先在 SQL Editor 执行 `notify pgrst, 'reload schema';` 并重试，**确认通过后**才进入下一步。
4. 把仓库变量 `CLUB_SCHEMA_VERSION` 设为 **`20261101163647`**。CI 只比较最新迁移文件名的前 14 位，不要填完整文件名。
5. commit、push 到 `main`，CI 通过完整门禁后部署新 Worker。新 Worker 每次 `/api/account` 都调用 `club_my_context()`，所以第 1–3 步必须在先，CI 的 schema 门禁会阻止反向顺序。

### 回滚

- 迁移已成功、新 Worker 有问题：**只回滚 Worker**，重新部署上一个版本（旧 Worker 不调用新函数，compat 已验证）。
- **保留** `club_my_context()`：它只读，不授予任何新权限，而且已经登记在迁移历史中。手动 DROP 会让数据库结构和迁移历史不一致，之后重新部署新 Worker 也会失败。如果以后确实要移除，应写一个新的迁移，经过同样的审查和测试流程。
- 不涉及数据，也没有需要恢复的数据。

### 遗留限制

- 俱乐部上下文仍是 `CLUB_ID`；其他俱乐部显示「暂未开放」，留待阶段 3（URL 携带 club_id）。
- `/api/account` 的 `mfa_verified` 字段名仍沿用旧含义（Super Admin 权限已生效）。
