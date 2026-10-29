# Club UI/UX：强制遵循已确认设计

以下规则适用于 `apps/club` 中所有现有和未来页面、组件及样式，包括首页、登录、账户、导入、身份确认、成员、历史、分析、操作日志和设置。

- 唯一视觉方向：**Dark Victorian Occult Dashboard（暗黑维多利亚神秘学管理界面）**。用户已确认，不重新探索视觉风格。
- 开始 UI 工作前，必须阅读 [设计规范](../../docs/club-design-system.md)（特别是当前有效的第 14 节 Motion + Radix 规范）和 [用户确认的原始参考稿](../../docs/design-reference/club-approved-reference.html.txt)，并对照现有共享组件。参考稿是 HTML 文本，不得声称看过不存在的原始截图。
- 以深色侧栏、铜金细边框、方角面板、衬线标题为基准。保持 **20% 神秘学氛围、80% 实用**；禁止浅绿白卡片、霓虹、大圆角胶囊、炫光、无意义的花哨动画或另起一套视觉方向。
- 颜色、字体、间距、边框和视觉状态复用 `src/styles/tokens.css` 的 `--club-*` 变量。现有页面共用 `components/layout/AppShell.tsx` 及共享设计样式；新页面不得各自重建主题。
- 优先复用真实存在的共享组件，只对重复出现的交互提取薄封装；避免大型主题框架、预建空组件和无关重构。采用系统字体及自绘几何装饰，不使用未授权的官方图片、Logo、字体。
- 参考稿只决定视觉方向，不是业务需求。其中虚构数据、演示脚本和未实现导航不可进入正式业务流程。中文操作名必须清晰，不用神秘学术语代替实际动作。
- 桌面与手机保持一致的设计语言；保留键盘、可见焦点、44px 触摸目标、状态文字和 `prefers-reduced-motion`。移动端不能简单隐藏导航。
- UI 改造不得改变登录、会话、权限、数据库、导入、身份匹配及历史规则；不修改 `apps/web`。保留既有未提交工作，不因动效重写业务功能。
- 每批运行相关检查，用本地合成数据完成 Playwright 桌面／手机功能和视觉审查；静态截图、自动测试通过都不代表动态交互已达到验收标准。不得对生产数据库写入测试数据；正式部署需另获授权。
- 当前有效规则以设计规范第 14 节为准；第 7、9、10、11 节中的阶段性限制或历史描述不应覆盖新决定。改变已确认的视觉风格必须先得到用户明确指示。

## 共享组件：新页面与迁移必须优先复用

- 全站视觉批次沿用 `tests/browser/club-visual-review.spec.mjs`，实际审阅桌面／手机截图；涉及动效时还要录制交互过程或检查过渡中间帧，不能仅以最终状态截图通过作为合格证明。
- 页面宽度变体使用 `.club-workspace.club-login` 等明确组合选择器，防止共享工作区样式互相覆盖；手机输入至少 16px，保留原生键盘和选择行为。
- `components/ui/Button.tsx`：操作用 `Button`，导航用 `ButtonLink`；variant 为 primary／secondary／danger。Loading 用 loading／loadingText，保留原生 disabled、type、焦点和可访问性语义；不得用按钮模拟链接。
- `components/ui/Fields.tsx`：Input、Select、Textarea 保留标签、键盘行为与 `aria-invalid`。简单原生下拉可以保留 `base-select`／`::picker(select)` 渐进增强；只有确实需要复杂弹层行为、统一可控开合与动画时才考虑 Radix Select 或 Popover，不把所有原生控件无差别替换。
- `components/ui/Panel.tsx`、`components/layout/PageHeader.tsx`：统一容器及页标题；不另造同义 Card。
- `components/layout/AppShell.tsx`：共用桌面侧栏和手机导航；活动项来自当前路径，不在页面另写导航。手机 Drawer 如迁移到 Radix，须完整保留原交互和焦点功能。
- `components/feedback`：继续统一使用既有 LoadingSpinner、PageLoader、TableSkeleton、ProfileSkeleton、LoadingState，禁止再造第二套 Loading。
- 颜色及基础样式统一由 `styles/tokens.css`、`styles/components.css` 与相关共享样式管理；Motion 动画可在共享 React 组件中声明配置与状态，不受“只能写在 CSS 中”的旧限制。避免散落的硬编码时长、颜色和各页复制动画逻辑。
- **已明确批准在 `apps/club` 按实际需要使用 Motion for React 和 Radix UI Primitives。** 两者必须解决真实交互问题，不要只安装依赖或引入另一套 UI 主题。优先使用真实场景的共享薄封装，而非全站强行改写为 Radix／Motion。

## 动效与交互：后续组件必须遵守

- **当前权威规范：`docs/club-design-system.md` 第 14 节。** 目标是“操作立即响应，视觉自然连续”，不仅仅是 Hover 变色或静态排版调整。
- **CSS Transition** 用于 Hover／Pressed／Focus、颜色、边框等简单反馈；**Motion for React** 用于真正需要的进入／退出、条件挂载卸载、Accordion 展开／收起、布局与内容切换；**Radix Primitives** 用于需要可靠焦点、Escape、Portal、键盘和弹层状态管理的 Dialog、Popover、Dropdown、Accordion 等。
- 对已经存在的复杂业务交互，**允许并鼓励把 Radix 与 Motion 正确组合**：例如导入身份确认、删除确认、需要复杂行为的帮助浮层和移动菜单。不得只安装两套库而没有实际集成；也不要求每个按钮都用两套库。
- 动画覆盖完整生命周期：打开、已打开、关闭、已关闭；动态内容应有合适的进入／退出；展开容器及内容自然衔接，不能仅让文字淡入、外框高度却瞬间跳变。
- 允许必要的高度／布局动画（优先限定影响区域并测量性能），不再全面禁止；大型表格排序、输入和搜索仍即时更新，避免逐行布局动画或整个表格反复淡入。
- 简单反馈建议 100–180ms，内容进入／退出 160–260ms，必要的布局变化 180–300ms；使用共享 Tokens 或集中配置，时间取决于具体交互，不为动画故意延迟数据展示。避免夸张回弹、缩放、发光和装饰动画。
- Dialog 关闭指令、Escape 和键盘操作必须**立即得到响应**；视觉退出允许短暂播放。正确使用 Radix `open/onOpenChange`、Portal、`forceMount` 与 Motion `AnimatePresence` 等机制，避免提前卸载丢失退出动画。不得以任意固定 `setTimeout` 取代正确生命周期。
- Dialog／Drawer／Popover 必须检查初始焦点、Tab／Shift+Tab、Escape、关闭后焦点归还、背景遮罩、滚动锁、连续快速开关、重复点击以及路由切换；不手工叠加两个焦点陷阱。
- Radix Portal 的 Overlay／Content 需使用明确的 Club 主题作用域、层级和 Tokens，不能假设 `.club-app` 选择器自动覆盖挂在 `body` 的节点，也不能引入 Radix Themes 预设视觉。
- Hover 仅用于精确指针；Focus-visible、Active、Disabled、Loading 独立可用。减少动画偏好下保留完整可读状态与操作，禁用不必要的空间移动。
- 关键动效必须做 **Dynamic Motion Review**：录制打开、关闭、展开、收起、切换全过程，或截取开始／中间／结束帧；用 Playwright 验证功能，并实际观察动画是否生硬、跳动或丢帧。使用合成数据，不访问正式业务 API。
- Skills 仅辅助设计和实现，不能覆盖用户确认的风格、权限与业务规则。缺失 Skill 不擅自安装其他框架；Motion 和 Radix 是用户已批准的项目依赖。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 模块边界（由 `src/architecture.test.mjs` 自动检查）

- `src/features/<功能>/`：每个业务功能自带页面、组件、纯逻辑和测试。现有功能：import、members、history、analytics、activity、settings、auth。功能之间禁止互相 import；需要共用的东西先移到下面的共享层。
- `src/domain/`：跨功能的业务契约（成员字段、日期／UUID 校验、在会状态）。只能 import `domain/` 自己。
- `src/lib/`（数据访问、`clubApi`、刷新、品牌）与 `src/components/`（UI、布局、反馈）：共享基础设施，禁止 import 任何功能。
- `src/app/<路由>/page.tsx` 只重新导出功能页面，不写逻辑；`src/app/error.tsx` 让单页出错时侧栏和其他页面照常可用。
- `worker/`：每个 API 一个处理文件，统一在 `index.ts` 的 `routes` 表登记；`worker/http.ts` 只放通用 HTTP 工具。Worker 只能用 `domain/` 和功能目录里不含 React 的 `.ts`，禁止引用页面或组件。
- 新功能：新建 `src/features/<名字>/`，加一行路由页、一行导航（如需要），以及需要时的 `worker/<名字>.ts` 和 `routes` 一项；不应修改其他功能。

## 品牌与设置

- 俱乐部名称以数据库为准，禁止用 localStorage 预览代替保存；复用 `useClubBrand` 与 `/api/club-settings`。
- 名称写入仅限已确认邮箱的有效 Owner，服务端与数据库双重验证，保留审计及旧值冲突保护；Admin 不可改名。

## 数据读取性能

- 新页面复用 `lib/data-access.ts` 与 `useDataRefresh`；私人缓存必须经过实时账户／权限校验，写入后失效，禁止公共缓存及独立持久化。
- 新查询先读 `docs/PERFORMANCE.md`；并行独立查询，列表有界与稳定游标，避免逐行远程请求；Server-Timing 只含安全汇总。
- 不以性能为由缓存 membership 或移除 RLS；大规模基准按需执行，不以波动毫秒数卡日常 CI。

## Loading System

- 请求状态复用 `components/feedback`；按钮统一 loading／loadingText，禁止各页另造 Spinner、Skeleton、Error／Empty 卡片。
- 表格／档案首读用对应静态骨架；缓存可安全呈现时保留内容。PageLoader 仅较长操作按需出现，不能增加数据展示延迟；见设计规范第 13 节。
- Lottie 限本地 JSON 与按需 light SVG 播放器；减少动态效果时不加载动画资源，失败可回退。不得让反馈组件拥有认证、缓存或业务逻辑。
- 登录后页面一律复用 AppShell 的固定页头与 AccountControls；设置在右上角，禁止页面单独再实现账户或退出逻辑，公开页不显示私人账户控件。

## 业务数据与审计安全

- 新业务写操作须在同一数据库事务中写 `club_audit_events`；操作日志不可改删，不记录 Token、密码或原始 JSON。日期删除必须走专用 RPC，保留版本链与身份，不能改成客户端硬删。
- 缺席确认按最终合并后的 UUID 名单计算，不按昵称；逐人退会与完整名单证据统一用于名单、历史及分页基线。新写协议必须在准备阶段检查 schema 能力，不能让用户核对到提交才发现数据库未迁移。