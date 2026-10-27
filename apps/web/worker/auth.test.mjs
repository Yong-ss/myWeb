import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleRequest } from './index.ts';

const env = { OWNER_USER_ID: 'owner', SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', ASSETS: { fetch: async () => new Response('public') } };
const request = (path, body, cookie, origin = 'https://site.example') => new Request(`https://site.example/api/${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const session = (id = 'owner', confirmed = true) => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id, email: 'owner@example.com', email_confirmed_at: confirmed ? 'date' : null } });

test('public assets still work with Cloudflare execution context', async () => {
  assert.equal(await (await worker.fetch(new Request('https://site.example/'), env, {})).text(), 'public');
});
test('anonymous and forged sessions cannot read owner data', async () => {
  assert.equal((await handleRequest(request('account'), env)).status, 401);
  assert.equal((await handleRequest(request('account', null, 'sq_access=fake'), env, async () => new Response(null, { status: 401 }))).status, 401);
});
test('cross-site login is refused before contacting Auth', async () => {
  assert.equal((await handleRequest(request('login', { email: 'a', password: 'b' }, null, 'https://evil.example'), env, () => { throw Error('must not run'); })).status, 403);
});
test('only confirmed owner can log in; tokens stay out of JSON', async () => {
  for (const [id, confirmed, status] of [['owner', true, 200], ['other', true, 403], ['owner', false, 403]]) {
    const response = await handleRequest(request('login', { email: 'a', password: 'b' }), env, async () => Response.json(session(id, confirmed)));
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /access_token|refresh_token/);
    if (status === 200) for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(response.headers.get('Set-Cookie').includes(flag));
  }
});
test('refresh checks owner identity and keeps account response uncached', async () => {
  const response = await handleRequest(request('account', null, 'sq_refresh=refresh'), env, async () => Response.json(session()));
  assert.deepEqual(await response.json(), { email: 'owner@example.com' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await handleRequest(request('account', null, 'sq_refresh=refresh'), env, async () => Response.json(session('other')))).status, 403);
});
test('logout revokes refreshed session even after access cookie expires', async () => {
  const paths = [];
  const response = await handleRequest(request('logout', {}, 'sq_refresh=refresh'), env, async url => { paths.push(url); return Response.json(session()); });
  assert.equal(response.status, 200);
  assert.ok(paths[1].endsWith('logout?scope=local'));
  assert.ok(response.headers.get('Set-Cookie').includes('Max-Age=0'));
});
