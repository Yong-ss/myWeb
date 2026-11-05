import {clubHref,preferredClub} from "./club-context.ts";
// Single source of truth for Club routes: which pages use the private shell, and the sidebar entries.
// Presentation only. The Worker and database enforce every permission; hiding a link is never access control.
// `anyOf`: show the entry only to accounts holding one of these permissions in this club (display only).
export type NavLink = { href: string; icon: string; label: string; anyOf?: string[] };
// Workspaces share one shell: the platform (Super Admin), one club (named by the page URL, see club-context.ts),
// and the account hub listing every club the account has a role in.
export type Workspace = "platform" | "club" | "hub" | "alliance";

const privateRoutes: { path: string; nav?: { icon: string; label: string; anyOf?: string[] }; activeNav?: string; workspace?: Workspace }[] = [
  { path: "/account", nav: { icon: "◇", label: "俱乐部总览" } },
  { path: "/analytics", nav: { icon: "◈", label: "数据分析" } },
  { path: "/members", nav: { icon: "♧", label: "成员名单" } },
  { path: "/players", activeNav: "/members" }, // a player's history highlights 成员名单
  { path: "/events", nav: { icon: "⚔", label: "四方联赛", anyOf: ["events.read"] } },
  { path: "/events/import", activeNav: "/events" },
  { path: "/event", activeNav: "/events" },
  { path: "/highland", nav: { icon: "△", label: "高原竞逐", anyOf: ["highland.read"] } },
  { path: "/highland/import", activeNav: "/highland" },
  { path: "/highland/event", activeNav: "/highland" },
  { path: "/import", nav: { icon: "⊕", label: "导入数据", anyOf: ["imports.create"] } },
  { path: "/activity", nav: { icon: "≡", label: "操作日志", anyOf: ["audit.read"] } },
  { path: "/team", nav: { icon: "♔", label: "管理员管理", anyOf: ["club.admins.manage", "club.admins.permissions"] } },
  { path: "/settings" }, // linked from the header, not the sidebar
  { path: "/admin", nav: { icon: "✠", label: "平台管理中心" }, workspace: "platform" },
  { path: "/admin/security", nav: { icon: "⚿", label: "账户安全" }, workspace: "platform" },
  { path: "/clubs", nav: { icon: "♜", label: "我的俱乐部" }, workspace: "hub" },
  { path: "/alliance", nav: { icon: "☩", label: "我的联盟" }, workspace: "alliance" },
];

const linksOf = (workspace: Workspace): NavLink[] => privateRoutes.flatMap(route => route.nav && (route.workspace ?? "club") === workspace ? [{ href: route.path, ...route.nav }] : []);
export const privateLinks = linksOf("club");
export const platformLinks = linksOf("platform");
export const hubLinks = linksOf("hub");
export const allianceLinks = linksOf("alliance");
export const publicLinks: NavLink[] = [{ href: "/", icon: "◇", label: "首页" }, { href: "/login", icon: "✧", label: "登录" }];

const normalize = (pathname: string) => pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
export function isPrivateRoute(pathname: string) {
  const path = normalize(pathname);
  return privateRoutes.some(route => route.path === path);
}
/** Entries this account may see; ungated entries always show. */
export const visibleLinks = (links: NavLink[], permissions: readonly string[]) => links.filter(l => !l.anyOf || l.anyOf.some(p => permissions.includes(p)));
/** The navigation href to mark as the current page. */
export function activeHref(pathname: string) {
  const path = normalize(pathname);
  return privateRoutes.find(route => route.path === path)?.activeNav ?? path;
}
export function workspaceOf(pathname: string): Workspace {
  const path = normalize(pathname);
  return privateRoutes.find(route => route.path === path)?.workspace ?? "club";
}
export const workspaceHome: Record<Workspace, string> = { platform: "/admin", club: "/account", hub: "/clubs", alliance: "/alliance" };
/** The header settings link: each workspace has its own settings, never another workspace's. */
export const workspaceSettings: Partial<Record<Workspace, { href: string; label: string }>> = { platform: { href: "/admin/security", label: "账户安全" }, club: { href: "/settings", label: "设置" } };
/** Where a signed-in account starts. Platform identity (Super Admin or platform admin), not a club role, decides; the
 * platform page explains any missing MFA. Others start in their preferred club (see preferredClub), otherwise in the hub. */
export function landingPath(account: Parameters<typeof preferredClub>[0] & { platform_admin?: boolean; alliance_leader?: boolean }, last: string | null = null) {
  if (account.super_admin === true || account.platform_admin === true) return workspaceHome.platform;
  // An alliance leader without a club role to resume starts in the alliance workspace (stage F); read access to the
  // default club that comes only through the alliance is not a reason to open it.
  const viaAlliance = account.alliance_leader === true && !(account.clubs ?? []).some(c => c.id === account.club_id);
  const club = preferredClub(viaAlliance ? { ...account, permissions: [] } : account, last);
  return club ? clubHref(workspaceHome.club, club) : account.alliance_leader === true ? workspaceHome.alliance : workspaceHome.hub;
}
/** The page to open in another club: the same section, without parameters that only mean something in this club. */
export function switchPath(pathname: string) {
  const path = activeHref(pathname);
  return workspaceOf(path) === "club" && isPrivateRoute(path) ? path : workspaceHome.club;
}
