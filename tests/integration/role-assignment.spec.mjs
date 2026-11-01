import {spawn} from 'node:child_process';
import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {auth,rest,sql,audits,localFetch,state,totp,clubId,foreignClubId,baseURL,users,password} from './local.mjs';

const authApi=(path,token,body,method='POST')=>localFetch(`/auth/v1/${path}`,{method,headers:{apikey:state().anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const allPermissions=['absences.resolve','aliases.manage','audit.actor_email.read','audit.read','club.rename','imports.create','imports.delete','members.read'];

test('P4 assignments are atomic, tenant explicit, replay safe and protected by live trusted MFA',async({request})=>{
 test.setTimeout(90000);
 const club=randomUUID(),other=randomUUID();
 sql(`insert into public.club_clubs(id,name,admin_limit) values('${club}','P4 isolated club',2),('${other}','P4 other club',5);
 insert into public.club_memberships(club_id,user_id,role) values('${club}','${users.foreign.id}','owner'),('${club}','${users.foreign.id}','admin'),('${other}','${users.foreign.id}','owner');`);
 const base={club_id:club,user_id:users.admin.id,role:'admin',action:'grant',expected_version:0,request_id:randomUUID()};
 const write=(token,body)=>request.post(`${baseURL}/api/admin/assign-role`,{headers:{Cookie:`__Host-club_access=${token}`,Origin:baseURL},data:body});
 const rpcBody=b=>({p_club:b.club_id,p_user:b.user_id,p_role:b.role,p_action:b.action,p_expected:b.expected_version,p_request:b.request_id});
 const deny=async token=>{expect((await write(token,base)).status()).toBe(403);expect((await rest('rpc/platform_assign_role',token,rpcBody(base))).status).toBe(403);expect((await rest('rpc/platform_role_context',token,{p_user:users.admin.id})).status).toBe(403);};
 for(const role of ['admin','foreign','outsider','owner'])await deny((await auth(role)).access_token);
 const aal1=(await auth('owner')).access_token;
 const forged=aal1.split('.');forged[1]=b64({...claims(aal1),aal:'aal2'});expect((await write(forged.join('.'),base)).status()).toBe(401);
 const factor=await (await authApi('factors',aal1,{factor_type:'totp',friendly_name:'P4 integration'})).json();let token;
 try{
  const challenge=await (await authApi(`factors/${factor.id}/challenge`,aal1,{})).json();
  token=(await (await authApi(`factors/${factor.id}/verify`,aal1,{challenge_id:challenge.id,code:totp(factor.totp.secret)})).json()).access_token;
  await deny(token);sql(`select club_private.trust_super_admin_factor('${factor.id}');`);
  const context=async user=>(await (await request.get(`${baseURL}/api/admin/role-context?user=${user}`,{headers:{Cookie:`__Host-club_access=${token}`}})).json());
  const version=async()=>(await context(users.admin.id)).clubs.find(c=>c.id===club).role_version;
  const auditCount=()=>Number(sql(`select count(*) from public.platform_audit_events where details->'new'->>'club_id'='${club}' or details->'old'->>'club_id'='${club}';`));
  const v=await version();const a={...base,expected_version:v},b={...base,user_id:users.outsider.id,expected_version:v,request_id:randomUUID()};
  const attempts=await Promise.all([write(token,a),write(token,b)]);expect(attempts.map(r=>r.status()).sort()).toEqual([200,409]);
  const winner=attempts[0].status()===200?a:b,loser=winner===a?b:a;
  const logCount=auditCount();expect((await write(token,winner)).status()).toBe(200);expect(auditCount()).toBe(logCount);
  expect((await write(token,{...winner,user_id:loser.user_id})).status()).toBe(409);expect(auditCount()).toBe(logCount);
  expect((await write(token,{...loser,expected_version:await version(),request_id:randomUUID()})).status()).toBe(409);expect(auditCount()).toBe(logCount);
  const loserToken=(await auth(loser.user_id===users.admin.id?'admin':'outsider')).access_token;
  const winnerToken=(await auth(winner.user_id===users.admin.id?'admin':'outsider')).access_token;
  expect(await (await rest('rpc/club_my_permissions',winnerToken,{p_club:club})).json()).toContain('members.read');
  const revoke={...winner,action:'revoke',expected_version:await version(),request_id:randomUUID()};expect((await write(token,revoke)).status()).toBe(200);
  expect(await (await rest('rpc/club_my_permissions',winnerToken,{p_club:club})).json()).toEqual([]);
  const revokedAudit=auditCount(),revokedVersion=await version();expect((await write(token,winner)).status()).toBe(200);
  expect(await (await rest('rpc/club_my_permissions',winnerToken,{p_club:club})).json()).toEqual([]);expect(await version()).toBe(revokedVersion);expect(auditCount()).toBe(revokedAudit);
  expect(await (await rest('rpc/club_my_permissions',loserToken,{p_club:club})).json()).toEqual([]);
  expect((await write(token,{...winner,expected_version:await version(),request_id:randomUUID()})).status()).toBe(200);
  const before=auditCount();expect((await write(token,{...base,user_id:users.foreign.id,role:'owner',action:'revoke',expected_version:await version(),request_id:randomUUID()})).status()).toBe(409);expect(auditCount()).toBe(before);
  const transfer={...base,user_id:users.outsider.id,role:'owner',action:'transfer',expected_version:await version(),request_id:randomUUID()};expect((await write(token,transfer)).status()).toBe(200);
  const foreign=(await auth('foreign')).access_token;
  const remaining=await (await rest('rpc/club_my_permissions',foreign,{p_club:club})).json();expect(remaining).toContain('members.read');expect(remaining).not.toContain('club.rename');
  expect(await (await rest('rpc/club_my_permissions',foreign,{p_club:other})).json()).toContain('club.rename');
  expect(sql(`select count(*) from public.club_memberships where club_id='${club}' and role='owner' and status='active';`)).toBe('1');
  const finalVersion=await version();const transfers=await Promise.all([users.admin.id,users.foreign.id].map(id=>write(token,{...transfer,user_id:id,expected_version:finalVersion,request_id:randomUUID()})));expect(transfers.map(r=>r.status()).sort()).toEqual([200,409]);
  expect(sql(`select count(*) from public.club_memberships where club_id='${club}' and role='owner' and status='active';`)).toBe('1');
  const event=JSON.parse(sql(`select row_to_json(e) from (select actor_id,details from public.platform_audit_events where details->'new'->>'club_id'='${club}' order by created_at desc,id desc limit 1)e;`));expect(event.actor_id).toBe(users.owner.id);expect(event.details.new.club_id).toBe(club);expect(JSON.stringify(event)).not.toMatch(/access_token|totp|password/);
  expect((await write(token,{...base,role:'super_admin'})).status()).toBe(400);
  // First-invite order: a dashboard invitee cannot be appointed until the invite link confirms the email,
  // can activate with no club role, sees no club data, and is then found and appointed normally.
  const invitee=`p4-invitee-${club}@club.test`,key=state().serviceKey;
  expect((await localFetch('/auth/v1/invite',{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({email:invitee})})).ok).toBe(true);
  const found=async()=>(await (await request.get(`${baseURL}/api/admin/users?q=${encodeURIComponent(invitee)}`,{headers:{Cookie:`__Host-club_access=${token}`}})).json()).users.find(u=>u.email===invitee);
  const pending=await found();expect(pending.email_confirmed).toBe(false);
  const grant=async()=>write(token,{...base,club_id:other,user_id:pending.id,expected_version:(await context(pending.id)).clubs.find(c=>c.id===other).role_version,request_id:randomUUID()});
  expect((await grant()).status()).toBe(400);
  let mail;for(let i=0;i<40&&!mail;i++){mail=(await (await fetch(`http://127.0.0.1:56324/api/v1/search?query=${encodeURIComponent(`to:${invitee}`)}`)).json()).messages?.[0];if(!mail)await new Promise(r=>setTimeout(r,250));}
  const link=new URL((await (await fetch(`http://127.0.0.1:56324/api/v1/message/${mail.ID}`)).json()).HTML.match(/href="([^"]+)"/)[1].replaceAll('&amp;','&'));
  const activated=await request.post(`${baseURL}/api/auth/verify`,{headers:{Origin:baseURL},data:{type:'invite',token_hash:link.searchParams.get('token_hash')}});expect(activated.status()).toBe(200);
  const inviteeCookie=activated.headers()['set-cookie'].match(/__Host-club_access=[^;]+/)[0];
  for(const path of ['account','members','activity','import-context?date=2026-10-01'])expect((await request.get(`${baseURL}/api/${path}`,{headers:{Cookie:inviteeCookie}})).status()).toBe(403);
  const inviteeToken=inviteeCookie.split('=')[1];
  expect(await (await rest('club_players?select=id',inviteeToken)).json()).toEqual([]);
  expect((await found()).email_confirmed).toBe(true);
  expect((await grant()).status()).toBe(200);
  expect((await (await rest('rpc/club_my_access',inviteeToken,{p_club:other})).json()).roles).toEqual(['admin']);
  // Hold only this synthetic club lock, queue a real request, then revoke MFA while it waits.
  const countBefore=auditCount(),versionBefore=await version();
  const marker='p4-lock-'+club;
  const lockSql=`select id from auth.users where id='${users.admin.id}' for update;select pg_advisory_xact_lock(hashtextextended('${club}',0));select pg_sleep(6) /* ${marker} */;`;
  const child=spawn(process.execPath,['--input-type=module','-e','import {sql} from "./tests/integration/local.mjs";sql('+JSON.stringify(lockSql)+');'],{stdio:'ignore'});
  const finished=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Local lock fixture failed')));});
  await expect.poll(()=>Number(sql(`select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%${marker}%';`))).toBe(1);
  const queued=write(token,{...base,expected_version:versionBefore,request_id:randomUUID()});
  const otherVersion=Number(sql(`select role_version from public.club_clubs where id='${other}';`));
  const queuedReplay=write(token,winner);
  const queuedRow=write(token,{...base,club_id:other,expected_version:otherVersion,request_id:randomUUID()});
  await expect.poll(()=>Number(sql("select count(*) from pg_stat_activity where wait_event='transactionid' and query like '%platform_assign_role%';"))).toBeGreaterThan(0);
  await expect.poll(()=>Number(sql("select count(*) from pg_stat_activity where wait_event='advisory' and query like '%platform_assign_role%';"))).toBeGreaterThan(1);
  expect((await authApi(`factors/${factor.id}`,token,undefined,'DELETE')).ok).toBe(true);
  expect((await queued).status()).toBe(403);expect((await queuedRow).status()).toBe(403);expect((await queuedReplay).status()).toBe(403);expect(Number(sql(`select role_version from public.club_clubs where id='${other}';`))).toBe(otherVersion);await finished;expect(auditCount()).toBe(countBefore);
  expect(Number(sql(`select role_version from public.club_clubs where id='${club}';`))).toBe(versionBefore);await deny(token);
 }finally{sql(`delete from auth.mfa_factors where id='${factor.id}';`);}
});
