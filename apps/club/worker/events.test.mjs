import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, routePermissions } from './index.ts';

// Four-Way League routes: each method demands its own event permission (import never implies edit), the club comes
// only from the URL, and malformed input never reaches the database. The database then rechecks everything.
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
const metrics = { kills: 9, assists: 26, dispersals: 0, awakens: 0, player_damage: 501000, damage_taken: 199000, healing: 0, guardian_damage: 4527000, purification: 0 };
const create = { event_date: '2026-10-04', total_score: 3000, players: [{ player_id: id, name: null, output_name: '北忧', strategy_name: '北忧', remember_alias: false, ...metrics }], raw_text: '{"schema_version":1}', request_id: id };
const update = { event_id: id, expected_version: 2, action: 'score', payload: { total_score: 1 }, request_id: id };

test('every event route declares its own permission per method', () => {
  assert.deepEqual(routePermissions['/api/events'], { GET: 'events.read', POST: 'events.import' });
  assert.deepEqual(routePermissions['/api/event'], { GET: 'events.read', POST: 'events.edit' });
  assert.deepEqual(routePermissions['/api/player-events'], { GET: 'events.read' });
  assert.deepEqual(routePermissions['/api/event-identities'], { GET: 'events.read' });
  assert.deepEqual(routePermissions['/api/admin/event-permissions'], { GET: 'platform.events.permissions' });
  assert.deepEqual(routePermissions['/api/admin/event-permission'], { POST: 'platform.events.permissions' });
});

test('import does not give edit, read alone gives neither, and a platform permission never opens a club route', async () => {
  const cases = [[access(['events.read', 'events.import']), post('event', update)], [access(['events.read', 'events.edit']), post('events', create)],
    [access(['events.read']), post('events', create)], [access(['members.read']), get('events')], [access([], ['platform.events.permissions']), get('events')]];
  for (const [granted, request] of cases) {
    const calls = [];
    assert.equal((await handleRequest(request, env, network(granted, calls))).status, 403, request.url);
    assert.deepEqual(calls, []);
  }
});

test('reads and writes reach the right RPC with the URL club only', async () => {
  const calls = [];
  const granted = access(['events.read', 'events.import', 'events.edit']);
  for (const request of [get(`events?club=${other}&voided=1&before=2026-10-08&id=${id}`), get(`event?club=${other}&id=${id}`), get(`event?club=${other}&id=${id}&version=3`),
    get(`player-events?club=${other}&player=${id}`), get(`event-identities?club=${other}`), post(`events?club=${other}`, create), post(`event?club=${other}`, update)])
    assert.equal((await handleRequest(request, env, network(granted, calls))).status, 200, request.url);
  assert.deepEqual(calls.map(c => c[0]), ['/rest/v1/rpc/club_events_list', '/rest/v1/rpc/club_event_detail', '/rest/v1/rpc/club_event_version', '/rest/v1/rpc/club_player_events',
    '/rest/v1/rpc/club_event_identities', '/rest/v1/rpc/club_event_create', '/rest/v1/rpc/club_event_update']);
  assert.ok(calls.every(c => c[1].p_club === other));
  assert.deepEqual(calls[0][1], { p_club: other, p_voided: true, p_before: '2026-10-08', p_before_id: id });
  assert.deepEqual(calls[5][1], { p_club: other, p_date: '2026-10-04', p_total_score: 3000, p_players: create.players, p_raw: create.raw_text, p_request: id });
  assert.deepEqual(calls[6][1], { p_club: other, p_event: id, p_expected: 2, p_action: 'score', p_payload: { total_score: 1 }, p_request: id });
});

test('malformed input is refused before the database, including a club id in the body', async () => {
  const calls = [];
  const granted = access(['events.read', 'events.import', 'events.edit']);
  const bad = [get('event?id=nope'), get(`event?id=${id}&version=0`), get('player-events?player=x'), get('events?before=2026-13-01'), get('events?before=2026-10-01'),
    post('events', { ...create, club_id: club }), post('events', { ...create, event_date: '2026-02-30' }), post('events', { ...create, total_score: -1 }),
    post('events', { ...create, players: [] }), post('events', { ...create, request_id: 'x' }), post('event', { ...update, action: 'delete' }),
    post('event', { ...update, expected_version: '2' }), post('event', { ...update, payload: [] })];
  for (const request of bad) assert.equal((await handleRequest(request, env, network(granted, calls))).status, 400, request.url);
  assert.deepEqual(calls, []);
});

test('database answers map to clear statuses: conflict 409, permission 403, missing 404', async () => {
  const granted = access(['events.read', 'events.edit']);
  const fail = (code, message) => () => Response.json({ code, message }, { status: 400 });
  const conflict = await handleRequest(post('event', update), env, network(granted, [], fail('PT409', '这场比赛已被其他人修改，请刷新后重试')));
  assert.equal(conflict.status, 409); assert.match((await conflict.json()).error, /其他人修改/);
  assert.equal((await handleRequest(post('event', update), env, network(granted, [], fail('42501', 'x')))).status, 403);
  assert.equal((await handleRequest(get(`event?id=${id}`), env, network(granted, [], () => Response.json(null)))).status, 404);
});

test('platform event settings: exactly one of role or user, event permissions only', async () => {
  const calls = [];
  const granted = access([], ['platform.read', 'platform.events.permissions']);
  const ok = { club_id: club, role: 'admin', user_id: null, permission: 'events.edit', value: false };
  assert.equal((await handleRequest(post('admin/event-permission', ok), env, network(granted, calls))).status, 200);
  assert.deepEqual(calls[0], ['/rest/v1/rpc/platform_set_event_permission', { p_club: club, p_role: 'admin', p_user: null, p_permission: 'events.edit', p_value: false }]);
  for (const body of [{ ...ok, user_id: id }, { ...ok, role: null }, { ...ok, permission: 'members.read' }, { ...ok, role: 'leader' }, { ...ok, value: 'yes' }, { ...ok, extra: 1 }])
    assert.equal((await handleRequest(post('admin/event-permission', body), env, network(granted, calls))).status, 400, JSON.stringify(body));
  assert.equal(calls.length, 1);
  assert.equal((await handleRequest(get(`admin/event-permissions?club=${club}`), env, network(granted, calls))).status, 200);
  assert.equal((await handleRequest(get('admin/event-permissions'), env, network(granted, calls))).status, 400);
});
