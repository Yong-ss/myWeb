import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoreGrowth,usableDates,validComparison} from './score-growth.ts';
const row=(id,score,extra={})=>({player_id:id,name:'同名',presence:'present',extraordinary_score:score,...extra});
const data=(date,members,complete=true)=>({snapshot:{snapshot_date:date,is_complete_roster:complete},snapshots:[],members});
test('stable IDs, renamed members, gains, losses, unchanged and zero baselines reconcile',()=>{
 const a=data('2026-10-28',[row('a',100),row('b',50),row('c',0),row('d',20),row('gone',30)]);
 const b=data('2026-10-29',[row('a',120,{name:'改名'}),row('b',40),row('c',5),row('d',20),row('new',60)]);
 const r=scoreGrowth(a,b);
 assert.deepEqual(r.rows.map(r=>r.difference),[20,5,0,-10]);
 assert.equal(r.rows[1].percentage,null);assert.equal(r.rows[0].percentage,20);
 assert.equal(r.netGrowth,15);assert.equal(r.endingOnly,60);assert.equal(r.startingOnly,30);
 assert.equal(r.totalChange,45);assert.equal(r.totalChange,r.netGrowth+r.endingOnly-r.startingOnly);assert.equal(r.exact,true);
});
test('missing scores, incomplete rosters and stale observations cannot imply exact growth',()=>{
 const a=data('2026-10-28',[row('a',null),row('b',100),row('left',99,{presence:'left'}),row('unknown',99,{presence:'unconfirmed'})],false);
 const b=data('2026-10-29',[row('a',20),row('b',120),row('stale',500,{data_date:'2026-10-20'})]);
 const r=scoreGrowth(a,b);assert.equal(r.exact,false);assert.equal(r.startMissing,1);assert.equal(r.rows.length,1);assert.equal(r.endCount,2);assert.equal(r.netGrowth,20);
 assert.equal(scoreGrowth(data('2026-10-28',[row('a',Infinity)]),b).startMissing,1);
});
test('dates are distinct, current only, ordered, and invalid comparisons fail explicitly',()=>{
 assert.deepEqual(usableDates([{snapshot_date:'2026-10-29'},{snapshot_date:'2026-10-29'},{snapshot_date:'2026-10-28'},{snapshot_date:'2026-10-27',is_current:false}]),['2026-10-29','2026-10-28']);
 for(const [a,b] of [['',''],['2026-10-29','2026-10-29'],['2026-10-30','2026-10-29']])assert.equal(validComparison(a,b),false);
 assert.throws(()=>scoreGrowth(data('2026-10-29',[]),data('2026-10-28',[])));
});
