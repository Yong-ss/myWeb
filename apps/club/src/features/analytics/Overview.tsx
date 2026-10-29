"use client";
import {TableSkeleton,LoadingState} from "../../components/feedback";
import {scoreGrowth,validComparison} from "./score-growth";
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from "../../components/ui/collapsible";
import {ButtonLink} from "../../components/ui/button";
import {ScoreGrowth} from "./ScoreGrowth";
import {PathwayDonut} from "./PathwayDonut";
import {RosterChart} from "./RosterChart";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {clubApi} from "../../lib/data-access";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Card,CardDescription,CardTitle} from "../../components/ui/card";
import {Button} from "../../components/ui/button";
import {Badge} from "../../components/ui/badge";
type Row={data_date?:string;pathway?:string|null;player_id:string;name:string|null;presence?:string;extraordinary_score:number|null;prosperity:number|null};
type Snapshot={id?:string;revision?:number;is_current?:boolean;snapshot_date:string;is_complete_roster:boolean};
type Data={snapshot:Snapshot|null;snapshots:Snapshot[];members:Row[];snapshot_count?:number;next?:string|null};
export function Overview({view}:{view?:"growth"|"pathways"}){
  const compare=view!=="pathways";
  const [data,setData]=useState<Data|null>(null),[previous,setPrevious]=useState<Data|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(true),[retry,setRetry]=useState(0);
  const [comparing,setComparing]=useState(false),[comparisonError,setComparisonError]=useState("");
  useDataRefresh(()=>setRetry(n=>n+1));
  useEffect(()=>{const controller=new AbortController();async function load(){setBusy(true);setError("");try{
    const read=(query="")=>clubApi<Data>(`/api/members${query}`,{signal:controller.signal},"暂时无法读取总览");
    const latest=await read();if(controller.signal.aborted)return;
    const priorDate=latest.snapshots[1]?.snapshot_date;
    setData(latest);setPrevious(old=>old?.snapshot?.snapshot_date===priorDate?old:null);setBusy(false);setComparing(Boolean(priorDate)&&compare);setComparisonError("");
    if(priorDate&&compare)try{
      const prior=await read(`?date=${priorDate}`);
      if(!controller.signal.aborted)setPrevious(prior?.snapshot?prior:null);
    }catch(e){if(!controller.signal.aborted)setComparisonError(e instanceof Error?e.message:"对比数据读取失败");}
    finally{if(!controller.signal.aborted)setComparing(false);}
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"读取失败");}finally{if(!controller.signal.aborted)setBusy(false);}}void load();return()=>controller.abort();},[retry,compare]);
  if(error)return <LoadingState status="error" detail={error} onRetry={()=>setRetry(n=>n+1)} />;
  if(!busy&&!data?.snapshot)return <LoadingState status="empty" title="还没有每日记录" detail="从侧栏导入第一份数据后，这里会显示统计。" />;
  const current=(data?.members??[]).filter(r=>!r.presence||r.presence==='present');
  const priorPresent=previous?.members.filter(r=>!r.presence||r.presence==='present')??[];
  const returning=current.filter(r=>previous?.members.some(p=>p.player_id===r.player_id&&p.presence==='left'));
  const additions=previous?current.filter(r=>!previous.members.some(p=>p.player_id===r.player_id)):[];
  const departures=(data?.members??[]).filter(r=>r.presence==='left'&&previous?.members.some(p=>p.player_id===r.player_id&&p.presence!=='left'));
  const rank=[...current].filter(r=>r.extraordinary_score!==null).sort((a,b)=>b.extraordinary_score!-a.extraordinary_score!).slice(0,10);
  const counts=!data?.snapshot?[]:previous?[{date:previous.snapshot!.snapshot_date,value:previous.snapshot_count??priorPresent.length},{date:data?.snapshot?.snapshot_date??"—",value:data?.snapshot_count??current.length}]:[{date:data?.snapshot?.snapshot_date??"—",value:data?.snapshot_count??current.length}];
  const names=(rows:Row[])=>rows.map(r=>r.name??"未识别").join("、")||"无";

  // Fixed panel heights: numbers fill in place as each request returns, nothing below moves.
  const details=<section className="club-overview m-0 grid gap-6" aria-label={busy&&!data?"总览数据加载中":"总览数据"} aria-busy={busy&&!data}>
    <p className="club-overview-date m-0 min-h-[1.6em] text-sm text-muted-foreground">{busy&&!data?"正在读取记录日期…":data?.snapshot?.snapshot_date??"—"}{busy&&!data?"":comparing?" · 正在读取对比…":comparisonError?" · 对比暂不可用":previous?.snapshot?` · 对比 ${previous.snapshot.snapshot_date}`:" · 首次记录，暂无对比"}</p>
    {comparisonError&&<p role="alert" className="m-0 flex flex-wrap items-center gap-3 rounded-sm border border-destructive bg-error-bg px-4 py-3 text-sm text-destructive">{comparisonError} <Button size="compact" onClick={()=>setRetry(n=>n+1)}>重试对比</Button></p>}
    <div className="club-stats grid grid-cols-4 gap-4 max-md:grid-cols-2">{([["本次记录",data?current.length:"—"],["首次出现",previous?additions.length:"—"],["本次暂离",previous?departures.length:"—"],["重新出现",previous?returning.length:"—"]] as const).map(([label,value],i)=><Card key={label} ornate={i===0} className="gap-2">
      <span className="eyebrow">{label}</span><strong className="gold-title font-heading text-[2rem] leading-none font-medium tabular-nums">{value}</strong></Card>)}</div>
    {data?.snapshot&&!data.snapshot.is_complete_roster&&<p className="m-0 rounded-sm border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-warning">本次未确认完整，仅明确确认的缺席会标记离会。</p>}
    <Card className="club-overview-counts min-h-75 items-stretch"><CardTitle>人数总览</CardTitle><RosterChart counts={counts} loading={busy&&!data||comparing}/></Card>
    <div className="grid grid-cols-[1.2fr_1fr] gap-6 max-md:grid-cols-1 max-md:gap-4">
      <Card className="club-overview-changes min-h-90 items-stretch"><CardTitle>本次成员变化</CardTitle>{(busy&&!data||comparing&&!previous)?<p role="status" className="m-0 text-sm text-muted-foreground">正在读取对比…</p>:comparisonError?<p className="m-0 text-sm">对比暂不可用。</p>:!previous?<p className="m-0 text-sm text-muted-foreground">至少两次记录后显示。</p>:<dl className="m-0 grid gap-3 text-sm">
        {([["首次出现",additions,"info"],["暂时离会",departures,"destructive"],["重新出现",returning,"success"]] as const).map(([label,rows,variant])=><div key={label} className="grid gap-1 border-b border-divider pb-3"><dt><Badge variant={variant}>{label}</Badge></dt><dd className="m-0">{label}：{names(rows)}</dd></div>)}
        <CardDescription>首次出现是首次记录，不代表真实入会日期。</CardDescription></dl>}</Card>
      <Card className="club-overview-ranking h-105 min-h-105 items-stretch overflow-auto"><CardTitle>非凡评分前十</CardTitle>{busy&&!data?<TableSkeleton rows={4} columns={2} label="正在读取排名…" />:rank.length?<ol className="m-0 list-none p-0">{rank.map((r,i)=><li key={r.player_id} className="flex items-center gap-3 border-b border-divider py-2 text-sm tabular-nums last:border-b-0">
        <span className="w-6 text-right font-heading text-muted-foreground">{i+1}</span><Link href={`/players?id=${r.player_id}&date=${data?.snapshot?.snapshot_date??""}`} className="min-w-0 flex-1 truncate text-foreground hover:text-gold">{r.name??"未识别"}</Link> · <span className="text-gold">{r.extraordinary_score}</span></li>)}</ol>:<p className="m-0 text-sm text-muted-foreground">暂无评分数据。</p>}</Card>
    </div>

  </section>;
  if(view==="pathways")return <PathwayDonut members={data?.members??[]} loading={busy&&!data}/>;
  if(view==="growth")return <div className="grid gap-6"><ScoreGrowth latest={data} previous={previous} pending={busy||comparing}/><Collapsible><CollapsibleTrigger>更多记录：人数趋势、成员变化与评分排名</CollapsibleTrigger><CollapsibleContent>{details}</CollapsibleContent></Collapsible></div>;
  const strength=data?.snapshot&&previous?.snapshot&&validComparison(previous.snapshot.snapshot_date,data.snapshot.snapshot_date)?scoreGrowth(previous,data):null;
  return <section className="grid gap-6" aria-label="俱乐部近况">
    <div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-muted-foreground">最新记录 {data?.snapshot?.snapshot_date??"读取中…"}</span>{data?.snapshot&&<Badge variant={data.snapshot.is_complete_roster?"success":"warning"}>{data.snapshot.is_complete_roster?"已确认完整":"名单未确认完整"}</Badge>}</div>
    <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">{[["明确在会",data?data.members.filter(r=>r.presence==='present').length:"—"],["首次记录",previous?additions.length:"—"],["本次暂离",previous?departures.length:"—"],["重新出现",previous?returning.length:"—"]].map(([label,value])=><Card key={label} className="gap-2"><span className="text-xs text-muted-foreground">{label}</span><strong className="font-heading text-3xl text-gold tabular-nums">{value}</strong></Card>)}</div>
    <Card className="items-stretch"><CardTitle>近期实力</CardTitle><p className="m-0 text-sm">{strength?`既有成员已知评分净变化 ${strength.netGrowth>0?'+':''}${strength.netGrowth.toLocaleString()}，俱乐部已知总分变化 ${strength.totalChange>0?'+':''}${strength.totalChange.toLocaleString()}。`:comparing?"正在读取最近对比…":"至少两个日期的有效记录后显示实力变化。"}</p>{strength&&!strength.exact&&<CardDescription>名单或评分资料不完整，仅作已观察数据参考。</CardDescription>}<Link className="text-sm text-gold" href="/analytics?view=growth">查看实力成长 →</Link></Card>
    <p className="m-0 text-sm text-muted-foreground">近期变化按相邻记录比较；首次记录不代表真实入会，未确认完整时不推断缺席即离会。{comparisonError&&"最近对比暂不可用，可到数据分析重试。"}</p>
    <nav aria-label="俱乐部快捷操作" className="flex flex-wrap gap-3"><ButtonLink href="/members">查看成员</ButtonLink><ButtonLink variant="secondary" href="/import">导入数据</ButtonLink><ButtonLink variant="secondary" href="/analytics?view=pathways">查看途径分布</ButtonLink></nav>
  </section>;
}
