import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Club · SquirrelAPI",
  description: "俱乐部管理空间",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><a className="skip-link" href="#content">跳到主要内容</a><header className="topbar"><Link href="/" className="wordmark"><span className="brand-mark" aria-hidden="true">S</span><span>SquirrelAPI <b>Club</b></span></Link><nav aria-label="主要导航"><Link href="/import">导入数据</Link><Link href="/account">我的工作台</Link></nav></header><div id="content">{children}</div><footer className="site-footer">SquirrelAPI Club <span>把每天的记录，慢慢积累成历史。</span></footer></body></html>;
}
