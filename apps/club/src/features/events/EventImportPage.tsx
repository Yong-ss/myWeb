"use client";
import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {clubApi} from "../../lib/data-access";
import {useClubCan,useClubHref} from "../../lib/useClub";
import {PageHeader} from "../../components/layout/PageHeader";
import {Button,ButtonLink} from "../../components/ui/button";
import {Notice} from "../../components/ui/notice";
import {Input} from "../../components/ui/input";
import {Textarea} from "../../components/ui/textarea";
import {Badge} from "../../components/ui/badge";
import {Card,CardDescription,CardTitle} from "../../components/ui/card";
import {Field,FieldDescription,FieldLabel} from "../../components/ui/field";
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from "../../components/ui/collapsible";
import {Dialog,DialogContent,DialogDescription,DialogTitle} from "../../components/ui/dialog";
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle} from "../../components/ui/alert-dialog";
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from "../../components/ui/table";
import {LoadingState} from "../../components/feedback";
import {toast} from "../../components/ui/sonner";
import type {NameAlias,NamedPlayer} from "../../domain/names";
import {eventToday,isNew,matchEntries,metricFields,metricLabels,pairEntries,parseEventSource,participantRow,tableNames,totalKills,type Entry,type Metric,type Table as Side} from "./contract";
import {eventPrompt} from "./prompt";
import {IdentityPicker,MetricInputs} from "./EventInputs";

type Identities={players:NamedPlayer[];aliases:NameAlias[];can_alias:boolean};

export function EventImportPage(){
 const href=useClubHref(),can=useClubCan(),router=useRouter();
 const [date,setDate]=useState(eventToday),[score,setScore]=useState(""),[raw,setRaw]=useState("");
 const [ids,setIds]=useState<Identities|null>(null),[entries,setEntries]=useState<Record<Side,Entry[]>>({output:[],strategy:[]}),[removed,setRemoved]=useState(0);
 const [values,setValues]=useState<Record<string,Partial<Record<Metric,number|null>>>>({}),[remember,setRemember]=useState<Record<string,boolean>>({});
 const [picker,setPicker]=useState<{table:Side;index:number}|null>(null),[editing,setEditing]=useState<string|null>(null),[draft,setDraft]=useState<Partial<Record<Metric,number|null>>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[confirm,setConfirm]=useState(false);
 const attempt=useRef<{key:string;id:string}|null>(null);
 useEffect(()=>{if(error)document.getElementById("event-import-error")?.focus();},[error]);
 const name=(identity:string)=>isNew(identity)?`${identity.slice(4)}（新玩家）`:ids?.players.find(p=>p.id===identity)?.display_name??identity;
 const {participants,problems}=pairEntries(entries.output,entries.strategy,name);
 const merged=participants.map(p=>({...p,values:{...p.values,...values[p.identity]}}));
 const rows=merged.map(p=>participantRow(p,remember[p.identity]===true));
 const missing=merged.filter((_,i)=>!rows[i]).length;
 const scoreValue=/^\d{1,15}$/.test(score.trim())?Number(score.trim()):null;
 const ready=!!ids&&!problems.length&&!missing&&participants.length>0&&scoreValue!==null&&date<=eventToday();

 async function prepare(){
  setError("");
  if(!date||date>eventToday())return setError("请选择比赛日期（不能是未来日期）");
  if(scoreValue===null)return setError("请填写本俱乐部该场总积分（非负整数）");
  let parsed;try{parsed=parseEventSource(raw);}catch(e){return setError(e instanceof Error?e.message:"JSON 无效");}
  setBusy(true);
  try{
   const [identities,list]=await Promise.all([clubApi<Identities>("/api/event-identities",undefined,"身份资料读取失败"),clubApi<{events:{event_date:string}[]}>("/api/events",undefined,"赛事列表读取失败")]);
   if(list.events.some(e=>e.event_date===date)){setError(`${date} 已有四方联赛记录，请到赛事详情逐项修正`);return;}
   setIds(identities);setRemoved(parsed.removed);setValues({});setRemember({});
   setEntries({output:matchEntries("output",parsed.output,identities.players,identities.aliases),strategy:matchEntries("strategy",parsed.strategy,identities.players,identities.aliases)});
  }catch(e){setError(e instanceof Error?e.message:"读取失败，请重试");}
  finally{setBusy(false);}
 }
 function pick(identity:string,keep:boolean){
  if(!picker)return;
  const {table,index}=picker;
  const next={...entries,[table]:entries[table].map(e=>e.index===index?{...e,identity,auto:false}:e)};
  setEntries(next);if(keep)setRemember(r=>({...r,[identity]:true}));
  // Continue with the next row that still needs a person, as the daily import does.
  const open=(["output","strategy"] as Side[]).flatMap(t=>next[t].filter(e=>!e.identity).map(e=>({table:t,index:e.index})));
  setPicker(open[0]??null);
 }
 async function submit(){
  setConfirm(false);setBusy(true);setError("");
  // One request id per exact content: a retry after a lost response reuses it (saved once); any change gets a new one.
  const body={event_date:date,total_score:scoreValue,players:rows,raw_text:raw},key=JSON.stringify(body);
  if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()};
  try{
   const saved=await clubApi<{event_id:string}>("/api/events",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,request_id:attempt.current.id})},"保存失败，请重试");
   toast.success("四方联赛已保存");router.push(href(`/event?id=${saved.event_id}`));
  }catch(e){setError(`${e instanceof Error?e.message:"保存失败"}。可直接重试，同一份内容只会保存一次。`);}
  finally{setBusy(false);}
 }
 if(!can("events.import"))return <main className="club-workspace club-events flex flex-col gap-6"><PageHeader eyebrow="FOUR-WAY LEAGUE / 导入比赛" title="导入四方联赛"/><LoadingState status="empty" title="没有导入四方联赛的权限" detail="需要「查看战绩」和「导入比赛」两项权限。"/></main>;
 const current=picker?entries[picker.table].find(e=>e.index===picker.index):undefined;
 const unresolved=(["output","strategy"] as Side[]).flatMap(t=>entries[t].filter(e=>!e.identity));
 const automatic=(["output","strategy"] as Side[]).flatMap(t=>entries[t].filter(e=>e.identity));
 const rowButton=(e:Entry)=><li key={e.table+e.index} className="flex flex-wrap items-center justify-between gap-2 border-b border-divider py-2 last:border-b-0">
  <span className="[overflow-wrap:anywhere]"><Badge variant="outline">{tableNames[e.table]}</Badge> <strong className="text-gold">{e.row.player_name??"昵称没看清"}</strong>{e.identity&&<> → {name(e.identity)}</>}{e.reasons.length>0&&!e.identity&&<small className="block text-muted-foreground">{e.reasons.join("；")}</small>}</span>
  <Button variant="secondary" size="compact" onClick={()=>setPicker({table:e.table,index:e.index})}>{e.identity?"修改":"确认身份"}</Button></li>;
 return <main className="club-workspace club-events flex max-w-300 flex-col gap-6">
  <PageHeader eyebrow="FOUR-WAY LEAGUE / 导入比赛" title="导入四方联赛" actions={<ButtonLink variant="secondary" href={href("/events")}>返回赛事列表</ButtonLink>}/>
  <Card className="w-full"><CardTitle>1. 填写比赛信息并粘贴 JSON</CardTitle>
   <CardDescription>先在游戏里筛选本俱乐部，把「输出」「战略」两类截图一起交给站外 AI，再把它输出的 JSON 粘贴到这里。保存前不会写入任何数据。</CardDescription>
   <div className="flex flex-wrap gap-4">
    <Field className="max-w-56"><FieldLabel htmlFor="event-date">比赛日期</FieldLabel><Input id="event-date" type="date" max={eventToday()} value={date} onChange={e=>{setDate(e.target.value);setIds(null);}}/></Field>
    <Field className="max-w-56"><FieldLabel htmlFor="event-score">本俱乐部总积分</FieldLabel><Input id="event-score" inputMode="numeric" value={score} placeholder="例如 3000" onChange={e=>setScore(e.target.value)}/><FieldDescription>总击杀按参赛玩家「击败」自动合计。</FieldDescription></Field>
   </div>
   <Field><FieldLabel htmlFor="event-json">AI 输出的 JSON</FieldLabel><Textarea id="event-json" rows={8} value={raw} onChange={e=>{setRaw(e.target.value);setIds(null);}} placeholder='{"schema_version":1,"event_type":"four_way_league","output":[…],"strategy":[…]}'/></Field>
   <div className="flex flex-wrap gap-3"><Button loading={busy&&!ids} loadingText="准备中…" onClick={prepare}>开始核对</Button>
    <Collapsible><CollapsibleTrigger className="px-0">复制给 AI 的提示词</CollapsibleTrigger><CollapsibleContent className="grid gap-2 pt-2"><Button variant="secondary" size="compact" className="self-start" onClick={()=>void navigator.clipboard?.writeText(eventPrompt).then(()=>toast.success("已复制提示词"))}>复制</Button><pre className="m-0 max-h-72 overflow-auto rounded-sm border border-border p-3 text-xs whitespace-pre-wrap">{eventPrompt}</pre></CollapsibleContent></Collapsible></div>
  </Card>
  {error&&<Notice variant="destructive" id="event-import-error" tabIndex={-1} role="alert">{error}</Notice>}
  {ids&&<>
   <Card className="w-full"><CardTitle>2. 核对身份</CardTitle>
    <CardDescription>两张表按玩家身份合并，不按排名或行号。只出现在一张表、同表重复或身份不明时不能保存；缺失的数值不会当作 0。</CardDescription>
    {removed>0&&<Notice variant="info">已合并 {removed} 条完全相同的重复行（例如底部固定显示的本人行）。</Notice>}
    {problems.length>0&&<Notice as="ul" variant="warning" className="grid list-disc gap-1 pl-8" aria-label="需要处理的问题">{problems.map(p=><li key={p}>{p}</li>)}</Notice>}
    {unresolved.length>0&&<ul className="m-0 list-none p-0" aria-label="待确认身份">{unresolved.map(rowButton)}</ul>}
    {automatic.length>0&&<Collapsible><CollapsibleTrigger className="px-0">已自动匹配 {automatic.length} 行（可复查）</CollapsibleTrigger><CollapsibleContent><ul className="m-0 list-none p-0">{automatic.map(rowButton)}</ul></CollapsibleContent></Collapsible>}
   </Card>
   <Card className="w-full"><CardTitle>3. 预览本场战绩</CardTitle>
    <CardDescription>{date} · 总积分 {scoreValue??"—"} · 参赛 {participants.length} 人 · 总击杀（个人击败合计）{totalKills(merged.map(p=>({kills:p.values.kills??0})))}</CardDescription>
    <Table containerClassName="members-table-wrap max-h-[60dvh] overflow-y-auto"><TableCaption>— 表示未识别，必须补全后才能保存</TableCaption>
     <TableHeader><TableRow><TableHead>玩家</TableHead>{metricFields.map(k=><TableHead key={k}>{metricLabels[k]}</TableHead>)}<TableHead>操作</TableHead></TableRow></TableHeader>
     <TableBody>{merged.map(p=><TableRow key={p.identity}>
      <TableCell className="sticky left-0 z-1 bg-card font-medium"><span className="block text-gold">{name(p.identity)}</span>{(p.output.row.player_name!==p.strategy.row.player_name)&&<small className="block text-muted-foreground">输出「{p.output.row.player_name}」/ 战略「{p.strategy.row.player_name}」</small>}</TableCell>
      {metricFields.map(k=><TableCell key={k} className="tabular-nums">{p.values[k]==null?<Badge variant="warning">—</Badge>:p.values[k]}</TableCell>)}
      <TableCell><Button variant="ghost" size="compact" onClick={()=>{setEditing(p.identity);setDraft(p.values);}}>修改数据</Button></TableCell></TableRow>)}</TableBody></Table>
    {missing>0&&<Notice variant="warning">还有 {missing} 名玩家的数据未识别，请补全。</Notice>}
    <div className="flex flex-wrap items-center gap-3"><Button disabled={!ready} loading={busy} loadingText="保存中…" onClick={()=>setConfirm(true)}>确认并保存</Button><span className="text-sm text-muted-foreground">新玩家 {participants.filter(p=>isNew(p.identity)).length} 人，将在保存时一起建档。</span></div>
   </Card>
  </>}
  {ids&&current&&<IdentityPicker open title={`${tableNames[current.table]}第 ${current.index+1} 行是谁？`} sourceName={current.row.player_name} players={ids.players} candidates={current.candidates}
   used={new Set(entries[current.table].filter(e=>e.index!==current.index&&e.identity).map(e=>e.identity))} current={current.identity}
   remember={{allowed:ids.can_alias,checked:remember[current.identity]??false}} onClose={()=>setPicker(null)} onPick={pick}
   onRemove={()=>{setEntries({...entries,[current.table]:entries[current.table].filter(e=>e.index!==current.index)});setPicker(null);}}/>}
  <Dialog open={editing!==null} onOpenChange={o=>{if(!o)setEditing(null);}}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogTitle>修改 {editing&&name(editing)} 的数据</DialogTitle><DialogDescription>空白表示未识别；可输入「50.1万」这类数字。</DialogDescription>
   {editing&&<MetricInputs idPrefix="draft" values={draft} onChange={setDraft}/>}
   <div className="flex justify-end gap-3"><Button variant="ghost" onClick={()=>setEditing(null)}>取消</Button><Button onClick={()=>{if(editing)setValues(v=>({...v,[editing]:draft}));setEditing(null);}}>确认</Button></div>
  </DialogContent></Dialog>
  <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogTitle>保存这场四方联赛？</AlertDialogTitle>
   <AlertDialogDescription>{date} · 总积分 {scoreValue} · {participants.length} 名参赛者（输出与战略完整）。保存后可在赛事详情修正，修改会保留历史版本。</AlertDialogDescription>
   <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary">返回检查</Button></AlertDialogCancel><Button onClick={()=>void submit()}>确认保存</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </main>;
}
