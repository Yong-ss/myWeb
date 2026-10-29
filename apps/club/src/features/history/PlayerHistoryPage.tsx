"use client";
import {ProfileSkeleton,LoadingState} from "../../components/feedback";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {clubFetch} from "../../lib/data-access";
import {useEffect,useState} from "react";
import Link from "next/link";
import {PageHeader} from "../../components/layout/PageHeader";
import {Button,ButtonLink} from "../../components/ui/Button";
import {Panel} from "../../components/ui/Panel";
import {presenceLabels, type playerTimeline} from "../../domain/presence";
type Archive={player:{id:string;display_name:string};next?:string|null;timeline:ReturnType<typeof playerTimeline>};
const eventLabels={first_seen:"首次记录",left:"暂时离会",rejoined:"重新加入"};
export function PlayerPage(){
  const [cursor,setCursor]=useState("");
  const [archive,setArchive]=useState<Archive|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(true),[retry,setRetry]=useState(0);
  useDataRefresh(()=>setRetry(n=>n+1));
  useEffect(()=>{const controller=new AbortController();async function load(){setBusy(true);setError("");try{
    const params=new URLSearchParams(window.location.search);const query=new URLSearchParams({player:params.get("id")??"",paged:"1"});if(cursor)query.set("before",cursor);if(params.has("date"))query.set("date",params.get("date")!);
    const response=await clubFetch(`/api/members?${query}`,{cache:"no-store",signal:controller.signal});
    if([401,403].includes(response.status)){window.location.replace("/login");return;}const data=await response.json();if(!response.ok)throw Error(data.error??"读取失败");if(!controller.signal.aborted)setArchive(old=>cursor&&old?{...data,timeline:[...new Map([...old.timeline,...data.timeline].map(row=>[row.date,row])).values()].sort((a,b)=>a.date.localeCompare(b.date))}:data);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"读取失败");}finally{if(!controller.signal.aborted)setBusy(false);}}void load();return()=>controller.abort();},[retry,cursor]);
  const timeline=archive?.timeline??[];
  return <><main className="club-workspace"><PageHeader eyebrow="PLAYER / 个人档案" title={archive?.player.display_name??"玩家档案"} actions={<ButtonLink variant="secondary" href="/members">返回名单</ButtonLink>}/>
    {busy&&!archive?<ProfileSkeleton label="正在读取档案…" />:error?<LoadingState status="error" detail={error} onRetry={()=>setRetry(n=>n+1)} />:<>
      <p className="muted">按每天最新版本展示；未识别的日期不补成 0。周活跃下降可能是周期重置。</p>
      <Panel><h2>离会与重返记录</h2>{timeline.some(r=>r.event)?<ol className="club-events">{timeline.filter(r=>r.event).map(r=><li key={r.date}><time>{r.date}</time> · {eventLabels[r.event as keyof typeof eventLabels]}</li>)}</ol>:<p>暂无记录。</p>}</Panel>
      <div className="members-table-wrap"><table className="members-table"><caption>历史数据 · 变化与上次有记录的数据比较</caption><thead><tr>{["日期","状态","当日昵称","职位","分组","等级","途径","非凡评分","评分变化","风尚度","风尚变化","周活跃","入会天数"].map(t=><th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{[...timeline].reverse().map(r=><tr key={r.date}><td><Link href={`/members?date=${r.date}`}>{r.date}</Link></td><td>{presenceLabels[r.status]}</td><td>{r.member?.name??"—"}</td><td>{r.member?.position??"—"}</td><td>{r.member?.group_name??"—"}</td><td>{r.member?.level??"—"}</td><td>{r.member?.pathway??"—"}</td><td>{r.member?.extraordinary_score??"—"}</td><td>{r.changes?.score?`${r.changes.score.amount>0?"+":""}${r.changes.score.amount}${r.changes.score.percent===null?"":` (${r.changes.score.percent.toFixed(1)}%)`}`:"—"}</td><td>{r.member?.prosperity??"—"}</td><td>{r.changes?.prosperity?.amount??"—"}</td><td>{r.member?.weekly_activity??"—"}{r.changes?.activity_reset?"（可能重置）":""}</td><td>{r.member?.join_days??"—"}</td></tr>)}</tbody></table></div>
      {archive?.next&&<Button loading={busy} loadingText="读取中…" onClick={()=>setCursor(archive.next!)}>更早记录</Button>}
      {!timeline.length&&<LoadingState status="empty" title="暂无历史记录" detail="该日期之前没有此玩家的记录。" />}
    </>}
  </main></>;
}
