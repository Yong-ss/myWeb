# Club Design System

> **当前组件系统以第 15 节为准（2026-10-29）。** 下方「当前生效：Motion + Radix」一节仍是动效与弹层的原则；第 7–14 节中关于 `Panel`、`Fields`、`components.css`、`loading.css`、原生 `<dialog>`／`<details>` 的描述是历史记录，相应实现已被第 15 节替换。

## 当前生效：Motion + Radix 交互动效架构（2026-10-29）

**决定与优先级：** 本项目正式允许并要求在有明确交互价值的地方采用 **Motion for React** 与 **Radix Primitives**。本节及第 14 节为当前交互设计的权威规范；与第 7、9、10、11、13 节中的历史限制或旧实施记录冲突时，以当前规范为准。历史日志保留用于解释演变，不能被当作现在仍有效的禁止条款。本次授权仅针对 `apps/club`，不包含主站换 UI、业务规则改变、生产部署或其他第三方设计系统。

- **Motion（`motion`，组件从 `motion/react` 引入）**：负责 React 状态变化引起的出现／消失、内容切换、折叠／展开、合适的布局位置变化。优先使用 `AnimatePresence` 的退出过渡、必要时使用 `layout`；不用它替代每个简单 CSS hover。
- **Radix Primitives（优先官方 `radix-ui` 包，按需导入组件）**：负责需要完善焦点、Escape、键盘导航、Portal、可访问性语义的 Dialog、Drawer、Popover、DropdownMenu、Accordion 等交互。仅安装并使用实际存在的原语，不为使用库而制造新 UI。
- **共同使用**：复杂弹层以 Radix 提供行为与焦点管理、Motion 提供可中断的视觉连续性；尊重 Radix 的状态、生命周期与 `forceMount` 机制，不允许退出动画残留焦点陷阱、遮罩或点击拦截。现有自绘外观、Design Tokens、Button／Panel／Loading System 保持不变。
- **验收目标**：不只要颜色渐变，要让用户亲眼看见从触发 → 打开 → 内容变化 → 关闭的连续过程。至少在真实浏览器录制并审阅关键交互的短视频或中间帧；截图与功能测试通过不能替代动效质量验收。
- **边界**：轻量 CSS transition、原生 `<select>`、原生输入保持合理使用；不引入 Bootstrap、整套现成主题或无必要的动画特效。必须保持键盘、屏幕阅读器、`prefers-reduced-motion`、设备性能和私有数据正确性。

## 全站视觉验收规则（2026-10-29）

- 采用新版 Impeccable 4.8.0、UI Animation（ff92bf5）、UI UX Pro Max（28b3b8d）的审查方法；与本项目已确认风格冲突时，以本规范为准，保留档案小标、系统字体和方角。
- 所有实际路由包含 404 都使用共享壳和 UI 组件；登录／404 为 512px 阅读容器，设置表单上限使用 `--club-form-max`，公共首页为 1120px，业务工作区保持原上限。
- 标题区与正文间隔 24px；面板首标题无多余顶边距，末项无多余底边距；手机输入字号 16px，选择文字、光标、链接下划线均使用统一主题。
- 新增 `tests/browser/club-visual-review.spec.mjs`：真实本地静态构建、合成 API 数据、外站请求拦截，覆盖九个路由的 1440px／390px 截图；输出 `.test-artifacts/club-review`。截图不是生产数据，也不是用户已批准的视觉基线。
- 每次交付逐张审阅截图并复测实际交互，自动化通过不得替代视觉验收；原有 320／768px、键盘、触屏、弹窗、Loading／Error／Empty、reduced-motion 用例继续保留。

## 2026-10-29：整体交互连续性

用户要求保留原风格并改善响应式与生硬切换；本节记录先前 CSS-only 方案及版式修正。**交互组件的当前实现优先遵循顶部「Motion + Radix」决定及第 14 节**；这里的 CSS-only 选型、退出实现和“无依赖”陈述不再限制新实现。

- 共享内容区使用 16–32px 流式水平留白，避免断点处突然改变边距；根滚动条预留空间，减少短页与长页之间的水平位移。
- 当前已有的页面一级区块使用过 240ms opacity 过渡；新工作不应盲目让每个区块淡入。优先为真正由交互触发的出现／消失与展开／收起设计完整过渡，不为请求增加等待、不对搜索排序重播整表动画。
- 先前原生菜单／业务弹窗使用 180ms 进入、120ms 视觉退出及淡入遮罩。当前可按第 14 节迁移为 Radix + Motion：操作必须立即响应，退出视觉应完整，焦点归还和卸载时机交给经过验证的弹层生命周期处理，而不是一刀切 `close()` 或人为延时。
- 使用 CSS `@starting-style` 与离散 display／overlay 过渡渐进增强；不支持时即时显示或关闭，内容默认可见；减少动态效果时包括遮罩在内全部关闭过渡。
- 按钮保持即时触觉反馈；步骤、选项和固定表格列共享颜色反馈，保留铜金边框、方角、衬线标题及 44px 操作目标。不加入无意义的持续装饰动画；Motion 与 Radix 是本次明确批准的合理交互依赖。

状态：用户已确认唯一视觉方向，2026-10-27。名称：**Dark Victorian Occult Dashboard（暗黑维多利亚神秘学管理界面）**。

## 1. 固定基准与范围

- 20% 神秘学氛围，80% 现代 Dashboard 实用性。禁止每个页面重新选风格。
- 原始参考：[用户确认的 HTML 参考稿](design-reference/club-approved-reference.html.txt)，14,850 bytes；按文本保存，便于审阅，不执行其中的演示行为。它依赖演示容器样式，并非可直接复制的生产组件。
- 本次收到的是 HTML 参考稿，没有另附独立截图。不得声称已完成截图像素对比；未来收到确认截图时，保存在同目录并补充链接。
- 参考稿的视觉是基准；示例人数、名称、导航模块、模拟 JS 不属于业务需求，不能据此增加功能或改数据契约。
- 仅适用于 `apps/club`。不修改主站，不改变认证、权限、导入、身份匹配或数据库规则。
- 参考颜色有细微变体时，以用户明确指定的七种核心色为准；触屏字号和目标尺寸以可读性为准，不能照抄参考中的 8–11px 操作文字。

## 2. 颜色与统一 Tokens

唯一 Token 定义：[tokens.css](../apps/club/src/styles/tokens.css)。现有 Club 页面已逐步统一到共享 AppShell／ClubFrame 与 `--club-*` Tokens。一般组件样式限定在 `.club-app`；**Radix Portal 可能挂到 `body` 而不在 `.club-app` 内**，必须为 Overlay／Content 使用明确的 Club 样式作用域或安全的 Portal 容器，保证主题正确且不污染主站。文档描述用途，数值修改只改 Token 文件并同步规范。

| Token                       | 色值        | 用途           |
| --------------------------- | ----------- | -------------- |
| `--club-bg`               | `#141718` | 全页背景       |
| `--club-surface`          | `#1B2021` | 标准面板       |
| `--club-surface-elevated` | `#30312D` | 层次较高的面板 |
| `--club-gold`             | `#DBC08E` | 标题、主要强调 |
| `--club-border`           | `#655943` | 铜金细边框     |
| `--club-text`             | `#D9D1BD` | 正文           |
| `--club-text-secondary`   | `#A8A294` | 辅助说明       |

输入底色 `#111719`，侧栏 `#151B1D`；强边框 `#B5965F`。Hover `#292B25`，按下 `#353126`，选中 `#302C23`，键盘焦点 `#E6CB94`。禁用为灰色文字／深灰底，不用整块透明度降低使说明消失。

成功用灰绿 `#A7C4AD`，警告柔琥珀 `#E2BE80`，错误柔红 `#E7A5A0`，信息灰蓝 `#AFC2CD`，均有对应低饱和底色 Token。状态必须同时配文字或图标，不能只靠颜色。灰雾仅用于背景，静态、低透明度，不压在文字上；允许参考中的微弱角落渐变，禁止大面积金色渐变、标题发光、霓虹或动态粒子。

## 3. 字体、密度与装饰

- 标题：Georgia → 已安装的 Noto Serif SC／Songti SC／宋体 → serif；正文：Segoe UI／微软雅黑／system-ui；ID、JSON：Consolas／monospace。仅使用系统回退，不下载字体或调用第三方字体 CDN。
- 正文 16px/1.6；密集表格 14px/1.5；辅助文字最低 12px/1.5；页标题 24–32px。英文档案小标可 12px、字距 .12em；中文正文不加大字距。数值使用 `font-variant-numeric: tabular-nums`。
- 间距用 4/8/12/16/24/32/48px；常规卡片内距 24px，手机 16px；单行控件至少 44px 高。
- 1px 细边框、0–2px 圆角；禁用大圆角胶囊、大面积阴影。身份状态小徽标也采用微圆角。
- 菱形、细线、几何纹章可用 CSS／普通 Unicode／自绘 SVG；装饰 `aria-hidden`，不得替代动作文字，不使用彩色 emoji 作为导航图标。重要面板可放参考中的小菱形角标，避免每个控件都装饰。
- 不引入官方图片、Logo 或未授权字体；保留产品身份，参考稿里的文学化品牌名不自动变成正式产品名。

## 4. 布局与响应式

- 桌面 ≥1024px：64px 顶栏，208px 侧栏，主内容最大 1280px，四周 24–32px。保留参考的细铜金分隔线、深色侧栏和浅金活动标记。
- 768–1023px：导航折叠为菜单，主内容 24px 内距；不把侧栏挤成难以辨认的图标列。
- <768px：单列、16px 内距，顶栏菜单按钮打开抽屉；必须支持关闭、Escape、焦点回到菜单按钮。桌面与移动共用导航数据，`aria-current="page"` 标记当前页面。
- 不照抄演示稿在手机上直接隐藏侧栏而失去导航。首页／登录页可用简化公共壳，登录后的工作台、名单、导入、历史共用 Dashboard 壳。
- 320px 手机宽度下页面本身不得横向滚动；宽表格仅在自己的容器横向滚动，保留昵称识别。不能把整表压成小字。

## 5. 统一组件与交互契约

先复用已有组件；已建立第 10 节共享组件，迁移时继续只提取实际重复部分到 `src/components/`，不预建一整套空框架。布局和视觉组件不拥有权限、API 或保存逻辑。

| 组件                           | 统一规范                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AppShell / Navigation          | 顶栏＋侧栏；活动项左侧金线、浅金文字、轻微底色；只列已实现模块，不放可点击的假入口                                                                                         |
| PageHeader                     | 小档案标、单个清晰中文标题、一句可选说明、一个主要动作；主题化称呼不能遮蔽“导入／成员／历史”等功能含义                                                                   |
| Panel / StatisticCard          | 深灰绿、铜金细边框、微圆角；统计只呈现实际数据，无数据用「—」                                                                                                             |
| Button                         | 金色文字、铜金边框、低透明金底；次要按钮中性；危险动作柔红并明确后果；默认／hover／pressed／focus／disabled 状态齐全                                                       |
| Input / Select / Search        | 深色输入底、可见标签、统一高度；原生 select 可继续使用并保留键盘语义。需要搜索、复杂浮层或定制列表行为时评估 Radix，不能不必要地替换全部原生控件                           |
| Table                          | 14px 正文，表头层次清楚、细行线、轻微 hover、数字对齐；排序有明确方向，选中／焦点不能仅靠 hover                                                                            |
| Filter / Sort / Pagination     | 筛选控件成组换行，显示当前日期／版本；分页按钮明确“更早日期／上一页”，读取中禁用对应动作                                                                                 |
| Dialog / Drawer / Popover      | 优先使用实际适用的 Radix Primitives 管理焦点、Escape、Portal 和开关；Motion 提供连续进入与退出。深色金边、方角、短标题、单个主要动作；关闭后焦点归还；窄屏留 16px 安全边距 |
| Alert / Toast                  | 成功、警告、错误均有图标或文字；错误贴近相关控件且保留输入；持久错误不用瞬间消失的 toast                                                                                   |
| Loading / Empty / Error        | 读取中、无数据、无搜索结果、失败分别呈现；失败给“重试”；禁止错误时展示看似成功的过期数据                                                                                 |
| Import / Review / Confirmation | 保留三步流程，集中处理少数未匹配玩家；复杂说明按需展开，最终确认写明日期、人数、名单完整性和更新方式                                                                       |

按钮动词直接说明动作；每个区块只写当前决定所需的重点。推荐原因说“名字相似”，不显示编辑距离等技术术语。新样式不能重新引入 79 个默认展开操作卡片或自动弹窗。

## 6. 可访问性与动效

- 普通文字对比至少 4.5:1，大字与必要控件边界至少 3:1；铜金细边框主要作装饰，必要控件使用强边框，实际组合迁移时测量。
- 焦点 2px 浅金描边、2px offset；禁用不能接收提交，理由可读。所有输入有 label，checkbox/radio 与文字同行对齐，触摸目标至少 44×44px。
- 表格有 caption、列标题，错误用 alert、读取和完成反馈用 polite status；不能对所有内容重复播报。
- 状态过渡遵循**当前第 14 节**及 `--club-*` Motion Tokens；不使用 `transition: all`，不制造夸张缩放／弹跳及无意义的持续动画。允许经过验证的展开高度或布局位移动画；加载反馈按第 13 节执行，减少动态效果时使用静态状态。

## 7. 历史差异与迁移顺序（初版计划，非当前状态）

**以下为 2026-10-27/28 初版计划存档，不代表最新代码仍存在这些问题。** 当时 `globals.css` 仍有浅色／绿色主题、白面板、大圆角、旧导航和散落颜色，尚未完成 UI 迁移。后续已逐步统一共享壳与组件；执行新任务须以当前代码和第 14 节为准。

1. 本轮仅固定规范、原稿、Tokens 和持久指令，不改页面外观，保留现有未提交业务工作。
2. 下一批统一接入 Tokens，替换共享壳、导航、按钮、输入、面板、状态和 Dialog 的样式；同步迁移首页／登录／账户，移除被替代的旧规则，不在 CSS 末尾无限叠加覆盖。
3. 迁移导入、身份确认、名单表格、日期／版本筛选。只改呈现层，保留 API、会话、事件与数据契约，调整必要的可访问性测试定位。
4. 后续成员档案、历史、分析、设置继续用同一基础组件，不另建主题；功能未授权或未实现时不伪造统计／交互。

每批先运行相关快速检查；涉及核心流程时复用真实隔离集成测试。用现有 Playwright 在 1440×900、768×1024、390×844、320×800 截图，覆盖导航、表格、展开、Dialog 和错误状态；附键盘／reduced-motion 检查。截图只用合成数据和本地环境，不将真实名单存入 Git。对照参考检查配色、轮廓、字体、密度与导航；自动测试通过不代表视觉通过。

## 8. 长期执行

每次 Club UI 工作先读 `apps/club/AGENTS.md`、本规范和原始参考稿，再检查现有组件。新组件必须用 `--club-*` Tokens，不在页面硬编码新配色；需要新增 Token 时先检查现有用途。改变风格或新增字体／图标依赖必须有用户明确授权。

后续迁移完成后用隔离合成数据建立批准后的 Playwright 基准图；基准变更需视觉审阅，不能仅为消除失败直接更新。**2026-10-29 已批准仅为 Club 合理引入 Motion 与 Radix**，不允许由此扩张为整套 CSS 框架或无关依赖。正式部署仍需另外授权；当前仓库 Push `main` 可能触发自动部署，未经确认不可自动 Push。

## 9. 动效与交互样板 — 2026-10-28（历史基线）

本节记录原有 CSS-only 样板及测试，不是今天对 Motion/Radix 的禁止规则；下表和下述动画限制与第 14 节冲突时以第 14 节为准。

成员名单 `/members` 为本轮唯一迁移页；`ClubPrototypeShell.tsx` 与 `prototype.css` 是样板，其余页面尚未迁移。样板仅负责呈现／导航，不改变查询、认证、身份匹配、数据库或 API。原有 Worker 查询回调仅补齐 TypeScript 参数标注。

已使用现有 `frontend-design`、`emil-design-eng` Skills；本地未找到 `ui-animation`、`web-design-guidelines`，未下载或加入依赖。Skills 的换主题、字体下载、弹性动画等建议不能覆盖已确认规范。

| 场景                 | Token／时长                     | 规范                                                                                                              |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 即时按下             | 0ms                             | 即时切换按下色，不缩放、不移动布局；松开回到正常／hover 状态                                                      |
| 快速反馈             | `--club-motion-fast` / 120ms  | 文字与表格 hover 颜色反馈；无逐行入场动画                                                                         |
| 常规状态             | `--club-motion` / 150ms       | 按钮、导航、输入框的边框／颜色／底色；只列明所需属性                                                              |
| 弹窗进入             | `--club-motion-enter` / 180ms | opacity 0→1、最多 `--club-dialog-offset` / 6px 位移；CSS transition 配合 `@starting-style`，不支持时直接出现 |
| 弹窗关闭（历史样板） | 立即                            | 当时只保障即时 Escape／焦点行为；当前要求在保持可访问性和即时操作响应的前提下，完成安全的视觉退出过渡，见第 14 节 |
| 反馈曲线             | `--club-ease-feedback`        | cubic-bezier(.2, 0, .2, 1)                                                                                        |
| 进入曲线             | `--club-ease-enter`           | cubic-bezier(.16, 1, .3, 1)，不回弹                                                                               |

- Hover 只放在 `(hover: hover) and (pointer: fine)` 下，触摸设备不留下假 hover；Active、Focus 不依赖 hover。
- Focus-visible 使用 `--club-focus-width` / 2px 浅金描边与 `--club-focus-offset` / 3px 间隔，立即出现；不能用动画延迟键盘反馈。
- Disabled 用实际 `disabled` 属性，保留可读颜色，不仅降低透明度；Loading 保留操作位置、禁用重复点击并显示状态文字。查询提示保留区域高度，使用第 13 节静态骨架；仅请求未完成时允许克制的状态旋转，不做闪烁或无条件装饰转圈。
- 高频操作（输入、搜索、排序）立即反馈，不淡入整张表、不插入人为等待。**当前允许在实际的折叠面板、内容增删和有价值的布局变化中使用受控的 Motion layout／尺寸动画，但禁止逐行、全表重播和高频布局抖动。**
- 历史实现：手机导航采用原生 dialog 并手工处理 Tab、Escape 和焦点归还。**当前允许迁移至 Radix Dialog，交由它管理已支持的焦点与键盘行为；不能保留两套冲突的焦点陷阱。**
- `prefers-reduced-motion: reduce` 禁用或显著减少非必要动画，信息和操作保持完整，禁止无意义的自动播放装饰动效。**“当前不需要 Motion for React”是 2026-10-28 的历史判断，已由 2026-10-29 新决定取代。**
- 禁止将样板 CSS 末尾复制到每个新页面；迁移下一页时复用壳和 Tokens，并把实际重复样式提取为共享原语。不得把尚未迁移的其他页面说成已统一。

### 验证与视觉基准

`tests/browser/members-motion.spec.mjs` 使用合成名单，检查 1440×900、768×1024、390×844、320×800；覆盖颜色、横向溢出、表格滚动、键盘焦点、触摸反复开关、禁用、失败重试、reduced-motion 和主题隔离。沿用现有 Playwright，可在常规构建后的 `pnpm test:e2e` 中运行。

视觉审查截图在 `.test-artifacts/club-motion/`（不进 Git），只含合成资料。此处因明确视觉审查需要保留正常状态的截图；常规 Trace 与失败截图仍按失败保留。当前截图用于人工审查，不冒充用户已批准的像素基准。原稿是 HTML，不声称已与不存在的参考图片逐像素比对。

## 10. 共享组件第一批 — 2026-10-28

原成员页样板已提升为共享实现：`ClubPrototypeShell.tsx` → `components/layout/AppShell.tsx`，`prototype.css` → `styles/components.css`，作用域改为 `.club-app`。账户 `/account` 与名单 `/members` 已使用相同组件；首页、登录、导入仍待后续迁移。第 7／9 节记录前批次状态，不代表所有页面已经迁移。

| 组件           | 使用方式                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button         | 操作用原生 button，默认 type=button；支持 primary／secondary／danger、loading、loadingText、disabled。Loading 保留原文字占位，防止按钮宽度变化，仅加载中复用 LoadingSpinner，减少动态效果时静止 |
| ButtonLink     | 导航用 Next Link，复用按钮视觉；不提供伪 disabled 链接                                                                                                                                          |
| Input / Select | 透传原生属性；使用显式 label、aria-invalid 表达错误，不自行实现下拉键盘逻辑                                                                                                                     |
| Panel          | 标准语义 section；默认无外边距，由布局 gap 控制，不另建同义 Card                                                                                                                                |
| PageHeader     | 统一 eyebrow、title、可选 actions；不加入 API 和状态逻辑                                                                                                                                        |
| AppShell       | 同一份导航数据用于桌面和手机；当前活动项依据 pathname，复用已有菜单键盘与焦点行为                                                                                                               |

账户页以真实账户信息、导入、查阅两个入口组织内容，不编造统计或未实现模块；不改变加载、重载、退出和错误处理逻辑。**当时未安装 Radix 是历史记录；目前已批准在复杂 Dialog／Popover 等实际场景采用 Radix。** 表格仍可使用原生 table 加共享 CSS，避免为没有的功能增加复杂抽象。

后续新增页面必须先检查这些组件，不能复制旧页独立定义按钮／输入／导航样式。配色和动效仍以 Tokens 为准。全站主题切换尚未完成，不把共享样式作用到旧页；逐页迁移后再删除旧 globals.css 中对应规则。

## 11. 导入流程与下拉交互迁移 — 2026-10-28

账户、名单和导入三个路由现已共用 AppShell、PageHeader、Button、Input、Select；Textarea 补入共享表单控件。导入准备、身份核对、最终预览、成功反馈和两个原生 Dialog 均使用暗色铜金样式，保留所有既有状态与业务事件。

交互补齐 summary 的 hover／键盘焦点、radio／checkbox 的选中与焦点、分段按钮的 aria-pressed 状态、候选玩家按钮、上传按钮、表格行反馈和 Dialog 短进入过渡。checkbox/radio 控件保持 20px 标记和整行 label 触摸目标，不套用文本输入的满宽／44px 内框。步骤条是进度展示，不伪装成可点击导航。

Select 使用 CSS `appearance: base-select` 和 `::picker(select)` 在支持的浏览器中呈现暗色铜金菜单、44px 选项、选中标记与短淡入；交互仍由浏览器处理。用 @supports 渐进启用，旧浏览器保留可用的原生菜单；不声称所有浏览器都支持相同弹层外观。减少动态效果时连 picker 和箭头过渡一并关闭。依据：[Chrome 官方定制 Select 说明](https://developer.chrome.com/blog/a-customizable-select)。

验证使用本地 Chromium、四种视口和合成测试资料：覆盖导入三步截图、身份弹窗、最终确认、错误 JSON、重复请求恢复、同日冲突、下拉键盘／Escape／手机触摸。测试不写正式 Supabase。首页与登录仍未视觉迁移，不宣称全站统一。

## 12. 公共页面及个人档案 — 2026-10-28

首页与登录使用 AppShell publicPage 模式及同一 Button／Input／Panel，公开页不显示业务侧栏。个人档案复用业务壳与原生历史表格；玩家详情在导航中归属于成员名单。现有路由均已接入共享主题，后续只完善组件和必要页面布局，不重选视觉方向。

成员名单的状态、历史数据日期必须可见；离会昵称红色删除线且排末尾。历史表格的缺失日期不补 0；不把首次观察叫作真实加入日期，也不把周活跃下降断言为业务倒退。

总览布局确认：总览改为真实数据仪表盘，不再放导入／成员入口大卡片；当前账户与退出放右上角，品牌显示数据库中的俱乐部名称。设置入口固定在桌面侧栏底部，手机菜单也保留；设置页提供公会长名称设置。总览当前提供最近两次人数对比、成员变化和评分前十，完整长期趋势及评分增长汇总仍待后续补齐。

品牌与设置更新：左上角采用独立两行，主标题为俱乐部名称，副标题为「数据检测平台」，以现代小字和字距区分。设置页从 Supabase 读取名称，保存成功后同步各页；刷新或换设备仍读取同一名称。仅公会长可修改，保存中禁用重复操作，错误明确显示；旧窗口冲突须刷新后重试。

## 13. 统一 Loading System — 2026-10-28

本节是用户明确批准的加载反馈规范，取代前文“一律不使用旋转／骨架”的旧限制；不是另一套视觉主题。组件包来源为用户提供的 club-loading-kit，已阅读 INTEGRATION、源码、CSS 和原始 JSON，按现有应用调整，未整体覆盖项目。

- 统一从 components/feedback 引用 LoadingSpinner、PageLoader、TableSkeleton、ProfileSkeleton、LoadingState；数据、权限和缓存仍由调用者及 data-access 管理。
- Button 的 loading／loadingText 自动显示 Spinner、aria-busy 和真实禁用，不另做按钮。空状态与错误态复用 LoadingState，保留真实重试动作，不以空状态掩盖权限错误。ready 直接输出 children，不制造额外布局。
- 表格首读使用 TableSkeleton；个人档案使用与现有事件面板／历史表布局相符的 ProfileSkeleton。骨架静态、占位颜色统一用 Tokens，不显示假数值，不使用 shimmer。实际数据一到就显示，不为动画保留时间。
- 总览保持渐进呈现，排名区使用表格骨架；后台刷新保留已安全加载数据。成员切换日期／版本仍等待对应结果，不展示旧日期冒充新日期。LoadingState 是纯呈现，不拥有 fetch 或缓存。
- PageLoader 只用于导入准备／保存等较长处理；默认 160ms 后呈现，不影响实际数据完成时间。局部覆盖已禁用的表单，避免插入 250px 内容挤动原表单；导航与页面标题保留。其他页面不强制加载 Lottie。
- 仅 PageLoader 呈现后动态导入 lottie-web 的 light SVG build；无第三方 CDN。原始 JSON 保存在 public/animations/club-archive-loader.json，2,785 bytes，无外部 assets、图片或表达式。减少动态效果时不请求播放器或 JSON，显示静态纹章；偏好变化时销毁动画，卸载时清理监听／实例。
- 使用 lottie-web 5.13.0（自带类型，无额外 types 包）。当时记录的 npm 包展开体积与独立 chunk 数据供参考，不保证以后构建仍相同；仅 PageLoader 需要时动态请求。**当时“不添加其他 UI／动效库”仅针对 Loading System，不阻止现已批准的 Motion／Radix。** 播放器不可用时保留 CSS 纹章及文字，不能阻塞业务流程。
- 所有状态尺寸与颜色服从 tokens.css、loading.css；不重做 AppShell、Panel 或认证逻辑。公开首页无远程加载，不添加假 Loading；登录／退出／设置保存通过共享 Button 获取一致反馈。

新页面示例：`<LoadingState status="loading" variant="table" />`、`<LoadingState status="error" detail={error} onRetry={retry} />`、`<LoadingState status="empty" title="暂无记录" />`；已有有效数据时直接呈现并在后台更新，不切换全屏 PageLoader。TableSkeleton 在组合骨架内部用 announce=false，避免重复播报。

### 预览对齐修正

用户在语音中再次确认以下载包 preview.html 为视觉基准，只允许必要的小幅适配。ProfileSkeleton 已恢复原包的身份、三卡和时间线结构；LoadingState ready 未传 children 时显示预览中的勾号完成卡，传 children 时仍正常透传。导入完成接入该卡并保留原有修订消息，避免双重 status。

固定结构从第一次渲染就出现：成员日期、版本、摘要、搜索、排序不在 Skeleton 结束后才插入。Skeleton 仅替换数据表；移动摘要预留换行高度。总览共用同一面板框架，移除旧 club-loading 的 320px 占位；图表和排名区域尺寸保持稳定，不通过高度动画补救。新数据仅短 opacity 进入，reduced-motion 禁用。人数区为本地 SVG 两点折线图，日期／人数清楚标注，不推断两次截图之间的每日人数，不增加图表依赖。

### 共享固定页头

登录后的所有页面统一通过 AppShell → AccountControls 展示账户、角色、设置与退出；总览不再独自提供账户槽位。设置从左下导航移至右上角，手机也在页头保留，抽屉只放主导航。页头 sticky top=0，手机统一两行布局。账户获取、焦点重新验证、退出与缓存失效仍复用原有 clubFetch 和 API；不缓存权限、不改变认证或数据库。

滚动条：Club 页面及内部滚动区统一透明轨道、铜金色滑块；支持 WebKit scrollbar 的浏览器使用 8px 宽度，Hover 柔金。Firefox 使用标准 scrollbar-color 跟随原生宽度，保留强制颜色及系统滚动操作，不使用 JS 模拟滚动。

桌面侧栏在页头下方 sticky，填满剩余视口高度，菜单过长时仅侧栏内部滚动；手机继续使用抽屉菜单。
根布局通过 ClubFrame 持有唯一 AppShell；页面只输出内容，不重复包裹页头／侧栏。账户区域预留宽度，路由切换保留显示并重新校验权限，设置始终位于最右侧。
人数图表参考趋势图呈现：使用暗金曲线、低透明面积填充、虚线网格和真实数据点；Hover、键盘聚焦、触摸点选显示日期／人数及竖向参考线。44px 透明命中区不套通用按钮外观，提示层绝对定位、不改变高度，Escape 关闭。仅连接已有观察点，单点不画假趋势；当前总览仍仅提供最近两次记录，不添加无数据来源的周期切换。复用 SVG 与 Tokens，无新增依赖。
人数图标题统一「人数总览」，删除标题下重复解释。提示卡锚定图内右侧，并按数据点高度选择上下位置，避开高位数据点；切换日期时不左右跳动，首次出现仅 120ms opacity／transform 微反馈，reduced-motion 关闭。
用户确认人数曲线左侧增加标为「起点」的 0 展示基准，再连接真实记录；不写入数据库或赋予虚构日期，提示卡区分展示基准与记录人数，横轴日期简写为月日。

## 14. 当前交互系统实现规范 — Motion + Radix（2026-10-29）

### 14.1 使用边界和优先级

| 场景                                   | 首选方案                                    | 具体要求                                                                  |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| 按钮 Hover／Pressed／Focus、颜色／边框 | CSS Transition                              | 100–180ms；真实点击立即响应，焦点描边不可延迟                            |
| Dialog、确认框、移动端 Drawer          | Radix Dialog + Motion（适合时组合）         | 进入、遮罩、退出均完整；焦点、Esc、锁滚动、Portal、快速重开行为正确       |
| Popover、Dropdown Menu、复杂浮层       | 相应 Radix Primitives + CSS／Motion         | 依据实际场景按需使用；对齐锚点、触屏和键盘；不创建无必要菜单              |
| Accordion／可折叠详情、表单步骤内容    | Radix Accordion 或有语义的受控展开 + Motion | 高度／布局与内容淡入同步，避免瞬间撑开或收缩；不能破坏嵌套表单状态        |
| 条件渲染、插入／移除、Tab 内容切换     | Motion `AnimatePresence`                  | `initial`／`animate`／`exit` 明确，stable `key`，避免未退出即卸载 |
| 列表排序／筛选、数据表                 | 立即更新；必要时仅轻微 CSS 反馈             | 大表不做逐行布局动画，不阻碍输入及查询，不因排序动画改变数据顺序          |
| Loading／Skeleton／Lottie              | 第 13 节已有系统                            | 不让动画拖延数据展示，不再重复建立第二套 Loading 组件                     |

两库**均需在真实 Club 业务交互中实际落地**，不能只是安装到 `package.json` 或写一套没有被使用的示例。迁移时优先选三个可感知的代表场景：**导入流程的身份确认弹窗、成员页的删除确认弹窗、导入页的详情展开／折叠**；同时检查手机 Drawer。验证样板后再推广到其余适用的已存在交互，避免大爆炸式替换全部原生控件。

### 14.2 动效设计与性能

- 目标是「**动作立即响应，视觉平滑衔接**」，不是故意变慢。简单反馈建议 100–180ms；内容出现／退出 160–260ms；布局变化可在 180–300ms 范围内针对实际内容调整。数字是建议，不是机械硬编码上限。
- 默认采用低回弹或无回弹的缓动；涉及具体空间连续性时可采用受控 spring，禁止明显弹跳、漂浮、缩放炫技。尽量只动画化 `opacity`／`transform`；折叠高度等确有价值的尺寸动画需测量并控制影响区域。
- 动画要可中断：快速重复开关、连续点击、路由切换与新数据返回时不得卡在中间状态、出现幽灵遮罩或无法点击。
- 关闭必须立即接受用户输入；对使用 Radix + Motion 的弹层，退出动画可以短暂播放，但后台交互、焦点行为、阻挡层卸载应遵守正确的弹层生命周期，**不得简单通过固定 `setTimeout` 延迟关闭或手工复制焦点陷阱**。
- `AnimatePresence`、Radix Portal／`forceMount`、Radix 的 `open`／`onOpenChange` 和受控／非受控状态必须组合正确。不能叠加冲突的 CSS `@starting-style` 与 Motion 动画，也不能因为关闭提前卸载而丢失 `exit`。
- Portal 可能渲染到 `body` 外层；Overlay、Content 必须有显式 Club 主题作用域与层级、滚动锁、定位策略。不得使 `.club-app` CSS 与外部 Portal 互相漏样式。
- 继续遵守 `prefers-reduced-motion`：减少或取消非必要 transform／layout 动作，保留即时状态与可读反馈；在低性能手机上避免大面积模糊、滤镜、粒子、阴影及整个长表的布局动画。
- 页面 Loading、缓存、网络时序与实际数据更新相互独立；绝不能为了让动画完整而延迟显示真实数据、延迟服务端请求或持有过期私有内容。

### 14.3 共用组件，不重写主题

- 共享样板沿用 `Button`／`ButtonLink`／`Panel`／`AppShell`／`LoadingState` 与 Tokens；只为**真实重复出现的复杂交互**增加诸如 `ClubDialog`、`ClubPopover`、`ClubAccordion` 的薄封装，避免每页重复 Radix state、Portal、焦点与 Motion props。
- 不重置字体、颜色、方角、布局密度，不导入 Radix Themes、Bootstrap、shadcn 主题预设或另一套 CSS 主题；**Radix Primitives 没有强制外观**。
- 根据项目现有 React 19、Next.js 静态导出和 Cloudflare Workers 边界，客户端交互放在合适的 Client Components，避免在服务端或构建时访问 `window`／`document`。
- `asChild`／复合组件须检查 ref、事件透传、disabled、type、aria 属性及点击传播，不嵌套无效交互元素；删除确认、身份确认、表单提交状态不能被动效重置。
- 依赖新增只限 `apps/club` 中实际使用的 `motion` 与 `radix-ui`（如当前项目构建有兼容原因，可使用等价的官方独立 `@radix-ui/react-*` 包，并记录理由）；固定兼容版本及 lockfile，检查生产 bundle 变化。

### 14.4 动态验收（与静态截图分开）

- **必须有交互过程证据**：用 Playwright 录制代表性桌面／移动端交互短视频或分阶段截帧（刚点击、进入中、完全打开、关闭中、关闭后）；人工实际观看自然程度，不得只交付 18 张静态页面截图。
- 覆盖：身份确认的打开／切换下一名／关闭、删除确认打开／取消／关闭、导入详情折叠／展开、移动菜单、键盘 Tab／Shift+Tab、Escape、焦点归还、遮罩阻挡、快速连点、减少动画模式。
- 自动化检查功能与状态正确：不能让安全确认被跳过、删除误触发、表单值丢失、重复提交或滚动锁残留；测试数据必须是本地合成数据，不连正式业务库。
- 检查交互对性能的影响：bundle 增量、浏览器主线程卡顿／明显布局跳动与手机流畅度；无需在不稳定的 CI 环境用某个固定 FPS／ms 值作为硬门槛。
- 报告必须列出**哪些具体交互真正用了 Radix、哪些用了 Motion**，以及它们的点击前／点击中／结束表现；若有原生控件暂不迁移，说明原因。不能仅以「安装完成」「Skills 扫描通过」「测试全部通过」宣称动画已达到用户审美要求。

### 14.5 持续开发约束

- 未来新增交互先判断：纯 CSS 足够、是否需要 Radix 管理可访问性行为、是否需要 Motion 管理出现／退出／布局过渡。优先复用已验证的共享封装。
- 每次改动前检查 `apps/club/AGENTS.md` 和本节同步；不得让旧的「不需要 Motion／不安装 Radix／不做高度变化」历史记录覆盖当前决定。
- 未经确认不自动 Push `main` 或部署生产；业务逻辑、Auth、RLS、数据隔离和数据正确性优先于动效。

## 15. 组件系统：shadcn/ui（Radix）+ Motion + Tailwind（2026-10-29，当前）

### 15.1 结构
- 技术：shadcn/ui CLI 4.23（`-b radix`，样式 `radix-lyra` 方角）、`radix-ui` 1.8.1、`motion` 14.7.1、Tailwind CSS 4.3.3（仅 `apps/club`，`postcss.config.mjs`）、`sonner`（Toast）、`@phosphor-icons/react`、`cn`（类名合并）。版本均固定。
- 唯一 CSS 入口 `src/app/globals.css`：shadcn 语义变量（`--background`、`--primary`、`--border`、`--ring` 等）全部指向 `tokens.css` 的 `--club-*`；另提供 `gold`、`brass`、`field`、`hover`、`pressed`、`selected`、`success/warning/info(-bg)` 等工具色。始终深色，没有 `.dark` 切换；圆角统一 2px。
- 自定义工具类：`ornate`（◆ 角饰 + 灯光渐变，每页 1–2 个重点面板）、`mist`（整页背景）、`eyebrow`（小标）、`gold-title`（金色标题光晕）。`hover:` 只在鼠标设备生效，触屏点按不残留悬停色。
- 旧的 `legacy-base.css`／`components.css`／`loading.css` 已删除；只保留 `styles/chart.css`（人数图 SVG，限定 `.club-account`）。

### 15.2 组件清单（`src/components/ui`，每个职责一个实现）
| 需求 | 组件 | 说明 |
| --- | --- | --- |
| 操作 / 导航按钮 | `Button`、`ButtonLink` | `primary`／`secondary`／`destructive`／`ghost`；`default`／`compact`／`icon`（均 ≥44px）；`loading` + `loadingText` 保持宽度并禁用 |
| 表单 | `FieldGroup`、`Field`、`FieldLabel`、`FieldDescription`、`FieldError`、`FieldSet`、`FieldLegend` | `FieldError` 常驻（空时隐藏），新错误会被读屏播报 |
| 输入 | `Input`、`Textarea`、`NativeSelect` | 手机 16px；`NativeSelect` 是原生 `<select>`，支持时用 `appearance: base-select` 主题化弹出层 |
| 选择 | `Checkbox`、`RadioGroup` | Radix；单选选中标记为铜色菱形 |
| 容器 | `Card`（`ornate`）、`Table` 系列、`Separator` | 表格窄屏在自身边框内横向滚动 |
| 状态 | `Badge`、`Skeleton`、`Empty` | Badge 变体对应状态色对 |
| 切换 / 折叠 | `Tabs`、`Collapsible` | Collapsible 替代 `<details>`，高度与透明度一起过渡；关闭时卸载内容，表单值放在父组件状态里 |
| 弹层 | `Dialog`、`AlertDialog`、`Sheet`、`Popover`、`DropdownMenu`、`Tooltip` | 见 15.3 |
| 轻提示 | `Toaster` + `toast()`（sonner） | 只用于无需操作的确认（如“已复制”）；需要阅读或处理的错误留在原位 |
| 反馈封装 | `components/feedback`：`LoadingState`、`PageLoader`、`TableSkeleton`、`ProfileSkeleton`、`LoadingSpinner` | 基于上述组件；不含认证、缓存或业务逻辑 |
| 布局 | `AppShell`（手机导航为 `Sheet`）、`PageHeader`、`AccountControls` | 导航仍只来自 `lib/navigation.ts` |

### 15.3 弹层与动效约定
- Radix 负责焦点陷阱与归还、Escape、遮罩点击、滚动锁和 ARIA；Motion 负责进入／退出（`components/ui/motion.tsx`：进入 180ms、退出 120ms，抽屉 240／180ms，与 tokens 一致）。不另写焦点陷阱，不用 `setTimeout` 延迟关闭。
- 实现方式：Radix `forceMount` 放在 Motion `AnimatePresence` 内，Root 由 `withOpenState` 包装以便内容知道开关状态；关闭瞬间 Radix 释放焦点和页面阻挡，退出中的层 `pointer-events: none`。
- 选型：需要输入或选择 → `Dialog`；删除、放弃等确认 → `AlertDialog`（点遮罩不关闭，请求进行中不可取消）；手机导航 → `Sheet`；锚点帮助 → `Popover`；一组动作 → `DropdownMenu`；图标按钮名称 → `Tooltip`（不放唯一信息）。
- CSS 只做 hover／focus／颜色反馈；减少动态效果时 Motion 过渡为 0、CSS 动画和过渡全部关闭。

### 15.4 新功能如何使用
1. 先在 `/showcase` 找现有组件和写法，直接从 `components/ui/*` 引入；不要在页面里再写按钮、输入、弹窗样式或新的 CSS 文件。
2. 布局和间距用 Tailwind 工具类，颜色只用语义类（`bg-card`、`text-gold`、`border-border`、`text-muted-foreground` 等），不写十六进制颜色。
3. 确实需要新的共享组件时，用 `pnpm dlx shadcn@4.23.0 add <name> -c apps/club` 生成，再按本节改造成 Club 外观并加入 showcase；同一职责不能出现第二个实现。
4. 特殊可视化（如图表）才允许新的样式表，并且必须限定在功能根类下（架构测试会检查）。

### 15.5 开发专用 Showcase
- 位置：`src/app/showcase/page.dev.tsx` → `src/components/showcase/Showcase.tsx`。`pnpm --filter @squirrelapi/club dev` 后打开 `http://127.0.0.1:3001/showcase`。
- `next.config.ts` 只在 `next dev` 时把 `dev.tsx` 加入 `pageExtensions`；`next build` 的静态导出不含此页（已验证 `out/` 中无 showcase）。只用合成数据。

