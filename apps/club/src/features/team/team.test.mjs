import {test} from 'node:test';
import assert from 'node:assert/strict';
import {keptWarnings,defaultWidens,personalWidens} from './team.ts';

// The owner must be warned before an appointment silently reopens a sensitive permission, and must confirm any change
// whose FINAL result opens a sensitive permission, whichever menu choice causes it.
test('re-appointment warnings name the setting, who set it and the final result, sensitive openings first',()=>{
 const w=keptWarnings([
  {key:'aliases.manage',description:'记住错名',sensitive:false,forced:false,owner_set:null,default_allowed:true,allowed:false},
  {key:'audit.read',description:'查看操作日志',sensitive:true,forced:null,owner_set:true,default_allowed:false,allowed:true},
  {key:'club.rename',description:'修改名称',sensitive:false,forced:true,owner_set:false,default_allowed:false,allowed:true},
 ]);
 assert.deepEqual(w.map(x=>x.key),['audit.read','club.rename','aliases.manage']);
 assert.equal(w[0].text,'查看操作日志：公会长单独允许，任命后允许（默认为不允许）');
 assert.ok(w[0].opens&&w[0].sensitive);
 // A Super Admin setting wins over the owner's, so it is the one described.
 assert.equal(w[1].text,'修改名称：超级管理员单独允许，任命后允许（默认为不允许）');
 assert.equal(w[2].text,'记住错名：超级管理员单独禁止，任命后不允许（默认为允许）');
 assert.equal(w[2].opens,false);
});

test('club default widening compares the final default before and after, including back to follow',()=>{
 const p={key:'audit.read',description:'',sensitive:true,non_delegable:false,cap_blocked:false,platform_default:true,club_default:false};
 assert.equal(defaultWidens(p,null),true);   // 不允许 → 跟随全平台（允许）
 assert.equal(defaultWidens(p,true),true);
 assert.equal(defaultWidens({...p,platform_default:false},null),false);
 assert.equal(defaultWidens({...p,club_default:null},true),false); // already allowed by the platform default
 assert.equal(defaultWidens({...p,cap_blocked:true},true),false);
 assert.equal(defaultWidens({...p,non_delegable:true},true),false);
});

test('personal widening follows the database order: Super Admin setting and cap win over the owner setting',()=>{
 const base={key:'audit.read',description:'',sensitive:true,non_delegable:false,layer:'owner_deny',allowed:false,platform_default:true,cap_blocked:false,club_default:null,forced:null,owner_set:false};
 assert.equal(personalWidens(base,true,null),true);  // 单独禁止 → 跟随默认 reopens it
 assert.equal(personalWidens(base,true,true),true);
 assert.equal(personalWidens({...base,club_default:false},true,null),false);
 assert.equal(personalWidens({...base,layer:'forced_deny',forced:false},true,true),false);
 assert.equal(personalWidens({...base,layer:'cap'},true,true),false);
 assert.equal(personalWidens(base,false,true),false); // unverified email: nothing applies
 assert.equal(personalWidens({...base,allowed:true,layer:'default_allow',owner_set:null},true,true),false);
});
