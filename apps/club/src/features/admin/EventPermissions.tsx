"use client";
import {useEffect,useState} from 'react';
import {clubApi} from '../../lib/data-access';
import {useDataRefresh} from '../../lib/useDataRefresh';
import {useSettingWriter} from '../../lib/useSettingWriter';
import {LoadingState,TableSkeleton} from '../../components/feedback';
import {Badge} from '../../components/ui/badge';
import {Card,CardDescription,CardTitle} from '../../components/ui/card';
import {Field,FieldLabel} from '../../components/ui/field';
import {NativeSelect,NativeSelectOption} from '../../components/ui/native-select';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '../../components/ui/table';
import {layerReason,type Explained} from './labels';

// Four-Way League permissions per club, for platform admins and the Super Admin (platform.events.permissions). Only the
// three event permissions; the Super Admin's caps and forced settings still win. Display only: the Worker and the
// database decide, including "never on yourself or a role you hold in that club".
type Data={club_id:string;clubs:{id:string;name:string}[];permissions:{key:string;description:string}[];
 roles:{role:string;role_name:string;mine:boolean;settings:Record<string,boolean>}[];
 members:{user_id:string;email:string|null;role:string;self:boolean;permissions:Explained[]}[]};
const tri=(v:boolean|null|undefined)=>v==null?'follow':v?'allow':'deny';
const names={follow:'跟随下层设置',allow:'允许',deny:'禁止'} as const;

/** kind: which event type's three permissions (each has its own platform permission, RPCs and settings). */
export function EventPermissions({kind="events"}:{kind?:"events"|"highland"}){
 const t=kind==="events"?{name:"四方联赛",read:"/api/admin/event-permissions",write:"/api/admin/event-permission",id:"event"}:{name:"高原竞逐",read:"/api/admin/highland-permissions",write:"/api/admin/highland-permission",id:"highland"};
 const [club,setClub]=useState(''),[data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [clubs,setClubs]=useState<{id:string;name:string}[]|null>(null);
 useEffect(()=>{let active=true;clubApi<{clubs:{id:string;name:string}[]}>('/api/admin/overview',undefined,'俱乐部读取失败').then(d=>{if(active){setClubs(d.clubs);setClub(c=>c||d.clubs[0]?.id||'');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 useDataRefresh(()=>setRetry(n=>n+1));
 useEffect(()=>{if(!club)return;let active=true;clubApi<Data>(`${t.read}?club=${club}`,undefined,`${t.name}权限读取失败`)
  .then(d=>{if(active){setData(d);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[club,retry,t.read,t.name]);
 const {saving,request,feedback}=useSettingWriter(()=>setRetry(n=>n+1));
 if(!clubs)return error?<LoadingState status="error" detail={error} onRetry={()=>window.location.reload()}/>:<TableSkeleton columns={4} label="正在读取…"/>;
 if(!clubs.length)return <LoadingState status="empty" title="还没有俱乐部"/>;
 const select=(id:string,label:string,value:string,disabled:boolean,onPick:(v:boolean|null,name:string)=>void)=><NativeSelect id={id} aria-label={label} className="w-full min-w-36 sm:w-auto" disabled={disabled||saving===id} value={value}
  onChange={e=>{const v=e.target.value as keyof typeof names;onPick(v==='follow'?null:v==='allow',names[v]);}}>
  {Object.entries(names).map(([k,n])=><NativeSelectOption key={k} value={k}>{n}</NativeSelectOption>)}</NativeSelect>;
 const clubName=clubs.find(c=>c.id===club)?.name??'';
 return <div className="grid gap-6">
  <p className="m-0 text-sm text-muted-foreground">只影响所选俱乐部的{t.name}「查看战绩／导入比赛／修改战绩」，与另一种赛事的权限互不影响。顺序：超级管理员的上限和单独设置 → 平台管理员的个人设置 → 平台管理员的职位设置 → 公会长对管理员的设置 → 默认。没有「查看战绩」时导入和修改不生效。不能修改自己的权限或自己所在职位的设置。</p>
  <Field className="max-w-80"><FieldLabel htmlFor={`${t.id}-perm-club`}>俱乐部</FieldLabel><NativeSelect id={`${t.id}-perm-club`} value={club} onChange={e=>{setData(null);setClub(e.target.value);}}>{clubs.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect></Field>
  {feedback}
  {error?<LoadingState status="error" detail={error} onRetry={()=>{setError('');setRetry(n=>n+1);}}/>:!data?<TableSkeleton columns={4} label="正在读取…"/>:<>
   <Card className="w-full"><CardTitle>按职位</CardTitle><CardDescription>对 {clubName} 的整个职位生效；个人设置优先。</CardDescription>
    <Table><TableCaption>职位级{t.name}权限</TableCaption><TableHeader><TableRow><TableHead>职位</TableHead>{data.permissions.map(p=><TableHead key={p.key}>{p.description}</TableHead>)}</TableRow></TableHeader>
     <TableBody>{data.roles.map(r=><TableRow key={r.role}><TableCell>{r.role_name}{r.mine&&<small className="block text-muted-foreground">你在此职位，不能修改</small>}</TableCell>
      {data.permissions.map(p=>{const id=`${t.id}-role-${r.role}-${p.key}`;return <TableCell key={p.key}>{select(id,`${r.role_name}：${p.description}`,tri(r.settings[p.key]),r.mine,(value,n)=>request({cell:id,sensitive:true,summary:`${clubName} · ${r.role_name} · ${p.description} → ${n}`,path:t.write,body:{club_id:club,role:r.role,user_id:null,permission:p.key,value}},value!==false))}</TableCell>;})}
     </TableRow>)}</TableBody></Table></Card>
   <Card className="w-full"><CardTitle>按个人</CardTitle><CardDescription>只影响这一位账户在 {clubName} 的权限，可以覆盖上面的职位设置。「最终」是实际生效结果。</CardDescription>
    {data.members.length?<Table><TableCaption>个人{t.name}权限</TableCaption><TableHeader><TableRow><TableHead>账户</TableHead>{data.permissions.map(p=><TableHead key={p.key}>{p.description}</TableHead>)}</TableRow></TableHeader>
     <TableBody>{data.members.map(m=><TableRow key={m.user_id}><TableCell className="min-w-48 whitespace-normal [overflow-wrap:anywhere]">{m.email??m.user_id}<small className="block text-muted-foreground">{m.role==='owner'?'公会长':'管理员'}{m.self?' · 你自己，不能修改':''}</small></TableCell>
      {data.permissions.map(p=>{const e=m.permissions.find(x=>x.key===p.key),id=`${t.id}-user-${m.user_id}-${p.key}`;return <TableCell key={p.key} className="min-w-44 align-top whitespace-normal">
       {select(id,`${m.email}：${p.description}`,tri(e?.platform_set),m.self,(value,n)=>request({cell:id,sensitive:true,summary:`${m.email??m.user_id} · ${clubName} · ${p.description} → ${n}`,path:t.write,body:{club_id:club,role:null,user_id:m.user_id,permission:p.key,value}},value!==false))}
       {e&&<span className="mt-1 flex flex-wrap items-center gap-1"><Badge variant={e.allowed?'success':'outline'}>最终{e.allowed?'允许':'不允许'}</Badge><small className="text-muted-foreground">{layerReason(e)}</small></span>}</TableCell>;})}
     </TableRow>)}</TableBody></Table>:<p className="m-0 text-sm text-muted-foreground">这个俱乐部还没有公会长或管理员。</p>}</Card>
  </>}
 </div>;
}
