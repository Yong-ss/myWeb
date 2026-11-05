"use client";
import {useState,type ReactNode} from 'react';
import {groupScores,scoreDifference,type ScorePoint,type Granularity} from '../lib/score-history';
import {scoreCurve} from '../lib/score-curve';
import {NativeSelect,NativeSelectOption} from './ui/native-select';
import {Field,FieldLabel} from './ui/field';
import {Tooltip,TooltipTrigger,TooltipContent} from './ui/tooltip';
export const scoreText=(score:number|null)=>score===null?'评分缺失':score.toLocaleString('zh-CN');
export function ScoreTrend({title,points,unit,onUnit,onSelect,selected,info,onInspect,showSummary=true}:{title:string;points:ScorePoint[];unit:Granularity;onUnit:(unit:Granularity)=>void;onSelect?:(point:ScorePoint,previous?:ScorePoint)=>void;selected?:string;showSummary?:boolean;onInspect?:(point:ScorePoint,previous?:ScorePoint)=>void;info?:(point:ScorePoint,previous?:ScorePoint)=>ReactNode}){
 const shown=groupScores(points,unit),[active,setActive]=useState(''),[look,setLook]=useState('');
 const values=shown.flatMap(p=>p.score===null?[]:[p.score]);
 const low=values.length?Math.min(...values):0,high=values.length?Math.max(...values):1;
 const padding=Math.max((high-low)*.15,1),min=Math.max(0,low-padding),max=high+padding;
 const compact=new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1});
 const axisText=(value:number)=>compact.format(max)===compact.format(min)?Math.round(value).toLocaleString('zh-CN'):compact.format(value);
 const first=Date.parse(shown[0]?.date??'2000-01-01'),last=Date.parse(shown.at(-1)?.date??'2000-01-01');
 const left=5;
 const x=(p:ScorePoint)=>last===first?50:left+(Date.parse(p.date)-first)/(last-first)*(95-left);
 const y=(p:ScorePoint)=>95-((p.score??min)-min)/(max-min)*90;
 const path=scoreCurve(shown.map(p=>p.score===null?null:{x:x(p),y:y(p)}));
 return <section className="grid min-w-0 gap-4" aria-label={title}>
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="m-0 text-lg">{title}</h2><Field orientation="horizontal"><FieldLabel htmlFor={title}>查看周期</FieldLabel><NativeSelect id={title} className="w-auto" value={unit} onChange={e=>onUnit(e.target.value as Granularity)}>{[['day','每日'],['week','每周'],['month','每月'],['year','每年']].map(([value,label])=><NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}</NativeSelect></Field></div>
  {!shown.length?<p className="py-12 text-sm text-muted-foreground">暂无实际评分记录。</p>:<>
   <div className="relative h-64" role="group" aria-label={`${title}图表`}>
    <span className="absolute left-0 top-0 text-xs text-muted-foreground">{axisText(max)}</span>
    <span className="absolute bottom-8 left-0 text-xs text-muted-foreground">{axisText(min)}</span>
    <div className="absolute inset-y-4 bottom-8 left-16 right-3">
     <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="size-full overflow-visible" aria-hidden="true">
      {[5,50,95].map(n=><line key={n} x1="0" x2="100" y1={n} y2={n} stroke="var(--club-divider)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="3 5"/>)}
      <path d={path} fill="none" stroke="var(--club-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
     </svg>
     {shown.map((p,i)=><Tooltip key={p.date} delay={0} open={active===p.date&&selected!==p.date} onOpenChange={open=>setActive(current=>open?p.date:current===p.date?'':current)}><TooltipTrigger asChild><button type="button" aria-label={`${p.date}，${scoreText(p.score)}${p.partial?'，资料不完整':''}`} aria-pressed={selected===p.date} onMouseEnter={()=>{setLook(p.date);onInspect?.(p,shown[i-1]);}} onFocus={()=>{setLook(p.date);onInspect?.(p,shown[i-1]);}} onClick={()=>{setLook(p.date);if(onSelect)onSelect(p,shown[i-1]);else setActive(p.date);}} data-active={active===p.date||selected===p.date} className="group/point absolute grid size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-sm bg-transparent focus-visible:outline-2 focus-visible:outline-ring" style={{left:`${x(p)}%`,top:`${p.score===null?95:y(p)}%`}}><span aria-hidden="true" className="pointer-events-none absolute size-6 scale-75 rounded-full border border-gold opacity-0 transition-[opacity,transform] ease-club-feedback group-hover/point:scale-100 group-hover/point:opacity-100 group-focus-visible/point:scale-100 group-focus-visible/point:opacity-100 group-data-[active=true]/point:scale-100 group-data-[active=true]/point:opacity-100 motion-reduce:transition-none"/><span aria-hidden="true" className={`pointer-events-none size-2.5 rounded-full border border-gold transition-[transform,background-color] ease-club-feedback group-hover/point:scale-125 group-focus-visible/point:scale-125 group-active/point:scale-90 motion-reduce:transition-none ${p.score===null||p.partial?'bg-card':active===p.date||selected===p.date?'bg-foreground':'bg-gold'}`}/></button></TooltipTrigger><TooltipContent side="top" align="center" className="w-80 max-w-[calc(100vw-2rem)] rounded-none px-4 py-4 text-sm">
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground"><span>{p.date}</span><span>评分</span></div>
          <strong className="font-heading text-3xl font-medium leading-none text-gold tabular-nums">{scoreText(p.score)}</strong>
          {(()=>{const previous=shown[i-1],diff=scoreDifference(previous,p);return previous?<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className={diff===null?'text-muted-foreground':diff>0?'font-medium text-success':diff<0?'font-medium text-destructive':'text-muted-foreground'}>{diff===null?'资料不完整，暂不比较':`${diff>0?'↑ +':diff<0?'↓ −':''}${Math.abs(diff).toLocaleString('zh-CN')}`}</span>
            <span className="text-xs text-muted-foreground">对比 {previous.date}</span>
          </div>:<p className="m-0 text-xs text-muted-foreground">首次已加载记录，无更早对比</p>;})()}
          {p.partial&&<p className="m-0 text-xs text-muted-foreground">部分资料 · {p.missing?`缺失评分 ${p.missing} 人`:'名单未确认完整'}</p>}
          {info?.(p,shown[i-1])}
        </div>
      </TooltipContent></Tooltip>)}
    </div>
    <div className="absolute bottom-0 left-16 right-3 flex justify-between gap-2 text-xs text-muted-foreground"><span>{shown[0].date}</span>{shown.length>1&&<span>{shown.at(-1)!.date}</span>}</div>
   </div>
   {showSummary&&(()=>{
    // The summary follows the inspected point (latest by default); "significant" = the largest single change between neighbouring points.
    const at=Math.max(0,shown.findIndex(p=>p.date===look)<0?shown.length-1:shown.findIndex(p=>p.date===look)),cur=shown[at],prev=shown[at-1];
    const diff=scoreDifference(prev,cur),steps=shown.flatMap((p,i)=>{const d=scoreDifference(shown[i-1],p);return d===null?[]:[Math.abs(d)];});
    return <div className="grid gap-1 text-sm" aria-live="polite"><span>{cur.date}：{prev?(diff===null?`对比 ${prev.date}：资料没录全，暂时没法比较`:`对比 ${prev.date}：${diff>0?'+':''}${diff.toLocaleString('zh-CN')}`):'这是最早的记录'}{diff!==null&&diff!==0&&Math.abs(diff)===Math.max(...steps)&&<strong className="ml-2 font-medium text-gold">显著评分变化</strong>}</span>{info?.(cur,prev)}</div>;
   })()}
  </>}
 </section>;
}
