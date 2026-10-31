"use client";
import {useEffect,useState,type FormEvent} from "react";
import {clubApi} from "../../lib/data-access";
import {PageHeader} from "../../components/layout/PageHeader";
import {LoadingState,TableSkeleton} from "../../components/feedback";
import {Card} from "../../components/ui/card";
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from "../../components/ui/collapsible";
import {Badge} from "../../components/ui/badge";
import {Button,ButtonLink} from "../../components/ui/button";
import {Input} from "../../components/ui/input";
import {Field,FieldLabel} from "../../components/ui/field";
import {Tabs,TabsContent,TabsList,TabsTrigger} from "../../components/ui/tabs";
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from "../../components/ui/table";
import {actionLabel,actorLabel,changeSummary,scopeNames,type PlatformEvent} from "./labels";

// Platform panel, read-only (P3). What is shown here is display only: every request is checked by the Worker
// (platform.read) and again by the database, which allows it only for an MFA-verified Super Admin on a confirmed device.
type PlayerCounts={present:number;temporary:number;confirmed_left:number;unconfirmed:number;other_left:number};
type Overview={totals:{clubs:number;users:number;confirmed_users:number;members:number;active_roles:number};alliances:null|number;clubs:{id:string;name:string;members:number;players:number;latest_snapshot:string|null;is_complete_roster?:boolean|null;player_counts?:PlayerCounts|null}[]};
type User={id:string;email:string|null;email_confirmed:boolean;created_at:string;last_sign_in_at:string|null;super_admin:boolean;memberships:{club_id:string;club_name:string;role:string;role_name:string|null;status:string}[];effective:{club_id:string;club_name:string;permissions:string[]}[]};
type Roles={permissions:{key:string;kind:string;scopes:string[];sensitive:boolean;description:string}[];roles:{key:string;name:string;scope:string;club_name:string|null;system:boolean;permissions:string[];assigned:number}[]};
const time=new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"short",hour12:false});
const when=(value:string|null)=>value?time.format(new Date(value)):"—";

function useRead<T>(path:string){
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;clubApi<T>(path,undefined,"平台资料读取失败").then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[path,retry]);
 return {data,error,reload:()=>{setError("");setRetry(n=>n+1);}};
}

function OverviewPanel(){
 const {data,error,reload}=useRead<Overview>("/api/admin/overview");
 if(error)return <LoadingState status="error" title="总览读取失败" detail={error} onRetry={reload}/>;
 if(!data)return <TableSkeleton columns={4} rows={3} label="正在读取平台总览…"/>;
 const metric=(label:string,value:number|string,note?:string)=><div className="grid gap-1"><span className="text-xs text-muted-foreground">{label}</span><strong className="font-heading text-2xl font-medium tabular-nums">{value}</strong>{note&&<span className="text-xs text-muted-foreground">{note}</span>}</div>;
 const t=data.totals;
 return <div className="grid gap-6">
  <Card ornate className="flex flex-row flex-wrap gap-x-10 gap-y-4">
   {metric("俱乐部",t.clubs)}{metric("联盟",data.alliances??"未启用",data.alliances===null?"联盟功能尚未上线":undefined)}
   {metric("账户",t.users,`${t.confirmed_users} 个已验证邮箱`)}{metric("有俱乐部角色的用户",t.members,`${t.active_roles} 个生效角色`)}
  </Card>
  <p className="m-0 text-sm text-muted-foreground">玩家状态与成员名单使用同一规则，按最新有效记录统计，不代表实时游戏在线人数；网站管理账户独立计算。</p>
  <Table className="max-sm:block"><TableCaption className="max-sm:block">全部俱乐部 · 网站管理账户按有生效角色的不同账户计算</TableCaption><TableHeader className="max-sm:sr-only"><TableRow><TableHead>俱乐部</TableHead><TableHead>网站管理账户</TableHead><TableHead>当前在会人数</TableHead></TableRow></TableHeader>
   <TableBody className="max-sm:block">{data.clubs.map(c=><TableRow key={c.id} className="max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto]">
    <TableCell className="align-top whitespace-normal max-sm:block"><span className="font-medium">{c.name}</span><small className="mt-1 block text-muted-foreground">最新记录：{c.latest_snapshot??"暂无数据"}</small>{c.latest_snapshot&&typeof c.is_complete_roster==="boolean"&&<Badge variant={c.is_complete_roster?"success":"warning"}>{c.is_complete_roster?"完整名单":"不完整名单"}</Badge>}</TableCell>
    <TableCell className="align-top tabular-nums max-sm:block max-sm:text-right"><span className="block text-xs text-muted-foreground sm:hidden">网站管理账户</span>{c.members}</TableCell>
    <TableCell className="align-top whitespace-normal max-sm:col-span-2 max-sm:block max-sm:border-t max-sm:border-border"><span className="block text-xs text-muted-foreground sm:hidden">当前在会人数</span><strong className="block font-heading text-2xl font-medium text-gold tabular-nums">{c.player_counts?.present??"暂无数据"}</strong><small className="block text-muted-foreground">历史累计玩家：{c.players}</small>
     <Collapsible className="max-w-72"><CollapsibleTrigger aria-label={`${c.name}人数详情`} className="px-0">人数详情</CollapsibleTrigger><CollapsibleContent>
      <dl className="m-0 grid gap-2 text-sm">{([["暂离人数","temporary"],["已确认退会人数","confirmed_left"],["待确认人数","unconfirmed"],["其他不在会人数","other_left"]] as const).map(([label,key])=><div key={key} className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">{label}</dt><dd className="m-0 tabular-nums">{c.player_counts?.[key]??"暂无数据"}</dd></div>)}</dl>
      <p className="mb-0 max-w-72 text-xs text-muted-foreground">待确认包含没有有效观察的历史玩家；其他不在会指名单规则已判定不在会，但没有明确暂离或退会分类。</p>
     </CollapsibleContent></Collapsible>
    </TableCell>
   </TableRow>)}</TableBody></Table>
 </div>;
}

function UsersPanel(){
 const [draft,setDraft]=useState(""),[query,setQuery]=useState(""),[users,setUsers]=useState<User[]|null>(null),[next,setNext]=useState<{key:string;id:string}|null>(null);
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
 const read=(cursor?:{key:string;id:string})=>clubApi<{users:User[];next:{key:string;id:string}|null}>("/api/admin/users?"+new URLSearchParams({q:query,...(cursor?{after:cursor.key,id:cursor.id}:{})}),undefined,"用户读取失败");
 useEffect(()=>{let active=true;read().then(d=>{if(active){setUsers(d.users);setNext(d.next);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[query,retry]); // eslint-disable-line react-hooks/exhaustive-deps
 async function more(){if(!next)return;setBusy(true);setError("");try{const d=await read(next);setUsers(old=>[...(old??[]),...d.users]);setNext(d.next);}catch(e){setError(e instanceof Error?e.message:"读取失败");}finally{setBusy(false);}}
 const search=(e:FormEvent)=>{e.preventDefault();setUsers(null);setError("");setQuery(draft.trim());setRetry(n=>n+1);};
 return <div className="grid gap-4">
  <form role="search" onSubmit={search} className="flex flex-wrap items-end gap-3"><Field className="max-w-80 min-w-56 flex-1"><FieldLabel htmlFor="admin-user-search">搜索用户</FieldLabel><Input id="admin-user-search" type="search" maxLength={100} placeholder="邮箱或用户 ID" value={draft} onChange={e=>setDraft(e.target.value)}/></Field><Button type="submit" variant="secondary">搜索</Button></form>
  {error&&<LoadingState status="error" title="用户读取失败" detail={error} onRetry={()=>{if(users?.length&&next)void more();else{setError("");setUsers(null);setRetry(n=>n+1);}}}/>}
  {!users&&!error?<TableSkeleton columns={4} label="正在读取用户…"/>:users&&(users.length?<Table><TableCaption>{query?`“${query}”的搜索结果`:"全部账户 · 按邮箱排序"} · 有效权限 = 生效角色的权限并集</TableCaption>
   <TableHeader><TableRow><TableHead>账户</TableHead><TableHead>俱乐部角色</TableHead><TableHead>有效权限</TableHead><TableHead>最近登录</TableHead></TableRow></TableHeader>
   <TableBody>{users.map(u=><TableRow key={u.id}>
    <TableCell className="min-w-56 align-top whitespace-normal [overflow-wrap:anywhere]"><span className="block font-medium">{u.email??"（无邮箱）"}</span><span className="mt-1 flex flex-wrap gap-1">{u.super_admin&&<Badge>超级管理员</Badge>}{!u.email_confirmed&&<Badge variant="warning">邮箱未验证</Badge>}</span><small className="mt-1 block font-mono text-muted-foreground">{u.id}</small></TableCell>
    <TableCell className="min-w-44 align-top whitespace-normal">{u.memberships.length?<ul className="m-0 grid list-none gap-1 p-0">{u.memberships.map(m=><li key={m.club_id+m.role} className={m.status==="active"?undefined:"text-muted-foreground line-through"}>{m.club_name} · {m.role_name??m.role}{m.status!=="active"&&<span className="sr-only">（已撤销）</span>}</li>)}</ul>:<span className="text-muted-foreground">无</span>}</TableCell>
    <TableCell className="min-w-56 align-top whitespace-normal">{u.effective.length?u.effective.map(e=><p key={e.club_id} className="m-0 mb-1 text-xs"><span className="text-gold">{e.club_name}</span>：{e.permissions.join("、")}</p>):<span className="text-muted-foreground">{u.super_admin?"仅在两步验证后拥有全部权限":"无"}</span>}</TableCell>
    <TableCell className="align-top text-muted-foreground">{when(u.last_sign_in_at)}</TableCell>
   </TableRow>)}</TableBody></Table>:<LoadingState status="empty" title="没有找到用户" detail="请换一个邮箱片段或完整用户 ID。"/>)}
  {next&&<Button className="self-start" loading={busy} loadingText="读取中…" onClick={more}>更多用户</Button>}
 </div>;
}

function RolesPanel(){
 const {data,error,reload}=useRead<Roles>("/api/admin/roles");
 if(error)return <LoadingState status="error" title="角色读取失败" detail={error} onRetry={reload}/>;
 if(!data)return <TableSkeleton columns={4} label="正在读取角色与权限…"/>;
 return <div className="grid gap-3"><p className="m-0 text-sm text-muted-foreground">只读视图：角色是权限的集合，按范围授予。修改角色和权限将在后续版本提供。</p>
  <Table className="[&_td]:text-center [&_th]:text-center [&_td:first-child]:text-left [&_th:first-child]:text-left"><TableCaption>权限矩阵 · ✓ 表示该角色拥有此权限</TableCaption>
   <TableHeader><TableRow><TableHead>权限</TableHead>{data.roles.map(r=><TableHead key={r.key}><span className="block">{r.name}</span><small className="block font-normal text-muted-foreground">{scopeNames[r.scope]??r.scope}{r.club_name?` · ${r.club_name}`:""} · {r.assigned} 人</small></TableHead>)}</TableRow></TableHeader>
   <TableBody>{data.permissions.map(p=><TableRow key={p.key}>
    <TableCell className="min-w-64 whitespace-normal"><span className="block">{p.description}</span><span className="mt-1 flex flex-wrap items-center gap-1"><code className="text-xs text-muted-foreground">{p.key}</code>{p.scopes.map(s=><Badge key={s} variant="outline">{scopeNames[s]??s}</Badge>)}{p.sensitive&&<Badge variant="warning">敏感</Badge>}</span></TableCell>
    {data.roles.map(r=>r.permissions.includes(p.key)?<TableCell key={r.key} className="text-gold"><span aria-hidden="true">✓</span><span className="sr-only">{r.name}拥有</span></TableCell>:<TableCell key={r.key} className="text-muted-foreground"><span aria-hidden="true">—</span><span className="sr-only">{r.name}没有</span></TableCell>)}
   </TableRow>)}</TableBody></Table>
 </div>;
}

function ActivityPanel(){
 const [events,setEvents]=useState<PlatformEvent[]|null>(null),[next,setNext]=useState<{before:string;id:string}|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
 const read=(cursor?:{before:string;id:string})=>clubApi<{events:PlatformEvent[];next:{before:string;id:string}|null}>("/api/admin/activity"+(cursor?"?"+new URLSearchParams(cursor):""),undefined,"平台日志读取失败");
 useEffect(()=>{let active=true;read().then(d=>{if(active){setEvents(d.events);setNext(d.next);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 async function more(){if(!next)return;setBusy(true);setError("");try{const d=await read(next);setEvents(old=>[...(old??[]),...d.events.filter(e=>!old?.some(o=>o.id===e.id))]);setNext(d.next);}catch(e){setError(e instanceof Error?e.message:"读取失败");}finally{setBusy(false);}}
 return <div className="grid gap-4"><p className="m-0 text-sm text-muted-foreground">记录角色、权限登记、超级管理员和验证器的每次变更，包括在 Supabase SQL Editor 中的操作；不可编辑或删除。时间为北京时间。</p>
  {error&&<LoadingState status="error" title="平台日志读取失败" detail={error} onRetry={()=>{if(events?.length&&next)void more();else{setError("");setRetry(n=>n+1);}}}/>}
  {!events&&!error?<TableSkeleton columns={4} label="正在读取平台日志…"/>:events&&(events.length?<Table><TableCaption>平台操作记录 · 按时间倒序</TableCaption>
   <TableHeader><TableRow><TableHead>时间</TableHead><TableHead>操作人</TableHead><TableHead>操作</TableHead><TableHead>内容</TableHead></TableRow></TableHeader>
   <TableBody>{events.map(e=><TableRow key={e.id}>
    <TableCell className="align-top text-muted-foreground">{when(e.created_at)}</TableCell>
    <TableCell className="min-w-40 align-top whitespace-normal [overflow-wrap:anywhere]">{actorLabel(e)}</TableCell>
    <TableCell className="align-top"><Badge variant={e.action.endsWith(".delete")?"destructive":"default"}>{actionLabel(e.action)}</Badge></TableCell>
    <TableCell className="min-w-56 align-top whitespace-normal [overflow-wrap:anywhere]">{(e.subject||e.club)&&<span className="block">{[e.subject,e.club].filter(Boolean).join(" · ")}</span>}{changeSummary(e).map(line=><small key={line} className="block text-muted-foreground">{line}</small>)}</TableCell>
   </TableRow>)}</TableBody></Table>:<LoadingState status="empty" title="暂无平台操作记录"/>)}
  {next&&<Button className="self-start" loading={busy} loadingText="读取中…" onClick={more}>更早记录</Button>}
 </div>;
}

export function AdminPage(){
 const [allowed,setAllowed]=useState<boolean|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;clubApi<{platform_permissions?:string[]}>("/api/account",undefined,"暂时无法读取账户").then(a=>{if(active)setAllowed(a.platform_permissions?.includes("platform.read")===true);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 return <main className="club-workspace club-admin flex flex-col gap-6"><PageHeader eyebrow="PLATFORM / 平台管理" title="平台管理"/>
  {error?<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/>:allowed===null?<LoadingState status="loading" label="正在确认权限…"/>:!allowed?
   <LoadingState status="empty" title="需要超级管理员权限" detail="平台管理只对完成两步验证、并使用已确认设备登录的超级管理员开放。" action={<ButtonLink variant="secondary" href="/settings">前往设置</ButtonLink>}/>:
   <Tabs defaultValue="overview" className="flex flex-col gap-6">
    <TabsList aria-label="平台管理"><TabsTrigger value="overview">总览</TabsTrigger><TabsTrigger value="users">用户与角色</TabsTrigger><TabsTrigger value="roles">角色与权限</TabsTrigger><TabsTrigger value="activity">平台日志</TabsTrigger></TabsList>
    <TabsContent value="overview"><OverviewPanel/></TabsContent>
    <TabsContent value="users"><UsersPanel/></TabsContent>
    <TabsContent value="roles"><RolesPanel/></TabsContent>
    <TabsContent value="activity"><ActivityPanel/></TabsContent>
   </Tabs>}
 </main>;
}
