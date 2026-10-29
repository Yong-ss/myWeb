# Club（apps/club）专用规则

全仓通用规则见根目录 `AGENTS.md`；本文件只写 Club 特有内容。

## 模块边界（`src/architecture.test.mjs` 自动检查）

- `src/features/<功能>/`：每个功能自带页面、组件、纯逻辑和测试（import、members、history、analytics、activity、settings、auth）。功能之间禁止互相 import；需共用的先移到共享层。
- `src/domain/`：跨功能业务契约（成员字段、日期／UUID 校验、在会状态），只依赖自身。
- `src/lib/`（`clubApi`、缓存、刷新、导航、品牌）与 `src/components/`（UI、布局、反馈）：共享基础设施，禁止 import 功能。
- `src/app/<路由>/page.tsx` 只重新导出功能页面；`src/app/error.tsx` 让单页出错时外壳照常可用。
- `worker/`：每个 API 一个处理文件，在 `index.ts` 的 `routes` 表登记；通用 HTTP 工具在 `worker/http.ts`。Worker 只能用 `domain/` 和功能目录中不含 React 的 `.ts`。
- 新功能：新建 `src/features/<名字>/`（页面 `<main className="club-workspace club-<名字>">`），加一行路由页、`src/lib/navigation.ts` 一项，需要时加 `worker/<名字>.ts` 和 `routes` 一项。不应修改其他功能。

## 共享约定

- 请求一律用 `clubApi`：401 在私有页跳转登录，403 留在原页显示服务端提示，公开页从不跳转。不要在页面里直接调用 `clubFetch` 或重写 401/403 处理。
- 读取复用 `clubApi` 的私人缓存与 `useDataRefresh`：每次复用都经实时权限校验，写入后失效；禁止公共缓存、持久化缓存，也不得为性能缓存 membership 或绕过 RLS。新查询先看 `docs/PERFORMANCE.md`：并行、有界、稳定游标，不逐行请求。
- 导航和私有页面只在 `src/lib/navigation.ts` 登记；它只决定显示，不是权限控制。
- 登录后页面统一使用 AppShell 页头和 AccountControls；页面不得另写账户或退出逻辑，公开页不显示私人账户控件。
- 俱乐部名称以数据库为准，使用 `useClubBrand`／`/api/club-settings`，不得用 localStorage 冒充保存；只有已确认邮箱的有效 Owner 可改名。

## 业务数据安全

- 新写操作必须走专用 RPC，在同一事务中写 `club_audit_events`；日志不可改删，不记录 Token、密码或原始 JSON。删除日期走专用 RPC，保留版本链和身份，禁止客户端硬删。
- 缺席判断按最终合并后的玩家 UUID，而不是昵称。新的写入协议在准备阶段就检查数据库是否支持，不能让用户核对到提交才发现数据库还没迁移。

## UI/UX（已确认，不重新探索风格）

- 唯一视觉方向：**Dark Victorian Occult Dashboard**。深色侧栏、铜金细边框、方角面板、衬线标题；20% 神秘学氛围、80% 实用。禁止浅绿白卡片、霓虹、大圆角胶囊、炫光和装饰性动画。改变风格需用户明确指示。
- 颜色、字体、间距、时长用 `src/styles/tokens.css` 的 `--club-*` 变量，不硬编码，不各页重建主题。
- 复用现有组件，不另造同义组件：`components/ui` 的 `Button`（导航用 `ButtonLink`）、`Input`/`Select`/`Textarea`、`Panel`；`components/layout` 的 `PageHeader`、`AppShell`；`components/feedback` 的 LoadingSpinner、PageLoader、TableSkeleton、ProfileSkeleton、LoadingState。反馈组件不含认证、缓存或业务逻辑；Lottie 只用本地 JSON，减少动态效果时不加载。
- 共享样式表对所有页面生效：只有一个功能使用的选择器必须限定在该功能根类下，例如 `.club-app :where(.club-import) .stepper`（`:where` 不增加优先级）。
- 保留键盘操作、可见焦点、44px 触摸目标、手机输入至少 16px 和 `prefers-reduced-motion`；手机端不能简单隐藏导航。中文操作名要清晰，不用神秘学术语代替实际动作。
- 动效用 CSS transition 做简单反馈。Motion for React 和 Radix Primitives 已获批准，但只在有真实交互价值时引入；当前尚未安装。
- UI 改造不得改变登录、会话、权限、数据库、导入或身份匹配规则，也不修改 `apps/web`。
- 做 UI 或动效工作时阅读 `docs/club-design-system.md`：当前规则在开头的「当前生效」部分和第 14 节，其余带日期的章节是历史记录。参考稿 `docs/design-reference/club-approved-reference.html.txt` 只决定视觉方向，其中的虚构数据和导航不进入业务。
- 视觉改动用 `tests/browser/club-visual-review.spec.mjs` 生成桌面／手机截图并实际查看；动效要看过渡过程，不能只看最终截图。只用合成数据。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
