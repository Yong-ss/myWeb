"use client";
import {useEffect,useState} from 'react';
import {clubFetch} from '../../lib/data-access';
import {useDataRefresh} from '../../components/useDataRefresh';
import {PageHeader} from '../../components/layout/PageHeader';
import {Button} from '../../components/ui/Button';
import {LoadingState,TableSkeleton} from '../../components/feedback';
type Event={id:string;actor_id:string;action:string;details:Record<string,unknown>;created_at:string};
type Cursor={before:string;id:string};
const actions:Record<string,string>={club_initialized:'建立俱乐部',import_committed:'导入数据',import_date_deleted:'删除当天数据',alias_confirmed:'记住 AI 错名',alias_revoked:'解除错名关联',club_renamed:'修改俱乐部名称'};
function description(e:Event){const d=e.details;switch(e.action){
 case 'import_committed':return `${d.date} · 第 ${d.revision} 版 · ${d.mode==='merge'?'补充更新':'替换名单'}`;
 case 'import_date_deleted':return `${d.date} · 移除 ${d.versions} 个版本`;
 case 'club_renamed':return `${d.old_name} → ${d.new_name}`;
 case 'alias_confirmed':case 'alias_revoked':return '玩家关联已更新';
 default:return '俱乐部管理操作';
}}
export default function Activity(){
 const [events,setEvents]=useState<Event[]>([]),[next,setNext]=useState<Cursor|null>(null),[busy,setBusy]=useState(true),[moreBusy,setMoreBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useDataRefresh(()=>setRetry(n=>n+1));
 async function read(cursor?:Cursor,signal?:AbortSignal){
  const r=await clubFetch('/api/activity'+(cursor?'?'+new URLSearchParams(cursor):''),{signal});
  if([401,403].includes(r.status)){window.location.replace('/login');throw Error('请重新登录');}
  const data=await r.json();if(!r.ok)throw Error(data.error??'日志读取失败');return data as {events:Event[];next:Cursor|null};
 }
 useEffect(()=>{const c=new AbortController();async function load(){setBusy(true);setError('');await read(undefined,c.signal).then(d=>{if(!c.signal.aborted){setEvents(d.events);setNext(d.next);}}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});}void load();return()=>c.abort();},[retry]);
 async function more(){if(!next||moreBusy)return;setMoreBusy(true);setError('');try{const d=await read(next);setEvents(old=>[...old,...d.events.filter(e=>!old.some(o=>o.id===e.id))]);setNext(d.next);}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setMoreBusy(false);}}
 return <main className="club-workspace"><PageHeader eyebrow="ACTIVITY / 管理记录" title="操作日志"/><p className="muted">记录公会长和管理员对数据的修改；日志不可编辑或删除。时间为北京时间。</p>
 {error&&<LoadingState status="error" detail={error} onRetry={()=>next&&events.length?void more():setRetry(n=>n+1)}/>}
 {busy&&!events.length?<TableSkeleton columns={4} label="正在读取操作日志…"/>:events.length?<div className="members-table-wrap"><table className="members-table"><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>内容</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date(e.created_at))}</td><td>{String(e.details.actor_email??e.actor_id)}<small className="muted"> · {e.details.actor_role==='owner'?'公会长':e.details.actor_role==='admin'?'管理员':'历史记录'}</small></td><td>{actions[e.action]??e.action}</td><td>{description(e)}</td></tr>)}</tbody></table></div>:!error&&<LoadingState status="empty" title="暂无操作记录"/>}
 {next&&<Button loading={moreBusy} loadingText="读取中…" onClick={more}>更早记录</Button>}
 </main>;
}
