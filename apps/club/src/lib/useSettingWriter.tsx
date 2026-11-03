"use client";
import {useState} from 'react';
import {clubApi} from './data-access';
import {Button} from '../components/ui/button';
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle} from '../components/ui/alert-dialog';

// Shared by the platform settings and the owner's team page: one immediate save per change, with clear feedback.
export type Pending={summary:string;path:string;body:Record<string,unknown>;cell:string;sensitive:boolean};

/** Saves one setting with clear saved/failed feedback; widening a sensitive permission waits for a confirmation. */
export function useSettingWriter(onSaved:()=>void){
 const [saving,setSaving]=useState(''),[status,setStatus]=useState<{ok:boolean;text:string}|null>(null),[confirm,setConfirm]=useState<Pending|null>(null);
 async function save(p:Pending){
  setConfirm(null);setSaving(p.cell);setStatus(null);
  try{await clubApi(p.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p.body)},'保存失败，请重试');setStatus({ok:true,text:`已保存：${p.summary}`});onSaved();}
  catch(e){setStatus({ok:false,text:`保存失败（${p.summary}）：${e instanceof Error?e.message:'请重试'}`});}
  finally{setSaving('');}
 }
 const request=(p:Pending,widens:boolean)=>{if(saving)return;if(p.sensitive&&widens)setConfirm(p);else void save(p);};
 const feedback=<>{status&&<p role={status.ok?'status':'alert'} className={`m-0 text-sm ${status.ok?'text-gold':'text-destructive'}`}>{status.text}</p>}
  <AlertDialog open={!!confirm} onOpenChange={open=>{if(!open)setConfirm(null);}}><AlertDialogContent><AlertDialogTitle>扩大敏感权限</AlertDialogTitle>
   <AlertDialogDescription>{confirm?.summary}。这是敏感权限，保存后立即对相关账户生效，并记入操作日志。</AlertDialogDescription>
   <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary">取消</Button></AlertDialogCancel><Button onClick={()=>confirm&&void save(confirm)}>确认允许</Button></AlertDialogFooter>
  </AlertDialogContent></AlertDialog></>;
 return {saving,request,feedback};
}

