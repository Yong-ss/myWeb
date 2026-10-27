"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "登录失败，请重试");
      else router.replace("/account");
    } catch { setError("连接失败，请稍后重试"); }
    finally { setBusy(false); }
  }
  return <main className="shell auth-page"><Link className="brand" href="/">SquirrelAPI / Club</Link><h1>登录俱乐部</h1><p>使用已有的 SquirrelAPI 邮箱和密码；目前仅向已授权账户开放。</p><form onSubmit={submit} className="auth-form"><label htmlFor="email">邮箱</label><input id="email" name="email" type="email" autoComplete="username" maxLength={320} required /><label htmlFor="password">密码</label><input id="password" name="password" type="password" autoComplete="current-password" maxLength={1024} required /><button className="button" disabled={busy}>{busy ? "正在登录…" : "登录"}</button><p role="alert">{error}</p></form><p className="auth-note">暂未开放注册和邀请。账户恢复请联系站点所有者。</p><Link href="/">返回 Club 首页</Link></main>;
}
