import {test} from 'node:test';import assert from 'node:assert/strict';import {handleSettings} from './settings.ts';
const club='00000000-0000-4000-8000-000000000001';
const request=body=>new Request('https://club.example/api/club-settings',{method:'POST',body:JSON.stringify(body)});
test('admins cannot rename, invalid names fail before RPC, and tenant comes from server',async()=>{
 assert.equal((await handleSettings(request({name:'x'}),club,'admin',()=>{throw Error('unexpected');})).status,403);
 assert.equal((await handleSettings(request({name:' ',expected_name:'old'}),club,'owner',()=>{throw Error('unexpected');})).status,400);
 const response=await handleSettings(request({name:' 新名字 ',expected_name:'old',club_id:'forged'}),club,'owner',async(path,body)=>{assert.equal(path,'rpc/club_rename');assert.deepEqual(body,{p_club_id:club,p_name:'新名字',p_expected:'old'});return Response.json({name:'新名字'});});assert.equal(response.status,200);
});
