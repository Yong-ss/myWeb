import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleMembers} from './members.ts';
import {handleRequest} from './index.ts';
test('score history is authenticated, tenant-scoped, bounded and uses only active non-deleted daily rows',async()=>{
 const request=new Request('https://club.invalid/api/members?trend=1&before=2026-10-30');let calls=0;
 const response=await handleMembers(request,'club',async(path,body)=>{
  calls++;assert.equal(body,undefined);const q=new URL(`https://db.invalid/${path}`).searchParams;
  for(const [key,value] of Object.entries({club_id:'eq.club','rows.club_id':'eq.club',is_current:'eq.true',deleted_at:'is.null',limit:'31','rows.limit':'201',snapshot_date:'lt.2026-10-30'}))assert.equal(q.get(key),value);
  return Response.json([{snapshot_date:'2026-10-29',is_complete_roster:true,rows:[{extraordinary_score:100},{extraordinary_score:20}]},{snapshot_date:'2026-10-28',is_complete_roster:false,rows:[{extraordinary_score:200},{extraordinary_score:null}]}]);
 });
 const data=await response.json();assert.equal(calls,1);assert.equal(data.points[0].score,120);assert.equal(data.points[1].score,200);assert.equal(data.points[1].partial,true);assert.equal(data.points[1].missing,1);
 const auth=await handleRequest(request,{CLUB_ID:'club',SUPABASE_URL:'https://db.invalid',SUPABASE_PUBLISHABLE_KEY:'public'},async()=>{throw Error('no unauthenticated database calls');});assert.equal(auth.status,401);
});
test('history rejects invalid parameters and excessive member counts explicitly',async()=>{
 assert.equal((await handleMembers(new Request('https://club.invalid/api/members?trend=1&date=bad'),'club',async()=>{throw Error('must not call');})).status,400);
 const result=await handleMembers(new Request('https://club.invalid/api/members?trend=1'),'club',async()=>Response.json([{rows:Array.from({length:201},()=>({extraordinary_score:1}))}]));assert.equal(result.status,413);
});
