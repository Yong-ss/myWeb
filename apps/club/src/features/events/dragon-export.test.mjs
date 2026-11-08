import test from 'node:test';
import assert from 'node:assert/strict';
import {dragonReportRows,dragonExcel,dragonPrint,dragonExcelColumns} from './dragon-export.ts';
const data={club_name:'动态俱乐部',event:{event_date:'2026-11-06',status:'active',version:2},players:[{display_name:'=1+1<&',pathway:'战士'}],roster:{date:'2026-11-06',revision:1,complete:false},absent:[{display_name:'未参加成员',pathway:null}]};
test('pathway columns keep every participant once and isolate absences in the last column',()=>{
 const input={...data,players:[...data.players,{display_name:'未知玩家',pathway:null},{display_name:'观众玩家',pathway:'观众'}]};
 const columns=dragonExcelColumns(input);
 assert.deepEqual(columns.slice(0,6).map(c=>c.name),['占卜家','学徒','观众','窥秘人','战士','歌颂者']);
 assert.equal(columns.at(-2).name,'未识别途径');
 assert.deepEqual(columns.at(-1),{name:'未参加',players:data.absent});
 assert.equal(columns.slice(0,-1).flatMap(c=>c.players).length,3);
 assert.equal(dragonExcelColumns({...input,roster:null}).at(-1).players.length,0);
});
test('report preserves attendance evidence and warns about incomplete rosters',()=>{
 assert.match(dragonReportRows(data)[2][0],/名单不完整/);
 assert.deepEqual(dragonReportRows(data).at(-1),['未参加','未参加成员','未识别途径']);
 for(const variant of [{...data,roster:null},{...data,event:{...data.event,status:'voided'}}]){
  assert.equal(dragonReportRows(variant).some(r=>r[0]==='未参加'),false);
 }
});
test('untrusted player names remain text in Excel and print reports',()=>{
 const bytes=dragonExcel(data),xml=new TextDecoder().decode(bytes),html=dragonPrint(data);
 assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
 assert.match(xml,/<t xml:space="preserve">=1\+1&lt;&amp;<\/t>/);
 assert.ok(!xml.includes('<f>'));
 assert.ok(html.includes('=1+1&lt;&amp;'));
 assert.ok(html.includes('thead{display:table-header-group}'));
});
test('print uses the same columns, rejects injected colors and never presents unknown absences as zero',()=>{
 const html=dragonPrint({...data,roster:null},{'战士':'red;display:none'});
 assert.ok(html.includes('size:A4 landscape'));
 assert.equal((html.match(/scope="col"/g)??[]).length,7);
 assert.ok(html.includes('未参加<span>无法判断</span>'));
 assert.ok(!html.includes('display:none;'));
 assert.ok(!html.includes('red;'));
 assert.ok(!html.includes('未参加成员'));
});

// The club name is supplied by the selected club, including names needing XML/HTML escaping.
test('both formats use the supplied club name rather than a fixed brand',()=>{
 for(const club_name of ['甲俱乐部','乙俱乐部<&']){
  const input={...data,club_name},escaped=club_name.replaceAll('&','&amp;').replaceAll('<','&lt;');
  assert.equal(dragonReportRows(input)[0][0],`${club_name} · 2026-11-06 猎龙出勤报表`);
  assert.ok(dragonPrint(input).includes(`<h1>${escaped} ·`));
  assert.ok(new TextDecoder().decode(dragonExcel(input)).includes(`${escaped} ·`));
 }
});
