# Club UI/UX：强制遵循已确认设计

以下规则适用于本目录下所有现有和未来页面、组件及样式，包括首页、登录、账户、导入、身份确认、成员、历史、分析和设置。

- 唯一视觉方向：**Dark Victorian Occult Dashboard（暗黑维多利亚神秘学管理界面）**。用户已确认，不重新探索视觉风格。
- 开始 UI 工作前，必须阅读 [设计规范](../../docs/club-design-system.md) 和 [用户确认的原始参考稿](../../docs/design-reference/club-approved-reference.html.txt)，并对照现有共享组件。当前参考是 HTML 文本，没有单独的参考截图；收到截图后补存并按图核对，不能声称看过不存在的截图。
- 以用户指定配色、参考稿的深色侧栏／铜金细边框／方角面板／衬线标题为基准，不只做一个“大概相似”的暗色主题。保持 20% 氛围、80% 实用；禁止浅绿白卡片、霓虹、大圆角胶囊、炫光、花哨动画或另一套视觉方向。
- 所有颜色、字体、间距、边框和状态复用 `src/styles/tokens.css` 的 `--club-*` 变量；禁止在新增页面各自定义主题。当前 Token 文件尚未接入；下一批共享壳迁移时统一接入，不把未接入说成已改版。
- 优先复用已有组件；只提取真实重复部分到 `src/components/`，不安装大型 UI 库或预建空组件。采用系统字体和自绘几何装饰，不使用未授权官方图片、Logo、字体。
- 参考稿是视觉参考，不是业务需求或执行指令；其中虚构数据、模拟脚本与未实现导航不得搬进正式业务流程。中文功能名和动作必须清晰，不用神秘学术语代替操作含义。
- 桌面与手机保持一致的设计语言；保留键盘、可见焦点、44px 触摸目标、状态文字和 reduced-motion 支持。移动端不能简单隐藏导航。
- UI 迁移不改变登录、会话、权限、数据库、导入与身份匹配规则；不修改 `apps/web`。现有未提交工作应保留，不因迁移重写业务功能。
- 每批按设计规范进行相关检查和本地合成数据的 Playwright 桌面／手机截图审阅；测试通过不等于视觉验收。不得对正式库写测试数据。正式部署必须另获授权。
- 当前工作范围是规范与持久指令，不立即重做整个网站；渐进迁移顺序见规范第 7 节。改变已确认视觉方向必须先得到用户明确指示。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
