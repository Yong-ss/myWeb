"use client";
import {useEffect,useState} from "react";
import {toast} from "../../components/ui/sonner";
import {clubApi} from "../../lib/data-access";
import {Button} from "../../components/ui/button";
import {Badge} from "../../components/ui/badge";
import {FieldError} from "../../components/ui/field";
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle,AlertDialogTrigger} from "../../components/ui/alert-dialog";
// Stage G: remove one account from every club (Super Admin only). The preview is read fresh when the dialog opens; the
// confirmation sends exactly that preview, and the database refuses the whole removal if anything changed meanwhile or
// the account still owns a club. Display only otherwise: the Worker and database decide.
type Context={clubs:{id:string;name:string;role_version:number}[];memberships:{club_id:string;role:string;status:string}[]};
type Target={id:string;email:string|null;platform_admin?:boolean;alliance?:{name:string}|null};
const roleNames:Record<string,string>={owner:"公会长",admin:"管理员"};
export function RemoveAllClubs({user,onSaved}:{user:Target;onSaved:()=>void}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Context|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[stale,setStale]=useState(false);
 const who=user.email??user.id;
 useEffect(()=>{if(!open)return;let active=true;
  clubApi<Context>(`/api/admin/role-context?user=${user.id}`,undefined,"职位读取失败").then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;};},[open,user.id,retry]);
 const reset=()=>{setData(null);setError("");setStale(false);};
 const held=(data?.memberships??[]).filter(m=>m.status==="active").map(m=>({...m,club:data!.clubs.find(c=>c.id===m.club_id)}));
 const owned=held.filter(m=>m.role==="owner");
 async function remove(){
  if(!data||busy)return;setBusy(true);setError("");
  try{
   const r=await clubApi<{changed:boolean;clubs:{name:string}[]}>("/api/admin/remove-from-all-clubs",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({user_id:user.id,expected:Object.fromEntries(held.map(m=>[m.club_id,m.club?.role_version??0])),request_id:crypto.randomUUID()})},"移出失败，请重试");
   setOpen(false);onSaved();toast.success(r.changed?`已把 ${who} 移出 ${r.clubs.length} 个俱乐部`:`${who} 没有需要移出的俱乐部职位`);
  }catch(e){const status=(e as {status?:number}).status;setStale(status===409);setError(e instanceof Error?e.message:"连接失败，请重试；本次没有移出任何俱乐部。");}
  finally{setBusy(false);}
 }
 return <AlertDialog open={open} onOpenChange={next=>{if(busy)return;if(next)reset();setOpen(next);}}>
  <AlertDialogTrigger asChild><Button variant="destructive" size="compact" aria-label={`把 ${who} 移出全部俱乐部`}>移出全部俱乐部</Button></AlertDialogTrigger>
  <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
   <AlertDialogTitle>把 {who} 移出全部俱乐部？</AlertDialogTitle>
   <AlertDialogDescription>只撤销此账户在各俱乐部的职位，立即生效。账户本身、历史记录、操作日志和个人权限设置都会保留；{user.platform_admin?"平台管理员身份、":""}{user.alliance?`「${user.alliance.name}」联盟会长身份、`:""}超级管理员身份不受影响。</AlertDialogDescription>
   {!data?(error?<FieldError>{error}</FieldError>:<p role="status" className="m-0 text-sm">正在读取此账户的俱乐部职位…</p>):<>
    {held.length?<ul aria-label="将受影响的俱乐部" className="m-0 grid list-none gap-2 p-0">{held.map(m=><li key={m.club_id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-sm">
     <span>{m.club?.name??m.club_id}</span><span className="flex items-center gap-2"><Badge variant="outline">{roleNames[m.role]??m.role}</Badge>{m.role==="owner"?<Badge variant="destructive">不能直接移出</Badge>:<Badge variant="warning">将撤销</Badge>}</span>
    </li>)}</ul>:<p className="m-0 text-sm text-muted-foreground">此账户目前没有任何俱乐部职位。</p>}
    {owned.length>0&&<p role="alert" className="m-0 text-sm text-destructive">此账户是 {owned.map(m=>m.club?.name).join("、")} 的公会长。每个俱乐部必须有公会长：请先在「管理职位」里转让公会长，再回来移出全部俱乐部。本次不会移出任何俱乐部。</p>}
    <FieldError>{error}</FieldError>
   </>}
   <AlertDialogFooter>
    <AlertDialogCancel asChild><Button variant="secondary" disabled={busy}>取消</Button></AlertDialogCancel>
    {stale||(!data&&error)?<Button variant="secondary" onClick={()=>{reset();setRetry(n=>n+1);}}>刷新</Button>
     :<Button variant="destructive" disabled={!data||!held.length||owned.length>0} loading={busy} loadingText="正在移出…" onClick={remove}>确认移出 {held.length} 个俱乐部</Button>}
   </AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
