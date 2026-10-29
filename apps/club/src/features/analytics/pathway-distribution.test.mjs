import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathwayDistribution,pathwayMembersHref} from './pathway-distribution.ts';

test('only explicit present rows contribute to the denominator, including unknown pathways',()=>{
 const result=pathwayDistribution([
  {presence:'present',pathway:'观众'},{presence:'present',pathway:'观众'},
  {presence:'present',pathway:'新途径'},{presence:'present',pathway:null},{presence:'present',pathway:''},
  {presence:'left',pathway:'战士'},{presence:'unconfirmed',pathway:'占卜家'},{pathway:'学徒'},
 ]);
 assert.equal(result.total,5);
 assert.equal(result.groups.reduce((sum,g)=>sum+g.count,0),result.total);
 assert.deepEqual(result.groups.find(g=>g.name===null),{name:null,count:2,percent:40});
 assert.deepEqual(result.groups.find(g=>g.name==='观众'),{name:'观众',count:2,percent:40});
 assert.equal(result.groups.at(-1).name,'新途径');
});
test('empty and single-pathway distributions never divide by zero or invent segments',()=>{
 assert.deepEqual(pathwayDistribution([]),{total:0,groups:[]});
 assert.deepEqual(pathwayDistribution([{presence:'present',pathway:'歌颂者'}]),{total:1,groups:[{name:'歌颂者',count:1,percent:100}]});
});
test('links preserve exact stored values and distinguish missing data while selecting present members',()=>{
 for(const name of ['占卜家','未知 & / 途径','—',null]){
  const url=new URL(pathwayMembersHref(name),'https://test.invalid');
  assert.equal(url.searchParams.get('presence'),'present');
  assert.equal(url.searchParams.get('pathway'),name);
  assert.equal(url.searchParams.get('pathway_missing'),name===null?'1':null);
 }
});
