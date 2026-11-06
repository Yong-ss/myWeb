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

type Summary={id:string;event_date:string;status:"active"|"voided";version:number;participants:number};
type Cursor={before:string;id:string};
export function DragonPage(){
 const href=useClubHref(),can=useClubCan();
 const [voided,setVoided]=useState(false),[events,setEvents]=useState<Summary[]|null>(null),[next,setNext]=useState<Cursor|null>(null);
 const [error,setError]=useState(""),[retry,setRetry]=useState(0),[more,setMore]=useState(false);
 useDataRefresh(()=>setRetry(n=>n+1));
 const read=(cursor?:Cursor)=>clubApi<{events:Summary[];next:Cursor|null}>(`/api/dragon-events?${new URLSearchParams({...(voided?{voided:"1"}:{}),...cursor})}`,undefined,"猎龙记录读取失败");
 useEffect(()=>{let active=true;read().then(d=>{if(active){setEvents(d.events);setNext(d.next);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[voided,retry]); // eslint-disable-line react-hooks/exhaustive-deps
 async function older(){if(!next)return;setMore(true);try{const d=await read(next);setEvents(old=>[...(old??[]),...d.events]);setNext(d.next);}catch(e){setError(e instanceof Error?e.message:"读取失败");}finally{setMore(false);}}
 const importLink=can("dragon.import")?<ButtonLink href={href("/dragon/import")}>导入出勤</ButtonLink>:undefined;
 return <main className="club-workspace club-events flex max-w-300 flex-col gap-6">
  <PageHeader eyebrow="DRAGON HUNT / 猎龙" title="猎龙" actions={importLink}/>
  <p className="m-0 -mt-4 text-sm text-muted-foreground">每天最多一次，只记录本俱乐部谁参加了。</p>
  <Tabs value={voided?"voided":"active"} onValueChange={v=>{setEvents(null);setError("");setVoided(v==="voided");}}><TabsList aria-label="记录状态"><TabsTrigger value="active">有效记录</TabsTrigger><TabsTrigger value="voided">已作废</TabsTrigger></TabsList></Tabs>
  {error?<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/>:!events?<TableSkeleton columns={2} label="正在读取猎龙记录…"/>:events.length?<>
   <Table containerClassName="members-table-wrap"><TableCaption>{voided?"已作废的记录不计入出勤":"按日期倒序"}</TableCaption>
    <TableHeader><TableRow><TableHead>日期</TableHead><TableHead>参加人数</TableHead></TableRow></TableHeader>
    <TableBody>{events.map(e=><TableRow key={e.id}><TableCell><Link className="text-gold" href={href(`/dragon/event?id=${e.id}`)}>{e.event_date}</Link></TableCell><TableCell className="tabular-nums">{e.participants}</TableCell></TableRow>)}</TableBody></Table>
   {next&&<Button variant="secondary" className="self-start" loading={more} loadingText="读取中…" onClick={older}>更早记录</Button>}
  </>:<LoadingState status="empty" title={voided?"没有已作废的记录":"还没有猎龙记录"} action={!voided?importLink:undefined}/>}
 </main>;
}
