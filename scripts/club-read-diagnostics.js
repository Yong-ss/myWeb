/* Run in the logged-in Club browser console. Read-only; no credentials/data printed. */
async function clubReadDiagnostics(samples=5) {
 if(!['https://club.squirrelapi.org','https://127.0.0.1:8788'].includes(location.origin))throw Error('Only Club origins allowed');
 if(!Number.isInteger(samples)||samples<1||samples>20)throw Error('Use 1–20 samples');
 const current=new URLSearchParams(location.search),player=current.get('id');
 const urls=['/api/account','/api/club-settings','/api/members'];
 if(player&&/^[a-f0-9-]{36}$/i.test(player))urls.push('/api/members?'+new URLSearchParams({player,paged:'1'}));
 const report=[];
 for(const path of urls){const values=[];
  for(let i=0;i<samples;i++){
   const start=performance.now();const response=await fetch(path,{cache:'no-store',redirect:'error'});
   const bytes=(await response.arrayBuffer()).byteLength;
   const timing=performance.getEntriesByName(new URL(path,location.origin).href).at(-1);
   values.push({status:response.status,ms:+(performance.now()-start).toFixed(1),ttfb:timing?+(timing.responseStart-timing.requestStart).toFixed(1):null,bytes,serverTiming:response.headers.get('server-timing')});
   if(!response.ok)break;
  }
  const sorted=values.map(v=>v.ms).sort((a,b)=>a-b);
  report.push({endpoint:path.includes('player=')?'player-history':path,first:values[0],warm:values.slice(1),p50:sorted[Math.ceil(sorted.length*.5)-1],p95:values.length>=20?sorted[Math.ceil(sorted.length*.95)-1]:null});
 }
 console.log(JSON.stringify({at:new Date().toISOString(),origin:location.origin,note:'First observed request is not proof of a cold server/database',report},null,2));
 return report;
}
