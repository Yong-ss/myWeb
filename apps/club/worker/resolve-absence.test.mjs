import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveAbsence} from './resolve-absence.ts';
const id='00000000-0000-4000-8000-000000000001';
const request=input=>new Request('https://local.invalid/api/resolve-absence',{method:'POST',body:JSON.stringify(input)});
test('a temporary departure needs a real bounded reason before any database write',async()=>{
 for(const reason of [undefined,' ','x'.repeat(501),'a\u0000b']){
  const response=await resolveAbsence(request({snapshot_id:id,player_id:id,decision:'temporary',reason,confirmed:true}),'club',()=>{throw Error('must not write');});
  assert.equal(response.status,400);
 }
});
test('follow-up decisions use the authenticated club and preserve revision conflict errors',async()=>{
 const response=await resolveAbsence(request({snapshot_id:id,player_id:id,decision:'temporary',reason:'帮忙打活动',confirmed:true}),'trusted-club',async(path,body)=>{
  assert.equal(path,'rpc/club_resolve_absence');assert.equal(body.p_club,'trusted-club');assert.equal(body.p_reason,'帮忙打活动');
  return Response.json({code:'PT409',message:'名单已更新'},{status:400});
 });
 assert.equal(response.status,409);assert.equal((await response.json()).error,'名单已更新');
});
