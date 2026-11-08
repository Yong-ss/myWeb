import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreSummary} from './score-summary.ts';
test('top 30 is ranked by score per snapshot, never source order',()=>{
 const result=scoreSummary(Array.from({length:40},(_,i)=>i+1));
 assert.equal(result.total,820);assert.equal(result.top30,765);assert.equal(result.average,20.5);
 assert.deepEqual(scoreSummary([3,1,2]),{total:6,top30:6,average:2,count:3,missing:0});
});
test('missing scores do not become zero or dilute the average',()=>{
 assert.deepEqual(scoreSummary([100,null,0]),{total:100,top30:100,average:50,count:2,missing:1});
 assert.equal(scoreSummary([null]).average,null);assert.equal(scoreSummary([null]).top30,null);
 assert.equal(scoreSummary([]).average,null);
});
