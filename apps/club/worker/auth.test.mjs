import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './index.ts';

const env = { CLUB_ID: 'club-a', SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', ASSETS: { fetch: async () => new Response('shell') } };
const user = { id: 'owner', email: 'owner@example.com', email_confirmed_at: 'date' };
const session = { user, access_token: 'access', refresh_token: 'refresh', expires_in: 3600 };
const req = (path, body, cookie = '', origin = 'https://club.example') => new Request(`https://club.example/api/${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
const mock = (role = 'owner') => async (url, options) => {
  if (url.includes('/rest/v1/')) {
    assert.equal(options.headers.Authorization, 'Bearer access');
    assert.ok(url.includes('club_id=eq.club-a'));
    assert.ok(url.includes('user_id=eq.owner'));
    return Response.json(role ? [{ role }] : []);
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
    assert.deepEqual(await response.json(), { email: user.email, club_id: 'club-a', role });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal((await handleRequest(request, env, mock(null))).status, 403);
  assert.equal((await handleRequest(request, env, mock('super_admin'))).status, 403);
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
  assert.equal((await handleRequest(req('imports', {}), env)).status, 404);
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
