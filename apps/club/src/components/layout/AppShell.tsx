"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "../ui/Button";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import "../../styles/components.css";

const links = [["/account", "◇", "俱乐部总览"], ["/members", "♧", "成员名单"], ["/import", "⊕", "导入数据"]] as const;

/** Shared presentation shell; contains no authentication or data loading. */
export function AppShell({ children, publicPage = false }: { children: ReactNode; publicPage?: boolean }) {
  const pathname = usePathname();
  const navigationLinks = publicPage ? [["/", "◇", "首页"], ["/login", "✧", "登录"]] : links;
  const drawer = useRef<HTMLDialogElement>(null);
  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function navigation() {
    return <nav aria-label="俱乐部导航">{navigationLinks.map(([href, icon, title]) => <Link key={href} href={href} aria-current={(href === pathname || (href === "/members" && pathname === "/players")) ? "page" : undefined} onClick={() => drawer.current?.close()}><span aria-hidden="true">{icon}</span>{title}</Link>)}</nav>;
  }
  return <div className={`club-app${publicPage ? " club-public" : ""}`}>
    <header className="club-top"><Link className="club-wordmark" href={publicPage ? "/" : "/account"}><span className="club-emblem" aria-hidden="true">✧</span><span>SquirrelAPI Club<small>THE CLUB ARCHIVES</small></span></Link><span className="club-header-note">灰雾档案馆</span><Button variant="secondary" className="club-menu" aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}>菜单 <span aria-hidden="true">☰</span></Button></header>
    {!publicPage && <aside className="club-sidebar"><p className="club-overline">THE ARCHIVES</p>{navigation()}<div className="club-sidebar-foot"><span aria-hidden="true">◇</span> 每一天，皆有迹可循</div></aside>}
    {children}
    <dialog ref={drawer} className="club-drawer" aria-labelledby="club-menu-title" onKeyDown={keepFocus}><div className="club-drawer-heading"><h2 id="club-menu-title">俱乐部导航</h2><Button variant="secondary" autoFocus onClick={() => drawer.current?.close()} aria-label="关闭菜单">×</Button></div>{navigation()}</dialog>
  </div>;
}
