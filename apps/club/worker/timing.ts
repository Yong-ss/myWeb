/** Request-local metrics: no cookies, SQL, identities or tokens in diagnostics. */
export function instrument(fetcher: typeof fetch) {
  const started = performance.now();
  const totals = new Map<string, {duration:number;count:number}>();
  const measured: typeof fetch = async (input, init) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    const label = path.includes('/auth/') ? 'auth' : path.endsWith('/club_memberships') ? 'membership' : 'database';
    const begin = performance.now();
    try { return await fetcher(input, init); }
    finally { const old=totals.get(label)??{duration:0,count:0};old.duration+=performance.now()-begin;old.count++;totals.set(label,old); }
  };
  return {fetcher:measured, finish(response:Response){
    // A WebSocket upgrade owns its socket; reconstructing it drops the upgrade.
    if(response.status===101)return response;
    // Asset/proxy fetch responses can have immutable headers in workerd.
    // Wrap the stream without reading or buffering its body.
    const result=new Response(response.body,{status:response.status,statusText:response.statusText,headers:new Headers(response.headers)});
    result.headers.set('Server-Timing',[...totals].map(([label,value])=>`${label};dur=${value.duration.toFixed(1)};desc="${value.count} calls"`).concat(`worker;dur=${(performance.now()-started).toFixed(1)}`).join(', '));
    return result;
  }};
}
