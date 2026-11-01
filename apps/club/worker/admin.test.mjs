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

test('P4 writes require platform assignment permission AND live Super Admin activation',async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const body={club_id:id,user_id:id,role:'admin',action:'grant',expected_version:0,request_id:id};
 const post=(data=body,origin='https://club.example')=>new Request('https://club.example/api/admin/assign-role',{method:'POST',headers:{Cookie:'__Host-club_access=access',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
 for(const grant of [access(owner),access(owner,['platform.read'],true),{...access(owner,['platform.roles.assign'],true),super_admin_active:false}]){
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
 const denied=network(access(owner,['platform.roles.assign'],true),[],()=>Response.json({code:'PT409',message:'角色已变化，请刷新'},{status:409}));
 assert.equal((await handleRequest(post(),env,denied)).status,409);
});
