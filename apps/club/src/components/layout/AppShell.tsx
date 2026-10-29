"use client";
import Link from "next/link";
import {AccountControls} from "./AccountControls";
import {useClubBrand} from "../../lib/club-brand";
import { usePathname } from "next/navigation";
import { Button } from "../ui/Button";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { privateLinks, publicLinks, activeHref } from "../../lib/navigation";
import "../../styles/components.css";

/** Shared shell; permissions remain enforced by the Worker and database. */
export function AppShell({ children, publicPage = false }: { children: ReactNode; publicPage?: boolean }) {
  const pathname = usePathname();
  const clubName = useClubBrand();
  const navigationLinks = publicPage ? publicLinks : privateLinks;
  const current = activeHref(pathname);
  const drawer = useRef<HTMLDialogElement>(null);
  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function navigation() {
    return <nav aria-label="俱乐部导航">{navigationLinks.map(({ href, icon, label }) => <Link key={href} href={href} aria-current={href === current ? "page" : undefined} onClick={() => drawer.current?.close()}><span aria-hidden="true">{icon}</span>{label}</Link>)}</nav>;
  }
  return <div className={`club-app${publicPage ? " club-public" : ""}`}>
    <header className="club-top"><Link className="club-wordmark" href={publicPage ? "/" : "/account"}><span className="club-emblem" aria-hidden="true">✧</span><span className="club-brand"><span className="club-brand-name">{clubName}</span><small className="club-brand-subtitle">数据检测平台</small></span></Link>{!publicPage&&<div className="club-header-account"><AccountControls/></div>}<Button variant="secondary" className="club-menu" aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}>菜单 <span aria-hidden="true">☰</span></Button></header>
    {!publicPage && <aside className="club-sidebar"><p className="club-overline">THE ARCHIVES</p>{navigation()}</aside>}
    {children}
    <dialog ref={drawer} className="club-drawer" aria-labelledby="club-menu-title" onKeyDown={keepFocus}><div className="club-drawer-heading"><h2 id="club-menu-title">俱乐部导航</h2><Button variant="secondary" autoFocus onClick={() => drawer.current?.close()} aria-label="关闭菜单">×</Button></div>{navigation()}</dialog>
  </div>;
}
