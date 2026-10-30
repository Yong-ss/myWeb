export type ScoreMember={player_id:string;name:string|null;pathway?:string|null;presence?:string;absence_decision?:string|null;absence_reason?:string|null;data_date?:string;extraordinary_score:number|null};
export type ScoreSnapshot={id?:string;snapshot_date:string;revision?:number;is_current?:boolean;is_complete_roster:boolean};
export type ScoreData={snapshot:ScoreSnapshot|null;snapshots:ScoreSnapshot[];members:ScoreMember[];next?:string|null};
export const usableDates=(snapshots:ScoreSnapshot[])=>[...new Set(snapshots.filter(s=>s.is_current!==false).map(s=>s.snapshot_date))].sort().reverse();
export const validComparison=(start:string,end:string)=>Boolean(start&&end&&start<end);
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
export function scoreGrowth(start:ScoreData,end:ScoreData){
 if(!start.snapshot||!end.snapshot||!validComparison(start.snapshot.snapshot_date,end.snapshot.snapshot_date))throw Error('起始日期必须早于结束日期');
 const observed=(data:ScoreData)=>new Map(data.members.filter(r=>r.presence==='present'&&(!r.data_date||r.data_date===data.snapshot!.snapshot_date)).map(r=>[r.player_id,r]));
 const a=observed(start),b=observed(end);
 const rows=[...b.values()].flatMap(row=>{const prior=a.get(row.player_id);if(!prior||!valid(prior.extraordinary_score)||!valid(row.extraordinary_score))return [];
 const difference=row.extraordinary_score-prior.extraordinary_score;
 return [{...row,start:prior.extraordinary_score,end:row.extraordinary_score,difference,percentage:prior.extraordinary_score===0?null:difference/prior.extraordinary_score*100}];
 }).sort((a,b)=>b.difference-a.difference||a.player_id.localeCompare(b.player_id));
 const sum=(rows:ScoreMember[])=>rows.reduce((n,r)=>n+(valid(r.extraordinary_score)?r.extraordinary_score:0),0);
 const missing=(rows:ScoreMember[])=>rows.filter(r=>!valid(r.extraordinary_score)).length;
 const endingOnly=[...b.values()].filter(r=>!a.has(r.player_id)),startingOnly=[...a.values()].filter(r=>!b.has(r.player_id));
 const startMissing=missing([...a.values()]),endMissing=missing([...b.values()]);
 const startTotal=sum([...a.values()]),endTotal=sum([...b.values()]);
 return {rows,startTotal,endTotal,totalChange:endTotal-startTotal,netGrowth:rows.reduce((n,r)=>n+r.difference,0),endingOnly:sum(endingOnly),startingOnly:sum(startingOnly),endingCount:endingOnly.length,startingCount:startingOnly.length,startCount:a.size,endCount:b.size,startMissing,endMissing,exact:!startMissing&&!endMissing&&start.snapshot.is_complete_roster&&end.snapshot.is_complete_roster};
}
