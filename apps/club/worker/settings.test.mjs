import {test} from 'node:test';import assert from 'node:assert/strict';import {handleSettings} from './settings.ts';
const club='00000000-0000-4000-8000-000000000001';
const owner={permissions:['club.rename','members.read'],roles:['owner'],superAdmin:false,superAdminActive:false};
const request=body=>new Request('https://club.example/api/club-settings',{method:'POST',body:JSON.stringify(body)});
// Rename authorization lives in the route table (club.rename) and the database; this handler validates input and scope.
test('invalid names fail before RPC, tenant comes from server, can_edit follows the permission',async()=>{
 assert.equal((await handleSettings(request({name:' ',expected_name:'old'}),club,()=>{throw Error('unexpected');},owner)).status,400);
 const response=await handleSettings(request({name:' 新名字 ',expected_name:'old',club_id:'forged'}),club,async(path,body)=>{assert.equal(path,'rpc/club_rename');assert.deepEqual(body,{p_club_id:club,p_name:'新名字',p_expected:'old'});return Response.json({name:'新名字'});},owner);assert.equal(response.status,200);
 const read=access=>handleSettings(new Request('https://club.example/api/club-settings'),club,async()=>Response.json([{name:'甲'}]),access).then(r=>r.json());
 assert.deepEqual(await read(owner),{name:'甲',can_edit:true});
 assert.deepEqual(await read({...owner,permissions:['members.read'],roles:['admin']}),{name:'甲',can_edit:false});
});
