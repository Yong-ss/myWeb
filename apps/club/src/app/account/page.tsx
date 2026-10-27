"use client";
import {clubFetch} from "../../lib/data-access";

import Link from "next/link";
import { AppShell } from "../../components/layout/AppShell";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button } from "../../components/ui/Button";
import { Overview } from "../../components/Overview";
import { useEffect, useState } from "react";

export default function AccountPage() {
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
  }, []);
  async function logout() {
    setBusy(true);
    try {
      const response = await clubFetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (response.ok) { setEmail(undefined); window.location.replace("/login"); }
      else { const data = await response.json(); setError(data.error ?? "退出失败，请重试"); }
    } catch { setError("连接失败，请稍后重试"); }
    finally { setBusy(false); }
  }
  return <AppShell account={email && <><span className="club-user-name">{email}<small>{role === "owner" ? "公会长" : "管理员"}</small></span><Button variant="secondary" loading={busy} loadingText="正在退出…" onClick={logout}>退出登录</Button></>}><main className="club-workspace club-account">
    <PageHeader eyebrow="OVERVIEW" title="俱乐部总览" />
    {!error && <Overview />}
    <p role="alert" className="feedback error">{error}</p><Link className="club-return" href="/">← 返回首页</Link>
  </main></AppShell>;
}
