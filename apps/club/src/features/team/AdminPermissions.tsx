"use client";
import {useEffect,useState} from 'react';
import {clubApi} from '../../lib/data-access';
import {useSettingWriter} from '../../lib/useSettingWriter';
import {layerBreakdown,layerReason,type Explained} from '../../domain/permission-layers';
import {LoadingState,TableSkeleton} from '../../components/feedback';
import {Badge} from '../../components/ui/badge';
import {Card,CardDescription,CardTitle} from '../../components/ui/card';
import {Field,FieldLabel} from '../../components/ui/field';
import {NativeSelect,NativeSelectOption} from '../../components/ui/native-select';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '../../components/ui/collapsible';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '../../components/ui/table';
import {defaultWidens,personalWidens,type RolePerm} from './team';

// The owner's settings for this club's admins: the admin-role default here, and owner-level personal settings per
// admin. The Super Admin's caps and forced settings are shown as reasons and can't be changed here. Display only:
// the Worker (club.admins.permissions) and the database (permission_layer) decide; every save is rechecked there.
type Admin={user_id:string;email:string|null;explain:{role:string|null;email_confirmed:boolean;permissions:Explained[]}};
type Data={permissions:RolePerm[];admins:Admin[]};
const lockText=(p:{non_delegable:boolean;cap_blocked:boolean})=>p.non_delegable?'只有公会长可以拥有（系统安全规则）':p.cap_blocked?'超级管理员已限制管理员拥有此权限':'';
const names={follow:'跟随默认',allow:'单独允许',deny:'单独禁止'} as const;

export function AdminPermissions({refresh,onChanged}:{refresh:number;onChanged:()=>void}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[selected,setSelected]=useState('');
 useEffect(()=>{let active=true;clubApi<Data>('/api/team/permissions',undefined,'管理员权限读取失败').then(d=>{if(active){setData(d);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[refresh,retry]);
 const {saving,request,feedback}=useSettingWriter(onChanged);
 if(error)return <LoadingState status="error" title="管理员权限读取失败" detail={error} onRetry={()=>{setError('');setRetry(n=>n+1);}}/>;
 if(!data)return <TableSkeleton columns={2} label="正在读取管理员权限…"/>;
 const admin=data.admins.find(a=>a.user_id===selected)??data.admins[0];

 function defaultCell(p:RolePerm){
  const lock=lockText(p);
  if(lock)return <span className="text-sm text-muted-foreground">{lock}</span>;
  const id=`team-default-${p.key}`,value=p.club_default===null?'follow':p.club_default?'allow':'deny',inherited=p.platform_default?'允许':'不允许';
  return <NativeSelect id={id} aria-label={`管理员默认：${p.description}`} className="w-full sm:w-auto" disabled={saving===id} value={value} onChange={e=>{
   const next=e.target.value==='follow'?null:e.target.value==='allow';
   request({cell:id,sensitive:p.sensitive,summary:`管理员默认 · ${p.description} → ${next===null?`跟随全平台（${inherited}）`:next?'允许':'不允许'}`,path:'/api/team/default',body:{permission:p.key,value:next}},defaultWidens(p,next));}}>
   <NativeSelectOption value="follow">跟随全平台（{inherited}）</NativeSelectOption><NativeSelectOption value="allow">允许</NativeSelectOption><NativeSelectOption value="deny">不允许</NativeSelectOption>
  </NativeSelect>;
 }

 return <div className="grid gap-6">
  {feedback}
  <Card className="w-full">
   <CardTitle>管理员默认权限</CardTitle>
   <CardDescription>只影响本俱乐部的管理员。没有单独设置的管理员会立即跟随这里的默认；「跟随全平台」使用超级管理员设定的全平台默认。修改即时保存，开放敏感权限前会请你确认。</CardDescription>
   <Table containerClassName="w-full"><TableCaption>本俱乐部管理员的默认权限</TableCaption>
    <TableHeader><TableRow><TableHead>权限</TableHead><TableHead>默认</TableHead></TableRow></TableHeader>
    <TableBody>{data.permissions.map(p=><TableRow key={p.key}>
     <TableCell className="min-w-48 whitespace-normal"><span className="block">{p.description}</span>{p.sensitive&&<Badge variant="warning" className="mt-1">敏感</Badge>}</TableCell>
     <TableCell className="whitespace-normal">{defaultCell(p)}</TableCell>
    </TableRow>)}</TableBody></Table>
  </Card>

  <Card className="w-full">
   <CardTitle>单独调整某位管理员</CardTitle>
   <CardDescription>「单独允许／单独禁止」只影响这一位管理员；「跟随默认」恢复为上面的默认。超级管理员的权限上限和单独设置始终优先，你不能修改自己的权限。</CardDescription>
   {!admin?<p className="m-0 text-sm text-muted-foreground">本俱乐部还没有管理员。</p>:<>
    <Field className="max-w-96"><FieldLabel htmlFor="team-admin-select">管理员</FieldLabel>
     <NativeSelect id="team-admin-select" value={admin.user_id} onChange={e=>setSelected(e.target.value)}>{data.admins.map(a=><NativeSelectOption key={a.user_id} value={a.user_id}>{a.email??a.user_id}</NativeSelectOption>)}</NativeSelect></Field>
    <p className="m-0 text-sm">当前职位：<strong>管理员</strong>{!admin.explain.email_confirmed&&<span className="ml-2 text-warning">邮箱尚未验证，以下权限暂时全部不生效。</span>}</p>
    <ul className="m-0 grid w-full list-none gap-3 p-0">{admin.explain.permissions.map(p=>{
     const id=`team-personal-${admin.user_id}-${p.key}`,value=p.owner_set===null?'follow':p.owner_set?'allow':'deny',lock=lockText(p);
     return <li key={p.key} className="grid gap-1 border-b border-border pb-3">
      <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.description}</span><Badge variant={p.allowed?'success':'outline'}>{p.allowed?'允许':'不允许'}</Badge>{p.sensitive&&<Badge variant="warning">敏感</Badge>}</span>
      <small className="text-muted-foreground">原因：{layerReason(p)}{p.forced!==null&&p.owner_set!==null?'（超级管理员的设置优先，你的设置暂不生效）':''}</small>
      <dl className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs">{layerBreakdown(p,admin.explain.role).map(([label,v])=><div key={label} className="flex gap-1"><dt className="text-muted-foreground">{label}</dt><dd className="m-0">{v}</dd></div>)}</dl>
      {lock?<small className="text-muted-foreground">{lock}，不能单独调整</small>:<Field orientation="horizontal" className="items-center gap-2"><FieldLabel htmlFor={id} className="text-sm">公会长设置</FieldLabel>
       <NativeSelect id={id} className="max-w-48" disabled={saving===id} value={value} onChange={e=>{const v=e.target.value as keyof typeof names,next=v==='follow'?null:v==='allow';
        request({cell:id,sensitive:p.sensitive,summary:`${admin.email??admin.user_id} · ${p.description} → ${names[v]}`,path:'/api/team/personal',body:{user_id:admin.user_id,permission:p.key,value:next}},
         // Widening = the final result goes from not allowed to allowed, whichever choice causes it (e.g. 单独禁止 → 跟随默认).
         personalWidens(p,admin.explain.email_confirmed,next));}}>
        <NativeSelectOption value="follow">跟随默认</NativeSelectOption><NativeSelectOption value="allow">单独允许</NativeSelectOption><NativeSelectOption value="deny">单独禁止</NativeSelectOption>
       </NativeSelect></Field>}
     </li>;})}</ul>
   </>}
   <Collapsible><CollapsibleTrigger className="px-0">高级详情</CollapsibleTrigger><CollapsibleContent>
    <dl className="m-0 grid gap-1 text-xs">{(admin?.explain.permissions??data.permissions).map(p=><div key={p.key} className="flex flex-wrap gap-x-3"><dt className="text-muted-foreground">{p.description}</dt><dd className="m-0"><code>{p.key}</code>{'layer' in p?` · ${p.layer}`:''}</dd></div>)}</dl>
   </CollapsibleContent></Collapsible>
  </Card>
 </div>;
}
