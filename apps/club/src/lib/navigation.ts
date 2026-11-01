// Single source of truth for Club routes: which pages use the private shell, and the sidebar entries.
// Presentation only. The Worker and database enforce every permission; hiding a link is never access control.
export type NavLink = { href: string; icon: string; label: string };
// Two workspaces share one shell: the platform (Super Admin) and the club this deployment serves (CLUB_ID).
export type Workspace = "platform" | "club";

const privateRoutes: { path: string; nav?: { icon: string; label: string }; activeNav?: string; workspace?: Workspace }[] = [
  { path: "/account", nav: { icon: "◇", label: "俱乐部总览" } },
  { path: "/analytics", nav: { icon: "◈", label: "数据分析" } },
  { path: "/members", nav: { icon: "♧", label: "成员名单" } },
  { path: "/players", activeNav: "/members" }, // a player's history highlights 成员名单
  { path: "/import", nav: { icon: "⊕", label: "导入数据" } },
  { path: "/activity", nav: { icon: "≡", label: "操作日志" } },
  { path: "/settings" }, // linked from the header, not the sidebar
  { path: "/admin", nav: { icon: "✠", label: "平台管理中心" }, workspace: "platform" },
  { path: "/admin/security", nav: { icon: "⚿", label: "账户安全" }, workspace: "platform" },
];

const linksOf = (workspace: Workspace): NavLink[] => privateRoutes.flatMap(route => route.nav && (route.workspace ?? "club") === workspace ? [{ href: route.path, ...route.nav }] : []);
export const privateLinks = linksOf("club");
export const platformLinks = linksOf("platform");
export const publicLinks: NavLink[] = [{ href: "/", icon: "◇", label: "首页" }, { href: "/login", icon: "✧", label: "登录" }];

const normalize = (pathname: string) => pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
export function isPrivateRoute(pathname: string) {
  const path = normalize(pathname);
  return privateRoutes.some(route => route.path === path);
}
/** The navigation href to mark as the current page. */
export function activeHref(pathname: string) {
  const path = normalize(pathname);
  return privateRoutes.find(route => route.path === path)?.activeNav ?? path;
}
export function workspaceOf(pathname: string): Workspace {
  const path = normalize(pathname);
  return privateRoutes.find(route => route.path === path)?.workspace ?? "club";
}
export const workspaceHome: Record<Workspace, string> = { platform: "/admin", club: "/account" };
/** The header settings link: each workspace has its own settings, never another workspace's. */
export const workspaceSettings: Record<Workspace, { href: string; label: string }> = { platform: { href: "/admin/security", label: "账户安全" }, club: { href: "/settings", label: "设置" } };
/** Where a signed-in account starts. Super Admin identity, not a club role, decides; the platform page explains any missing MFA. */
export function landingPath(account: { super_admin?: boolean }) {
  return account.super_admin === true ? workspaceHome.platform : workspaceHome.club;
}
