import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, routePermissions } from './index.ts';

// Highland Race routes: their own permissions (a Four-Way League grant opens nothing here, and the reverse), the club
// comes only from the URL, malformed or out-of-contract input (unknown faction, rank 5, no participants, a new
// identity, a raw faction-wide JSON) never reaches the database. The database then rechecks everything.
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
const metrics = { kills: 9, assists: 26, dispersals: 0, awakens: 0, merit: 2846, player_damage: 17080000, damage_taken: 4627000, healing: 0, purification: 0 };
const create = { event_date: '2026-10-04', total_score: 3000, faction: '血皇帝势力', faction_rank: 2, players: [{ player_id: id, output_name: '北忧', strategy_name: '北忧', remember_alias: false, ...metrics }],
  source: { output_rows: 120, strategy_rows: 118, excluded_rows: 110 }, request_id: id };
const update = { event_id: id, expected_version: 2, action: 'faction', payload: { faction: null, faction_rank: 1 }, request_id: id };
const all = ['highland.read', 'highland.import', 'highland.edit'];

test('every highland route declares its own permission per method', () => {
  assert.deepEqual(routePermissions['/api/highland-events'], { GET: 'highland.read', POST: 'highland.import' });
  assert.deepEqual(routePermissions['/api/highland-event'], { GET: 'highland.read', POST: 'highland.edit' });
  assert.deepEqual(routePermissions['/api/player-highland'], { GET: 'highland.read' });
  assert.deepEqual(routePermissions['/api/highland-identities'], { GET: 'highland.read' });
  assert.deepEqual(routePermissions['/api/admin/highland-permissions'], { GET: 'platform.highland.permissions' });
  assert.deepEqual(routePermissions['/api/admin/highland-permission'], { POST: 'platform.highland.permissions' });
});

test('four-way grants never open highland routes and highland grants never open four-way routes', async () => {
  const cases = [[access(['events.read', 'events.import', 'events.edit']), get('highland-events')], [access(['events.read', 'events.import', 'events.edit']), post('highland-events', create)],
    [access(['events.read', 'events.edit']), post('highland-event', update)], [access(['events.read']), get(`player-highland?player=${id}`)],
    [access(all), get('events')], [access(all), get(`event?id=${id}`)], [access(all), get(`player-events?player=${id}`)],
    [access(['highland.read', 'highland.import']), post('highland-event', update)], [access(['highland.read', 'highland.edit']), post('highland-events', create)],
    [access([], ['platform.highland.permissions']), get('highland-events')], [access([], ['platform.events.permissions']), get(`admin/highland-permissions?club=${club}`)]];
  for (const [granted, request] of cases) {
    const calls = [];
    assert.equal((await handleRequest(request, env, network(granted, calls))).status, 403, request.url);
    assert.deepEqual(calls, []);
  }
});

test('reads and writes reach the highland RPCs with the URL club only', async () => {
  const calls = [];
  for (const request of [get(`highland-events?club=${other}&voided=1&before=2026-10-08&id=${id}`), get(`highland-event?club=${other}&id=${id}`), get(`highland-event?club=${other}&id=${id}&version=3`),
    get(`player-highland?club=${other}&player=${id}`), get(`highland-identities?club=${other}`), post(`highland-events?club=${other}`, create), post(`highland-event?club=${other}`, update)])
    assert.equal((await handleRequest(request, env, network(access(all), calls))).status, 200, request.url);
  assert.deepEqual(calls.map(c => c[0]), ['/rest/v1/rpc/club_highland_list', '/rest/v1/rpc/club_highland_detail', '/rest/v1/rpc/club_highland_version', '/rest/v1/rpc/club_player_highland',
    '/rest/v1/rpc/club_highland_identities', '/rest/v1/rpc/club_highland_create', '/rest/v1/rpc/club_highland_update']);
  assert.ok(calls.every(c => c[1].p_club === other));
  assert.deepEqual(calls[5][1], { p_club: other, p_date: '2026-10-04', p_total_score: 3000, p_faction: '血皇帝势力', p_faction_rank: 2, p_players: create.players, p_source: create.source, p_request: id });
  assert.deepEqual(calls[6][1], { p_club: other, p_event: id, p_expected: 2, p_action: 'faction', p_payload: { faction: null, faction_rank: 1 }, p_request: id });
  // Both optional: an import without faction and rank is valid.
  assert.equal((await handleRequest(post('highland-events', { ...create, faction: null, faction_rank: null }), env, network(access(all), calls))).status, 200);
});

test('out-of-contract input is refused before the database', async () => {
  const calls = [];
  const bad = [post('highland-events', { ...create, club_id: club }), post('highland-events', { ...create, players: [] }), post('highland-events', { ...create, faction: '臆造势力' }),
    post('highland-events', { ...create, faction_rank: 5 }), post('highland-events', { ...create, faction_rank: 0 }), post('highland-events', { ...create, faction_rank: '2' }),
    post('highland-events', { ...create, faction: undefined }), post('highland-events', { ...create, source: { output_rows: 1 } }), post('highland-events', { ...create, source: { output_rows: -1, strategy_rows: 1, excluded_rows: 1 } }),
    // The faction-wide AI JSON is never part of the request.
    post('highland-events', { ...create, raw_text: '{}' }), post('highland-events', { ...create, total_score: 1.5 }), post('highland-events', { ...create, event_date: '2026-02-30' }),
    post('highland-event', { ...update, payload: { faction: '臆造势力', faction_rank: null } }), post('highland-event', { ...update, payload: { faction_rank: 9, faction: null } }),
    post('highland-event', { ...update, action: 'delete' }), get('highland-event?id=nope'), get(`highland-event?id=${id}&version=0`), get('player-highland?player=x')];
  for (const request of bad) assert.equal((await handleRequest(request, env, network(access(all), calls))).status, 400, request.url);
  assert.deepEqual(calls, []);
});

test('database answers map to clear statuses: conflict 409, permission 403, missing 404', async () => {
  const fail = (code, message) => () => Response.json({ code, message }, { status: 400 });
  const conflict = await handleRequest(post('highland-events', create), env, network(access(all), [], fail('PT409', '该日期已有高原竞逐记录，请到赛事详情修正')));
  assert.equal(conflict.status, 409); assert.match((await conflict.json()).error, /已有高原竞逐/);
  assert.equal((await handleRequest(post('highland-event', update), env, network(access(all), [], fail('42501', 'x')))).status, 403);
  assert.equal((await handleRequest(get(`highland-event?id=${id}`), env, network(access(all), [], () => Response.json(null)))).status, 404);
});

test('platform highland settings: own permission, highland keys only, separate RPCs', async () => {
  const calls = [];
  const granted = access([], ['platform.read', 'platform.highland.permissions']);
  const ok = { club_id: club, role: 'admin', user_id: null, permission: 'highland.edit', value: false };
  assert.equal((await handleRequest(post('admin/highland-permission', ok), env, network(granted, calls))).status, 200);
  assert.deepEqual(calls[0], ['/rest/v1/rpc/platform_set_highland_permission', { p_club: club, p_role: 'admin', p_user: null, p_permission: 'highland.edit', p_value: false }]);
  for (const body of [{ ...ok, permission: 'events.edit' }, { ...ok, user_id: id }, { ...ok, value: 'yes' }])
    assert.equal((await handleRequest(post('admin/highland-permission', body), env, network(granted, calls))).status, 400, JSON.stringify(body));
  // The Four-Way League settings route refuses highland keys even with both platform permissions.
  assert.equal((await handleRequest(post('admin/event-permission', ok), env, network(access([], ['platform.events.permissions', 'platform.highland.permissions']), calls))).status, 400);
  assert.equal((await handleRequest(get(`admin/highland-permissions?club=${club}`), env, network(granted, calls))).status, 200);
  assert.equal(calls.at(-1)[0], '/rest/v1/rpc/platform_highland_permissions');
});
