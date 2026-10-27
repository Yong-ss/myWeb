import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleImport } from './imports.ts';
import { handleRequest } from './index.ts';

const club='00000000-0000-4000-8000-000000000001';
const row={name:'玩家甲',position:null,level:1,pathway:null,extraordinary_score:0,prosperity:null,weekly_activity:null,group:null,join_days:null,player_id:null};
const payload={snapshot_date:'2026-10-27',is_complete_roster:false,mode:'replace',members:[row],raw_text:'{}',request_id:club,expected_snapshot_id:null,confirmed:true};
const request=body=>new Request('https://club.example/api/imports',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://club.example'},body:JSON.stringify(body)});
test('imports require authenticated club membership and same origin',async()=>{
  const env={CLUB_ID:club,SUPABASE_URL:'https://auth.example',SUPABASE_PUBLISHABLE_KEY:'public'};
  assert.equal((await handleRequest(request(payload),env)).status,401);
  const cross=new Request(request(payload),{headers:{Origin:'https://evil.example','Content-Type':'application/json'}});
  assert.equal((await handleRequest(cross,env)).status,403);
});
test('submission validates identities and ignores client-supplied club identity',async()=>{
  let called=0;
  const rest=async(path,body)=>{called++;assert.equal(path,'rpc/club_commit_import');assert.equal(body.p_club_id,club);return Response.json({revision:1});};
  assert.equal((await handleImport(request({...payload,club_id:'evil'}),club,rest)).status,200);
  assert.equal(called,1);
  for(const invalid of [{...payload,confirmed:false},{...payload,snapshot_date:'2026-02-30'},{...payload,members:[{...row,player_id:''}]},{...payload,members:[{...row,level:'1'}]}]) assert.equal((await handleImport(request(invalid),club,rest)).status,400);
  assert.equal(called,1);
});
test('concurrent revisions return actionable conflict and do not mask database errors',async()=>{
  for(const [code,status] of [['PT409',409],['42501',403],['22023',400],['23505',502]]) {
    const response=await handleImport(request(payload),club,async()=>Response.json({code,message:'test'},{status:400}));
    assert.equal(response.status,status);
  }
});
test('context uses tenant filters, preserves null and rejects truncated players',async()=>{
  const req=new Request('https://club.example/api/import-context?date=2026-10-27');
  const response=await handleImport(req,club,async path=>{
    assert.ok(path.includes(`club_id=eq.${club}`));
    if(path.startsWith('club_players?')) return Response.json([],{headers:{'Content-Range':'*/0'}});
    if(path.startsWith('club_snapshots?')) return Response.json([{id:club,revision:1,is_complete_roster:false}]);
    const {group,...data}=row; return Response.json([{...data,group_name:group}]);
  });
  assert.equal(response.status,200);assert.equal((await response.json()).members[0].group,null);
  const tooMany=await handleImport(req,club,async path=>Response.json([],{headers:path.startsWith('club_players?')?{'Content-Range':'0-999/1001'}:{}}));
  assert.equal(tooMany.status,413);
});
test('oversized bodies and invalid date never reach the database',async()=>{
  const never=()=>{throw Error('database must not be called');};
  assert.equal((await handleImport(request({...payload,raw_text:'x'.repeat(525000)}),club,never)).status,413);
  assert.equal((await handleImport(new Request('https://club.example/api/import-context?date=2026-02-30'),club,never)).status,400);
});
