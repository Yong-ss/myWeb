import {uuid, validDate} from "../src/domain/member.ts";
import {isFaction, isFactionRank} from "../src/domain/highland.ts";
import {reply, readBody, rpcFailure, type Rest} from "./http.ts";
// Highland Race. The route table declares highland.read / highland.import / highland.edit per method (never the
// events.* permissions); the club is the request's club, and every RPC checks again in the database. The request body
// carries only this club's confirmed participants: the faction-wide AI output never leaves the browser, so nothing
// about other clubs' players can reach the database, the log or this Worker.
const createKeys = ["event_date", "faction", "faction_rank", "players", "request_id", "source", "total_score"];
const updateKeys = ["action", "event_id", "expected_version", "payload", "request_id"];
const actions = ["score", "date", "faction", "metrics", "rebind", "add", "remove", "void", "restore"];
const exact = (input: unknown, keys: string[]): input is Record<string, unknown> =>
  !!input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).sort().join() === keys.join();

export async function handleHighland(request: Request, club: string, rest: Rest) {
  const url = new URL(request.url), p = url.searchParams;
  let path: string, body: Record<string, unknown>;
  if (request.method === "GET") {
    if (url.pathname === "/api/highland-events") {
      const before = p.get("before"), after = p.get("id");
      if ((before === null) !== (after === null) || (before !== null && (!validDate(before) || !uuid.test(after!)))) return reply({ error: "分页参数无效" }, 400);
      path = "rpc/club_highland_list"; body = { p_club: club, p_voided: p.get("voided") === "1", p_before: before, p_before_id: after };
    } else if (url.pathname === "/api/highland-event") {
      const id = p.get("id"), version = p.get("version");
      if (!id || !uuid.test(id) || (version !== null && !/^[1-9]\d{0,8}$/.test(version))) return reply({ error: "赛事编号无效" }, 400);
      path = version ? "rpc/club_highland_version" : "rpc/club_highland_detail";
      body = version ? { p_club: club, p_event: id, p_version: Number(version) } : { p_club: club, p_event: id };
    } else if (url.pathname === "/api/player-highland") {
      const player = p.get("player");
      if (!player || !uuid.test(player)) return reply({ error: "玩家编号无效" }, 400);
      path = "rpc/club_player_highland"; body = { p_club: club, p_player: player };
    } else { path = "rpc/club_highland_identities"; body = { p_club: club }; }
  } else {
    const raw = await readBody(request, 262144, { missing: "请求内容无效", tooLarge: "请求最大 256 KiB" });
    if (raw instanceof Response) return raw;
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return reply({ error: "请求内容无效" }, 400); }
    if (url.pathname === "/api/highland-events") {
      if (!exact(input, createKeys) || !validDate(input.event_date) || !Number.isSafeInteger(input.total_score) || (input.total_score as number) < 0
        || !isFaction(input.faction) || !isFactionRank(input.faction_rank)
        || !Array.isArray(input.players) || input.players.length < 1 || input.players.length > 300
        || !exact(input.source, ["excluded_rows", "output_rows", "strategy_rows"]) || !Object.values(input.source).every(v => Number.isSafeInteger(v) && (v as number) >= 0)
        || typeof input.request_id !== "string" || !uuid.test(input.request_id)) return reply({ error: "请确认比赛日期、总积分、势力、名次和本俱乐部参赛者" }, 400);
      path = "rpc/club_highland_create";
      body = { p_club: club, p_date: input.event_date, p_total_score: input.total_score, p_faction: input.faction, p_faction_rank: input.faction_rank,
        p_players: input.players, p_source: input.source, p_request: input.request_id };
    } else {
      if (!exact(input, updateKeys) || typeof input.event_id !== "string" || !uuid.test(input.event_id) || !Number.isSafeInteger(input.expected_version)
        || !actions.includes(input.action as string) || !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)
        || typeof input.request_id !== "string" || !uuid.test(input.request_id)) return reply({ error: "修改参数无效" }, 400);
      const payload = input.payload as Record<string, unknown>;
      if (input.action === "faction" && (!isFaction(payload.faction) || !isFactionRank(payload.faction_rank))) return reply({ error: "势力必须是固定势力之一，名次只能是 1～4，或留空" }, 400);
      path = "rpc/club_highland_update";
      body = { p_club: club, p_event: input.event_id, p_expected: input.expected_version, p_action: input.action, p_payload: payload, p_request: input.request_id };
    }
  }
  const response = await rest(path, body);
  if (!response.ok) return rpcFailure(response, request.method === "GET" ? "高原竞逐资料暂时无法读取，请重试" : "未保存，请重试；本次数据库写入已回滚");
  const data = await response.json();
  return data === null ? reply({ error: "找不到这场高原竞逐或玩家" }, 404) : reply(data);
}
