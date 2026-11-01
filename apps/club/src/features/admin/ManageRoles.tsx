"use client";
import {useEffect,useState,type ReactNode} from 'react';
import {clubApi} from '../../lib/data-access';
import {Button} from '../../components/ui/button';
import {Field,FieldError,FieldLabel} from '../../components/ui/field';
import {NativeSelect,NativeSelectOption} from '../../components/ui/native-select';
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogTitle} from '../../components/ui/dialog';

type Context={clubs:{id:string;name:string;admin_limit:number;role_version:number;owner_id:string|null}[];memberships:{club_id:string;role:string;status:string}[]};
type Operation={club_id:string;user_id:string;role:'owner'|'admin';action:'grant'|'revoke'|'transfer';expected_version:number;request_id:string};
export function ManageRoles({user,onSaved,children,returnFocus}:{user:{id:string;email:string|null;email_confirmed:boolean}|null;onSaved:()=>void;children:ReactNode;returnFocus:()=>void}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Context|null>(null),[club,setClub]=useState(''),[role,setRole]=useState<'owner'|'admin'>('admin');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[conflict,setConflict]=useState(false),[operation,setOperation]=useState<Operation|null>(null);
 useEffect(()=>{if(!open||!user)return;const userId=user.id;let active=true;async function load(){setLoading(true);setError('');try{const d=await clubApi<Context>(`/api/admin/role-context?user=${userId}`,undefined,'角色状态读取失败');if(active){setData(d);setOperation(null);setConflict(false);}}catch(e){if(active)setError(e instanceof Error?e.message:'角色状态读取失败');}finally{if(active)setLoading(false);}}void load();return()=>{active=false;};},[open,user,refresh]);
 const selected=data?.clubs.find(c=>c.id===club),membership=data?.memberships.find(m=>m.club_id===club&&m.role===role),active=membership?.status==='active';
 const action=role==='owner'&&selected?.owner_id&&selected.owner_id!==user?.id?'transfer':active?'revoke':'grant';
 const actionText=action==='transfer'?'转让公会长':action==='revoke'?'撤销角色':membership?.status==='revoked'?'恢复角色':'任命角色';
 const roleText=role==='owner'?'公会长':'管理员';
 function review(){if(!user||!selected||(role==='owner'&&active)||(action!=='revoke'&&!user?.email_confirmed))return;setError('');setOperation({club_id:club,user_id:user.id,role,action,expected_version:selected.role_version,request_id:crypto.randomUUID()});}
 async function save(){if(busy||!operation||conflict)return;setBusy(true);setError('');try{await clubApi('/api/admin/assign-role',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation)},'角色修改失败，请重试');setOpen(false);onSaved();}catch(e){setError(e instanceof Error?e.message:'角色修改失败，请重试');if((e as {status?:number})?.status===409)setConflict(true);}finally{setBusy(false);}}
 return <Dialog open={open} onOpenChange={next=>{if(busy)return;if(next){setData(null);setClub('');setRole('admin');setError('');setConflict(false);setOperation(null);}setOpen(next);}}>{children}{user&&<DialogContent onCloseAutoFocus={event=>{event.preventDefault();returnFocus();}}>
  <DialogTitle>{operation?'确认角色变更':'管理俱乐部角色'}</DialogTitle><DialogDescription className="[overflow-wrap:anywhere]">网站账户：{user.email??user.id}。只修改俱乐部角色，不修改游戏玩家身份或超级管理员身份。</DialogDescription>
  {loading?<p role="status">正在读取最新角色状态…</p>:data&&<>
   {operation?<div className="grid gap-2 text-sm"><p className="m-0">俱乐部：<strong>{selected?.name}</strong></p><p className="m-0">角色：<strong>{roleText}</strong></p><p className="m-0">操作：<strong>{actionText}</strong></p>{operation.action==='transfer'&&<p className="m-0 text-warning">将撤销现任公会长的公会长角色，并在同一事务中转交给此账户；双方其他角色保持原状，不会自动给原公会长任命管理员。</p>}{operation.action==='revoke'&&<p className="m-0 text-warning">此角色授予的权限将立即失效；账户的其他有效角色仍会生效。</p>}</div>:<>
    <Field><FieldLabel htmlFor={`role-club-${user.id}`}>目标俱乐部</FieldLabel><NativeSelect id={`role-club-${user.id}`} value={club} onChange={e=>{setClub(e.target.value);setError('');}}><NativeSelectOption value="">请选择俱乐部</NativeSelectOption>{data.clubs.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect></Field>
    <Field><FieldLabel htmlFor={`role-kind-${user.id}`}>俱乐部角色</FieldLabel><NativeSelect id={`role-kind-${user.id}`} value={role} onChange={e=>{setRole(e.target.value as 'owner'|'admin');setError('');}}><NativeSelectOption value="admin">管理员</NativeSelectOption><NativeSelectOption value="owner">公会长</NativeSelectOption></NativeSelect></Field>
    {selected&&<p className="m-0 text-sm text-muted-foreground">当前状态：{active?'生效中':membership?.status==='revoked'?'已撤销':'未任命'} · 管理员上限 {selected.admin_limit} 人{role==='owner'&&active?'。公会长不能直接撤销，请选择其他账户转让。':''}</p>}
   </>}
  </>}
  {!user.email_confirmed&&<p className="m-0 text-sm text-warning">此账户邮箱未验证，只能撤销已有角色；验证邮箱后才能任命、恢复或转让。</p>}
  <FieldError>{error}</FieldError>{conflict&&<p className="m-0 text-sm text-warning">角色状态已变化，请刷新后重新核对并确认。</p>}
  <div className="flex flex-wrap justify-end gap-2"><DialogClose asChild><Button variant="secondary" disabled={busy}>取消</Button></DialogClose>{error&&(!data||conflict)?<Button onClick={()=>setRefresh(n=>n+1)} disabled={busy||loading}>刷新角色状态</Button>:operation?<><Button variant="secondary" disabled={busy} onClick={()=>{setOperation(null);setError('');}}>返回修改</Button><Button variant={operation.action==='grant'?'primary':'destructive'} loading={busy} onClick={save}>确认{actionText}</Button></>:<Button disabled={!selected||loading||(role==='owner'&&active)||(action!=='revoke'&&!user.email_confirmed)} onClick={review}>{actionText}</Button>}</div>
 </DialogContent>}</Dialog>;
}
