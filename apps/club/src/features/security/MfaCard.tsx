"use client";
import {useEffect,useState} from "react";
import {clubApi,invalidateClubData} from "../../lib/data-access";
import {Card,CardDescription,CardTitle} from "../../components/ui/card";
import {Input} from "../../components/ui/input";
import {Button} from "../../components/ui/button";
import {Badge} from "../../components/ui/badge";
import {NativeSelect,NativeSelectOption} from "../../components/ui/native-select";
import {Field,FieldDescription,FieldError,FieldGroup,FieldLabel} from "../../components/ui/field";
import {LoadingState} from "../../components/feedback";

// Super Admin and platform admin. The secret and codes go straight to Supabase Auth through the Worker; nothing is
// stored here. Display state is advisory: the database grants Super Admin powers only to an aal2 session from a factor
// the owner confirmed in Supabase SQL Editor, and platform admin powers to an aal2 session from the account's own
// verified factor (no confirmation); this page can never confirm one.
type Account={super_admin:boolean;mfa_verified:boolean;mfa_session?:boolean;platform_admin?:boolean;platform_permissions?:string[]};
type Factor={id:string;name:string;created_at:string|null;trusted?:boolean};
type Setup={id:string;qr_code:string;secret:string};
const post=(body:unknown)=>clubApi("/api/mfa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)},"两步验证暂时不可用");
export function MfaCard(){
 const [account,setAccount]=useState<Account|null>(null),[factors,setFactors]=useState<Factor[]>([]),[setup,setSetup]=useState<Setup|null>(null);
 const [code,setCode]=useState(""),[name,setName]=useState(""),[factorId,setFactorId]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;void (async()=>{try{
  const a=await clubApi<Account>("/api/account");if(!active)return;setAccount(a);
  if(a.super_admin||a.platform_admin){const f=await clubApi<{factors:Factor[]}>("/api/mfa");if(active){setFactors(f.factors);setFactorId(f.factors[0]?.id??"");}}
 }catch(e){if(active)setError(e instanceof Error?e.message:"读取失败");}})();return()=>{active=false;};},[retry]);
 if(!account)return error?<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/>:<LoadingState status="loading" label="正在读取账户安全设置…"/>;
 if(!account.super_admin&&!account.platform_admin)return <LoadingState status="empty" title="没有需要设置的项目" detail="两步验证目前只用于超级管理员和平台管理员账户。"/>;
 // Only the Super Admin has devices to confirm in SQL Editor; a platform admin's verified factor is enough.
 const sa=account.super_admin,active=sa?account.mfa_verified:(account.platform_permissions?.length??0)>0;
 async function run(action:()=>Promise<void>){setBusy(true);setError("");setNotice("");try{await action();}catch(e){setError(e instanceof Error?e.message:"操作失败");}finally{setBusy(false);}}
 const start=()=>run(async()=>{setSetup(await post({action:"enroll",name}));setCode("");});
 const verify=(id:string)=>run(async()=>{await post({action:"verify",factor_id:id,code});setSetup(null);setCode("");invalidateClubData();window.dispatchEvent(new Event("club-account-changed"));setNotice("验证成功。");setRetry(n=>n+1);});
 const remove=(id:string)=>run(async()=>{await post({action:"remove",factor_id:id});invalidateClubData();window.dispatchEvent(new Event("club-account-changed"));setNotice("已移除验证器。");setRetry(n=>n+1);});
 const codeField=(id:string,label:string)=><Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} disabled={busy}/></Field>;
 return <Card className="max-w-[calc(var(--club-form-max)+3rem)] items-stretch">
  <CardTitle>两步验证 <Badge variant={active?"default":"destructive"}>{active?(sa?"超级管理员已启用":"平台管理员已启用"):sa&&account.mfa_session?"已验证，验证器待确认":"未验证"}</Badge></CardTitle>
  <CardDescription>{sa?"超级管理员权限只在本次登录完成两步验证后生效；未验证时仍保留俱乐部原有权限。请绑定至少两个验证器（例如手机和备用设备），以免丢失设备后无法验证。新验证器需要在 Supabase SQL Editor 中确认后才会启用超级管理员权限。"
   :"平台管理功能只在本次登录完成两步验证后才能使用；未验证时仍保留俱乐部原有职位。请绑定至少两个验证器（例如手机和备用设备），以免丢失设备后无法验证。"}</CardDescription>
  {factors.length>0&&!setup&&<FieldGroup>
   {factors.length>1&&<Field><FieldLabel htmlFor="mfa-factor">验证器</FieldLabel><NativeSelect id="mfa-factor" value={factorId} onChange={e=>setFactorId(e.target.value)}>{factors.map(f=><NativeSelectOption key={f.id} value={f.id}>{f.name}</NativeSelectOption>)}</NativeSelect></Field>}
   {!account.mfa_session&&<>{codeField("mfa-code","验证码（6 位）")}<Button className="self-start" disabled={code.length!==6} loading={busy} loadingText="正在验证…" onClick={()=>verify(factorId)}>验证</Button></>}
   <ul className="m-0 grid list-none gap-2 p-0 text-sm">{factors.map(f=><li key={f.id} className="flex flex-wrap items-center justify-between gap-3"><span>{f.name} {sa&&!f.trusted&&<Badge variant="destructive">待确认</Badge>}</span>{account.mfa_session&&<Button size="compact" variant="secondary" disabled={busy||factors.length<2} onClick={()=>remove(f.id)}>移除</Button>}</li>)}</ul>
   {sa&&factors.filter(f=>!f.trusted).map(f=><FieldDescription key={f.id}>确认「{f.name}」是你本人绑定的，然后登录 Supabase 控制台，在 SQL Editor 运行：<code className="break-all">select club_private.trust_super_admin_factor(&apos;{f.id}&apos;);</code> 不认识这个验证器时不要确认，请在 Supabase 控制台删除它。</FieldDescription>)}
   {account.mfa_session&&factors.length<2&&<FieldDescription>至少保留一个验证器；请先添加备用验证器再移除。</FieldDescription>}
  </FieldGroup>}
  {setup?<FieldGroup>
   <FieldDescription>用验证器 App 扫描二维码，或手动输入密钥，然后输入 App 显示的 6 位验证码。关闭本页后此密钥不再显示。</FieldDescription>
   {/* eslint-disable-next-line @next/next/no-img-element -- Auth returns a data: URL; next/image cannot optimize it. */}
   <img src={setup.qr_code} alt="两步验证二维码" width={180} height={180} className="bg-white p-2"/>
   <code className="break-all text-xs">{setup.secret}</code>
   {codeField("mfa-setup-code","验证码（6 位）")}
   <Button className="self-start" disabled={code.length!==6} loading={busy} loadingText="正在验证…" onClick={()=>verify(setup.id)}>完成绑定</Button>
  </FieldGroup>:(account.mfa_session||factors.length===0)&&<FieldGroup>
   <Field><FieldLabel htmlFor="mfa-name">设备名称</FieldLabel><Input id="mfa-name" maxLength={30} value={name} onChange={e=>setName(e.target.value)} placeholder="例如：手机" disabled={busy}/></Field>
   <Button className="self-start" variant="secondary" loading={busy} loadingText="正在准备…" onClick={start}>{factors.length?"添加备用验证器":"开始绑定"}</Button>
  </FieldGroup>}
  {factors.length>0&&!account.mfa_session&&!setup&&<FieldDescription>新增或移除验证器需要先完成验证。</FieldDescription>}
  <p role="status" className="m-0 text-sm text-success empty:hidden">{notice}</p>
  <FieldError>{error}</FieldError>
 </Card>;
}
