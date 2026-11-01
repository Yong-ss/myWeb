"use client";
import {clubApi} from "../../lib/data-access";
import Link from "next/link";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardDescription } from "../../components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "../../components/ui/field";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useHydrated } from "../../lib/useHydrated";

const post = (path: string, body: unknown) => clubApi(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, "请求失败，请重试");
const message = (e: unknown) => e instanceof TypeError ? "连接失败，请稍后重试" : e instanceof Error ? e.message : "请求失败，请重试";
function Shell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <main className="club-workspace club-login max-w-128 pt-12"><Card ornate className="items-stretch gap-3 p-8 max-md:p-6">
    <p className="eyebrow">{eyebrow}</p><h1 className="gold-title m-0 text-title">{title}</h1>{children}
    <Link href="/login" className="w-fit py-2 text-sm text-gold">← 返回登录</Link>
  </Card></main>;
}

// Mail scanners open links with GET; the one-time token is only spent when a person clicks the button (POST).
export function ConfirmPage() {
  const router = useRouter();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function go() {
    const q = new URLSearchParams(window.location.search), token_hash = q.get("token_hash"), type = q.get("type");
    if (!token_hash || !type) { setError("链接不完整，请从邮件中重新打开"); return; }
    setBusy(true); setError("");
    try { const r = await post("/api/auth/verify", { token_hash, type }); router.replace(r.set_password ? "/auth/set-password" : "/account"); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Shell eyebrow="账号验证" title="确认你的账号">
    <CardDescription>点击继续完成验证。如果你是通过邀请或重置密码进入，下一步将设置登录密码。</CardDescription>
    <Button className="mt-4 w-full" onClick={go} loading={busy} loadingText="正在验证…">继续</Button>
    <FieldError>{error}</FieldError>
    {error && <Link href="/auth/forgot" className="w-fit text-sm text-gold">重新获取链接</Link>}
  </Shell>;
}

export function SetPasswordPage() {
  const router = useRouter();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), hydrated = useHydrated();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("confirm")) { setError("两次输入的密码不一致"); return; }
    setBusy(true); setError("");
    try { await post("/api/auth/password", { password: form.get("password") }); router.replace("/account"); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Shell eyebrow="账号安全" title="设置登录密码">
    <CardDescription>密码需为 8–72 个字符。</CardDescription>
    <form method="post" onSubmit={submit} aria-busy={busy} className="mt-4"><FieldGroup>
      <Field><FieldLabel htmlFor="password">新密码</FieldLabel><Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
      <Field><FieldLabel htmlFor="confirm">再次输入</FieldLabel><Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={72} required /></Field>
      <Button type="submit" className="w-full" disabled={!hydrated} loading={busy} loadingText="正在保存…">保存密码</Button>
      <FieldError>{error}</FieldError>
    </FieldGroup></form>
  </Shell>;
}

export function ForgotPage() {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), hydrated = useHydrated();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try { await post("/api/auth/recover", { email: new FormData(event.currentTarget).get("email") }); setSent(true); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <Shell eyebrow="找回账号" title="忘记密码">
    {sent ? <CardDescription>如果该邮箱已注册，你将在几分钟内收到重置邮件，链接 1 小时内有效。</CardDescription> : <>
      <CardDescription>输入账号邮箱，我们会发送重置密码的链接。</CardDescription>
      <form method="post" onSubmit={submit} aria-busy={busy} className="mt-4"><FieldGroup>
        <Field><FieldLabel htmlFor="email">邮箱</FieldLabel><Input id="email" name="email" type="email" autoComplete="username" maxLength={320} required /></Field>
        <Button type="submit" className="w-full" disabled={!hydrated} loading={busy} loadingText="正在发送…">发送重置邮件</Button>
        <FieldError>{error}</FieldError>
      </FieldGroup></form></>}
  </Shell>;
}
