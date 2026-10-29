import type {scoreGrowth} from "./score-growth";
type Growth=ReturnType<typeof scoreGrowth>;
export const signed=(n:number)=>`${n>0?'+':''}${n.toLocaleString('zh-CN')}`;

/** One plain-language sentence explaining a growth result; only states what the numbers show. */
export function growthSentence(g:Growth){
 if(!g.rows.length)return '两个日期之间没有都有评分的共同成员，暂时无法比较成长。';
 const net=g.netGrowth,total=g.totalChange,roster=g.endingOnly-g.startingOnly;
 const s=net>0&&total<0?'共同成员整体变强，但俱乐部总评分下降，主要受到成员名单变化影响。'
  :net<0&&total>0?'共同成员评分整体下降，总评分上升主要来自成员名单变化。'
  :net>0?`共同成员整体变强，评分合计 ${signed(net)}。`
  :net<0?`共同成员评分合计下降 ${net.toLocaleString('zh-CN')}。`
  :roster?'共同成员评分没有变化，总评分变化来自成员名单变化。':'共同成员评分没有变化。';
 return g.exact?s:`${s}部分名单或评分不完整，只按已知数据计算。`;
}

export type Insight={text:string;tone:'warning'|'neutral';href?:string;action?:string};
/** Short, data-grounded notes for the overview. Never claims joins/departures; missing data is stated as missing. */
export function clubInsights({complete,hasPrior,comparing,comparisonError,growth,from,to}:{complete:boolean;hasPrior:boolean;comparing:boolean;comparisonError:boolean;growth:Growth|null;from?:string;to?:string}):Insight[]{
 const out:Insight[]=[];
 if(!complete)out.push({text:'最新名单未确认完整，部分成员状态需要核实。',tone:'warning',href:'/members',action:'查看成员'});
 if(!hasPrior)out.push({text:'目前只有一次记录，还没有足够的历史来比较成长。',tone:'neutral'});
 else if(comparisonError)out.push({text:'最近一次对比暂时读取失败，稍后可重试。',tone:'warning'});
 else if(growth)out.push({text:growthSentence(growth),tone:'neutral',href:`/analytics?${new URLSearchParams({view:'growth',from:from??'',to:to??''})}`,action:'查看成长原因'});
 else if(comparing)out.push({text:'正在读取最近对比…',tone:'neutral'});
 return out;
}
