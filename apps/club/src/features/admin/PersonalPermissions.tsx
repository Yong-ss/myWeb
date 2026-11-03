"use client";
import {useEffect,useState} from 'react';
import {clubApi} from '../../lib/data-access';
import {Badge} from '../../components/ui/badge';
import {Button} from '../../components/ui/button';
import {Field,FieldLabel} from '../../components/ui/field';
import {NativeSelect,NativeSelectOption} from '../../components/ui/native-select';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '../../components/ui/collapsible';
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogTitle,DialogTrigger} from '../../components/ui/dialog';
import {LoadingState} from '../../components/feedback';
import {allowedWithForced,layerBreakdown,layerReason,type Explained} from './labels';
import {useSettingWriter} from '../../lib/useSettingWriter';

// One user's final permissions in one club, each with its reason, and the Super Admin's forced personal setting.
// Display only: the explanation comes from the same calculation as can(), and every write is rechecked by the database.
type Explanation={role:string|null;role_name:string|null;email_confirmed:boolean;super_admin:boolean;alliance_leader?:boolean;permissions:Explained[]};
// alliance: the alliance this account leads (stage G), so a leader with no club role here can still be given a forced deny.
type Target={id:string;email:string|null;memberships:{club_id:string;club_name:string;status:string}[];alliance?:{name:string;clubs:{club_id:string;club_name:string}[]}|null};
const personalNames={follow:'跟随默认',allow:'单独允许',deny:'单独禁止'} as const;

export function PersonalPermissions({user,canEdit}:{user:Target;canEdit:boolean}){
 const roles=user.memberships.filter(m=>m.status==='active');
 const clubs=[...roles.map(m=>({club_id:m.club_id,club_name:m.club_name})),...(user.alliance?.clubs??[]).filter(c=>!roles.some(m=>m.club_id===c.club_id)).map(c=>({...c,club_name:`${c.club_name}（联盟只读）`}))];
 const [open,setOpen]=useState(false),[club,setClub]=useState(clubs[0]?.club_id??''),[data,setData]=useState<Explanation|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!open||!club)return;let active=true;
  clubApi<Explanation>(`/api/admin/permission-explain?club=${club}&user=${user.id}`,undefined,'权限详情读取失败').then(d=>{if(active){setData(d);setError('');}}).catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;};},[open,club,user.id,retry]);
 const {saving,request,feedback}=useSettingWriter(()=>setRetry(n=>n+1));
 if(!clubs.length)return null;
 const clubName=clubs.find(c=>c.club_id===club)?.club_name??'';
 const who=user.email??user.id;
 return <Dialog open={open} onOpenChange={next=>{if(next){setData(null);setError('');}setOpen(next);}}>
  <DialogTrigger asChild><Button variant="secondary" size="compact" aria-label={`查看 ${who} 的权限`}>权限详情</Button></DialogTrigger>
  <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogTitle>权限详情</DialogTitle>
   <DialogDescription className="[overflow-wrap:anywhere]">网站账户：{who}。这里显示此账户在所选俱乐部最终能做什么，以及原因。{canEdit?'「超级管理员设置」只影响这一位账户，修改即时保存。':''}</DialogDescription>
   {clubs.length>1&&<Field><FieldLabel htmlFor={`explain-club-${user.id}`}>俱乐部</FieldLabel><NativeSelect id={`explain-club-${user.id}`} value={club} onChange={e=>{setData(null);setError('');setClub(e.target.value);}}>
    {clubs.map(c=><NativeSelectOption key={c.club_id} value={c.club_id}>{c.club_name}</NativeSelectOption>)}</NativeSelect></Field>}
   {feedback}
   {error?<LoadingState status="error" title="权限详情读取失败" detail={error} onRetry={()=>{setError('');setRetry(n=>n+1);}}/>:!data?<p role="status" className="m-0">正在读取权限详情…</p>:<>
    <p className="m-0 text-sm">俱乐部：<strong>{clubName}</strong> · 当前职位：<strong>{data.role_name??'无'}</strong></p>
    {data.super_admin&&<p className="m-0 text-sm text-muted-foreground">此账户是超级管理员：完成两步验证后拥有全部权限。下面只显示其俱乐部职位带来的权限。</p>}
    {!data.email_confirmed&&<p className="m-0 text-sm text-warning">邮箱尚未验证，以下权限暂时全部不生效。</p>}
    {data.alliance_leader&&<p className="m-0 text-sm text-muted-foreground">此账户是该俱乐部所属联盟的会长，可以只读查看{data.role?'（另有本俱乐部职位）':''}。超级管理员可以对某项读取「单独禁止」，联盟只读也随之失效。</p>}
    <ul className="m-0 grid list-none gap-3 p-0">{data.permissions.map(p=>{
     const id=`personal-${user.id}-${p.key}`,value=p.forced===null?'follow':p.forced?'allow':'deny',locked=p.non_delegable&&data.role!=='owner';
     return <li key={p.key} className="grid gap-1 border-b border-border pb-3">
      <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.description}</span><Badge variant={p.allowed?'success':'outline'}>{p.allowed?'允许':'不允许'}</Badge>{p.sensitive&&<Badge variant="warning">敏感</Badge>}</span>
      <small className="text-muted-foreground">原因：{layerReason(p)}{p.owner_set!==null&&p.layer!=='owner_allow'&&p.layer!=='owner_deny'?`（公会长另设了${p.owner_set?'单独允许':'单独禁止'}）`:''}</small>
      <dl className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-xs">{layerBreakdown(p,data.role).map(([label,v])=><div key={label} className="flex gap-1"><dt className="text-muted-foreground">{label}</dt><dd className="m-0">{v}</dd></div>)}</dl>
      {canEdit&&data.role&&<Field orientation="horizontal" className="items-center gap-2"><FieldLabel htmlFor={id} className="text-sm">超级管理员设置</FieldLabel>
       <NativeSelect id={id} className="max-w-48" disabled={saving===id} value={value} onChange={e=>{const v=e.target.value as keyof typeof personalNames;
        request({cell:id,sensitive:p.sensitive,summary:`${who} · ${clubName} · ${p.description} → ${personalNames[v]}`,path:'/api/admin/personal-permission',
         body:{club_id:club,user_id:user.id,permission:p.key,value:v==='follow'?null:v==='allow'}},
         // Widening = the final result goes from not allowed to allowed, whichever menu choice causes it (e.g. 单独禁止 → 跟随默认).
         !p.allowed&&allowedWithForced(p,data.role,data.email_confirmed,v==='follow'?null:v==='allow'));}}>
        <NativeSelectOption value="follow">跟随默认</NativeSelectOption><NativeSelectOption value="allow" disabled={locked}>单独允许{locked?'（只有公会长可以拥有）':''}</NativeSelectOption><NativeSelectOption value="deny">单独禁止</NativeSelectOption>
       </NativeSelect></Field>}
      {/* No club role here, read through the alliance: only a forced deny (an allow would be a new grant; the database refuses it). */}
      {canEdit&&!data.role&&p.alliance&&<Field orientation="horizontal" className="items-center gap-2"><FieldLabel htmlFor={id} className="text-sm">超级管理员设置</FieldLabel>
       <NativeSelect id={id} className="max-w-48" disabled={saving===id} value={p.forced===false?'deny':'follow'} onChange={e=>{const deny=e.target.value==='deny';
        request({cell:id,sensitive:p.sensitive,summary:`${who} · ${clubName} · ${p.description} → ${deny?'单独禁止':'跟随联盟只读'}`,path:'/api/admin/personal-permission',
         body:{club_id:club,user_id:user.id,permission:p.key,value:deny?false:null}},!deny&&!p.allowed);}}>
        <NativeSelectOption value="follow">跟随联盟只读（允许）</NativeSelectOption><NativeSelectOption value="deny">单独禁止</NativeSelectOption>
       </NativeSelect></Field>}
     </li>;})}</ul>
    <Collapsible><CollapsibleTrigger className="px-0">高级详情</CollapsibleTrigger><CollapsibleContent>
     <dl className="m-0 grid gap-1 text-xs">{data.permissions.map(p=><div key={p.key} className="flex flex-wrap gap-x-3"><dt className="text-muted-foreground">{p.description}</dt><dd className="m-0"><code>{p.key}</code> · {p.layer}</dd></div>)}</dl>
    </CollapsibleContent></Collapsible>
   </>}
   <div className="flex justify-end"><DialogClose asChild><Button variant="secondary">关闭</Button></DialogClose></div>
  </DialogContent></Dialog>;
}
