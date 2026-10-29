export type PathwayRow = {presence?: string; pathway?: string | null};
export function pathwayDistribution(rows: readonly PathwayRow[]) {
  const counts=new Map<string|null,number>();
  for(const row of rows)if(row.presence==='present'){
    const name=row.pathway==null||row.pathway===''?null:row.pathway;
    counts.set(name,(counts.get(name)??0)+1);
  }
  const total=[...counts.values()].reduce((sum,n)=>sum+n,0);
  return {total,groups:[...counts].map(([name,count])=>({name,count,percent:count/total*100})).sort((a,b)=>b.count-a.count||(a.name??'').localeCompare(b.name??'','zh-CN'))};
}
export function pathwayMembersHref(name:string|null) {
  const query=new URLSearchParams({presence:'present'});
  if(name===null)query.set('pathway_missing','1');else query.set('pathway',name);
  return `/members?${query}`;
}
