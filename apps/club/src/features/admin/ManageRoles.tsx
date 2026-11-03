"use client";
import {useEffect,useState,type ReactNode} from 'react';
import {clubApi} from '../../lib/data-access';
import {Button} from '../../components/ui/button';
import {Field,FieldError,FieldLabel,FieldLegend,FieldSet} from '../../components/ui/field';
import {Label} from '../../components/ui/label';
import {NativeSelect,NativeSelectOption} from '../../components/ui/native-select';
import {RadioGroup,RadioGroupItem} from '../../components/ui/radio-group';
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogTitle} from '../../components/ui/dialog';

// Display only: which actions are offered follows the single-role rule, but the Worker and database decide.
type Context={clubs:{id:string;name:string;admin_limit:number;admins?:number;role_version:number;owner_id:string|null}[];memberships:{club_id:string;role:string;status:string}[]};
type Choice='grant-admin'|'grant-owner'|'revoke-admin'|'remove'|'transfer';
type Previous='admin'|'leave';
type Operation={choice:Choice;path:string;body:Record<string,unknown>};
const roleNames:Record<string,string>={owner:'公会长',admin:'管理员'};
const actionNames:Record<Choice,string>={'grant-admin':'任命为管理员','grant-owner':'任命为公会长','revoke-admin':'撤销管理员职位',remove:'移出此俱乐部',transfer:'转让公会长给此账户'};
const confirmNames:Record<Choice,string>={'grant-admin':'确认任命管理员','grant-owner':'确认任命公会长','revoke-admin':'确认撤销职位',remove:'确认移出俱乐部',transfer:'确认转让公会长'};

export function ManageRoles({user,onSaved,children,returnFocus}:{user:{id:string;email:string|null;email_confirmed:boolean}|null;onSaved:()=>void;children:ReactNode;returnFocus:()=>void}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Context|null>(null),[club,setClub]=useState(''),[choice,setChoice]=useState<Choice|''>(''),[previous,setPrevious]=useState<Previous|''>('');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[conflict,setConflict]=useState(false),[operation,setOperation]=useState<Operation|null>(null);
 useEffect(()=>{if(!open||!user)return;const userId=user.id;let active=true;async function load(){setLoading(true);setError('');try{const d=await clubApi<Context>(`/api/admin/role-context?user=${userId}`,undefined,'职位状态读取失败');if(active){setData(d);setOperation(null);setConflict(false);setChoice('');setPrevious('');}}catch(e){if(active)setError(e instanceof Error?e.message:'职位状态读取失败');}finally{if(active)setLoading(false);}}void load();return()=>{active=false;};},[open,user,refresh]);
 const selected=data?.clubs.find(c=>c.id===club);
 const held=data?.memberships.find(m=>m.club_id===club&&m.status==='active')?.role;
 const admins=selected?.admins??0,full=!!selected&&admins>=selected.admin_limit;
 // A successor who is an admin frees their admin slot, so the previous owner may fit as admin.
 const previousFits=!!selected&&admins-(held==='admin'?1:0)<selected.admin_limit;
 const verified=user?.email_confirmed===true;
 const choices:{value:Choice;disabled?:string}[]=!selected||held==='owner'?[]:held===undefined
  ?[{value:'grant-admin',disabled:full?`已达到管理员人数上限（${selected.admin_limit} 人）`:undefined},selected.owner_id?{value:'transfer'}:{value:'grant-owner'}]
  :held==='admin'?[{value:'revoke-admin'},{value:'remove'},...(selected.owner_id?[{value:'transfer' as const}]:[])]:[{value:'remove'}];
 const needsVerified=(c:Choice|'')=>c==='grant-admin'||c==='grant-owner'||c==='transfer';
 const ready=!!choice&&!(needsVerified(choice)&&!verified)&&!(choice==='transfer'&&(!previous||(previous==='admin'&&!previousFits)));
 function review(){
  if(!user||!selected||!choice||!ready)return;setError('');
  const base={club_id:club,user_id:user.id,expected_version:selected.role_version,request_id:crypto.randomUUID()};
  setOperation(choice==='transfer'?{choice,path:'/api/admin/transfer-owner',body:{...base,previous_owner:previous}}
   :choice==='remove'?{choice,path:'/api/admin/remove-from-club',body:base}
   :{choice,path:'/api/admin/assign-role',body:{...base,role:choice==='grant-owner'?'owner':'admin',action:choice==='revoke-admin'?'revoke':'grant'}});
 }
 async function save(){if(busy||!operation||conflict)return;setBusy(true);setError('');try{await clubApi(operation.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(operation.body)},'职位修改失败，请重试');setOpen(false);onSaved();}catch(e){setError(e instanceof Error?e.message:'职位修改失败，请重试');if((e as {status?:number})?.status===409)setConflict(true);}finally{setBusy(false);}}
 const destructive=operation&&operation.choice!=='grant-admin'&&operation.choice!=='grant-owner';
 return <Dialog open={open} onOpenChange={next=>{if(busy)return;if(next){setData(null);setClub('');setChoice('');setPrevious('');setError('');setConflict(false);setOperation(null);}setOpen(next);}}>{children}{user&&<DialogContent onCloseAutoFocus={event=>{event.preventDefault();returnFocus();}}>
  <DialogTitle>{operation?'确认职位变更':'管理俱乐部职位'}</DialogTitle><DialogDescription className="[overflow-wrap:anywhere]">网站账户：{user.email??user.id}。同一俱乐部每人只能担任一个职位。这里只修改俱乐部职位，不修改游戏玩家身份或超级管理员身份。</DialogDescription>
  {loading?<p role="status">正在读取最新职位状态…</p>:data&&<>
   {operation?<div className="grid gap-2 text-sm"><p className="m-0">俱乐部：<strong>{selected?.name}</strong></p><p className="m-0">操作：<strong>{actionNames[operation.choice]}</strong></p>
    {operation.choice==='transfer'&&<p className="m-0 text-warning">此账户将成为公会长{held==='admin'?'，原有的管理员职位同时撤销':''}；现任公会长将{previous==='admin'?'改任管理员':'移出此俱乐部（不再担任任何职位）'}。全部变更一次完成，任何一步失败都不会生效。</p>}
    {operation.choice==='revoke-admin'&&<p className="m-0 text-warning">此账户在本俱乐部的管理员权限将立即失效。</p>}
    {operation.choice==='remove'&&<p className="m-0 text-warning">将撤销此账户在本俱乐部的全部职位，权限立即失效。不影响其他俱乐部，也不删除账户或历史记录。</p>}
   </div>:<>
    <Field><FieldLabel htmlFor={`role-club-${user.id}`}>目标俱乐部</FieldLabel><NativeSelect id={`role-club-${user.id}`} value={club} onChange={e=>{setClub(e.target.value);setChoice('');setPrevious('');setError('');}}><NativeSelectOption value="">请选择俱乐部</NativeSelectOption>{data.clubs.map(c=><NativeSelectOption key={c.id} value={c.id}>{c.name}</NativeSelectOption>)}</NativeSelect></Field>
    {selected&&<p className="m-0 text-sm text-muted-foreground">当前职位：<strong className="text-foreground">{held?roleNames[held]??'其他职位':'无'}</strong> · 管理员 {admins} / {selected.admin_limit} 人</p>}
    {held==='owner'&&<p className="m-0 text-sm text-warning">公会长不能直接撤销或移出。请在继任者的账户上选择「转让公会长给此账户」。</p>}
    {choices.length>0&&<FieldSet><FieldLegend>要执行的操作</FieldLegend>
     <RadioGroup value={choice} onValueChange={v=>{setChoice(v as Choice);setPrevious('');setError('');}}>{choices.map(c=><Field key={c.value} orientation="horizontal" className="min-h-11 items-center">
      <RadioGroupItem id={`role-${c.value}-${user.id}`} value={c.value} disabled={!!c.disabled}/><Label htmlFor={`role-${c.value}-${user.id}`}>{actionNames[c.value]}{c.disabled&&<span className="ml-2 text-xs text-muted-foreground">（{c.disabled}）</span>}</Label></Field>)}</RadioGroup></FieldSet>}
    {choice==='transfer'&&<FieldSet><FieldLegend>现任公会长的去留（必须选择）</FieldLegend>
     <RadioGroup value={previous} onValueChange={v=>{setPrevious(v as Previous);setError('');}}>
      <Field orientation="horizontal" className="min-h-11 items-center"><RadioGroupItem id={`prev-admin-${user.id}`} value="admin" disabled={!previousFits}/><Label htmlFor={`prev-admin-${user.id}`}>改任本俱乐部管理员{!previousFits&&<span className="ml-2 text-xs text-muted-foreground">（管理员已满，无法改任）</span>}</Label></Field>
      <Field orientation="horizontal" className="min-h-11 items-center"><RadioGroupItem id={`prev-leave-${user.id}`} value="leave"/><Label htmlFor={`prev-leave-${user.id}`}>移出此俱乐部</Label></Field>
     </RadioGroup></FieldSet>}
   </>}
  </>}
  {!verified&&<p className="m-0 text-sm text-warning">此账户邮箱未验证，只能撤销职位或移出；验证邮箱后才能任命或转让。</p>}
  <FieldError>{error}</FieldError>{conflict&&<p className="m-0 text-sm text-warning">职位状态已变化，请刷新后重新核对并确认。</p>}
  <div className="flex flex-wrap justify-end gap-2"><DialogClose asChild><Button variant="secondary" disabled={busy}>取消</Button></DialogClose>{error&&(!data||conflict)?<Button onClick={()=>setRefresh(n=>n+1)} disabled={busy||loading}>刷新职位状态</Button>:operation?<><Button variant="secondary" disabled={busy} onClick={()=>{setOperation(null);setError('');}}>返回修改</Button><Button variant={destructive?'destructive':'primary'} loading={busy} onClick={save}>{confirmNames[operation.choice]}</Button></>:<Button disabled={!selected||loading||!ready} onClick={review}>下一步</Button>}</div>
 </DialogContent>}</Dialog>;
}
