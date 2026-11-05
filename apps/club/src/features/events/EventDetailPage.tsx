"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {cn} from "cn";
import {toast} from "../../components/ui/sonner";
import {clubApi} from "../../lib/data-access";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {useClubCan,useClubHref} from "../../lib/useClub";
import {PageHeader} from "../../components/layout/PageHeader";
import {Button,ButtonLink} from "../../components/ui/button";
import {Input} from "../../components/ui/input";
import {Badge} from "../../components/ui/badge";
import {Card} from "../../components/ui/card";
import {Field,FieldLabel} from "../../components/ui/field";
import {Tabs,TabsContent,TabsList,TabsTrigger} from "../../components/ui/tabs";
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from "../../components/ui/collapsible";
import {Dialog,DialogContent,DialogDescription,DialogTitle} from "../../components/ui/dialog";
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle} from "../../components/ui/alert-dialog";
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow,TableSortButton} from "../../components/ui/table";
import {LoadingState,TableSkeleton} from "../../components/feedback";
import type {NameAlias,NamedPlayer} from "../../domain/names";
import {nameCandidates} from "../../domain/names";
import {eventToday,isNew,metricFields,metricLabels,outputFields,strategyFields,type Metric,type Metrics} from "./contract";
import {IdentityPicker,MetricInputs} from "./EventInputs";

type Player=Metrics&{player_id:string;display_name:string;origin:"import"|"manual";output_name:string|null;strategy_name:string|null};
type Detail={event:{id:string;event_date:string;status:"active"|"voided";version:number;total_score:number;total_kills:number};players:Player[];versions:{version:number;action:string;created_at:string}[];raw_text:string|null};
type Identities={players:NamedPlayer[];aliases:NameAlias[];can_alias:boolean};
type Action={kind:"score"|"date"|"add"|"void"|"restore"}|{kind:"metrics"|"rebind"|"remove";player:Player}|{kind:"version";version:number};
const actionNames:Record<string,string>={create:"导入",score:"修改总积分",date:"修改比赛日期",metrics:"修改玩家数据",rebind:"改绑身份",add:"补录玩家",remove:"移除参赛记录",void:"作废",restore:"恢复"};
const time=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"short",hour12:false});

export function EventDetailPage(){
 const href=useClubHref(),can=useClubCan(),editor=can("events.edit");
 const [data,setData]=useState<Detail|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 const [search,setSearch]=useState(""),[sort,setSort]=useState<{key:"display_name"|Metric;desc:boolean}>({key:"kills",desc:true}),[focus,setFocus]=useState("");
 const [action,setAction]=useState<Action|null>(null),[busy,setBusy]=useState(false),[actionError,setActionError]=useState("");
 const [ids,setIds]=useState<Identities|null>(null),[version,setVersion]=useState<{version:number;state:{event_date:string;total_score:number;status:string;players:Player[]}}|null>(null);
 const [score,setScore]=useState(""),[date,setDate]=useState(""),[values,setValues]=useState<Partial<Record<Metric,number|null>>>({}),[pick,setPick]=useState("");
 const attempt=useRef<{key:string;id:string}|null>(null);
 useDataRefresh(()=>setRetry(n=>n+1));
 useEffect(()=>{let active=true;const q=new URLSearchParams(window.location.search);
  clubApi<Detail>(`/api/event?id=${encodeURIComponent(q.get("id")??"")}`,undefined,"赛事读取失败").then(d=>{if(active){setData(d);setError("");setFocus(q.get("player")??"");}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 useEffect(()=>{if(focus&&data)document.getElementById(`event-row-${focus}`)?.scrollIntoView({block:"center"});},[focus,data]);
 if(error)return <main className="club-workspace club-events flex flex-col gap-6"><PageHeader eyebrow="FOUR-WAY LEAGUE / 赛事详情" title="四方联赛"/><LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/></main>;
 if(!data)return <main className="club-workspace club-events flex flex-col gap-6"><PageHeader eyebrow="FOUR-WAY LEAGUE / 赛事详情" title="四方联赛"/><TableSkeleton columns={6} label="正在读取赛事…"/></main>;
 const e=data.event,active=e.status==="active";
 async function open(next:Action){
  setActionError("");setAction(next);
  if(next.kind==="score")setScore(String(e.total_score));
  if(next.kind==="date")setDate(e.event_date);
  if(next.kind==="metrics")setValues(Object.fromEntries(metricFields.map(k=>[k,next.player[k]])));
  if(next.kind==="add"){setValues({});setPick("");}
  if(next.kind==="version"){setVersion(null);try{setVersion(await clubApi(`/api/event?id=${e.id}&version=${next.version}`,undefined,"版本读取失败"));}catch(err){setActionError(err instanceof Error?err.message:"读取失败");}}
  if((next.kind==="rebind"||next.kind==="add")&&!ids){try{setIds(await clubApi<Identities>("/api/event-identities",undefined,"身份资料读取失败"));}catch(err){setActionError(err instanceof Error?err.message:"读取失败");}}
 }
 async function save(kind:string,payload:Record<string,unknown>,done:string){
  const body={event_id:e.id,expected_version:e.version,action:kind,payload};
  // A retry of the same change after a lost response reuses its request id, so it is saved once.
  const key=JSON.stringify(body);if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()};
  setBusy(true);setActionError("");
  try{await clubApi("/api/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,request_id:attempt.current.id})},"保存失败，请重试");attempt.current=null;toast.success(done);setAction(null);setRetry(n=>n+1);}
  catch(err){const status=(err as {status?:number}).status;const text=status===409?`${err instanceof Error?err.message:""}（请刷新后重新操作）`:err instanceof Error?err.message:"保存失败";setActionError(text);if(kind==="rebind")toast.error(text);}
  finally{setBusy(false);}
 }
 const shown=data.players.filter(p=>!search.trim()||p.display_name.includes(search.trim())||(p.output_name??"").includes(search.trim())||(p.strategy_name??"").includes(search.trim()))
  .sort((a,b)=>{const x=a[sort.key],y=b[sort.key];const c=typeof x==="number"&&typeof y==="number"?x-y:String(x).localeCompare(String(y),"zh-CN",{numeric:true});return (sort.desc?-c:c)||a.player_id.localeCompare(b.player_id);});
 const heading=(key:"display_name"|Metric,title:string)=><TableHead key={key} aria-sort={sort.key===key?(sort.desc?"descending":"ascending"):"none"} className={key==="display_name"?"sticky left-0 z-3 bg-secondary":undefined}>
  <TableSortButton onClick={()=>setSort(s=>({key,desc:s.key===key?!s.desc:key!=="display_name"}))}>{title}<span aria-hidden="true">{sort.key===key?(sort.desc?"↓":"↑"):"↕"}</span></TableSortButton></TableHead>;
 const table=(fields:readonly Metric[])=><Table containerClassName="members-table-wrap max-h-[min(72dvh,48rem)] overflow-y-auto" className="[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-2"><TableCaption>{search?`找到 ${shown.length} 人`:`本场 ${data.players.length} 名参赛者 · 排序与搜索只改变显示`}</TableCaption>
  <TableHeader><TableRow>{heading("display_name","玩家")}{fields.map(k=>heading(k,metricLabels[k]))}{editor&&active&&<TableHead>操作</TableHead>}</TableRow></TableHeader>
  <TableBody>{shown.map(p=><TableRow key={p.player_id} id={`event-row-${p.player_id}`} className={cn(focus===p.player_id&&"bg-selected")}>
   <TableCell className="sticky left-0 z-1 bg-card font-medium"><Link className="text-gold" href={href(`/players?id=${p.player_id}`)}>{p.display_name}</Link>{p.origin==="manual"&&<Badge variant="info" className="ml-1">人工补录</Badge>}
    {(p.output_name||p.strategy_name)&&(p.output_name!==p.display_name||p.strategy_name!==p.display_name)&&<small className="block text-muted-foreground">识别：{[...new Set([p.output_name,p.strategy_name].filter(Boolean))].join(" / ")}</small>}</TableCell>
   {fields.map(k=><TableCell key={k} className="tabular-nums">{p[k]}</TableCell>)}
   {editor&&active&&<TableCell><span className="flex flex-wrap gap-1"><Button variant="ghost" size="compact" onClick={()=>void open({kind:"metrics",player:p})}>修改数据</Button><Button variant="ghost" size="compact" onClick={()=>void open({kind:"rebind",player:p})}>改绑身份</Button><Button variant="ghost" size="compact" className="text-destructive" onClick={()=>void open({kind:"remove",player:p})}>移除本场记录</Button></span></TableCell>}
  </TableRow>)}</TableBody></Table>;
 const used=new Set(data.players.map(p=>p.player_id));
 const target=action&&"player" in action?action.player:null;
 const complete=metricFields.every(k=>typeof values[k]==="number");
 const scoreOk=/^\d{1,15}$/.test(score.trim());
 const actionError_=actionError&&<p role="alert" className="m-0 text-sm text-destructive">{actionError}</p>;
 return <main className="club-workspace club-events flex max-w-400 flex-col gap-6">
  <PageHeader eyebrow="FOUR-WAY LEAGUE / 赛事详情" title={`四方联赛 · ${e.event_date}`} actions={<ButtonLink variant="secondary" href={href("/events")}>返回赛事列表</ButtonLink>}/>
  <Card ornate className="flex flex-row flex-wrap items-center gap-x-10 gap-y-4">
   {[["比赛日期",e.event_date],["总积分",e.total_score],["总击杀（个人击败合计）",e.total_kills],["参赛人数",data.players.length]].map(([label,value])=><div key={label} className="grid gap-1"><span className="text-xs text-muted-foreground">{label}</span><strong className="font-heading text-2xl font-medium tabular-nums text-gold">{value}</strong></div>)}
   <Badge variant={active?"success":"destructive"}>{active?"有效":"已作废"}</Badge><span className="text-xs text-muted-foreground">第 {e.version} 版</span>
   {editor&&<span className="ml-auto flex flex-wrap gap-2">{active?<><Button variant="secondary" size="compact" onClick={()=>void open({kind:"score"})}>修改总积分</Button><Button variant="secondary" size="compact" onClick={()=>void open({kind:"date"})}>修改日期</Button><Button variant="secondary" size="compact" onClick={()=>void open({kind:"add"})}>补录玩家</Button><Button variant="destructive" size="compact" onClick={()=>void open({kind:"void"})}>作废整场</Button></>:<Button size="compact" onClick={()=>void open({kind:"restore"})}>恢复这场比赛</Button>}</span>}
  </Card>
  {!active&&<p className="m-0 text-sm text-muted-foreground">已作废：不计入赛事列表、个人参加或缺席统计，也不占用这一天。恢复前会检查这一天是否已有另一场有效比赛。</p>}
  <Field className="max-w-80"><FieldLabel htmlFor="event-search">搜索玩家</FieldLabel><Input id="event-search" type="search" placeholder="昵称或识别名" value={search} onChange={x=>setSearch(x.target.value)}/></Field>
  <Tabs defaultValue="output" className="flex flex-col gap-4"><TabsList aria-label="数据类别"><TabsTrigger value="output">输出</TabsTrigger><TabsTrigger value="strategy">战略</TabsTrigger></TabsList>
   <TabsContent value="output">{table(outputFields)}</TabsContent><TabsContent value="strategy">{table(strategyFields)}</TabsContent></Tabs>
  <Collapsible className="rounded-sm border border-border"><CollapsibleTrigger className="px-4 text-gold">修改历史 <span className="ml-auto text-xs text-muted-foreground">{data.versions.length} 个版本</span></CollapsibleTrigger>
   <CollapsibleContent className="px-4 pb-4"><ol className="m-0 grid list-none gap-2 p-0">{data.versions.map(v=><li key={v.version} className="flex flex-wrap items-center gap-3 border-b border-divider py-2 last:border-b-0"><span className="tabular-nums text-gold">第 {v.version} 版</span><Badge variant="outline">{actionNames[v.action]??v.action}</Badge><span className="text-sm text-muted-foreground">{time.format(new Date(v.created_at))}</span><Button variant="ghost" size="compact" className="ml-auto" onClick={()=>void open({kind:"version",version:v.version})}>查看</Button></li>)}</ol>
    <p className="mb-0 text-xs text-muted-foreground">操作人和完整修改内容见「操作日志」。</p></CollapsibleContent></Collapsible>
  {data.raw_text!==null&&<Collapsible className="rounded-sm border border-border"><CollapsibleTrigger className="px-4 text-gold">原始 AI JSON（仅本俱乐部可见）</CollapsibleTrigger><CollapsibleContent className="px-4 pb-4"><pre className="m-0 max-h-96 overflow-auto text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">{data.raw_text}</pre></CollapsibleContent></Collapsible>}

  <Dialog open={!!action&&["score","date","metrics","add","version"].includes(action.kind)} onOpenChange={o=>{if(!o)setAction(null);}}><DialogContent className="max-h-[90vh] overflow-y-auto">
   {action?.kind==="score"&&<><DialogTitle>修改总积分</DialogTitle><DialogDescription>只改本俱乐部这场的总积分；总击杀由个人击败自动合计，不能单独修改。</DialogDescription>
    <Field><FieldLabel htmlFor="edit-score">总积分</FieldLabel><Input id="edit-score" inputMode="numeric" value={score} onChange={x=>setScore(x.target.value)}/></Field>{actionError_}
    <div className="flex justify-end gap-3"><Button variant="ghost" onClick={()=>setAction(null)}>取消</Button><Button disabled={!scoreOk||Number(score)===e.total_score} loading={busy} loadingText="保存中…" onClick={()=>void save("score",{total_score:Number(score)},"总积分已更新")}>确认保存</Button></div></>}
   {action?.kind==="date"&&<><DialogTitle>修改比赛日期</DialogTitle><DialogDescription>同一场比赛只改日期，玩家战绩不变。目标日期已有另一场有效比赛时不能修改。</DialogDescription>
    <Field><FieldLabel htmlFor="edit-date">比赛日期</FieldLabel><Input id="edit-date" type="date" max={eventToday()} value={date} onChange={x=>setDate(x.target.value)}/></Field>{actionError_}
    <div className="flex justify-end gap-3"><Button variant="ghost" onClick={()=>setAction(null)}>取消</Button><Button disabled={!date||date===e.event_date||date>eventToday()} loading={busy} loadingText="保存中…" onClick={()=>void save("date",{event_date:date},"比赛日期已更新")}>确认保存</Button></div></>}
   {action?.kind==="metrics"&&target&&<><DialogTitle>修改 {target.display_name} 的数据</DialogTitle><DialogDescription>两类数据一起保存；0 是有效值，空白不能保存。</DialogDescription>
    <MetricInputs idPrefix="edit" values={values} onChange={setValues}/>{actionError_}
    <div className="flex justify-end gap-3"><Button variant="ghost" onClick={()=>setAction(null)}>取消</Button><Button disabled={!complete} loading={busy} loadingText="保存中…" onClick={()=>void save("metrics",{player_id:target.player_id,...values},"数据已更新")}>确认保存</Button></div></>}
   {action?.kind==="add"&&<><DialogTitle>补录参赛玩家</DialogTitle><DialogDescription>只在截图和 AI 同时漏掉某人时使用。必须同时填写输出和战略两类数据，记录会标注为人工补录。</DialogDescription>
    {!ids?(actionError_||<p role="status" className="m-0">正在读取玩家…</p>):<>
     <p className="m-0 text-sm">玩家：<strong className="text-gold">{pick?(isNew(pick)?`${pick.slice(4)}（新玩家）`:ids.players.find(p=>p.id===pick)?.display_name):"请在下方选择"}</strong></p>
     <AddPicker ids={ids} used={used} pick={pick} onPick={setPick}/>
     <MetricInputs idPrefix="add" values={values} onChange={setValues}/>{actionError_}
     <div className="flex justify-end gap-3"><Button variant="ghost" onClick={()=>setAction(null)}>取消</Button><Button disabled={!pick||!complete} loading={busy} loadingText="保存中…" onClick={()=>void save("add",{player_id:isNew(pick)?null:pick,name:isNew(pick)?pick.slice(4):null,...values},"已补录")}>确认补录</Button></div></>}</>}
   {action?.kind==="version"&&<><DialogTitle>第 {action.version} 版</DialogTitle>
    {!version?(actionError_||<p role="status" className="m-0">正在读取…</p>):<><DialogDescription>{version.state.event_date} · 总积分 {version.state.total_score} · {version.state.status==="active"?"有效":"已作废"} · {version.state.players.length} 人</DialogDescription>
     <Table containerClassName="max-h-96 overflow-auto"><TableHeader><TableRow><TableHead>玩家</TableHead>{metricFields.map(k=><TableHead key={k}>{metricLabels[k]}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{version.state.players.map(p=><TableRow key={p.player_id}><TableCell>{p.display_name??p.player_id}</TableCell>{metricFields.map(k=><TableCell key={k} className="tabular-nums">{p[k]}</TableCell>)}</TableRow>)}</TableBody></Table></>}
    <div className="flex justify-end"><Button variant="secondary" onClick={()=>setAction(null)}>关闭</Button></div></>}
  </DialogContent></Dialog>
  {action?.kind==="rebind"&&target&&(ids?<IdentityPicker open title={`${target.display_name} 的战绩属于谁？`} sourceName={target.output_name??target.display_name} players={ids.players}
   candidates={[...new Set([target.output_name,target.strategy_name].flatMap(n=>{const c=nameCandidates(n,ids.players,ids.aliases);return [...c.reliable,...c.similar];}))]} used={used} current={target.player_id}
   onClose={()=>setAction(null)} onPick={identity=>void save("rebind",{from_player:target.player_id,to_player:isNew(identity)?null:identity,name:isNew(identity)?identity.slice(4):null},"身份已改绑")}/>
   :<Dialog open onOpenChange={o=>{if(!o)setAction(null);}}><DialogContent><DialogTitle>改绑身份</DialogTitle>{actionError_||<p role="status" className="m-0">正在读取玩家…</p>}</DialogContent></Dialog>)}
  <AlertDialog open={!!action&&["remove","void","restore"].includes(action.kind)} onOpenChange={o=>{if(!o)setAction(null);}}><AlertDialogContent>
   <AlertDialogTitle>{action?.kind==="remove"?`移除 ${target?.display_name} 的本场记录？`:action?.kind==="void"?"作废整场比赛？":"恢复这场比赛？"}</AlertDialogTitle>
   <AlertDialogDescription>{action?.kind==="remove"?"只删除此人这一场的输出和战略数据，不删除玩家档案、别名或每日名单。可在修改历史中追溯。":action?.kind==="void"?"作废后不计入列表和个人统计，并释放这一天，可在「已作废」中恢复。":"恢复后重新计入统计；如这一天已有另一场有效比赛，将不能恢复。"}</AlertDialogDescription>
   {actionError_}
   <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary">取消</Button></AlertDialogCancel>
    <Button variant={action?.kind==="restore"?"primary":"destructive"} loading={busy} loadingText="处理中…" onClick={()=>void (action?.kind==="remove"&&target?save("remove",{player_id:target.player_id},"已移除本场记录"):save(action!.kind,{},action?.kind==="void"?"已作废":"已恢复"))}>{action?.kind==="remove"?"确认移除":action?.kind==="void"?"确认作废":"确认恢复"}</Button></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
 </main>;
}

/** Inline player choice for a manual addition: search existing players (not already in this event) or name a new one. */
function AddPicker({ids,used,pick,onPick}:{ids:Identities;used:Set<string>;pick:string;onPick:(identity:string)=>void}){
 const [search,setSearch]=useState(""),[name,setName]=useState("");
 const options=ids.players.filter(p=>!used.has(p.id)&&(!search.trim()||p.display_name.includes(search.trim()))).slice(0,50);
 return <div className="grid gap-2 rounded-sm border border-border p-3">
  <Field><FieldLabel htmlFor="add-search">搜索已有玩家</FieldLabel><Input id="add-search" type="search" value={search} onChange={x=>setSearch(x.target.value)}/></Field>
  <div className="grid max-h-40 gap-1 overflow-y-auto">{options.map(p=><Button key={p.id} variant="secondary" size="compact" className="justify-start" aria-pressed={pick===p.id} onClick={()=>onPick(p.id)}>{p.display_name}</Button>)}</div>
  <Field><FieldLabel htmlFor="add-new">或新增玩家（确实没有档案时）</FieldLabel><span className="flex gap-2"><Input id="add-new" maxLength={200} value={name} onChange={x=>setName(x.target.value)}/><Button variant="secondary" size="compact" disabled={!name.trim()} onClick={()=>onPick(`new:${name.trim()}`)}>使用</Button></span></Field>
 </div>;
}
