import {uuid, validDate} from "../src/domain/member.ts";
import {reply, readBody, rpcFailure, type Rest} from "./http.ts";
// Dragon Hunt: attendance only. The route table declares dragon.read / dragon.import / dragon.edit per method; the
// club is the request's club, and every RPC checks again in the database.
const exact = (input: unknown, keys: string[]): input is Record<string, unknown> =>
  !!input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).sort().join() === keys.join();

export async function handleDragon(request: Request, club: string, rest: Rest) {
  const url = new URL(request.url), p = url.searchParams;
  let path: string, body: Record<string, unknown>;
  if (request.method === "GET") {
    if (url.pathname === "/api/dragon-events") {
      const before = p.get("before"), after = p.get("id");
      if ((before === null) !== (after === null) || (before !== null && (!validDate(before) || !uuid.test(after!)))) return reply({ error: "分页参数无效" }, 400);
      path = "rpc/club_dragon_list"; body = { p_club: club, p_voided: p.get("voided") === "1", p_before: before, p_before_id: after };
    } else if (url.pathname === "/api/dragon-event") {
      const id = p.get("id");
      if (!id || !uuid.test(id)) return reply({ error: "记录编号无效" }, 400);
      path = "rpc/club_dragon_detail"; body = { p_club: club, p_event: id };
    } else if (url.pathname === "/api/player-dragon") {
      const player = p.get("player");
      if (!player || !uuid.test(player)) return reply({ error: "玩家编号无效" }, 400);
      path = "rpc/club_player_dragon"; body = { p_club: club, p_player: player };
    } else { path = "rpc/club_dragon_identities"; body = { p_club: club }; }
  } else {
    const raw = await readBody(request, 131072, { missing: "请求内容无效", tooLarge: "请求最大 128 KiB" });
    if (raw instanceof Response) return raw;
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return reply({ error: "请求内容无效" }, 400); }
    if (url.pathname === "/api/dragon-events") {
      if (!exact(input, ["event_date", "players", "request_id", "unmatched"]) || !validDate(input.event_date)
        || !Array.isArray(input.players) || input.players.length < 1 || input.players.length > 300
        || !Number.isSafeInteger(input.unmatched) || (input.unmatched as number) < 0 || (input.unmatched as number) > 1000
        || typeof input.request_id !== "string" || !uuid.test(input.request_id)) return reply({ error: "请确认猎龙日期和参加者" }, 400);
      path = "rpc/club_dragon_create";
      body = { p_club: club, p_date: input.event_date, p_players: input.players, p_unmatched: input.unmatched, p_request: input.request_id };
    } else {
      if (!exact(input, ["event_id", "expected_version", "request_id"]) || typeof input.event_id !== "string" || !uuid.test(input.event_id)
        || !Number.isSafeInteger(input.expected_version) || typeof input.request_id !== "string" || !uuid.test(input.request_id)) return reply({ error: "修改参数无效" }, 400);
      path = "rpc/club_dragon_void";
      body = { p_club: club, p_event: input.event_id, p_expected: input.expected_version, p_request: input.request_id };
    }
  }
  const response = await rest(path, body);
  if (!response.ok) return rpcFailure(response, request.method === "GET" ? "猎龙资料暂时无法读取，请重试" : "未保存，请重试；本次数据库写入已回滚");
  const data = await response.json();
  return data === null ? reply({ error: "找不到这次猎龙或玩家" }, 404) : reply(data);
}
