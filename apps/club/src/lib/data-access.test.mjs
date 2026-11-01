import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDataAccess} from './data-access.ts';
test('private cache deduplicates, validates every reuse, isolates identity and invalidates writes',async()=>{
 let scope='a:club1',allowed=true,calls=0,clock=0;
 const client=createDataAccess(async path=>{
  if(path==='/api/account')return Response.json({}, {status:allowed?200:403,headers:{'X-Club-Scope':scope}});
  calls++;await new Promise(r=>setTimeout(r,1));return Response.json({calls},{headers:{'X-Club-Scope':scope}});
 },()=>clock);
 const pair=await Promise.all([client.read('/api/members'),client.read('/api/members')]);
 assert.equal(calls,1);assert.deepEqual(await pair[0].json(),await pair[1].json());
 await client.read('/api/members');assert.equal(calls,1);
 scope='b:club2';await client.read('/api/members');assert.equal(calls,2);
 allowed=false;assert.equal((await client.read('/api/members')).status,403);
 allowed=true;await client.read('/api/members');assert.equal(calls,3);
 clock=31000;await client.read('/api/members');assert.equal(calls,4);
 await client.read('/api/imports',{method:'POST'});await client.read('/api/members');assert.equal(calls,6);
});
test('a response from before logout cannot repopulate the cache',async()=>{
 let release;const client=createDataAccess(()=>new Promise(r=>{release=r;}));
 const pending=client.read('/api/members');client.clear();release(Response.json({old:true},{headers:{'X-Club-Scope':'old:club'}}));assert.equal((await pending).status,409);
 // A new network operation must start, rather than reusing the old data.
 let resolved=false;const next=client.read('/api/members').then(()=>{resolved=true;});await Promise.resolve();assert.equal(resolved,false);release(Response.json({new:true}));await next;
});
test('stale reuse verifies permission then refreshes in the background',async()=>{
 let clock=0,value=1,updates=0;
 const client=createDataAccess(async path=>Response.json(path==='/api/account'?{}:{value},{headers:{'X-Club-Scope':'owner:club'}}),()=>clock,()=>updates++);
 await client.read('/api/members');clock=6000;value=2;
 assert.equal((await (await client.read('/api/members')).json()).value,1);
 await new Promise(r=>setTimeout(r,0));assert.equal(updates,1);
 assert.equal((await (await client.read('/api/members')).json()).value,2);
});
// A user without club permission loads a page that reads members and the club name together: both are refused, and
// each must show the server's refusal, not a misleading "data changed, retry" caused by the other refusal clearing the cache.
test('concurrent permission denials both surface as denials',async()=>{
 const client=createDataAccess(async()=>{await new Promise(r=>setTimeout(r,1));return Response.json({error:'此账户没有权限执行这个操作'},{status:403});});
 const results=await Promise.all([client.read('/api/members'),client.read('/api/club-settings')]);
 assert.deepEqual(results.map(r=>r.status),[403,403]);
});
