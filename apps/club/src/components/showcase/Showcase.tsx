"use client";
// Development-only component showcase (/showcase under `next dev`; never in the production export, see next.config.ts).
// Synthetic content only. Each block shows the typical use first, then variants and pinned states.
import { useState, type ReactNode } from "react";
import { toast } from "../ui/sonner";
import { DotsThreeIcon, GearSixIcon, QuestionIcon, TrashIcon } from "@phosphor-icons/react";
import { PageHeader } from "../layout/PageHeader";
import { PathwayLabel } from "../PathwayLabel";
import { pathways } from "../../lib/pathways";
import { currentTheme, setTheme, themes, type ThemeId } from "../../lib/theme";
import { LoadingSpinner, LoadingState, PageLoader, ProfileSkeleton, TableSkeleton } from "../feedback";
import { Button, ButtonLink } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardDescription, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { NativeSelect, NativeSelectOption } from "../ui/native-select";
import { Checkbox } from "../ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "../ui/field";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "../ui/dialog";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from "../ui/alert-dialog";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from "../ui/empty";

const sections = ["基础", "操作", "输入", "数据", "反馈", "弹层", "导航"];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="m-0 flex scroll-mt-20 flex-col gap-6 border-t border-divider pt-8">
    <h2 className="m-0 text-xl">{title}</h2>{children}
  </section>;
}
function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <div className="flex flex-col gap-3">
    <h3 className="m-0 text-base">{title}</h3>{note && <p className="m-0 text-sm text-muted-foreground">{note}</p>}
    <div className="flex flex-wrap items-start gap-4">{children}</div>
  </div>;
}
/** States are pinned with a caption below; the state name is never inside the component. */
function State({ label, children }: { label: string; children: ReactNode }) {
  return <figure className="m-0 flex flex-col items-start gap-2">{children}<figcaption className="eyebrow">{label}</figcaption></figure>;
}

const colors = [["背景", "bg-background"], ["面板", "bg-card"], ["抬升", "bg-secondary"], ["输入井", "bg-field"], ["悬停", "bg-hover"], ["按下", "bg-pressed"], ["选中", "bg-selected"], ["禁用", "bg-disabled"]];
const accents = [["金色 / 标题", "bg-gold"], ["黄铜 / 强边框", "bg-brass"], ["边框", "bg-border"], ["焦点", "bg-ring"]];
const statuses = [["成功", "success"], ["警告", "warning"], ["错误", "destructive"], ["信息", "info"]] as const;
const rows = [["档案成员一", 72, "观众", 14097], ["档案成员二", 71, "战士", 14000], ["很长很长的档案成员昵称用于检查截断", 70, "—", 0]] as const;

/** Explicit theme choice for checking themes; applies at once and is remembered (src/lib/theme.ts). */
function ThemeSwitch() {
  const [theme, choose] = useState<ThemeId>(currentTheme);
  return <NativeSelect aria-label="主题" className="w-auto" value={theme} onChange={e => { const id = e.target.value as ThemeId; setTheme(id); choose(id); }}>
    {Object.entries(themes).map(([id, t]) => <NativeSelectOption key={id} value={id}>{t.label}</NativeSelectOption>)}
  </NativeSelect>;
}

export function Showcase() {
  const [loading, setLoading] = useState(false);
  const [radio, setRadio] = useState("merge");
  return <main className="club-workspace flex flex-col gap-10">
    <PageHeader eyebrow="DEVELOPMENT ONLY / 组件陈列" title="Club 组件系统" actions={<><ThemeSwitch /><Badge variant="warning">仅本地开发可见</Badge></>} />
    <nav aria-label="陈列分区" className="-mt-6 flex flex-wrap gap-2">{sections.map(s => <a key={s} href={`#${s}`} className="rounded-sm border border-border px-3 py-1 text-sm text-muted-foreground no-underline hover:border-gold hover:text-gold">{s}</a>)}</nav>

    <Section id="基础" title="基础 · Tokens">
      <Block title="途径" note="20px 游戏图标，保留存储名称；未知与缺失值使用中性回退。">{Object.values(pathways).map(({name}) => <PathwayLabel key={name} pathway={name} />)}<PathwayLabel pathway="未知途径" /><PathwayLabel pathway={null} /></Block>
      <Block title="表面" note="均来自 tokens.css 的 --club-*；页面不硬编码颜色。">{colors.map(([name, cls]) => <State key={name} label={name}><span className={`block h-14 w-28 rounded-sm border border-border ${cls}`} /></State>)}</Block>
      <Block title="强调">{accents.map(([name, cls]) => <State key={name} label={name}><span className={`block h-14 w-28 rounded-sm ${cls}`} /></State>)}</Block>
      <Block title="状态色（前景 / 背景成对使用）">{statuses.map(([name, v]) => <Badge key={v} variant={v}>{name}</Badge>)}</Block>
      <Block title="字体">
        <div className="flex flex-col gap-2"><p className="eyebrow">THE ARCHIVES · 小标 10–12px 字距</p><h1 className="gold-title m-0 text-title">金色衬线标题 Georgia</h1><h2 className="m-0 text-xl">二级标题</h2><p className="m-0">正文使用系统无衬线字体，行高 1.6。</p><p className="m-0 text-sm text-muted-foreground">次要说明文字。</p><code className="font-mono text-sm text-gold">{`{"schema_version":1}`}</code></div>
      </Block>
      <Block title="面板" note="方角、细铜边；ornate 加 ◆ 角饰和灯光渐变，每页只用于 1–2 个重点面板。">
        <Card className="w-72"><CardTitle>普通面板</CardTitle><CardDescription>默认的数据容器。</CardDescription></Card>
        <Card ornate className="w-72"><CardTitle>Ornate 面板</CardTitle><CardDescription>登录、关键统计等重点区域。</CardDescription></Card>
      </Block>
    </Section>

    <Section id="操作" title="操作 · Button / ButtonLink / Badge">
      <Block title="变体" note="Primary 为页面主操作；Secondary 次要；Destructive 只用于删除/放弃；Ghost 用于行内轻操作。">
        <Button>保存名称</Button><Button variant="secondary">更早日期</Button><Button variant="destructive"><TrashIcon />删除当天数据</Button><Button variant="ghost">稍后处理</Button><ButtonLink href="/showcase">导航用 ButtonLink</ButtonLink>
      </Block>
      <Block title="尺寸"><Button>默认 44px</Button><Button size="compact">紧凑</Button><Button size="icon" aria-label="设置"><GearSixIcon /></Button></Block>
      <Block title="状态" note="悬停/按下仅鼠标；触屏点按不会残留悬停色。加载时保持宽度、禁用并标 aria-busy。">
        <State label="默认"><Button>确认导入</Button></State>
        <State label="选中（aria-pressed）"><Button variant="secondary" aria-pressed>新增玩家</Button></State>
        <State label="禁用"><Button disabled>确认导入</Button></State>
        <State label="加载"><Button loading loadingText="正在保存…">确认导入</Button></State>
        <State label="点击试试"><Button loading={loading} loadingText="正在保存…" onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1200); }}>模拟保存</Button></State>
      </Block>
    </Section>

    <Section id="输入" title="输入 · Field / Input / Select / Checkbox / Radio">
      <FieldGroup>
        <Field><FieldLabel htmlFor="sc-name">俱乐部名称</FieldLabel><Input id="sc-name" placeholder="灰雾档案馆" /><FieldDescription>保存后，各设备读取同一个名称。</FieldDescription></Field>
        <Field><FieldLabel htmlFor="sc-error">邮箱</FieldLabel><Input id="sc-error" aria-invalid defaultValue="not-an-email" /><FieldError>邮箱、密码不正确</FieldError></Field>
        <Field><FieldLabel htmlFor="sc-disabled">禁用</FieldLabel><Input id="sc-disabled" disabled defaultValue="仅公会长可以修改" /></Field>
        <Field><FieldLabel htmlFor="sc-select">查看日期（原生 select，支持时为主题化弹出列表）</FieldLabel><NativeSelect id="sc-select"><NativeSelectOption>最新一天</NativeSelectOption><NativeSelectOption>2026-10-27</NativeSelectOption><NativeSelectOption>2026-10-26</NativeSelectOption></NativeSelect></Field>
        <Field><FieldLabel htmlFor="sc-json">JSON 内容</FieldLabel><Textarea id="sc-json" rows={4} placeholder="把 AI 的识别结果粘贴到这里" /></Field>
        <Field orientation="horizontal"><Checkbox id="sc-check" defaultChecked /><FieldLabel htmlFor="sc-check">我已核对名单，确认日期、成员身份和数据无误。</FieldLabel></Field>
        <Field orientation="horizontal"><Checkbox id="sc-check-off" disabled /><FieldLabel htmlFor="sc-check-off">完整名单，没有漏人（禁用）</FieldLabel></Field>
        <FieldSet><FieldLegend>这天已有数据，怎么更新？</FieldLegend>
          <RadioGroup value={radio} onValueChange={setRadio}>{[["merge", "只补充／修正部分玩家"], ["replace", "重新导入整份名单"]].map(([v, l]) => <Field key={v} orientation="horizontal"><RadioGroupItem id={`sc-${v}`} value={v} /><FieldLabel htmlFor={`sc-${v}`}>{l}</FieldLabel></Field>)}</RadioGroup>
        </FieldSet>
      </FieldGroup>
    </Section>

    <Section id="数据" title="数据 · Table / Tabs / Collapsible / Separator">
      <Table><TableCaption>当天保存的数据 · — 表示未识别</TableCaption><TableHeader><TableRow><TableHead>昵称</TableHead><TableHead>等级</TableHead><TableHead>途径</TableHead><TableHead>非凡评分</TableHead><TableHead>状态</TableHead></TableRow></TableHeader>
        <TableBody>{rows.map(([n, l, p, s], i) => <TableRow key={n}><TableCell className="max-w-48 truncate font-medium text-gold">{n}</TableCell><TableCell>{l}</TableCell><TableCell>{p}</TableCell><TableCell>{s}</TableCell><TableCell><Badge variant={i === 2 ? "destructive" : "success"}>{i === 2 ? "暂时离会" : "在会"}</Badge></TableCell></TableRow>)}</TableBody></Table>
      <Tabs defaultValue="paste" className="flex flex-col gap-4"><TabsList aria-label="导入方式"><TabsTrigger value="paste">粘贴内容</TabsTrigger><TabsTrigger value="file">上传文件</TabsTrigger></TabsList>
        <TabsContent value="paste"><Textarea aria-label="JSON 内容示例" rows={3} placeholder="粘贴 JSON" /></TabsContent><TabsContent value="file"><Input aria-label="JSON 文件示例" type="file" /></TabsContent></Tabs>
      <Collapsible className="rounded-sm border border-border bg-card"><CollapsibleTrigger>3 人已自动对上</CollapsibleTrigger><CollapsibleContent className="flex flex-col gap-2 px-4 pb-4">{rows.map(([n]) => <p key={n} className="m-0 text-sm">{n}</p>)}</CollapsibleContent></Collapsible>
      <Separator />
    </Section>

    <Section id="反馈" title="反馈 · Loading / Skeleton / Empty / Error / Toast">
      <Block title="加载"><LoadingSpinner label="正在读取" /><Skeleton className="w-40" /><Button variant="secondary" onClick={() => toast.success("AI识别提示词已复制")}>显示 Toast</Button><Button variant="secondary" onClick={() => toast.error("复制失败，请手动复制")}>错误 Toast</Button></Block>
      <div className="grid gap-6 md:grid-cols-2"><PageLoader delayMs={0} title="正在读取档案…" /><TableSkeleton rows={3} columns={4} label="正在读取示例…" /></div>
      <ProfileSkeleton label="正在读取示例档案…" />
      <div className="grid gap-6 md:grid-cols-2">
        <LoadingState status="empty" title="还没有保存记录" detail="导入第一份数据后，就能在这里查看。" action={<ButtonLink href="/showcase">导入数据</ButtonLink>} />
        <LoadingState status="error" detail="暂时无法读取记录，请重试。" onRetry={() => toast("已重试（示例）")} />
      </div>
      <Empty><EmptyMedia>✓</EmptyMedia><EmptyTitle>今天的记录，保存好了。</EmptyTitle><EmptyDescription>Empty 组件可直接组合标题、说明和操作。</EmptyDescription><EmptyContent><Button>开始另一批导入</Button></EmptyContent></Empty>
    </Section>

    <Section id="弹层" title="弹层 · Dialog / AlertDialog / Sheet / Popover / DropdownMenu / Tooltip">
      <Block title="触发后观察进入与退出过渡；Esc、遮罩、Tab 循环和焦点归还由 Radix 处理。">
        <Dialog><DialogTrigger asChild><Button variant="secondary">打开 Dialog</Button></DialogTrigger><DialogContent showCloseButton>
          <DialogHeader><DialogTitle>这是新玩家，还是已有玩家？</DialogTitle><DialogDescription>Dialog 用于需要输入或选择的流程。</DialogDescription></DialogHeader>
          <Field><FieldLabel htmlFor="sc-dialog">已有玩家</FieldLabel><Input id="sc-dialog" placeholder="搜索名字" /></Field>
          <DialogFooter><DialogClose asChild><Button variant="ghost">稍后处理</Button></DialogClose><DialogClose asChild><Button>确认</Button></DialogClose></DialogFooter></DialogContent></Dialog>
        <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive">打开 AlertDialog</Button></AlertDialogTrigger><AlertDialogContent>
          <AlertDialogTitle>要放弃这次核对吗？</AlertDialogTitle><AlertDialogDescription>点击遮罩不会关闭；必须明确选择。</AlertDialogDescription>
          <AlertDialogFooter><AlertDialogCancel asChild><Button>继续核对</Button></AlertDialogCancel><AlertDialogCancel asChild><Button variant="destructive">确认放弃</Button></AlertDialogCancel></AlertDialogFooter></AlertDialogContent></AlertDialog>
        <Sheet><SheetTrigger asChild><Button variant="secondary">打开 Sheet</Button></SheetTrigger><SheetContent aria-describedby={undefined}><SheetHeader><SheetTitle>俱乐部导航</SheetTitle><SheetClose asChild><Button variant="secondary" size="icon" aria-label="关闭菜单">×</Button></SheetClose></SheetHeader><p className="m-0 px-4 text-sm text-muted-foreground">手机导航使用同一个 Sheet。</p></SheetContent></Sheet>
        <Popover><PopoverTrigger asChild><Button variant="secondary" size="icon" aria-label="查看说明"><QuestionIcon /></Button></PopoverTrigger><PopoverContent><h3 className="m-0 mb-2 text-base">怎么导入？</h3><p className="m-0 text-sm text-muted-foreground">Popover 用于贴近触发点的帮助或短表单。</p></PopoverContent></Popover>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="secondary" size="icon" aria-label="更多操作"><DotsThreeIcon /></Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuLabel>示例操作</DropdownMenuLabel><DropdownMenuItem>查看历史</DropdownMenuItem><DropdownMenuItem disabled>导出（禁用）</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive"><TrashIcon />删除</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
        <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="设置"><GearSixIcon /></Button></TooltipTrigger><TooltipContent>设置</TooltipContent></Tooltip>
      </Block>
    </Section>

    <Section id="导航" title="导航 · AppShell / PageHeader">
      <p className="m-0 text-sm text-muted-foreground">左侧栏（≥1024px）与手机菜单 Sheet 都来自 src/lib/navigation.ts；当前页使用金色左边线与渐变。本页头部即 PageHeader。</p>
    </Section>
  </main>;
}
