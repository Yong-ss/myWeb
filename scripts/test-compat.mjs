import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Deployment-order check: the already deployed Worker (default origin/main) runs its own real integration suite
// against the database with new migrations applied. This is the state between "migrate" and "deploy", after a failed
// deploy or a Worker rollback, and (per state below) after a migration run stopped part-way.
// Local disposable Supabase only (same runner as test:integration).
// Usage: pnpm test:compat [ref] [state ...]   states: A, A-C, A-E, all (default: all four, in order)
const [ref = 'origin/main', ...only] = process.argv.slice(2);
// Pending migrations, in order (D has none). Each state applies a prefix of this list.
const pending = ['20261101191854_club_single_role.sql', '20261101195800_club_permission_layers.sql', '20261101205005_club_owner_admins.sql',
  '20261101235927_club_platform_admins.sql', '20261102124404_club_alliances.sql', '20261102171216_club_bulk_removal.sql',
  '20261103090000_club_owner_grant_bound.sql'];
const base = ['absences.resolve', 'aliases.manage', 'audit.actor_email.read', 'audit.read', 'club.rename', 'imports.create', 'imports.delete', 'members.read'];
const withC = [...base, 'club.admins.manage', 'club.admins.permissions'].sort();
const userKeys = ['created_at', 'effective', 'email', 'email_confirmed', 'id', 'last_sign_in_at', 'memberships', 'super_admin'];
// Expected values that the migrations deliberately change, per state: the Super Admin's full club permission list
// (C adds two owner-only permissions, F one), the platform_users() key set (E adds platform_admin, G alliance) and
// platform_overview().alliances (a null placeholder until F fills in the count of active alliances; the fixture has none).
const states = {
  A: { files: 1, permissions: base, keys: userKeys, alliances: 'toBeNull()' },
  'A-C': { files: 3, permissions: withC, keys: userKeys, alliances: 'toBeNull()' },
  'A-E': { files: 4, permissions: withC, keys: [...userKeys, 'platform_admin'].sort(), alliances: 'toBeNull()' },
  all: { files: 7, permissions: [...withC, 'club.alliance.request'].sort(), keys: [...userKeys, 'platform_admin', 'alliance'].sort(), alliances: 'toBe(0)' },
};
// Old tests that cannot hold under the new rules at all; each is covered by the current suite instead.
const superseded = [
  // Permissions V1 stage A: one active role per club (D-036 union superseded). The test's subject is the union of two
  // active roles in one club, which the database now refuses; covered by authz.spec.mjs "single active role, Worker/database
  // parity" and role-assignment.spec.mjs "role changes are single-role" (plus supabase/tests/platform_role_assignments.sql).
  'multi-role union, Worker/database parity',
];
const literal = list => `[${list.map(k => `'${k}'`).join(',')}]`;
// Exact edits to the old tests: only expected values the migrations change, and the P4 fixture's double role.
// Every edit must match exactly once, so a changed old test fails here instead of silently running unpatched.
const edits = state => ({
  'tests/integration/authz.spec.mjs': [
    [`const allPermissions=${literal(base)};`, `const allPermissions=${literal(state.permissions)};`],
    [`expect(Object.keys(users[0]).sort()).toEqual(${literal(userKeys)});`, `expect(Object.keys(users[0]).sort()).toEqual(${literal(state.keys)});`],
    ['expect(overview.alliances).toBeNull();', `expect(overview.alliances).${state.alliances};`],
  ],
  'tests/integration/role-assignment.spec.mjs': [
    // Stage A: the fixture gave the owner a second active role in the same club; now a single role.
    [`('\${club}','\${users.foreign.id}','owner'),('\${club}','\${users.foreign.id}','admin'),`, `('\${club}','\${users.foreign.id}','owner'),`],
    // The removed admin role filled one of the 2 admin places; limit 1 keeps the "limit reached" assertion (409) meaningful.
    [`values('\${club}','P4 isolated club',2),`, `values('\${club}','P4 isolated club',1),`],
    // Consequence of that fixture change only: the old Worker's transfer removes the previous owner (stage A compatibility),
    // so without the extra admin role nothing remains in this club. The other club is still asserted on the next line.
    [`expect(remaining).toContain('members.read');expect(remaining).not.toContain('club.rename');`, `expect(remaining).toEqual([]);`],
  ],
});
const run = only.length ? only : Object.keys(states);
for (const name of run) if (!states[name]) throw Error(`Unknown compat state ${name}; use ${Object.keys(states).join(', ')}`);
const dir = resolve('.test-runtime/compat');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (existsSync(dir)) { rmSync(dir, { recursive: true, force: true }); git('worktree', 'prune'); }
git('worktree', 'add', '--detach', dir, ref);
const results = [];
try {
  const oldDir = join(dir, 'supabase/migrations');
  const text = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  const deployed = new Set(readdirSync(oldDir));
  const current = readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f));
  // Applied migrations are never rewritten; a changed one would make this check meaningless.
  // (Compared without line endings: a Windows worktree checkout may convert them.)
  for (const file of current) if (deployed.has(file) && text(join('supabase/migrations', file)) !== text(join(oldDir, file))) throw Error(`Applied migration changed: ${file}`);
  const unknown = current.filter(f => !deployed.has(f) && !pending.includes(f));
  if (unknown.length) throw Error(`New migrations not covered by the compat states: ${unknown.join(', ')}`);
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const sh = args => execFileSync(pnpm, args, { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  sh(['install', '--offline', '--frozen-lockfile']);
  for (const name of run) {
    const state = states[name];
    for (const file of pending) if (existsSync(join(oldDir, file))) unlinkSync(join(oldDir, file));
    for (const file of pending.slice(0, state.files)) copyFileSync(join('supabase/migrations', file), join(oldDir, file));
    for (const [file, changes] of Object.entries(edits(state))) {
      let body = execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
      for (const [from, to] of changes) {
        if (body.split(from).length !== 2) throw Error(`Compat edit no longer matches ${file}: ${from.slice(0, 60)}…`);
        body = body.replace(from, () => to);
      }
      writeFileSync(join(dir, file), body);
    }
    console.log(`Compat [${name}]: ${ref} Worker + ${pending.slice(0, state.files).join(', ')}`);
    sh(['test:integration', '--', ...(superseded.length ? ['--grep-invert', `"${superseded.join('|')}"`] : [])]);
    results.push(name);
  }
  console.log(`Compat: ${ref} Worker passed in states ${results.join(', ')} (excluded superseded: ${superseded.length}).`);
} finally {
  if (results.length < run.length) console.error(`Compat: passed ${results.join(', ') || 'none'}; failed at ${run[results.length]}.`);
  // git cannot delete node_modules paths over 260 characters on Windows; Node can.
  rmSync(dir, { recursive: true, force: true });
  git('worktree', 'prune');
}
