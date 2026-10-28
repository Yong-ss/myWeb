"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useState} from "react";
import {clubFetch} from "../../lib/data-access";
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
        const response = await clubFetch("/api/account", { cache: "no-store" });
        const data = await response.json();
        if (!active) return;
        if (response.status === 401 || response.status === 403) { setEmail(undefined); window.location.replace("/login"); }
        else if (!response.ok) { setEmail(undefined); setError(data.error ?? "暂时无法读取账户"); }
        else { setEmail(data.email); setRole(data.role); setError(""); }
      } catch { if (active) { setEmail(undefined); setError("连接失败，请刷新重试"); } }
    }
    void load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, [pathname]);
  async function logout() {
    setBusy(true);
    try {
      const response = await clubFetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (response.ok) { setEmail(undefined); window.location.replace("/login"); }
      else { const data = await response.json(); setError(data.error ?? "退出失败，请重试"); }
    } catch { setError("连接失败，请稍后重试"); }
    finally { setBusy(false); }
  }
return <><span className="club-user-name" title={email} aria-hidden={!email}>{email??<span className="club-skeleton-line"/>}<small>{email?(role === "owner" ? "公会长" : "管理员"):<span className="club-skeleton-line" style={{width:"40%"}}/>}</small></span><Button variant="secondary" disabled={!email} loading={busy} loadingText="正在退出…" onClick={logout}>退出登录</Button><Link className="club-header-settings" href="/settings" aria-current={pathname==="/settings"?"page":undefined}>设置</Link>{error&&<p role="alert" className="club-header-error">{error} <Button onClick={()=>window.location.reload()}>刷新</Button></p>}</>;}
