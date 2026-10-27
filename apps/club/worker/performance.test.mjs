import {test} from 'node:test';import assert from 'node:assert/strict';
import {handleMembers} from './members.ts';
import {instrument} from './timing.ts';
test('timing leaves WebSocket upgrades untouched',()=>{
 const upgrade={status:101};
 assert.equal(instrument(fetch).finish(upgrade),upgrade);
});
test('timing safely wraps immutable proxy headers and preserves the response',async()=>{
 const original=await fetch('data:text/plain,local-page');
 assert.throws(()=>original.headers.set('Server-Timing','test'));
 const result=instrument(fetch).finish(original);
 assert.equal(result.status,200);assert.equal(await result.text(),'local-page');
 assert.equal(result.headers.get('content-type'),original.headers.get('content-type'));
 assert.match(result.headers.get('Server-Timing'),/worker;dur=/);
});
test('request diagnostics contain durations and counts without URLs or credentials',async()=>{
 const metrics=instrument(async()=>Response.json({}));
 await metrics.fetcher('https://private.invalid/auth/v1/user',{headers:{Authorization:'private-token'}});
 const timing=metrics.finish(Response.json({})).headers.get('server-timing');
 assert.match(timing,/auth;dur=.*1 calls/);assert.doesNotMatch(timing,/private|https|token/);
});
test('roster dependent reads run together with a fixed four-query budget',async()=>{
 let calls=0,active=0,peak=0;
 const response=await handleMembers(new Request('https://local.invalid/api/members'),'club',async path=>{
  calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;
  return Response.json(path.startsWith('club_snapshots?')?[{id:'snapshot',snapshot_date:'2030-01-01',is_current:true}]:[]);
 });
 assert.equal(response.status,200);assert.equal(calls,4);assert.equal(peak,3);
});
