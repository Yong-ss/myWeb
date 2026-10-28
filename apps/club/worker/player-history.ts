import { fields } from "../src/lib/import.ts";
import { playerTimeline, type Day, type Presence, type SavedMember } from "../src/lib/presence.ts";
export async function historyPage(player:string,date:string|null,before:string|null,club:string,rest:(path:string,body?:unknown)=>Promise<Response>){
  const response=await rest('rpc/club_history_page',{p_club:club,p_player:player,p_date:date,p_before:before});
  if(!response.ok){
    const error=await response.json().catch(()=>null) as {code?:string}|null;
    // Local preview can run against the old hosted schema before migration approval.
    // Fall back ONLY for a missing function, never for permission or query failures.
    if(response.status===404&&error?.code==='PGRST202'){
      const legacy=await playerHistory(player,date,club,rest,before);
      if(!legacy.ok)return legacy;
      const data=await legacy.json() as {player:unknown;timeline:ReturnType<typeof playerTimeline>};
      const page=data.timeline.slice(-100);
      const result=reply({player:data.player,timeline:page,next:data.timeline.length>100?page[0].date:null});
      result.headers.set('X-Club-Read-Mode','legacy-schema');
      return result;
    }
    return reply({error:'暂时无法读取玩家历史，请重试'},502);
  }
  const data=await response.json() as {player:unknown;days:Day[];previous:SavedMember|null;status:Presence|null;next:string|null}|null;
  return data?reply({player:data.player,timeline:playerTimeline(data.days,{status:data.status,previous:data.previous}),next:data.next}):reply({error:'找不到此玩家或没有访问权限'},404);
}
export const savedFields = `player_id,${fields.map(f => f === "group" ? "group_name" : f).join(",")}`;
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export async function playerHistory(player: string, date: string | null, club: string, rest: (path: string) => Promise<Response>, before:string|null=null) {
  const response = await rest(`club_players?${new URLSearchParams({select:"id,display_name",club_id:`eq.${club}`,id:`eq.${player}`,limit:"1"})}`);
  if (!response.ok) return reply({error:"暂时无法读取玩家档案"},502);
  const identity = (await response.json() as {id:string;display_name:string}[])[0];
  if (!identity) return reply({error:"找不到此玩家或没有访问权限"},404);
  const days: Day[] = []; let withAbsences=true;
  // Bounded pages avoid the hosted REST row limit; no fixture or privileged key.
  for (let offset=0;offset<2000;offset+=200) {
    const query = new URLSearchParams({select:`id,snapshot_date,is_complete_roster,revision,rows:club_snapshot_players(${savedFields})${withAbsences?",absences:club_snapshot_absences(player_id,decision)":""}`,club_id:`eq.${club}`,is_current:"eq.true",order:"snapshot_date.asc",limit:"200",offset:String(offset),"rows.player_id":`eq.${player}`,"rows.club_id":`eq.${club}`,"rows.limit":"1",...(withAbsences?{"absences.player_id":`eq.${player}`,"absences.limit":"1"}:{})});
    if (date) query.set("snapshot_date",`lte.${date}`);
    if(before)query.set('and',`(snapshot_date.lt.${before})`);
    let result = await rest(`club_snapshots?${query}`); if(!result.ok&&withAbsences){const e=await result.clone().json().catch(()=>null);if(result.status===400&&e?.code==="PGRST200"){withAbsences=false;query.set("select",`id,snapshot_date,is_complete_roster,revision,rows:club_snapshot_players(${savedFields})`);query.delete("absences.player_id");query.delete("absences.limit");result=await rest(`club_snapshots?${query}`);}}
    if (!result.ok) return reply({error:"暂时无法读取玩家历史，请重试"},502);
    const page = await result.json() as (Day & {absences?:{decision:string}[]})[]; days.push(...page.map(d=>({...d,confirmed_left:d.absences?.some(a=>a.decision==="left")??false})));
    if (page.length<200) return reply({player:identity,timeline:playerTimeline(days)});
  }
  return reply({error:"历史超过当前查询上限，请联系站点所有者"},413);
}
