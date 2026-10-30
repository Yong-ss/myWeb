import { fields, validDate, uuid } from "../src/domain/member.ts";
import { MAX_SOURCE_BYTES, validateRows, validateAbsences, type ConfirmedMember } from "../src/features/import/contract.ts";
import { reply, readBody, rpcFailure, type Rest } from "./http.ts";

export async function handleImport(request: Request, clubId: string, rest: Rest) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const date = url.searchParams.get("date");
    if (!validDate(date)) return reply({ error: "请填写有效截图日期" }, 400);
    const absenceRequest=url.searchParams.get('review_absences')==='1'?rest('rpc/club_absence_context',{p_club:clubId,p_date:date}):null;
    const [identities, snapshots, absenceResponse] = await Promise.all([
      rest("rpc/club_identity_context", { p_club_id: clubId, p_date: date }),
      rest(`club_snapshots?select=id,revision,is_complete_roster&club_id=eq.${clubId}&snapshot_date=eq.${date}&is_current=eq.true&limit=1`),
      absenceRequest,
    ]);
    if (!identities.ok || !snapshots.ok) return reply({ error: "暂时无法准备导入资料" }, 502);
    const identityData = await identities.json() as { players: unknown[]; aliases: unknown[] };
    if (!Array.isArray(identityData.players) || !Array.isArray(identityData.aliases) || identityData.players.length > 1000 || identityData.aliases.length > 10000) return reply({ error: "身份资料超出当前导入预览上限，请联系站点所有者" }, 413);
    const snapshot = (await snapshots.json() as { id: string }[])[0] ?? null;
    let members: ConfirmedMember[] = [];
    if (snapshot) {
      const response = await rest(`club_snapshot_players?select=player_id,source_name,${fields.map(k => k === "group" ? "group_name" : k).join(",")}&club_id=eq.${clubId}&snapshot_id=eq.${snapshot.id}&limit=201`);
      if (!response.ok) return reply({ error: "暂时无法读取同日版本" }, 502);
      const rows = await response.json() as (ConfirmedMember & { group_name: string | null })[];
      if (rows.length > 200) return reply({ error: "同日版本超过 200 人，请联系站点所有者" }, 413);
      members = rows.map(({ group_name, ...row }) => ({ ...row, group: group_name }));
    }
    let absence_context;
    if(absenceResponse){const response=absenceResponse;if(!response.ok){const e=await response.json().catch(()=>null) as {code?:string}|null;return reply({error:response.status===404&&e?.code==='PGRST202'?'数据库尚未更新，请先完成迁移；暂时不要开始核对。':'暂时无法读取对比名单，请重试'},503);}absence_context=await response.json();if(absence_context?.absence_version!==2)return reply({error:"数据库尚未更新，请先完成迁移；暂时不要开始核对。"},503);}
    return reply({ ...identityData, snapshot, members, ...(absence_context?{absence_context}:{}) });
  }
  const raw = await readBody(request, 524288, { missing: "缺少导入内容", tooLarge: "导入请求最大 512 KiB" });
  if (raw instanceof Response) return raw;
  let input;
  try {
    input = JSON.parse(raw);
    if (!input || typeof input !== "object") throw Error("请求无效");
    if (url.pathname === "/api/player-aliases") {
      if (input.confirmed !== true || (input.revoke_id ? !uuid.test(input.revoke_id) : !uuid.test(input.player_id ?? "") || typeof input.alias_name !== "string" || !input.alias_name.trim() || input.alias_name.length > 200)) throw Error("请明确确认别名或解除关联");
    } else {
      if (!validDate(input.snapshot_date) || !["merge", "replace"].includes(input.mode) || input.confirmed !== true || typeof input.is_complete_roster !== "boolean" || typeof input.raw_text !== "string" || !input.raw_text.trim() || new TextEncoder().encode(input.raw_text).length > MAX_SOURCE_BYTES || typeof input.request_id !== "string" || !uuid.test(input.request_id) || (input.expected_snapshot_id !== null && (typeof input.expected_snapshot_id !== "string" || !uuid.test(input.expected_snapshot_id)))) throw Error("请确认日期、原始 JSON、身份和同日修正方式");
      validateRows(input.members);
      if(Object.hasOwn(input,'absence_decisions')){validateAbsences(input.absence_decisions);if(input.baseline_snapshot_id!==null&&!uuid.test(input.baseline_snapshot_id??''))throw Error('对比名单无效，请重新准备');if(input.is_complete_roster&&input.absence_decisions.some((a:{decision:string})=>!['left','temporary'].includes(a.decision)))throw Error('仍有待确认的成员，不能确认名单完整');}
    }
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "导入内容无效" }, 400); }
  const response = url.pathname === "/api/player-aliases" ? await rest("rpc/club_manage_alias", { p_club_id: clubId, p_player_id: input.player_id ?? null, p_alias: input.alias_name ?? null, p_revoke_id: input.revoke_id ?? null }) : await rest(Object.hasOwn(input,'absence_decisions')?"rpc/club_commit_reviewed_import":"rpc/club_commit_import", {
    p_club_id: clubId, p_date: input.snapshot_date, p_complete: input.is_complete_roster,
    p_mode: input.mode, p_rows: input.members, p_raw: input.raw_text,
    p_request_id: input.request_id, p_expected: input.expected_snapshot_id, p_confirmed: true,
    ...(Object.hasOwn(input,'absence_decisions')?{p_absences:input.absence_decisions,p_baseline:input.baseline_snapshot_id}:{}),
  });
  if (!response.ok) return rpcFailure(response, "导入未完成，请重试；本次数据库写入已回滚");
  return reply(await response.json());
}
