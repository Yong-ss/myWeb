import {test} from 'node:test';
import assert from 'node:assert/strict';
import {absenceStatus,playerTimeline,change,presenceText} from './presence.ts';
const row={player_id:'permanent',extraordinary_score:0,prosperity:null,weekly_activity:100};
const day=(date,complete,present=true,extra={})=>({snapshot_date:date,is_complete_roster:complete,revision:1,rows:present?[{...row,...extra}]:[]});

test('temporary and confirmed departures share the outside list but never share misleading labels',()=>{
 const timeline=playerTimeline([day('2030-01-01',false),{...day('2030-01-02',false,false),absence_decision:'temporary',absence_reason:'买物资'},day('2030-01-03',false,false),day('2030-01-04',false)]);
 assert.equal(timeline[1].status,'left');assert.equal(timeline[2].absence_reason,'买物资');
 assert.equal(timeline[3].event,'rejoined');assert.equal(timeline[3].absence_reason,undefined);
 assert.equal(presenceText('left','temporary'),'暂离');assert.equal(presenceText('left','left'),'已确认退会');assert.equal(presenceText('left'),'不在会');
});
test('an explicit pending choice cannot become a confirmed departure just because a roster is marked complete',()=>{
 const timeline=playerTimeline([day('2030-01-01',true),{...day('2030-01-02',true,false),absence_decision:'uncertain'}]);
 assert.equal(timeline[1].status,'unconfirmed');assert.equal(timeline[1].event,null);
});
test('explicit departure works on an incomplete day and persists until real reappearance',()=>{
 const days=[day('2030-01-01',false),{...day('2030-01-02',false,false),confirmed_left:true},day('2030-01-03',false,false),day('2030-01-04',false)];
 const timeline=playerTimeline(days);assert.deepEqual(timeline.map(d=>d.event),['first_seen','left',null,'rejoined']);assert.equal(timeline[2].status,'left');
 assert.equal(playerTimeline([days[3]],{status:'left',previous:row})[0].event,'rejoined');
});
test('a history page preserves earlier identity, departure and change baseline',()=>{
 const page=playerTimeline([day('2030-01-01',false,true,{extraordinary_score:25})],{status:'left',previous:{...row,extraordinary_score:20}});
 assert.equal(page[0].event,'rejoined');assert.equal(page[0].changes.score.amount,5);
 const absent=playerTimeline([day('2030-01-01',false,false)],{status:'left',previous:row});
 assert.equal(absent[0].status,'left');assert.equal(absent[0].event,null);
});
test('only a later complete roster can prove absence; an incomplete day cannot restore a departed player',()=>{
  assert.equal(absenceStatus('2026-10-01'), 'unconfirmed');
  assert.equal(absenceStatus('2026-10-01','2026-10-01'),'unconfirmed');
  assert.equal(absenceStatus('2026-10-01','2026-10-02'),'left');
  const result=playerTimeline([day('2026-10-01',true),day('2026-10-02',false,false),day('2026-10-03',true,false),day('2026-10-04',false,false),day('2026-10-05',false,true,{extraordinary_score:50,weekly_activity:0})]);
  assert.deepEqual(result.map(r=>r.status),['present','unconfirmed','left','left','present']);
  assert.deepEqual(result.filter(r=>r.event).map(r=>r.event),['first_seen','left','rejoined']);
  assert.equal(result[4].member.player_id,'permanent');
  assert.deepEqual(result[4].changes.score,{amount:50,percent:null});
  assert.equal(result[4].changes.activity_reset,true);
});
test('missing values are never zero and days before the first observation do not count as leaving',()=>{
  assert.equal(change(null,1),null);assert.deepEqual(change(0,10),{amount:-10,percent:-100});
  assert.equal(playerTimeline([day('2026-01-01',true,false)]).length,0);
});
