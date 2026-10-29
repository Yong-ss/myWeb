"use client";
import {useEffect,useState} from "react";
import {useSearchParams} from "next/navigation";
import Link from "next/link";
import {motion} from "motion/react";
import {clubApi} from "../../lib/data-access";
import {ScoreBridge} from "./ScoreBridge";
import {growthSentence,signed} from "./insights";
import {Collapsible,CollapsibleTrigger,CollapsibleContent} from "../../components/ui/collapsible";
import {Card,CardTitle,CardDescription} from "../../components/ui/card";
import {Field,FieldLabel} from "../../components/ui/field";
import {NativeSelect,NativeSelectOption} from "../../components/ui/native-select";
import {Button} from "../../components/ui/button";
import {Badge} from "../../components/ui/badge";
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell} from "../../components/ui/table";
import {PathwayIcon,PathwayLabel} from "../../components/PathwayLabel";
import {enter,useMotion} from "../../components/ui/motion";
import {scoreGrowth,usableDates,validComparison,type ScoreData,type ScoreSnapshot} from "./score-growth";
const percent=(p:number|null)=>p===null?'—':`${p>0?'+':''}${p.toFixed(1)}%`;
export function ScoreGrowth({latest,previous,pending}:{latest:ScoreData|null;previous:ScoreData|null;pending:boolean}){
 const defaults=usableDates(latest?.snapshots??[]);
 // Dates can arrive in the URL from the overview link, so the analysis opens on the same comparison.
 const params=useSearchParams();
 const [chosenStart,setStart]=useState(params.get('from')??''),[chosenEnd,setEnd]=useState(params.get('to')??'');
 const defaultStart=defaults[1]||'';
 const start=chosenStart||defaults[1]||'',end=chosenEnd||defaults[0]||'';
 const [older,setOlder]=useState<ScoreSnapshot[]>([]),[cursor,setCursor]=useState<string|null>(null),[more,setMore]=useState(false),[moreError,setMoreError]=useState('');
 const [pair,setPair]=useState<{start:string;end:string;data:ReturnType<typeof scoreGrowth>}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false);
 const [all,setAll]=useState(false),[sort,setSort]=useState('growth');
 const [filter,setFilter]=useState('all'),[picking,setPicking]=useState(false);const transition=useMotion(enter);
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
 const datePicker=<Collapsible open={picking} onOpenChange={setPicking}><CollapsibleTrigger className="min-h-9 w-auto px-2 py-1 text-xs">比较 {start||"—"} → {end||"—"} · 更改日期</CollapsibleTrigger><CollapsibleContent className="grid gap-3 pt-3">
  <div className="flex flex-wrap items-end gap-4">{[['start','比较起始日期',start,setStart],['end','比较结束日期',end,setEnd]].map(([id,label,value,change])=><Field key={String(id)} className="min-w-40 flex-1"><FieldLabel htmlFor={`growth-${id}`}>{String(label)}</FieldLabel><NativeSelect id={`growth-${id}`} value={String(value)} onChange={e=>(change as (value:string)=>void)(e.target.value)}><NativeSelectOption value="">请选择日期</NativeSelectOption>{dates.map(date=><NativeSelectOption key={date} value={date}>{date}</NativeSelectOption>)}</NativeSelect></Field>)}
   {(cursor??latest?.next)&&<Button variant="secondary" loading={more} onClick={loadOlder}>更早比较日期</Button>}
  </div>
  {moreError&&<p role="alert">{moreError}</p>}
 </CollapsibleContent></Collapsible>;
 const playerHref=(id:string)=>`/players?${new URLSearchParams({id,date:end})}`;
 return <Card className="items-stretch" aria-label="非凡评分成长分析">
  <CardTitle>俱乐部总评分变化</CardTitle>
  {!validComparison(start,end)?<>{datePicker}<p role="status" className="text-sm text-muted-foreground">{dates.length<2?'至少需要两个不同日期的记录才能比较。':'起始日期必须早于结束日期。'}</p></>
  :error?<>{datePicker}<div role="alert">{error} <Button size="compact" onClick={()=>setRetry(n=>n+1)}>重试成长分析</Button></div></>
  :!result?<>{datePicker}<p role="status" className="min-h-40 text-sm text-muted-foreground">正在读取成长分析…</p></>
  :<motion.div key={`${start}-${end}`} initial={{opacity:0}} animate={{opacity:1}} transition={transition} className="grid min-w-0 gap-5">
   <div className="grid gap-2">
    <strong className={`block font-heading text-4xl font-medium tabular-nums ${result.totalChange<0?'text-destructive':'text-gold'}`}>{signed(result.totalChange)}{!result.exact&&<span className="ml-2 align-middle font-sans text-xs font-normal text-muted-foreground">（仅已知评分）</span>}</strong>
    <p className="m-0 text-sm">{growthSentence(result)}</p>
    {datePicker}
   </div>
   {!result.exact&&<p className="m-0 rounded-sm border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning">名单未确认完整或存在缺失评分：只比较已观察到的数据，不代表真实入会或离会。</p>}
   <ScoreBridge data={result}/>
   <section className="grid gap-3" aria-label="成员成长">
    <div className="flex items-center justify-between gap-3"><h3 className="m-0 text-sm">{all?"全部共同成员":"成长最多的成员"}</h3><Button variant="secondary" size="compact" onClick={()=>setAll(v=>!v)}>{all?"收起":"查看全部"}</Button></div>
    {!all?(result.rows.length?<ol className="m-0 grid list-none p-0" aria-label="成长 Top 5">{result.rows.slice(0,5).map((row,i)=><li key={row.player_id} className="grid grid-cols-[1.5rem_20px_minmax(0,1fr)_auto_3.75rem] items-center gap-3 border-b border-divider py-2 text-sm tabular-nums last:border-b-0">
      <span className="text-right font-heading text-muted-foreground">{i+1}</span><PathwayIcon pathway={row.pathway}/>
      <Link className="truncate text-foreground hover:text-gold" href={playerHref(row.player_id)}>{row.name??'未识别昵称'}</Link>
      <span className={row.difference>0?'text-success':row.difference<0?'text-destructive':'text-muted-foreground'}>{signed(row.difference)}</span>
      <span className="text-right text-xs text-muted-foreground">{percent(row.percentage)}</span></li>)}</ol>
     :<p className="m-0 text-sm text-muted-foreground">没有两个日期都有评分的共同成员。</p>)
    :<><div className="flex flex-wrap gap-4"><Field className="min-w-40 max-w-60 flex-1"><FieldLabel htmlFor="growth-filter">成长榜筛选</FieldLabel><NativeSelect id="growth-filter" value={filter} onChange={e=>setFilter(e.target.value)}>{[['all','全部共同成员'],['up','评分提升'],['down','评分下降'],['same','评分不变']].map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field><Field className="min-w-40 max-w-60 flex-1"><FieldLabel htmlFor="growth-sort">排序方式</FieldLabel><NativeSelect id="growth-sort" value={sort} onChange={e=>setSort(e.target.value)}>{[["growth","成长最多优先"],["decline","下降最多优先"],["score","结束评分最高"],["name","昵称顺序"]].map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field></div>
    <motion.div className="min-w-0" key={filter} initial={{opacity:0}} animate={{opacity:1}} transition={transition}>
    <Table containerClassName="max-h-110 overflow-auto"><TableHeader><TableRow>{['排名','昵称','途径','起始评分','结束评分','评分变化','变化百分比'].map(label=><TableHead className="sticky top-0 z-1" key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{ordered.map((row,i)=><TableRow key={row.player_id}><TableCell>{i+1}</TableCell><TableCell><Link className="text-gold" href={playerHref(row.player_id)}>{row.name??'未识别昵称'}</Link></TableCell><TableCell><PathwayLabel pathway={row.pathway}/></TableCell><TableCell>{row.start.toLocaleString()}</TableCell><TableCell>{row.end.toLocaleString()}</TableCell><TableCell><Badge variant={row.difference>0?'success':row.difference<0?'destructive':'outline'}>{row.difference>0?'提升':row.difference<0?'下降':'不变'} {signed(row.difference)}</Badge></TableCell><TableCell>{percent(row.percentage)}</TableCell></TableRow>)}{!ordered.length&&<TableRow><TableCell colSpan={7}>没有符合条件的共同成员。</TableCell></TableRow>}</TableBody></Table>
    </motion.div></>}
   </section>
   <Collapsible><CollapsibleTrigger>这些数字怎么算的？</CollapsibleTrigger><CollapsibleContent className="grid gap-3 px-3 pt-2 text-sm">
    <p className="m-0">开始 {result.startTotal.toLocaleString()} → 结束 {result.endTotal.toLocaleString()}。{result.exact?`总变化 ${signed(result.totalChange)} = 共同成员成长 ${signed(result.netGrowth)} + 只在结束日期出现 ${result.endingOnly} − 只在开始日期出现 ${result.startingOnly}。`:'缺失的评分不按 0 计算；成长榜只包含两个日期都有有效评分的同一成员。'}</p>
    <p className="m-0 text-muted-foreground">统计范围说明：开始日期有评分 {result.startCount-result.startMissing}/{result.startCount} 人，结束日期有评分 {result.endCount-result.endMissing}/{result.endCount} 人，可比较 {result.rows.length} 人；只在结束日期出现 {result.endingCount} 人，只在开始日期出现 {result.startingCount} 人。</p>
    <CardDescription>「只在某个日期出现」只表示两份记录的名单不同，不等于真实入会或离会。</CardDescription>
   </CollapsibleContent></Collapsible>
  </motion.div>}
 </Card>;
}
