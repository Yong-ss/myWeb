type Count={date:string;value:number};
/** Two observation dates, not an inferred daily population trend. */
export function RosterChart({counts,loading=false}:{counts:Count[];loading?:boolean}){
 const max=Math.max(1,Math.ceil(Math.max(0,...counts.map(r=>r.value))*1.2));
 const points=counts.map((row,i)=>({...row,x:counts.length===1?82:i===0?18:82,y:100-row.value/max*100}));
 return <figure className="club-roster-chart" aria-label="最近两次记录人数折线图" aria-busy={loading}>
  <div className="club-chart-axis" aria-hidden="true"><span>{counts.length?max:'—'}</span><span>{counts.length?Math.round(max/2):'—'}</span><span>0</span></div>
  <div className="club-chart-plot">
   <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path className="club-chart-grid" d="M0 0H100M0 50H100M0 100H100"/>{points.length>1&&<polyline className="club-chart-line" points={points.map(r=>`${r.x},${r.y}`).join(' ')}/>}</svg>
   {points.map(r=><span key={r.date} className="club-chart-point" style={{left:`${r.x}%`,top:`${r.y}%`}}><strong>{r.value}</strong></span>)}
   {!counts.length&&<span className="club-chart-placeholder" role="status">正在读取人数…</span>}
  </div>
  <figcaption><span>{counts.length>1?counts[0].date:'—'}</span><span>{counts.at(-1)?.date??'—'}</span></figcaption>
 </figure>;
}
