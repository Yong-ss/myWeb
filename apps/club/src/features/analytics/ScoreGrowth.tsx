"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {motion} from "motion/react";
import {clubApi} from "../../lib/data-access";
import {ScoreBridge} from "./ScoreBridge";
import {Collapsible,CollapsibleTrigger,CollapsibleContent} from "../../components/ui/collapsible";
import {Card,CardTitle,CardDescription} from "../../components/ui/card";
import {Field,FieldLabel} from "../../components/ui/field";
import {NativeSelect,NativeSelectOption} from "../../components/ui/native-select";
import {Button} from "../../components/ui/button";
import {Badge} from "../../components/ui/badge";
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from "../../components/ui/table";
import {PathwayLabel} from "../../components/PathwayLabel";
import {enter,useMotion} from "../../components/ui/motion";
import {scoreGrowth,usableDates,validComparison,type ScoreData,type ScoreSnapshot} from "./score-growth";
const signed=(n:number)=>`${n>0?'+':''}${n.toLocaleString('zh-CN')}`;
export function ScoreGrowth({latest,previous,pending}:{latest:ScoreData|null;previous:ScoreData|null;pending:boolean}){
 const defaults=usableDates(latest?.snapshots??[]);
 const [chosenStart,setStart]=useState(''),[chosenEnd,setEnd]=useState('');
 const defaultStart=defaults[1]||'';
 const start=chosenStart||defaults[1]||'',end=chosenEnd||defaults[0]||'';
 const [older,setOlder]=useState<ScoreSnapshot[]>([]),[cursor,setCursor]=useState<string|null>(null),[more,setMore]=useState(false),[moreError,setMoreError]=useState('');
 const [pair,setPair]=useState<{start:string;end:string;data:ReturnType<typeof scoreGrowth>}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false);
 const [all,setAll]=useState(false),[sort,setSort]=useState('growth');
 const [filter,setFilter]=useState('all');const transition=useMotion(enter);
 useEffect(()=>{
  if(!validComparison(start,end))return;
  const controller=new AbortController();
  async function load(){setBusy(true);setError('');try{
   const read=async(date:string)=>{
    const existing=[latest,previous].find(d=>d?.snapshot?.snapshot_date===date);
    const data=existing??await clubApi<ScoreData>(`/api/members?date=${date}`,{signal:controller.signal});
    if(!data?.snapshot||data.snapshot.snapshot_date!==date||data.snapshot.is_current===false)throw Error('所选日期的当前版本已不可用，请重新选择日期');
    return data;
   };
   // The overview already owns this request; wait for its result instead of duplicating it.
   if(pending&&start===defaultStart)return;
   const [a,b]=await Promise.all([read(start),read(end)]);
   const data=scoreGrowth(a,b);if(!controller.signal.aborted)setPair({start,end,data});
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'成长分析读取失败');}finally{if(!controller.signal.aborted)setBusy(false);}}
  void load();return()=>controller.abort();
 },[start,end,latest,previous,pending,retry,defaultStart]);
 async function loadOlder(){setMore(true);setMoreError('');try{
  const before=cursor??latest?.next;if(!before)return;
  const data=await clubApi<ScoreData>(`/api/members?before=${before}`);
  if(data.next&&data.next>=before)throw Error('历史日期游标无效');
  setOlder(old=>[...old,...data.snapshots]);setCursor(data.next??'');
 }catch(e){setMoreError(e instanceof Error?e.message:'历史日期读取失败');}finally{setMore(false);}}
 const dates=usableDates([...(latest?.snapshots??[]),...older]);
 const ready=!busy&&!pending&&!error&&pair?.start===start&&pair?.end===end&&validComparison(start,end);
 const result=ready?pair.data:null;
 const filteredRows=result?.rows.filter(r=>filter==='all'||(filter==='up'?r.difference>0:filter==='down'?r.difference<0:r.difference===0))??[];
 const ordered=[...filteredRows].sort((a,b)=>sort==='decline'?a.difference-b.difference:sort==='score'?b.end-a.end:sort==='name'?(a.name??'').localeCompare(b.name??'','zh-CN'):b.difference-a.difference);
 const rows=all?ordered:result?.rows.slice(0,5)??[];
 return <Card className="items-stretch" aria-label="非凡评分成长分析">
  <CardTitle>非凡评分成长分析</CardTitle>
  <p className="m-0 text-sm text-muted-foreground">{start||"—"} → {end||"—"}</p>
  <Collapsible><CollapsibleTrigger>更改日期</CollapsibleTrigger><CollapsibleContent>
  <div className="flex flex-wrap items-end gap-4">{[['start','比较起始日期',start,setStart],['end','比较结束日期',end,setEnd]].map(([id,label,value,change])=><Field key={String(id)} className="min-w-40 flex-1"><FieldLabel htmlFor={`growth-${id}`}>{String(label)}</FieldLabel><NativeSelect id={`growth-${id}`} value={String(value)} onChange={e=>(change as (value:string)=>void)(e.target.value)}><NativeSelectOption value="">请选择日期</NativeSelectOption>{dates.map(date=><NativeSelectOption key={date} value={date}>{date}</NativeSelectOption>)}</NativeSelect></Field>)}
   {(cursor??latest?.next)&&<Button variant="secondary" loading={more} onClick={loadOlder}>更早比较日期</Button>}
  </div>
  {moreError&&<p role="alert">{moreError}</p>}
  </CollapsibleContent></Collapsible>
  {!validComparison(start,end)?<p role="status" className="text-sm text-muted-foreground">{dates.length<2?'至少需要两个不同日期的记录才能比较。':'起始日期必须早于结束日期。'}</p>:error?<div role="alert">{error} <Button size="compact" onClick={()=>setRetry(n=>n+1)}>重试成长分析</Button></div>:!result?<p role="status" className="min-h-40 text-sm text-muted-foreground">正在读取成长分析…</p>:<motion.div key={`${start}-${end}`} initial={{opacity:0}} animate={{opacity:1}} transition={transition} className="grid min-w-0 gap-4">
   {!result.exact&&<p className="m-0 rounded-sm border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning">名单未确认完整或存在缺失评分：仅比较已观察到的数据，不据此认定真实入会、离会，也不宣称精确分解。</p>}
   <div><p className="m-0 text-xs text-muted-foreground">俱乐部已知总评分变化</p><strong className="mt-2 block font-heading text-4xl text-gold tabular-nums">{signed(result.totalChange)}</strong><p className="mb-0 text-sm">同一批可比较成员贡献 {signed(result.netGrowth)}；名单构成的已知净贡献 {signed(result.endingOnly-result.startingOnly)}。</p></div>
   <ScoreBridge data={result}/>
   <Collapsible><CollapsibleTrigger>计算明细与数据覆盖</CollapsibleTrigger><CollapsibleContent className="grid gap-3 pt-3">
   <dl className="m-0 grid grid-cols-2 gap-4 max-md:grid-cols-1">{[['既有成员净成长',result.netGrowth],['俱乐部已知评分总变化',result.totalChange],['仅结束日期出现 · 评分贡献',result.endingOnly],['仅起始日期出现 · 评分贡献',result.startingOnly]].map(([label,value])=><div key={label} className="border-b border-divider pb-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="m-0 mt-2 font-heading text-xl text-gold tabular-nums">{signed(Number(value))}</dd></div>)}</dl>
   <p className="m-0 text-sm text-muted-foreground">起始有效评分 {result.startCount-result.startMissing}/{result.startCount} 人；结束有效评分 {result.endCount-result.endMissing}/{result.endCount} 人；可比较 {result.rows.length} 人。仅结束日期出现 {result.endingCount} 人，仅起始日期出现 {result.startingCount} 人。</p>
   <p className="m-0 text-sm">起始已知总分 {result.startTotal.toLocaleString()} → 结束已知总分 {result.endTotal.toLocaleString()}。{result.exact?`总变化 ${signed(result.totalChange)} = 既有成长 ${signed(result.netGrowth)} + 结束独有贡献 ${result.endingOnly} − 起始独有贡献 ${result.startingOnly}。`:'评分缺失不补零；下方只排名两天都有有效评分的同一成员。'}</p>
   <CardDescription>「仅某日期出现」是名单构成差异，不等于实际入会或离会；负增长保留为真实观察值。</CardDescription>
   </CollapsibleContent></Collapsible>
   <div className="flex items-center justify-between gap-3"><h3 className="m-0 text-sm">{all?"成员成长明细":"成员成长 Top 5"}</h3><Button variant="secondary" size="compact" onClick={()=>setAll(v=>!v)}>{all?"收起明细":"查看全部"}</Button></div>
   {all&&<><Field className="max-w-60"><FieldLabel htmlFor="growth-filter">成长榜筛选</FieldLabel><NativeSelect id="growth-filter" value={filter} onChange={e=>setFilter(e.target.value)}>{[['all','全部匹配成员'],['up','评分提升'],['down','评分下降'],['same','评分不变']].map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field><Field className="max-w-60"><FieldLabel htmlFor="growth-sort">排序方式</FieldLabel><NativeSelect id="growth-sort" value={sort} onChange={e=>setSort(e.target.value)}>{[["growth","成长最多优先"],["decline","下降最多优先"],["score","结束评分最高"],["name","昵称顺序"]].map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field></>}
   <motion.div className="min-w-0" key={filter} initial={{opacity:0}} animate={{opacity:1}} transition={transition}>
   <Table containerClassName="max-h-110 overflow-auto"><TableHeader><TableRow>{['排名','昵称','途径','起始评分','结束评分','评分变化','变化百分比'].map(label=><TableHead className="sticky top-0 z-1" key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row,i)=><TableRow key={row.player_id}><TableCell>{i+1}</TableCell><TableCell><Link className="text-gold" href={`/players?${new URLSearchParams({id:row.player_id,date:end})}`}>{row.name??'未识别昵称'}</Link></TableCell><TableCell><PathwayLabel pathway={row.pathway}/></TableCell><TableCell>{row.start.toLocaleString()}</TableCell><TableCell>{row.end.toLocaleString()}</TableCell><TableCell><Badge variant={row.difference>0?'success':row.difference<0?'destructive':'outline'}>{row.difference>0?'提升':row.difference<0?'下降':'不变'} {signed(row.difference)}</Badge></TableCell><TableCell>{row.percentage===null?'—':`${row.percentage>0?'+':''}${row.percentage.toFixed(1)}%`}</TableCell></TableRow>)}{!rows.length&&<TableRow><TableCell colSpan={7}>没有符合条件的可比较成员。</TableCell></TableRow>}</TableBody></Table>
   </motion.div>
  </motion.div>}
 </Card>;
}
