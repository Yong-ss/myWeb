"use client";
import {clubApi} from "../../lib/data-access";

import Link from "next/link";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Fields";
import { Panel } from "../../components/ui/Panel";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      // /login is public, so a 401 (wrong password) is shown here instead of redirecting.
      await clubApi("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) }, "登录失败，请重试");
      router.replace("/account");
    } catch (e) { setError(e instanceof TypeError ? "连接失败，请稍后重试" : e instanceof Error ? e.message : "登录失败，请重试"); }
    finally { setBusy(false); }
  }
  return <><main className="club-workspace club-login"><Panel><p className="eyebrow">欢迎回来</p><h1>登录俱乐部</h1><p>使用你的 SquirrelAPI 账号，继续记录今天的数据。</p><form onSubmit={submit} className="auth-form" aria-busy={busy}><label htmlFor="email">邮箱</label><Input id="email" name="email" type="email" placeholder="你的邮箱地址" autoComplete="username" maxLength={320} required /><label htmlFor="password">密码</label><Input id="password" name="password" type="password" autoComplete="current-password" maxLength={1024} required /><Button type="submit" loading={busy} loadingText="正在登录…">登录</Button><p role="alert" className="feedback error">{error}</p></form><p className="auth-note">目前仅限已获授权的成员使用。忘记密码或无法进入？请联系俱乐部负责人。</p><Link href="/">← 返回 Club 首页</Link></Panel></main></>;
}
