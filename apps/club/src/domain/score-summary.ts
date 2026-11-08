/** Missing scores never count as zero or enter the average denominator. */
export function scoreSummary(values:readonly (number|null)[]){
 const scores=values.filter((n):n is number=>typeof n==='number'&&Number.isFinite(n)).sort((a,b)=>b-a);
 const total=scores.length?scores.reduce((a,b)=>a+b,0):values.length?null:0;
 return {total,top30:scores.length?scores.slice(0,30).reduce((a,b)=>a+b,0):values.length?null:0,average:scores.length?total!/scores.length:null,count:scores.length,missing:values.length-scores.length};
}
