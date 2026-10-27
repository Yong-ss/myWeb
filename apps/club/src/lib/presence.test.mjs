import {test} from 'node:test';
import assert from 'node:assert/strict';
import {absenceStatus,playerTimeline,change} from './presence.ts';
const row={player_id:'permanent',extraordinary_score:0,prosperity:null,weekly_activity:100};
const day=(date,complete,present=true,extra={})=>({snapshot_date:date,is_complete_roster:complete,revision:1,rows:present?[{...row,...extra}]:[]});
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
