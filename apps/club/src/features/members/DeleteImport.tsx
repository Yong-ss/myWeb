"use client";
import {useState} from 'react';
import {toast} from 'sonner';
import {clubApi} from '../../lib/data-access';
import {Button} from '../../components/ui/button';
import {Input} from '../../components/ui/input';
import {Field,FieldError,FieldLabel} from '../../components/ui/field';
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle,AlertDialogTrigger} from '../../components/ui/alert-dialog';
export function DeleteImport({date,snapshotId,onDeleted}:{date:string;snapshotId:string;onDeleted:()=>void}){
 const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function remove(){
  if(confirmation!==date||busy)return;
  setBusy(true);setError('');
  try{
   await clubApi('/api/delete-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,expected_snapshot_id:snapshotId,confirmed:true})},'删除失败，请重试');
   setOpen(false);onDeleted();toast.success(`已删除 ${date} 的数据`,{description:"玩家身份、其他日期和操作日志已保留。"});
  }catch(e){setError(e instanceof Error?e.message:'连接失败，请重试');}finally{setBusy(false);}
 }
 // Escape and Cancel cannot close it while the request runs, so the outcome is always shown.
 return <AlertDialog open={open} onOpenChange={next=>{if(busy)return;if(next){setConfirmation('');setError('');}setOpen(next);}}>
  <AlertDialogTrigger asChild><Button variant="destructive" size="compact">删除当天数据</Button></AlertDialogTrigger>
  <AlertDialogContent>
   <AlertDialogTitle>删除 {date} 的数据？</AlertDialogTitle>
   <AlertDialogDescription>当天所有版本将从名单、总览和个人历史中移除；成员状态会重新计算。</AlertDialogDescription>
   <p className="m-0 text-sm text-muted-foreground">玩家身份、其他日期和操作日志保留。没有一键撤销；需要时可重新导入。</p>
   <Field><FieldLabel htmlFor="delete-confirmation">输入日期 {date} 确认</FieldLabel><Input id="delete-confirmation" autoComplete="off" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></Field>
   <FieldError>{error}</FieldError>
   <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary" disabled={busy}>取消</Button></AlertDialogCancel><Button variant="destructive" disabled={confirmation!==date} loading={busy} loadingText="删除中…" onClick={remove}>确认删除</Button></AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
