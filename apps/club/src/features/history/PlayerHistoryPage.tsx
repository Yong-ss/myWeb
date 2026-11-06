"use client";
import {ScoreTrend} from "../../components/ScoreTrend";
import type {Granularity} from "../../lib/score-history";
import {PathwayIcon,PathwayLabel} from "../../components/PathwayLabel";
import {ProfileSkeleton,LoadingState} from "../../components/feedback";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {clubApi} from "../../lib/data-access";
import {useEffect,useState} from "react";
import Link from "next/link";
import {PageHeader} from "../../components/layout/PageHeader";
import {Button,ButtonLink} from "../../components/ui/button";
import {Card,CardTitle} from "../../components/ui/card";
import {Badge} from "../../components/ui/badge";
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from "../../components/ui/table";
import {presenceText, type playerTimeline} from "../../domain/presence";
import {useClubCan,useClubHref} from "../../lib/useClub";
import {EventAttendance} from "./EventAttendance";
import {highlandFields,highlandLabels} from "../../domain/highland";
type Archive={player:{id:string;display_name:string};next?:string|null;timeline:ReturnType<typeof playerTimeline>};
const eventLabels={first_seen:"首次记录",left:"不在会",rejoined:"重新加入"};
const eventVariant={first_seen:"info",left:"destructive",rejoined:"success"} as const;
const headings=["日期","状态","当日昵称","职位","分组","等级","途径","非凡评分","评分变化","风尚度","风尚变化","周活跃","入会天数"];
export function PlayerPage(){
  const href=useClubHref(),can=useClubCan();
  const [unit,setUnit]=useState<Granularity>("day");
  const [cursor,setCursor]=useState("");
  const [archive,setArchive]=useState<Archive|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(true),[retry,setRetry]=useState(0);
  useDataRefresh(()=>setRetry(n=>n+1));
  useEffect(()=>{const controller=new AbortController();async function load(){setBusy(true);setError("");try{
    const params=new URLSearchParams(window.location.search);const query=new URLSearchParams({player:params.get("id")??"",paged:"1"});if(cursor)query.set("before",cursor);
    const data=await clubApi<Archive>(`/api/members?${query}`,{signal:controller.signal},"读取失败");if(!controller.signal.aborted)setArchive(old=>cursor&&old?{...data,timeline:[...new Map([...old.timeline,...data.timeline].map(row=>[row.date,row])).values()].sort((a,b)=>a.date.localeCompare(b.date))}:data);
  }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"读取失败");}finally{if(!controller.signal.aborted)setBusy(false);}}void load();return()=>controller.abort();},[retry,cursor]);
  const timeline=archive?.timeline??[];
  const events=timeline.filter(r=>r.event);
  const latestMember=timeline.findLast(r=>r.member)?.member;
  return <main className="club-workspace club-history flex flex-col gap-6"><PageHeader eyebrow="PLAYER / 个人档案" title={<span className="inline-flex items-center gap-3">{archive&&<PathwayIcon pathway={latestMember?.pathway} />}<span className="[overflow-wrap:anywhere]">{archive?.player.display_name??"玩家档案"}</span></span>} actions={<ButtonLink variant="secondary" href={href("/members")}>返回名单</ButtonLink>}/>
    {busy&&!archive?<ProfileSkeleton label="正在读取档案…" />:error?<LoadingState status="error" detail={error} onRetry={()=>setRetry(n=>n+1)} />:<>
      <p className="m-0 -mt-6 text-sm text-muted-foreground">按每天最新版本展示；未识别的日期不补成 0。周活跃下降可能是周期重置。</p>
      {can("events.read")&&archive&&<EventAttendance player={archive.player.id} refresh={retry}/>}
      {can("highland.read")&&archive&&<EventAttendance player={archive.player.id} refresh={retry} title="高原竞逐" api="/api/player-highland" detail="/highland/event" fields={highlandFields} labels={highlandLabels}/>}
      {can("dragon.read")&&archive&&<EventAttendance player={archive.player.id} refresh={retry} title="猎龙" api="/api/player-dragon" detail="/dragon/event" fields={[]}/>}
      <ScoreTrend title="个人非凡评分趋势" unit={unit} onUnit={setUnit} points={timeline.flatMap(row=>row.member?[{date:row.date,score:typeof row.member.extraordinary_score==='number'&&Number.isFinite(row.member.extraordinary_score)?row.member.extraordinary_score:null,partial:typeof row.member.extraordinary_score!=='number'||!Number.isFinite(row.member.extraordinary_score),missing:typeof row.member.extraordinary_score==='number'&&Number.isFinite(row.member.extraordinary_score)?0:1}]:[])}/>
      <Card ornate className="items-stretch"><CardTitle>离会与重返记录</CardTitle>{events.length?<ol className="club-events m-0 list-none p-0">{events.map(r=><li key={r.date} className="relative flex items-center gap-3 border-b border-divider py-3 pl-6 last:border-b-0 before:absolute before:left-1 before:size-2 before:rotate-45 before:bg-brass">
        <time className="text-gold tabular-nums">{r.date}</time><Badge variant={eventVariant[r.event as keyof typeof eventVariant]}>{r.event==="left"?presenceText(r.status,r.absence_decision):eventLabels[r.event as keyof typeof eventLabels]}</Badge>{r.absence_reason&&<span className="text-sm text-muted-foreground">{r.absence_reason}</span>}</li>)}</ol>:<p className="m-0 text-sm text-muted-foreground">暂无记录。</p>}</Card>
      <Table containerClassName="members-table-wrap"><TableCaption>历史数据 · 变化与上次有记录的数据比较</TableCaption><TableHeader><TableRow>{headings.map(t=><TableHead key={t}>{t}</TableHead>)}</TableRow></TableHeader><TableBody>{[...timeline].reverse().map(r=><TableRow key={r.date}>
        <TableCell className="sticky left-0 z-1 bg-card font-medium text-gold"><Link href={href(`/members?date=${r.date}`)} className="text-gold">{r.date}</Link></TableCell><TableCell>{presenceText(r.status,r.absence_decision)}{r.absence_reason&&<span className="block max-w-48 whitespace-normal text-xs text-muted-foreground">{r.absence_reason}</span>}</TableCell><TableCell>{r.member?.name??"—"}</TableCell><TableCell>{r.member?.position??"—"}</TableCell><TableCell>{r.member?.group_name??"—"}</TableCell><TableCell>{r.member?.level??"—"}</TableCell><TableCell><PathwayLabel pathway={r.member?.pathway} /></TableCell><TableCell>{r.member?.extraordinary_score??"—"}</TableCell>
        <TableCell className={r.changes?.score?r.changes.score.amount>0?"text-success":r.changes.score.amount<0?"text-destructive":"":""}>{r.changes?.score?`${r.changes.score.amount>0?"+":""}${r.changes.score.amount}${r.changes.score.percent===null?"":` (${r.changes.score.percent.toFixed(1)}%)`}`:"—"}</TableCell>
        <TableCell>{r.member?.prosperity??"—"}</TableCell><TableCell>{r.changes?.prosperity?.amount??"—"}</TableCell><TableCell>{r.member?.weekly_activity??"—"}{r.changes?.activity_reset?"（可能重置）":""}</TableCell><TableCell>{r.member?.join_days??"—"}</TableCell></TableRow>)}</TableBody></Table>
      {archive?.next&&<Button className="self-start" loading={busy} loadingText="读取中…" onClick={()=>setCursor(archive.next!)}>更早记录</Button>}
      {!timeline.length&&<LoadingState status="empty" title="暂无历史记录" detail="此玩家还没有每日记录。" />}
    </>}
  </main>;
}
