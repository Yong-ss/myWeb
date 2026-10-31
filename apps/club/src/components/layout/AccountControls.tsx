"use client";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import {GearSixIcon,ShieldCheckIcon} from "@phosphor-icons/react";
import {clubApi} from "../../lib/data-access";
import {Button,ButtonLink} from "../ui/button";
import {Skeleton} from "../ui/skeleton";
// Display only: the highest role name. Access is decided by the Worker and database from permissions.
const roleNames: Record<string, string> = { owner: "公会长", admin: "管理员" };
function roleLabel(data: { roles?: unknown; super_admin?: boolean; mfa_verified?: boolean }) {
  if (data.super_admin && data.mfa_verified) return "超级管理员";
  const roles = Array.isArray(data.roles) ? data.roles.filter((r): r is string => typeof r === "string") : [];
  const known = roles.find(r => r === "owner") ?? roles.find(r => r in roleNames);
  return known ? roleNames[known] : data.super_admin ? "超级管理员（未验证）" : "成员";
}
export function AccountControls(){
 const pathname=usePathname();
  const [email, setEmail] = useState<string>();
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Display only: the Worker and database decide platform access on every request.
  const [platform, setPlatform] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        // An expired session (401) goes to login inside clubApi; a revoked membership (403) shows its message here.
        const data = await clubApi<{ email: string; roles: string[]; super_admin: boolean; mfa_verified: boolean; platform_permissions?: string[] }>("/api/account", undefined, "暂时无法读取账户");
        if (active) { setEmail(data.email); setLabel(roleLabel(data)); setPlatform(data.platform_permissions?.includes("platform.read") === true); setError(""); }
      } catch (e) { if (active) { setEmail(undefined); setError(e instanceof TypeError ? "连接失败，请刷新重试" : e instanceof Error ? e.message : "暂时无法读取账户"); } }
    }
    void load();
    // club-account-changed: MFA verification replaced the session, so the role label must be re-read.
    window.addEventListener("focus", load);
    window.addEventListener("club-account-changed", load);
    return () => { active = false; window.removeEventListener("focus", load); window.removeEventListener("club-account-changed", load); };
  }, [pathname]);
  async function logout() {
    setBusy(true);
    try {
      await clubApi("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, "退出失败，请重试");
      setEmail(undefined); window.location.replace("/login");
    } catch (e) { setError(e instanceof TypeError ? "连接失败，请稍后重试" : e instanceof Error ? e.message : "退出失败，请重试"); }
    finally { setBusy(false); }
  }
 // Fixed widths: the header and the settings link never move while the account loads.
 return <>
  <span className="club-user-name block w-50 max-w-50 shrink-0 basis-50 text-xs [overflow-wrap:anywhere] max-md:w-24 max-md:max-w-24 max-md:basis-24 max-md:truncate" title={email} aria-hidden={!email}>
   {email??<Skeleton className="my-1.5"/>}
   <small className="block text-muted-foreground">{email?label:<Skeleton className="my-1.5 w-2/5"/>}</small>
  </span>
  <Button variant="secondary" disabled={!email} loading={busy} loadingText="正在退出…" onClick={logout}>退出登录</Button>
  {platform&&<ButtonLink variant="secondary" size="compact" className="club-header-admin text-gold aria-[current=page]:bg-selected" href="/admin" aria-current={pathname==="/admin"?"page":undefined}><ShieldCheckIcon aria-hidden="true"/>平台管理</ButtonLink>}
  <ButtonLink variant="secondary" size="compact" className="club-header-settings text-gold aria-[current=page]:bg-selected" href="/settings" aria-current={pathname==="/settings"?"page":undefined}><GearSixIcon aria-hidden="true"/>设置</ButtonLink>
  {error&&<p role="alert" className="club-header-error absolute top-full right-0 z-30 m-0 mt-2 flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-sm border border-destructive bg-error-bg p-3 text-sm text-destructive">{error} <Button size="compact" onClick={()=>window.location.reload()}>刷新</Button></p>}
 </>;
}
