import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionLabel,changeSummary,actorLabel,layerReason,allowedWithForced} from './labels.ts';

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

test('an idempotent assignment with no membership change is described as no change',()=>{
 assert.equal(actionLabel('club_memberships.noop'),'无需变更 · 俱乐部角色');
 assert.equal(actionLabel('something_new.noop'),'something_new.noop');
});

test('admin limit changes are named in the platform log',()=>{
 assert.equal(actionLabel('club_clubs.admin_limit'),'修改 · 管理员人数上限');
 assert.equal(actionLabel('club_clubs.delete'),'club_clubs.delete');
});

// The explanation is how a Super Admin finds out why someone cannot do something; a vague or wrong reason sends them
// to change the wrong layer.
test('permission reasons name the deciding layer, and a capped personal allow is called out as not in effect',()=>{
 const p=(layer,extra={})=>({key:'k',description:'d',sensitive:false,non_delegable:false,layer,allowed:false,platform_default:false,cap_blocked:false,club_default:null,forced:null,owner_set:null,...extra});
 assert.equal(layerReason(p('cap')),'超出该职位的权限上限');
 assert.equal(layerReason(p('cap',{forced:true})),'已单独允许，但超出该职位的权限上限，未生效');
 assert.equal(layerReason(p('cap',{owner_set:true})),'已单独允许，但超出该职位的权限上限，未生效');
 assert.equal(layerReason(p('cap',{forced:false})),'超出该职位的权限上限');
 assert.equal(layerReason(p('forced_deny')),'超级管理员单独禁止');
 assert.equal(layerReason(p('non_delegable')),'系统安全规则：只有公会长可以拥有');
 assert.equal(layerReason(p('club_allow')),'本俱乐部默认允许');
 assert.equal(layerReason(p('something_new')),'未知原因（请查看高级详情）');
 assert.equal(actionLabel('club_permission_overrides.update'),'修改 · 个人权限');
 assert.equal(actionLabel('auth_role_cap_blocks.insert'),'新增 · 职位上限限制');
});

// A sensitive permission must not be widened without confirmation. Whether a change widens access depends on the final
// result, which must match the database order: safety and cap, forced, owner (admins only), club default, platform default.
test('the final result after a personal change follows the database layer order',()=>{
 const p=(extra={})=>({key:'k',description:'d',sensitive:true,non_delegable:false,layer:'forced_deny',allowed:false,platform_default:false,cap_blocked:false,club_default:null,forced:false,owner_set:null,...extra});
 // 单独禁止 → 跟随默认 reopens it when a lower layer allows it.
 assert.equal(allowedWithForced(p({platform_default:true}),'admin',true,null),true);
 assert.equal(allowedWithForced(p({club_default:true}),'admin',true,null),true);
 assert.equal(allowedWithForced(p({platform_default:true,club_default:false}),'admin',true,null),false);
 assert.equal(allowedWithForced(p({owner_set:true}),'admin',true,null),true);
 assert.equal(allowedWithForced(p({owner_set:false,platform_default:true}),'admin',true,null),false);
 // Owner settings apply to admins only.
 assert.equal(allowedWithForced(p({owner_set:true}),'owner',true,null),false);
 assert.equal(allowedWithForced(p(),'admin',true,null),false);
 // Higher layers stop everything, whatever is chosen.
 for(const layer of ['cap','non_delegable','unregistered','no_role'])for(const v of [true,null])assert.equal(allowedWithForced(p({layer,platform_default:true}),'admin',true,v),false,layer);
 assert.equal(allowedWithForced(p({platform_default:true}),'admin',false,null),false);
 assert.equal(allowedWithForced(p({platform_default:true}),null,true,true),false);
 assert.equal(allowedWithForced(p(),'admin',true,true),true);
 assert.equal(allowedWithForced(p({platform_default:true}),'admin',true,false),false);
});
// Stage G: the layer breakdown names every layer in plain words, including the alliance read and a forced deny on it.
import {layerBreakdown} from './labels.ts';
test('the layer breakdown shows defaults, personal setting, limits and the final result',()=>{
 const base={key:'members.read',description:'x',sensitive:false,non_delegable:false,layer:'default_allow',allowed:true,platform_default:true,cap_blocked:false,club_default:false,forced:null,owner_set:true};
 assert.deepEqual(Object.fromEntries(layerBreakdown(base,'admin')),{'全平台默认':'允许','俱乐部默认':'不允许','个人设置':'公会长单独允许','上级限制':'无','最终生效':'允许'});
 assert.equal(Object.fromEntries(layerBreakdown({...base,cap_blocked:true,allowed:false},'admin'))['上级限制'],'超出职位上限');
 const leader={...base,layer:'no_role',club_default:null,owner_set:null,alliance:true,forced:false,allowed:false};
 assert.deepEqual(Object.fromEntries(layerBreakdown(leader,null)),{'全平台默认':'无职位','俱乐部默认':'无职位','联盟会长只读':'允许','个人设置':'超级管理员单独禁止','上级限制':'无','最终生效':'不允许'});
});
// Review fix: lifting a forced deny re-opens an alliance read even when the club role would not allow it, so the
// confirmation for sensitive permissions must see that as widening.
test('allowedWithForced counts the alliance read',()=>{
 const p={key:'audit.read',description:'x',sensitive:true,non_delegable:false,layer:'forced_deny',allowed:false,platform_default:false,cap_blocked:false,club_default:false,forced:false,owner_set:null,alliance:true};
 assert.equal(allowedWithForced(p,'admin',true,null),true);
 assert.equal(allowedWithForced(p,'admin',true,false),false);
 assert.equal(allowedWithForced({...p,alliance:false},'admin',true,null),false);
});
