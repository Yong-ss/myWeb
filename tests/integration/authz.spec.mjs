import {test,expect} from '@playwright/test';
import {createHmac} from 'node:crypto';
import {auth,rest,sql,audits,localFetch,state,clubId,foreignClubId,baseURL,users,password} from './local.mjs';

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) using the stdlib; used only against the local Auth server.
function totp(secret){
  const bits=[...secret.replace(/=+$/,'').toUpperCase()].map(c=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0')).join('');
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const h=createHmac('sha1',Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)))).update(counter).digest(),o=h[19]&15;
  return String((h.readUInt32BE(o)&0x7fffffff)%1e6).padStart(6,'0');
}
const authApi=(path,token,body,method='POST')=>localFetch(`/auth/v1/${path}`,{method,headers:{apikey:state().anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const allPermissions=['absences.resolve','aliases.manage','audit.actor_email.read','audit.read','club.admins.manage','club.admins.permissions','club.alliance.request','club.rename','imports.create','imports.delete','members.read'];

// users.owner is the migration's Super Admin; the foreign club has its own owner and an audited action.
test.beforeAll(()=>{sql(`insert into public.club_audit_events(club_id,actor_id,action) values('${foreignClubId}','${users.foreign.id}','authz_foreign');`);});

test('raw REST, RPC and Worker paths never expose audit rows, user IDs or the Super Admin list',async({request})=>{
 const owner=(await auth('owner')).access_token,admin=(await auth('admin')).access_token,foreign=(await auth('foreign')).access_token;
 for(const token of [owner,admin])for(const path of ['club_audit_events?select=id','club_audit_events?select=details','platform_super_admins?select=user_id','auth_permissions?select=key','auth_roles?select=key','auth_role_permissions?select=role_key','club_imports','club_imports?select=submitted_by','club_player_aliases?select=confirmed_by'])
  expect((await rest(path,token)).status,path).toBe(403);
 // Columns the app needs stay readable.
 for(const path of ['club_imports?select=id,raw_text&limit=1','club_player_aliases?select=id,alias_name&limit=1'])expect((await rest(path,owner)).ok,path).toBe(true);
 const anonymous=await localFetch('/rest/v1/rpc/club_activity',{method:'POST',headers:{apikey:state().anonKey,'Content-Type':'application/json'},body:JSON.stringify({p_club_id:clubId})});
 expect([401,403]).toContain(anonymous.status);
 // Tenants cannot read each other's logs through the definer RPC.
 expect((await (await rest('rpc/club_activity',foreign,{p_club_id:clubId})).json()).events).toEqual([]);
 expect((await (await rest('rpc/club_activity',admin,{p_club_id:foreignClubId})).json()).events).toEqual([]);
 const own=JSON.stringify(await (await rest('rpc/club_activity',foreign,{p_club_id:foreignClubId})).json());
 expect(own).toContain('authz_foreign');expect(own).not.toContain('@');
 // The deployed path: the Worker forwards only the redacted RPC result.
 for(const token of [owner,admin]){
  const body=await (await request.get(`${baseURL}/api/activity`,{headers:{Cookie:`__Host-club_access=${token}`}})).text();
  expect(body).not.toContain('@');expect(body).not.toContain(users.owner.id);
 }
});

test('aal2 comes only from a verified Auth session: forged claims fail, real TOTP unlocks Super Admin reads only',async()=>{
 const aal1=(await auth('owner')).access_token;
 expect(claims(aal1).aal).toBe('aal1');
 expect(await (await rest('rpc/club_my_permissions',aal1,{p_club:foreignClubId})).json()).toEqual([]);
 expect((await (await rest('rpc/club_activity',aal1,{p_club_id:foreignClubId})).json()).events).toEqual([]);
 // Editing the claim breaks the signature; an unsigned token is rejected outright.
 const [header,,signature]=aal1.split('.');
 for(const forged of [[header,b64({...claims(aal1),aal:'aal2'}),signature].join('.'),[b64({alg:'none',typ:'JWT'}),b64({...claims(aal1),aal:'aal2'}),''].join('.')])
  expect((await rest('rpc/club_my_permissions',forged,{p_club:foreignClubId})).status).toBe(401);
 const enrolled=await authApi('factors',aal1,{factor_type:'totp',friendly_name:'integration'});expect(enrolled.ok,await enrolled.clone().text()).toBe(true);
 const factor=await enrolled.json();let aal2;
 try{
  const challenge=await (await authApi(`factors/${factor.id}/challenge`,aal1,{})).json();
  const verified=await authApi(`factors/${factor.id}/verify`,aal1,{challenge_id:challenge.id,code:totp(factor.totp.secret)});expect(verified.ok,await verified.clone().text()).toBe(true);
  aal2=(await verified.json()).access_token;expect(claims(aal2).aal).toBe('aal2');
  // First activation: a real aal2 session from a factor nobody confirmed grants nothing (a password thief gets this far).
  expect(await (await rest('rpc/club_my_permissions',aal2,{p_club:foreignClubId})).json()).toEqual([]);
  expect(await (await rest(`club_players?select=id&club_id=eq.${foreignClubId}`,aal2)).json()).toEqual([]);
  expect(await (await rest('rpc/club_my_access',aal2,{p_club:foreignClubId})).json()).toMatchObject({super_admin_active:false,session_aal2:true});
  expect((await rest('rpc/trust_super_admin_factor',aal2,{p_factor:factor.id})).status).not.toBe(200);
  expect((await rest('platform_super_admin_factors',aal2,{factor_id:factor.id,user_id:users.owner.id})).status).toBe(403);
  // On the real Supabase image (with its default grants) no API role, including the secret key's service_role, can confirm.
  expect(sql(`select string_agg(r||':'||(has_function_privilege(r,'club_private.trust_super_admin_factor(uuid)','EXECUTE') or has_table_privilege(r,'public.platform_super_admin_factors','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')),',') from unnest(array['anon','authenticated','service_role','authenticator']) r;`)).toBe('anon:false,authenticated:false,service_role:false,authenticator:false');
  // The owner's out-of-band confirmation (SQL Editor, simulated here as postgres) activates the same live session.
  expect(sql(`select club_private.trust_super_admin_factor('${factor.id}');`)).toContain('integration');
  expect(await (await rest('rpc/club_my_permissions',aal2,{p_club:foreignClubId})).json()).toEqual(allPermissions);
  const event=(await (await rest('rpc/club_activity',aal2,{p_club_id:foreignClubId})).json()).events.find(e=>e.action==='authz_foreign');
  expect(event).toMatchObject({actor_label:users.foreign.email,actor_id:users.foreign.id,actor_kind:'member'});
  // Since P2 an MFA-verified Super Admin reads and writes any club through the same RLS and RPCs; raw tables stay closed.
  expect((await (await rest(`club_players?select=id&club_id=eq.${foreignClubId}`,aal2)).json()).length).toBeGreaterThan(0);
  expect((await rest('rpc/club_rename',aal2,{p_club_id:foreignClubId,p_name:'超级管理员改名',p_expected:'Integration club B'})).ok).toBe(true);
  expect((await rest('rpc/club_rename',aal2,{p_club_id:foreignClubId,p_name:'Integration club B',p_expected:'超级管理员改名'})).ok).toBe(true);
  const renamed=audits(`club_id='${foreignClubId}' and action='club_renamed'`);
  expect(renamed.at(-1)).toMatchObject({actor_id:users.owner.id,details:{actor_kind:'super_admin',actor_role:null}});expect(JSON.stringify(renamed)).not.toContain(users.owner.email);
  // The foreign owner sees the Super Admin only as its public label.
  const seen=JSON.stringify(await (await rest('rpc/club_activity',(await auth('foreign')).access_token,{p_club_id:foreignClubId})).json());
  expect(seen).toContain('超级管理员');expect(seen).not.toContain(users.owner.email);expect(seen).not.toContain(users.owner.id);
  // The aal1 token from the same login still cannot do any of this.
  expect((await rest('rpc/club_rename',aal1,{p_club_id:foreignClubId,p_name:'x',p_expected:'Integration club B'})).status).toBe(403);
  expect(await (await rest(`club_players?select=id&club_id=eq.${foreignClubId}`,aal1)).json()).toEqual([]);
  expect((await rest('club_audit_events?select=id',aal2)).status).toBe(403);
  expect((await rest('platform_super_admins?select=user_id',aal2)).status).toBe(403);
 }finally{
  // Restore the account for later specs: verified factors need aal2 to remove.
  if(aal2){
   expect((await authApi(`factors/${factor.id}`,aal2,undefined,'DELETE')).ok).toBe(true);
   // Removing the factor ends the powers of a still-unexpired aal2 token at once.
   expect(await (await rest('rpc/club_my_permissions',aal2,{p_club:foreignClubId})).json()).toEqual([]);
  }else sql(`delete from auth.mfa_factors where id='${factor.id}';`);
 }
});

test('single active role, Worker/database parity and immediate role change through the real Worker',async({request})=>{
 const roleSql=`insert into public.auth_roles(key,scope_kind,club_id,name) values('it_namer','club','${clubId}','集成改名') on conflict do nothing;
  insert into public.auth_role_permissions select 'it_namer',permission_key from public.auth_role_permissions where role_key='admin' on conflict do nothing;
  insert into public.auth_role_permissions values('it_namer','club.rename') on conflict do nothing;`;
 sql(roleSql);
 const admin=(await auth('admin')).access_token,cookie={Cookie:`__Host-club_access=${admin}`};
 const account=async()=>(await request.get(`${baseURL}/api/account`,{headers:cookie}));
 const rename=(name,expected_name)=>request.post(`${baseURL}/api/club-settings`,{headers:{Origin:baseURL,...cookie},data:{name,expected_name}});
 const current=async()=>(await (await request.get(`${baseURL}/api/club-settings`,{headers:cookie})).json()).name;
 const parity=async()=>{const a=await (await account()).json();expect(a.permissions).toEqual(await (await rest('rpc/club_my_permissions',admin,{p_club:clubId})).json());return a;};
 try{
  let a=await parity();expect(a.roles).toEqual(['admin']);expect(a.permissions).not.toContain('club.rename');
  expect((await rename('管理员越权',await current())).status()).toBe(403);
  // Stage A: a second active role in the same club is refused by the database itself.
  expect(()=>sql(`insert into public.club_memberships(club_id,user_id,role) values('${clubId}','${users.admin.id}','it_namer');`)).toThrow(/club_one_active_role/);
  sql(`update public.club_memberships set status='revoked' where club_id='${clubId}' and user_id='${users.admin.id}' and role='admin';
   insert into public.club_memberships(club_id,user_id,role) values('${clubId}','${users.admin.id}','it_namer');`);
  a=await parity();expect(a.roles).toEqual(['it_namer']);expect(a.permissions).toContain('club.rename');expect(a.permissions).toContain('imports.create');
  const before=await current();expect((await rename('换职位改名',before)).ok()).toBe(true);expect((await rename(before,'换职位改名')).ok()).toBe(true);
  // Switching back removes the rename permission on the very next request, without a new login.
  sql(`update public.club_memberships set status='revoked' where club_id='${clubId}' and user_id='${users.admin.id}' and role='it_namer';
   update public.club_memberships set status='active' where club_id='${clubId}' and user_id='${users.admin.id}' and role='admin';`);
  a=await parity();expect(a.roles).toEqual(['admin']);expect((await rename('撤销后改名',before)).status()).toBe(403);
  expect((await request.get(`${baseURL}/api/members`,{headers:cookie})).ok()).toBe(true);
  // A direct RPC with the same token is refused by the database too.
  expect((await rest('rpc/club_rename',admin,{p_club_id:clubId,p_name:'直接调用',p_expected:before})).status).toBe(403);
  // Clients cannot grant themselves a role, through REST or by naming a foreign club's role.
  expect((await rest('club_memberships',admin,{club_id:clubId,user_id:users.admin.id,role:'owner'})).status).toBe(403);
 }finally{sql(`delete from public.club_memberships where role='it_namer';update public.club_memberships set status='active' where club_id='${clubId}' and user_id='${users.admin.id}' and role='admin';`);}
});

test('the Super Admin binds and verifies real TOTP in account security; powers appear only after aal2',async({page,context})=>{
 // The later-login check waits for the next 30 s TOTP window, because Auth may reject a code already used.
 test.setTimeout(90000);
 await context.route('**/*',r=>new URL(r.request().url()).origin===baseURL?r.continue():r.abort());
 let factorIds=[];
 try{
  await page.goto('/login');await page.getByLabel('邮箱',{exact:true}).fill(users.owner.email);await page.getByLabel('密码',{exact:true}).fill(password);
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);await page.goto('/account'); // the Super Admin lands on the platform centre
  // Without MFA: still the club owner, no Super Admin powers, no emails in the log.
  let account=await (await context.request.get(`${baseURL}/api/account`)).json();
  expect(account).toMatchObject({super_admin:true,mfa_verified:false,roles:['owner']});expect(account.permissions).not.toContain('audit.actor_email.read');
  await expect(page.locator('.club-header-account')).toContainText('公会长');
  expect(await (await context.request.get(`${baseURL}/api/activity`)).text()).not.toContain('@');
  await page.goto('/admin/security');await expect(page.getByRole('heading',{name:/两步验证/})).toBeVisible();
  await page.getByLabel('设备名称').fill('集成手机');await page.getByRole('button',{name:'开始绑定'}).click();
  const qr=page.getByRole('img',{name:'两步验证二维码'});await expect(qr).toBeVisible();
  // The image must actually decode (a broken data: URL is still "visible"); prints only the format, never the secret.
  const loaded=await qr.evaluate(i=>i.decode().then(()=>i.naturalWidth>0,()=>false));
  expect(loaded,await qr.evaluate(i=>`${i.src.slice(0,32)}… hash=${i.src.includes('#')}`)).toBe(true);
  const secret=(await page.locator('code').textContent()).trim();
  await page.getByLabel('验证码（6 位）').fill(totp(secret));await page.getByRole('button',{name:'完成绑定'}).click();
  await expect(page.getByText('已验证，验证器待确认')).toBeVisible();
  factorIds=sql(`select string_agg(id::text,',') from auth.mfa_factors where user_id='${users.owner.id}';`).split(',').filter(Boolean);
  expect(factorIds).toHaveLength(1);
  // First activation: aal2 with an unconfirmed factor is still only the club owner; the page shows the SQL Editor step.
  account=await (await context.request.get(`${baseURL}/api/account`)).json();
  expect(account).toMatchObject({super_admin:true,mfa_verified:false,mfa_session:true,roles:['owner']});expect(account.permissions).not.toContain('audit.actor_email.read');
  // On the platform security page the header shows only the platform identity; the club role is checked via the API above.
  await expect(page.locator('.club-header-account')).toContainText('超级管理员（待两步验证）');await expect(page.locator('.club-header-account')).not.toContainText('公会长');
  await expect(page.getByText(`select club_private.trust_super_admin_factor('${factorIds[0]}');`)).toBeVisible();
  // The owner confirms out of band (SQL Editor as postgres); the same aal2 session then has the full permission set.
  sql(`select club_private.trust_super_admin_factor('${factorIds[0]}');`);
  account=await (await context.request.get(`${baseURL}/api/account`)).json();
  expect(account).toMatchObject({super_admin:true,mfa_verified:true});expect(account.permissions).toContain('audit.actor_email.read');
  await page.reload();await expect(page.getByText('超级管理员已启用')).toBeVisible();
  await expect(page.locator('.club-header-account')).toContainText('超级管理员');
  await expect(page.getByText('trust_super_admin_factor')).toHaveCount(0);
  // The secret is not echoed by any later API response, and codes are never accepted twice for a new device without aal2.
  for(const path of ['/api/account','/api/mfa','/api/activity'])expect(await (await context.request.get(baseURL+path)).text()).not.toContain(secret);
  // A fresh password-only login (aal1) cannot add another authenticator once one is verified.
  const aal1=(await auth('owner')).access_token;
  const blocked=await context.request.post(`${baseURL}/api/mfa`,{headers:{Origin:baseURL,Cookie:`__Host-club_access=${aal1}`},data:{action:'enroll',name:'攻击者'}});
  expect(blocked.status()).toBe(403);
  const remove=await context.request.post(`${baseURL}/api/mfa`,{headers:{Origin:baseURL,Cookie:`__Host-club_access=${aal1}`},data:{action:'remove',factor_id:factorIds[0]}});
  expect(remove.status()).toBe(403);
  // A password thief can call Auth directly with the public key, bypassing the Worker: Auth itself must refuse.
  const direct=await authApi('factors',aal1,{factor_type:'totp',friendly_name:'direct attacker'});
  expect(direct.ok,await direct.clone().text()).toBe(false);
  expect((await authApi(`factors/${factorIds[0]}`,aal1,undefined,'DELETE')).ok).toBe(false);
  expect(sql(`select count(*) from auth.mfa_factors where user_id='${users.owner.id}';`)).toBe('1');
  // Wrong codes are rejected with no session change.
  const wrong=await context.request.post(`${baseURL}/api/mfa`,{headers:{Origin:baseURL,Cookie:`__Host-club_access=${aal1}`},data:{action:'verify',factor_id:factorIds[0],code:'000000'}});
  expect(wrong.status()).toBe(400);expect(wrong.headers()['set-cookie']??'').not.toContain('__Host-club_access=e');
  // After confirmation, a normal later login needs only password + TOTP through the Worker.
  await expect.poll(()=>Math.floor(Date.now()/30000),{timeout:31000,intervals:[500]}).toBeGreaterThan(Math.floor(Date.now()/30000));
  const later=await context.request.post(`${baseURL}/api/mfa`,{headers:{Origin:baseURL,Cookie:`__Host-club_access=${aal1}`},data:{action:'verify',factor_id:factorIds[0],code:totp(secret)}});
  expect(later.status(),await later.text()).toBe(200);
  const laterToken=/__Host-club_access=([^;]+)/.exec(later.headers()['set-cookie'])[1];
  expect(await (await rest('rpc/club_my_permissions',laterToken,{p_club:foreignClubId})).json()).toEqual(allPermissions);
  // Logging out ends that session; the still-unexpired token no longer carries powers.
  expect((await authApi('logout?scope=local',laterToken,{})).ok).toBe(true);
  expect(await (await rest('rpc/club_my_permissions',laterToken,{p_club:foreignClubId})).json()).toEqual([]);
 }finally{
  // Local disposable stack only: restore the fixture account for other specs.
  sql(`delete from auth.mfa_factors where user_id='${users.owner.id}';`);
  // Confirmation rows are an append-only record; they match nothing once their factor is gone.
 }
});

test('platform panel: only an aal2 Super Admin session from a confirmed device reads it, through the Worker and the database',async({request})=>{
 const paths=['overview','users','roles','activity'];
 const viaWorker=async(token,path)=>request.get(`${baseURL}/api/admin/${path}`,{headers:{Cookie:`__Host-club_access=${token}`}});
 const rpcs=[['platform_overview',{}],['platform_users',{}],['platform_roles',{}],['platform_activity',{}]];
 const refused=async(token,label)=>{
  for(const path of paths)expect((await viaWorker(token,path)).status(),`${label} ${path}`).toBe(403);
  // Calling the database directly with the same token (bypassing the Worker) is refused too.
  for(const [fn,body] of rpcs)expect((await rest(`rpc/${fn}`,token,body)).status,`${label} ${fn}`).toBe(403);
 };
 for(const role of ['admin','foreign','outsider'])await refused((await auth(role)).access_token,role);
 const aal1=(await auth('owner')).access_token;await refused(aal1,'Super Admin aal1');
 const enrolled=await (await authApi('factors',aal1,{factor_type:'totp',friendly_name:'platform-integration'})).json();
 try{
  const challenge=await (await authApi(`factors/${enrolled.id}/challenge`,aal1,{})).json();
  const aal2=(await (await authApi(`factors/${enrolled.id}/verify`,aal1,{challenge_id:challenge.id,code:totp(enrolled.totp.secret)})).json()).access_token;
  expect(claims(aal2).aal).toBe('aal2');
  // A real aal2 session from an unconfirmed device is not enough.
  await refused(aal2,'aal2 unconfirmed device');
  sql(`select club_private.trust_super_admin_factor('${enrolled.id}');`);
  const account=await (await request.get(`${baseURL}/api/account`,{headers:{Cookie:`__Host-club_access=${aal2}`}})).json();
  expect(account.platform_permissions).toContain('platform.read');
  const overview=await (await viaWorker(aal2,'overview')).json();
  expect(overview.totals).toMatchObject({clubs:Number(sql('select count(*) from public.club_clubs;')),users:Number(sql('select count(*) from auth.users;'))});
  expect(overview.alliances).toBe(0); // stage F: the real number of active alliances (none in this fixture)
  if(process.env.P31_PERFORMANCE==='1'){
   sql(`insert into public.club_clubs(id,name) select md5('p31-club-'||c)::uuid,'P31 performance '||c from generate_series(1,10)c;
    insert into public.club_players(id,club_id,display_name) select md5('p31-player-'||c||'-'||p)::uuid,md5('p31-club-'||c)::uuid,'Player '||p from generate_series(1,10)c cross join generate_series(1,80)p;
    insert into public.club_imports(id,club_id,submitted_by,raw_text,schema_version,request_id) select md5('p31-import-'||c||'-'||d)::uuid,md5('p31-club-'||c)::uuid,'${claims(aal2).sub}','{}',1,md5('p31-request-'||c||'-'||d)::uuid from generate_series(1,10)c cross join generate_series(1,30)d;
    insert into public.club_snapshots(id,club_id,snapshot_date,revision,import_id,is_complete_roster) select md5('p31-snapshot-'||c||'-'||d)::uuid,md5('p31-club-'||c)::uuid,date '2040-01-01'+d,1,md5('p31-import-'||c||'-'||d)::uuid,true from generate_series(1,10)c cross join generate_series(1,30)d;
    insert into public.club_snapshot_players(club_id,snapshot_id,player_id) select md5('p31-club-'||c)::uuid,md5('p31-snapshot-'||c||'-'||d)::uuid,md5('p31-player-'||c||'-'||p)::uuid from generate_series(1,10)c cross join generate_series(1,30)d cross join generate_series(1,80)p;
    analyze public.club_snapshots;analyze public.club_snapshot_players;`);
   const samples=[];
   for(let i=0;i<7;i++){
    const start=performance.now(),response=await viaWorker(aal2,'overview');expect(response.status()).toBe(200);
    const result=await response.json();samples.push(Math.round(performance.now()-start));
    const clubs=result.clubs.filter(c=>c.name.startsWith('P31 performance '));expect(clubs).toHaveLength(10);
    for(const c of clubs){expect(c.player_counts).toEqual({present:80,temporary:0,confirmed_left:0,unconfirmed:0,other_left:0});expect(Object.values(c.player_counts).reduce((a,b)=>a+b,0)).toBe(c.players);}
   }
   console.log('P31 overview performance: '+JSON.stringify({clubs:10,playersPerClub:80,days:30,rows:24000,samplesMs:samples}));
   (await import('node:fs')).writeFileSync('.test-artifacts/p31-overview-performance.json',JSON.stringify({clubs:10,playersPerClub:80,days:30,rows:24000,samplesMs:samples},null,2));
   expect(Math.max(...samples)).toBeLessThan(2000);
  }

  // Every club uses its own latest effective roster; compare through real REST/RLS, not a second presence algorithm.
  for(const c of overview.clubs){
   const snapshots=await (await rest(`club_snapshots?club_id=eq.${c.id}&is_current=eq.true&deleted_at=is.null&order=snapshot_date.desc&limit=1&select=id,snapshot_date`,aal2)).json();
   expect(c.latest_snapshot).toBe(snapshots[0]?.snapshot_date??null);
   const players=await (await rest(`club_players?club_id=eq.${c.id}&select=id`,aal2)).json();
   expect(c.players).toBe(players.length);
   if(!snapshots.length){expect(c.player_counts).toBeNull();continue;}
   const roster=await (await rest('rpc/club_roster_presence',aal2,{p_club:c.id,p_snapshot:snapshots[0].id})).json();
   const count=(presence,decision)=>roster.members.filter(r=>r.presence===presence&&(decision===undefined||r.absence_decision===decision)).length;
   expect(Object.values(c.player_counts).reduce((a,b)=>a+b,0)).toBe(c.players);
   expect(c.player_counts).toEqual({present:count('present'),temporary:count('left','temporary'),confirmed_left:count('left','left'),unconfirmed:count('unconfirmed')+players.length-roster.members.length,other_left:count('left')-count('left','temporary')-count('left','left')});
  }
  const users=(await (await viaWorker(aal2,'users?q=admin@club.test')).json()).users;
  expect(users).toHaveLength(1);
  expect(Object.keys(users[0]).sort()).toEqual(['alliance','created_at','effective','email','email_confirmed','id','last_sign_in_at','memberships','platform_admin','super_admin']);
  // What the panel shows as effective permissions is what the database grants that user.
  expect(users[0].effective[0].permissions).toEqual(await (await rest('rpc/club_my_permissions',(await auth('admin')).access_token,{p_club:clubId})).json());
  const roles=await (await viaWorker(aal2,'roles')).json();
  expect(roles.permissions.map(p=>p.key)).toContain('platform.read');
  // The SQL Editor confirmation is in the platform log, attributed to the database login.
  const events=(await (await viaWorker(aal2,'activity')).json()).events;
  expect(events.find(e=>e.action==='platform_super_admin_factors.insert'&&e.details.new.factor_id===enrolled.id)).toMatchObject({via:'postgres',actor:null});
  // Ordinary members still never see the Super Admin's email anywhere they can read.
  const admin=(await auth('admin')).access_token;
  for(const path of ['/api/account','/api/activity','/api/members'])expect(await (await request.get(baseURL+path,{headers:{Cookie:`__Host-club_access=${admin}`}})).text(),path).not.toContain('owner@club.test');
  // Removing the device ends platform access at once, with the same unexpired token.
  expect((await authApi(`factors/${enrolled.id}`,aal2,undefined,'DELETE')).ok).toBe(true);
  await refused(aal2,'after device removal');
 }finally{sql(`delete from auth.mfa_factors where id='${enrolled.id}';`);}
});
