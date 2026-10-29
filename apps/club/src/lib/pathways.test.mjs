import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {getPathway,pathways} from './pathways.ts';

test('stored names resolve to supplied artwork without renaming 歌颂者',()=>{
 const expected={'占卜家':'seer','学徒':'apprentice','观众':'spectator','窥秘人':'mystery-pryer','战士':'warrior','歌颂者':'sun'};
 assert.deepEqual(Object.keys(pathways),Object.keys(expected));
 for(const [name,file] of Object.entries(expected)){
  assert.equal(getPathway(name).name,name);
  const icon = ["seer","spectator"].includes(file) ? `/pathways/${file}.png` : `/pathway/${file}.webp`;
  assert.equal(getPathway(name).icon,icon);
  assert.ok(existsSync(new URL(`../../public${icon}`,import.meta.url)));
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
