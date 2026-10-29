"use client";
import {LoadingSpinner,LoadingState} from "../../components/feedback";
import {useEffect,useState} from "react";
import {PageHeader} from "../../components/layout/PageHeader";
import {Card,CardTitle} from "../../components/ui/card";
import {Input} from "../../components/ui/input";
import {Button,useSuccessFlash} from "../../components/ui/button";
import {Field,FieldDescription,FieldError,FieldGroup,FieldLabel} from "../../components/ui/field";
import {useClubBrand,loadClubSettings,saveClubName} from "../../lib/club-brand";
export function Settings(){
 const [retry,setRetry]=useState(0);
 const [saved,flashSaved]=useSuccessFlash();
 const name=useClubBrand();const [draft,setDraft]=useState(""),[expected,setExpected]=useState(""),[notice,setNotice]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[canEdit,setCanEdit]=useState(false);
 useEffect(()=>{let active=true;void loadClubSettings().then(data=>{if(active){setDraft(data.name);setExpected(data.name);setCanEdit(data.can_edit);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[retry]);
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setNotice("");setError("");try{const saved=await saveClubName(draft,expected);setDraft(saved);setExpected(saved);setNotice("名称已保存。");flashSaved();}catch(e){setError(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}}
 return <main className="club-workspace"><PageHeader eyebrow="PREFERENCES" title="设置"/>
  <Card className="max-w-[calc(var(--club-form-max)+3rem)] items-stretch">
   <CardTitle>俱乐部名称</CardTitle>
   {!loading&&!canEdit&&error&&<LoadingState status="error" detail={error} onRetry={()=>{setLoading(true);setError("");setRetry(n=>n+1);}} />}
   <form onSubmit={save}><FieldGroup>
    <Field><FieldLabel htmlFor="club-name">名称</FieldLabel><Input id="club-name" value={draft} maxLength={120} required disabled={loading||busy||!canEdit} onChange={e=>setDraft(e.target.value)} placeholder={loading?"正在读取…":name}/></Field>
    <Button type="submit" className="self-start" disabled={loading||!canEdit||!draft.trim()} loading={busy} loadingText="正在保存…" success={saved} successText="已保存">保存名称</Button>
    <p role="status" className="m-0 text-sm text-success empty:hidden">{notice}</p>
    <FieldError>{canEdit?error:""}</FieldError>
   </FieldGroup></form>
   <FieldDescription className="flex items-center gap-2">{loading&&<LoadingSpinner />}{loading?"正在读取俱乐部设置…":error&&!canEdit?"读取失败，可重试。":canEdit?"保存后，各设备读取同一个俱乐部名称。":"仅公会长可以修改名称。"}</FieldDescription>
  </Card>
 </main>;
}
