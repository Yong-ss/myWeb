"use client";

import Link from "next/link";
import { AppShell } from "../../components/layout/AppShell";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Panel } from "../../components/ui/Panel";
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
        const response = await fetch("/api/account", { cache: "no-store" });
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
      const response = await fetch("/api/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (response.ok) { setEmail(undefined); window.location.replace("/login"); }
      else { const data = await response.json(); setError(data.error ?? "退出失败，请重试"); }
    } catch { setError("连接失败，请稍后重试"); }
    finally { setBusy(false); }
  }
  return <AppShell><main className="club-workspace club-account">
    <PageHeader eyebrow="01 / THE CLUB ARCHIVES" title="俱乐部总览" />
    {email ? <>
      <div className="club-account-session"><div><span className="club-session-label">当前账户</span><strong>{email}</strong></div><span className="badge">{role === "owner" ? "公会长" : "管理员"}</span><Button variant="secondary" loading={busy} loadingText="正在退出…" onClick={logout}>退出登录</Button></div>
      <div className="club-account-intro"><span className="club-archive-mark" aria-hidden="true">◇</span><div><h2>留住俱乐部的每一天。</h2><p>记录今天，查阅过往。</p></div></div>
      <div className="club-account-actions">
        <Panel className="club-task-primary"><span className="club-task-index">01 / RECORD</span><div><h2>导入每日数据</h2><p>带回 AI 识别结果，核对后保存。</p></div><ButtonLink href="/import">开始导入 <span aria-hidden="true">→</span></ButtonLink></Panel>
        <Panel><span className="club-task-index">02 / ARCHIVE</span><div><h2>成员名单</h2><p>查看成员数据、历史日期与修正版本。</p></div><ButtonLink variant="secondary" href="/members">查看名单 <span aria-hidden="true">→</span></ButtonLink></Panel>
      </div>
    </> : !error && <p role="status" className="club-loading">正在为你打开工作台…</p>}
    <p role="alert" className="feedback error">{error}</p><Link className="club-return" href="/">← 返回 Club 首页</Link>
  </main></AppShell>;
}
