"use client";
import {useEffect,useState} from 'react';
import {clubApi} from '../../lib/data-access';
import {useDataRefresh} from '../../lib/useDataRefresh';
import {PageHeader} from '../../components/layout/PageHeader';
import {Button} from '../../components/ui/button';
import {Badge} from '../../components/ui/badge';
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from '../../components/ui/table';
import {LoadingState,TableSkeleton} from '../../components/feedback';
// The server decides what identity each viewer may see; the page never derives it from details.
type Event={id:string;actor_id:string|null;actor_label:string|null;actor_kind:'member'|'super_admin';actor_role:string|null;action:string;details:Record<string,unknown>;created_at:string};
const roleName=(e:Event)=>e.actor_kind==='super_admin'?'超级管理员':e.actor_role==='owner'?'公会长':e.actor_role==='admin'?'管理员':e.details.by==='platform'?'平台管理员':'历史记录';
type Cursor={before:string;id:string};
const actions:Record<string,string>={club_initialized:'建立俱乐部',import_committed:'导入数据',import_date_deleted:'删除当天数据',alias_confirmed:'记住 AI 错名',alias_revoked:'解除错名关联',club_renamed:'修改俱乐部名称',player_renamed:'更正玩家昵称',absence_resolved:'处理待确认成员',absence_reviewed:'核对缺席成员',admin_appointed:'任命管理员',admin_revoked:'撤销管理员职位',admin_removed:'移出管理员',admin_default_changed:'修改管理员默认权限',admin_permission_changed:'修改管理员个人权限',event_permission_changed:'平台设置四方联赛权限',event_created:'导入四方联赛',event_score:'修改联赛总积分',event_date:'修改联赛日期',event_metrics:'修改联赛玩家数据',event_rebind:'联赛改绑身份',event_add:'联赛补录玩家',event_remove:'联赛移除参赛记录',event_void:'作废四方联赛',event_restore:'恢复四方联赛',
 highland_permission_changed:'平台设置高原竞逐权限',highland_created:'导入高原竞逐',highland_score:'修改高原总积分',highland_date:'修改高原日期',highland_faction:'修改高原势力或名次',highland_metrics:'修改高原玩家数据',highland_rebind:'高原改绑身份',highland_add:'高原补录玩家',highland_remove:'高原移除参赛记录',highland_void:'作废高原竞逐',highland_restore:'恢复高原竞逐'};
function description(e:Event){const d=e.details;switch(e.action){
 case 'absence_resolved':return d.decision==='temporary'?`暂离 · ${d.reason??''}`:'已确认退会';
 case 'absence_reviewed':return `${d.date} · 核对 ${Array.isArray(d.decisions)?d.decisions.length:0} 人`;
 case 'import_committed':return `${d.date} · 第 ${d.revision} 版 · ${d.mode==='merge'?'补充更新':'替换名单'}`;
 case 'import_date_deleted':return `${d.date} · 移除 ${d.versions} 个版本`;
 case 'player_renamed':case 'club_renamed':return `${d.old_name} → ${d.new_name}`;
 case 'alias_confirmed':case 'alias_revoked':return '玩家关联已更新';
 case 'admin_default_changed':case 'admin_permission_changed':{const v=(x:unknown)=>x===true?'允许':x===false?'不允许':'跟随默认';return `${d.description} · ${v(d.old)} → ${v(d.new)}`;}
 case 'event_permission_changed':case 'highland_permission_changed':{const v=(x:unknown)=>x===true?'允许':x===false?'禁止':'跟随下层';return `${d.description} · ${d.role==='owner'?'公会长职位':d.role==='admin'?'管理员职位':'个人'} · ${v(d.old)} → ${v(d.new)}`;}
 case 'event_created':return `${d.date} · 总积分 ${d.total_score} · ${d.participants} 人`;
 case 'highland_created':return `${d.date} · 总积分 ${d.total_score} · ${d.faction??'势力未填写'} · ${d.faction_rank?`第 ${d.faction_rank} 名`:'名次未填写'} · 本俱乐部 ${d.participants} 人`;
 case 'highland_faction':return `${d.event_date} · 第 ${d.version} 版`;
 case 'event_score':case 'event_date':case 'highland_score':case 'highland_date':return `${d.event_date} · ${d.old} → ${d.new}`;
 case 'event_metrics':case 'event_rebind':case 'event_add':case 'event_remove':case 'event_void':case 'event_restore':
 case 'highland_metrics':case 'highland_rebind':case 'highland_add':case 'highland_remove':case 'highland_void':case 'highland_restore':return `${d.event_date} · 第 ${d.version} 版`;
 default:return '俱乐部管理操作';
}}
const time=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false});
export function Activity(){
 const [events,setEvents]=useState<Event[]>([]),[next,setNext]=useState<Cursor|null>(null),[busy,setBusy]=useState(true),[moreBusy,setMoreBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useDataRefresh(()=>setRetry(n=>n+1));
 const read=(cursor?:Cursor,signal?:AbortSignal)=>clubApi<{events:Event[];next:Cursor|null}>('/api/activity'+(cursor?'?'+new URLSearchParams(cursor):''),{signal},'日志读取失败');
 useEffect(()=>{const c=new AbortController();async function load(){setBusy(true);setError('');await read(undefined,c.signal).then(d=>{if(!c.signal.aborted){setEvents(d.events);setNext(d.next);}}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setBusy(false);});}void load();return()=>c.abort();},[retry]);
 async function more(){if(!next||moreBusy)return;setMoreBusy(true);setError('');try{const d=await read(next);setEvents(old=>[...old,...d.events.filter(e=>!old.some(o=>o.id===e.id))]);setNext(d.next);}catch(e){setError(e instanceof Error?e.message:'读取失败');}finally{setMoreBusy(false);}}
 return <main className="club-workspace club-activity flex flex-col gap-4"><PageHeader eyebrow="ACTIVITY / 管理记录" title="操作日志"/><p className="m-0 -mt-4 text-sm text-muted-foreground">记录公会长和管理员对数据的修改；日志不可编辑或删除。时间为北京时间。</p>
 {error&&<LoadingState status="error" detail={error} onRetry={()=>next&&events.length?void more():setRetry(n=>n+1)}/>}
 {busy&&!events.length?<TableSkeleton columns={4} label="正在读取操作日志…"/>:events.length?<Table containerClassName="members-table-wrap"><TableCaption>管理操作记录 · 按时间倒序</TableCaption><TableHeader><TableRow><TableHead>时间</TableHead><TableHead>操作人</TableHead><TableHead>操作</TableHead><TableHead>内容</TableHead></TableRow></TableHeader><TableBody>{events.map(e=><TableRow key={e.id}>
  <TableCell className="text-muted-foreground">{time.format(new Date(e.created_at))}</TableCell>
  <TableCell className="min-w-36 whitespace-normal [overflow-wrap:anywhere]">{e.actor_label??roleName(e)}{e.actor_label&&e.actor_label!==roleName(e)&&<small className="block text-muted-foreground">{roleName(e)}</small>}</TableCell>
  <TableCell><Badge variant={e.action==='import_date_deleted'?'destructive':'default'}>{actions[e.action]??e.action}</Badge></TableCell>
  <TableCell className="min-w-36 whitespace-normal [overflow-wrap:anywhere]">{description(e)}</TableCell>
 </TableRow>)}</TableBody></Table>:!error&&<LoadingState status="empty" title="暂无操作记录"/>}
 {next&&<Button className="self-start" loading={moreBusy} loadingText="读取中…" onClick={more}>更早记录</Button>}
 </main>;
}
