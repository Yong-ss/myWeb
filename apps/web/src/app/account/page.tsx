"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AccountPage() {
  const [email, setEmail] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/account", { cache: "no-store" });
        const data = await response.json();
        if (!active) return;
        if (response.status === 401 || response.status === 403) { setEmail(undefined); window.location.replace("/login"); }
        else if (!response.ok) { setEmail(undefined); setError(data.error ?? "暂时无法读取账户"); }
        else { setEmail(data.email); setError(""); }
      } catch { if (active) { setEmail(undefined); setError("连接失败，请刷新重试"); } }
    }
    void load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, []);
  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (response.ok) { setEmail(undefined); window.location.replace("/login"); }
      else { const data = await response.json(); setError(data.error ?? "退出失败，请重试"); }
    } catch { setError("连接失败，请稍后重试"); }
    finally { setBusy(false); }
  }
  return <main className="shell auth-page"><Link className="brand" href="/">SquirrelAPI</Link><h1>个人账户</h1>{email ? <><p>已登录：{email}</p><button className="button" disabled={busy} onClick={logout}>{busy ? "正在退出…" : "退出登录"}</button></> : !error && <p role="status">正在检查登录状态…</p>}<p role="alert">{error}</p><Link href="/">返回首页</Link></main>;
}
