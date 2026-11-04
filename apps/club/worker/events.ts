import {uuid, validDate} from "../src/domain/member.ts";
import {reply, readBody, rpcFailure, type Rest} from "./http.ts";
// Four-Way League. The route table declares events.read / events.import / events.edit per method; the club is the request's
// club (never the body), and every RPC checks again in the database (club_private.require / can / can_direct).
const createKeys = ["event_date", "players", "raw_text", "request_id", "total_score"];
const updateKeys = ["action", "event_id", "expected_version", "payload", "request_id"];
const actions = ["score", "date", "metrics", "rebind", "add", "remove", "void", "restore"];
const exact = (input: unknown, keys: string[]): input is Record<string, unknown> =>
  !!input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).sort().join() === keys.join();

export async function handleEvents(request: Request, club: string, rest: Rest) {
  const url = new URL(request.url), p = url.searchParams;
  let path: string, body: Record<string, unknown>;
  if (request.method === "GET") {
    if (url.pathname === "/api/events") {
      const before = p.get("before"), after = p.get("id");
      if ((before === null) !== (after === null) || (before !== null && (!validDate(before) || !uuid.test(after!)))) return reply({ error: "分页参数无效" }, 400);
      path = "rpc/club_events_list"; body = { p_club: club, p_voided: p.get("voided") === "1", p_before: before, p_before_id: after };
    } else if (url.pathname === "/api/event") {
      const id = p.get("id"), version = p.get("version");
      if (!id || !uuid.test(id) || (version !== null && !/^[1-9]\d{0,8}$/.test(version))) return reply({ error: "赛事编号无效" }, 400);
      path = version ? "rpc/club_event_version" : "rpc/club_event_detail";
      body = version ? { p_club: club, p_event: id, p_version: Number(version) } : { p_club: club, p_event: id };
    } else if (url.pathname === "/api/player-events") {
      const player = p.get("player");
      if (!player || !uuid.test(player)) return reply({ error: "玩家编号无效" }, 400);
      path = "rpc/club_player_events"; body = { p_club: club, p_player: player };
    } else { path = "rpc/club_event_identities"; body = { p_club: club }; }
  } else {
    const raw = await readBody(request, 524288, { missing: "请求内容无效", tooLarge: "请求最大 512 KiB" });
    if (raw instanceof Response) return raw;
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return reply({ error: "请求内容无效" }, 400); }
    if (url.pathname === "/api/events") {
      if (!exact(input, createKeys) || !validDate(input.event_date) || !Number.isSafeInteger(input.total_score) || (input.total_score as number) < 0
        || !Array.isArray(input.players) || input.players.length < 1 || input.players.length > 300 || typeof input.raw_text !== "string" || !input.raw_text.trim()
        || typeof input.request_id !== "string" || !uuid.test(input.request_id)) return reply({ error: "请确认比赛日期、总积分、原始 JSON 和参赛者" }, 400);
      path = "rpc/club_event_create";
      body = { p_club: club, p_date: input.event_date, p_total_score: input.total_score, p_players: input.players, p_raw: input.raw_text, p_request: input.request_id };
    } else {
      if (!exact(input, updateKeys) || typeof input.event_id !== "string" || !uuid.test(input.event_id) || !Number.isSafeInteger(input.expected_version)
        || !actions.includes(input.action as string) || !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)
        || typeof input.request_id !== "string" || !uuid.test(input.request_id)) return reply({ error: "修改参数无效" }, 400);
      path = "rpc/club_event_update";
      body = { p_club: club, p_event: input.event_id, p_expected: input.expected_version, p_action: input.action, p_payload: input.payload, p_request: input.request_id };
    }
  }
  const response = await rest(path, body);
  if (!response.ok) return rpcFailure(response, request.method === "GET" ? "赛事资料暂时无法读取，请重试" : "未保存，请重试；本次数据库写入已回滚");
  const data = await response.json();
  return data === null ? reply({ error: "找不到这场比赛或玩家" }, 404) : reply(data);
}
