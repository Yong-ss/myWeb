"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import { motion } from "motion/react";
import { AccountControls, type AccountView } from "./AccountControls";
import { ClubSwitcher } from "./ClubSwitcher";
import { useClubBrand } from "../../lib/club-brand";
import { clubHref, clubOf, lastClub, preferredClub, rememberClub } from "../../lib/club-context";
import { ClubContext, ClubPermissionsContext } from "../../lib/useClub";
import { LoadingState } from "../feedback";
import { Button, ButtonLink } from "../ui/button";
import { glide, useMotion } from "../ui/motion";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet";
import { privateLinks, platformLinks, hubLinks, allianceLinks, publicLinks, activeHref, workspaceOf, workspaceHome, visibleLinks, landingPath, type NavLink, type Workspace } from "../../lib/navigation";

function Navigation({ links, current, onNavigate, indicator, club }: { links: NavLink[]; current: string; onNavigate?: () => void; indicator: string; club: string | null }) {
  const move = useMotion(glide);
  return <nav aria-label="俱乐部导航" className="grid gap-1">{links.map(({ href, icon, label }) =>
    <Link key={href} href={club ? clubHref(href, club) : href} aria-current={href === current ? "page" : undefined} onClick={onNavigate}
      className="relative flex min-h-11 items-center gap-3 border-l-2 border-transparent px-6 py-3 text-sm tracking-wide text-muted-foreground no-underline transition-[background-color,color,border-color] duration-150 ease-club-feedback hover:bg-[color-mix(in_srgb,var(--club-gold)_5%,transparent)] hover:text-gold active:bg-pressed active:duration-0 aria-[current=page]:text-gold">
      {/* The marker is one shared element per navigation, so it glides from the old page to the new one. */}
      {href === current && <motion.span layoutId={indicator} aria-hidden="true" transition={move} className="absolute inset-y-0 -left-0.5 right-0 border-l-2 border-gold bg-[linear-gradient(90deg,color-mix(in_srgb,var(--club-gold)_13%,transparent),transparent)]" />}
      <span aria-hidden="true" className="relative w-4 text-center font-heading">{icon}</span><span className="relative">{label}</span>
    </Link>)}</nav>;
}

type Frame = { workspace: Workspace; publicPage?: boolean; club: string | null; clubName: string; links: NavLink[]; switcher?: ReactNode; controls?: ReactNode; children: ReactNode };
function Frame({ workspace, publicPage = false, club, clubName, links, switcher, controls, children }: Frame) {
  const pathname = usePathname();
  const platform = !publicPage && workspace !== "club"; // no club in view
  const current = activeHref(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  return <div className={cn("club-app mist grid min-h-dvh grid-cols-[var(--club-sidebar-width)_minmax(0,1fr)] grid-rows-[var(--club-header-height)_1fr] text-foreground max-lg:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[auto_1fr]", publicPage && "club-public grid-cols-[minmax(0,1fr)]")}>
    <header className="club-top sticky top-0 z-20 col-span-full flex items-center justify-between gap-4 border-b border-border bg-field px-6 max-md:grid max-md:min-h-16 max-md:grid-cols-[minmax(0,1fr)_auto_auto] max-md:gap-2 max-md:px-4 max-md:py-2">
      <Link className="club-wordmark flex min-w-0 items-center gap-3 font-heading text-gold no-underline max-md:col-start-1 max-md:row-start-1 max-md:gap-2 max-md:text-sm" href={publicPage ? "/" : club ? clubHref(workspaceHome[workspace], club) : workspaceHome[workspace]}>
        <span className="club-emblem grid size-9 shrink-0 place-items-center border border-brass text-xl" aria-hidden="true">✧</span>
        <span className="club-brand grid min-w-0 gap-1">
          <span className="club-brand-name font-heading text-lg leading-tight [overflow-wrap:anywhere]">{platform ? "俱乐部数据检测平台" : clubName}</span>
          <small className="club-brand-subtitle font-sans text-xs tracking-[.2em] text-muted-foreground">{platform ? (workspace === "hub" ? "我的俱乐部" : workspace === "alliance" ? "联盟工作空间" : "平台管理中心") : "数据检测平台"}</small>
        </span>
      </Link>
      {/* Phones: next to 菜单 in the first row, so the account row keeps its width. */}
      {switcher && <div className="club-header-switcher ml-auto flex max-md:col-start-2 max-md:row-start-1">{switcher}</div>}
      {!publicPage && <div className={cn("club-header-account relative flex min-w-0 items-center gap-4 max-md:col-span-full max-md:row-start-2 max-md:w-full max-md:justify-end max-md:gap-2", !switcher && "ml-auto")}>{controls}</div>}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetTrigger asChild><Button variant="secondary" size="compact" className="club-menu hidden max-lg:inline-flex max-md:col-start-3 max-md:row-start-1 max-md:ml-auto">菜单 <span aria-hidden="true">☰</span></Button></SheetTrigger>
        {/* Radix: focus starts on the close button, Tab loops inside, Escape or the backdrop closes and focus returns to 菜单. */}
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{workspace === "platform" ? "平台导航" : workspace === "hub" ? "账户导航" : workspace === "alliance" ? "联盟导航" : "俱乐部导航"}</SheetTitle>
            <SheetClose asChild><Button variant="secondary" size="icon" aria-label="关闭菜单">×</Button></SheetClose>
          </SheetHeader>
          <Navigation links={links} current={current} club={club} indicator="nav-drawer" onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
    {!publicPage && <aside className="club-sidebar sticky top-(--club-header-height) flex h-[calc(100dvh-var(--club-header-height))] flex-col gap-4 self-start overflow-y-auto border-r border-border bg-sidebar py-6 max-lg:hidden">
      <p className="eyebrow px-6">{workspace === "platform" ? "THE CONCLAVE" : workspace === "hub" ? "THE ROLL" : workspace === "alliance" ? "THE LEAGUE" : "THE ARCHIVES"}</p>
      <Navigation links={links} current={current} club={club} indicator="nav-sidebar" />
    </aside>}
    {children}
  </div>;
}

const linksFor = (workspace: Workspace) => workspace === "platform" ? platformLinks : workspace === "hub" ? hubLinks : workspace === "alliance" ? allianceLinks : privateLinks;
const waiting = (label: string) => <main className="club-workspace"><LoadingState status="loading" label={label} /></main>;

/** Shown instead of a club page the account may not enter. Never falls back to another club. */
function NoAccess({ invalid, account }: { invalid?: boolean; account?: AccountView }) {
  const mfa = account?.super_admin && !account.mfa_verified, platform = account?.super_admin || account?.platform_admin;
  return <main className="club-workspace"><LoadingState status="empty" title={invalid ? "网址中的俱乐部无效" : "无法进入这个俱乐部"}
    detail={invalid ? "这个链接没有指向一个有效的俱乐部，请从「我的俱乐部」重新进入。" : mfa ? "超级管理员需要先完成两步验证，才能进入没有职位的俱乐部。" : "这个账户在该俱乐部没有职位或权限，或权限已被撤销。没有切换到其他俱乐部。"}
    action={<span className="flex flex-wrap justify-center gap-3">{(account?.clubs?.length ?? 0) > 0 && <ButtonLink href={workspaceHome.hub}>我的俱乐部</ButtonLink>}{account?.alliance_leader && <ButtonLink variant="secondary" href={workspaceHome.alliance}>我的联盟</ButtonLink>}{platform && <ButtonLink variant="secondary" href={mfa ? "/admin/security" : workspaceHome.platform}>{mfa ? "前往两步验证" : "平台管理中心"}</ButtonLink>}</span>} /></main>;
}

// Private pages: the club (if any) is read from this page's URL. useSearchParams needs a Suspense boundary in a static
// export, so the prerendered HTML is the bare shell; the real header and page render right after hydration.
function PrivateShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(), params = useSearchParams(), router = useRouter();
  const workspace = workspaceOf(pathname);
  const named = workspace === "club" ? clubOf(params) : null; // null: none named; false: not a club id
  const club = named || null;
  const [answer, setAnswer] = useState<{ account?: AccountView; error?: string }>({});
  const onAccount = useCallback((account?: AccountView, error?: string) => setAnswer({ account, error }), []);
  // Only an answer for this exact club counts: a late answer for the previous club is ignored, never shown for this one.
  const account = answer.account && (workspace !== "club" || named === null || answer.account.club_id === club) ? answer.account : undefined;
  const allowed = club !== null && (account?.permissions?.length ?? 0) > 0;
  const clubName = useClubBrand(club, allowed);
  // An old link without a club: open the preferred club in the URL (a navigation choice, rechecked like any URL).
  const search = params.toString();
  useEffect(() => {
    if (workspace !== "club" || named !== null || !account) return;
    const target = preferredClub(account, lastClub());
    router.replace(target ? clubHref(`${pathname}${search ? `?${search}` : ""}`, target) : landingPath(account, lastClub()));
  }, [workspace, named, account, pathname, search, router]);
  useEffect(() => { if (allowed && club) rememberClub(club); }, [allowed, club]);
  const switcher = club && allowed && account && account.clubs?.some(c => c.id !== club) ? <ClubSwitcher club={club} clubName={clubName} clubs={account.clubs} pathname={pathname} /> : undefined;
  const controls = <AccountControls workspace={workspace} club={club} onAccount={onAccount} />;
  const page = workspace !== "club" ? children
    : named === false ? <NoAccess invalid account={account} />
    : answer.error && !account ? <main className="club-workspace"><LoadingState status="error" detail={answer.error} onRetry={() => window.location.reload()} /></main>
    : named === null || !account ? waiting("正在确认俱乐部…")
    : !allowed ? <NoAccess account={account} />
    // Keyed by club: switching clubs starts every page fresh, so no state or late answer from the old club survives.
    : <ClubContext.Provider value={club}><ClubPermissionsContext.Provider value={account.permissions ?? []}><Fragment key={club}>{children}</Fragment></ClubPermissionsContext.Provider></ClubContext.Provider>;
  return <Frame workspace={workspace} club={allowed ? club : null} clubName={clubName} links={visibleLinks(linksFor(workspace), allowed || workspace !== "club" ? account?.permissions ?? [] : [])} switcher={switcher} controls={controls}>{page}</Frame>;
}

/** Shared shell; permissions remain enforced by the Worker and database. */
export function AppShell({ children, publicPage = false }: { children: ReactNode; publicPage?: boolean }) {
  const workspace = workspaceOf(usePathname());
  if (publicPage) return <Frame workspace={workspace} publicPage club={null} clubName="" links={publicLinks}>{children}</Frame>;
  return <Suspense fallback={<Frame workspace={workspace} club={null} clubName="俱乐部名称" links={visibleLinks(linksFor(workspace), [])}>{waiting("正在读取…")}</Frame>}>
    <PrivateShell>{children}</PrivateShell>
  </Suspense>;
}
