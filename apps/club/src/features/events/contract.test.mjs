import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseAmount,parseEventSource,matchEntries,pairEntries,participantRow,newIdentity,totalKills,eventToday} from './contract.ts';
import {eventPrompt} from './prompt.ts';

const out=(name,kills=1,extra={})=>({player_name:name,club_name:'千秋｜君辞赋',kills,assists:0,dispersals:0,awakens:0,...extra});
const str=(name,extra={})=>({player_name:name,club_name:'千秋｜君辞赋',player_damage:501000,damage_taken:0,healing:0,guardian_damage:0,purification:0,...extra});
const source=(output,strategy)=>JSON.stringify({schema_version:1,event_type:'four_way_league',output,strategy});
const players=[{id:'p-north',display_name:'北忧'},{id:'p-a',display_name:'阿甲'},{id:'p-a2',display_name:'阿甲'},{id:'p-b',display_name:'乙乙'}];
const aliases=[{player_id:'p-b',alias_name:'乙Z'}];

// The prompt is the contract shared with the external AI; a silent drift would make every import fail or mis-map.
test('the prompt is the V1 prompt in the requirements document',()=>{
 const doc=readFileSync(resolve(import.meta.dirname,'../../../../../docs/CLUB_EVENTS_DISCUSSION.md'),'utf8').replace(/\r\n/g,'\n');
 assert.ok(doc.includes('```text\n'+eventPrompt+'\n```'));
});
// 万/亿 come from the game display; a wrong factor would change damage by 10 000x. Missing must stay missing, never 0.
test('amounts: 万 and 亿, separators, zero kept, unreadable null, anything else invalid',()=>{
 assert.equal(parseAmount('50.1万'),501000);assert.equal(parseAmount('452.7万'),4527000);assert.equal(parseAmount('1.2亿'),120000000);
 assert.equal(parseAmount('1,234'),1234);assert.equal(parseAmount(0),0);assert.equal(parseAmount(null),null);
 for(const bad of [-1,1.5,'abc','5万x','',true,undefined])assert.equal(parseAmount(bad),undefined,String(bad));
});
test('the JSON must be the exact V1 shape with both tables',()=>{
 assert.throws(()=>parseEventSource('```json{}```'),/语法错误/);
 assert.throws(()=>parseEventSource(JSON.stringify({schema_version:1,event_type:'daily',output:[],strategy:[]})),/V1/);
 assert.throws(()=>parseEventSource(source([out('北忧')],[])),/缺少「战略」/);
 assert.throws(()=>parseEventSource(source([{...out('北忧'),rank:1}],[str('北忧')])),/额外字段/);
 assert.throws(()=>parseEventSource(source([out('北忧',-1)],[str('北忧')])),/击败/);
 const parsed=parseEventSource(source([out('北忧',9)],[str('北忧',{player_damage:'50.1万',healing:null})]));
 assert.equal(parsed.strategy[0].values.player_damage,501000);assert.equal(parsed.strategy[0].values.healing,null);
});
// The pinned own row at the bottom repeats the same player; counting it twice would duplicate a participant.
test('an identical repeated row is one row; same name with other values is kept for review',()=>{
 const parsed=parseEventSource(source([out('北忧',9),out('阿乙',2),out('北忧',9)],[str('北忧'),str('阿乙')]));
 assert.equal(parsed.output.length,2);assert.equal(parsed.removed,1);
 const kept=parseEventSource(source([out('北忧',9),out('北忧',3)],[str('北忧')]));
 assert.equal(kept.output.length,2);
 const entries=matchEntries('output',kept.output,players,aliases);
 assert.ok(entries.every(e=>!e.identity&&e.reasons[0].includes('重复')));
});
// Identity comes only from an exact name or a confirmed alias; similar names and same-name players need a person.
test('matching: exact and alias automatic, same name twice and similar only suggested',()=>{
 const [north,alias,twin,similar,unread]=matchEntries('output',[out('北忧'),out('乙Z'),out('阿甲'),out('北忧丶'),out(null)].map(r=>({player_name:r.player_name,club_name:null,values:{}})),players,aliases);
 assert.equal(north.identity,'p-north');assert.equal(alias.identity,'p-b');
 assert.equal(twin.identity,'');assert.deepEqual(twin.candidates.slice(0,2).sort(),['p-a','p-a2']);
 assert.equal(similar.identity,'');assert.ok(similar.candidates.includes('p-north'));
 assert.equal(unread.identity,'');
});
// Strict two-table mode: the two lists are joined by identity (their order differs), and anyone in only one is an error.
test('pairing joins by identity regardless of order and reports every gap',()=>{
 const o=parseEventSource(source([out('北忧',9),out('乙乙',2)],[str('乙乙',{healing:5}),str('北忧')]));
 const name=id=>players.find(p=>p.id===id)?.display_name??id;
 const ok=pairEntries(matchEntries('output',o.output,players,aliases),matchEntries('strategy',o.strategy,players,aliases),name);
 assert.deepEqual(ok.problems,[]);
 const b=ok.participants.find(p=>p.identity==='p-b');assert.equal(b.values.kills,2);assert.equal(b.values.healing,5);
 assert.equal(totalKills(ok.participants.map(p=>p.values)),11);
 const gap=pairEntries(matchEntries('output',o.output,players,aliases),matchEntries('strategy',o.strategy.slice(0,1),players,aliases),name);
 assert.equal(gap.participants.length,1);assert.match(gap.problems.join(),/北忧」只出现在输出表/);
 // A new player confirmed in both tables pairs; in one only, it is a gap.
 const n=parseEventSource(source([out('新人')],[str('新人')]));
 const [eo]=matchEntries('output',n.output,players,aliases),[es]=matchEntries('strategy',n.strategy,players,aliases);
 eo.identity=es.identity=newIdentity('新人');
 const paired=pairEntries([eo],[es],name);assert.deepEqual(paired.problems,[]);
 assert.deepEqual(participantRow(paired.participants[0],false),{player_id:null,name:'新人',output_name:'新人',strategy_name:'新人',remember_alias:false,kills:1,assists:0,dispersals:0,awakens:0,player_damage:501000,damage_taken:0,healing:0,guardian_damage:0,purification:0});
});
test('a participant with a missing value cannot be sent (missing is never 0)',()=>{
 const n=parseEventSource(source([out('北忧')],[str('北忧',{healing:null})]));
 const p=pairEntries(matchEntries('output',n.output,players,aliases),matchEntries('strategy',n.strategy,players,aliases),x=>x).participants[0];
 assert.equal(participantRow(p,false),null);
 p.values.healing=0;assert.equal(participantRow(p,false).healing,0);
});
// The server refuses future dates in the club's business calendar; the page must offer the same last day.
test('the business date is Kuala Lumpur time',()=>{
 assert.equal(eventToday(new Date('2026-11-04T16:30:00Z')),'2026-11-05');
 assert.equal(eventToday(new Date('2026-11-04T15:30:00Z')),'2026-11-04');
});
