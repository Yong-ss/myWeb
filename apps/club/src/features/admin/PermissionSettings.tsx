"use client";
import {useEffect,useState} from 'react';
import {clubApi} from '../../lib/data-access';
import {useDataRefresh} from '../../lib/useDataRefresh';
import {LoadingState,TableSkeleton} from '../../components/feedback';
import {Badge} from '../../components/ui/badge';
import {Checkbox} from '../../components/ui/checkbox';
import {Field,FieldLabel} from '../../components/ui/field';
import {NativeSelect,NativeSelectOption} from '../../components/ui/native-select';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from '../../components/ui/collapsible';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '../../components/ui/table';
import {useSettingWriter} from '../../lib/useSettingWriter';

// Super Admin permission settings (stage B): platform defaults, role caps and per-club defaults. Display only; the
// Worker (platform.permissions.manage) and the database decide, including the non-delegable rule shown as locked here.
type Perm={key:string;description:string;sensitive:boolean;non_delegable:boolean};
type Settings={permissions:Perm[];roles:{key:string;name:string}[];defaults:{role:string;permission:string}[];cap_blocks:{role:string;permission:string}[];
 clubs:{id:string;name:string}[];club_id:string|null;club_defaults:{role:string;permission:string;allowed:boolean}[]};
const modeNotes:Record<string,string>={
 platform_default:'全平台默认权限：每个俱乐部中该职位默认拥有的权限。俱乐部默认和个人权限可以在上限之内另行调整。',
 cap:'职位权限上限：该职位最多可以拥有的权限。取消勾选后，任何默认或个人设置都不能再让这个职位获得此权限；已有的个人设置会保留，但暂不生效。',
};

export function PermissionSettings({canEdit}:{canEdit:boolean}){
 const [scope,setScope]=useState('platform_default');
 const club=scope==='platform_default'||scope==='cap'?null:scope;
 const [data,setData]=useState<Settings|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useDataRefresh(()=>setRetry(n=>n+1));
 useEffect(()=>{let active=true;clubApi<Settings>('/api/admin/permission-settings'+(club?`?club=${club}`:''),undefined,'权限设置读取失败')
  .then(d=>{if(active){setData(d);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[club,retry]);
 const {saving,request,feedback}=useSettingWriter(()=>setRetry(n=>n+1));
 if(error)return <LoadingState status="error" title="权限设置读取失败" detail={error} onRetry={()=>{setError('');setRetry(n=>n+1);}}/>;
 // A response for the previous scope is never shown as this scope's settings.
 if(!data||data.club_id!==club)return <TableSkeleton columns={3} label="正在读取权限设置…"/>;
 const clubName=data.clubs.find(c=>c.id===club)?.name;
 const inDefaults=(role:string,perm:string)=>data.defaults.some(d=>d.role===role&&d.permission===perm);
 const capped=(role:string,perm:string)=>data.cap_blocks.some(d=>d.role===role&&d.permission===perm);
 const clubValue=(role:string,perm:string)=>data.club_defaults.find(d=>d.role===role&&d.permission===perm)?.allowed??null;
 const mode=club?'club_default':scope;

 function cell(role:{key:string;name:string},p:Perm){
  const id=`${mode}-${role.key}-${p.key}`,locked=p.non_delegable&&role.key!=='owner',busy=saving===id;
  if(locked)return <span className="text-xs text-muted-foreground">只有公会长可以拥有</span>;
  const write=(value:boolean|null,widens:boolean,text:string)=>request({cell:id,sensitive:p.sensitive,summary:`${clubName?`${clubName} · `:''}${role.name} · ${p.description} → ${text}`,
   path:'/api/admin/role-permission',body:{layer:mode,role:role.key,permission:p.key,value,...(club?{club_id:club}:{})}},widens);
  const capNote=mode!=='cap'&&capped(role.key,p.key)&&<Badge variant="warning" className="mt-1">受上限限制，不生效</Badge>;
  if(mode==='club_default'){
   const value=clubValue(role.key,p.key),inherited=inDefaults(role.key,p.key),current=value??inherited;
   const label=value===null?`跟随全平台（${inherited?'允许':'不允许'}）`:value?'允许':'不允许';
   if(!canEdit)return <span className="grid gap-1 sm:justify-items-center"><span>{label}</span>{capNote}</span>;
   return <span className="grid gap-1 sm:justify-items-center"><NativeSelect className="w-full sm:w-auto" aria-label={`${role.name}：${p.description}`} disabled={busy} value={value===null?'follow':value?'allow':'deny'}
    onChange={e=>{const v=e.target.value==='follow'?null:e.target.value==='allow';const next=v??inherited;write(v,next&&!current,v===null?'跟随全平台':v?'允许':'不允许');}}>
    <NativeSelectOption value="follow">跟随全平台（{inherited?'允许':'不允许'}）</NativeSelectOption><NativeSelectOption value="allow">允许</NativeSelectOption><NativeSelectOption value="deny">不允许</NativeSelectOption>
   </NativeSelect>{capNote}</span>;
  }
  const on=mode==='cap'?!capped(role.key,p.key):inDefaults(role.key,p.key);
  const [yes,no]=mode==='cap'?['在上限内','超出上限']:['允许','不允许'];
  if(!canEdit)return <span className="grid gap-1 sm:justify-items-center"><span className={on?'text-gold':'text-muted-foreground'}><span aria-hidden="true">{on?'✓':'—'}</span><span className="sr-only">{role.name}{mode==='cap'?(on?'在上限内':'超出上限'):(on?'拥有':'没有')}</span></span>{capNote}</span>;
  return <span className="grid gap-1 sm:justify-items-center"><span className="flex min-h-11 items-center gap-2"><Checkbox id={id} checked={on} disabled={busy} aria-label={`${role.name}：${p.description}`}
   onCheckedChange={v=>write(v===true,v===true,v===true?yes:no)}/><label htmlFor={id} className="text-sm">{on?yes:no}</label></span>{capNote}</span>;
 }

 return <div className="grid gap-4">
  <Field className="max-w-96"><FieldLabel htmlFor="permission-scope">设置内容</FieldLabel>
   <NativeSelect id="permission-scope" value={scope} onChange={e=>setScope(e.target.value)}>
    <NativeSelectOption value="platform_default">全平台默认权限</NativeSelectOption><NativeSelectOption value="cap">职位权限上限</NativeSelectOption>
    {data.clubs.map(c=><NativeSelectOption key={c.id} value={c.id}>俱乐部默认权限：{c.name}</NativeSelectOption>)}
   </NativeSelect></Field>
  <p className="m-0 text-sm text-muted-foreground">{club?`本俱乐部默认权限：只影响「${clubName}」。选择「跟随全平台」时使用全平台默认；结果仍受职位上限限制。`:modeNotes[scope]}
   {canEdit?' 修改即时保存；扩大敏感权限前会请你确认。':' 你只能查看，修改需要超级管理员。'}</p>
  {feedback}
  <Table className="max-sm:block sm:[&_td]:text-center sm:[&_th]:text-center [&_td:first-child]:text-left [&_th:first-child]:text-left"><TableCaption className="max-sm:block">{club?`俱乐部默认权限 · ${clubName}`:scope==='cap'?'职位权限上限 · ✓ 表示该职位最多可以拥有':'全平台默认权限 · ✓ 表示该职位默认拥有'}</TableCaption>
   <TableHeader className="max-sm:sr-only"><TableRow><TableHead>权限</TableHead>{data.roles.map(r=><TableHead key={r.key}>{r.name}</TableHead>)}</TableRow></TableHeader>
   <TableBody className="max-sm:block">{data.permissions.map(p=><TableRow key={p.key} className="max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3">
    <TableCell className="min-w-56 whitespace-normal max-sm:col-span-2 max-sm:block max-sm:min-w-0"><span className="block">{p.description}</span><span className="mt-1 flex flex-wrap gap-1">{p.sensitive&&<Badge variant="warning">敏感</Badge>}{p.non_delegable&&<Badge variant="outline">仅公会长</Badge>}</span></TableCell>
    {data.roles.map(r=><TableCell key={r.key} className="align-middle whitespace-normal max-sm:block"><span className="block text-xs text-muted-foreground sm:hidden">{r.name}</span>{cell(r,p)}</TableCell>)}
   </TableRow>)}</TableBody></Table>
  <Collapsible><CollapsibleTrigger className="px-0">高级详情</CollapsibleTrigger><CollapsibleContent>
   <dl className="m-0 grid gap-1 text-xs">{data.permissions.map(p=><div key={p.key} className="flex flex-wrap gap-x-3"><dt className="text-muted-foreground">{p.description}</dt><dd className="m-0"><code>{p.key}</code></dd></div>)}</dl>
  </CollapsibleContent></Collapsible>
 </div>;
}
