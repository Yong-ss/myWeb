import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMembers } from './members.ts';
import { handleRequest } from './index.ts';
const club='00000000-0000-4000-8000-000000000001';
const snapshot={id:club,snapshot_date:'2026-10-27',revision:2,is_current:true,is_complete_roster:false};
const request=query=>new Request(`https://club.example/api/members${query}`);
test('member reads require Club authentication, not main-site cookies',async()=>{
  for(const cookie of ['', 'sq_access=access']) {
    const response=await handleRequest(new Request(request('').url,{headers:{Cookie:cookie}}),{CLUB_ID:club,SUPABASE_URL:'https://local.invalid',SUPABASE_PUBLISHABLE_KEY:'public'},async()=>{throw Error('must not read database');});
    assert.equal(response.status,401);
  }
});
test('history selection stays inside configured club and makes no writes',async()=>{
  const response=await handleMembers(request(`?date=2026-10-27&version=${club}&club_id=other`),club,async(path,body)=>{
    if(path==='rpc/club_roster_presence'){assert.deepEqual(body,{p_club:club,p_snapshot:club});return Response.json({members:[{player_id:club,name:'旧昵称',weekly_activity:0,level:null}],snapshot_count:1});}
    assert.equal(body,undefined);
    assert.equal(new URL(`https://local.invalid/${path}`).searchParams.get('club_id'),`eq.${club}`);
    return Response.json(path.startsWith('club_players?')?[]:path.startsWith('club_snapshots?')?[{...snapshot,is_current:false}]:[{player_id:club,name:'旧昵称',weekly_activity:0,level:null}]);
  });
  const result=await response.json();
  assert.equal(result.snapshot.is_current,false); assert.equal(result.members[0].weekly_activity,0); assert.equal(result.members[0].level,null);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('invalid and foreign versions never cause unscoped row reads',async()=>{
  const invalid=await handleMembers(request('?date=bad'),club,async()=>{throw Error('unexpected read');}); assert.equal(invalid.status,400);
  const missing=await handleMembers(request(`?date=2026-10-27&version=${club}`),club,async path=>{assert.ok(path.startsWith('club_snapshots?'));return Response.json([]);}); assert.equal(missing.status,404);
});
test('date history paginates and oversized rosters fail instead of truncating',async()=>{
  const page=await handleMembers(request(''),club,async path=>Response.json(path.startsWith('club_snapshots?')?Array(101).fill(snapshot):{members:[],snapshot_count:0}));
  assert.equal((await page.json()).next,'2026-10-27');
  const response=await handleMembers(request(''),club,async path=>path.startsWith('rpc/')?Response.json({code:'54000',message:'名单超过查询上限'},{status:400}):Response.json([snapshot])); assert.equal(response.status,413);
});
