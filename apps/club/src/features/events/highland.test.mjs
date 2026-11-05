import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {parseHighlandSource,classifyRows,applyChoices,pairHighland,highlandParticipantRow,sourceSummary,highlandPrompt,MAX_HIGHLAND_ROWS} from './highland.ts';
import {highlandFactions} from '../../domain/highland.ts';

// Why these matter: a highland board is a whole faction (several clubs, ~120 rows per table in the real sample). A
// wrong automatic inclusion puts another club's player into our results; a silent zero or a missing table row makes
// attendance wrong. These tests encode which rows may be proposed automatically and what blocks saving.
const out=(name,kills=1,extra={})=>({player_name:name,faction_name:'血皇帝势力',kills,assists:0,dispersals:0,awakens:0,merit:2000,...extra});
const str=(name,extra={})=>({player_name:name,faction_name:'血皇帝势力',player_damage:'1708万',damage_taken:'462.7万',healing:0,purification:0,...extra});
const source=(output,strategy)=>JSON.stringify({schema_version:1,event_type:'highland_race',output,strategy});
// 北忧 and 阿乙 are current members; 旧人 left the club; 阿甲 is two different players; 乙乙 has a remembered alias.
const players=[{id:'p-north',display_name:'北忧',current:true},{id:'p-yi',display_name:'阿乙',current:true},{id:'p-old',display_name:'旧人',current:false},
 {id:'p-a',display_name:'阿甲',current:true},{id:'p-a2',display_name:'阿甲',current:true},{id:'p-b',display_name:'乙乙',current:true}];
const aliases=[{player_id:'p-b',alias_name:'乙Z'}];
const name=id=>players.find(p=>p.id===id)?.display_name??id;
const by=(entries,n)=>entries.find(e=>e.row.player_name===n);

test('the prompt is the V1 prompt in the requirements document and asks for the whole faction, no guardian damage',()=>{
 const doc=readFileSync(resolve(import.meta.dirname,'../../../../../docs/CLUB_HIGHLAND_RACE_DISCUSSION.md'),'utf8').replace(/\r\n/g,'\n');
 assert.ok(doc.includes('```text\n'+highlandPrompt+'\n```'));
 assert.match(highlandPrompt,/"highland_race"/);assert.match(highlandPrompt,/merit/);assert.match(highlandPrompt,/没有「对守卫伤害」/);
});
// The database refuses any other faction; a drift here would offer an option that can never be saved (or hide a valid one).
test('the faction list equals the database list (club_private.highland_factions)',()=>{
 const sql=readFileSync(resolve(import.meta.dirname,'../../../../../supabase/migrations/20261105090000_club_highland.sql'),'utf8');
 const listed=sql.match(/function club_private\.highland_factions\(\)[\s\S]*?select array\[([^\]]*)\]/)[1].match(/'([^']+)'/g).map(s=>s.slice(1,-1));
 assert.deepEqual([...highlandFactions],listed);
});
test('the JSON must be the exact highland V1 shape: both tables, merit, no guardian damage, a faction column',()=>{
 assert.throws(()=>parseHighlandSource(JSON.stringify({schema_version:1,event_type:'four_way_league',output:[out('北忧')],strategy:[str('北忧')]})),/高原竞逐 V1/);
 assert.throws(()=>parseHighlandSource(source([out('北忧')],[])),/缺少「战略」/);
 assert.throws(()=>parseHighlandSource(source([out('北忧')],[{...str('北忧'),guardian_damage:0}])),/额外字段/);
 const noMerit=out('北忧');delete noMerit.merit;assert.throws(()=>parseHighlandSource(source([noMerit],[str('北忧')])),/字段不齐/);
 assert.throws(()=>parseHighlandSource(source([{...out('北忧'),club_name:'x'}],[str('北忧')])),/额外字段/);
 assert.throws(()=>parseHighlandSource(source([out('北忧',1.5)],[str('北忧')])),/击败/);
 const parsed=parseHighlandSource(source([out('北忧'),out(null)],[str('北忧',{healing:null})]));
 assert.equal(parsed.strategy[0].values.player_damage,17080000);assert.equal(parsed.strategy[0].values.damage_taken,4627000);
 assert.equal(parsed.strategy[0].values.healing,null);assert.equal(parsed.output[1].player_name,null);
});
// Scroll overlap and the pinned own row repeat rows exactly; anything else with the same name is kept for a person.
test('identical repeated rows merge, same name with different values stays',()=>{
 const parsed=parseHighlandSource(source([out('北忧',9),out('路人',1),out('北忧',9),out('阿乙',2),out('阿乙',3)],[str('北忧')]));
 assert.equal(parsed.removed,1);assert.equal(parsed.output.length,4);
 const entries=classifyRows('output',parsed.output,players,aliases);
 assert.equal(by(entries,'北忧').decision,'include');
 assert.deepEqual(entries.filter(e=>e.row.player_name==='阿乙').map(e=>e.decision),['review','review']);
});
test('a whole faction: only exact names/aliases of current members are proposed; the rest wait or are proposed for exclusion',()=>{
 const rows=parseHighlandSource(source([out('北忧'),out('乙Z'),out('阿甲'),out('旧人'),out('北忧1'),out('路人甲'),out(null)],[str('北忧')])).output;
 const e=classifyRows('output',rows,players,aliases);
 assert.deepEqual([by(e,'北忧').decision,by(e,'北忧').identity],['include','p-north']);
 assert.deepEqual([by(e,'乙Z').decision,by(e,'乙Z').identity],['include','p-b']); // confirmed alias
 assert.equal(by(e,'阿甲').decision,'review'); // two players share the name
 assert.match(by(e,'旧人').reasons[0],/不在最新成员名单/); // departed: may be another club's player with that name
 assert.equal(by(e,'旧人').identity,'');assert.deepEqual(by(e,'旧人').candidates,['p-old']);
 assert.equal(by(e,'北忧1').decision,'review');assert.equal(by(e,'北忧1').identity,''); // similar is a hint only
 assert.equal(by(e,'路人甲').decision,'exclude'); // no relation to any player
 assert.equal(classifyRows('output',[{player_name:'路人',faction_name:null,values:{}}],players,aliases)[0].decision,'exclude'); // 2 characters, one differs from 旧人
 assert.equal(classifyRows('output',[{player_name:'阿·乙',faction_name:null,values:{}}],players,aliases)[0].decision,'review'); // only a symbol differs
 assert.equal(e.find(x=>x.row.player_name===null).decision,'review');
});
test('pairing: included rows join by identity, excluded rows never block, missing table blocks, review blocks',()=>{
 const p=parseHighlandSource(source([out('北忧',9),out('阿乙',2),out('路人')],[str('阿乙'),str('北丶忧'),str('路人二')]));
 let o=classifyRows('output',p.output,players,aliases),s=classifyRows('strategy',p.strategy,players,aliases);
 assert.equal(by(s,'路人二').decision,'exclude');assert.equal(by(o,'路人').decision,'exclude');
 let r=pairHighland(o,s,name);
 assert.equal(r.review,1); // 北丶忧 (similar) waits
 assert.ok(r.problems.some(x=>x.includes('「北忧」只在输出表纳入')));
 // The administrator confirms 北丶忧 is 北忧: both complete, the external rows (each in one table only) do not matter.
 s=applyChoices(s,{'strategy:1':{decision:'include',identity:'p-north'}});
 r=pairHighland(o,s,name);
 assert.deepEqual([r.review,r.problems],[0,[]]);
 assert.deepEqual(r.participants.map(x=>x.identity).sort(),['p-north','p-yi']);
 const north=r.participants.find(x=>x.identity==='p-north');
 assert.equal(north.output.row.player_name,'北忧');assert.equal(north.strategy.row.player_name,'北丶忧');
 // Excluding 阿乙 in one table only is caught: an included player needs both tables.
 const half=pairHighland(o,applyChoices(s,{'strategy:0':{decision:'exclude'}}),name);
 assert.ok(half.problems.some(x=>x.includes('「阿乙」只在输出表纳入')));
 // The same player included twice in one table is caught.
 const twice=pairHighland(applyChoices(o,{'output:2':{decision:'include',identity:'p-yi'}}),s,name);
 assert.ok(twice.problems.some(x=>x.includes('同一张表每人只能一行')));
 // A wrongly excluded row can be included again.
 assert.equal(applyChoices(o,{'output:2':{decision:'include',identity:'p-old'}})[2].decision,'include');
});
test('participant rows: missing values block, zeros are kept, only this club is sent, the summary has counts only',()=>{
 const p=parseHighlandSource(source([out('北忧',0,{merit:0}),out('路人',50)],[str('北忧',{player_damage:0,damage_taken:0,healing:null}),str('路人')]));
 const o=classifyRows('output',p.output,players,aliases),s=classifyRows('strategy',p.strategy,players,aliases);
 const [north]=pairHighland(o,s,name).participants;
 assert.equal(highlandParticipantRow(north,false),null); // healing unread
 const row=highlandParticipantRow({...north,values:{...north.values,healing:0}},true);
 assert.deepEqual(row,{player_id:'p-north',output_name:'北忧',strategy_name:'北忧',remember_alias:true,kills:0,assists:0,dispersals:0,awakens:0,merit:0,player_damage:0,damage_taken:0,healing:0,purification:0});
 assert.ok(!JSON.stringify(row).includes('路人'));
 assert.deepEqual(sourceSummary(o,s),{output_rows:2,strategy_rows:2,excluded_rows:2});
});
// Bound from the real 18-screenshot sample (~120 rows per table for one faction): a synthetic faction at the row cap
// with a large roster still classifies quickly enough for the page.
test('scale: the row cap against a 300-player roster classifies in well under a second',()=>{
 const roster=Array.from({length:300},(_,i)=>({id:`p${i}`,display_name:`成员${i}号`,current:i%5!==0}));
 const board=Array.from({length:MAX_HIGHLAND_ROWS},(_,i)=>out(i%4===0?`成员${i%300}号`:`外部玩家${i}`));
 const raw=source(board,board.map(r=>str(r.player_name)));
 assert.ok(new TextEncoder().encode(raw).length<1048576);
 const start=performance.now();
 const p=parseHighlandSource(raw);
 const o=classifyRows('output',p.output,roster,[]),s=classifyRows('strategy',p.strategy,roster,[]);
 pairHighland(o,s,id=>id);
 assert.ok(performance.now()-start<2000,`took ${performance.now()-start} ms`);
 assert.ok(o.filter(e=>e.decision==='exclude').length>=700);
});
