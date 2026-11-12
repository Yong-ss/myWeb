"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {toast} from "../../components/ui/sonner";
import {clubApi} from "../../lib/data-access";
import {loadClubSettings} from "../../lib/club-brand";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {useClubCan,useClubHref} from "../../lib/useClub";
import {PageHeader} from "../../components/layout/PageHeader";
import {Button,ButtonLink} from "../../components/ui/button";
import {Badge} from "../../components/ui/badge";
import {Card} from "../../components/ui/card";
import {Notice} from "../../components/ui/notice";
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle,AlertDialogTrigger} from "../../components/ui/alert-dialog";
import {Input} from "../../components/ui/input";
import {Field,FieldLabel} from "../../components/ui/field";
import {PathwayLabel} from "../../components/PathwayLabel";
import {pathways} from "../../lib/pathways";
import {LoadingState,TableSkeleton} from "../../components/feedback";
import {dragonExcel,dragonPrint} from "./dragon-export";

type Detail={can_edit_attendance?:boolean;event:{id:string;event_date:string;status:"active"|"voided";version:number};players:{player_id:string;display_name:string;read_name:string|null;pathway?:string|null}[];roster?:{date:string;revision:number;complete:boolean}|null;absent?:{player_id:string;display_name:string;pathway:string|null}[]};

export function DragonDetailPage(){
 const href=useClubHref(),can=useClubCan();
 const [data,setData]=useState<(Detail&{club_name:string})|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0),[focus,setFocus]=useState("");
 const [busy,setBusy]=useState(false),[voidError,setVoidError]=useState(""),[open,setOpen]=useState(false);
 const attempt=useRef("");
 const loadedBrand=useRef<string|null>(null);
 const [search,setSearch]=useState("");
 const [correction,setCorrection]=useState<{action:"add"|"remove";player_id:string;display_name:string}|null>(null),[editError,setEditError]=useState("");
 const editAttempt=useRef<{key:string;id:string}|null>(null);
 const [picker,setPicker]=useState(false),[pickQuery,setPickQuery]=useState("");
 useDataRefresh(()=>setRetry(n=>n+1));
 useEffect(()=>{let active=true;const q=new URLSearchParams(window.location.search);
  Promise.all([clubApi<Detail>(`/api/dragon-event?id=${encodeURIComponent(q.get("id")??"")}`,undefined,"猎龙记录读取失败"),(loadedBrand.current===null?loadClubSettings():Promise.resolve({name:loadedBrand.current}))]).then(([d,settings])=>{if(active){loadedBrand.current=settings.name;setData({...d,club_name:settings.name});setError("");setFocus(q.get("player")??"");}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 useEffect(()=>{if(focus&&data)document.getElementById(`dragon-row-${focus}`)?.scrollIntoView({block:"center"});},[focus,data]);
 const header=(title:string)=><PageHeader eyebrow="DRAGON HUNT / 记录详情" title={title} actions={<ButtonLink variant="secondary" href={href("/dragon")}>返回猎龙记录</ButtonLink>}/>;
 if(error)return <main className="club-workspace club-events flex flex-col gap-6">{header("猎龙")}<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/></main>;
 if(!data)return <main className="club-workspace club-events flex flex-col gap-6">{header("猎龙")}<TableSkeleton columns={2} label="正在读取猎龙记录…"/></main>;
 const e=data.event,active=e.status==="active";
 const editable=active&&can("dragon.edit")&&data.can_edit_attendance===true;
 async function correct(){
  if(!correction)return;
  const body={event_id:e.id,expected_version:e.version,action:correction.action,player_id:correction.player_id},key=JSON.stringify(body);
  if(editAttempt.current?.key!==key)editAttempt.current={key,id:crypto.randomUUID()};
  setBusy(true);setEditError("");
  try{await clubApi("/api/dragon-event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,request_id:editAttempt.current.id})},"出勤修改失败");editAttempt.current=null;setCorrection(null);setPicker(false);toast.success(correction.action==="add"?"已补录参加":"已移出本次参加名单");setRetry(n=>n+1);}
  catch(err){setEditError(err instanceof Error?err.message:"保存失败，请重试");}finally{setBusy(false);}
 }
 const choose=(action:"add"|"remove",p:{player_id:string;display_name:string})=>{setEditError("");setCorrection({action,...p});};
 const reportColors=()=>Object.fromEntries(Object.values(pathways).map(p=>[p.name,getComputedStyle(document.documentElement).getPropertyValue(p.accent.slice(4,-1)).trim()]));
 const query=search.trim().toLocaleLowerCase();
 const visible=data.players.filter(p=>[p.display_name,p.read_name,p.pathway].some(v=>v?.toLocaleLowerCase().includes(query)));
 const groups=new Map<string,typeof visible>();
 if(!query)for(const name of Object.keys(pathways))groups.set(name,[]);
 for(const p of visible){const key=p.pathway?.trim()||"";groups.set(key,[...(groups.get(key)??[]),p]);}
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
  <div className="flex flex-wrap items-center gap-3">
   <Button variant="secondary" onClick={()=>{const report=window.open("","_blank");if(!report){toast.error("请允许弹出窗口后重试");return;}report.opener=null;report.document.write(dragonPrint(data,reportColors()));report.document.close();void report.document.fonts.ready.then(()=>{report.focus();report.print();});}}>打印 / 保存 PDF</Button>
   <Button variant="secondary" onClick={()=>{const url=URL.createObjectURL(new Blob([dragonExcel(data,reportColors())],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));const a=document.createElement("a");a.href=url;a.download=`${data.club_name.replace(/[<>:"/\\|?*]/g,"_")}-猎龙-${e.event_date}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>导出 Excel</Button>
   <span className="text-xs text-muted-foreground">导出当天完整名单，不受搜索影响。</span>
  </div>
  {active&&can("dragon.edit")&&!data.can_edit_attendance&&<Notice variant="info">手动修改出勤需要先完成数据库更新。</Notice>}
  {editable&&<div className="grid gap-3"><Button variant="secondary" className="justify-self-start" disabled={!data.roster||busy} onClick={()=>setPicker(v=>!v)}>{picker?"收起补录名单":"手动添加参加者"}</Button>
   {picker&&<Card><Field><FieldLabel htmlFor="dragon-pick">搜索当天名单</FieldLabel><Input id="dragon-pick" value={pickQuery} onChange={e=>setPickQuery(e.target.value)} placeholder="输入成员名字"/></Field><p className="m-0 text-xs text-muted-foreground">仅列出当天有效名单中尚未参加的成员。</p><ul className="m-0 grid max-h-80 list-none gap-2 overflow-y-auto p-0">{(data.absent??[]).filter(p=>p.display_name.includes(pickQuery.trim())).map(p=><li key={p.player_id} className="flex items-center justify-between gap-3"><span>{p.display_name}</span><Button variant="secondary" disabled={busy} onClick={()=>choose("add",p)}>添加参加</Button></li>)}</ul>{!(data.absent??[]).filter(p=>p.display_name.includes(pickQuery.trim())).length&&<p>没有可添加的成员。</p>}</Card>}
   {!data.roster&&<p className="m-0 text-sm text-muted-foreground">当天没有有效成员名单，无法补录参加者。</p>}
  </div>}
  <AlertDialog open={!!correction} onOpenChange={o=>{if(!o&&!busy)setCorrection(null);}}><AlertDialogContent><AlertDialogTitle>{correction?.action==="add"?"补录参加":"移出参加名单"}：{correction?.display_name}？</AlertDialogTitle><AlertDialogDescription>只修改 {e.event_date} 的猎龙出勤，不删除成员档案；会保留修改版本和操作记录。</AlertDialogDescription>{editError&&<Notice role="alert" variant="destructive">{editError} 如提示记录已更改，请关闭并刷新页面后重试。</Notice>}<AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary" disabled={busy}>取消</Button></AlertDialogCancel><Button loading={busy} onClick={()=>void correct()}>确认修改</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <Card className="w-full">
   <div className="flex flex-wrap items-center justify-between gap-3"><p className="m-0 text-sm">参加 <strong className="tabular-nums text-gold">{data.players.length}</strong> 人 {!active&&<Badge variant="warning">已作废</Badge>}</p>
    {active&&can("dragon.edit")&&<AlertDialog open={open} onOpenChange={o=>{if(!busy)setOpen(o);}}><AlertDialogTrigger asChild><Button variant="destructive" size="compact">作废这次记录</Button></AlertDialogTrigger>
     <AlertDialogContent><AlertDialogTitle>作废 {e.event_date} 的猎龙记录？</AlertDialogTitle>
      <AlertDialogDescription>作废后不计入任何人的出勤，这一天可以重新导入。作废不能撤销，操作会记入日志。</AlertDialogDescription>
      {voidError&&<Notice variant="destructive" role="alert">{voidError}</Notice>}
      <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary" disabled={busy}>取消</Button></AlertDialogCancel><Button variant="destructive" loading={busy} loadingText="作废中…" onClick={()=>void voidIt()}>确认作废</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>}
    {!active&&can("dragon.import")&&<ButtonLink variant="secondary" size="compact" href={href("/dragon/import")}>重新导入</ButtonLink>}</div>
   <Field className="w-full max-w-96"><FieldLabel htmlFor="dragon-search">搜索参加者</FieldLabel><Input id="dragon-search" type="search" placeholder="玩家名、截图原名或途径" value={search} onChange={e=>setSearch(e.target.value)}/></Field>
   <p className="m-0 text-sm text-muted-foreground" role="status">显示 {visible.length} / {data.players.length} 人 · 按途径分组</p>
   <p className="m-0 text-xs text-muted-foreground">途径取活动当天或之前最近一次名单记录；没有记录的归入未识别途径。</p>
   {!visible.length&&<LoadingState status="empty" title="没有找到参加者" detail="试试其他名字或途径，或清空搜索。"/>}
   <div className="grid w-full items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{[...groups].map(([pathway,players])=><section key={pathway} className="grid min-w-0 gap-3 border border-border p-3" aria-label={pathway||"未识别途径"}>
    <h2 className="m-0 flex flex-wrap items-center gap-2 font-heading text-base"><PathwayLabel pathway={pathway||null} missingText="未识别途径"/><span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">{players.length} 人</span></h2>
    {!players.length&&<p className="m-0 text-sm text-muted-foreground">暂无参加者</p>}
    <ul className="m-0 grid list-none gap-1 p-0">{[...players].sort((a,b)=>a.display_name.localeCompare(b.display_name,"zh-CN")||a.player_id.localeCompare(b.player_id)).map(p=><li key={p.player_id} id={`dragon-row-${p.player_id}`}><Link className={`flex min-h-11 items-center px-2 py-2 text-gold [overflow-wrap:anywhere] hover:bg-selected ${p.player_id===focus?"bg-selected ring-1 ring-gold":""}`} href={href(`/players?id=${p.player_id}`)}>{p.display_name}</Link>{editable&&<Button variant="ghost" disabled={busy} onClick={()=>choose("remove",p)} aria-label={`移除 ${p.display_name} 的本次出勤`}>移除出勤</Button>}</li>)}</ul>
   </section>)}</div>
  </Card>
  <Card className="w-full" aria-label="当日未参加">
   <h2 className="m-0 font-heading text-xl text-gold">当日未参加</h2>
   {!active?<p className="m-0 text-muted-foreground">记录已作废，不判断未参加名单。</p>:data.roster===undefined?<Notice variant="warning">当日名单核对功能尚未就绪，暂时无法判断。</Notice>:!data.roster?<Notice variant="info">{e.event_date} 没有有效成员名单，无法判断谁未参加。不会使用其他日期的名单。</Notice>:<>
    <p className="m-0 text-sm text-muted-foreground">按 {data.roster.date} 当天最后一版有效名单（第 {data.roster.revision} 版）核对 · 未参加 {data.absent?.length??0} 人</p>
    {!data.roster.complete&&<Notice variant="warning">当天名单不完整，以下只列出已录入名单中未参加的人。</Notice>}
    {!data.absent?.length?<p className="m-0 text-muted-foreground">当天已录入名单中的成员全部参加。</p>:<ul className="m-0 grid w-full list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">{data.absent.map(p=><li key={p.player_id}><Link className="flex min-h-11 flex-wrap items-center gap-3 border border-border px-3 py-2 text-gold hover:bg-selected [overflow-wrap:anywhere]" href={href(`/players?id=${p.player_id}`)}><span>{p.display_name}</span><PathwayLabel pathway={p.pathway}/></Link>{editable&&<Button variant="secondary" disabled={busy} onClick={()=>choose("add",p)}>添加参加</Button>}</li>)}</ul>}
   </>}
  </Card>
 </main>;
}
