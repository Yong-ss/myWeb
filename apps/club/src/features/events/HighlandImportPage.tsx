"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {toast} from "../../components/ui/sonner";
import {clubApi} from "../../lib/data-access";
import {useClubCan,useClubHref} from "../../lib/useClub";
import {PageHeader} from "../../components/layout/PageHeader";
import {Button,ButtonLink} from "../../components/ui/button";
import {Notice} from "../../components/ui/notice";
import {Input} from "../../components/ui/input";
import {Textarea} from "../../components/ui/textarea";
import {Badge} from "../../components/ui/badge";
import {Checkbox} from "../../components/ui/checkbox";
import {Card,CardDescription,CardTitle} from "../../components/ui/card";
import {Field,FieldDescription,FieldLabel} from "../../components/ui/field";
import {NativeSelect,NativeSelectOption} from "../../components/ui/native-select";
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from "../../components/ui/collapsible";
import {Dialog,DialogContent,DialogDescription,DialogTitle} from "../../components/ui/dialog";
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle} from "../../components/ui/alert-dialog";
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from "../../components/ui/table";
import {LoadingState} from "../../components/feedback";
import type {NameAlias} from "../../domain/names";
import {highlandFactions,highlandFields,highlandLabels,highlandOutputFields,highlandStrategyFields,type HighlandMetric} from "../../domain/highland";
import {eventToday} from "./contract";
import {applyChoices,classifyRows,entryKey,highlandParticipantRow,highlandPrompt,pairHighland,parseHighlandSource,sideNames,sourceSummary,type Choice,type Entry,type HighlandRow,type RosterPlayer,type Side} from "./highland";
import {IdentityPicker,MetricInputs} from "./EventInputs";

export type HighlandIdentities={players:RosterPlayer[];aliases:NameAlias[];can_alias:boolean;truncated:boolean;roster_date:string|null};
type Values=Partial<Record<HighlandMetric,number|null>>;

/** Faction-wide board → this club's participants. The full AI output stays in this page; only the confirmed
 * participants of this club are sent (see worker/highland.ts). */
export function HighlandImportPage(){
 const href=useClubHref(),can=useClubCan(),router=useRouter();
 const [date,setDate]=useState(eventToday),[score,setScore]=useState(""),[faction,setFaction]=useState(""),[rank,setRank]=useState(""),[raw,setRaw]=useState("");
 const [ids,setIds]=useState<HighlandIdentities|null>(null),[source,setSource]=useState<Record<Side,HighlandRow[]>>({output:[],strategy:[]}),[removed,setRemoved]=useState(0);
 const [names,setNames]=useState<Record<string,string|null>>({}),[choices,setChoices]=useState<Record<string,Choice>>({});
 const [values,setValues]=useState<Record<string,Values>>({}),[remember,setRemember]=useState<Record<string,boolean>>({});
 const [picker,setPicker]=useState<Entry|null>(null),[renaming,setRenaming]=useState<Entry|null>(null),[newName,setNewName]=useState("");
 const [editing,setEditing]=useState<string|null>(null),[draft,setDraft]=useState<Values>({});
 const [search,setSearch]=useState(""),[bulk,setBulk]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[confirm,setConfirm]=useState(false),[checked,setChecked]=useState(false);
 const attempt=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{if(error)document.getElementById("highland-import-error")?.focus();},[error]);

 // Proposal per table (recomputed only when the source, a corrected name or the roster changes), then the choices.
 const proposed=useMemo(()=>{
  if(!ids)return {output:[],strategy:[]} as Record<Side,Entry[]>;
  const fix=(side:Side)=>source[side].map((r,index)=>Object.hasOwn(names,`${side}:${index}`)?{...r,player_name:names[`${side}:${index}`]}:r);
  return {output:classifyRows("output",fix("output"),ids.players,ids.aliases),strategy:classifyRows("strategy",fix("strategy"),ids.players,ids.aliases)};
 },[ids,source,names]);
 const entries={output:applyChoices(proposed.output,choices),strategy:applyChoices(proposed.strategy,choices)};
 const all=[...entries.output,...entries.strategy];
 const player=(id:string)=>ids?.players.find(p=>p.id===id);
 const name=(id:string)=>player(id)?.display_name??id;
 const {participants,problems,review}=pairHighland(entries.output,entries.strategy,name);
 const merged=participants.map(p=>({...p,values:{...p.values,...values[p.identity]}}));
 const rows=merged.map(p=>highlandParticipantRow(p,remember[p.identity]===true));
 const missing=merged.filter((_,i)=>!rows[i]).length;
 const scoreValue=/^\d{1,15}$/.test(score.trim())?Number(score.trim()):null;
 const ready=!!ids&&!review&&!problems.length&&!missing&&participants.length>0&&scoreValue!==null&&date<=eventToday();
 const included=all.filter(e=>e.decision==="include"),pending=all.filter(e=>e.decision==="review"),excluded=all.filter(e=>e.decision==="exclude");
 const shownFactions=[...new Set(included.map(e=>e.row.faction_name).filter(Boolean))];

 async function prepare(){
  setError("");
  if(!date||date>eventToday())return setError("请选择比赛日期（不能是未来日期）");
  if(scoreValue===null)return setError("请填写本俱乐部该场总积分（非负整数）");
  let parsed;try{parsed=parseHighlandSource(raw);}catch(e){return setError(e instanceof Error?e.message:"JSON 无效");}
  setBusy(true);
  try{
   const [identities,list]=await Promise.all([clubApi<HighlandIdentities>("/api/highland-identities",undefined,"身份资料读取失败"),clubApi<{events:{event_date:string}[]}>("/api/highland-events",undefined,"赛事列表读取失败")]);
   if(list.events.some(e=>e.event_date===date)){setError(`${date} 已有高原竞逐记录，请到赛事详情逐项修正`);return;}
   setIds(identities);setSource({output:parsed.output,strategy:parsed.strategy});setRemoved(parsed.removed);
   setNames({});setChoices({});setValues({});setRemember({});setSearch("");
  }catch(e){setError(e instanceof Error?e.message:"读取失败，请重试");}
  finally{setBusy(false);}
 }
 const choose=(e:Entry,choice:Choice)=>setChoices(c=>({...c,[entryKey(e)]:choice}));
 function pick(identity:string,keep:boolean){
  if(!picker)return;
  choose(picker,{decision:"include",identity});
  if(keep)setRemember(r=>({...r,[identity]:true}));
  // Continue with the next row still waiting for a decision, in board order.
  const next=pending.find(e=>entryKey(e)!==entryKey(picker));
  setPicker(next??null);
 }
 async function submit(){
  setConfirm(false);setBusy(true);setError("");
  const body={event_date:date,total_score:scoreValue,faction:faction||null,faction_rank:rank?Number(rank):null,players:rows,source:sourceSummary(entries.output,entries.strategy)},key=JSON.stringify(body);
  // One request id per exact content: a retry after a lost response is saved once; any change gets a new one.
  if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()};
  try{
   const saved=await clubApi<{event_id:string}>("/api/highland-events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,request_id:attempt.current.id})},"保存失败，请重试");
   toast.success("高原竞逐已保存");router.push(href(`/highland/event?id=${saved.event_id}`));
  }catch(e){setError(`${e instanceof Error?e.message:"保存失败"}。可直接重试，同一份内容只会保存一次。`);}
  finally{setBusy(false);}
 }
 if(!can("highland.import"))return <main className="club-workspace club-events flex flex-col gap-6"><PageHeader eyebrow="HIGHLAND RACE / 导入比赛" title="导入高原竞逐"/><LoadingState status="empty" title="没有导入高原竞逐的权限" detail="需要高原竞逐的「查看战绩」和「导入比赛」两项权限（与四方联赛权限分开设置）。"/></main>;

 const sourceLine=(e:Entry)=><span className="[overflow-wrap:anywhere]"><Badge variant="outline">{sideNames[e.side]}</Badge> <strong className="text-gold">{e.row.player_name??"昵称没看清"}</strong>
  {e.row.faction_name&&<small className="text-muted-foreground"> · {e.row.faction_name}</small>}{e.decision==="include"&&e.identity&&<> → {name(e.identity)}{player(e.identity)?.current===false&&<Badge variant="warning" className="ml-1">不在最新名单</Badge>}</>}
  {e.reasons.length>0&&e.decision==="review"&&<small className="block text-muted-foreground">{e.reasons.join("；")}</small>}</span>;
 const actions=(e:Entry)=><span className="flex flex-wrap gap-1">
  <Button variant="secondary" size="compact" onClick={()=>setPicker(e)}>{e.decision==="include"?"改选玩家":"是本俱乐部玩家"}</Button>
  {e.decision!=="exclude"&&<Button variant="ghost" size="compact" onClick={()=>choose(e,{decision:"exclude"})}>不是，排除</Button>}
  <Button variant="ghost" size="compact" onClick={()=>{setRenaming(e);setNewName(e.row.player_name??"");}}>更正昵称</Button></span>;
 const item=(e:Entry)=><li key={entryKey(e)} className="flex flex-wrap items-center justify-between gap-2 border-b border-divider py-2 last:border-b-0">{sourceLine(e)}{actions(e)}</li>;
 const found=excluded.filter(e=>!search.trim()||(e.row.player_name??"").includes(search.trim()));

 return <main className="club-workspace club-events flex max-w-300 flex-col gap-6">
  <PageHeader eyebrow="HIGHLAND RACE / 导入比赛" title="导入高原竞逐" actions={<ButtonLink variant="secondary" href={href("/highland")}>返回赛事列表</ButtonLink>}/>
  <Card className="w-full"><CardTitle>1. 填写比赛信息并粘贴 JSON</CardTitle>
   <CardDescription>在游戏里打开本势力的「数据统计」，把「输出」「战略」两类全部截图交给站外 AI，再粘贴它输出的 JSON。截图里混有其他俱乐部的玩家，下一步由你确认哪些是本俱乐部的；完整的势力数据只在本页使用，不会上传或保存。</CardDescription>
   <div className="flex flex-wrap gap-4">
    <Field className="max-w-56"><FieldLabel htmlFor="highland-date">比赛日期</FieldLabel><Input id="highland-date" type="date" max={eventToday()} value={date} onChange={e=>{setDate(e.target.value);setIds(null);}}/></Field>
    <Field className="max-w-56"><FieldLabel htmlFor="highland-score">本俱乐部总积分</FieldLabel><Input id="highland-score" inputMode="numeric" value={score} placeholder="例如 3000" onChange={e=>setScore(e.target.value)}/><FieldDescription>手动填写；个人「战功」另行记录，不是总积分。</FieldDescription></Field>
    <Field className="max-w-56"><FieldLabel htmlFor="highland-faction">所属势力（可留空）</FieldLabel><NativeSelect id="highland-faction" value={faction} onChange={e=>setFaction(e.target.value)}><NativeSelectOption value="">未填写</NativeSelectOption>{highlandFactions.map(f=><NativeSelectOption key={f} value={f}>{f}</NativeSelectOption>)}</NativeSelect>
     <FieldDescription>其余势力的官方名称尚待确认，暂不能选择。</FieldDescription></Field>
    <Field className="max-w-56"><FieldLabel htmlFor="highland-rank">势力名次（可留空）</FieldLabel><NativeSelect id="highland-rank" value={rank} onChange={e=>setRank(e.target.value)}><NativeSelectOption value="">未填写</NativeSelectOption>{[1,2,3,4].map(n=><NativeSelectOption key={n} value={String(n)}>第 {n} 名</NativeSelectOption>)}</NativeSelect>
     <FieldDescription>本势力在本场四个势力中的排名。</FieldDescription></Field>
   </div>
   <Field><FieldLabel htmlFor="highland-json">AI 输出的 JSON</FieldLabel><Textarea id="highland-json" rows={8} value={raw} onChange={e=>{setRaw(e.target.value);setIds(null);}} placeholder='{"schema_version":1,"event_type":"highland_race","output":[…],"strategy":[…]}'/></Field>
   <div className="flex flex-wrap gap-3"><Button loading={busy&&!ids} loadingText="准备中…" onClick={prepare}>开始核对</Button>
    <Collapsible><CollapsibleTrigger className="px-0">复制给 AI 的提示词</CollapsibleTrigger><CollapsibleContent className="grid gap-2 pt-2"><Button variant="secondary" size="compact" className="self-start" onClick={()=>void navigator.clipboard?.writeText(highlandPrompt).then(()=>toast.success("已复制提示词"))}>复制</Button><pre className="m-0 max-h-72 overflow-auto rounded-sm border border-border p-3 text-xs whitespace-pre-wrap">{highlandPrompt}</pre></CollapsibleContent></Collapsible></div>
  </Card>
  {error&&<Notice variant="destructive" id="highland-import-error" tabIndex={-1} role="alert">{error}</Notice>}
  {ids&&<>
   <Card className="w-full"><CardTitle>2. 找出本俱乐部的玩家</CardTitle>
    <CardDescription>只有名字或已记住的写法与<strong>最新成员名单</strong>（{ids.roster_date??"暂无名单"}）中某人完全一致，才会自动拟纳入；相似名字、已退会玩家、同名和重复都要你确认。拟排除的是名单里找不到对应的人，并不代表已证明是外部玩家，可以随时找回。</CardDescription>
    <dl className="m-0 flex flex-wrap gap-x-8 gap-y-2 text-sm" aria-label="核对进度">
     {([["势力数据",`输出 ${source.output.length} 行 · 战略 ${source.strategy.length} 行`],["拟纳入本俱乐部",`${participants.length} 人`],["待确认",`${review} 行`],["拟排除",`${excluded.length} 行`],["需要处理的问题",`${problems.length} 个`]] as const).map(([k,v])=><div key={k} className="grid gap-0.5"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="m-0 font-heading text-lg tabular-nums text-gold">{v}</dd></div>)}
    </dl>
    {ids.truncated&&<Notice variant="warning">本俱乐部玩家或别名超过一次可读取的上限，部分名字可能没有参与自动匹配；请仔细检查拟排除列表。</Notice>}
    {removed>0&&<Notice variant="info">已合并 {removed} 条完全相同的重复行（滚动重叠或底部固定的本人行）。</Notice>}
    {problems.length>0&&<Notice as="ul" variant="warning" className="grid list-disc gap-1 pl-8" aria-label="需要处理的问题">{problems.map(p=><li key={p}>{p}</li>)}</Notice>}
    {pending.length>0&&<section className="grid gap-2" aria-label="待确认"><h3 className="m-0 font-heading text-base text-gold">待确认 {pending.length} 行（每行选择玩家或排除）</h3>
     <ul className="m-0 list-none p-0">{pending.map(item)}</ul>
     <Button variant="ghost" size="compact" className="self-start" onClick={()=>setBulk(true)}>其余待确认全部排除…</Button></section>}
    <Collapsible defaultOpen className="rounded-sm border border-border"><CollapsibleTrigger className="px-4 text-gold">拟纳入 {included.length} 行（可复查、改选或排除）</CollapsibleTrigger>
     <CollapsibleContent className="px-4 pb-2">{included.length?<ul className="m-0 list-none p-0">{included.map(item)}</ul>:<p className="m-0 py-2 text-sm text-muted-foreground">还没有纳入任何本俱乐部玩家。</p>}</CollapsibleContent></Collapsible>
    <Collapsible className="rounded-sm border border-border"><CollapsibleTrigger className="px-4 text-gold">拟排除 {excluded.length} 行（不保存；可搜索找回）</CollapsibleTrigger>
     <CollapsibleContent className="grid gap-2 px-4 pb-2">
      <Field className="max-w-80"><FieldLabel htmlFor="highland-excluded-search">搜索昵称</FieldLabel><Input id="highland-excluded-search" type="search" value={search} onChange={e=>setSearch(e.target.value)}/></Field>
      <ul className="m-0 list-none p-0">{found.slice(0,200).map(item)}</ul>
      {found.length>200&&<p className="m-0 text-xs text-muted-foreground">只显示前 200 行，请输入昵称缩小范围。</p>}
     </CollapsibleContent></Collapsible>
   </Card>
   <Card className="w-full"><CardTitle>3. 预览本俱乐部本场战绩</CardTitle>
    <CardDescription>{date} · 总积分 {scoreValue??"—"} · {faction||"势力未填写"} · {rank?`第 ${rank} 名`:"名次未填写"} · 本俱乐部 {participants.length} 人{shownFactions.length>0&&<> · 截图显示所属势力：{shownFactions.join("、")}</>}</CardDescription>
    <Table containerClassName="members-table-wrap max-h-[60dvh] overflow-y-auto"><TableCaption>两张表按玩家身份合并；— 表示未识别，必须补全后才能保存；0 是有效值</TableCaption>
     <TableHeader><TableRow><TableHead>玩家</TableHead>{highlandFields.map(k=><TableHead key={k}>{highlandLabels[k]}</TableHead>)}<TableHead>操作</TableHead></TableRow></TableHeader>
     <TableBody>{merged.map(p=><TableRow key={p.identity}>
      <TableCell className="sticky left-0 z-1 bg-card font-medium"><span className="block text-gold">{name(p.identity)}</span><small className="block text-muted-foreground">输出「{p.output.row.player_name}」/ 战略「{p.strategy.row.player_name}」</small></TableCell>
      {highlandFields.map(k=><TableCell key={k} className="tabular-nums">{p.values[k]==null?<Badge variant="warning">—</Badge>:p.values[k]}</TableCell>)}
      <TableCell><Button variant="ghost" size="compact" onClick={()=>{setEditing(p.identity);setDraft(p.values);}}>修改数据</Button></TableCell></TableRow>)}</TableBody></Table>
    {missing>0&&<Notice variant="warning">还有 {missing} 名玩家的数据未识别，请补全。</Notice>}
    <div className="flex flex-wrap items-center gap-3"><Button disabled={!ready} loading={busy} loadingText="保存中…" onClick={()=>{setChecked(false);setConfirm(true);}}>核对名单并保存</Button>
     {!ready&&<span className="text-sm text-muted-foreground">{review?`还有 ${review} 行待确认。`:problems.length?"请先处理上面的问题。":!participants.length?"至少要纳入 1 名本俱乐部玩家。":missing?"请补全缺失的数据。":""}</span>}</div>
   </Card>
  </>}
  {ids&&picker&&<IdentityPicker open allowNew={false} title={`${sideNames[picker.side]}第 ${picker.index+1} 行是本俱乐部的谁？`} sourceName={picker.row.player_name} players={[...ids.players].sort((a,b)=>Number(b.current)-Number(a.current))} candidates={picker.candidates}
   note={p=>(p as RosterPlayer).current?"":"不在最新名单"}
   used={new Set(entries[picker.side].filter(e=>e.decision==="include"&&entryKey(e)!==entryKey(picker)).map(e=>e.identity))} current={picker.decision==="include"?picker.identity:""}
   remember={{allowed:ids.can_alias,checked:false}} onClose={()=>setPicker(null)} onPick={pick}/>}
  <Dialog open={renaming!==null} onOpenChange={o=>{if(!o)setRenaming(null);}}><DialogContent><DialogTitle>更正识别昵称</DialogTitle>
   <DialogDescription>AI 读错名字时，按截图改成正确的昵称，网站会按新昵称重新匹配这一行。保存时记录更正后的昵称。</DialogDescription>
   <Field><FieldLabel htmlFor="highland-rename">昵称</FieldLabel><Input id="highland-rename" maxLength={200} value={newName} onChange={e=>setNewName(e.target.value)}/></Field>
   <div className="flex justify-end gap-3"><Button variant="ghost" onClick={()=>setRenaming(null)}>取消</Button><Button disabled={!newName.trim()} onClick={()=>{if(!renaming)return;const k=entryKey(renaming);setNames(n=>({...n,[k]:newName.trim()}));setChoices(c=>Object.fromEntries(Object.entries(c).filter(([key])=>key!==k)));setRenaming(null);}}>确认</Button></div>
  </DialogContent></Dialog>
  <Dialog open={editing!==null} onOpenChange={o=>{if(!o)setEditing(null);}}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogTitle>修改 {editing&&name(editing)} 的数据</DialogTitle><DialogDescription>空白表示未识别；可输入「1708万」这类数字。</DialogDescription>
   {editing&&<MetricInputs idPrefix="highland-draft" values={draft} onChange={v=>setDraft(v as Values)} output={highlandOutputFields} strategy={highlandStrategyFields} labels={highlandLabels}/>}
   <div className="flex justify-end gap-3"><Button variant="ghost" onClick={()=>setEditing(null)}>取消</Button><Button onClick={()=>{if(editing)setValues(v=>({...v,[editing]:draft}));setEditing(null);}}>确认</Button></div>
  </DialogContent></Dialog>
  <AlertDialog open={bulk} onOpenChange={setBulk}><AlertDialogContent><AlertDialogTitle>其余 {pending.length} 行全部排除？</AlertDialogTitle>
   <AlertDialogDescription>只在你已确认这些人都不是本俱乐部玩家时使用。排除的行不会保存，之后仍可在「拟排除」中找回。</AlertDialogDescription>
   <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary">返回</Button></AlertDialogCancel><Button onClick={()=>{setChoices(c=>({...c,...Object.fromEntries(pending.map(e=>[entryKey(e),{decision:"exclude"} as Choice]))}));setBulk(false);}}>全部排除</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent className="max-h-[90vh] overflow-y-auto"><AlertDialogTitle>确认本俱乐部参赛名单</AlertDialogTitle>
   <AlertDialogDescription>{date} · 总积分 {scoreValue} · {faction||"势力未填写"} · {rank?`第 ${rank} 名`:"名次未填写"}。只保存以下 {participants.length} 人的输出和战略数据；其他 {excluded.length} 行不会上传。网站无法凭截图证明玩家身份，请再核对一次。</AlertDialogDescription>
   <ol className="m-0 grid max-h-60 list-decimal gap-1 overflow-y-auto pl-6 text-sm" aria-label="本俱乐部参赛名单">{merged.map(p=><li key={p.identity}>{name(p.identity)}{player(p.identity)?.current===false&&<span className="text-muted-foreground">（不在最新名单）</span>}</li>)}</ol>
   <Field orientation="horizontal" className="rounded-sm border border-border p-3"><Checkbox id="highland-roster-ok" checked={checked} onCheckedChange={v=>setChecked(v===true)}/><FieldLabel htmlFor="highland-roster-ok">我已核对，以上 {participants.length} 人都是本俱乐部本场的参赛者</FieldLabel></Field>
   <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary">返回检查</Button></AlertDialogCancel><Button disabled={!checked} onClick={()=>void submit()}>确认保存</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </main>;
}
