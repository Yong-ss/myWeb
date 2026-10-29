import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fieldValue,invalidCorrection,confirmedMembers,absenceReview,readableError} from './workflow.ts';
const member={name:'玩家甲',position:null,level:1,pathway:null,extraordinary_score:0,prosperity:null,weekly_activity:null,group:null,join_days:null};
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const row=(identity,extra={})=>({member,identity,manual:true,sourceName:'玩家甲',remember:false,needsReview:false,...extra});

test('edited fields keep unrecognized as null and never turn bad numbers into valid ones',()=>{
 assert.equal(fieldValue('level',''),null);assert.equal(fieldValue('level','12'),12);assert.equal(fieldValue('level','0'),0);
 // Kept as text so server-side validation rejects it instead of silently coercing.
 assert.equal(fieldValue('level','1a'),'1a');assert.equal(fieldValue('name','12'),'12');
});
test('nickname corrections reject empty, oversized and control-character names',()=>{
 assert.equal(invalidCorrection(null),false);assert.equal(invalidCorrection('新名'),false);
 for(const bad of ['',' ','x'.repeat(201),'a\u0007b'])assert.equal(invalidCorrection(bad),true);
});
test('confirmed rows map "new" to no player id and carry corrections to the server contract',()=>{
 const [fresh,renamed]=confirmedMembers([row('new',{member:{...member,name:'新人'}}),row(id,{correction:{name:'玩家甲',expected:'旧名'}})]);
 assert.equal(fresh.player_id,null);assert.equal(renamed.player_id,id);
 assert.equal(renamed.correct_name,'玩家甲');assert.equal(renamed.expected_name,'旧名');
 assert.throws(()=>confirmedMembers([row(id),row(id)]),/同一玩家/);
});
test('absence review: merge keeps the day roster, replace asks about everyone not imported',()=>{
 const context={members:[{...member,player_id:other}],absence_context:{snapshot:null,members:[{player_id:id,name:'甲'},{player_id:other,name:'乙'}]}};
 assert.deepEqual(absenceReview(context,[],'merge',{}).missing.map(p=>p.player_id),[id]);
 const replace=absenceReview(context,[],'replace',{[id]:'left'});
 assert.equal(replace.missing.length,2);assert.equal(replace.pending,1);assert.equal(replace.completeAllowed,false);
 assert.equal(absenceReview(context,[],'replace',{[id]:'left',[other]:'left'}).completeAllowed,true);
 assert.equal(absenceReview(context,[row(id)],'replace',{}).missing.length,1);
 assert.equal(absenceReview(null,[],'',{}).missing.length,0);
});
test('validation messages use Chinese field names',()=>assert.equal(readableError('第 1 行 join_days 必须是非负整数'),'第 1 行 入会天数 必须是非负整数'));
