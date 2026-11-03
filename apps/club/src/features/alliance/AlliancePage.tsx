"use client";
import {useEffect,useState} from "react";
import {toast} from "sonner";
import {clubApi} from "../../lib/data-access";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {clubHref} from "../../lib/club-context";
import {PageHeader} from "../../components/layout/PageHeader";
import {LoadingState} from "../../components/feedback";
import {Card,CardDescription,CardTitle} from "../../components/ui/card";
import {Badge} from "../../components/ui/badge";
import {Button,ButtonLink} from "../../components/ui/button";
import {FieldError} from "../../components/ui/field";
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle,AlertDialogTrigger} from "../../components/ui/alert-dialog";
// The alliance leader's workspace (stage F). Display only: the database answers for the caller's own alliance alone,
// and every club page is authorized again (read-only for a leader) by the Worker and database.
type Alliance={alliance:{id:string;name:string}|null;clubs:{id:string;name:string}[];requests:{id:string;club_id:string;club_name:string;created_at:string}[]};
const time=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"short",hour12:false});

function Decide({request,onDone}:{request:Alliance["requests"][number];onDone:()=>void}){
 const [open,setOpen]=useState<"approve"|"reject"|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function save(){
  if(!open)return;setBusy(true);setError("");
  try{await clubApi("/api/alliance/decide",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({request_id:request.id,decision:open})},"处理失败，请重试");
   const approved=open==="approve";setOpen(null);onDone();toast.success(approved?`已批准「${request.club_name}」加入联盟`:`已拒绝「${request.club_name}」的申请`);}
  catch(e){setError(e instanceof Error?e.message:"连接失败，请重试");}finally{setBusy(false);}
 }
 return <AlertDialog open={open!==null} onOpenChange={next=>{if(!busy&&!next)setOpen(null);}}>
  <span className="flex flex-wrap gap-2">
   <AlertDialogTrigger asChild><Button size="compact" onClick={()=>{setError("");setOpen("approve");}}>批准</Button></AlertDialogTrigger>
   <Button size="compact" variant="secondary" onClick={()=>{setError("");setOpen("reject");}}>拒绝</Button>
  </span>
  <AlertDialogContent>
   <AlertDialogTitle>{open==="approve"?`批准「${request.club_name}」加入联盟？`:`拒绝「${request.club_name}」的申请？`}</AlertDialogTitle>
   <AlertDialogDescription>{open==="approve"?"批准后，你可以只读查看该俱乐部的成员、历史、数据分析和操作日志。不能修改它的任何数据或职位。":"对方可以之后重新申请。"}</AlertDialogDescription>
   <FieldError>{error}</FieldError>
   <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary" disabled={busy}>取消</Button></AlertDialogCancel><Button variant={open==="reject"?"destructive":"primary"} loading={busy} loadingText="正在保存…" onClick={save}>{open==="approve"?"确认批准":"确认拒绝"}</Button></AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}

export function AlliancePage(){
 const [data,setData]=useState<Alliance|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 useDataRefresh(()=>setRetry(n=>n+1));
 useEffect(()=>{let active=true;clubApi<Alliance>("/api/alliance",undefined,"暂时无法读取联盟").then(d=>{if(active){setData(d);setError("");}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 return <main className="club-workspace club-alliance flex flex-col gap-6"><PageHeader eyebrow="ALLIANCE / 我的联盟" title={data?.alliance?.name??"我的联盟"}/>
  {error?<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/>:!data?<LoadingState status="loading" label="正在读取你的联盟…"/>:!data.alliance?
   <LoadingState status="empty" title="你目前不是联盟会长" detail="联盟会长由平台管理员任命。"/>:<>
   <p className="m-0 max-w-170 text-sm text-muted-foreground">作为联盟会长，你可以只读查看本联盟各俱乐部的成员、历史、每日导入记录、数据分析和操作日志。不能导入、删除、编辑数据，也不能修改职位或权限；原始导入内容和操作人邮箱不会显示。</p>
   <section className="grid gap-3"><h2 className="m-0 text-lg">联盟俱乐部 <Badge variant="outline">{data.clubs.length}</Badge></h2>
    {data.clubs.length?<div className="grid gap-4 md:grid-cols-2">{data.clubs.map(c=><Card key={c.id} className="items-stretch gap-3">
     <CardTitle>{c.name}</CardTitle><CardDescription>只读查看</CardDescription>
     <ButtonLink className="self-start" href={clubHref("/account",c.id)} aria-label={`查看${c.name}`}>查看俱乐部</ButtonLink>
    </Card>)}</div>:<LoadingState status="empty" title="联盟里还没有俱乐部" detail="俱乐部的公会长可以申请加入；平台管理员也可以直接安排。"/>}
   </section>
   <section className="grid gap-3"><h2 className="m-0 text-lg">加入申请 <Badge variant={data.requests.length?"warning":"outline"}>{data.requests.length}</Badge></h2>
    {data.requests.length?<ul className="m-0 grid list-none gap-3 p-0">{data.requests.map(r=><li key={r.id}><Card className="flex-row flex-wrap items-center justify-between gap-3">
     <span className="grid gap-1"><span className="font-medium">{r.club_name}</span><small className="text-muted-foreground">申请时间：{time.format(new Date(r.created_at))}</small></span>
     <Decide request={r} onDone={()=>setRetry(n=>n+1)}/>
    </Card></li>)}</ul>:<p className="m-0 text-sm text-muted-foreground">没有待处理的申请。</p>}
   </section>
  </>}
 </main>;
}
