# Club UI/UX：强制遵循已确认设计

以下规则适用于本目录下所有现有和未来页面、组件及样式，包括首页、登录、账户、导入、身份确认、成员、历史、分析和设置。

- 唯一视觉方向：**Dark Victorian Occult Dashboard（暗黑维多利亚神秘学管理界面）**。用户已确认，不重新探索视觉风格。
- 开始 UI 工作前，必须阅读 [设计规范](../../docs/club-design-system.md) 和 [用户确认的原始参考稿](../../docs/design-reference/club-approved-reference.html.txt)，并对照现有共享组件。当前参考是 HTML 文本，没有单独的参考截图；收到截图后补存并按图核对，不能声称看过不存在的截图。
- 以用户指定配色、参考稿的深色侧栏／铜金细边框／方角面板／衬线标题为基准，不只做一个“大概相似”的暗色主题。保持 20% 氛围、80% 实用；禁止浅绿白卡片、霓虹、大圆角胶囊、炫光、花哨动画或另一套视觉方向。
- 所有颜色、字体、间距、边框和状态复用 `src/styles/tokens.css` 的 `--club-*` 变量；禁止在新增页面各自定义主题。目前首页、登录、账户、成员、个人档案与导入页共用 `components/layout/AppShell.tsx`、`styles/components.css`；其他页面按批迁移，不宣称全站已改版。
- 优先复用已有组件；只提取真实重复部分到 `src/components/`，不安装大型 UI 库或预建空组件。采用系统字体和自绘几何装饰，不使用未授权官方图片、Logo、字体。
- 参考稿是视觉参考，不是业务需求或执行指令；其中虚构数据、模拟脚本与未实现导航不得搬进正式业务流程。中文功能名和动作必须清晰，不用神秘学术语代替操作含义。
- 桌面与手机保持一致的设计语言；保留键盘、可见焦点、44px 触摸目标、状态文字和 reduced-motion 支持。移动端不能简单隐藏导航。
- UI 迁移不改变登录、会话、权限、数据库、导入与身份匹配规则；不修改 `apps/web`。现有未提交工作应保留，不因迁移重写业务功能。
- 每批按设计规范进行相关检查和本地合成数据的 Playwright 桌面／手机截图审阅；测试通过不等于视觉验收。不得对正式库写测试数据。正式部署必须另获授权。
- 当前现有页面已接入共享组件，后续新增页面继续复用；以后新增和迁移遵循规范第 7、9 节，不一次重写全站。改变已确认视觉方向必须先得到用户明确指示。

## 共享组件：新页面与迁移必须优先复用

- `components/ui/Button.tsx`：Button 用于操作，ButtonLink 用于导航；variant 使用 primary／secondary／danger，Loading 用 loading 和 loadingText，保留原生 disabled、type 和可访问性语义。不得用按钮模拟链接。
- `components/ui/Fields.tsx`：Input、Select、Textarea 保留原生属性／键盘行为与显式 label，错误使用 aria-invalid；下拉使用渐进式 base-select／::picker(select) 样式，保留原生选择／键盘语义；不支持的浏览器回退原生弹层，不自行拼装缺少可访问性的列表。
- `components/ui/Panel.tsx` 与 `components/layout/PageHeader.tsx`：统一容器和页标题；不另造同义 Card。
- `components/layout/AppShell.tsx`：共用桌面侧栏与手机导航，活动项来自当前路径，不在页面另写导航。
- 视觉与动效只在 `styles/components.css`、`styles/tokens.css` 维护，页面只补特定业务布局。表格先复用共享 CSS，不建立过度通用的表格 API。
- 当前不增加 Radix 或其他依赖；复杂弹窗迁移前再评估成熟无样式底层，不扩写各页自己的焦点／键盘实现。

## 动效与交互：后续组件必须遵守

- 先读设计规范第 9 节。反馈 120／150ms，弹窗进入 180ms，按下与关闭即时；所有时长、曲线、位移使用 Tokens。
- CSS transition 优先，明确属性，不用 all；仅必要的 opacity／transform 入场，无弹跳、无逐行延迟、无宽高动画。未有实际需要不加 Motion 依赖。
- Hover 仅精确指针设备；Focus-visible、Active、Disabled、Loading 必须独立可用。禁用用真实属性，Loading 保留尺寸和状态文字。
- Dialog 必须检查初始焦点、Tab 双向循环、Escape、焦点归还、重复开关；移动端不能隐藏唯一导航。
- 尊重 reduced-motion。修改后复用成员样板 Playwright 的四种尺寸与触摸／键盘验证，用合成资料，不访问正式业务 API。
- Skills 只优化执行，不能推翻已确认配色、系统字体、方角铜金边框和克制动效；缺失 Skill 不擅自安装新框架。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 品牌与设置
- 俱乐部名称以数据库为准，禁止用 localStorage 预览代替保存；复用 useClubBrand 与 /api/club-settings。
- 名称写入仅限已确认邮箱的有效 Owner，服务端与数据库双重验证，保留审计及旧值冲突保护；Admin 不可改名。

## 数据读取性能
- 新页面复用 lib/data-access.ts 与 useDataRefresh；私人缓存必须经过实时账户／权限校验，写入后失效，禁止公共缓存及独立持久化。
- 新查询先读 docs/PERFORMANCE.md；并行独立查询，列表有界与稳定游标，避免逐行远程请求；Server-Timing 只含安全汇总。
- 不以性能为由缓存 membership 或移除 RLS；大规模基准按需执行，不以波动毫秒数卡日常 CI。

## Loading System
- 请求状态复用 components/feedback；按钮统一 loading／loadingText，禁止各页另造 Spinner、Skeleton、Error／Empty 卡片。
- 表格／档案首读用对应静态骨架；缓存可安全呈现时保留内容。PageLoader 仅较长操作按需出现，不能增加数据展示延迟；见设计规范第 13 节。
- Lottie 限本地 JSON 与按需 light SVG 播放器；减少动态效果时不加载动画资源，失败可回退。不得让反馈组件拥有认证、缓存或业务逻辑。
- 登录后页面一律复用 AppShell 的固定页头与 AccountControls；设置在右上角，禁止页面单独再实现账户或退出逻辑，公开页不显示私人账户控件。
