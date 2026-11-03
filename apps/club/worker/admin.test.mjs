import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './index.ts';

const env = { CLUB_ID: 'club-a', SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', ASSETS: { fetch: async () => new Response('shell') } };
const user = { id: 'owner', email: 'owner@example.com', email_confirmed_at: 'date' };
const get = path => new Request(`https://club.example/api/${path}`, { headers: { Cookie: '__Host-club_access=access' } });
const owner = ['absences.resolve','aliases.manage','audit.actor_email.read','audit.read','club.rename','imports.create','imports.delete','members.read'];
// What club_my_access returns: club permissions and platform permissions are separate lists.
const access = (permissions, platform = [], superAdmin = false) => ({ permissions, roles: permissions.length ? ['owner'] : [], super_admin: superAdmin, super_admin_active: platform.length > 0, session_aal2: platform.length > 0, platform_permissions: platform });
const network = (granted, calls = [], result = {}) => async (url, options) => {
  if (url.endsWith('/user')) return Response.json(user);
  if (url.includes('club_my_access')) return Response.json(granted);
  calls.push([new URL(url).pathname, options.body && JSON.parse(options.body)]);
  return typeof result === 'function' ? result(url) : Response.json(result);
};
const paths = ['admin/overview', 'admin/users', 'admin/roles', 'admin/activity'];

test('platform routes need platform.read; every club permission together is not enough, and nothing reaches the database', async () => {
  for (const granted of [access(owner), access(owner, [], true), access([], ['members.read'], true)]) {
    const calls = [];
    for (const path of paths) assert.equal((await handleRequest(get(path), env, network(granted, calls))).status, 403, path);
    assert.deepEqual(calls, []);
  }
});

test('platform.read never satisfies a club route', async () => {
  const calls = [];
  const response = await handleRequest(get('members'), env, network(access([], ['platform.read'], true), calls));
  assert.equal(response.status, 403); assert.deepEqual(calls, []);
});

test('each platform route calls its own reader with validated, bounded input', async () => {
  const calls = [], net = network(access(owner, ['platform.read'], true), calls, { ok: true });
  for (const path of ['admin/overview', 'admin/roles', 'admin/users?q=%20Bob%20', 'admin/activity']) assert.equal((await handleRequest(get(path), env, net)).status, 200, path);
  assert.deepEqual(calls, [
    ['/rest/v1/rpc/platform_overview', {}], ['/rest/v1/rpc/platform_roles', {}],
    ['/rest/v1/rpc/platform_users', { p_query: 'Bob', p_after_key: null, p_after_id: null }],
    ['/rest/v1/rpc/platform_activity', { p_before: null, p_id: null }],
  ]);
  const id = '00000000-0000-4000-8000-000000000001';
  for (const bad of [`admin/users?q=${'a'.repeat(101)}`, `admin/users?after=x`, `admin/users?after=x&id=nope`, 'admin/activity?before=2026-01-01T00:00:00Z', `admin/activity?before=yesterday&id=${id}`])
    assert.equal((await handleRequest(get(bad), env, net)).status, 400, bad);
  assert.equal(calls.length, 4);
});

test('the database refusing (e.g. the device was just removed) is a 403, and the cache key changes with platform access', async () => {
  const denied = network(access(owner, ['platform.read'], true), [], () => Response.json({ code: '42501', message: '需要超级管理员权限' }, { status: 403 }));
  const response = await handleRequest(get('admin/overview'), env, denied);
  assert.equal(response.status, 403); assert.equal((await response.json()).error, '需要超级管理员权限');
  const scope = async granted => (await handleRequest(get('account'), env, network(granted))).headers.get('X-Club-Scope');
  assert.notEqual(await scope(access(owner, ['platform.read'], true)), await scope(access(owner, [], true)));
  const account = await (await handleRequest(get('account'), env, network(access(owner, ['platform.read'], true)))).json();
  assert.deepEqual(account.platform_permissions, ['platform.read']);
});

// Stage E: the database grants platform.roles.assign only to an active Super Admin or an active platform admin (own TOTP
// session); the Worker requires that permission and never infers it from the Super Admin flag.
test('role writes require the live platform assignment permission (Super Admin or platform admin)',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const body={club_id:id,user_id:id,role:'admin',action:'grant',expected_version:0,request_id:id};
 const post=(data=body,origin='https://club.example')=>new Request('https://club.example/api/admin/assign-role',{method:'POST',headers:{Cookie:'__Host-club_access=access',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
 for(const grant of [access(owner),access(owner,['platform.read'],true),{...access(owner,[],true),super_admin:true},{...access(owner,[]),platform_admin:true}]){
  const calls=[];assert.equal((await handleRequest(post(),env,network(grant,calls))).status,403);assert.deepEqual(calls,[]);
 }
 const calls=[],net=network(access(owner,['platform.roles.assign'],true),calls,{ok:true});
 assert.equal((await handleRequest(post(),env,net)).status,200);
 assert.deepEqual(calls[0],['/rest/v1/rpc/platform_assign_role',{p_club:id,p_user:id,p_role:'admin',p_action:'grant',p_expected:0,p_request:id}]);
 assert.equal((await handleRequest(post(body,'https://evil.example'),env,net)).status,403);
 for(const bad of [{...body,role:'super_admin'},{...body,action:'transfer'},{...body,expected_version:-1},{...body,user_id:'nickname'},{...body,unexpected:true},null])assert.equal((await handleRequest(post(bad),env,net)).status,400);
 assert.equal(calls.length,1);
 assert.equal((await handleRequest(get('admin/role-context?user='+id),env,net)).status,200);
 assert.deepEqual(calls[1],['/rest/v1/rpc/platform_role_context',{p_user:id}]);
 // An active platform admin (no Super Admin activation) reaches the same RPC; the database applies its own rules.
 const asPlatformAdmin=[];
 assert.equal((await handleRequest(post(),env,network({...access([],['platform.read','platform.roles.assign']),super_admin_active:false,platform_admin:true},asPlatformAdmin,{ok:true}))).status,200);
 assert.equal(asPlatformAdmin[0][0],'/rest/v1/rpc/platform_assign_role');
 const denied=network(access(owner,['platform.roles.assign'],true),[],()=>Response.json({code:'PT409',message:'角色已变化，请刷新'},{status:409}));
 assert.equal((await handleRequest(post(),env,denied)).status,409);
});

test('stage A: transfer needs an explicit choice for the previous owner, and only goes through transfer-owner',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const post=(path,data)=>new Request(`https://club.example/api/admin/${path}`,{method:'POST',headers:{Cookie:'__Host-club_access=access',Origin:'https://club.example','Content-Type':'application/json'},body:JSON.stringify(data)});
 const calls=[],net=network(access(owner,['platform.roles.assign'],true),calls,{ok:true});
 // The old implicit transfer (previous owner silently dropped) is not offered by this Worker.
 assert.equal((await handleRequest(post('assign-role',{club_id:id,user_id:id,role:'owner',action:'transfer',expected_version:0,request_id:id}),env,net)).status,400);
 const transfer={club_id:id,user_id:id,previous_owner:'admin',expected_version:3,request_id:id};
 for(const bad of [{...transfer,previous_owner:undefined},{...transfer,previous_owner:null},{...transfer,previous_owner:'stay'},{...transfer,role:'owner'},{...transfer,expected_version:'3'}])
  assert.equal((await handleRequest(post('transfer-owner',bad),env,net)).status,400,JSON.stringify(bad));
 assert.deepEqual(calls,[]);
 for(const previous of ['admin','leave'])assert.equal((await handleRequest(post('transfer-owner',{...transfer,previous_owner:previous}),env,net)).status,200);
 assert.deepEqual(calls,[['/rest/v1/rpc/platform_transfer_owner',{p_club:id,p_user:id,p_previous_owner:'admin',p_expected:3,p_request:id}],
  ['/rest/v1/rpc/platform_transfer_owner',{p_club:id,p_user:id,p_previous_owner:'leave',p_expected:3,p_request:id}]]);
 const removal={club_id:id,user_id:id,expected_version:3,request_id:id};
 assert.equal((await handleRequest(post('remove-from-club',{...removal,role:'admin'}),env,net)).status,400);
 assert.equal((await handleRequest(post('remove-from-club',removal),env,net)).status,200);
 assert.deepEqual(calls.at(-1),['/rest/v1/rpc/platform_remove_from_club',{p_club:id,p_user:id,p_expected:3,p_request:id}]);
 // Without the live platform permission nothing reaches the database, whatever the identity flags say.
 const denied=[];
 for(const [path,data] of [['transfer-owner',transfer],['remove-from-club',removal]])
  for(const grant of [{...access(owner,[],true),super_admin:true},{...access(owner,[]),platform_admin:true}])
   assert.equal((await handleRequest(post(path,data),env,network(grant,denied))).status,403);
 assert.deepEqual(denied,[]);
});

test('stage A: the admin limit needs its own platform permission (role assignment is not enough) and a bounded integer',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const post=data=>new Request('https://club.example/api/admin/admin-limit',{method:'POST',headers:{Cookie:'__Host-club_access=access',Origin:'https://club.example','Content-Type':'application/json'},body:JSON.stringify(data)});
 const denied=[];
 assert.equal((await handleRequest(post({club_id:id,admin_limit:3}),env,network(access(owner,['platform.read','platform.roles.assign'],true),denied))).status,403);
 assert.deepEqual(denied,[]);
 const calls=[],net=network(access(owner,['platform.clubs.admin_limit'],true),calls,{changed:true});
 for(const bad of [{club_id:id,admin_limit:0},{club_id:id,admin_limit:1001},{club_id:id,admin_limit:2.5},{club_id:id,admin_limit:'3'},{club_id:'x',admin_limit:3},{club_id:id}])
  assert.equal((await handleRequest(post(bad),env,net)).status,400,JSON.stringify(bad));
 assert.equal((await handleRequest(post({club_id:id,admin_limit:3}),env,net)).status,200);
 assert.deepEqual(calls,[['/rest/v1/rpc/platform_set_admin_limit',{p_club:id,p_limit:3}]]);
});

test('stage B: permission settings writes need platform.permissions.manage AND live activation; input is exact and bounded',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const post=(path,data,origin='https://club.example')=>new Request(`https://club.example/api/admin/${path}`,{method:'POST',headers:{Cookie:'__Host-club_access=access',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
 const role={layer:'cap',role:'admin',permission:'imports.delete',value:false},personal={club_id:id,user_id:id,permission:'members.read',value:null};
 // Reading, assigning roles or setting the admin limit is not enough; nor is the permission without live activation.
 for(const grant of [access(owner),access(owner,['platform.read','platform.roles.assign','platform.clubs.admin_limit'],true),{...access(owner,['platform.permissions.manage'],true),super_admin_active:false}]){
  const calls=[];
  for(const [path,data] of [['role-permission',role],['personal-permission',personal]])assert.equal((await handleRequest(post(path,data),env,network(grant,calls))).status,403,path);
  assert.deepEqual(calls,[]);
 }
 const calls=[],net=network(access(owner,['platform.permissions.manage'],true),calls,{changed:true});
 assert.equal((await handleRequest(post('role-permission',role,'https://evil.example'),env,net)).status,403);
 for(const bad of [{...role,value:null},{...role,layer:'owner_override'},{...role,role:'super_admin'},{...role,permission:'secret.power'},{...role,club_id:id},
   {...role,layer:'club_default'},{...role,layer:'club_default',club_id:'x'},{...role,value:'false'},{...role,extra:1},null])
  assert.equal((await handleRequest(post('role-permission',bad),env,net)).status,400,JSON.stringify(bad));
 for(const bad of [{...personal,user_id:'nick'},{...personal,value:0},{...personal,set_by:'owner'},{club_id:id,user_id:id,permission:'members.read'}])
  assert.equal((await handleRequest(post('personal-permission',bad),env,net)).status,400,JSON.stringify(bad));
 assert.deepEqual(calls,[]);
 for(const data of [role,{...role,layer:'club_default',club_id:id,value:null}])assert.equal((await handleRequest(post('role-permission',data),env,net)).status,200);
 assert.equal((await handleRequest(post('personal-permission',personal),env,net)).status,200);
 assert.deepEqual(calls,[
  ['/rest/v1/rpc/platform_set_role_permission',{p_layer:'cap',p_role:'admin',p_permission:'imports.delete',p_value:false,p_club:null}],
  ['/rest/v1/rpc/platform_set_role_permission',{p_layer:'club_default',p_role:'admin',p_permission:'imports.delete',p_value:null,p_club:id}],
  ['/rest/v1/rpc/platform_set_personal_permission',{p_club:id,p_user:id,p_permission:'members.read',p_value:null}]]);
 // A database refusal (e.g. non-delegable) keeps its plain message.
 const refused=network(access(owner,['platform.permissions.manage'],true),[],()=>Response.json({code:'PT409',message:'此权限仅限公会长'},{status:409}));
 const response=await handleRequest(post('role-permission',role),env,refused);
 assert.equal(response.status,409);assert.equal((await response.json()).error,'此权限仅限公会长');
});

test('stage B: settings and explanation are platform.read readers with validated ids',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const denied=[];
 for(const path of ['admin/permission-settings',`admin/permission-explain?club=${id}&user=${id}`])assert.equal((await handleRequest(get(path),env,network(access(owner,[],true),denied))).status,403);
 assert.deepEqual(denied,[]);
 const calls=[],net=network(access(owner,['platform.read'],true),calls,{ok:true});
 for(const path of ['admin/permission-settings',`admin/permission-settings?club=${id}`,`admin/permission-explain?club=${id}&user=${id}`])assert.equal((await handleRequest(get(path),env,net)).status,200,path);
 for(const bad of ['admin/permission-settings?club=x',`admin/permission-explain?club=${id}`,`admin/permission-explain?club=x&user=${id}`])assert.equal((await handleRequest(get(bad),env,net)).status,400,bad);
 assert.deepEqual(calls,[['/rest/v1/rpc/platform_permission_settings',{p_club:null}],['/rest/v1/rpc/platform_permission_settings',{p_club:id}],['/rest/v1/rpc/platform_permission_explain',{p_club:id,p_user:id}]]);
});
