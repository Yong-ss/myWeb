import {test} from 'node:test';import assert from 'node:assert/strict';
import {historyPage} from './player-history.ts';
test('old schema retains paged history and change baselines without changing production',async()=>{
 const days=Array.from({length:105},(_,i)=>({snapshot_date:new Date(Date.UTC(2030,0,i+1)).toISOString().slice(0,10),revision:1,is_complete_roster:true,rows:[{player_id:'player',extraordinary_score:i,prosperity:null,weekly_activity:null}]}));
 const read=async(path,body)=>{
  if(path==='rpc/club_history_page'){assert.equal(body.p_club,'club');return Response.json({code:'PGRST202'},{status:404});}
  const params=new URL('https://local.invalid/'+path).searchParams;assert.equal(params.get('club_id'),'eq.club');
  if(path.startsWith('club_players'))return Response.json([{id:'player',display_name:'旧库玩家'}]);
  const cursor=params.get('and')?.match(/lt\.([^)]*)/)[1];
  return Response.json(days.filter(d=>!cursor||d.snapshot_date<cursor));
 };
 const response=await historyPage('player',null,null,'club',read);assert.equal(response.status,200);
 const page=await response.json();assert.equal(page.timeline.length,100);assert.equal(page.timeline[0].event,null);assert.equal(page.timeline[0].changes.score.amount,1);
 assert.equal(response.headers.get('X-Club-Read-Mode'),'legacy-schema');
 const earlier=await (await historyPage('player',null,page.next,'club',read)).json();assert.equal(earlier.timeline.length,5);assert.equal(earlier.next,null);assert.equal(earlier.timeline[0].event,'first_seen');
});
test('authorization and unexpected database failures do not trigger fallback',async()=>{
 for(const [status,code] of [[403,'42501'],[500,'XX000'],[404,'other']]){
  let count=0;const response=await historyPage('player',null,null,'club',async()=>{count++;return Response.json({code},{status});});
  assert.equal(response.status,502);assert.equal(count,1);
 }
});
