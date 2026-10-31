// Single source of truth for Club routes: which pages use the private shell, and the sidebar entries.
// Presentation only. The Worker and database enforce every permission; hiding a link is never access control.
export type NavLink = { href: string; icon: string; label: string };

const privateRoutes: { path: string; nav?: { icon: string; label: string }; activeNav?: string }[] = [
  { path: "/account", nav: { icon: "◇", label: "俱乐部总览" } },
  { path: "/analytics", nav: { icon: "◈", label: "数据分析" } },
  { path: "/members", nav: { icon: "♧", label: "成员名单" } },
  { path: "/players", activeNav: "/members" }, // a player's history highlights 成员名单
  { path: "/import", nav: { icon: "⊕", label: "导入数据" } },
  { path: "/activity", nav: { icon: "≡", label: "操作日志" } },
  { path: "/settings" }, // linked from the header, not the sidebar
  { path: "/admin" }, // platform panel; header link shown only with platform.read
];

export const privateLinks: NavLink[] = privateRoutes.flatMap(route => route.nav ? [{ href: route.path, ...route.nav }] : []);
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
