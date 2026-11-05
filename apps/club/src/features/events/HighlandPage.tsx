"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {clubApi} from "../../lib/data-access";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {useClubCan,useClubHref} from "../../lib/useClub";
import {PageHeader} from "../../components/layout/PageHeader";
import {Button,ButtonLink} from "../../components/ui/button";
import {Tabs,TabsList,TabsTrigger} from "../../components/ui/tabs";
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from "../../components/ui/table";
import {LoadingState,TableSkeleton} from "../../components/feedback";

type Summary={id:string;event_date:string;status:"active"|"voided";version:number;total_score:number;faction:string|null;faction_rank:number|null;participants:number;total_kills:number;total_merit:number};
export function HighlandPage(){
 const href=useClubHref(),can=useClubCan();
 const [voided,setVoided]=useState(false),[events,setEvents]=useState<Summary[]|null>(null),[next,setNext]=useState<{before:string;id:string}|null>(null);
 const [error,setError]=useState(""),[retry,setRetry]=useState(0),[more,setMore]=useState(false);
 useDataRefresh(()=>setRetry(n=>n+1));
 const read=(cursor?:{before:string;id:string})=>clubApi<{events:Summary[];next:{before:string;id:string}|null}>(`/api/highland-events?${new URLSearchParams({...(voided?{voided:"1"}:{}),...cursor})}`,undefined,"赛事读取失败");
 useEffect(()=>{let active=true;read().then(d=>{if(active){setEvents(d.events);setNext(d.next);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[voided,retry]); // eslint-disable-line react-hooks/exhaustive-deps
 async function older(){if(!next)return;setMore(true);try{const d=await read(next);setEvents(old=>[...(old??[]),...d.events]);setNext(d.next);}catch(e){setError(e instanceof Error?e.message:"读取失败");}finally{setMore(false);}}
 const importLink=can("highland.import")?<ButtonLink href={href("/highland/import")}>导入比赛</ButtonLink>:undefined;
 return <main className="club-workspace club-events flex max-w-300 flex-col gap-6">
  <PageHeader eyebrow="HIGHLAND RACE / 高原竞逐" title="高原竞逐" actions={importLink}/>
  <p className="m-0 -mt-4 text-sm text-muted-foreground">每天最多一场。只记录本俱乐部的参赛者；势力名次是本势力在本场四个势力中的排名。</p>
  <Tabs value={voided?"voided":"active"} onValueChange={v=>{setEvents(null);setError("");setVoided(v==="voided");}}><TabsList aria-label="赛事状态"><TabsTrigger value="active">有效比赛</TabsTrigger><TabsTrigger value="voided">已作废</TabsTrigger></TabsList></Tabs>
  {error?<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/>:!events?<TableSkeleton columns={6} label="正在读取赛事…"/>:events.length?<>
   <Table containerClassName="members-table-wrap"><TableCaption>{voided?"已作废的比赛不计入任何统计，可在详情中恢复":"按比赛日期倒序"}</TableCaption>
    <TableHeader><TableRow><TableHead>比赛日期</TableHead><TableHead>势力</TableHead><TableHead>名次</TableHead><TableHead>总积分</TableHead><TableHead>战功合计</TableHead><TableHead>参赛人数</TableHead></TableRow></TableHeader>
    <TableBody>{events.map(e=><TableRow key={e.id}><TableCell><Link className="text-gold" href={href(`/highland/event?id=${e.id}`)}>{e.event_date}</Link></TableCell><TableCell>{e.faction??"—"}</TableCell><TableCell>{e.faction_rank?`第 ${e.faction_rank} 名`:"—"}</TableCell>
     <TableCell className="tabular-nums">{e.total_score}</TableCell><TableCell className="tabular-nums">{e.total_merit}</TableCell><TableCell className="tabular-nums">{e.participants}</TableCell></TableRow>)}</TableBody></Table>
   {next&&<Button variant="secondary" className="self-start" loading={more} loadingText="读取中…" onClick={older}>更早比赛</Button>}
  </>:<LoadingState status="empty" title={voided?"没有已作废的比赛":"还没有高原竞逐记录"} action={!voided?importLink:undefined}/>}
 </main>;
}
