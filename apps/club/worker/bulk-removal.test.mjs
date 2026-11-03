import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, routePermissions } from './index.ts';

// Stage G: removing an account from every club. Super Admin only (Super-Admin-only permission and live activation);
// the body names exactly one account and the preview the database compares against.
const A = '00000000-0000-4000-8000-0000000000a1', id = '00000000-0000-4000-8000-000000000001';
const env = { CLUB_ID: A, SUPABASE_URL: 'https://auth.example', SUPABASE_PUBLISHABLE_KEY: 'public', ASSETS: { fetch: async () => new Response('shell') } };
const sa = { permissions: [], roles: [], super_admin: true, super_admin_active: true, session_aal2: true, platform_admin: false, alliance_leader: false, platform_permissions: ['platform.read', 'platform.roles.assign', 'platform.users.remove_all_clubs'] };
const network = (granted, calls = []) => async (url, options) => {
  if (url.endsWith('/user')) return Response.json({ id: 'u', email: 's@example.com', email_confirmed_at: 'date' });
  if (url.includes('club_my_access')) return Response.json(granted);
  calls.push([new URL(url).pathname, options.body && JSON.parse(options.body)]);
  return Response.json({ changed: true, clubs: [] });
};
const post = body => new Request('https://club.example/api/admin/remove-from-all-clubs', { method: 'POST', headers: { Cookie: '__Host-club_access=access', Origin: 'https://club.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('only the active Super Admin, with an exact body, reaches the removal', async () => {
  assert.deepEqual(routePermissions['/api/admin/remove-from-all-clubs'], { POST: 'platform.users.remove_all_clubs' });
  const ok = { user_id: id, expected: { [A]: 3 }, request_id: id }, calls = [];
  assert.equal((await handleRequest(post(ok), env, network(sa, calls))).status, 200);
  assert.deepEqual(calls, [['/rest/v1/rpc/platform_remove_from_all_clubs', { p_user: id, p_expected: { [A]: 3 }, p_request: id }]]);
  for (const bad of [{ user_id: id, request_id: id }, { ...ok, expected: [] }, { ...ok, expected: { x: 1 } }, { ...ok, expected: { [A]: -1 } }, { ...ok, expected: { [A]: '3' } }, { ...ok, user_ids: [id] }, { ...ok, user_id: 'x' }])
    assert.equal((await handleRequest(post(bad), env, network(sa, calls))).status, 400, JSON.stringify(bad));
  // A platform admin, or a Super Admin without activation (even with a forged list): refused before the database.
  for (const who of [{ ...sa, super_admin: false, super_admin_active: false, platform_admin: true, platform_permissions: ['platform.read', 'platform.roles.assign'] },
    { ...sa, super_admin_active: false }]) {
    const none = [];
    assert.equal((await handleRequest(post(ok), env, network(who, none))).status, 403);
    assert.deepEqual(none, []);
  }
  assert.equal(calls.length, 1);
});
