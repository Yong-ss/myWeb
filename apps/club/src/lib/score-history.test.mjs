import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupScores,referenceDate,scoreDifference} from './score-history.ts';
const point=(date,score,partial=false)=>({date,score,partial,missing:partial?1:0});
test('periods use the last actual observation, Monday weeks and calendar years, never sum or fabricate',()=>{
 const points=[point('2025-12-31',8),point('2026-01-01',10),point('2026-01-05',12),point('2026-01-29',null,true),point('2026-02-01',20)];
 assert.deepEqual(groupScores(points,'year').map(p=>p.score),[8,20]);
 assert.deepEqual(groupScores(points,'month').map(p=>p.score),[8,null,20]);
 assert.deepEqual(groupScores(points,'week').map(p=>p.date),['2026-01-01','2026-01-05','2026-02-01']);
 assert.equal(groupScores(points,'day').length,5);
 assert.equal(scoreDifference(points[0],points[1]),2);assert.equal(scoreDifference(points[2],points[3]),null);
 assert.equal(referenceDate('2026-03-31','month',['2026-02-28','2026-03-01']),'2026-02-28');
 assert.equal(referenceDate('2026-02-01','week',['2026-01-24','2026-01-29']),'2026-01-24');
 assert.equal(referenceDate('2026-01-01','previous',[]),'');
});
