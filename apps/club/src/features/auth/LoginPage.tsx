"use client";
import {clubApi} from "../../lib/data-access";
import {landingPath} from "../../lib/navigation";

import Link from "next/link";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardDescription } from "../../components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "../../components/ui/field";
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
      router.replace(landingPath(await clubApi<{ super_admin?: boolean }>("/api/account", undefined, "登录失败，请重试")));
    } catch (e) { setError(e instanceof TypeError ? "连接失败，请稍后重试" : e instanceof Error ? e.message : "登录失败，请重试"); }
    finally { setBusy(false); }
  }
  return <main className="club-workspace club-login max-w-128 pt-12">
    <Card ornate className="items-stretch gap-3 p-8 max-md:p-6">
      <p className="eyebrow">欢迎回来</p>
      <h1 className="gold-title m-0 text-title">登录俱乐部</h1>
      <CardDescription>使用你的 SquirrelAPI 账号，继续记录今天的数据。</CardDescription>
      <form onSubmit={submit} aria-busy={busy} className="mt-4">
        <FieldGroup>
          <Field><FieldLabel htmlFor="email">邮箱</FieldLabel><Input id="email" name="email" type="email" placeholder="你的邮箱地址" autoComplete="username" maxLength={320} required /></Field>
          <Field><FieldLabel htmlFor="password">密码</FieldLabel><Input id="password" name="password" type="password" autoComplete="current-password" maxLength={1024} required /></Field>
          <Button type="submit" className="w-full" loading={busy} loadingText="正在登录…">登录</Button>
          <FieldError>{error}</FieldError>
        </FieldGroup>
      </form>
      <Link href="/auth/forgot" className="w-fit text-sm text-gold">忘记密码？</Link>
      <p className="auth-note m-0 mt-2 border-t border-divider pt-4 text-sm text-muted-foreground">目前仅限已获授权的成员使用。无法进入？请联系俱乐部负责人。</p>
      <Link href="/" className="w-fit py-2 text-sm text-gold">← 返回 Club 首页</Link>
    </Card>
  </main>;
}
