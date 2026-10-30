import {reply,type Rest} from './http.ts';
export async function scoreHistory(club:string,rest:Rest,before:string|null){
 const query=new URLSearchParams({select:'id,snapshot_date,revision,is_complete_roster,is_current,rows:club_snapshot_players(extraordinary_score)',club_id:`eq.${club}`,is_current:'eq.true',deleted_at:'is.null',order:'snapshot_date.desc',limit:'31','rows.club_id':`eq.${club}`,'rows.limit':'201'});
 if(before)query.set('snapshot_date',`lt.${before}`);
 const response=await rest(`club_snapshots?${query}`);
 if(!response.ok)return reply({error:'评分历史读取失败，请重试'},502);
 const snapshots=await response.json() as {id:string;revision:number;snapshot_date:string;is_current:boolean;is_complete_roster:boolean;rows:{extraordinary_score:number|null}[]}[];
 if(!Array.isArray(snapshots)||snapshots.some(s=>!Array.isArray(s.rows)||s.rows.length>200))return reply({error:'评分历史超出读取上限'},413);
 return reply({points:snapshots.slice(0,30).map(s=>{
  const scores=s.rows.map(r=>r.extraordinary_score).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n));
  const missing=s.rows.length-scores.length;
  return {date:s.snapshot_date,snapshotId:s.id,revision:s.revision,score:missing&&scores.length===0?null:scores.reduce((a,b)=>a+b,0),missing,partial:missing>0||!s.is_complete_roster};
 }),next:snapshots.length>30?snapshots[29].snapshot_date:null});
}
