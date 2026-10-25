import Link from "next/link";
export default function NotFound() {
    return <main className="shell not-found"><p className="eyebrow">404 / 迷路了</p><h1>这里还没有页面。</h1><p>回到首页，看看已经准备好的内容。</p><Link className="button" href="/">返回首页 ↗</Link></main>;
}
