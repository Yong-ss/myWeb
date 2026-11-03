import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, routePermissions } from './index.ts';

// Stage C owner routes: the route table must demand the owner-only powers, the club must always be CLUB_ID, and bad
// input must never reach the database. A missing declaration here would let any admin call the owner RPCs.
const club = '00000000-0000-4000-8000-0000000000c1', id = '00000000-0000-4000-8000-000000000001';
const env = { CLUB_ID: club, SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', ASSETS: { fetch: async () => new Response('shell') } };
const admin = ['absences.resolve', 'aliases.manage', 'audit.read', 'imports.create', 'imports.delete', 'members.read'];
const owner = [...admin, 'club.admins.manage', 'club.admins.permissions', 'club.rename'];
const access = (permissions, platform = []) => ({ permissions, roles: ['owner'], super_admin: platform.length > 0, super_admin_active: platform.length > 0, session_aal2: false, platform_permissions: platform });
const network = (granted, calls, result = { ok: true }) => async (url, options) => {
  if (url.endsWith('/user')) return Response.json({ id: 'u', email: 'o@example.com', email_confirmed_at: 'date' });
  if (url.includes('club_my_access')) return Response.json(granted);
  calls.push([new URL(url).pathname, options.body && JSON.parse(options.body)]);
  return typeof result === 'function' ? result() : Response.json(result);
};
const get = path => new Request(`https://club.example/api/${path}`, { headers: { Cookie: '__Host-club_access=access' } });
const post = (path, body) => new Request(`https://club.example/api/${path}`, { method: 'POST', headers: { Cookie: '__Host-club_access=access', Origin: 'https://club.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const role = { user_id: id, action: 'grant', expected_version: 3, request_id: id };

test('every team route declares an owner-only permission', () => {
  assert.deepEqual(routePermissions['/api/team'], { GET: 'club.admins.manage' });
  assert.deepEqual(routePermissions['/api/team/candidate'], { GET: 'club.admins.manage' });
  assert.deepEqual(routePermissions['/api/team/role'], { POST: 'club.admins.manage' });
  assert.deepEqual(routePermissions['/api/team/permissions'], { GET: 'club.admins.permissions' });
  assert.deepEqual(routePermissions['/api/team/default'], { POST: 'club.admins.permissions' });
  assert.deepEqual(routePermissions['/api/team/personal'], { POST: 'club.admins.permissions' });
});

test('an admin (every delegable permission) and a platform-only Super Admin are refused before the database', async () => {
  for (const granted of [access(admin), access([], ['platform.read', 'platform.roles.assign', 'platform.permissions.manage'])]) {
    const calls = [];
    for (const request of [get('team'), get('team/permissions'), get('team/candidate?email=a@b.c'), post('team/role', role),
      post('team/default', { permission: 'club.rename', value: true }), post('team/personal', { user_id: id, permission: 'club.rename', value: true })])
      assert.equal((await handleRequest(request, env, network(granted, calls))).status, 403, request.url);
    assert.deepEqual(calls, []);
  }
  // The two powers are separate: holding one does not open the other's routes.
  const calls = [];
  assert.equal((await handleRequest(get('team/permissions'), env, network(access([...admin, 'club.admins.manage']), calls))).status, 403);
  assert.equal((await handleRequest(get('team'), env, network(access([...admin, 'club.admins.permissions']), calls))).status, 403);
  assert.deepEqual(calls, []);
});

test('the owner reaches each RPC with CLUB_ID and exactly the validated fields', async () => {
  const calls = [], net = network(access(owner), calls);
  for (const request of [get('team'), get('team/permissions'), get('team/candidate?email=%20A@b.c%20'), post('team/role', role), post('team/role', { ...role, action: 'remove' }),
    post('team/default', { permission: 'club.rename', value: null }), post('team/personal', { user_id: id, permission: 'audit.read', value: false })])
    assert.equal((await handleRequest(request, env, net)).status, 200, request.url);
  assert.deepEqual(calls, [
    ['/rest/v1/rpc/club_team_admins', { p_club: club }],
    ['/rest/v1/rpc/club_team_permissions', { p_club: club }],
    ['/rest/v1/rpc/club_admin_candidate', { p_club: club, p_email: 'A@b.c' }],
    ['/rest/v1/rpc/club_change_admin', { p_club: club, p_user: id, p_action: 'grant', p_expected: 3, p_request: id }],
    ['/rest/v1/rpc/club_change_admin', { p_club: club, p_user: id, p_action: 'remove', p_expected: 3, p_request: id }],
    ['/rest/v1/rpc/club_set_admin_default', { p_club: club, p_permission: 'club.rename', p_value: null }],
    ['/rest/v1/rpc/club_set_admin_permission', { p_club: club, p_user: id, p_permission: 'audit.read', p_value: false }],
  ]);
});

test('a client club id, extra or missing keys, owner actions outside the admin role and unknown permissions are refused', async () => {
  const calls = [], net = network(access(owner), calls);
  for (const [path, body] of [
    ['team/role', { ...role, club_id: id }], ['team/role', { ...role, role: 'owner' }], ['team/role', { ...role, action: 'transfer' }],
    ['team/role', { ...role, user_id: 'x' }], ['team/role', { ...role, expected_version: -1 }], ['team/role', { user_id: id, action: 'grant', request_id: id }],
    ['team/default', { permission: 'club.rename', value: true, club_id: id }], ['team/default', { permission: 'no.such', value: true }],
    ['team/default', { permission: 'club.rename', value: 'yes' }], ['team/default', { permission: 'club.rename', role: 'owner', value: true }],
    ['team/personal', { user_id: id, permission: 'club.rename', value: true, club_id: id }], ['team/personal', { permission: 'club.rename', value: true }],
    ['team/personal', { user_id: id, permission: 'club.rename' }], ['team/personal', [id]]])
    assert.equal((await handleRequest(post(path, body), env, net)).status, 400, JSON.stringify(body));
  for (const bad of ['team/candidate', 'team/candidate?email=ab', `team/candidate?email=${'a'.repeat(320)}@b.c`]) assert.equal((await handleRequest(get(bad), env, net)).status, 400, bad);
  assert.deepEqual(calls, []);
});

test('database refusals keep their meaning (403 / 409 / 400) and their plain message', async () => {
  for (const [code, status] of [['42501', 403], ['PT409', 409], ['22023', 400]]) {
    const response = await handleRequest(post('team/role', role), env, network(access(owner), [], () => Response.json({ code, message: '数据库说明' }, { status: 400 })));
    assert.equal(response.status, status); assert.equal((await response.json()).error, '数据库说明');
  }
});
