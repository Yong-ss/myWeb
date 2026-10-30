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
const mock = (role = 'owner', access = accessFor(role)) => async (url, options) => {
  if (url.includes('/rest/v1/')) {
    assert.equal(options.headers.Authorization, 'Bearer access');
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
    assert.deepEqual(await response.json(), { email: user.email, club_id: 'club-a', roles: [role], permissions: grants[role], super_admin: false, mfa_verified: false, mfa_session: false });
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
  const expected = { login:['POST'], logout:['POST'], account:['GET'], 'import-context':['GET'], imports:['POST'], 'player-aliases':['POST'], 'resolve-absence':['POST'], members:['GET'], 'club-settings':['GET','POST'], activity:['GET'], 'delete-import':['POST'], mfa:['GET','POST'] };
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
  const open = ['/api/login', '/api/logout', '/api/account', '/api/mfa'];
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
  assert.equal((await handleRequest(req('mfa', { action: 'enroll' }, '__Host-club_access=access'), env, network)).status, 200);
  sa = { ...sa, session_aal2: false };
  for (const code of ['12345', '1234567', 'abcdef']) assert.equal((await handleRequest(req('mfa', { action: 'verify', factor_id: '00000000-0000-4000-8000-000000000009', code }, '__Host-club_access=access'), env, network)).status, 400);
  const ok = await handleRequest(req('mfa', { action: 'verify', factor_id: '00000000-0000-4000-8000-000000000009', code: '123456' }, '__Host-club_access=access'), env, network);
  assert.equal(ok.status, 200);
  assert.doesNotMatch(await ok.text(), /123456|aal2-token|access_token/);
  assert.ok(ok.headers.get('Set-Cookie').includes('__Host-club_access=aal2-token'));
  assert.ok(seen.some(([url, sent]) => url.endsWith('/verify') && JSON.parse(sent).challenge_id === 'challenge'));
});
