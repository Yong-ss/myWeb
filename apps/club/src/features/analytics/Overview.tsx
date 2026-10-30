"use client";
import {LoadingState} from "../../components/feedback";
import {scoreGrowth,validComparison} from "./score-growth";
import Link from "next/link";

import {PathwayDonut} from "./PathwayDonut";
import {clubInsights,signed} from "./insights";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {clubApi} from "../../lib/data-access";
import {useEffect,useState} from "react";
import {Card} from "../../components/ui/card";
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
  if(view==="pathways")return <PathwayDonut members={data?.members??[]} loading={busy&&!data}/>;

  const date=data?.snapshot?.snapshot_date,priorDate=previous?.snapshot?.snapshot_date;
  const present=(d:Data|null)=>d?.members.filter(r=>r.presence==='present').length??0;
  const strength=date&&priorDate&&validComparison(priorDate,date)?scoreGrowth(previous!,data!):null;
  const countChange=previous?.snapshot?present(data)-present(previous):null;
  const insights=data?.snapshot?clubInsights({complete:data.snapshot.is_complete_roster,hasPrior:data.snapshots.length>1,comparing,comparisonError:Boolean(comparisonError),growth:strength,from:priorDate,to:date}):[];
  const metric=(label:string,value:string|number,note?:string)=><div className="grid gap-1"><span className="text-xs text-muted-foreground">{label}</span><strong className="font-heading text-2xl font-medium text-foreground tabular-nums">{value}</strong>{note&&<span className="text-xs text-muted-foreground">{note}</span>}</div>;
  return <section className="grid gap-6" aria-label="俱乐部近况">
    <div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-muted-foreground">最新记录 {date??"读取中…"}</span>{data?.snapshot&&<Badge variant={data.snapshot.is_complete_roster?"success":"warning"}>{data.snapshot.is_complete_roster?"已确认完整":"名单未确认完整"}</Badge>}</div>
    <Card ornate className="grid grid-cols-[auto_1fr] items-end gap-8 max-sm:grid-cols-1 max-sm:gap-5">
      <div className="grid gap-1"><span className="eyebrow">明确在会</span><strong className="gold-title font-heading text-5xl leading-none font-medium tabular-nums">{data?present(data):"—"}<span className="ml-1 font-sans text-sm text-muted-foreground">人</span></strong></div>
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        {metric("比上次记录",countChange===null?"—":countChange===0?"持平":signed(countChange),priorDate?`对比 ${priorDate}`:comparing?"读取中…":"暂无上次记录")}
        {strength?.rows.length?metric("共同成员评分成长",signed(strength.netGrowth),strength.exact?`${strength.rows.length} 位共同成员`:`${strength.rows.length} 位共同成员 · 仅已知评分`):null}
      </div>
    </Card>
    {data?.snapshot&&<section aria-label="最近值得关注" className="grid gap-2"><h2 className="m-0 text-sm font-medium text-muted-foreground">最近值得关注</h2>
      {insights.length?<ul className="m-0 grid list-none gap-2 p-0">{insights.map(i=><li key={i.text} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-sm border px-4 py-3 text-sm ${i.tone==='warning'?'border-warning/40 bg-warning-bg text-warning':'border-divider'}`}><span>{i.text}</span>{i.href&&<Link className="text-gold" href={i.href}>{i.action} →</Link>}</li>)}</ul>
      :<p className="m-0 rounded-sm border border-divider px-4 py-3 text-sm text-muted-foreground">名单完整，最近没有需要特别处理的变化。</p>}
    </section>}
  </section>;
}
