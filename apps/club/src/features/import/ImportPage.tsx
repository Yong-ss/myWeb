"use client";
import {PathwayLabel} from "../../components/PathwayLabel";
import {clubApi} from "../../lib/data-access";
import Link from "next/link";
import {cn} from "cn";
import {AnimatePresence,motion} from "motion/react";
import {toast} from "../../components/ui/sonner";
import {ImportStepper,PromptBar} from "../../components/ImportSteps";
import {PageLoader,LoadingState} from "../../components/feedback";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { Checkbox } from "../../components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { Badge } from "../../components/ui/badge";
import { Card, CardTitle } from "../../components/ui/card";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "../../components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "../../components/ui/alert-dialog";
import { Reveal, useMotionKind } from "../../components/ui/motion";
import { useEffect, useState } from "react";
import { fields, numericFields, validDate } from "../../domain/member";
import { parseSource, mergePreview, MAX_SOURCE_BYTES, type ImportContext, type ConfirmedMember } from "./contract";
import { labels, beijingToday, fieldValue, confirmedMembers, absenceReview, readableError, type Row, type AbsenceChoice } from "./workflow";
import { matchPlayers, type Match } from "./identity";
import { IdentityDialog, type IdentityChoice } from "./IdentityDialog";
import { extractionPrompt } from "./prompt";
import {useClubHref} from "../../lib/useClub";

// A selectable card: the whole label is the click target, the brass edge marks the chosen option.
const optionCard = "flex cursor-pointer items-start gap-3 rounded-sm border border-border bg-field p-4 transition-[border-color,background-color] ease-club-feedback hover:border-gold has-[[data-state=checked]]:border-gold has-[[data-state=checked]]:bg-selected has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ring";

export function ImportPage() {
  const href=useClubHref();
  const [raw, setRaw] = useState("");
  const [absenceReasons,setAbsenceReasons]=useState<Record<string,string>>({});
  const [absenceChoices,setAbsenceChoices]=useState<Record<string,AbsenceChoice>>({});
  const [inputMode, setInputMode] = useState<"file" | "paste">("paste");
  const [original, setOriginal] = useState<string | null>(null);
  const [date, setDate] = useState(beijingToday);
  const [context, setContext] = useState<ImportContext | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"merge" | "replace" | "">("");
  const [complete, setComplete] = useState(false);
  const [review, setReview] = useState<ConfirmedMember[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState("");
  const [notice_, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [revoke, setRevoke] = useState("");
  const [discard, setDiscard] = useState(false);
  const [removed, setRemoved] = useState<{ row: Row; index: number } | null>(null);
  const [identityIndex, setIdentityIndex] = useState<number | null>(null);
  const listItem = useMotionKind("listItem");
  useEffect(() => {
    if (error || review || saved) document.getElementById(error ? "import-feedback" : saved ? "import-success" : "final-review")?.focus();
  }, [error, review, saved]);
  const matches = context ? matchPlayers(rows.map(r => r.member), context.players, { ...context, aliases: [...(context.aliases ?? []), ...rows.filter(r => r.remember && r.identity && r.identity !== "new" && r.sourceName).map((r,i) => ({ id: `pending-${i}`, player_id: r.identity, alias_name: r.sourceName! }))] }, date) : [];
  const pending = rows.filter(r => !r.identity).length;
  const {missing,pending:missingPending,completeAllowed,decisions:absenceDecisions}=absenceReview(context,rows,mode,absenceChoices,absenceReasons);
  const newCount = rows.filter(r => r.identity === "new").length;
  const bulkNewCount = rows.filter((r,i) => !r.identity && matches[i].tier === "D" && r.member.name && !matches[i].reasons.length).length;
  const openIdentity = (index: number) => setIdentityIndex(index);
  function confirmIdentity(index: number, { identity, remember, correction }: IdentityChoice) {
    setRows(rows.map((r,i) => i === index ? { ...r, identity, manual: true, remember, correction, member: correction ? {...r.member,name:correction.name} : r.member } : r));
    invalidate();
    // Continue with the next unresolved row, as before.
    const next = rows.findIndex((r,i) => i !== index && !r.identity);
    setIdentityIndex(next >= 0 ? next : null);
  }
  function invalidate() { setReview(null); setConfirmed(false); setRequestId(""); setError(""); }
  const members = () => confirmedMembers(rows);
  function choose(i: number, identity: string) { setRows(rows.map((r,j) => j === i ? { ...r, identity, manual: true, remember: false, correction:undefined } : r)); invalidate(); }
  const api = (path: string, body?: unknown) => clubApi(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  async function prepare() {
    setError(""); setNotice(""); setBusy(true);
    if (original === null && raw.trim() && new TextEncoder().encode(raw).length <= MAX_SOURCE_BYTES) setOriginal(raw);
    try {
      if (!validDate(date)) throw Error("请填写实际截图日期");
      const parsed = parseSource(raw);
      const data: ImportContext = await api(`/api/import-context?date=${date}&review_absences=1`);
      const matched = matchPlayers(parsed.members, data.players, data, date);
      setContext(data); setRows(parsed.members.map((member,i) => ({ uid: i, member, identity: matched[i].identity, manual: false, sourceName: typeof member.name === "string" ? member.name : null, remember: false, needsReview: !matched[i].identity })));
      setMode(data.snapshot ? "" : "replace"); setComplete(false); invalidate();
      setIdentityIndex(null);setAbsenceChoices({});setAbsenceReasons({});
    } catch (e) { setError(e instanceof Error ? e.message : "准备失败"); }
    finally { setBusy(false); }
  }
  function finalPreview() {
    try {
      if (!context || !mode) throw Error("请选择同日数据的处理方式");
      if (rows.some((r,i) => !r.manual && (!matches[i].identity || matches[i].identity !== r.identity))) throw Error("匹配结果需要重新确认，请手动选择有异常的玩家");
      if(missingPending)throw Error("请先选择缺席成员的状态；暂离须填写理由，也可以先选待确认");
      if(!completeAllowed)setComplete(false);
      const list = mergePreview(context.members, members(), mode);
      if (list.length > 200) throw Error("最终名单超过 200 人");
      setReview(list); setConfirmed(false); setRequestId(crypto.randomUUID()); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "请检查预览"); }
  }
  async function save() {
    if (!confirmed || !review || !context || !mode) return;
    setBusy(true); setError("");
    try {
      const result = await api("/api/imports", { raw_text: original ?? raw, snapshot_date: date, is_complete_roster: complete&&completeAllowed, ...(context.absence_context?{absence_decisions:absenceDecisions,baseline_snapshot_id:context.absence_context.snapshot?.id??null}:{}), mode, members: members(), request_id: requestId, expected_snapshot_id: context.snapshot?.id ?? null, confirmed: true });
      setSaved(true); setNotice(result.unchanged ? `与当前第 ${result.revision} 版相同，没有重复写入。` : `已保存 ${date} 第 ${result.revision} 版${result.replayed ? "（先前提交已成功，没有重复写入）" : "，旧版本已保留"}。`);
    } catch (e) { setError(e instanceof TypeError ? "连接失败，你的核对结果还在。请检查网络后再次点击确认导入，不会重复保存。" : e instanceof Error ? e.message : "暂时没能保存，请重试；你的核对结果还在。"); }
    finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!/\.json$/i.test(file.name) || file.size > MAX_SOURCE_BYTES) { setError("请选择不超过 128 KiB 的 .json 文件"); return; }
    try { setRaw(await file.text()); setOriginal(null); invalidate(); setNotice(""); toast.success(`已读入「${file.name}」`, { description: "填写截图日期后即可继续。" }); } catch { setError("没能读到这个文件，请重新选择，或把 JSON 直接粘贴到下方。"); }
  }
  function reset() { setContext(null); setRows([]); setRaw(""); setOriginal(null); setDate(beijingToday()); setComplete(false); setMode(""); setSaved(false); setNotice(""); setDiscard(false); setRemoved(null); setIdentityIndex(null); invalidate(); }
  async function removeAlias(id: string) {
    setBusy(true); setError("");
    try {
      await api("/api/player-aliases", { revoke_id: id, confirmed: true });
      const next: ImportContext = await api(`/api/import-context?date=${date}&review_absences=1`);
      const nextMatches = matchPlayers(rows.map(r => r.member), next.players, next, date);
      setContext(next); setRows(rows.map((r,i) => r.manual ? r : { ...r, identity: nextMatches[i].identity })); setRevoke(""); invalidate(); setNotice("别名关联已解除；历史快照保留，受影响的自动匹配已重新检查。");
    } catch(e) { setError(e instanceof Error ? e.message : "解除失败"); }
    finally { setBusy(false); }
  }
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(extractionPrompt); toast.success("AI识别提示词已复制"); }
    catch { setError("复制失败，请展开帮助里的完整提示词手动复制。"); }
  }
  function editRow(r: Row, i: number, match: Match) {
    const selected = context?.players.find(p => p.id === r.identity);
    const options = match.candidates.slice(0,3);
    const otherPlayers = context?.players.filter(p => !r.search || p.display_name.includes(r.search) || p.id === r.identity) ?? [];
    return <Collapsible className="identity-row identity-compact rounded-sm border border-border bg-card" key={r.uid ?? i}>
      <CollapsibleTrigger className="identity-summary min-h-14 flex-wrap gap-3 px-5 py-3 text-foreground"><span className="text-xs text-muted-foreground">本次识别</span><strong className="font-medium">{r.member.name ?? "昵称没看清"}</strong><Badge variant={r.identity ? "success" : "warning"}>{r.identity ? "已对上" : "选择对应玩家"}</Badge>{r.identity && <span className="text-sm text-muted-foreground">{r.identity === "new" ? "新增玩家" : selected?.display_name}</span>}</CollapsibleTrigger>
      <CollapsibleContent className="identity-body flex flex-col gap-3 border-t border-border px-5 pt-3 pb-4">
      {!r.identity ? <><p className="m-0 text-sm text-muted-foreground">{options.length ? "选对应的已有玩家" : "没找到相似名字，可以搜索已有玩家或新增。"}</p><div className="grid gap-2">{options.map((p,j) => <Button key={p.id} variant="secondary" className="w-full flex-wrap justify-between text-left whitespace-normal" onClick={() => choose(i,p.id)}><span className="mr-auto"><strong className="font-medium">{p.label}</strong>{context!.players.filter(x => x.display_name === p.label).length > 1 && <small className="block text-muted-foreground">编号 {p.id.slice(-8)}</small>}</span><Badge>{j === 0 && options.length === 1 ? "推荐 · " : ""}{p.reasons[0]}</Badge><span aria-hidden="true">选择 →</span></Button>)}</div></> : <p className="m-0 flex flex-wrap items-center gap-3 rounded-sm bg-success-bg px-3 py-2 text-sm text-success"><span aria-hidden="true">✓</span>{r.identity === "new" ? `新增玩家：${r.member.name}` : `已选：${selected?.display_name}`}<Button variant="ghost" size="compact" onClick={() => choose(i,"")}>重新选择</Button></p>}
      {r.manual && selected && r.sourceName && r.sourceName.trim() !== selected.display_name.trim() && <Field orientation="horizontal" className="rounded-sm border border-border p-3 text-sm"><Checkbox id={`alias-${i}`} aria-label={`记住第 ${i+1} 行原始昵称`} checked={r.remember} onCheckedChange={v => { setRows(rows.map((x,j) => j === i ? { ...x, remember: v === true } : x)); invalidate(); }} /><FieldLabel htmlFor={`alias-${i}`}>记住AI错名「{r.sourceName}」，下次自动匹配到「{selected.display_name}」</FieldLabel></Field>}
      <Collapsible><CollapsibleTrigger>{r.identity ? "改选其他玩家" : "选择其他玩家 / 新增"}</CollapsibleTrigger><CollapsibleContent className="grid gap-3 pt-2">
        <Field><FieldLabel htmlFor={`search-${i}`}>搜索名字</FieldLabel><Input id={`search-${i}`} aria-label={`搜索第 ${i+1} 条玩家`} placeholder="输入正确昵称" value={r.search ?? ""} onChange={e => setRows(rows.map((x,j) => j === i ? { ...x, search: e.target.value } : x))} /></Field>
        <Field><FieldLabel htmlFor={`identity-${i}`}>选择玩家</FieldLabel><NativeSelect id={`identity-${i}`} aria-label={`第 ${i+1} 行玩家身份`} value={r.identity} onChange={e => choose(i,e.target.value)}><NativeSelectOption value="">请选择</NativeSelectOption><NativeSelectOption value="new">新增玩家（确认不是已有玩家）</NativeSelectOption>{otherPlayers.map(p => <NativeSelectOption key={p.id} value={p.id}>{p.display_name}（{p.id.slice(-8)}）</NativeSelectOption>)}</NativeSelect></Field>
      </CollapsibleContent></Collapsible>
      <Collapsible><CollapsibleTrigger>更多操作</CollapsibleTrigger><CollapsibleContent className="flex flex-col gap-3 pt-2">
        {match.reasons.map(reason => <p className="m-0 text-sm text-muted-foreground" key={reason}>{reason}</p>)}
        {r.identity === "new" && match.candidates.length > 0 && <Notice variant="warning" className="text-warning">请确认不是上面的已有玩家，避免重复建档。</Notice>}
        <Collapsible><CollapsibleTrigger>修正第 {i+1} 行数据</CollapsibleTrigger><CollapsibleContent className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 pt-2">{fields.map(k => <Field key={k}><FieldLabel htmlFor={`field-${i}-${k}`}>{labels[k]}</FieldLabel><Input id={`field-${i}-${k}`} aria-label={`第 ${i+1} 行${labels[k]}`} value={r.member[k] ?? ""} placeholder="null" inputMode={(numericFields as readonly string[]).includes(k) ? "numeric" : "text"} onChange={e => { const value=fieldValue(k,e.target.value); setRows(rows.map((x,j) => j === i ? { ...x, member: { ...x.member, [k]: value }, ...(k === "name" ? { identity: "", manual: false, remember: false } : {}) } : x)); invalidate(); }} /></Field>)}</CollapsibleContent></Collapsible>
        <Button variant="ghost" size="compact" className="self-start text-destructive" onClick={() => { setRemoved({ row: r, index: i }); setRows(rows.filter((_,j) => j !== i)); invalidate(); }}>移除此行</Button>
      </CollapsibleContent></Collapsible>
      </CollapsibleContent>
    </Collapsible>;
  }
  const step = saved ? 3 : review ? 2 : context ? 1 : 0;
  return <main className="club-workspace club-import flex flex-col gap-4">
    <PageHeader eyebrow="03 / DAILY RECORD" title={saved ? "导入完成" : review ? "确认保存" : context ? "核对成员" : "导入每日数据"} />
    {!context && !saved && <p className="m-0 -mt-4 text-sm text-muted-foreground">上传识别结果，再核对名单。</p>}
    {context && !review && !saved && <p className="m-0 -mt-4 text-sm text-muted-foreground">把识别结果对上已有玩家，避免重复新增。点开下面的名字，选已有玩家或新增。</p>}
    <ImportStepper steps={["准备数据", "核对成员", "确认保存"]} step={step} />
    {!context && !saved && <PromptBar prompt={extractionPrompt} onCopy={() => void copyPrompt()} howTo={<><li>复制AI识别提示词，粘贴给 AI。</li><li>上传游戏成员截图。</li><li>把 AI 返回的 JSON 粘贴或上传到这里。</li></>} />}
    <Notice variant="success" role={saved?undefined:"status"} className="empty:hidden">{saved?"":notice_}</Notice><Notice variant="destructive" id="import-feedback" tabIndex={-1} role="alert" className="empty:hidden">{readableError(error)}</Notice>
    {saved ? <Reveal as="section" className="m-0" id="import-success" tabIndex={-1}><LoadingState status="ready" title="今天的记录，保存好了。" detail={`${notice_} 可以放心离开这个页面，或继续导入其他日期的数据。`} action={<><Button onClick={reset}>开始另一批导入</Button><Link className="text-gold" href={href("/account")}>回到工作台</Link></>}/></Reveal> : <fieldset className="club-import-busy relative m-0 min-w-0 border-0 p-0" disabled={busy} aria-busy={busy}>
      {busy && <PageLoader className="club-import-processing invisible absolute inset-0 z-20 min-h-0 data-[visible=true]:visible data-[visible=true]:bg-[color-mix(in_srgb,var(--club-bg)_96%,transparent)] max-sm:min-h-0" title={review ? "正在保存记录…" : "正在读取数据…"} detail="请稍候，不要重复提交。" />}
      {!context ? <Card className="input-panel items-stretch gap-5">
        <Field className="max-w-60"><FieldLabel htmlFor="date">截图日期</FieldLabel><Input id="date" type="date" min="2000-01-01" max="2100-12-31" value={date} onChange={e => setDate(e.target.value)} /></Field>
        <Tabs value={inputMode} onValueChange={v => setInputMode(v as "file" | "paste")} className="flex flex-col gap-4">
          <TabsList aria-label="导入方式"><TabsTrigger value="paste">粘贴内容</TabsTrigger><TabsTrigger value="file">上传文件</TabsTrigger></TabsList>
          <TabsContent value="paste"><Field><FieldLabel htmlFor="raw">JSON 内容</FieldLabel><Textarea id="raw" rows={9} placeholder="把 AI 的识别结果粘贴到这里" value={raw} onChange={e => setRaw(e.target.value)} spellCheck={false} /></Field></TabsContent>
          <TabsContent value="file"><Field><FieldLabel htmlFor="file">JSON 文件</FieldLabel><Input id="file" type="file" accept=".json,application/json" onChange={e => void upload(e.target.files?.[0])} /><FieldDescription>不超过 128 KiB 的 .json 文件。</FieldDescription></Field></TabsContent>
        </Tabs>
        <Button className="self-start" loading={busy} loadingText="正在读取…" onClick={() => void prepare()}>下一步</Button>
      </Card> : <>
        <div hidden={!!review} className="review-workspace mx-auto max-w-205">
        <div className="flex flex-wrap items-center gap-4 pb-4 text-sm text-muted-foreground"><span>{date} · {rows.length} 人</span>{newCount > 0 && <span>新增 {newCount} 人</span>}<Badge variant={pending ? "warning" : "success"} className="ml-auto px-3 py-1 text-sm">{pending ? `还有 ${pending} 人没对上` : "全部已对上"}</Badge></div>
        <div className="flex flex-col gap-3">
        {context.baseline && rows.length < context.baseline.count && <Notice variant="warning" className="text-warning">比上次少 {context.baseline.count - rows.length} 人，请检查是否漏图。</Notice>}
        {bulkNewCount > 0 && <Button variant="secondary" className="self-start" onClick={() => { setRows(rows.map((r,i) => !r.identity && matches[i].tier === "D" && r.member.name && !matches[i].reasons.length ? { ...r, identity: "new", manual: true } : r)); invalidate(); }}>确认这 {bulkNewCount} 人是新玩家</Button>}
        {removed && <Notice as="div" className="flex animate-[club-rise-in_220ms_var(--club-ease-enter)] flex-wrap items-center gap-3">已移除「{removed.row.member.name ?? "未识别昵称"}」。<Button variant="secondary" size="compact" onClick={() => { setRows([...rows.slice(0,removed.index),removed.row,...rows.slice(removed.index)]); setRemoved(null); invalidate(); }}>撤销移除</Button></Notice>}
        {context.snapshot && <FieldSet className="rounded-sm border border-border bg-card p-4"><FieldLegend className="float-left mb-0 w-full">这天已有数据，怎么更新？</FieldLegend>
          <RadioGroup value={mode} onValueChange={value => { setMode(value as "merge" | "replace"); invalidate(); }} className="grid-cols-2 max-sm:grid-cols-1">{([
          ["merge", "只补充／修正部分玩家", "只更新本次玩家，其他人保留。当天名单人数不会减少。"],
          ["replace", "重新导入整份名单", "当天名单以本次为准。没导入的人不再显示在当天名单中。"],
        ] as const).map(([value, title, description]) => <label key={value} className={optionCard}><RadioGroupItem value={value} className="mt-0.5" /><span><strong className="block text-sm font-medium text-foreground">{title}</strong><small className="mt-1 block text-xs leading-relaxed text-muted-foreground">{description}</small></span></label>)}</RadioGroup>
          <FieldDescription className="text-xs">两种方式都会保留旧版本，不删除历史记录。</FieldDescription></FieldSet>}
        <section className="pending-list m-0 flex flex-col"><AnimatePresence initial={false}>{rows.map((r,i) => r.needsReview || !r.identity ? <motion.div key={r.uid ?? i} className="overflow-hidden" {...listItem}><div className="pb-2"><Button variant="secondary" className="identity-launcher min-h-14 w-full justify-between px-5 text-left text-foreground" onClick={() => openIdentity(i)}><strong className="mr-auto font-medium [overflow-wrap:anywhere]">{r.member.name ?? "昵称没看清"}</strong><Badge variant={r.identity ? "success" : "warning"}>{r.identity ? r.identity === "new" ? "新增玩家" : `已选：${context.players.find(p => p.id === r.identity)?.display_name}` : "选择玩家"}</Badge><span aria-hidden="true" className="text-gold">›</span></Button></div></motion.div> : null)}</AnimatePresence></section>
        {rows.some(r => !r.needsReview && r.identity) && <Collapsible className="matched-list"><CollapsibleTrigger>{rows.filter(r => !r.needsReview && r.identity).length} 人已自动对上</CollapsibleTrigger><CollapsibleContent className="grid gap-2 pt-2">{rows.map((r,i) => !r.needsReview && r.identity ? editRow(r,i,matches[i]) : null)}</CollapsibleContent></Collapsible>}
        {pending===0&&mode&&missing.length>0&&<Card className="absence-review items-stretch" aria-labelledby="absence-heading"><CardTitle id="absence-heading">核对缺席成员 · {missing.length} 人</CardTitle><p className="m-0 text-sm text-muted-foreground">{context.absence_context?.snapshot?.snapshot_date} 有记录，本次未出现。</p>{missingPending>0&&<Button variant="secondary" className="self-start" onClick={()=>{setAbsenceChoices(old=>({...old,...Object.fromEntries(missing.filter(p=>!old[p.player_id]).map(p=>[p.player_id,"uncertain" as const]))}));setComplete(false);invalidate();}}>其余待确认</Button>}
          {missing.map(p=><FieldSet className="absence-person rounded-sm border border-border p-4" key={p.player_id}><FieldLegend className="float-left w-full text-gold">{p.name}</FieldLegend>
            <RadioGroup value={absenceChoices[p.player_id]??""} onValueChange={value=>{setAbsenceChoices(old=>({...old,[p.player_id]:value as AbsenceChoice}));setComplete(false);invalidate();}} className="flex flex-wrap">{([["left","确认退会"],["temporary","暂离"],["uncertain","不确定，稍后确认"]] as const).map(([value,label])=><label key={value} className={cn(optionCard,"items-center p-3 text-sm")}><RadioGroupItem value={value}/>{label}</label>)}</RadioGroup>{absenceChoices[p.player_id]==="temporary"&&<Field><FieldLabel htmlFor={`absence-reason-${p.player_id}`}>暂离理由</FieldLabel><Input id={`absence-reason-${p.player_id}`} maxLength={500} required value={absenceReasons[p.player_id]??""} onChange={e=>{setAbsenceReasons(old=>({...old,[p.player_id]:e.target.value}));invalidate();}} /></Field>}</FieldSet>)}</Card>}
        <Collapsible className="review-settings"><CollapsibleTrigger>更多设置</CollapsibleTrigger><CollapsibleContent className="flex flex-col gap-3 pt-2">{(context.aliases?.length ?? 0) > 0 && <Collapsible><CollapsibleTrigger>已记住的名字（{context.aliases?.length}）</CollapsibleTrigger><CollapsibleContent className="grid gap-2 pt-2">{context.aliases?.map(a => <p key={a.id} className="m-0 flex flex-wrap items-center gap-3 text-sm">{a.alias_name} → {context.players.find(p => p.id === a.player_id)?.display_name} {revoke === a.id ? <><Button size="compact" variant="destructive" onClick={() => void removeAlias(a.id)}>确认解除此别名</Button><Button size="compact" variant="secondary" onClick={() => setRevoke("")}>取消</Button></> : <Button size="compact" variant="secondary" onClick={() => setRevoke(a.id)}>解除错误关联</Button>}</p>)}</CollapsibleContent></Collapsible>}<Button variant="ghost" size="compact" className="self-start text-destructive" onClick={() => setDiscard(true)}>放弃本批并重新开始</Button></CollapsibleContent></Collapsible>
        </div>
        <div className="mt-5 flex justify-end border-t border-border pt-6"><Button className="min-w-37.5" disabled={pending > 0 || !mode || missingPending>0} onClick={finalPreview}>下一步 →</Button></div>
        </div>
        {review && <Reveal as="section" className="m-0 flex flex-col items-stretch gap-4 rounded-sm border border-border bg-card p-6 outline-none max-md:p-4" id="final-review" tabIndex={-1}>
          <Button variant="ghost" size="compact" className="self-start" onClick={invalidate}>← 返回核对，继续修改</Button><h2 className="m-0 text-xl">最终预览 · {review.length} 人</h2>
          <p className="match-summary ornate m-0 rounded-sm border border-border p-4 font-heading text-lg text-gold">新增 {review.filter(r => r.player_id === null).length} 人 · 既有 {review.filter(r => r.player_id !== null).length} 人 · 待确认 0 人</p>
          <p className="m-0 text-sm leading-relaxed">{complete ? "已人工确认完整名单。" : "本次未确认完整，仅记录明确确认的退会。"}{mode === "replace" ? "本次保存这份名单，之前的版本仍会保留。" : "保留此前未提交的玩家，更新本次核对的记录。"}</p>
          {missing.length>0&&<ul className="absence-preview m-0 grid gap-1 pl-5 text-sm">{missing.map(p=><li key={p.player_id}>{p.name} · {absenceChoices[p.player_id]==="left"?"已确认退会":absenceChoices[p.player_id]==="temporary"?`暂离 · ${absenceReasons[p.player_id]??""}`:"待确认"}</li>)}</ul>}
          <ul className="nickname-review m-0 grid gap-1 pl-5 text-sm empty:hidden">{rows.filter(r=>r.correction).map(r=><li key={r.identity}>更正昵称：{r.correction!.expected} → {r.correction!.name}</li>)}</ul>
          <Table containerClassName="table-scroll max-h-130 overflow-y-auto"><TableHeader><TableRow><TableHead className="sticky top-0">正式身份</TableHead><TableHead className="sticky top-0">AI 原始昵称</TableHead>{fields.map(k => <TableHead key={k} className="sticky top-0">{labels[k]}</TableHead>)}</TableRow></TableHeader><TableBody>{review.map((r,i) => <TableRow key={i}><TableCell className="text-gold">{r.player_id ? `${context.players.find(p => p.id === r.player_id)?.display_name ?? "既有玩家"}（${r.player_id.slice(-8)}）` : "人工确认的新玩家"}</TableCell><TableCell>{r.source_name === undefined ? "旧记录未单列；原始 JSON 已保留" : r.source_name ?? "null"}</TableCell>{fields.map(k => <TableCell key={k}>{k === "pathway" ? <PathwayLabel pathway={r[k]} missingText="null" /> : r[k] ?? "null"}</TableCell>)}</TableRow>)}</TableBody></Table>
          <Field orientation="horizontal" className="rounded-sm border border-border bg-field p-4"><Checkbox id="complete-roster" disabled={!completeAllowed} checked={complete&&completeAllowed} onCheckedChange={v => { setComplete(v === true); setConfirmed(false); setRequestId(crypto.randomUUID()); setError(""); }} /><FieldLabel htmlFor="complete-roster">完整名单，没有漏人</FieldLabel></Field>{!completeAllowed&&<p className="m-0 -mt-2 text-sm text-muted-foreground">还有待确认的成员，暂时不能确认名单完整。</p>}
          <Field orientation="horizontal" className="rounded-sm border border-border bg-field p-4"><Checkbox id="confirm-review" checked={confirmed} onCheckedChange={v => setConfirmed(v === true)} /><FieldLabel htmlFor="confirm-review">我已核对名单，确认日期、成员身份和数据无误。</FieldLabel></Field>
          <Button className="self-start" disabled={!confirmed} loading={busy} loadingText="正在保存…" onClick={() => void save()}>确认导入</Button><p className="m-0 text-sm text-muted-foreground">连接失败可重试同一次提交，不会重复写入；若同日数据变化，请重新开始并核对最新预览。</p>
        </Reveal>}
      </>}
    </fieldset>}
    <IdentityDialog index={identityIndex} rows={rows} matches={matches} players={context?.players ?? []} pending={pending}
      onClose={() => setIdentityIndex(null)} onConfirm={confirmIdentity}
      onEdit={(index, member) => setRows(rows.map((r,i) => i === index ? { ...r, member } : r))}
      onRemove={index => { setRemoved({ row: rows[index], index }); setRows(rows.filter((_,i) => i !== index)); setIdentityIndex(null); invalidate(); }} />
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogTitle>要放弃这次核对吗？</AlertDialogTitle><AlertDialogDescription>这批还没有保存。放弃后，需要重新上传并核对。</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel asChild><Button>继续核对</Button></AlertDialogCancel><Button variant="destructive" onClick={reset}>确认放弃</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <p className="m-0"><Link className="text-sm text-gold" href={href("/account")}>返回账户</Link></p>
  </main>;
}
