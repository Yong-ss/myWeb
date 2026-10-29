"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import {clubApi} from "../../lib/data-access";
import {Button} from "../ui/Button";
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
return <><span className="club-user-name" title={email} aria-hidden={!email}>{email??<span className="club-skeleton-line"/>}<small>{email?(role === "owner" ? "公会长" : "管理员"):<span className="club-skeleton-line" style={{width:"40%"}}/>}</small></span><Button variant="secondary" disabled={!email} loading={busy} loadingText="正在退出…" onClick={logout}>退出登录</Button><Link className="club-header-settings" href="/settings" aria-current={pathname==="/settings"?"page":undefined}>设置</Link>{error&&<p role="alert" className="club-header-error">{error} <Button onClick={()=>window.location.reload()}>刷新</Button></p>}</>;}
