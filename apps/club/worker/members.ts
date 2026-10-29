import { validDate, uuid } from "../src/domain/member.ts";
import { absenceStatus, type SavedMember } from "../src/domain/presence.ts";
import { playerHistory, historyPage, savedFields } from "./player-history.ts";
import { reply, type Rest } from "./http.ts";

export async function handleMembers(request: Request, clubId: string, rest: Rest) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date"), before = url.searchParams.get("before"), version = url.searchParams.get("version");
  const player = url.searchParams.get("player");
  if (player !== null && !uuid.test(player)) return reply({error:"玩家编号无效"},400);
  if ((date !== null && !validDate(date)) || (before !== null && !validDate(before)) || (version !== null && (!date || !uuid.test(version)))) return reply({ error: "日期或版本无效" }, 400);
  if (player && url.searchParams.has('paged')) {
    if(before!==null&&!validDate(before))return reply({error:'游标无效'},400);
    return historyPage(player,date,before,clubId,rest);
  }
  if (player) return playerHistory(player,date,clubId,rest);
  const query = new URLSearchParams({ select: "id,snapshot_date,revision,is_complete_roster,is_current", club_id: `eq.${clubId}`, order: "snapshot_date.desc,revision.desc", limit: "101" });
  if (date) query.set("snapshot_date", `eq.${date}`);
  else { query.set("is_current", "eq.true"); if (before) query.set("snapshot_date", `lt.${before}`); }
  const response = await rest(`club_snapshots?${query}`);
  if (!response.ok) return reply({ error: "暂时无法读取记录，请重试" }, 502);
  const snapshots = await response.json() as { id: string; snapshot_date: string; revision: number; is_complete_roster: boolean; is_current: boolean }[];
  if (date && snapshots.length > 100) return reply({ error: "当天版本超过查询上限，请联系站点所有者" }, 413);
  const visible = snapshots.slice(0, 100);
  const snapshot = version ? visible.find(s => s.id === version) : visible[0];
  if (!snapshot) return version ? reply({ error: "找不到这个版本" }, 404) : reply({ snapshots: visible, snapshot: null, members: [], next: null });
  const roster=await rest('rpc/club_roster_presence',{p_club:clubId,p_snapshot:snapshot.id});
  if(roster.ok){
    const data=await roster.json() as {members:unknown[];snapshot_count:number}|null;
    if(!data||!Array.isArray(data.members)||data.members.length>=1000||!Number.isInteger(data.snapshot_count)||data.snapshot_count>200)return reply({error:'名单资料无效或超出上限'},502);
    return reply({snapshots:visible,snapshot,...data,next:!date&&snapshots.length>100?visible.at(-1)!.snapshot_date:null});
  }
  const failure=await roster.json().catch(()=>null) as {code?:string;message?:string}|null;
  if(roster.status!==404||failure?.code!=='PGRST202')return reply({error:failure?.code==='54000'?failure.message:'暂时无法判断成员状态，请重试'},failure?.code==='54000'?413:502);
  const rowsPromise = rest(`club_snapshot_players?${new URLSearchParams({ select: savedFields, club_id: `eq.${clubId}`, snapshot_id: `eq.${snapshot.id}`, order: "player_id.asc", limit: "201" })}`);
  const [rows, peopleResponse, completeResponse] = await Promise.all([
    rowsPromise,
    rest(`club_players?${new URLSearchParams({select:`id,last:club_snapshot_players(${savedFields},snapshot:club_snapshots!inner(snapshot_date))`,club_id:`eq.${clubId}`,order:"id.asc",limit:"1000","last.club_id":`eq.${clubId}`,"last.snapshot.is_current":"eq.true","last.snapshot.snapshot_date":`lt.${snapshot.snapshot_date}`,"last.order":"snapshot(snapshot_date).desc","last.limit":"1"})}`),
    rest(`club_snapshots?${new URLSearchParams({select:"snapshot_date",club_id:`eq.${clubId}`,is_current:"eq.true",is_complete_roster:"eq.true",snapshot_date:`lt.${snapshot.snapshot_date}`,order:"snapshot_date.desc",limit:"1"})}`),
  ]);
  if (!rows.ok) return reply({ error: "暂时无法读取名单，请重试" }, 502);
  const members = await rows.json() as SavedMember[];
  if (members.length > 200) return reply({ error: "名单超过查询上限，请联系站点所有者" }, 413);
  if (!peopleResponse.ok || !completeResponse.ok) return reply({error:"暂时无法判断成员状态，请重试"},502);
  const people = await peopleResponse.json() as {id:string;last:(SavedMember & {snapshot:{snapshot_date:string}})[]}[];
  if (people.length>=1000) return reply({error:"历史玩家超过当前查询上限"},413);
  const lastComplete = snapshot.is_complete_roster ? snapshot.snapshot_date : (await completeResponse.json() as {snapshot_date:string}[])[0]?.snapshot_date;
  const present = new Set(members.map(r=>r.player_id));
  const absent = people.flatMap(p=>{const old=p.last[0]; if(present.has(p.id)||!old)return [];const {snapshot:seen,...row}=old;return [{...row,presence:absenceStatus(seen.snapshot_date,lastComplete),data_date:seen.snapshot_date}];});
  return reply({ snapshots: visible, snapshot, snapshot_count:members.length, members:[...members.map(r=>({...r,presence:"present",data_date:snapshot.snapshot_date})),...absent], next: !date && snapshots.length > 100 ? visible.at(-1)!.snapshot_date : null });
}
