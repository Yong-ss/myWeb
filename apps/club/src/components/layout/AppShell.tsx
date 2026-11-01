"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { motion } from "motion/react";
import { AccountControls } from "./AccountControls";
import { useClubBrand } from "../../lib/club-brand";
import { Button } from "../ui/button";
import { glide, useMotion } from "../ui/motion";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet";
import { privateLinks, platformLinks, hubLinks, publicLinks, activeHref, workspaceOf, workspaceHome, type NavLink } from "../../lib/navigation";

function Navigation({ links, current, onNavigate, indicator }: { links: NavLink[]; current: string; onNavigate?: () => void; indicator: string }) {
  const move = useMotion(glide);
  return <nav aria-label="俱乐部导航" className="grid gap-1">{links.map(({ href, icon, label }) =>
    <Link key={href} href={href} aria-current={href === current ? "page" : undefined} onClick={onNavigate}
      className="relative flex min-h-11 items-center gap-3 border-l-2 border-transparent px-6 py-3 text-sm tracking-wide text-muted-foreground no-underline transition-[background-color,color,border-color] duration-150 ease-club-feedback hover:bg-[color-mix(in_srgb,var(--club-gold)_5%,transparent)] hover:text-gold active:bg-pressed active:duration-0 aria-[current=page]:text-gold">
      {/* The marker is one shared element per navigation, so it glides from the old page to the new one. */}
      {href === current && <motion.span layoutId={indicator} aria-hidden="true" transition={move} className="absolute inset-y-0 -left-0.5 right-0 border-l-2 border-gold bg-[linear-gradient(90deg,color-mix(in_srgb,var(--club-gold)_13%,transparent),transparent)]" />}
      <span aria-hidden="true" className="relative w-4 text-center font-heading">{icon}</span><span className="relative">{label}</span>
    </Link>)}</nav>;
}

/** Shared shell; permissions remain enforced by the Worker and database. */
export function AppShell({ children, publicPage = false }: { children: ReactNode; publicPage?: boolean }) {
  const pathname = usePathname();
  const workspace = workspaceOf(pathname), platform = !publicPage && workspace !== "club"; // no club in view
  const clubName = useClubBrand(!platform);
  const links = publicPage ? publicLinks : workspace === "platform" ? platformLinks : workspace === "hub" ? hubLinks : privateLinks;
  const current = activeHref(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className={cn("club-app mist grid min-h-dvh grid-cols-[var(--club-sidebar-width)_minmax(0,1fr)] grid-rows-[var(--club-header-height)_1fr] text-foreground max-lg:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[auto_1fr]", publicPage && "club-public grid-cols-[minmax(0,1fr)]")}>
    <header className="club-top sticky top-0 z-20 col-span-full flex items-center justify-between gap-4 border-b border-border bg-field px-6 max-md:grid max-md:min-h-16 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-2 max-md:px-4 max-md:py-2">
      <Link className="club-wordmark flex min-w-0 items-center gap-3 font-heading text-gold no-underline max-md:col-start-1 max-md:row-start-1 max-md:gap-2 max-md:text-sm" href={publicPage ? "/" : workspaceHome[workspace]}>
        <span className="club-emblem grid size-9 shrink-0 place-items-center border border-brass text-xl" aria-hidden="true">✧</span>
        <span className="club-brand grid min-w-0 gap-1">
          <span className="club-brand-name font-heading text-lg leading-tight [overflow-wrap:anywhere]">{platform ? "俱乐部数据检测平台" : clubName}</span>
          <small className="club-brand-subtitle font-sans text-xs tracking-[.2em] text-muted-foreground">{platform ? (workspace === "hub" ? "我的俱乐部" : "平台管理中心") : "数据检测平台"}</small>
        </span>
      </Link>
      {!publicPage && <div className="club-header-account relative ml-auto flex min-w-0 items-center gap-4 max-md:col-span-full max-md:row-start-2 max-md:w-full max-md:justify-end max-md:gap-2"><AccountControls workspace={workspace} /></div>}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetTrigger asChild><Button variant="secondary" size="compact" className="club-menu hidden max-lg:inline-flex max-md:col-start-2 max-md:row-start-1 max-md:ml-auto">菜单 <span aria-hidden="true">☰</span></Button></SheetTrigger>
        {/* Radix: focus starts on the close button, Tab loops inside, Escape or the backdrop closes and focus returns to 菜单. */}
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{workspace === "platform" ? "平台导航" : workspace === "hub" ? "账户导航" : "俱乐部导航"}</SheetTitle>
            <SheetClose asChild><Button variant="secondary" size="icon" aria-label="关闭菜单">×</Button></SheetClose>
          </SheetHeader>
          <Navigation links={links} current={current} indicator="nav-drawer" onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
    {!publicPage && <aside className="club-sidebar sticky top-(--club-header-height) flex h-[calc(100dvh-var(--club-header-height))] flex-col gap-4 self-start overflow-y-auto border-r border-border bg-sidebar py-6 max-lg:hidden">
      <p className="eyebrow px-6">{workspace === "platform" ? "THE CONCLAVE" : workspace === "hub" ? "THE ROLL" : "THE ARCHIVES"}</p>
      <Navigation links={links} current={current} indicator="nav-sidebar" />
    </aside>}
    {children}
  </div>;
}
