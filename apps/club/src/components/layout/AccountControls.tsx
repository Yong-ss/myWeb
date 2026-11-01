"use client";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import {CastleTurretIcon,GearSixIcon,ShieldCheckIcon} from "@phosphor-icons/react";
import {workspaceHome,workspaceSettings,type Workspace} from "../../lib/navigation";
import {clubApi} from "../../lib/data-access";
import {Button,ButtonLink} from "../ui/button";
import {Skeleton} from "../ui/skeleton";
// Display only; access is decided by the Worker and database from permissions. Platform identity is account-wide;
// `roles` belong to this deployment's club only, so they are shown only inside that club's workspace. Outside it the
// label describes the account (platform identity, or how many clubs it belongs to), never a club role.
const roleNames: Record<string, string> = { owner: "公会长", admin: "管理员" };
type Labelled = { roles?: unknown; super_admin?: boolean; mfa_verified?: boolean; clubs?: unknown[] };
export function roleLabel(data: Labelled, workspace: Workspace) {
  const platform = data.super_admin ? (data.mfa_verified ? "超级管理员" : "超级管理员（待两步验证）") : undefined;
  if (workspace !== "club") return platform ?? `所属 ${data.clubs?.length ?? 0} 个俱乐部`;
  const roles = Array.isArray(data.roles) ? data.roles.filter((r): r is string => typeof r === "string") : [];
  const known = roles.find(r => r === "owner") ?? roles.find(r => r in roleNames);
  const club = known ? roleNames[known] : undefined;
  return platform ? [platform, club].filter(Boolean).join(" · ") : club ?? "成员";
}
export function AccountControls({ workspace }: { workspace: Workspace }){
 const pathname=usePathname();
  const [email, setEmail] = useState<string>();
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Display only: which workspace switch to offer. The Worker and database decide access on every request.
  const [can, setCan] = useState({ platform: false, club: false, hub: false });
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        // An expired session (401) goes to login inside clubApi; a revoked membership (403) shows its message here.
        const data = await clubApi<{ email: string; club_id?: string; roles: string[]; permissions?: string[]; super_admin: boolean; mfa_verified: boolean; clubs?: { id: string }[] }>("/api/account", undefined, "暂时无法读取账户");
        if (active) { setEmail(data.email); setLabel(roleLabel(data, workspace)); setCan({ platform: data.super_admin === true, club: (data.permissions?.length ?? 0) > 0, hub: (data.clubs ?? []).some(c => c.id !== data.club_id) }); setError(""); }
      } catch (e) { if (active) { setEmail(undefined); setError(e instanceof TypeError ? "连接失败，请刷新重试" : e instanceof Error ? e.message : "暂时无法读取账户"); } }
    }
    void load();
    // club-account-changed: MFA verification replaced the session, so the role label must be re-read.
    window.addEventListener("focus", load);
    window.addEventListener("club-account-changed", load);
    return () => { active = false; window.removeEventListener("focus", load); window.removeEventListener("club-account-changed", load); };
  }, [pathname, workspace]);
  async function logout() {
    setBusy(true);
    try {
      await clubApi("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, "退出失败，请重试");
      setEmail(undefined); window.location.replace("/login");
    } catch (e) { setError(e instanceof TypeError ? "连接失败，请稍后重试" : e instanceof Error ? e.message : "退出失败，请重试"); }
    finally { setBusy(false); }
  }
 const settings=workspaceSettings[workspace];
 // Fixed widths: the header and the settings link never move while the account loads.
 return <>
  <span className="club-user-name block w-50 max-w-50 shrink-0 basis-50 text-xs [overflow-wrap:anywhere] max-md:w-24 max-md:max-w-24 max-md:basis-24 max-md:truncate" title={email} aria-hidden={!email}>
   {email??<Skeleton className="my-1.5"/>}
   <small className="block text-muted-foreground">{email?label:<Skeleton className="my-1.5 w-2/5"/>}</small>
  </span>
  <Button variant="secondary" disabled={!email} loading={busy} loadingText="正在退出…" onClick={logout}>退出登录</Button>
  {workspace!=="hub"&&can.hub&&<ButtonLink variant="secondary" size="compact" className="club-header-admin text-gold" href={workspaceHome.hub}><CastleTurretIcon aria-hidden="true"/>我的俱乐部</ButtonLink>}
  {workspace!=="platform"&&can.platform&&<ButtonLink variant="secondary" size="compact" className="club-header-admin text-gold" href={workspaceHome.platform}><ShieldCheckIcon aria-hidden="true"/>平台管理中心</ButtonLink>}
  {workspace!=="club"&&can.club&&<ButtonLink variant="secondary" size="compact" className="club-header-admin text-gold" href={workspaceHome.club}><CastleTurretIcon aria-hidden="true"/>俱乐部工作空间</ButtonLink>}
  {settings&&<ButtonLink variant="secondary" size="compact" className="club-header-settings text-gold aria-[current=page]:bg-selected" href={settings.href} aria-current={pathname===settings.href?"page":undefined}><GearSixIcon aria-hidden="true"/>{settings.label}</ButtonLink>}
  {error&&<p role="alert" className="club-header-error absolute top-full right-0 z-30 m-0 mt-2 flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-sm border border-destructive bg-error-bg p-3 text-sm text-destructive">{error} <Button size="compact" onClick={()=>window.location.reload()}>刷新</Button></p>}
 </>;
}
