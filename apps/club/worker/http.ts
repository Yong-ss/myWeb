// Small HTTP helpers shared by every Worker handler. No feature or business logic here.
export type Rest = (path: string, body?: unknown) => Promise<Response>;

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
