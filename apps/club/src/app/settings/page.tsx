"use client";
import {useEffect,useState} from "react";
import {AppShell} from "../../components/layout/AppShell";
import {PageHeader} from "../../components/layout/PageHeader";
import {Panel} from "../../components/ui/Panel";
import {Input} from "../../components/ui/Fields";
import {Button} from "../../components/ui/Button";
import {useClubBrand,loadClubSettings,saveClubName} from "../../components/useClubBrand";
export default function Settings(){
 const name=useClubBrand();const [draft,setDraft]=useState(""),[expected,setExpected]=useState(""),[notice,setNotice]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[canEdit,setCanEdit]=useState(false);
 useEffect(()=>{let active=true;void loadClubSettings().then(data=>{if(active){setDraft(data.name);setExpected(data.name);setCanEdit(data.can_edit);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 return <AppShell><main className="club-workspace"><PageHeader eyebrow="PREFERENCES" title="设置"/><Panel><h2>俱乐部名称</h2><form className="auth-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setNotice("");setError("");try{const saved=await saveClubName(draft,expected);setDraft(saved);setExpected(saved);setNotice("名称已保存。");}catch(e){setError(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}}}><label htmlFor="club-name">名称</label><Input id="club-name" value={draft} maxLength={120} required disabled={loading||busy||!canEdit} onChange={e=>setDraft(e.target.value)} placeholder={loading?"正在读取…":name}/><Button type="submit" disabled={loading||!canEdit||!draft.trim()} loading={busy} loadingText="正在保存…">保存名称</Button><p role="status">{notice}</p><p role="alert" className="feedback error">{error}</p></form><p className="muted">{loading?"正在读取俱乐部设置…":canEdit?"保存后，各设备读取同一个俱乐部名称。":"仅公会长可以修改名称。"}</p></Panel></main></AppShell>;
}
