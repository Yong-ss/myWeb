export type Granularity='day'|'week'|'month'|'year';
export type ScorePoint={date:string;score:number|null;partial:boolean;missing:number;snapshotId?:string;revision?:number};
export function period(date:string,unit:Granularity){
 if(unit==='day')return date;
 if(unit==='year')return date.slice(0,4);
 if(unit==='month')return date.slice(0,7);
 const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return d.toISOString().slice(0,10);
}
export function groupScores(points:readonly ScorePoint[],unit:Granularity){
 const groups=new Map<string,ScorePoint>();
 for(const point of [...points].sort((a,b)=>a.date.localeCompare(b.date)))groups.set(period(point.date,unit),point);
 return [...groups.values()];
}
export function scoreDifference(a?:ScorePoint,b?:ScorePoint){return a&&b&&!a.partial&&!b.partial&&a.score!==null&&b.score!==null?b.score-a.score:null;}
export function referenceDate(date:string,mode:string,dates:string[]){
 let cutoff=date;
 if(mode==='week'){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-7);cutoff=d.toISOString().slice(0,10);}
 if(mode==='month'){const d=new Date(`${date}T00:00:00Z`),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));cutoff=d.toISOString().slice(0,10);}
 return [...dates].filter(d=>d<date&&(mode==='previous'||d<=cutoff)).sort().at(-1)??'';
}
