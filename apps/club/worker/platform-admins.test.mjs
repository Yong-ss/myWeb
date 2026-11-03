import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, routePermissions } from './index.ts';

// Stage E in the Worker: a platform admin signs in and sets up TOTP without any club role, uses only the platform
// permissions the database computed for this session, and never reaches a Super-Admin-only write even if a
// permission list says so (the Super Admin activation is checked again).
const club = '00000000-0000-4000-8000-0000000000c1', id = '00000000-0000-4000-8000-000000000001';
const env = { CLUB_ID: club, SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', ASSETS: { fetch: async () => new Response('shell') } };
const platformAdmin = (platform = [], extra = {}) => ({ permissions: [], roles: [], super_admin: false, super_admin_active: false, session_aal2: platform.length > 0, platform_admin: true, platform_permissions: platform, ...extra });
const network = (granted, calls = []) => async (url, options) => {
  if (url.endsWith('/user')) return Response.json({ id: 'u', email: 'pa@example.com', email_confirmed_at: 'date', factors: [] });
  if (url.includes('token?grant_type=password')) return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id: 'u', email: 'pa@example.com', email_confirmed_at: 'date' } });
  if (url.includes('club_my_access')) return Response.json(granted);
  if (url.includes('club_my_context')) return Response.json({ clubs: [] });
  if (url.includes('club_my_trusted_factors')) return Response.json([]);
  calls.push([new URL(url).pathname, options.body && JSON.parse(options.body)]);
  return Response.json({ ok: true });
};
const get = path => new Request(`https://club.example/api/${path}`, { headers: { Cookie: '__Host-club_access=access' } });
const post = (path, body, cookie = '__Host-club_access=access') => new Request(`https://club.example/api/${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://club.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('a platform admin without any club role signs in, reads the account and reaches MFA setup', async () => {
  assert.equal((await handleRequest(post('login', { email: 'pa@example.com', password: 'x' }, ''), env, network(platformAdmin()))).status, 200);
  const account = await (await handleRequest(get('account'), env, network(platformAdmin()))).json();
  assert.deepEqual([account.platform_admin, account.super_admin, account.platform_permissions, account.permissions], [true, false, [], []]);
  assert.equal((await handleRequest(get('mfa'), env, network(platformAdmin()))).status, 200);
  // Before MFA: no platform data at all.
  const calls = [];
  for (const path of ['admin/overview', 'admin/users', 'admin/activity']) assert.equal((await handleRequest(get(path), env, network(platformAdmin(), calls))).status, 403, path);
  assert.deepEqual(calls, []);
  // Someone with neither identity nor a club still cannot use MFA.
  assert.equal((await handleRequest(get('mfa'), env, network(platformAdmin([], { platform_admin: false, permissions: ['members.read'] })))).status, 403);
});

test('an active platform admin reads the platform and changes club roles through the platform RPCs', async () => {
  const calls = [], net = network(platformAdmin(['platform.read', 'platform.roles.assign']), calls);
  for (const path of ['admin/overview', 'admin/users', 'admin/roles', 'admin/activity', `admin/role-context?user=${id}`]) assert.equal((await handleRequest(get(path), env, net)).status, 200, path);
  assert.equal((await handleRequest(post('admin/transfer-owner', { club_id: club, user_id: id, previous_owner: 'leave', expected_version: 1, request_id: id }), env, net)).status, 200);
  assert.equal(calls.at(-1)[0], '/rest/v1/rpc/platform_transfer_owner');
});

test('Super-Admin-only writes are refused to a platform admin even with a forged permission list', async () => {
  assert.deepEqual(routePermissions['/api/admin/platform-admin'], { POST: 'platform.platform_admins.assign' });
  // Database lists (incorrectly, e.g. a future bug) the Super-Admin-only permissions: the Worker still requires activation.
  const forged = platformAdmin(['platform.read', 'platform.roles.assign', 'platform.clubs.admin_limit', 'platform.permissions.manage', 'platform.platform_admins.assign']);
  const calls = [];
  const writes = [['admin/platform-admin', { user_id: id, action: 'grant' }], ['admin/admin-limit', { club_id: club, admin_limit: 3 }],
    ['admin/role-permission', { layer: 'cap', role: 'admin', permission: 'imports.delete', value: false }], ['admin/personal-permission', { club_id: club, user_id: id, permission: 'members.read', value: false }]];
  for (const [path, body] of writes) assert.equal((await handleRequest(post(path, body), env, network(forged, calls))).status, 403, path);
  assert.deepEqual(calls, []);
  // Real list for a platform admin: the route table refuses first.
  for (const [path, body] of writes) assert.equal((await handleRequest(post(path, body), env, network(platformAdmin(['platform.read', 'platform.roles.assign']), calls))).status, 403, path);
  assert.deepEqual(calls, []);
});

test('the Super Admin appoints platform admins with an exact request', async () => {
  const sa = { permissions: [], roles: [], super_admin: true, super_admin_active: true, session_aal2: true, platform_admin: false, platform_permissions: ['platform.platform_admins.assign', 'platform.read'] };
  const calls = [];
  assert.equal((await handleRequest(post('admin/platform-admin', { user_id: id, action: 'revoke' }), env, network(sa, calls))).status, 200);
  assert.deepEqual(calls, [['/rest/v1/rpc/platform_set_platform_admin', { p_user: id, p_action: 'revoke' }]]);
  for (const bad of [{ user_id: id }, { user_id: id, action: 'promote' }, { user_id: 'x', action: 'grant' }, { user_id: id, action: 'grant', role: 'super_admin' }, null])
    assert.equal((await handleRequest(post('admin/platform-admin', bad), env, network(sa, calls))).status, 400, JSON.stringify(bad));
  assert.equal(calls.length, 1);
});
