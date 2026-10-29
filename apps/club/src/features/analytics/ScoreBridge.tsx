import type {scoreGrowth} from "./score-growth";
import {signed} from "./insights";
/** Waterfall of the total change: each step starts where the previous one ended; the last bar is the result from zero. */
export function ScoreBridge({data}:{data:ReturnType<typeof scoreGrowth>}){
 const steps=[['共同成员评分成长',data.netGrowth],['只在结束日期出现',data.endingOnly],['只在开始日期出现',-data.startingOnly]] as const;
 let run=0;
 const bars=[...steps.map(([label,value])=>{const from=run;run+=value;return {label,value,from,to:run,total:false};}),{label:'俱乐部总评分变化',value:data.totalChange,from:0,to:data.totalChange,total:true}];
 const lo=Math.min(0,...bars.map(b=>Math.min(b.from,b.to))),hi=Math.max(0,...bars.map(b=>Math.max(b.from,b.to))),span=hi-lo||1;
 const x=(n:number)=>(n-lo)/span*100;
 return <figure className="m-0 grid gap-2" aria-label="评分变化构成图">
  {bars.map(b=><div key={b.label} className={`grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_4.5rem] items-center gap-3 text-xs max-sm:grid-cols-[minmax(0,6rem)_minmax(0,1fr)_4rem] ${b.total?'border-t border-divider pt-2 font-medium':''}`}>
   <span className={b.total?'text-foreground':'text-muted-foreground'}>{b.label}</span>
   <div className="relative h-4" aria-hidden="true">
    <span className="absolute inset-y-[-4px] w-px bg-brass" style={{left:`${x(0)}%`}}/>
    {b.value!==0&&<span className={`absolute inset-y-0 rounded-[1px] ${b.total?'bg-gold':b.value<0?'bg-destructive':'bg-success'}`} style={{left:`${x(Math.min(b.from,b.to))}%`,width:`max(2px,${Math.abs(b.value)/span*100}%)`}}/>}
   </div>
   <span className={`text-right tabular-nums ${b.total?'text-gold':''}`}>{signed(b.value)}</span>
  </div>)}
  <figcaption className="text-xs text-muted-foreground">竖线为 0；绿色增加，红色减少，金色为合计。{!data.exact&&'仅含已知评分。'}</figcaption>
 </figure>;
}
