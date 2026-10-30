import {test,expect} from '@playwright/test';
import {auth,rest,users,password,baseURL,clubId,sql} from './local.mjs';
test('real score history retains current revision, tenant RLS and exact observed totals',async({request})=>{
 // Synthetic fixtures inside the disposable local stack only; no hosted database access.
 sql(`insert into public.club_players(id,club_id,display_name,match_name) values(md5('trend-player')::uuid,'${clubId}','趋势夹具','趋势夹具');
 insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id)
 select md5('trend-import-'||n)::uuid,'${clubId}','${users.owner.id}','{}',1,md5('trend-request-'||n)::uuid from generate_series(1,3)n;
 insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster,is_current,deleted_at,supersedes_id)
 values(md5('trend-one')::uuid,'${clubId}','2020-01-01',1,md5('trend-import-1')::uuid,true,false,null,null),
 (md5('trend-two')::uuid,'${clubId}','2020-01-01',2,md5('trend-import-2')::uuid,true,true,null,md5('trend-one')::uuid),
 (md5('trend-deleted')::uuid,'${clubId}','2020-01-02',1,md5('trend-import-3')::uuid,true,false,now(),null);
 insert into public.club_snapshot_players(club_id,snapshot_id,player_id,name,extraordinary_score)
 values('${clubId}',md5('trend-one')::uuid,md5('trend-player')::uuid,'趋势夹具',100),
 ('${clubId}',md5('trend-two')::uuid,md5('trend-player')::uuid,'趋势夹具',170),
 ('${clubId}',md5('trend-deleted')::uuid,md5('trend-player')::uuid,'趋势夹具',90000);`);
 expect((await request.get('/api/members?trend=1')).status()).toBe(401);
 const login=await request.post('/api/login',{headers:{Origin:baseURL},data:{email:users.owner.email,password}});
 expect(login.ok(),await login.text()).toBe(true);
 const response=await request.get('/api/members?trend=1');expect(response.ok(),await response.text()).toBe(true);
 const {points}=await response.json();expect(points.length).toBeGreaterThan(0);
 expect(points.find(p=>p.date==='2020-01-01')?.score).toBe(170);
 expect(points.some(p=>p.date==='2020-01-02')).toBe(false);
 const token=(await auth('owner')).access_token;
 const expected=await rest(`club_snapshots?select=id,snapshot_date,revision&club_id=eq.${clubId}&is_current=eq.true&deleted_at=is.null&order=snapshot_date.desc&limit=30`,token);
 expect(points.map(p=>p.snapshotId)).toEqual((await expected.json()).map(s=>s.id));
 const point=points[0];
 const rows=await rest(`club_snapshot_players?select=extraordinary_score&club_id=eq.${clubId}&snapshot_id=eq.${point.snapshotId}`,token);
 const saved=await rows.json(),valid=saved.map(r=>r.extraordinary_score).filter(n=>typeof n==='number');
 expect(point.score).toBe(valid.length===0&&saved.length>0?null:valid.reduce((a,b)=>a+b,0));
 expect(point.missing).toBe(saved.length-valid.length);
});
