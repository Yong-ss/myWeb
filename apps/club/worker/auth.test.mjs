import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './index.ts';

const env = { CLUB_ID: 'club-a', SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', ASSETS: { fetch: async () => new Response('shell') } };
const user = { id: 'owner', email: 'owner@example.com', email_confirmed_at: 'date' };
const session = { user, access_token: 'access', refresh_token: 'refresh', expires_in: 3600 };
const req = (path, body, cookie = '', origin = 'https://club.example') => new Request(`https://club.example/api/${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
// What the database's club_my_access returns for each seeded role (owner renames; admin does not).
const grants = { owner: ['absences.resolve','aliases.manage','audit.read','club.rename','imports.create','imports.delete','members.read'], admin: ['absences.resolve','aliases.manage','audit.read','imports.create','imports.delete','members.read'] };
const accessFor = role => ({ permissions: grants[role] ?? [], roles: grants[role] ? [role] : [], super_admin: false, super_admin_active: false });
const mock = (role = 'owner', access = accessFor(role), others = grants[role] ? [{ id: 'club-a', name: 'A', roles: [role] }] : []) => async (url, options) => {
  if (url.includes('/rest/v1/')) {
    assert.equal(options.headers.Authorization, 'Bearer access');
    // Account-wide context takes no user or club from the client.
    if (url.endsWith('/rest/v1/rpc/club_my_context')) { assert.equal(options.body, '{}'); return Response.json({ clubs: others }); }
    assert.ok(url.endsWith('/rest/v1/rpc/club_my_access'));
    assert.deepEqual(JSON.parse(options.body), { p_club: 'club-a' });
    return Response.json(access);
  }
  return Response.json(url.endsWith('/user') ? user : session);
};

test('anonymous, forged and main-site cookies cannot read Club account', async () => {
  for (const cookie of ['', 'sq_access=access', '__Host-club_access=fake']) {
    const result = await handleRequest(req('account', null, cookie), env, async () => new Response(null, { status: 401 }));
    assert.equal(result.status, 401);
  }
});
test('login checks current membership and never returns tokens to JavaScript', async () => {
  const response = await handleRequest(req('login', { email: 'a', password: 'b' }), env, mock());
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /access_token|refresh_token/);
  for (const flag of ['__Host-club_access=', 'HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(response.headers.get('Set-Cookie').includes(flag));
  assert.doesNotMatch(response.headers.get('Set-Cookie'), /Domain=/i);
  assert.equal((await handleRequest(req('login', { email: 'a', password: 'b' }), env, mock(null))).status, 403);
});
test('membership revocation applies to an already valid session', async () => {
  const request = req('account', null, '__Host-club_access=access');
  for (const role of ['owner', 'admin']) {
    const response = await handleRequest(request, env, mock(role));
    assert.deepEqual(await response.json(), { email: user.email, club_id: 'club-a', roles: [role], permissions: grants[role], super_admin: false, mfa_verified: false, mfa_session: false, platform_permissions: [], clubs: [{ id: 'club-a', name: 'A', roles: [role] }] });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal((await handleRequest(request, env, mock(null))).status, 403);
  assert.equal((await handleRequest(request, env, mock('super_admin'))).status, 403);
  // Unknown keys from the database are dropped, never trusted as permissions.
  assert.equal((await handleRequest(request, env, mock('x', { permissions: ['everything', 'members.reed'], roles: ['x'] }))).status, 403);
});
test('refresh rechecks membership and updates isolated cookies', async () => {
  const response = await handleRequest(req('account', null, '__Host-club_refresh=refresh'), env, mock());
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('Set-Cookie').includes('__Host-club_refresh='));
});
test('membership service failures fail closed', async () => {
  const response = await handleRequest(req('account', null, '__Host-club_access=access'), env, async url => url.endsWith('/user') ? Response.json(user) : new Response(null, { status: 500 }));
  assert.equal(response.status, 502);
});
test('cross-origin POST and unsupported methods are rejected', async () => {
  assert.equal((await handleRequest(req('login', {}, '', 'https://evil.example'), env)).status, 403);
  assert.equal((await handleRequest(req('account', {}), env)).status, 405);
  assert.equal((await handleRequest(req('not-implemented', {}), env)).status, 404);
});
test('unconfirmed accounts and invalid/oversized inputs are rejected', async () => {
  const response = await handleRequest(req('login', { email: 'a', password: 'b' }), env, async () => Response.json({ ...session, user: { ...user, email_confirmed_at: null } }));
  assert.equal(response.status, 403);
  assert.equal((await handleRequest(req('login', {}), env)).status, 400);
  assert.equal((await handleRequest(req('login', { email: 'a', password: 'b'.repeat(5000) }), env)).status, 413);
});
test('logout revokes only Club session and clears its cookies', async () => {
  const urls = [];
  const response = await handleRequest(req('logout', {}, '__Host-club_refresh=refresh'), env, async url => { urls.push(url); return Response.json(session); });
  assert.equal(response.status, 200);
  assert.ok(urls[1].endsWith('logout?scope=local'));
  assert.ok(response.headers.get('Set-Cookie').includes('Max-Age=0'));
});
test('every route accepts only its own methods, so a missed entry cannot fall through to account data', async () => {
  const expected = { login:['POST'], logout:['POST'], account:['GET'], 'import-context':['GET'], imports:['POST'], 'player-aliases':['POST'], 'resolve-absence':['POST'], members:['GET'], 'club-settings':['GET','POST'], activity:['GET'], 'delete-import':['POST'], mfa:['GET','POST'], 'admin/overview':['GET'], 'admin/users':['GET'], 'admin/roles':['GET'], 'admin/activity':['GET'] };
  for (const [path, methods] of Object.entries(expected)) for (const method of ['GET','POST','PUT','DELETE']) {
    const response = await handleRequest(new Request(`https://club.example/api/${path}`, { method, headers: { Origin: 'https://club.example', 'Content-Type': 'application/json' } }), env, async () => new Response(null, { status: 401 }));
    if (methods.includes(method)) assert.notEqual(response.status, 405, `${method} ${path}`); else assert.equal(response.status, 405, `${method} ${path}`);
  }
  for (const path of ['constructor', '__proto__', 'toString']) assert.equal((await handleRequest(req(path), env)).status, 404, path);
});
test('unexpected handler errors are logged without secrets and still fail closed with 502', async () => {
  const logged = []; const original = console.error; console.error = line => logged.push(line);
  try {
    const response = await handleRequest(req('members', null, '__Host-club_access=secret-token'), env, async url => {
      if (url.endsWith('/user')) return Response.json(user);
      if (url.includes('club_my_access')) return Response.json(accessFor('owner'));
      // A 200 with a non-JSON body makes the handler's response.json() throw.
      return new Response('<html>proxy page</html>', { status: 200 });
    });
    assert.equal(response.status, 502);
    assert.equal(logged.length, 1);
    const entry = JSON.parse(logged[0]);
    assert.equal(entry.event, 'club_api_error'); assert.equal(entry.path, '/api/members'); assert.match(entry.error, /Error/);
    assert.doesNotMatch(logged[0], /secret-token|Cookie|owner@example/);
  } finally { console.error = original; }
});

test('every business route declares its permission and the Worker enforces it before any business call', async () => {
  const { routePermissions } = await import('./index.ts');
  const { permissions } = await import('../src/domain/permissions.ts');
  const open = ['/api/login', '/api/logout', '/api/account', '/api/mfa', '/api/auth/verify', '/api/auth/recover', '/api/auth/password'];
  for (const [path, declared] of Object.entries(routePermissions)) {
    if (open.includes(path)) { assert.equal(declared, undefined, path); continue; }
    assert.ok(declared && Object.values(declared).every(p => permissions.includes(p)), path);
  }
  // A Manager (admin) cannot reach the rename RPC; a read-only role cannot import, delete or read audit.
  const calls = [];
  const network = access => async url => {
    if (url.endsWith('/user')) return Response.json(user);
    if (url.includes('club_my_access')) return Response.json(access);
    calls.push(url); return Response.json([{ name: 'x' }]);
  };
  const post = (path, body) => req(path, body, '__Host-club_access=access');
  assert.equal((await handleRequest(post('club-settings', { name: 'y', expected_name: 'x' }), env, network(accessFor('admin')))).status, 403);
  const reader = { permissions: ['members.read'], roles: ['reader'], super_admin: false, super_admin_active: false };
  for (const [path, body] of [['imports', {}], ['delete-import', {}], ['player-aliases', {}], ['resolve-absence', {}], ['activity', null], ['import-context?date=2026-01-01', null]])
    assert.equal((await handleRequest(body ? post(path, body) : req(path, null, '__Host-club_access=access'), env, network(reader))).status, 403, path);
  assert.deepEqual(calls, []);
  const settings = await handleRequest(req('club-settings', null, '__Host-club_access=access'), env, network(reader));
  assert.deepEqual(await settings.json(), { name: 'x', can_edit: false });
  // The cache key changes with the permission set, so a downgrade cannot reuse cached reads.
  const a = (await handleRequest(req('account', null, '__Host-club_access=access'), env, mock('owner'))).headers.get('X-Club-Scope');
  const b = (await handleRequest(req('account', null, '__Host-club_access=access'), env, mock('admin'))).headers.get('X-Club-Scope');
  assert.notEqual(a, b);
});
test('MFA endpoints exist only for the Super Admin and never echo codes or tokens', async () => {
  assert.equal((await handleRequest(req('mfa', null, '__Host-club_access=access'), env, mock('owner'))).status, 403);
  let sa = { permissions: grants.owner, roles: ['owner'], super_admin: true, super_admin_active: false, session_aal2: false };
  const seen = [];
  const network = async (url, options) => {
    if (url.includes('club_my_access')) return Response.json(sa);
    if (url.includes('club_my_trusted_factors')) return Response.json([]);
    seen.push([url, options.body]);
    if (url.endsWith('/user')) return Response.json({ ...user, factors: [{ id: '00000000-0000-4000-8000-000000000009', factor_type: 'totp', status: 'verified', friendly_name: 'phone' }] });
    if (url.endsWith('/factors')) return Response.json({ id: 'f', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg"/>', secret: 'S' } });
    if (url.endsWith('/challenge')) return Response.json({ id: 'challenge' });
    if (url.endsWith('/verify')) return Response.json({ ...session, access_token: 'aal2-token' });
    return Response.json({});
  };
  const list = await handleRequest(req('mfa', null, '__Host-club_access=access'), env, network);
  // A verified but unconfirmed factor is flagged so the owner knows the SQL Editor step is still due.
  assert.deepEqual((await list.json()).factors.map(f => [f.id, f.trusted]), [['00000000-0000-4000-8000-000000000009', false]]);
  // With a verified factor, only an aal2 session may add another; a stolen password alone cannot.
  assert.equal((await handleRequest(req('mfa', { action: 'enroll' }, '__Host-club_access=access'), env, network)).status, 403);
  sa = { ...sa, session_aal2: true };
  // Auth returns raw SVG; it must reach the page as a local data: URL, never a path the browser would request.
  const enrolled = await (await handleRequest(req('mfa', { action: 'enroll' }, '__Host-club_access=access'), env, network)).json();
  assert.match(enrolled.qr_code, /^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
  sa = { ...sa, session_aal2: false };
  for (const code of ['12345', '1234567', 'abcdef']) assert.equal((await handleRequest(req('mfa', { action: 'verify', factor_id: '00000000-0000-4000-8000-000000000009', code }, '__Host-club_access=access'), env, network)).status, 400);
  const ok = await handleRequest(req('mfa', { action: 'verify', factor_id: '00000000-0000-4000-8000-000000000009', code: '123456' }, '__Host-club_access=access'), env, network);
  assert.equal(ok.status, 200);
  assert.doesNotMatch(await ok.text(), /123456|aal2-token|access_token/);
  assert.ok(ok.headers.get('Set-Cookie').includes('__Host-club_access=aal2-token'));
  assert.ok(seen.some(([url, sent]) => url.endsWith('/verify') && JSON.parse(sent).challenge_id === 'challenge'));
});

// Email links: the one-time token is spent only by an explicit POST, and the recover form must not reveal accounts.
test('email link flows verify by POST, set own password, and hide account existence', async () => {
  const calls = [];
  const auth = status => async (url, options) => { calls.push([url, options.method, options.body, options.headers.Authorization]); return status === 200 ? Response.json(url.includes('/verify') ? session : user) : new Response('{}', { status }); };
  assert.equal((await handleRequest(new Request('https://club.example/api/auth/verify'), env, auth(200))).status, 405);
  const ok = await handleRequest(req('auth/verify', { type: 'invite', token_hash: 'abc-1' }), env, auth(200));
  assert.deepEqual(await ok.json(), { ok: true, set_password: true });
  assert.ok(ok.headers.get('Set-Cookie').includes('__Host-club_access=access'));
  assert.equal((await handleRequest(req('auth/verify', { type: 'signup', token_hash: 'abc' }), env, auth(200))).status, 400);
  assert.equal((await handleRequest(req('auth/verify', { type: 'recovery', token_hash: 'used' }), env, auth(403))).status, 400);
  for (const status of [200, 400]) assert.deepEqual(await (await handleRequest(req('auth/recover', { email: 'x@example.com' }), env, auth(status))).json(), { ok: true });
  assert.ok(calls.some(([url]) => url.endsWith('/recover?redirect_to=' + encodeURIComponent('https://club.example/auth/confirm'))));
  assert.equal((await handleRequest(req('auth/password', { password: 'longenough' }), env, auth(200))).status, 401);
  assert.equal((await handleRequest(req('auth/password', { password: 'short' }, '__Host-club_access=access'), env, auth(200))).status, 400);
  calls.length = 0;
  assert.equal((await handleRequest(req('auth/password', { password: 'longenough' }, '__Host-club_access=access'), env, auth(200))).status, 200);
  assert.deepEqual(calls[0].slice(1), ['PUT', JSON.stringify({ password: 'longenough' }), 'Bearer access']);
  assert.equal((await handleRequest(req('auth/recover', { email: 'x@example.com' }, '', 'https://evil.example'), env, auth(200))).status, 403);
});

// Phase 2: sign-in no longer needs this deployment's club. A role in another club is enough to sign in and read the
// account (with no permissions here); nothing else in this club opens, and no authorization at all still refuses.
test('a role only in another club signs in and reads the account but no club route; no role anywhere is refused', async () => {
  const elsewhere = [{ id: 'club-b', name: 'B', roles: ['admin'] }];
  const onlyB = mock(null, accessFor(null), elsewhere);
  assert.equal((await handleRequest(req('login', { email: 'a', password: 'b' }), env, onlyB)).status, 200);
  const account = await handleRequest(req('account', null, '__Host-club_access=access'), env, onlyB);
  assert.equal(account.status, 200);
  assert.deepEqual(await account.json(), { email: user.email, club_id: 'club-a', roles: [], permissions: [], super_admin: false, mfa_verified: false, mfa_session: false, platform_permissions: [], clubs: elsewhere });
  for (const path of ['members', 'activity', 'club-settings', 'mfa', 'admin/overview', 'import-context?date=2026-01-01'])
    assert.equal((await handleRequest(req(path, null, '__Host-club_access=access'), env, onlyB)).status, 403, path);
  const none = mock(null, accessFor(null), []);
  assert.equal((await handleRequest(req('login', { email: 'a', password: 'b' }), env, none)).status, 403);
  assert.equal((await handleRequest(req('account', null, '__Host-club_access=access'), env, none)).status, 403);
});

// Audit of every authenticated route for an account whose only role is in another club. Iterates the real route table,
// so a route added later is covered too: each must refuse with 403, run no handler and no business query, and keep
// the session (only club_my_access / club_my_context and the Auth user check may be called).
test('every route refuses a role-only-elsewhere account without business calls and keeps its session', async () => {
  const { routeMethods } = await import('./index.ts');
  const open = ['/api/login', '/api/logout', '/api/auth/verify', '/api/auth/recover', '/api/auth/password', '/api/account'];
  const calls = [];
  const network = async (url, options) => {
    calls.push(url.replace('https://auth.example', ''));
    if (url.endsWith('/rpc/club_my_access')) return Response.json(accessFor(null));
    if (url.endsWith('/rpc/club_my_context')) return Response.json({ clubs: [{ id: 'club-b', name: 'B', roles: ['owner'] }] });
    if (url.endsWith('/auth/v1/user')) return Response.json(user);
    return Response.json({ unexpected: true });
  };
  let checked = 0;
  for (const [path, methods] of Object.entries(routeMethods)) {
    if (open.includes(path)) continue;
    for (const method of methods) {
      calls.length = 0;
      const request = new Request(`https://club.example${path}`, { method, headers: { Origin: 'https://club.example', 'Content-Type': 'application/json', Cookie: '__Host-club_access=access' }, ...(method === 'POST' ? { body: '{}' } : {}) });
      const response = await handleRequest(request, env, network);
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.equal(response.headers.get('Set-Cookie'), null, `${method} ${path} must not sign the account out`);
      assert.deepEqual([...new Set(calls)].sort(), ['/auth/v1/user', '/rest/v1/rpc/club_my_access', '/rest/v1/rpc/club_my_context'], `${method} ${path}`);
      checked++;
    }
  }
  assert.ok(checked >= 16, `audited ${checked} route methods`);
});
