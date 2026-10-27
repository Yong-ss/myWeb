import { fields } from "../src/lib/import.ts";
import { playerTimeline, type Day } from "../src/lib/presence.ts";
export const savedFields = `player_id,${fields.map(f => f === "group" ? "group_name" : f).join(",")}`;
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function playerHistory(player: string, date: string | null, club: string, rest: (path: string) => Promise<Response>) {
  const response = await rest(`club_players?${new URLSearchParams({select:"id,display_name",club_id:`eq.${club}`,id:`eq.${player}`,limit:"1"})}`);
  if (!response.ok) return reply({error:"暂时无法读取玩家档案"},502);
  const identity = (await response.json() as {id:string;display_name:string}[])[0];
  if (!identity) return reply({error:"找不到此玩家或没有访问权限"},404);
  const days: Day[] = [];
  // Bounded pages avoid the hosted REST row limit; no fixture or privileged key.
  for (let offset=0;offset<2000;offset+=200) {
    const query = new URLSearchParams({select:`id,snapshot_date,is_complete_roster,revision,rows:club_snapshot_players(${savedFields})`,club_id:`eq.${club}`,is_current:"eq.true",order:"snapshot_date.asc",limit:"200",offset:String(offset),"rows.player_id":`eq.${player}`,"rows.club_id":`eq.${club}`,"rows.limit":"1"});
    if (date) query.set("snapshot_date",`lte.${date}`);
    const result = await rest(`club_snapshots?${query}`);
    if (!result.ok) return reply({error:"暂时无法读取玩家历史，请重试"},502);
    const page = await result.json() as Day[]; days.push(...page);
    if (page.length<200) return reply({player:identity,timeline:playerTimeline(days)});
  }
  return reply({error:"历史超过当前查询上限，请联系站点所有者"},413);
}
