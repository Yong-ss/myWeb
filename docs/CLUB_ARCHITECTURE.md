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
- **两步验证设置仍在 `/settings`（俱乐部工作空间）**：没有成员身份的 Super Admin 打开设置页时，俱乐部名称部分会显示无权限，但 TOTP 卡片可用。阶段 2 把账户安全移到平台工作空间。
- **已修复（阶段 1 验收中发现）**：没有俱乐部权限的账户打开俱乐部页面时，页面会同时请求成员和俱乐部名称，两个都被拒绝（403）。先返回的拒绝会清空缓存，另一个请求因此被误报为「数据已更新，请重试」。现在 401/403 一律原样显示。这只是显示问题，权限从未放宽。
- **兼容性**：阶段 1 没有改动 API 契约、Worker 路由、数据库和主站；旧版前端与新版 Worker 完全兼容。
- **安全**：所有切换按钮只用于显示；`platform: true` 路由和 `can_platform()` 继续把关，aal1 会话访问平台接口会收到 403（已有测试）。

## 7. 验证

- 单元测试：`navigation.test.mjs` 覆盖入口规则与工作空间划分。
- 浏览器测试：`tests/browser/admin.spec.mjs` 覆盖未验证 Super Admin 同时显示两种身份、TOTP 引导、不请求平台数据，以及「进入管理」只对本部署俱乐部开放。
- 真实集成测试：`platform-only.spec.mjs` 覆盖没有任何俱乐部成员身份的 Super Admin：登录进入平台、aal1 时看到引导且平台接口一律 403、俱乐部页面不跳转且业务接口与 RLS 拒绝、只有可信 TOTP 后才获得平台权限。Super Admin（同时是 Owner）登录后进入平台；普通 Owner/Admin 进入俱乐部；平台接口 aal1 拒绝、跨俱乐部隔离（既有 `authz`、`role-assignment` 测试）。
