import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchPlayers} from './identity.ts';
const row={name:'冷泠月',position:null,level:70,pathway:'学徒',extraordinary_score:100,prosperity:100,weekly_activity:0,group:null,join_days:10};
const player={id:'a',display_name:'冷泠月',match_name:'冷泠月'};
const match=(rows=[row],players=[player],context={})=>matchPlayers(rows,players,context,'2026-10-27');
test('79 distinct names match automatically after first permanent identity confirmation',()=>{
  const rows=Array.from({length:79},(_,i)=>({...row,name:`玩家${i}`}));
  assert.equal(match(rows,rows.map((r,i)=>({id:String(i),display_name:r.name}))).filter(m=>m.tier==='A'&&m.identity).length,79);
  assert.equal(match([row],[])[0].tier,'D');
});
test('confirmed alias matches but an unconfirmed historical typo only suggests',()=>{
  const changed={...row,name:'冷冷月'};
  assert.equal(match([changed],[player],{aliases:[{id:'alias',player_id:'a',alias_name:'冷冷月'}]})[0].tier,'B');
  const m=match([changed],[player],{observations:[{...changed,player_id:'a',snapshot_date:'2026-10-26'}]})[0];
  assert.equal(m.tier,'C');assert.equal(m.identity,'');
});
test('alias vs alias and alias vs formal name conflicts cannot auto-link',()=>{
  const other={id:'b',display_name:'另一个人'};
  for(const aliases of [[{player_id:'b',alias_name:row.name}],[{player_id:'a',alias_name:'别名'},{player_id:'b',alias_name:'别名'}]]) {
    const m=match([{...row,name:aliases.length===1?row.name:'别名'}],[player,other],{aliases})[0];
    assert.equal(m.identity,'');assert.equal(m.tier,'C');
  }
});
test('same-name different people, duplicate rows and two names for one identity all require review',()=>{
  assert.equal(match([row],[player,{...player,id:'b'}])[0].identity,'');
  for(const rows of [[row,row],[row,{...row,name:'冷丶泠月'}],[row,{...row,name:'别名'}]]) {
    assert.ok(match(rows,[player],{aliases:[{player_id:'a',alias_name:'别名'}]}).every(m=>!m.identity));
  }
});
test('decoration and similar characters suggest only; numeric evidence never proves identity',()=>{
  for(const name of ['冷丶泠月','冷冷月','完全不相关']) {
    const m=match([{...row,name}],[player],{observations:[{...row,player_id:'a',snapshot_date:'2026-10-26'}]})[0];
    assert.equal(m.identity,'');
    if(name==='完全不相关') { assert.equal(m.candidates.length,0);assert.equal(m.tier,'C'); }
    else assert.ok(m.candidates.length);
  }
  assert.equal(match([{...row,name:null}])[0].identity,'');
});
test('anomalies and rejoining with reset join-days require review without creating a new identity',()=>{
  const prior={...row,player_id:'a',snapshot_date:'2026-10-26'};
  for(const changes of [{level:10},{pathway:'猎人'},{extraordinary_score:999},{prosperity:1},{join_days:0}]) {
    const m=match([{...row,...changes}],[player],{observations:[prior]})[0];assert.equal(m.identity,'');assert.equal(m.candidates[0].id,'a');assert.ok(m.reasons.length);
  }
  assert.equal(match([row],[{...player,archived_at:'2026-10-20'}])[0].identity,'a');
});
