"use client";
import {useRef,useState} from 'react';
import {clubApi} from '../../lib/data-access';
import {Button} from '../../components/ui/Button';
import {Input} from '../../components/ui/Fields';
export function DeleteImport({date,snapshotId,onDeleted}:{date:string;snapshotId:string;onDeleted:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function remove(){
  if(confirmation!==date||busy)return;
  setBusy(true);setError('');
  try{
   await clubApi('/api/delete-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,expected_snapshot_id:snapshotId,confirmed:true})},'删除失败，请重试');
   dialog.current?.close();onDeleted();
  }catch(e){setError(e instanceof Error?e.message:'连接失败，请重试');}finally{setBusy(false);}
 }
 return <><Button variant="danger" onClick={()=>{setConfirmation('');setError('');dialog.current?.showModal();}}>删除当天数据</Button>
 <dialog ref={dialog} className="club-dialog" aria-labelledby="delete-import-title" onCancel={e=>{if(busy)e.preventDefault();}} onKeyDown={e=>{
  if(e.key!=='Tab')return;const nodes=e.currentTarget.querySelectorAll<HTMLElement>('input,button:not(:disabled)');const first=nodes[0],last=nodes[nodes.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 }}>
  <h2 id="delete-import-title">删除 {date} 的数据？</h2>
  <p>当天所有版本将从名单、总览和个人历史中移除；成员状态会重新计算。</p>
  <p className="muted">玩家身份、其他日期和操作日志保留。没有一键撤销；需要时可重新导入。</p>
  <label>输入日期 {date} 确认<Input autoFocus value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)}/></label>
  {error&&<p role="alert">{error}</p>}
  <div className="club-dialog-actions"><Button disabled={busy} onClick={()=>dialog.current?.close()}>取消</Button><Button variant="danger" disabled={confirmation!==date} loading={busy} loadingText="删除中…" onClick={remove}>确认删除</Button></div>
 </dialog></>;
}
