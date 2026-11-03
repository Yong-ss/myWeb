"use client";
import {useEffect,useState,type FormEvent} from 'react';
import {clubApi} from '../../lib/data-access';
import {LoadingState,TableSkeleton} from '../../components/feedback';
import {Badge} from '../../components/ui/badge';
import {Button} from '../../components/ui/button';
import {Card,CardDescription,CardTitle} from '../../components/ui/card';
import {Field,FieldDescription,FieldError,FieldLabel} from '../../components/ui/field';
import {Input} from '../../components/ui/input';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '../../components/ui/table';
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle} from '../../components/ui/alert-dialog';
import {keptWarnings,type Kept} from './team';

// The owner's list of this club's admins: appoint by email, revoke, remove. Display only; the Worker
// (club.admins.manage) and club_change_admin decide, including the admin limit and the single-role rule.
type Team={admin_limit:number;role_version:number;admins:{user_id:string;email:string|null;email_confirmed:boolean}[]};
type Candidate={user_id:string;email:string;role:string|null;role_name:string|null;kept:Kept[]};
type Pending={action:'grant'|'revoke'|'remove';user_id:string;email:string;kept?:Kept[];blocked?:string};

export function AdminList({refresh,onChanged}:{refresh:number;onChanged:()=>void}){
 const [data,setData]=useState<Team|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [email,setEmail]=useState(''),[checking,setChecking]=useState(false),[lookupError,setLookupError]=useState('');
 const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[saveError,setSaveError]=useState(''),[done,setDone]=useState('');
 useEffect(()=>{let active=true;clubApi<Team>('/api/team',undefined,'管理员名单读取失败').then(d=>{if(active){setData(d);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[refresh,retry]);
 if(error)return <LoadingState status="error" title="管理员名单读取失败" detail={error} onRetry={()=>{setError('');setRetry(n=>n+1);}}/>;
 if(!data)return <TableSkeleton columns={3} rows={3} label="正在读取管理员名单…"/>;
 const full=data.admins.length>=data.admin_limit;

 async function check(e:FormEvent){
  e.preventDefault();if(checking||!email.trim())return;setChecking(true);setLookupError('');setDone('');
  try{
   const c=await clubApi<Candidate>(`/api/team/candidate?${new URLSearchParams({email:email.trim()})}`,undefined,'账户查询失败，请重试');
   setSaveError('');
   setPending({action:'grant',user_id:c.user_id,email:c.email,kept:c.kept,blocked:c.role==='admin'?'此账户已经是本俱乐部的管理员。':c.role?`此账户在本俱乐部已担任${c.role_name??'其他职位'}。同一俱乐部只能有一个职位，不能再任命为管理员。`:undefined});
  }catch(err){setLookupError(err instanceof Error?err.message:'账户查询失败，请重试');}
  finally{setChecking(false);}
 }
 async function save(){
  if(!pending||busy||pending.blocked||!data)return;setBusy(true);setSaveError('');
  try{
   await clubApi('/api/team/role',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:pending.user_id,action:pending.action,expected_version:data.role_version,request_id:crypto.randomUUID()})},'操作失败，请重试');
   setDone(`${pending.action==='grant'?'已任命':pending.action==='revoke'?'已撤销管理员职位':'已移出本俱乐部'}：${pending.email}`);
   if(pending.action==='grant')setEmail('');
   setPending(null);onChanged();
  }catch(err){setSaveError(err instanceof Error?err.message:'操作失败，请重试');}
  finally{setBusy(false);}
 }
 const warnings=pending?.kept?keptWarnings(pending.kept):[];
 const titles={grant:'确认任命管理员',revoke:'确认撤销管理员职位',remove:'确认移出本俱乐部'};

 return <Card className="w-full">
  <CardTitle>管理员名单</CardTitle>
  <CardDescription>本俱乐部目前有 <strong className="text-foreground tabular-nums">{data.admins.length} / {data.admin_limit}</strong> 名管理员。人数上限由超级管理员设定。</CardDescription>
  {done&&<p role="status" className="m-0 text-sm text-gold [overflow-wrap:anywhere]">{done}</p>}
  {data.admins.length?<Table containerClassName="w-full"><TableCaption>本俱乐部的有效管理员</TableCaption>
   <TableHeader><TableRow><TableHead>网站账户</TableHead><TableHead>状态</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
   <TableBody>{data.admins.map(a=>{const who=a.email??a.user_id;return <TableRow key={a.user_id}>
    <TableCell className="whitespace-normal [overflow-wrap:anywhere]">{who}</TableCell>
    <TableCell>{a.email_confirmed?<Badge variant="success">有效</Badge>:<Badge variant="warning">邮箱未验证（权限暂不生效）</Badge>}</TableCell>
    <TableCell><span className="flex flex-wrap gap-2">
     <Button variant="secondary" size="compact" aria-label={`撤销 ${who} 的管理员职位`} onClick={()=>{setSaveError('');setDone('');setPending({action:'revoke',user_id:a.user_id,email:who});}}>撤销职位</Button>
     <Button variant="destructive" size="compact" aria-label={`将 ${who} 移出本俱乐部`} onClick={()=>{setSaveError('');setDone('');setPending({action:'remove',user_id:a.user_id,email:who});}}>移出俱乐部</Button>
    </span></TableCell>
   </TableRow>;})}</TableBody></Table>:<p className="m-0 text-sm text-muted-foreground">本俱乐部还没有管理员。</p>}

  <form onSubmit={check} className="grid w-full max-w-xl gap-2">
   <Field><FieldLabel htmlFor="team-appoint-email">任命新管理员</FieldLabel>
    <Input id="team-appoint-email" type="email" autoComplete="off" required maxLength={320} value={email} disabled={full} onChange={e=>{setEmail(e.target.value);setLookupError('');}} placeholder="对方的网站账户邮箱"/>
    <FieldDescription>{full?`已达到管理员人数上限（${data.admin_limit} 人），需要先撤销一位管理员，或请超级管理员提高上限。`:'对方需要先注册网站账户并完成邮箱验证。确认任命前会显示此账户在本俱乐部保留的个人权限设置。'}</FieldDescription></Field>
   <FieldError>{lookupError}</FieldError>
   <Button type="submit" className="justify-self-start" loading={checking} loadingText="正在查询…" disabled={full||!email.trim()}>检查账户</Button>
  </form>

  <AlertDialog open={!!pending} onOpenChange={open=>{if(!open&&!busy)setPending(null);}}><AlertDialogContent>
   <AlertDialogTitle>{pending?titles[pending.action]:''}</AlertDialogTitle>
   <AlertDialogDescription className="[overflow-wrap:anywhere]">网站账户：{pending?.email}。{pending?.action==='grant'?'任命后立即获得本俱乐部管理员的权限（按下方「管理员权限」计算）。':pending?.action==='revoke'?'此账户在本俱乐部的管理员权限将立即失效。':'将撤销此账户在本俱乐部的全部职位，权限立即失效。不影响其他俱乐部，也不删除账户或历史记录。'}</AlertDialogDescription>
   {pending?.action!=='grant'&&<p className="m-0 text-sm text-muted-foreground">为此账户单独设置的权限会保留。日后重新任命时，这些设置会再次生效（届时会先提示你）。</p>}
   {pending?.blocked&&<p className="m-0 text-sm text-warning">{pending.blocked}</p>}
   {!pending?.blocked&&warnings.length>0&&<div className="grid gap-2 border border-warning p-3" role="note" aria-label="保留的个人权限设置">
    <p className="m-0 text-sm font-medium text-warning">此账户以前在本俱乐部有个人权限设置，任命后会立即再次生效：</p>
    <ul className="m-0 grid gap-1 pl-5 text-sm">{warnings.map(w=><li key={w.key}>{w.text}{w.opens&&w.sensitive&&<Badge variant="warning" className="ml-2">敏感权限将被开放</Badge>}</li>)}</ul>
    <p className="m-0 text-xs text-muted-foreground">任命后你可以在「管理员权限」中修改公会长的设置；超级管理员的设置只有超级管理员能修改。</p>
   </div>}
   <FieldError>{saveError}</FieldError>
   <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary" disabled={busy}>取消</Button></AlertDialogCancel>
    {!pending?.blocked&&<Button variant={pending?.action==='grant'?'primary':'destructive'} loading={busy} onClick={save}>{pending?.action==='grant'?(warnings.length?'确认任命（设置将生效）':'确认任命'):pending?.action==='revoke'?'确认撤销':'确认移出'}</Button>}
   </AlertDialogFooter>
  </AlertDialogContent></AlertDialog>
 </Card>;
}
