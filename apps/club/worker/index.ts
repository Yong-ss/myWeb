import { handleImport } from "./imports.ts";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  CLUB_ID: string;
}

type AuthUser = { id: string; email?: string; email_confirmed_at?: string };
type Session = { access_token: string; refresh_token: string; expires_in: number; user: AuthUser };

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

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
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  if (!["/api/login", "/api/account", "/api/logout", "/api/import-context", "/api/imports"].includes(url.pathname)) return reply({ error: "接口不存在" }, 404);
  const expectedMethod = ["/api/account", "/api/import-context"].includes(url.pathname) ? "GET" : "POST";
  if (request.method !== expectedMethod) return reply({ error: "请求方式不支持" }, 405);
  if (request.method === "POST" && (request.headers.get("Origin") !== url.origin || !request.headers.get("Content-Type")?.startsWith("application/json"))) {
    return reply({ error: "请求来源无效" }, 403);
  }
  if (!env.CLUB_ID || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return reply({ error: "俱乐部尚未配置，请稍后再试" }, 503);

  const callAuth = (path: string, body?: unknown, token?: string) => fetcher(`${env.SUPABASE_URL}/auth/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  const membership = async (user: AuthUser, token: string): Promise<"owner" | "admin" | undefined> => {
    if (!user.email_confirmed_at) return undefined;
    const query = new URLSearchParams({ select: "role", club_id: `eq.${env.CLUB_ID}`, user_id: `eq.${user.id}`, status: "eq.active" });
    const response = await fetcher(`${env.SUPABASE_URL}/rest/v1/club_memberships?${query}`, {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Membership service unavailable");
    const rows: { role: string }[] = await response.json();
    const role = rows.length === 1 ? rows[0].role : undefined;
    return role === "owner" || role === "admin" ? role : undefined;
  };
  try {
    if (url.pathname === "/api/login") {
      // Bound memory use even when Content-Length is absent or incorrect.
      const reader = request.body?.getReader();
      if (!reader) return reply({ error: "请输入邮箱和密码" }, 400);
      let text = "";
      let bytes = 0;
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4096) { await reader.cancel(); return reply({ error: "请求过大" }, 413); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      let input;
      try { input = JSON.parse(text); } catch { return reply({ error: "请求内容无效" }, 400); }
      if (!input || typeof input.email !== "string" || typeof input.password !== "string" || !input.email.trim() || !input.password || input.email.length > 320 || input.password.length > 1024) return reply({ error: "请输入有效的邮箱和密码" }, 400);
      const result = await callAuth("token?grant_type=password", { email: input.email.trim(), password: input.password });
      if (!result.ok) return reply({ error: result.status === 429 ? "尝试过于频繁，请稍后再试" : "邮箱、密码不正确，或账户尚未确认" }, result.status === 429 ? 429 : 401);
      const session: Session = await result.json();
      if (!await membership(session.user, session.access_token)) {
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
    const role = await membership(user, renewed?.access_token ?? stored["__Host-club_access"]);
    if (!role) return setSession(reply({ error: "此账户没有俱乐部访问权限" }, 403), request);
    if (url.pathname === "/api/import-context" || url.pathname === "/api/imports") {
      const token = renewed?.access_token ?? stored["__Host-club_access"];
      const response = await handleImport(request, env.CLUB_ID, (path, body) => fetcher(`${env.SUPABASE_URL}/rest/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "count=exact" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      }));
      return renewed ? setSession(response, request, renewed) : response;
    }
    const response = reply({ email: user.email, club_id: env.CLUB_ID, role });
    return renewed ? setSession(response, request, renewed) : response;
  } catch {
    return reply({ error: "账户服务连接失败，请稍后重试" }, 502);
  }
}

const worker = {
  fetch(request: Request, env: Env) { return handleRequest(request, env); },
};
export default worker;
