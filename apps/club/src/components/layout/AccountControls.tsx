"use client";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import {GearSixIcon} from "@phosphor-icons/react";
import {clubApi} from "../../lib/data-access";
import {Button,ButtonLink} from "../ui/button";
import {Skeleton} from "../ui/skeleton";
export function AccountControls(){
 const pathname=usePathname();
  const [email, setEmail] = useState<string>();
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        // An expired session (401) goes to login inside clubApi; a revoked membership (403) shows its message here.
        const data = await clubApi<{ email: string; role: string }>("/api/account", undefined, "暂时无法读取账户");
        if (active) { setEmail(data.email); setRole(data.role); setError(""); }
      } catch (e) { if (active) { setEmail(undefined); setError(e instanceof TypeError ? "连接失败，请刷新重试" : e instanceof Error ? e.message : "暂时无法读取账户"); } }
    }
    void load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
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
   <small className="block text-muted-foreground">{email?(role === "owner" ? "公会长" : "管理员"):<Skeleton className="my-1.5 w-2/5"/>}</small>
  </span>
  <Button variant="secondary" disabled={!email} loading={busy} loadingText="正在退出…" onClick={logout}>退出登录</Button>
  <ButtonLink variant="secondary" size="compact" className="club-header-settings text-gold aria-[current=page]:bg-selected" href="/settings" aria-current={pathname==="/settings"?"page":undefined}><GearSixIcon aria-hidden="true"/>设置</ButtonLink>
  {error&&<p role="alert" className="club-header-error absolute top-full right-0 z-30 m-0 mt-2 flex max-w-[calc(100vw-32px)] items-center gap-3 rounded-sm border border-destructive bg-error-bg p-3 text-sm text-destructive">{error} <Button size="compact" onClick={()=>window.location.reload()}>刷新</Button></p>}
 </>;
}
