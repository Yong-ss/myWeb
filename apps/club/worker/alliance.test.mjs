import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, routePermissions } from './index.ts';

// Stage F in the Worker: an alliance leader signs in without any club role; the alliance routes need the leader
// identity and never take a club or alliance from the client; reading a club goes through the normal club routes,
// where the database's can() decides (read-only), so the Worker adds no alliance shortcut there.
const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b2', id = '00000000-0000-4000-8000-000000000001';
const env = { CLUB_ID: A, SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', ASSETS: { fetch: async () => new Response('shell') } };
const leader = (permissions = [], extra = {}) => ({ permissions, roles: [], super_admin: false, super_admin_active: false, session_aal2: false, platform_admin: false, alliance_leader: true, platform_permissions: [], ...extra });
const network = (granted, calls = []) => async (url, options) => {
  if (url.endsWith('/user')) return Response.json({ id: 'u', email: 'l@example.com', email_confirmed_at: 'date' });
  if (url.includes('token?grant_type=password')) return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id: 'u', email: 'l@example.com', email_confirmed_at: 'date' } });
  const body = options.body && JSON.parse(options.body);
  if (url.includes('club_my_access')) { calls.push(['access', body.p_club]); return Response.json(typeof granted === 'function' ? granted(body.p_club) : granted); }
  if (url.includes('club_my_context')) return Response.json({ clubs: [] });
  calls.push([new URL(url).pathname, body]);
  return Response.json({ ok: true });
};
const get = path => new Request(`https://club.example/api/${path}`, { headers: { Cookie: '__Host-club_access=access' } });
const post = (path, body, cookie = '__Host-club_access=access') => new Request(`https://club.example/api/${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://club.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('a leader without any club role signs in and reads only their own alliance', async () => {
  assert.equal((await handleRequest(post('login', { email: 'l@example.com', password: 'x' }, ''), env, network(leader()))).status, 200);
  assert.equal((await (await handleRequest(get('account'), env, network(leader()))).json()).alliance_leader, true);
  const calls = [];
  assert.equal((await handleRequest(get(`alliance?club=${B}`), env, network(leader(), calls))).status, 200);
  // Account-wide: the club in the URL is ignored, and the RPC takes no alliance or club from the client.
  assert.deepEqual(calls, [['access', A], ['/rest/v1/rpc/club_my_alliance', {}]]);
  // Not a leader: refused before the database.
  const none = [];
  assert.equal((await handleRequest(get('alliance'), env, network(leader(['members.read'], { alliance_leader: false }), none))).status, 403);
  assert.deepEqual(none.filter(c => c[0] !== 'access'), []);
});

test('join decisions: leader only, exact body; the database decides which alliance', async () => {
  assert.deepEqual(routePermissions['/api/alliance/decide'], { POST: 'alliance.joins.decide' });
  const calls = [];
  assert.equal((await handleRequest(post('alliance/decide', { request_id: id, decision: 'approve' }), env, network(leader(), calls))).status, 200);
  assert.deepEqual(calls.at(-1), ['/rest/v1/rpc/alliance_decide_request', { p_request: id, p_decision: 'approve' }]);
  for (const bad of [{ request_id: id }, { request_id: id, decision: 'merge' }, { request_id: 'x', decision: 'approve' }, { request_id: id, decision: 'approve', alliance_id: B }])
    assert.equal((await handleRequest(post('alliance/decide', bad), env, network(leader(), calls))).status, 400, JSON.stringify(bad));
  assert.equal((await handleRequest(post('alliance/decide', { request_id: id, decision: 'approve' }), env, network(leader([], { alliance_leader: false }), []))).status, 403);
});

test('a leader reaches club data only through the club routes, read-only, as the database computed', async () => {
  // can() for the leader: members.read and audit.read in an alliance club, nothing elsewhere.
  const perms = club => leader(club === B ? ['audit.read', 'members.read'] : []);
  // Allowed reads reach their handler (this mock's data shape is not the real one, so only "not refused" is checked).
  for (const path of [`members?club=${B}`, `activity?club=${B}`]) assert.notEqual((await handleRequest(get(path), env, network(perms))).status, 403, path);
  for (const path of [`members?club=${A}`, `import-context?date=2026-10-01&club=${B}`, `team?club=${B}`, `club-alliance?club=${B}`])
    assert.equal((await handleRequest(get(path), env, network(perms))).status, 403, path);
  for (const [path, body] of [['imports', {}], ['delete-import', { date: '2026-10-01', expected_snapshot_id: id, confirmed: true }], ['club-settings', { name: 'x', expected_name: 'y' }], ['team/role', { user_id: id, action: 'grant', expected_version: 0, request_id: id }]]) {
    const calls = [];
    assert.equal((await handleRequest(post(`${path}?club=${B}`, body), env, network(perms, calls))).status, 403, path);
    assert.deepEqual(calls.filter(c => c[0] !== 'access'), []);
  }
});

test('owner join requests: owner permission, exact bodies, the club from the request only', async () => {
  const owner = leader(['club.alliance.request', 'members.read'], { alliance_leader: false });
  const calls = [];
  assert.equal((await handleRequest(post(`club-alliance?club=${B}`, { action: 'request', alliance_id: id }), env, network(owner, calls))).status, 200);
  assert.deepEqual(calls.at(-1), ['/rest/v1/rpc/club_request_alliance', { p_club: B, p_alliance: id }]);
  assert.equal((await handleRequest(post(`club-alliance?club=${B}`, { action: 'withdraw' }), env, network(owner, calls))).status, 200);
  assert.deepEqual(calls.at(-1), ['/rest/v1/rpc/club_withdraw_alliance_request', { p_club: B }]);
  for (const bad of [{ action: 'request' }, { action: 'request', alliance_id: id, club_id: A }, { action: 'leave' }, { action: 'withdraw', alliance_id: id }])
    assert.equal((await handleRequest(post(`club-alliance?club=${B}`, bad), env, network(owner, calls))).status, 400, JSON.stringify(bad));
  assert.equal((await handleRequest(post(`club-alliance?club=${B}`, { action: 'withdraw' }), env, network(leader(['members.read'], { alliance_leader: false }), []))).status, 403);
});

test('platform alliance tools need their platform permissions and exact bodies', async () => {
  const pa = leader([], { alliance_leader: false, platform_admin: true, platform_permissions: ['platform.alliance_leaders.assign', 'platform.alliances.manage', 'platform.read'] });
  const calls = [];
  for (const [path, body, rpc] of [['admin/alliance', { alliance_id: null, name: '联盟', status: 'active' }, 'platform_save_alliance'], ['admin/club-alliance', { club_id: B, alliance_id: null }, 'platform_set_club_alliance'],
    ['admin/alliance-leader', { alliance_id: id, email: 'x@example.com', action: 'grant' }, 'platform_set_alliance_leader'], ['admin/alliance-leader', { alliance_id: id, email: null, action: 'revoke' }, 'platform_set_alliance_leader']]) {
    assert.equal((await handleRequest(post(path, body), env, network(pa, calls))).status, 200, path);
    assert.equal(calls.at(-1)[0], `/rest/v1/rpc/${rpc}`);
  }
  for (const [path, body] of [['admin/alliance', { name: 'x', status: 'active' }], ['admin/alliance', { alliance_id: null, name: 'x', status: 'gone' }], ['admin/club-alliance', { club_id: 'x', alliance_id: null }], ['admin/alliance-leader', { alliance_id: id, email: 'x', action: 'revoke' }]])
    assert.equal((await handleRequest(post(path, body), env, network(pa, calls))).status, 400, path);
  // Without the permission (e.g. a leader, an owner, or a platform admin before MFA): refused before the database.
  for (const who of [leader(), leader(['club.alliance.request']), leader([], { alliance_leader: false, platform_admin: true })]) {
    const none = [];
    assert.equal((await handleRequest(post('admin/alliance', { alliance_id: null, name: 'x', status: 'active' }), env, network(who, none))).status, 403);
    assert.deepEqual(none.filter(c => c[0] !== 'access'), []);
  }
});
