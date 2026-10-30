import {test,expect} from '@playwright/test';
import {createHmac} from 'node:crypto';
import {auth,rest,sql,localFetch,state,clubId,foreignClubId,baseURL,users} from './local.mjs';

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
const allPermissions=['absences.resolve','aliases.manage','audit.actor_email.read','audit.read','club.rename','imports.create','imports.delete','members.read'];

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
  expect(await (await rest('rpc/club_my_permissions',aal2,{p_club:foreignClubId})).json()).toEqual(allPermissions);
  const event=(await (await rest('rpc/club_activity',aal2,{p_club_id:foreignClubId})).json()).events.find(e=>e.action==='authz_foreign');
  expect(event).toMatchObject({actor_label:users.foreign.email,actor_id:users.foreign.id,actor_kind:'member'});
  // P1 adds no Super Admin write power and keeps raw tables closed, even with MFA.
  expect((await rest('rpc/club_rename',aal2,{p_club_id:foreignClubId,p_name:'越权改名',p_expected:'Integration club B'})).status).toBe(403);
  expect((await rest('club_audit_events?select=id',aal2)).status).toBe(403);
  expect((await rest('platform_super_admins?select=user_id',aal2)).status).toBe(403);
 }finally{
  // Restore the account for later specs: verified factors need aal2 to remove.
  if(aal2)expect((await authApi(`factors/${factor.id}`,aal2,undefined,'DELETE')).ok).toBe(true);
  else sql(`delete from auth.mfa_factors where id='${factor.id}';`);
 }
});
