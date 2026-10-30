type Coordinate={x:number;y:number};
/** Shape-preserving cubic curves: pass through observations without overshooting, and break at nulls. */
export function scoreCurve(points:(Coordinate|null)[]):string {
 const segments:Coordinate[][]=[];
 for(const point of points){
  if(!point){if(segments.at(-1)?.length)segments.push([]);continue;}
  if(!segments.length)segments.push([]);
  segments[segments.length-1].push(point);
 }
 return segments.filter(segment=>segment.length).map(segment=>{
  const slopes=segment.slice(1).map((p,i)=>(p.y-segment[i].y)/(p.x-segment[i].x));
  const tangents=segment.map((_,i)=>{
   if(i===0||i===segment.length-1)return 0;
   const before=slopes[i-1],after=slopes[i];
   return before*after<=0?0:2/(1/before+1/after);
  });
  return `M${segment[0].x} ${segment[0].y} `+segment.slice(1).map((p,i)=>{
   const previous=segment[i],step=(p.x-previous.x)/3;
   return `C${previous.x+step} ${previous.y+tangents[i]*step} ${p.x-step} ${p.y-tangents[i+1]*step} ${p.x} ${p.y}`;
  }).join(' ');
 }).join(' ');
}
