import type {scoreGrowth} from "./score-growth";
export function ScoreBridge({data}:{data:ReturnType<typeof scoreGrowth>}){
 const contributions=[['既有成员成长',data.netGrowth],['仅结束日期出现',data.endingOnly],['仅起始日期出现',-data.startingOnly]] as const;
 const scale=Math.max(1,...contributions.map(([,value])=>Math.abs(value)));
 return <figure className="m-0 grid gap-3" aria-label="评分变化贡献图">
  <figcaption className="text-xs text-muted-foreground">既有成员成长与名单构成贡献{!data.exact?'（已知评分，无法精确对账）':''}</figcaption>
  {contributions.map(([label,value])=><div key={label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-xs"><span>{label}</span><div className="relative h-3 border-l border-border bg-field"><span className={`absolute inset-y-0 left-0 ${value<0?'bg-destructive':'bg-success'}`} style={{width:`${Math.abs(value)/scale*100}%`}}/></div><span className="min-w-16 text-right tabular-nums">{value>0?'+':''}{value===0?'0':value.toLocaleString()}</span></div>)}
 </figure>;
}
