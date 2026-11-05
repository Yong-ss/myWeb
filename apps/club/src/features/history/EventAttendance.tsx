"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {clubApi} from "../../lib/data-access";
import {useClubHref} from "../../lib/useClub";
import {Button} from "../../components/ui/button";
import {Card,CardTitle} from "../../components/ui/card";
import {Dialog,DialogContent,DialogDescription,DialogTitle,DialogTrigger} from "../../components/ui/dialog";
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from "../../components/ui/table";
import {LoadingState} from "../../components/feedback";
import {metricFields,metricLabels} from "../../domain/events";

type Attendance={attended:(Record<string,number>&{event_id:string;event_date:string})[];absent:{event_id:string;event_date:string}[];uncertain:number};
/** The player's attendance in this club for one event type: two numbers, each opening its list (docs §5). Counts come
 * from the database (club_player_events / club_player_highland, each counting its own type only), never from the page;
 * an absence has no result row and none is invented here. Defaults to the Four-Way League. */
export function EventAttendance({player,refresh,title="四方联赛",api="/api/player-events",detail="/event",fields=metricFields,labels=metricLabels}:{player:string;refresh:number;
 title?:string;api?:string;detail?:string;fields?:readonly string[];labels?:Record<string,string>}){
 const href=useClubHref();
 const [data,setData]=useState<Attendance|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;clubApi<Attendance>(`${api}?player=${encodeURIComponent(player)}`,undefined,`${title}统计读取失败`).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[player,refresh,retry,api,title]);
 const eventLink=(id:string,date:string)=><Link className="text-gold" href={href(`${detail}?id=${id}&player=${player}`)}>{date}</Link>;
 return <Card ornate className="items-stretch"><CardTitle>{title}</CardTitle>
  {error?<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/>:!data?<p role="status" className="m-0 text-sm text-muted-foreground">正在读取…</p>:<>
   <div className="flex flex-wrap gap-3">
    <Dialog><DialogTrigger asChild><Button variant="secondary">参加 <strong className="tabular-nums">{data.attended.length}</strong> 场</Button></DialogTrigger>
     <DialogContent className="max-h-[90vh] w-[min(64rem,calc(100vw-2rem))] overflow-y-auto"><DialogTitle>参加的{title}</DialogTitle><DialogDescription>本俱乐部有效比赛中本人的输出和战略数据。点日期查看整场。</DialogDescription>
      {data.attended.length?<Table containerClassName="max-h-[60vh] overflow-auto"><TableHeader><TableRow><TableHead>比赛日期</TableHead>{fields.map(k=><TableHead key={k}>{labels[k]}</TableHead>)}</TableRow></TableHeader>
       <TableBody>{data.attended.map(r=><TableRow key={r.event_id}><TableCell>{eventLink(r.event_id,r.event_date)}</TableCell>{fields.map(k=><TableCell key={k} className="tabular-nums">{r[k]}</TableCell>)}</TableRow>)}</TableBody></Table>:<p className="m-0 text-sm text-muted-foreground">还没有参赛记录。</p>}
     </DialogContent></Dialog>
    <Dialog><DialogTrigger asChild><Button variant="secondary">缺席 <strong className="tabular-nums">{data.absent.length}</strong> 场</Button></DialogTrigger>
     <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogTitle>缺席的{title}</DialogTitle><DialogDescription>只计成员记录能确认当天在会、但没有参赛的有效比赛；本人在这些场次没有战绩。</DialogDescription>
      {data.absent.length?<ul className="m-0 grid list-none gap-2 p-0">{data.absent.map(r=><li key={r.event_id} className="border-b border-divider py-2 last:border-b-0">{eventLink(r.event_id,r.event_date)}</li>)}</ul>:<p className="m-0 text-sm text-muted-foreground">没有确认的缺席。</p>}
      {data.uncertain>0&&<p className="m-0 text-sm text-muted-foreground">另有 {data.uncertain} 场因暂离、待确认或缺少前后成员记录，资格不确定，未计入缺席。</p>}
     </DialogContent></Dialog>
   </div>
   <p className="m-0 text-xs text-muted-foreground">入会前、退会后、暂离和资格不确定的场次不计缺席；已作废的比赛不计入。</p>
  </>}
 </Card>;
}
