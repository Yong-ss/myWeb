"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {toast} from "../../components/ui/sonner";
import {clubApi} from "../../lib/data-access";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {useClubCan,useClubHref} from "../../lib/useClub";
import {PageHeader} from "../../components/layout/PageHeader";
import {Button,ButtonLink} from "../../components/ui/button";
import {Badge} from "../../components/ui/badge";
import {Card} from "../../components/ui/card";
import {Notice} from "../../components/ui/notice";
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle,AlertDialogTrigger} from "../../components/ui/alert-dialog";
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from "../../components/ui/table";
import {LoadingState,TableSkeleton} from "../../components/feedback";

type Detail={event:{id:string;event_date:string;status:"active"|"voided";version:number};players:{player_id:string;display_name:string;read_name:string|null}[]};

export function DragonDetailPage(){
 const href=useClubHref(),can=useClubCan();
 const [data,setData]=useState<Detail|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0),[focus,setFocus]=useState("");
 const [busy,setBusy]=useState(false),[voidError,setVoidError]=useState(""),[open,setOpen]=useState(false);
 const attempt=useRef("");
 useDataRefresh(()=>setRetry(n=>n+1));
 useEffect(()=>{let active=true;const q=new URLSearchParams(window.location.search);
  clubApi<Detail>(`/api/dragon-event?id=${encodeURIComponent(q.get("id")??"")}`,undefined,"猎龙记录读取失败").then(d=>{if(active){setData(d);setError("");setFocus(q.get("player")??"");}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 useEffect(()=>{if(focus&&data)document.getElementById(`dragon-row-${focus}`)?.scrollIntoView({block:"center"});},[focus,data]);
 const header=(title:string)=><PageHeader eyebrow="DRAGON HUNT / 记录详情" title={title} actions={<ButtonLink variant="secondary" href={href("/dragon")}>返回猎龙记录</ButtonLink>}/>;
 if(error)return <main className="club-workspace club-events flex flex-col gap-6">{header("猎龙")}<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/></main>;
 if(!data)return <main className="club-workspace club-events flex flex-col gap-6">{header("猎龙")}<TableSkeleton columns={2} label="正在读取猎龙记录…"/></main>;
 const e=data.event,active=e.status==="active";
 async function voidIt(){
  setBusy(true);setVoidError("");
  attempt.current||=crypto.randomUUID();
  try{
   await clubApi("/api/dragon-event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event_id:e.id,expected_version:e.version,request_id:attempt.current})},"作废失败，请重试");
   attempt.current="";setOpen(false);toast.success(`已作废 ${e.event_date} 的猎龙记录`,{description:"这一天可以重新导入。"});setRetry(n=>n+1);
  }catch(err){setVoidError(err instanceof Error?err.message:"作废失败，请重试");}finally{setBusy(false);}
 }
 return <main className="club-workspace club-events flex max-w-300 flex-col gap-6">
  {header(`${e.event_date} 猎龙`)}
  <Card className="w-full">
   <div className="flex flex-wrap items-center justify-between gap-3"><p className="m-0 text-sm">参加 <strong className="tabular-nums text-gold">{data.players.length}</strong> 人 {!active&&<Badge variant="warning">已作废</Badge>}</p>
    {active&&can("dragon.edit")&&<AlertDialog open={open} onOpenChange={o=>{if(!busy)setOpen(o);}}><AlertDialogTrigger asChild><Button variant="destructive" size="compact">作废这次记录</Button></AlertDialogTrigger>
     <AlertDialogContent><AlertDialogTitle>作废 {e.event_date} 的猎龙记录？</AlertDialogTitle>
      <AlertDialogDescription>作废后不计入任何人的出勤，这一天可以重新导入。作废不能撤销，操作会记入日志。</AlertDialogDescription>
      {voidError&&<Notice variant="destructive" role="alert">{voidError}</Notice>}
      <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary" disabled={busy}>取消</Button></AlertDialogCancel><Button variant="destructive" loading={busy} loadingText="作废中…" onClick={()=>void voidIt()}>确认作废</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>}
    {!active&&can("dragon.import")&&<ButtonLink variant="secondary" size="compact" href={href("/dragon/import")}>重新导入</ButtonLink>}</div>
   <Table containerClassName="members-table-wrap"><TableCaption>按玩家名字排序</TableCaption>
    <TableHeader><TableRow><TableHead>玩家</TableHead><TableHead>截图上的名字</TableHead></TableRow></TableHeader>
    <TableBody>{data.players.map(p=><TableRow key={p.player_id} id={`dragon-row-${p.player_id}`} data-state={p.player_id===focus?"selected":undefined}>
     <TableCell><Link className="text-gold" href={href(`/players?id=${p.player_id}`)}>{p.display_name}</Link></TableCell><TableCell className="text-muted-foreground">{p.read_name??"—"}</TableCell></TableRow>)}</TableBody></Table>
  </Card>
 </main>;
}
