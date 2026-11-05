"use client";
import {useEffect,useState} from "react";
import {toast} from "../../components/ui/sonner";
import {clubApi} from "../../lib/data-access";
import {Card,CardDescription,CardTitle} from "../../components/ui/card";
import {Button} from "../../components/ui/button";
import {NativeSelect,NativeSelectOption} from "../../components/ui/native-select";
import {Field,FieldError,FieldLabel} from "../../components/ui/field";
import {LoadingState} from "../../components/feedback";
// The owner's join request (stage F, club.alliance.request). Shown only to holders; the Worker and database refuse
// anyone else. Joining needs the alliance leader's approval; leaving or moving is arranged by the platform.
type Status={alliance:{id:string;name:string}|null;request:{id:string;alliance_id:string;alliance_name:string}|null;alliances:{id:string;name:string}[]};
export function ClubAlliance(){
 const [data,setData]=useState<Status|null>(null),[choice,setChoice]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;clubApi<Status>("/api/club-alliance",undefined,"暂时无法读取联盟").then(d=>{if(!Array.isArray(d?.alliances))throw Error("暂时无法读取联盟");if(active){setData(d);setError("");}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 async function send(body:unknown,done:string){
  setBusy(true);setError("");
  try{await clubApi("/api/club-alliance",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)},"保存失败，请重试");toast.success(done);setChoice("");setRetry(n=>n+1);}
  catch(e){setError(e instanceof Error?e.message:"连接失败，请重试");}finally{setBusy(false);}
 }
 return <Card className="max-w-[calc(var(--club-form-max)+3rem)] items-stretch">
  <CardTitle>所属联盟</CardTitle>
  {!data?(error?<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/>:<LoadingState status="loading" label="正在读取联盟…"/>)
  :data.alliance?<CardDescription>本俱乐部属于「{data.alliance.name}」。该联盟的会长可以只读查看本俱乐部的数据。如需退出或更换联盟，请联系平台管理员。</CardDescription>
  :data.request?<><CardDescription>已申请加入「{data.request.alliance_name}」，等待该联盟会长处理。</CardDescription>
   <Button className="self-start" variant="secondary" loading={busy} loadingText="正在撤回…" onClick={()=>send({action:"withdraw"},"已撤回申请")}>撤回申请</Button></>
  :<><CardDescription>本俱乐部还没有加入联盟。加入后，联盟会长可以只读查看本俱乐部的成员、历史、数据分析和操作日志，不能修改任何内容。</CardDescription>
   {data.alliances.length?<><Field><FieldLabel htmlFor="club-alliance">选择联盟</FieldLabel><NativeSelect id="club-alliance" value={choice} disabled={busy} onChange={e=>setChoice(e.target.value)}><NativeSelectOption value="">请选择</NativeSelectOption>{data.alliances.map(a=><NativeSelectOption key={a.id} value={a.id}>{a.name}</NativeSelectOption>)}</NativeSelect></Field>
    <Button className="self-start" disabled={!choice} loading={busy} loadingText="正在申请…" onClick={()=>send({action:"request",alliance_id:choice},"已提交申请，等待联盟会长处理")}>申请加入</Button></>
   :<CardDescription>目前没有可加入的联盟。</CardDescription>}</>}
  {data&&<FieldError>{error}</FieldError>}
 </Card>;
}
