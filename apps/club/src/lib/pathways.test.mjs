import {test} from 'node:test';
import assert from 'node:assert/strict';
import {statSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getPathway,pathways} from './pathways.ts';

test('stored names resolve to supplied artwork without renaming 歌颂者',()=>{
 const expected={'占卜家':'seer-f3155962252b','学徒':'apprentice','观众':'spectator-c617261c48b5','窥秘人':'mystery-pryer','战士':'warrior','歌颂者':'sun'};
 assert.deepEqual(Object.keys(pathways),Object.keys(expected));
 for(const [name,file] of Object.entries(expected)){
  assert.equal(getPathway(name).name,name);
  const icon = `/pathway/${file}.webp`;
  assert.equal(getPathway(name).icon,icon);
  const asset=new URL(`../../public${icon}`,import.meta.url);
  assert.ok(statSync(asset).size < 100_000, name+' is rendered as a small icon');
  const version=file.match(/-([a-f0-9]{12})$/)?.[1];
  if(version) assert.equal(createHash('sha256').update(readFileSync(asset)).digest('hex').slice(0,12),version);
 }
});

test('unknown, absent and prototype-like names never borrow a known pathway identity',()=>{
 for(const value of ['太阳','猎人',' 歌颂者 ','','constructor','__proto__',null,undefined,0])assert.equal(getPathway(value),undefined);
});

test('confirmed in-game accents remain exact rather than being retinted',()=>{
 const css=readFileSync(new URL('../styles/tokens.css',import.meta.url),'utf8');
 for(const [name,hex] of Object.entries({'占卜家':'#7087D1','观众':'#7EC0A7','窥秘人':'#A57BE1'})){
  const token=getPathway(name).accent.slice(4,-1);
  assert.ok(css.includes(token+': '+hex+';'),name+' must preserve its confirmed color');
 }
});
