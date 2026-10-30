import {resolveAbsence} from './resolve-absence.ts';
import {handleActivity} from "./activity.ts";
import { handleImport } from "./imports.ts";
import {handleSettings} from "./settings.ts";
import { handleMembers } from "./members.ts";
import {handleMfa} from "./mfa.ts";
import {instrument} from "./timing.ts";
import {reply, readBody, type Rest, type Access} from "./http.ts";
import {isPermission, type Permission} from "../src/domain/permissions.ts";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  CLUB_ID: string;
}

type Handler = (request: Request, club: string, rest: Rest, access: Access) => Promise<Response>;
// Single source of truth: allowed paths, methods and the permission each business method requires.
// A business route without a declared permission for a method is denied (default deny).
const routes: Record<string, { methods: string[]; handler?: Handler; permission?: Partial<Record<string, Permission>>; mfa?: true }> = {
  "/api/login": { methods: ["POST"] },
  "/api/logout": { methods: ["POST"] },
  "/api/account": { methods: ["GET"] },
  "/api/mfa": { methods: ["GET", "POST"], mfa: true },
  "/api/import-context": { methods: ["GET"], handler: handleImport, permission: { GET: "imports.create" } },
  "/api/imports": { methods: ["POST"], handler: handleImport, permission: { POST: "imports.create" } },
  "/api/player-aliases": { methods: ["POST"], handler: handleImport, permission: { POST: "aliases.manage" } },
  "/api/resolve-absence": { methods: ["POST"], handler: resolveAbsence, permission: { POST: "absences.resolve" } },
  "/api/members": { methods: ["GET"], handler: handleMembers, permission: { GET: "members.read" } },
  "/api/club-settings": { methods: ["GET", "POST"], handler: handleSettings, permission: { GET: "members.read", POST: "club.rename" } },
  "/api/activity": { methods: ["GET"], handler: handleActivity, permission: { GET: "audit.read" } },
  "/api/delete-import": { methods: ["POST"], handler: handleActivity, permission: { POST: "imports.delete" } },
};
export const routePermissions = Object.fromEntries(Object.entries(routes).map(([path, route]) => [path, route.permission]));

type AuthUser = { id: string; email?: string; email_confirmed_at?: string };
type Session = { access_token: string; refresh_token: string; expires_in: number; user: AuthUser };

function cookies(request: Request) {
  return Object.fromEntries((request.headers.get("Cookie") ?? "").split(";").map(part => {
    const index = part.indexOf("=");
    return index < 0 ? ["", ""] : [part.slice(0, index).trim(), part.slice(index + 1)];
  }));
}

function setSession(response: Response, request: Request, session?: Session) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  for (const [name, value, age] of [
    ["__Host-club_access", session?.access_token ?? "", session ? session.expires_in : 0],
    ["__Host-club_refresh", session?.refresh_token ?? "", session ? 60 * 60 * 24 * 7 : 0],
  ]) {
    response.headers.append("Set-Cookie", `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`);
  }
  return response;
}

export async function handleRequest(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const metrics=instrument(fetcher);
  return metrics.finish(await serve(request,env,metrics.fetcher));
}
async function serve(request: Request, env: Env, fetcher: typeof fetch): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : undefined;
  if (!route) return reply({ error: "接口不存在" }, 404);
  if (!route.methods.includes(request.method)) return reply({ error: "请求方式不支持" }, 405);
  if (request.method === "POST" && (request.headers.get("Origin") !== url.origin || !request.headers.get("Content-Type")?.startsWith("application/json"))) {
    return reply({ error: "请求来源无效" }, 403);
  }
  if (!env.CLUB_ID || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return reply({ error: "俱乐部尚未配置，请稍后再试" }, 503);

  const callAuth = (path: string, body?: unknown, token?: string, method?: string) => fetcher(`${env.SUPABASE_URL}/auth/v1/${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  // Every decision comes from the database (club_my_access -> can()); nothing here infers access from role names.
  const access = async (user: AuthUser, token: string): Promise<Access | undefined> => {
    if (!user.email_confirmed_at) return undefined;
    const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/club_my_access`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_club: env.CLUB_ID }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Membership service unavailable");
    const data = await response.json() as { permissions?: unknown; roles?: unknown; super_admin?: unknown; super_admin_active?: unknown; session_aal2?: unknown };
    const result: Access = {
      permissions: Array.isArray(data.permissions) ? data.permissions.filter(isPermission) : [],
      roles: Array.isArray(data.roles) ? data.roles.filter((r): r is string => typeof r === "string") : [],
      superAdmin: data.super_admin === true, superAdminActive: data.super_admin_active === true, sessionAal2: data.session_aal2 === true,
    };
    // A listed Super Admin may sign in to complete MFA even without club permissions; powers still need aal2.
    return result.permissions.length || result.superAdmin ? result : undefined;
  };
  try {
    if (url.pathname === "/api/login") {
      const text = await readBody(request, 4096, { missing: "请输入邮箱和密码" });
      if (text instanceof Response) return text;
      let input;
      try { input = JSON.parse(text); } catch { return reply({ error: "请求内容无效" }, 400); }
      if (!input || typeof input.email !== "string" || typeof input.password !== "string" || !input.email.trim() || !input.password || input.email.length > 320 || input.password.length > 1024) return reply({ error: "请输入有效的邮箱和密码" }, 400);
      const result = await callAuth("token?grant_type=password", { email: input.email.trim(), password: input.password });
      if (!result.ok) return reply({ error: result.status === 429 ? "尝试过于频繁，请稍后再试" : "邮箱、密码不正确，或账户尚未确认" }, result.status === 429 ? 429 : 401);
      const session: Session = await result.json();
      if (!await access(session.user, session.access_token)) {
        await callAuth("logout?scope=local", {}, session.access_token);
        return setSession(reply({ error: "此账户没有访问权限" }, 403), request);
      }
      return setSession(reply({ ok: true }), request, session);
    }

    const stored = cookies(request);
    if (url.pathname === "/api/logout") {
      let token = stored["__Host-club_access"];
      if (stored["__Host-club_refresh"]) {
        const refresh = await callAuth("token?grant_type=refresh_token", { refresh_token: stored["__Host-club_refresh"] });
        if (refresh.ok) token = ((await refresh.json()) as Session).access_token;
        else if (refresh.status >= 500 || refresh.status === 429) return reply({ error: "暂时无法退出，请重试" }, 502);
      }
      if (token) {
        const revoked = await callAuth("logout?scope=local", {}, token);
        if (!revoked.ok && revoked.status !== 401 && revoked.status !== 403) return reply({ error: "暂时无法退出，请重试" }, 502);
      }
      return setSession(reply({ ok: true }), request);
    }

    let user: AuthUser | undefined;
    let renewed: Session | undefined;
    if (stored["__Host-club_access"]) {
      const verified = await callAuth("user", undefined, stored["__Host-club_access"]);
      if (verified.ok) user = await verified.json();
      else if (verified.status !== 401 && verified.status !== 403) return reply({ error: "账户服务暂时不可用" }, 502);
    }
    if (!user && stored["__Host-club_refresh"]) {
      const refresh = await callAuth("token?grant_type=refresh_token", { refresh_token: stored["__Host-club_refresh"] });
      if (refresh.ok) { renewed = await refresh.json(); user = renewed?.user; }
      else if (refresh.status >= 500 || refresh.status === 429) return reply({ error: "账户服务暂时不可用" }, 502);
    }
    if (!user) return setSession(reply({ error: "请先登录" }, 401), request);
    const token = renewed?.access_token ?? stored["__Host-club_access"];
    const granted = await access(user, token);
    if (!granted) return setSession(reply({ error: "此账户没有俱乐部访问权限" }, 403), request);
    // Cached reads are keyed to the exact access they were fetched with, so any permission change clears them.
    const scope = `${user.id}:${env.CLUB_ID}:${granted.superAdminActive ? "aal2" : "aal1"}:${granted.permissions.join(",")}`;
    const finish = (response: Response, session = renewed) => { response.headers.set("X-Club-Scope", scope); return session ? setSession(response, request, session) : response; };
    if (route.mfa) {
      if (!granted.superAdmin) return finish(reply({ error: "此账户不需要两步验证设置" }, 403));
      const result = await handleMfa(request, (path, body, method) => callAuth(path, body, token, method), granted, async () => {
        const r = await fetcher(`${env.SUPABASE_URL}/rest/v1/rpc/club_my_trusted_factors`, { method: "POST", headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error("Trusted factors unavailable");
        return await r.json() as string[];
      });
      return finish(result.response, (result.session as Session | undefined) ?? renewed);
    }
    if (route.handler) {
      const required = route.permission?.[request.method];
      if (!required || !granted.permissions.includes(required)) return finish(reply({ error: "此账户没有权限执行这个操作" }, 403));
      const response = await route.handler(request, env.CLUB_ID, (path: string, body?: unknown) => fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      }), granted);
      return finish(response);
    }
    return finish(reply({ email: user.email, club_id: env.CLUB_ID, roles: granted.roles, permissions: granted.permissions, super_admin: granted.superAdmin, mfa_verified: granted.superAdminActive, mfa_session: granted.sessionAal2 }));
  } catch (error) {
    // Only path and error type/message: never cookies, tokens or request bodies.
    console.error(JSON.stringify({ event: "club_api_error", path: url.pathname, error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown" }));
    return reply({ error: "账户服务连接失败，请稍后重试" }, 502);
  }
}

const worker = {
  fetch(request: Request, env: Env) { return handleRequest(request, env); },
};
export default worker;
