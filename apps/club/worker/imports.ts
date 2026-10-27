import { fields, MAX_SOURCE_BYTES, validDate, validateRows, uuid, type ConfirmedMember } from "../src/lib/import.ts";

const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function handleImport(request: Request, clubId: string, rest: (path: string, body?: unknown) => Promise<Response>) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const date = url.searchParams.get("date");
    if (!validDate(date)) return reply({ error: "请填写有效截图日期" }, 400);
    const [players, snapshots] = await Promise.all([
      rest(`club_players?select=id,display_name,match_name&club_id=eq.${clubId}&order=display_name,id&limit=1000`),
      rest(`club_snapshots?select=id,revision,is_complete_roster&club_id=eq.${clubId}&snapshot_date=eq.${date}&is_current=eq.true&limit=1`),
    ]);
    if (!players.ok || !snapshots.ok) return reply({ error: "暂时无法准备导入资料" }, 502);
    const total = Number(players.headers.get("Content-Range")?.split("/")[1]);
    if (!Number.isFinite(total) || total > 1000) return reply({ error: "玩家数量超出当前导入预览上限，请联系站点所有者" }, 413);
    const snapshot = (await snapshots.json() as { id: string }[])[0] ?? null;
    let members: ConfirmedMember[] = [];
    if (snapshot) {
      const response = await rest(`club_snapshot_players?select=player_id,${fields.map(k => k === "group" ? "group_name" : k).join(",")}&club_id=eq.${clubId}&snapshot_id=eq.${snapshot.id}&limit=201`);
      if (!response.ok) return reply({ error: "暂时无法读取同日版本" }, 502);
      const rows = await response.json() as (ConfirmedMember & { group_name: string | null })[];
      if (rows.length > 200) return reply({ error: "同日版本超过 200 人，请联系站点所有者" }, 413);
      members = rows.map(({ group_name, ...row }) => ({ ...row, group: group_name }));
    }
    return reply({ players: await players.json(), snapshot, members });
  }
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "缺少导入内容" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 524288) { await reader.cancel(); return reply({ error: "导入请求最大 512 KiB" }, 413); }
    chunks.push(value);
  }
  let input;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    input = JSON.parse(new TextDecoder().decode(bytes));
    if (!input || !validDate(input.snapshot_date) || !["merge", "replace"].includes(input.mode) || input.confirmed !== true || typeof input.is_complete_roster !== "boolean" || typeof input.raw_text !== "string" || !input.raw_text.trim() || new TextEncoder().encode(input.raw_text).length > MAX_SOURCE_BYTES || typeof input.request_id !== "string" || !uuid.test(input.request_id) || (input.expected_snapshot_id !== null && (typeof input.expected_snapshot_id !== "string" || !uuid.test(input.expected_snapshot_id)))) throw Error("请确认日期、原始 JSON、身份和同日修正方式");
    validateRows(input.members);
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "导入内容无效" }, 400); }
  const response = await rest("rpc/club_commit_import", {
    p_club_id: clubId, p_date: input.snapshot_date, p_complete: input.is_complete_roster,
    p_mode: input.mode, p_rows: input.members, p_raw: input.raw_text,
    p_request_id: input.request_id, p_expected: input.expected_snapshot_id, p_confirmed: true,
  });
  if (!response.ok) {
    const error = await response.json() as { code?: string; message?: string };
    const status = error.code === "PT409" ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : 502;
    return reply({ error: status === 502 ? "导入未完成，请重试；本次数据库写入已回滚" : error.message }, status);
  }
  return reply(await response.json());
}
