import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clubInsights,growthSentence} from './insights.ts';
const g=(o)=>({rows:[{}],netGrowth:0,totalChange:0,endingOnly:0,startingOnly:0,exact:true,...o});
const base={complete:true,hasPrior:true,comparing:false,comparisonError:false,growth:null};
test('the sentence follows the actual signs: roster change is blamed only when members grew but the total fell',()=>{
 assert.match(growthSentence(g({netGrowth:20,totalChange:-10,startingOnly:30})),/总评分下降.*名单变化/);
 assert.match(growthSentence(g({netGrowth:20,totalChange:20})),/整体变强.*\+20/);
 assert.doesNotMatch(growthSentence(g({netGrowth:20,totalChange:20})),/名单/);
 assert.match(growthSentence(g({rows:[]})),/无法比较/);
});
test('partial data is qualified rather than presented as a complete result',()=>{
 assert.match(growthSentence(g({netGrowth:5,totalChange:5,exact:false})),/只按已知数据/);
});
test('missing history and incomplete rosters are stated; nothing notable means no invented alert',()=>{
 assert.deepEqual(clubInsights({...base,hasPrior:false}).map(i=>i.tone),['neutral']);
 assert.equal(clubInsights({...base,complete:false,hasPrior:false})[0].tone,'warning');
 assert.deepEqual(clubInsights(base),[]);
 const [growth]=clubInsights({...base,growth:g({netGrowth:1,totalChange:1}),from:'2026-10-29',to:'2026-10-30'});
 assert.equal(growth.href,'/analytics?view=growth&from=2026-10-29&to=2026-10-30');
});
