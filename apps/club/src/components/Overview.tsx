"use client";
import {useDataRefresh} from "./useDataRefresh";
import {clubFetch} from "../lib/data-access";
import {useEffect,useState} from "react";
import Link from "next/link";
import {Panel} from "./ui/Panel";
import {Button} from "./ui/Button";
type Row={player_id:string;name:string|null;presence?:string;extraordinary_score:number|null;prosperity:number|null};
type Snapshot={snapshot_date:string;is_complete_roster:boolean};
type Data={snapshot:Snapshot|null;snapshots:Snapshot[];members:Row[];snapshot_count?:number};
export function Overview(){
  const [data,setData]=useState<Data|null>(null),[previous,setPrevious]=useState<Data|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(true),[retry,setRetry]=useState(0);
  const [comparing,setComparing]=useState(false),[comparisonError,setComparisonError]=useState("");
  useDataRefresh(()=>setRetry(n=>n+1));
  useEffect(()=>{const controller=new AbortController();async function load(){setBusy(true);setError("");try{
    async function read(query=""):Promise<Data>{const response=await clubFetch(`/api/members${query}`,{cache:"no-store",signal:controller.signal});if([401,403].includes(response.status)){window.location.replace("/login");throw Error("请重新登录");}const value=await response.json();if(!response.ok)throw Error(value.error??"暂时无法读取总览");return value;}
    const latest=await read();if(controller.signal.aborted)return;
    const priorDate=latest.snapshots[1]?.snapshot_date;
    setData(latest);setPrevious(old=>old?.snapshot?.snapshot_date===priorDate?old:null);setBusy(false);setComparing(Boolean(priorDate));setComparisonError("");
    if(priorDate)try{
      const prior=await read(`?date=${priorDate}`);
      if(!controller.signal.aborted)setPrevious(prior?.snapshot?prior:null);
    }catch(e){if(!controller.signal.aborted)setComparisonError(e instanceof Error?e.message:"对比数据读取失败");}
    finally{if(!controller.signal.aborted)setComparing(false);}
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"读取失败");}finally{if(!controller.signal.aborted)setBusy(false);}}void load();return()=>controller.abort();},[retry]);
  if(busy&&!data)return <section aria-busy="true" aria-label="总览数据加载中"><div className="club-stats">{["本次记录","首次出现","本次暂离","重新出现"].map(label=><Panel key={label}><span className="muted">{label}</span><strong>—</strong></Panel>)}</div><Panel><h2>最近两次记录人数</h2><p role="status" className="club-loading">正在读取数据…</p></Panel><div className="club-account-actions"><Panel><h2>本次成员变化</h2><p className="muted">—</p></Panel><Panel><h2>非凡评分前十</h2><p className="muted">—</p></Panel></div></section>;
  if(error)return <p role="alert" className="feedback error">{error} <Button onClick={()=>setRetry(n=>n+1)}>重试</Button></p>;
  if(!data?.snapshot)return <Panel><h2>还没有每日记录</h2><p>从侧栏导入第一份数据后，这里会显示统计。</p></Panel>;
  const current=data.members.filter(r=>!r.presence||r.presence==='present');
  const priorPresent=previous?.members.filter(r=>!r.presence||r.presence==='present')??[];
  const returning=current.filter(r=>previous?.members.some(p=>p.player_id===r.player_id&&p.presence==='left'));
  const additions=previous?current.filter(r=>!previous.members.some(p=>p.player_id===r.player_id)):[];
  const departures=data.members.filter(r=>r.presence==='left'&&previous?.members.some(p=>p.player_id===r.player_id&&p.presence!=='left'));
  const rank=[...current].filter(r=>r.extraordinary_score!==null).sort((a,b)=>b.extraordinary_score!-a.extraordinary_score!).slice(0,10);
  const counts=previous?[{date:previous.snapshot!.snapshot_date,value:previous.snapshot_count??priorPresent.length},{date:data.snapshot.snapshot_date,value:data.snapshot_count??current.length}]:[{date:data.snapshot.snapshot_date,value:data.snapshot_count??current.length}];
  const max=Math.max(1,...counts.map(r=>r.value));
  return <><p className="muted">{data.snapshot.snapshot_date}{comparing?" · 正在读取对比…":comparisonError?" · 对比暂不可用":previous?.snapshot?` · 对比 ${previous.snapshot.snapshot_date}`:" · 首次记录，暂无对比"}</p>
    {comparisonError&&<p role="alert">{comparisonError} <Button onClick={()=>setRetry(n=>n+1)}>重试对比</Button></p>}
    <div className="club-stats">{[["本次记录",current.length],["首次出现",previous?additions.length:"—"],["本次暂离",previous?departures.length:"—"],["重新出现",previous?returning.length:"—"]].map(([label,value])=><Panel key={label}><span className="muted">{label}</span><strong>{value}</strong></Panel>)}</div>
    {!data.snapshot.is_complete_roster&&<p className="conflict">本次未确认完整，缺席不新增离会判断。</p>}
    <Panel><h2>最近两次记录人数</h2><p className="muted">记录人数不等于实际在会人数。</p>{counts.map(r=><div className="club-count-bar" key={r.date}><span>{r.date}</span><meter min={0} max={max} value={r.value} aria-label={`${r.date} 记录人数`}/><strong>{r.value}</strong></div>)}</Panel>
    <div className="club-account-actions"><Panel><h2>本次成员变化</h2>{comparing&&!previous?<p role="status">正在读取对比…</p>:comparisonError?<p>对比暂不可用。</p>:!previous?<p>至少两次记录后显示。</p>:<><p>首次出现：{additions.map(r=>r.name??"未识别").join("、")||"无"}</p><p>暂时离会：{departures.map(r=>r.name??"未识别").join("、")||"无"}</p><p>重新出现：{returning.map(r=>r.name??"未识别").join("、")||"无"}</p><p className="muted">首次出现是首次记录，不代表真实入会日期。</p></>}</Panel>
    <Panel><h2>非凡评分前十</h2>{rank.length?<ol>{rank.map(r=><li key={r.player_id}><Link href={`/players?id=${r.player_id}&date=${data.snapshot!.snapshot_date}`}>{r.name??"未识别"}</Link> · {r.extraordinary_score}</li>)}</ol>:<p>暂无评分数据。</p>}</Panel></div>
  </>;
}
