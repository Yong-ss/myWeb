import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './index.ts';

// Stage D: the club comes from each request (?club=). It is only a parameter: access to it is decided by
// club_my_access for that same club, and every RPC/RLS call receives that same club. A tab on club B must never
// read or write club A because of the deployment default, a stale cache or another tab.
const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b2';
const env = { CLUB_ID: A, SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', ASSETS: { fetch: async () => new Response('shell') } };
const perms = ['members.read', 'imports.create', 'club.admins.manage'];
// `allowed`: clubs where this account has permissions. Records which club each access check and RPC was for.
const network = (allowed, calls, superAdmin = false) => async (url, options) => {
  if (url.endsWith('/user')) return Response.json({ id: 'u', email: 'o@example.com', email_confirmed_at: 'date' });
  const body = options.body && JSON.parse(options.body);
  if (url.includes('club_my_access')) { calls.push(['access', body.p_club]); return Response.json({ permissions: allowed.includes(body.p_club) ? perms : [], roles: allowed.includes(body.p_club) ? ['owner'] : [], super_admin: superAdmin, super_admin_active: superAdmin, platform_permissions: superAdmin ? ['platform.read'] : [] }); }
  if (url.includes('club_my_context')) return Response.json({ clubs: allowed.map(id => ({ id, name: id === A ? 'A' : 'B', roles: ['owner'] })) });
  calls.push([new URL(url).pathname, body ?? new URL(url).search]);
  return Response.json(url.includes('club_team_admins') ? { admins: [] } : { players: [], snapshot: null, members: [] });
};
const get = path => new Request(`https://club.example/api/${path}`, { headers: { Cookie: '__Host-club_access=access' } });
const post = (path, body) => new Request(`https://club.example/api/${path}`, { method: 'POST', headers: { Cookie: '__Host-club_access=access', Origin: 'https://club.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('the requested club is the one authorized, passed to the RPC and named in the cache scope', async () => {
  const calls = [];
  const response = await handleRequest(get(`team?club=${B}`), env, network([A, B], calls));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [['access', B], ['/rest/v1/rpc/club_team_admins', { p_club: B }]]);
  assert.match(response.headers.get('X-Club-Scope'), new RegExp(`^u:${B}:`));
  const account = await (await handleRequest(get(`account?club=${B}`), env, network([A, B], []))).json();
  assert.equal(account.club_id, B);
  // Upper-case ids are the same club; the RPC and scope always get one canonical spelling.
  calls.length = 0;
  await handleRequest(get(`team?club=${B.toUpperCase()}`), env, network([A, B], calls));
  assert.deepEqual(calls[0], ['access', B]);
});

test('writes go to the requested club only; the body still cannot name a club', async () => {
  const calls = [];
  const write = { user_id: A, action: 'grant', expected_version: 0, request_id: A };
  assert.equal((await handleRequest(post(`team/role?club=${B}`, write), env, network([B], calls))).status, 200);
  assert.deepEqual(calls[1], ['/rest/v1/rpc/club_change_admin', { p_club: B, p_user: A, p_action: 'grant', p_expected: 0, p_request: A }]);
  calls.length = 0;
  assert.equal((await handleRequest(post(`team/role?club=${B}`, { ...write, club_id: A }), env, network([A, B], calls))).status, 400);
  assert.deepEqual(calls, [['access', B]]);
});

test('a club the account has no role in is refused, not swapped for the default or another club', async () => {
  const calls = [];
  // Owner of A only, asking for B: the default club (A) must not answer in its place.
  for (const path of [`members?club=${B}`, `team?club=${B}`, `import-context?date=2026-10-01&club=${B}`]) {
    const response = await handleRequest(get(path), env, network([A], calls));
    assert.equal(response.status, 403, path);
    assert.equal(response.headers.get('Set-Cookie'), null, 'still signed in: they have club A');
  }
  assert.equal((await handleRequest(post(`imports?club=${B}`, {}), env, network([A], calls))).status, 403);
  assert.ok(calls.every(([kind, club]) => kind === 'access' && club === B), JSON.stringify(calls));
  // The account view for B says plainly: no permissions there.
  const account = await (await handleRequest(get(`account?club=${B}`), env, network([A], []))).json();
  assert.deepEqual([account.club_id, account.permissions, account.roles], [B, [], []]);
});

test('a malformed club is rejected before any database call', async () => {
  for (const club of ['x', `${A}x`, "' or 1=1", '']) {
    const calls = [];
    const response = await handleRequest(get(`members?club=${encodeURIComponent(club)}`), env, network([A], calls));
    assert.equal(response.status, 400, club);
    assert.deepEqual(calls, []);
  }
});

test('requests that name no club keep using the default club (pages opened before this change)', async () => {
  const calls = [];
  assert.equal((await handleRequest(get('team'), env, network([A], calls))).status, 200);
  assert.deepEqual(calls, [['access', A], ['/rest/v1/rpc/club_team_admins', { p_club: A }]]);
  assert.equal((await (await handleRequest(get('account'), env, network([A], []))).json()).club_id, A);
});

test('platform routes ignore ?club for the caller\'s access; their own parameters name the target', async () => {
  const calls = [];
  const response = await handleRequest(get(`admin/overview?club=${B}`), env, network([], calls, true));
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0], ['access', A]);
  // Not even a malformed value changes that, because it is never used as the caller's club.
  assert.equal((await handleRequest(get('admin/overview?club=x'), env, network([], [], true))).status, 200);
  // MFA is account-wide too: the club in its URL is ignored (here: not a Super Admin, so the MFA route refuses).
  calls.length = 0;
  assert.equal((await handleRequest(get(`mfa?club=x`), env, network([A], calls))).status, 403);
  assert.deepEqual(calls, [['access', A]]);
});
