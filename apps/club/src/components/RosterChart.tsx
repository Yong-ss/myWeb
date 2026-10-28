"use client";
import {useId,useState} from 'react';
type Count={date:string;value:number};
/** Lines connect actual observations; no missing date is filled with a synthetic count. */
export function RosterChart({counts,loading=false}:{counts:Count[];loading?:boolean}){
 const id=useId(),[active,setActive]=useState<string|null>(null);
 const peak=Math.max(1,...counts.map(r=>r.value));
 const step=Math.max(1,Math.pow(10,Math.floor(Math.log10(peak)))/4);
 const max=Math.ceil(peak*1.15/(step*4))*step*4;
 const points=counts.map((row,i)=>({...row,x:counts.length===1?50:5+i/(counts.length-1)*90,y:100-row.value/max*100}));
 const selected=points.find(p=>p.date===active);
 const line=points.map((p,i)=>i===0?`M${p.x*10} ${p.y}`:`C${(points[i-1].x+p.x)*5} ${points[i-1].y} ${(points[i-1].x+p.x)*5} ${p.y} ${p.x*10} ${p.y}`).join(' ');
 return <figure className="club-roster-chart" aria-label="人数总览趋势图" aria-busy={loading} onKeyDown={e=>{if(e.key==='Escape')setActive(null);}}>
  <div className="club-chart-legend"><span><i aria-hidden="true"/>记录人数</span><span>单位：人</span></div>
  <div className="club-chart-body">
   <div className="club-chart-axis" aria-hidden="true">{[1,.75,.5,.25,0].map(t=><span key={t}>{counts.length?new Intl.NumberFormat('zh-CN',{maximumFractionDigits:1}).format(max*t):'—'}</span>)}</div>
   <div className="club-chart-plot" onPointerLeave={e=>{if(e.pointerType==='mouse')setActive(null);}} onPointerMove={e=>{
    if(e.pointerType!=='mouse'||!points.length)return;const box=e.currentTarget.getBoundingClientRect(),x=(e.clientX-box.left)/box.width*100;
    setActive(points.reduce((best,p)=>Math.abs(p.x-x)<Math.abs(best.x-x)?p:best).date);
   }}>
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop className="club-chart-fill-start" offset="0%"/><stop className="club-chart-fill-end" offset="100%"/></linearGradient></defs>
     <path className="club-chart-grid" d="M0 0H1000M0 25H1000M0 50H1000M0 75H1000M0 100H1000"/>
     {points.length>1&&<><path d={`${line} L${points.at(-1)!.x*10} 100 L${points[0].x*10} 100 Z`} fill={`url(#${id})`}/><path className="club-chart-line" d={line}/></>}
    </svg>
    {selected&&<span className="club-chart-crosshair" style={{left:`${selected.x}%`}} aria-hidden="true"/>}
    {points.map(p=><button type="button" key={p.date} className="club-chart-point" data-active={p.date===active} style={{left:`${p.x}%`,top:`${p.y}%`}} aria-label={`${p.date}，记录人数 ${p.value} 人`} aria-describedby={p.date===active?`${id}-tooltip`:undefined} onFocus={()=>setActive(p.date)} onBlur={()=>setActive(null)} onClick={()=>setActive(p.date)}><span aria-hidden="true"/></button>)}
    {selected&&<div className="club-chart-tooltip" id={`${id}-tooltip`} role="tooltip" style={selected.y<50?{bottom:12}:{top:12}}><span>{selected.date}</span><strong><i aria-hidden="true"/>记录人数 <b>{selected.value}</b> 人</strong></div>}
    {!counts.length&&<span className="club-chart-placeholder" role="status">{loading?'正在读取人数…':'暂无人数记录'}</span>}
   </div>
   <figcaption>{counts.length?counts.map(p=><span key={p.date}>{p.date}</span>):<span>—</span>}</figcaption>
  </div>
 </figure>;
}
