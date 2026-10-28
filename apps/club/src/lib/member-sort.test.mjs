import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareMemberValues as compare} from './member-sort.ts';

test('game role seniority is independent of Chinese alphabetical order and group suffixes',()=>{
 const roles=['会长','外交官二组组员','理事','俱乐部之星','二组组长','三组组员','正式成员','候补成员'];
 assert.deepEqual([...roles].reverse().sort((a,b)=>compare('position',a,b,false)),roles);
 assert.deepEqual([...roles].sort((a,b)=>compare('position',a,b,true)),[...roles].reverse());
});
test('zero participates in numeric ordering while unread values stay last',()=>{
 for(const descending of [false,true]) assert.deepEqual([null,10,0,2].sort((a,b)=>compare('prosperity',a,b,descending)),descending?[10,2,0,null]:[0,2,10,null]);
});
