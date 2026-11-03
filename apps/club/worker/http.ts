// Small HTTP helpers shared by every Worker handler. No feature or business logic here.
export type Rest = (path: string, body?: unknown) => Promise<Response>;
/** The caller's live access for the request's club, read once per request from the database. */
export type Access = { permissions: import("../src/domain/permissions.ts").Permission[]; roles: string[]; superAdmin: boolean; superAdminActive: boolean; sessionAal2: boolean;
  /** Listed as a platform admin (stage E); powers still come only from platformPermissions. */
  platformAdmin: boolean;
  /** An active leader of an active alliance (stage F); what they may read is decided per club by can(). */
  allianceLeader: boolean;
  /** Platform-scope permissions (club_private.can_platform); never satisfy a club route, and club ones never satisfy these. */
  platformPermissions: import("../src/domain/permissions.ts").Permission[] };

export const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Reads a request body with a hard byte limit, even when Content-Length is absent or wrong. */
export async function readBody(request: Request, limit: number, messages: { missing: string; tooLarge?: string }): Promise<string | Response> {
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: messages.missing }, 400);
  let text = "", size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return reply({ error: messages.tooLarge ?? "请求过大" }, 413); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Maps the database's explicit business errors to HTTP; anything else gets a generic, non-leaking message. */
export async function rpcFailure(response: Response, fallback: string, otherStatus = 502) {
  const error = await response.json() as { code?: string; message?: string };
  const status = error.code === "PT409" ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : otherStatus;
  return reply({ error: status === otherStatus ? fallback : error.message }, status);
}
