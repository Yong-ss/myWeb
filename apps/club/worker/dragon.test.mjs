import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, routePermissions } from './index.ts';

// Dragon Hunt routes: their own permissions (another event type's grant opens nothing here), the club comes only from
// the URL, and out-of-contract input (no participants, extra fields, an unchecked name count) never reaches the
// database, which rechecks everything.
const club = '00000000-0000-4000-8000-0000000000c1', other = '00000000-0000-4000-8000-0000000000c2', id = '00000000-0000-4000-8000-000000000001';
const env = { CLUB_ID: club, SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', ASSETS: { fetch: async () => new Response('shell') } };
const access = (permissions, platform = []) => ({ permissions, roles: ['admin'], super_admin: false, super_admin_active: false, platform_admin: platform.length > 0, session_aal2: platform.length > 0, platform_permissions: platform });
const network = (granted, calls, result = { ok: true }) => async (url, options) => {
  if (url.endsWith('/user')) return Response.json({ id: 'u', email: 'a@example.com', email_confirmed_at: 'date' });
  if (url.includes('club_my_access')) return Response.json(granted);
  calls.push([new URL(url).pathname, options.body && JSON.parse(options.body)]);
  return typeof result === 'function' ? result() : Response.json(result);
};
const headers = { Cookie: '__Host-club_access=access' };
const get = path => new Request(`https://club.example/api/${path}`, { headers });
const post = (path, body) => new Request(`https://club.example/api/${path}`, { method: 'POST', headers: { ...headers, Origin: 'https://club.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const create = { event_date: '2026-10-04', players: [{ player_id: id, read_name: '北忧', remember_alias: false }], unmatched: 2, request_id: id };
const voidIt = { event_id: id, expected_version: 1, request_id: id };
const all = ['dragon.read', 'dragon.import', 'dragon.edit'];

test('every dragon route declares its own permission per method', () => {
  assert.deepEqual(routePermissions['/api/dragon-events'], { GET: 'dragon.read', POST: 'dragon.import' });
  assert.deepEqual(routePermissions['/api/dragon-event'], { GET: 'dragon.read', POST: 'dragon.edit' });
  assert.deepEqual(routePermissions['/api/player-dragon'], { GET: 'dragon.read' });
  assert.deepEqual(routePermissions['/api/dragon-identities'], { GET: 'dragon.import' });
  assert.deepEqual(routePermissions['/api/admin/dragon-permissions'], { GET: 'platform.dragon.permissions' });
  assert.deepEqual(routePermissions['/api/admin/dragon-permission'], { POST: 'platform.dragon.permissions' });
});

test('other event grants never open dragon routes; read alone cannot import or void', async () => {
  const other_grants = access(['events.read', 'events.import', 'events.edit', 'highland.read', 'highland.import', 'highland.edit']);
  const cases = [[other_grants, get('dragon-events')], [other_grants, post('dragon-events', create)], [other_grants, get(`player-dragon?player=${id}`)],
    [access(['dragon.read']), post('dragon-events', create)], [access(['dragon.read']), post('dragon-event', voidIt)], [access(['dragon.read']), get('dragon-identities')],
    [access([], ['platform.highland.permissions']), get(`admin/dragon-permissions?club=${club}`)]];
  for (const [granted, request] of cases) {
    const calls = [];
    assert.equal((await handleRequest(request, env, network(granted, calls))).status, 403, request.url);
    assert.deepEqual(calls, []);
  }
});

test('reads and writes reach the dragon RPCs with the URL club and validated fields only', async () => {
  const calls = [];
  for (const request of [get(`dragon-events?club=${other}&voided=1&before=2026-10-08&id=${id}`), get(`dragon-event?club=${other}&id=${id}`), get(`player-dragon?club=${other}&player=${id}`),
    get(`dragon-identities?club=${other}`), post(`dragon-events?club=${other}`, create), post(`dragon-event?club=${other}`, voidIt)])
    assert.equal((await handleRequest(request, env, network(access(all), calls))).status, 200, request.url);
  assert.deepEqual(calls.map(c => c[0]), ['/rest/v1/rpc/club_dragon_list', '/rest/v1/rpc/club_dragon_detail', '/rest/v1/rpc/club_player_dragon', '/rest/v1/rpc/club_dragon_identities',
    '/rest/v1/rpc/club_dragon_create', '/rest/v1/rpc/club_dragon_void']);
  assert.ok(calls.every(c => c[1].p_club === other));
  assert.deepEqual(calls[4][1], { p_club: other, p_date: '2026-10-04', p_players: create.players, p_unmatched: 2, p_request: id });
  assert.deepEqual(calls[5][1], { p_club: other, p_event: id, p_expected: 1, p_request: id });
});

test('out-of-contract input is refused before the database', async () => {
  const calls = [];
  const bad = [post('dragon-events', { ...create, club_id: club }), post('dragon-events', { ...create, players: [] }), post('dragon-events', { ...create, unmatched: -1 }),
    post('dragon-events', { ...create, unmatched: 1.5 }), post('dragon-events', { ...create, event_date: '2026-02-30' }), post('dragon-events', { ...create, raw_text: '{}' }),
    post('dragon-event', { ...voidIt, action: 'restore' }), post('dragon-event', { ...voidIt, event_id: 'x' }), get('dragon-event?id=nope'), get('player-dragon?player=x')];
  for (const request of bad) assert.equal((await handleRequest(request, env, network(access(all), calls))).status, 400, request.url);
  assert.deepEqual(calls, []);
});

test('platform dragon settings accept dragon keys only and use their own RPC', async () => {
  const calls = [];
  const granted = access([], ['platform.read', 'platform.dragon.permissions']);
  const ok = { club_id: club, role: 'admin', user_id: null, permission: 'dragon.edit', value: false };
  assert.equal((await handleRequest(post('admin/dragon-permission', ok), env, network(granted, calls))).status, 200);
  assert.deepEqual(calls[0], ['/rest/v1/rpc/platform_set_dragon_permission', { p_club: club, p_role: 'admin', p_user: null, p_permission: 'dragon.edit', p_value: false }]);
  assert.equal((await handleRequest(post('admin/dragon-permission', { ...ok, permission: 'highland.edit' }), env, network(granted, calls))).status, 400);
  assert.equal((await handleRequest(get(`admin/dragon-permissions?club=${club}`), env, network(granted, calls))).status, 200);
  assert.equal(calls.at(-1)[0], '/rest/v1/rpc/platform_dragon_permissions');
});
