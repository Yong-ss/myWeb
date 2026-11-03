"use client";
import {useState,type FormEvent} from 'react';
import {clubApi} from '../../lib/data-access';
import {Button} from '../../components/ui/button';
import {Field,FieldDescription,FieldError,FieldLabel} from '../../components/ui/field';
import {Input} from '../../components/ui/input';
import {Dialog,DialogClose,DialogContent,DialogDescription,DialogTitle,DialogTrigger} from '../../components/ui/dialog';

// Super Admin only; the Worker (platform.clubs.admin_limit) and the database decide. Lowering never removes anyone:
// a limit below the current number of admins is refused by the database with an explanation.
export function AdminLimit({club,onSaved}:{club:{id:string;name:string;admins:number;admin_limit:number};onSaved:()=>void}){
 const [open,setOpen]=useState(false),[value,setValue]=useState(String(club.admin_limit)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const limit=Number(value),valid=/^\d+$/.test(value)&&limit>=1&&limit<=1000;
 async function save(e:FormEvent){e.preventDefault();if(busy||!valid)return;setBusy(true);setError('');
  try{await clubApi('/api/admin/admin-limit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({club_id:club.id,admin_limit:limit})},'上限修改失败，请重试');setOpen(false);onSaved();}
  catch(err){setError(err instanceof Error?err.message:'上限修改失败，请重试');}finally{setBusy(false);}}
 return <Dialog open={open} onOpenChange={next=>{if(busy)return;if(next){setValue(String(club.admin_limit));setError('');}setOpen(next);}}>
  <DialogTrigger asChild><Button variant="secondary" size="compact" aria-label={`修改${club.name}的管理员人数上限`}>修改上限</Button></DialogTrigger>
  <DialogContent><DialogTitle>管理员人数上限</DialogTitle><DialogDescription>{club.name} 目前有 {club.admins} 名管理员。达到上限后不能再任命新的管理员；降低上限不会自动撤销任何人。</DialogDescription>
   <form onSubmit={save} className="grid gap-4"><Field><FieldLabel htmlFor={`admin-limit-${club.id}`}>最多管理员人数</FieldLabel>
    <Input id={`admin-limit-${club.id}`} type="number" inputMode="numeric" min={Math.max(1,club.admins)} max={1000} step={1} required value={value} onChange={e=>{setValue(e.target.value);setError('');}}/>
    <FieldDescription>可设为 {Math.max(1,club.admins)} 到 1000 人。</FieldDescription></Field>
    <FieldError>{error||(!valid&&value!==''?'请输入 1 到 1000 之间的整数':'')}</FieldError>
    <div className="flex flex-wrap justify-end gap-2"><DialogClose asChild><Button type="button" variant="secondary" disabled={busy}>取消</Button></DialogClose><Button type="submit" loading={busy} disabled={!valid||limit===club.admin_limit}>保存上限</Button></div>
   </form></DialogContent></Dialog>;
}
