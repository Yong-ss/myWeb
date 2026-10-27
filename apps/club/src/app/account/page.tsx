"use client";

import Link from "next/link";
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
  return <main className="shell dashboard"><p className="eyebrow">我的工作台</p><h1>开始今天的记录。</h1>{email ? <><div className="account-strip"><div><strong>{email}</strong><p>你的身份：{role === "owner" ? "公会长" : "管理员"}</p></div><button disabled={busy} onClick={logout}>{busy ? "正在退出…" : "退出登录"}</button></div><section className="panel task-card"><span className="badge">每日工作</span><h2>导入每日数据</h2><p>准备好截图识别结果后，就可以开始。系统会匹配熟悉的玩家，留出需要你确认的记录。</p><Link className="button" href="/import">开始导入 →</Link></section><p className="muted">成员列表与历史查询正在准备中，目前可以先把每天的数据保存下来。</p></> : !error && <p role="status" className="feedback">正在为你打开工作台…</p>}<p role="alert" className="feedback error">{error}</p><Link href="/">← 返回 Club 首页</Link></main>;
}
