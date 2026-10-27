import Link from "next/link";

export default function NotFound() {
  return <main className="shell panel auth-page"><p className="eyebrow">404 · 走错了一小步</p><h1>这里还没有页面。</h1><p>链接可能已更改，你可以回到工作台继续操作。</p><Link className="button" href="/account">回到工作台</Link></main>;
}
