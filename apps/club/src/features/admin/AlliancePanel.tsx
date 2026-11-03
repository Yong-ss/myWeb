"use client";
import {useEffect,useState,type FormEvent} from "react";
import {toast} from "sonner";
import {clubApi} from "../../lib/data-access";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {LoadingState,TableSkeleton} from "../../components/feedback";
import {Badge} from "../../components/ui/badge";
import {Button} from "../../components/ui/button";
import {Input} from "../../components/ui/input";
import {Field,FieldError,FieldLabel} from "../../components/ui/field";
import {NativeSelect,NativeSelectOption} from "../../components/ui/native-select";
import {Table,TableBody,TableCaption,TableCell,TableHead,TableHeader,TableRow} from "../../components/ui/table";
// Stage F. Reading needs platform.read; changes need platform.alliances.manage / platform.alliance_leaders.assign
// (Super Admin or a platform admin after MFA). Display only: the Worker and database check every change.
type Data={alliances:{id:string;name:string;status:"active"|"disabled";leader:{user_id:string;email:string|null}|null;clubs:{id:string;name:string}[];pending:number}[];clubs:{id:string;name:string;alliance_id:string|null}[]};
const post=(path:string,body:unknown,fallback:string)=>clubApi(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)},fallback);

export function AlliancePanel({canManage,canAssign}:{canManage:boolean;canAssign:boolean}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0),[busy,setBusy]=useState(""),[problem,setProblem]=useState("");
 const [name,setName]=useState(""),[leaderEmail,setLeaderEmail]=useState<Record<string,string>>({});
 useDataRefresh(()=>setRetry(n=>n+1));
 useEffect(()=>{let active=true;clubApi<Data>("/api/admin/alliances",undefined,"联盟读取失败").then(d=>{if(active){setData(d);setError("");}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 async function run(key:string,action:()=>Promise<unknown>,done:string){
  setBusy(key);setProblem("");
  try{await action();toast.success(done);setRetry(n=>n+1);return true;}catch(e){setProblem(e instanceof Error?e.message:"连接失败，请重试");return false;}finally{setBusy("");}
 }
 const create=async(e:FormEvent)=>{e.preventDefault();if(await run("create",()=>post("/api/admin/alliance",{alliance_id:null,name,status:"active"},"创建失败"),`已创建联盟「${name.trim()}」`))setName("");};
 if(error)return <LoadingState status="error" title="联盟读取失败" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/>;
 if(!data)return <TableSkeleton columns={4} label="正在读取联盟…"/>;
 const names=Object.fromEntries(data.alliances.map(a=>[a.id,a.name]));
 return <div className="grid gap-6">
  <p className="m-0 text-sm text-muted-foreground">一个俱乐部最多属于一个联盟；每个联盟最多一位会长，一个账户最多担任一个联盟的会长。联盟会长只能只读查看本联盟俱乐部的数据，不能修改任何内容。俱乐部也可以由公会长申请加入，由联盟会长批准。</p>
  {canManage&&<form onSubmit={create} className="flex flex-wrap items-end gap-3"><Field className="max-w-80 min-w-56 flex-1"><FieldLabel htmlFor="alliance-name">新建联盟</FieldLabel><Input id="alliance-name" maxLength={60} value={name} placeholder="联盟名称" onChange={e=>setName(e.target.value)} disabled={busy==="create"}/></Field><Button type="submit" variant="secondary" disabled={!name.trim()} loading={busy==="create"} loadingText="正在创建…">创建</Button></form>}
  <FieldError>{problem}</FieldError>
  {data.alliances.length?<Table><TableCaption>全部联盟</TableCaption>
   <TableHeader><TableRow><TableHead>联盟</TableHead><TableHead>会长</TableHead><TableHead>俱乐部</TableHead><TableHead>状态</TableHead></TableRow></TableHeader>
   <TableBody>{data.alliances.map(a=><TableRow key={a.id}>
    <TableCell className="min-w-40 align-top whitespace-normal"><span className="font-medium">{a.name}</span>{a.pending>0&&<small className="mt-1 block text-warning">{a.pending} 个待处理申请</small>}</TableCell>
    <TableCell className="min-w-56 align-top whitespace-normal [overflow-wrap:anywhere]">{a.leader?<span className="grid gap-2"><span>{a.leader.email??"（无邮箱）"}</span>{canAssign&&<Button size="compact" variant="secondary" className="self-start" loading={busy===`revoke-${a.id}`} loadingText="正在撤销…" aria-label={`撤销${a.name}的会长`} onClick={()=>run(`revoke-${a.id}`,()=>post("/api/admin/alliance-leader",{alliance_id:a.id,email:null,action:"revoke"},"撤销失败"),`已撤销「${a.name}」的会长`)}>撤销会长</Button>}</span>
     :canAssign&&a.status==="active"?<form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();void run(`grant-${a.id}`,()=>post("/api/admin/alliance-leader",{alliance_id:a.id,email:leaderEmail[a.id]??"",action:"grant"},"任命失败"),`已任命「${a.name}」的会长`);}}>
      <Field className="min-w-48 flex-1"><FieldLabel htmlFor={`leader-${a.id}`}>任命会长（邮箱）</FieldLabel><Input id={`leader-${a.id}`} type="email" maxLength={320} value={leaderEmail[a.id]??""} onChange={e=>setLeaderEmail(v=>({...v,[a.id]:e.target.value}))}/></Field>
      <Button type="submit" size="compact" disabled={!(leaderEmail[a.id]??"").trim()} loading={busy===`grant-${a.id}`} loadingText="正在任命…">任命</Button></form>:<span className="text-muted-foreground">暂无会长</span>}</TableCell>
    <TableCell className="min-w-40 align-top whitespace-normal">{a.clubs.length?a.clubs.map(c=><span key={c.id} className="block">{c.name}</span>):<span className="text-muted-foreground">暂无</span>}</TableCell>
    <TableCell className="align-top"><span className="grid gap-2"><Badge variant={a.status==="active"?"outline":"warning"}>{a.status==="active"?"使用中":"已停用"}</Badge>
     {canManage&&<Button size="compact" variant="secondary" className="self-start" loading={busy===`status-${a.id}`} loadingText="正在保存…" onClick={()=>run(`status-${a.id}`,()=>post("/api/admin/alliance",{alliance_id:a.id,name:a.name,status:a.status==="active"?"disabled":"active"},"保存失败"),a.status==="active"?`已停用「${a.name}」`:`已启用「${a.name}」`)}>{a.status==="active"?"停用":"重新启用"}</Button>}</span></TableCell>
   </TableRow>)}</TableBody></Table>:<LoadingState status="empty" title="还没有联盟"/>}
  <section className="grid gap-3"><h3 className="m-0 text-base">俱乐部所属联盟</h3>
   <Table><TableHeader><TableRow><TableHead>俱乐部</TableHead><TableHead>所属联盟</TableHead></TableRow></TableHeader>
    <TableBody>{data.clubs.map(c=><TableRow key={c.id}><TableCell>{c.name}</TableCell><TableCell>{canManage?
     <NativeSelect aria-label={`${c.name}所属联盟`} value={c.alliance_id??""} disabled={busy===`club-${c.id}`} onChange={e=>{const target=e.target.value||null;void run(`club-${c.id}`,()=>post("/api/admin/club-alliance",{club_id:c.id,alliance_id:target},"保存失败"),target?`「${c.name}」已归入「${names[target]}」`:`「${c.name}」已移出联盟`);}}>
      <NativeSelectOption value="">不属于联盟</NativeSelectOption>{data.alliances.filter(a=>a.status==="active"||a.id===c.alliance_id).map(a=><NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}</NativeSelect>
     :c.alliance_id?names[c.alliance_id]:"不属于联盟"}</TableCell></TableRow>)}</TableBody></Table>
  </section>
 </div>;
}
