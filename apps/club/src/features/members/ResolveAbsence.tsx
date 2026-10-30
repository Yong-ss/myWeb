"use client";
import {useState} from 'react';
import {clubApi} from '../../lib/data-access';
import {Button} from '../../components/ui/button';
import {Input} from '../../components/ui/input';
import {Field,FieldLabel,FieldError} from '../../components/ui/field';
import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription,DialogClose} from '../../components/ui/dialog';
import {RadioGroup,RadioGroupItem} from '../../components/ui/radio-group';
export function ResolveAbsence({playerId,name,snapshotId,onSaved}:{playerId:string;name:string;snapshotId:string;onSaved:()=>void}){
 const [open,setOpen]=useState(false),[decision,setDecision]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(){if(busy||!decision||(decision==='temporary'&&!reason.trim()))return;setBusy(true);setError('');try{
 await clubApi('/api/resolve-absence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshot_id:snapshotId,player_id:playerId,decision,...(decision==='temporary'?{reason:reason.trim()}:{}),confirmed:true})},'保存失败，请重试');setOpen(false);onSaved();
 }catch(e){setError(e instanceof Error?e.message:'保存失败，请重试');}finally{setBusy(false);}}
 return <Dialog open={open} onOpenChange={next=>{if(busy)return;if(next){setDecision('');setReason('');setError('');}setOpen(next);}}><DialogTrigger asChild><Button variant="ghost" size="compact">处理</Button></DialogTrigger><DialogContent><DialogTitle>处理 {name} 的缺席</DialogTitle><DialogDescription>确认原因后，会移到不在会名单。若只是漏录，请取消并补进对应日期的名单。</DialogDescription><RadioGroup aria-label="处理方式" value={decision} onValueChange={setDecision} disabled={busy}>{[['left','确认退会'],['temporary','暂离']].map(([value,label])=><label key={value} className="flex min-h-11 cursor-pointer items-center gap-3"><RadioGroupItem value={value}/>{label}</label>)}</RadioGroup>{decision==='temporary'&&<Field><FieldLabel htmlFor={`resolve-reason-${playerId}`}>暂离理由</FieldLabel><Input id={`resolve-reason-${playerId}`} value={reason} onChange={e=>setReason(e.target.value)} required maxLength={500} disabled={busy}/></Field>}<FieldError>{error}</FieldError><div className="flex justify-end gap-2"><DialogClose asChild><Button variant="secondary" disabled={busy}>取消</Button></DialogClose><Button loading={busy} disabled={!decision||(decision==='temporary'&&!reason.trim())} onClick={save}>保存</Button></div></DialogContent></Dialog>;
}
