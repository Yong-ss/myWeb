import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionLabel,changeSummary,actorLabel} from './labels.ts';

// The platform log is the record of who changed access; a misleading label would hide what really happened.
test('known audited tables get a clear label; anything unknown shows its raw key instead of a guess',()=>{
 assert.equal(actionLabel('club_memberships.update'),'修改 · 俱乐部角色');
 assert.equal(actionLabel('platform_super_admin_factors.insert'),'新增 · 超级管理员验证器');
 assert.equal(actionLabel('club_memberships.truncate'),'club_memberships.truncate');
 assert.equal(actionLabel('something_new.insert'),'something_new.insert');
});
test('an update lists exactly the fields that changed; inserts and deletes list identifying fields',()=>{
 const base={id:'e',created_at:'',action:'',via:'authenticator',actor:null,subject:null,club:null};
 assert.deepEqual(changeSummary({...base,details:{old:{role:'admin',status:'active',created_at:'t'},new:{role:'admin',status:'revoked',created_at:'t'}}}),['status: active → revoked']);
 assert.deepEqual(changeSummary({...base,details:{new:{role_key:'x',permission_key:'members.read'}}}),['role_key: x','permission_key: members.read']);
 assert.deepEqual(changeSummary({...base,details:{old:{role:'owner',status:'active'}}}),['role: owner','status: active']);
});
test('changes without a signed-in user are attributed to the database login, never left blank',()=>{
 const base={id:'e',created_at:'',action:'',details:{},subject:null,club:null};
 assert.equal(actorLabel({...base,actor:'boss@example.com',via:'authenticator'}),'boss@example.com');
 assert.equal(actorLabel({...base,actor:null,via:'postgres'}),'Supabase SQL Editor／迁移');
 assert.equal(actorLabel({...base,actor:null,via:'supabase_admin'}),'数据库（supabase_admin）');
});
