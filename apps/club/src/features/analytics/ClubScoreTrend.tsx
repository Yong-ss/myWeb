"use client";
import {presenceText} from "../../domain/presence";
import {useEffect,useRef,useState} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {clubApi} from '../../lib/data-access';
import {useDataRefresh} from '../../lib/useDataRefresh';
import {ScoreTrend,scoreText} from '../../components/ScoreTrend';
import {groupScores,referenceDate,scoreDifference,type ScorePoint,type Granularity} from '../../lib/score-history';
import {Sheet,SheetContent,SheetTitle,SheetDescription,SheetHeader,SheetClose} from '../../components/ui/sheet';
import {Button} from '../../components/ui/button';
import {Collapsible,CollapsibleTrigger,CollapsibleContent} from '../../components/ui/collapsible';
import {signed} from './insights';
import {Field,FieldLabel} from '../../components/ui/field';
import {NativeSelect,NativeSelectOption} from '../../components/ui/native-select';
import {Table,TableHeader,TableHead,TableRow,TableBody,TableCell} from '../../components/ui/table';
import {PathwayIcon,PathwayLabel} from '../../components/PathwayLabel';
import {scoreGrowth,type ScoreData,type ScoreMember} from './score-growth';
import {useClubHref} from "../../lib/useClub";
type Page={points:ScorePoint[];next:string|null};
export function ClubScoreTrend(){
 const returnFocus=useRef<HTMLElement|null>(null);
 const params=useSearchParams(),router=useRouter(),pathname=usePathname(),href=useClubHref();
 const raw=params.get('period'),unit:Granularity=raw==='week'||raw==='month'||raw==='year'?raw:'day';
 const selected=params.get('date')??params.get('to')??'',chosenRef=params.get('ref')??params.get('from')??'';
 const [points,setPoints]=useState<ScorePoint[]>([]),[next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [inspection,setInspection]=useState({date:'',ref:''}),[pair,setPair]=useState<{date:string;ref:string;a:ScoreData;b:ScoreData}|null>(null),[detailError,setDetailError]=useState('');
 const [mode,setMode]=useState(chosenRef?'custom':'previous'),[filter,setFilter]=useState('all');
 useDataRefresh(()=>setRetry(n=>n+1));
 const update=(changes:Record<string,string>)=>{const q=new URLSearchParams(params.toString());q.delete('to');q.delete('from');for(const [key,value] of Object.entries(changes)){if(value)q.set(key,value);else q.delete(key);}router.replace(`${pathname}?${q}`,{scroll:false});};
 useEffect(()=>{const controller=new AbortController();async function load(){setBusy(true);setError('');try{
  const data=await clubApi<Page>('/api/members?trend=1',{signal:controller.signal});if(controller.signal.aborted)return;
  setPoints(data.points);setNext(data.next);
 }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'评分历史读取失败');}finally{if(!controller.signal.aborted)setBusy(false);}}void load();return()=>controller.abort();},[retry]);
 async function older(){if(!next)return;setBusy(true);setError('');try{
  const data=await clubApi<Page>(`/api/members?trend=1&before=${next}`);if(data.next&&data.next>=next)throw Error('历史游标无效');
  setPoints(old=>[...new Map([...old,...data.points].map(p=>[p.date,p])).values()]);setNext(data.next);
  if(selected&&chosenRef==='unavailable'){const found=referenceDate(selected,mode,[...points,...data.points].map(p=>p.date));if(found)update({ref:found});}
 }catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setBusy(false);}}
 const displayed=groupScores(points,unit),selectedPoint=points.find(p=>p.date===selected);
 const previous=displayed.filter(p=>p.date<selected).at(-1)?.date??'';
 const reference=chosenRef==='unavailable'?'':chosenRef||previous;
 const date=selected||inspection.date,ref=selected?reference:inspection.ref;
 useEffect(()=>{if(!date)return;const controller=new AbortController();
  async function load(){setDetailError('');try{
   if(ref&&ref>=date)throw Error('对比日期必须早于选中日期');
   const read=async(d:string)=>{const data=await clubApi<ScoreData>(`/api/members?date=${d}`,{signal:controller.signal});if(!data.snapshot||data.snapshot.snapshot_date!==d||data.snapshot.is_current===false)throw Error('所选日期的当前记录已不可用');return data;};
   const [b,a]=await Promise.all([read(date),ref?read(ref):Promise.resolve(null)]);
   const expected=points.find(p=>p.date===date),expectedRef=points.find(p=>p.date===ref);
   if((expected?.snapshotId&&expected.snapshotId!==b.snapshot?.id)||(expectedRef?.snapshotId&&expectedRef.snapshotId!==a?.snapshot?.id))throw Error('记录版本已更新，请重试评分历史后再比较');
   if(!controller.signal.aborted)setPair({date,ref,a:a??{snapshot:null,snapshots:[],members:[]},b});
  }catch(e){if(!controller.signal.aborted)setDetailError(e instanceof Error?e.message:'详情读取失败');}}
  void load();return()=>controller.abort();
 },[date,ref,retry,points]);
 const detail=pair?.date===date&&pair?.ref===ref?pair:null;
 const growth=detail?.a.snapshot&&detail.b.snapshot&&ref<date?scoreGrowth(detail.a,detail.b):null;
 const validRows=growth?.rows??[];
 const filtered=filter==='all'?validRows:validRows.filter(r=>filter==='down'?r.difference<0:r.difference>0);
 const ordered=filter==='down'?[...filtered].sort((a,b)=>a.difference-b.difference):filtered;
 const shown=ordered;
 const present=(d:ScoreData)=>d.members.filter(r=>r.presence==='present'&&(!r.data_date||r.data_date===d.snapshot?.snapshot_date));
 const ending=detail?.a.snapshot?present(detail.b).filter(r=>!present(detail.a).some(a=>a.player_id===r.player_id)):[];
 const starting=detail?.a.snapshot?present(detail.a).filter(r=>!present(detail.b).some(b=>b.player_id===r.player_id)):[];
 const list=(rows:ScoreMember[],endOnly:boolean)=><ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-sm">{rows.map(r=><li key={r.player_id} className="max-w-full"><Link className="group/member inline-flex min-h-11 max-w-full items-center gap-2 rounded-sm px-2 py-1 text-foreground no-underline transition-[background-color,color] duration-150 ease-club-feedback hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none" href={href(`/players?${new URLSearchParams({id:r.player_id,date:selected})}`)}><PathwayIcon pathway={r.pathway}/><span className="grid min-w-0 flex-1 gap-1"><span className="truncate transition-colors duration-150 group-hover/member:text-gold group-focus-visible/member:text-gold">{r.name??'未识别昵称'}</span>{(endOnly?detail?.a:detail?.b)?.members.some(m=>m.player_id===r.player_id&&m.presence!=='present')&&<span className="text-xs text-muted-foreground">{endOnly?'上次'+presenceText(detail?.a.members.find(m=>m.player_id===r.player_id)?.presence==='left'?'left':'unconfirmed',detail?.a.members.find(m=>m.player_id===r.player_id)?.absence_decision):presenceText(detail?.b.members.find(m=>m.player_id===r.player_id)?.presence==='left'?'left':'unconfirmed',detail?.b.members.find(m=>m.player_id===r.player_id)?.absence_decision)}</span>}{(endOnly?detail?.a:detail?.b)?.members.find(m=>m.player_id===r.player_id)?.absence_reason&&<span className="max-w-48 whitespace-normal text-xs text-muted-foreground">{(endOnly?detail?.a:detail?.b)?.members.find(m=>m.player_id===r.player_id)?.absence_reason}</span>}</span><span aria-hidden="true" className="text-muted-foreground transition-transform duration-150 ease-club-feedback group-hover/member:translate-x-0.5 group-hover/member:text-gold group-focus-visible/member:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none">→</span></Link></li>)}{!rows.length&&<li className="text-muted-foreground">暂无</li>}</ul>;

 return <div className="grid min-w-0 gap-4">
  {error&&<p role="alert">{error} <Button size="compact" onClick={()=>setRetry(n=>n+1)}>重试评分历史</Button></p>}
  {busy&&!points.length?<p role="status">正在读取评分历史…</p>:<ScoreTrend title="俱乐部总评分趋势" points={points} unit={unit} onUnit={period=>update({period})} selected={selected}
    onInspect={(p,prior)=>setInspection({date:p.date,ref:prior?.date??''})}
    onSelect={(p,prior)=>{returnFocus.current=document.activeElement as HTMLElement;setMode('previous');setFilter('all');update({date:p.date,ref:prior?.date??''});}}
    info={()=>detailError?<span className="text-muted-foreground">{detailError}</span>:growth?<div className="grid gap-1 text-xs"><span>变化较大：{[...growth.rows].sort((a,b)=>Math.abs(b.difference)-Math.abs(a.difference)).slice(0,3).map(r=>`${r.name??'未识别'} ${r.difference>0?'+':''}${r.difference}`).join('、')||'暂时没有可对比的评分'}</span><span>这次名单多了 {ending.length} 人；已确认退会 {starting.filter(r=>detail?.b.members.some(b=>b.player_id===r.player_id&&b.presence==='left'&&b.absence_decision==='left')).length} 人。</span></div>:<span className="text-xs text-muted-foreground">{ref?'正在查看变化…':'没有更早的记录'}</span>}/>
  }
  <p className="m-0 text-xs text-muted-foreground">{points.length?`已加载 ${[...points].sort((a,b)=>a.date.localeCompare(b.date))[0].date} 至 ${[...points].sort((a,b)=>a.date.localeCompare(b.date)).at(-1)!.date} · 空心点表示资料不完整；部分资料仅显示已知评分。`:'尚无保存的评分历史。'}</p>
  {next&&<Button variant="secondary" loading={busy} onClick={older}>更早评分记录</Button>}
  <Sheet open={Boolean(selected)} onOpenChange={open=>{if(!open)update({date:'',ref:''});}}><SheetContent onCloseAutoFocus={event=>{event.preventDefault();returnFocus.current?.focus();}} className="w-[min(48rem,100vw)]" aria-describedby="score-detail-description">
   <SheetHeader><SheetTitle>{selected} · 评分详情</SheetTitle><SheetClose asChild><Button variant="secondary" size="compact">关闭</Button></SheetClose></SheetHeader>
   <div className="grid min-w-0 gap-5 px-4"><strong className="font-heading text-3xl font-medium text-gold tabular-nums">{scoreText(selectedPoint?.score??null)}</strong><SheetDescription id="score-detail-description">{selectedPoint?.partial?'资料没录全 · ':''}{reference?`和 ${reference} 相比`:'还没有更早的记录'}</SheetDescription>
    <p className="m-0 text-sm">总评分变化：{scoreDifference(points.find(p=>p.date===reference),selectedPoint)===null?'资料没录全，暂时没法比较':scoreDifference(points.find(p=>p.date===reference),selectedPoint)!.toLocaleString()}</p>
    <Collapsible><CollapsibleTrigger>换个日期比较</CollapsibleTrigger><CollapsibleContent className="grid gap-3 pt-2">
    <Field><FieldLabel htmlFor="score-reference-mode">和哪天比</FieldLabel><NativeSelect id="score-reference-mode" value={mode} onChange={e=>{setMode(e.target.value);if(e.target.value!=='custom')update({ref:e.target.value==='previous'?previous:referenceDate(selected,e.target.value,points.map(p=>p.date))||'unavailable'});}}>{[['previous','图上前一个点'],['available','最近一次记录'],['week','上一周'],['month','上一月'],['custom','自己选日期']].map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field>
    {mode==='custom'&&<Field><FieldLabel htmlFor="score-reference-date">选择日期</FieldLabel><NativeSelect id="score-reference-date" value={reference} onChange={e=>update({ref:e.target.value})}><NativeSelectOption value="">请选择日期</NativeSelectOption>{points.filter(p=>p.date<selected).sort((a,b)=>b.date.localeCompare(a.date)).map(p=><NativeSelectOption key={p.date} value={p.date}>{p.date}</NativeSelectOption>)}</NativeSelect></Field>}
    {next&&<Button variant="secondary" loading={busy} onClick={older}>找更早的记录</Button>}
    </CollapsibleContent></Collapsible>
    {detailError?<p role="alert">{detailError} <Button size="compact" onClick={()=>setRetry(n=>n+1)}>重试详情</Button></p>:!growth?<p role="status">{reference?'正在查看变化…':'还没有更早的记录可比较。'}</p>:<>
     <p className={growth.exact?"m-0 text-sm":"m-0 text-sm text-warning"}>{growth.exact?(!growth.rows.length?'还没有能比较两天评分的成员。':growth.netGrowth>0?`同一批成员合计涨了 ${growth.netGrowth.toLocaleString()} 分。${growth.totalChange<0?'总分下降主要受名单变化影响。':''}`:growth.netGrowth<0?`同一批成员合计降了 ${Math.abs(growth.netGrowth).toLocaleString()} 分。${growth.totalChange>0?'总分上涨主要来自名单变化。':''}`:'同一批成员的评分没有变化。'):'有些资料没录全，暂时看不全变化。'}</p>
     <div className="grid gap-5">{[['涨得最多',growth.rows.filter(r=>r.difference>0).slice(0,3)],['跌得最多',[...growth.rows].filter(r=>r.difference<0).sort((a,b)=>a.difference-b.difference).slice(0,3)]].map(([title,items])=><section key={String(title)}><h3 className="mb-2 mt-0 text-sm text-muted-foreground">{String(title)}</h3><ol className="m-0 grid list-none gap-2 p-0">{(items as typeof growth.rows).map(r=><li key={r.player_id} className="flex min-h-11 items-center gap-3 border-b border-divider py-2"><PathwayIcon pathway={r.pathway}/><Link className="min-w-0 flex-1 truncate text-sm text-gold" href={href(`/players?${new URLSearchParams({id:r.player_id,date:selected})}`)}>{r.name??'未识别昵称'}</Link><span className={`text-sm tabular-nums ${r.difference>0?'text-success':'text-destructive'}`}>{signed(r.difference)}</span></li>)}{!(items as typeof growth.rows).length&&<li className="text-sm text-muted-foreground">暂无{title==='涨得最多'?'提升':'下降'}记录</li>}</ol></section>)}</div>
     <Collapsible><CollapsibleTrigger>查看所有人的变化</CollapsibleTrigger><CollapsibleContent className="grid min-w-0 gap-3 pt-3">
     <Field><FieldLabel htmlFor="score-change-filter">想看哪些人</FieldLabel><NativeSelect id="score-change-filter" value={filter} onChange={e=>setFilter(e.target.value)}>{[['up','涨得最多'],['down','评分下降'],['all','全部可比较的成员']].map(([v,l])=><NativeSelectOption key={v} value={v}>{l}</NativeSelectOption>)}</NativeSelect></Field>
     <Table><TableHeader><TableRow>{['成员','途径','之前评分','这次评分','涨跌','涨跌幅'].map(t=><TableHead key={t}>{t}</TableHead>)}</TableRow></TableHeader><TableBody>{shown.map(r=><TableRow key={r.player_id}><TableCell><Link className="text-gold" href={href(`/players?${new URLSearchParams({id:r.player_id,date:selected})}`)}>{r.name??'未识别昵称'}</Link></TableCell><TableCell><PathwayLabel pathway={r.pathway}/></TableCell><TableCell>{r.start.toLocaleString()}</TableCell><TableCell>{r.end.toLocaleString()}</TableCell><TableCell>{r.difference>0?'+':''}{r.difference.toLocaleString()}</TableCell><TableCell>{r.percentage===null?'—':`${r.percentage.toFixed(1)}%`}</TableCell></TableRow>)}{!shown.length&&<TableRow><TableCell colSpan={6}>没有符合条件的成员。</TableCell></TableRow>}</TableBody></Table>
     </CollapsibleContent></Collapsible>
     <section className="grid gap-2 border-t border-divider pt-4"><div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground"><h3 className="m-0 text-sm font-medium">和上次名单相比</h3><span className="tabular-nums">多 {ending.length} 人 · {growth.exact?'':'已知 '}+{growth.endingOnly.toLocaleString()} 分</span><span className="tabular-nums">少 {starting.length} 人 · {growth.exact?'':'已知 '}−{growth.startingOnly.toLocaleString()} 分</span></div><Collapsible><CollapsibleTrigger>看看是谁</CollapsibleTrigger><CollapsibleContent className="grid gap-3"><section><h3 className="mb-2 mt-0 text-xs font-medium text-muted-foreground">这次多了谁</h3>{list(ending,true)}</section><section><h3 className="mb-2 mt-0 text-xs font-medium text-muted-foreground">这次少了谁</h3>{list(starting,false)}</section><p className="m-0 text-xs text-muted-foreground">名单变化不一定代表入会或离会。</p></CollapsibleContent></Collapsible></section>
    </>}
   </div>
  </SheetContent></Sheet>
 </div>;
}
