import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from './index.ts';
const club='00000000-0000-4000-8000-000000000001';
const env={CLUB_ID:club,SUPABASE_URL:'https://local.invalid',SUPABASE_PUBLISHABLE_KEY:'local'};
const req=(path,data)=>new Request('https://club.test/api/'+path,{method:data?'POST':'GET',headers:{Cookie:'__Host-club_access=test',Origin:'https://club.test','Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
test('delete and log routes enforce session, origin, bounded input and server tenant',async()=>{
 const calls=[];
 const network=async(url,init)=>{
  if(url.includes('/auth/'))return Response.json({id:club,email_confirmed_at:'2026-01-01'});
  if(url.includes('club_my_access'))return Response.json({permissions:['audit.read','imports.delete'],roles:['admin'],super_admin:false,super_admin_active:false});
  calls.push([url,JSON.parse(init.body)]);return Response.json({deleted:true,events:[],next:null});
 };
 assert.equal((await handleRequest(new Request('https://club.test/api/activity'),env,async()=>Response.json({}))).status,401);
 assert.equal((await handleRequest(req('delete-import',{date:'bad'}),env,network)).status,400);
 assert.equal((await handleRequest(req('activity?before=bad&id=bad'),env,network)).status,400);
 assert.equal(calls.length,0);
 assert.equal((await handleRequest(req('delete-import',{date:'2026-10-28',expected_snapshot_id:club,confirmed:true,club_id:'forged'}),env,network)).status,200);
 assert.equal(calls[0][1].p_club_id,club);
 assert.equal((await handleRequest(req('delete-import',{date:'2026-10-28',expected_snapshot_id:club,confirmed:true,padding:'x'.repeat(3000)}),env,network)).status,413);
 const cross=req('delete-import',{});cross.headers.set('Origin','https://other.test');assert.equal((await handleRequest(cross,env,network)).status,403);
 await handleRequest(req('activity'),env,network);assert.match(calls.at(-1)[0],/rpc\/club_activity$/);
 const conflict=async(url,init)=>url.includes('/rpc/')&&!url.includes('club_my_access')?Response.json({code:'PT409',message:'当天数据已变化'},{status:409}):network(url,init);
 assert.equal((await handleRequest(req('delete-import',{date:'2026-10-28',expected_snapshot_id:club,confirmed:true}),env,conflict)).status,409);
});
