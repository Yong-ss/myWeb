import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Deployment-order check: the already deployed Worker runs its own real integration suite against the database with
// new migrations applied. This is the state between "migrate" and "deploy", after a failed deploy or a Worker rollback.
// Local disposable Supabase only (same runner as test:integration).
// Usage: pnpm test:compat [ref] [state ...]   states: all (default)
// ref must be the commit the production Club Worker was actually deployed from (check the last successful main run
// that deployed Club, see docs/TESTING.md); origin/main is only the default and may contain undeployed commits.
const [ref = 'origin/main', ...only] = process.argv.slice(2);
// Pending migrations, in order. Each state applies a prefix of this list (one migration: one state).
// History: Club permissions V1 (7 migrations, 2026-11-03) were checked here in states A, A-C, A-E and all;
// Four-Way League 20261104140000_club_events.sql (2026-11-04) and Highland Race 20261105090000_club_highland.sql
// (2026-11-05) in state all.
const pending = ['20261106120000_club_dragon_hunt.sql'];
const deployedPermissions = ['absences.resolve', 'aliases.manage', 'audit.actor_email.read', 'audit.read', 'club.admins.manage', 'club.admins.permissions', 'club.alliance.request', 'club.rename', 'events.edit', 'events.import', 'events.read', 'highland.edit', 'highland.import', 'highland.read', 'imports.create', 'imports.delete', 'members.read'];
const withDragon = [...deployedPermissions, 'dragon.edit', 'dragon.import', 'dragon.read'].sort();
// Expected values the migration deliberately changes. The deployed Worker drops permission keys it does not know
// (isPermission), so its own answers (/api/account) are unchanged and it has no dragon routes; only answers read
// straight from the database gain the dragon permissions: the Super Admin's full club list, and the Worker/database
// parity check, which compares the Worker answer with the database answer minus the keys that Worker never knew.
const states = { all: { files: 1 } };
// Old tests that cannot hold under the new rules at all; none for this migration.
const superseded = [];
const literal = list => `[${list.map(k => `'${k}'`).join(',')}]`;
// Exact edits to the deployed tests. Every edit must match exactly once, so a changed old test fails here instead of
// silently running unpatched.
const edits = () => ({
  'tests/integration/authz.spec.mjs': [
    [`const allPermissions=${literal(deployedPermissions)};`, `const allPermissions=${literal(withDragon)};`],
    ["expect(a.permissions).toEqual(await (await rest('rpc/club_my_permissions',admin,{p_club:clubId})).json());",
     "expect(a.permissions).toEqual((await (await rest('rpc/club_my_permissions',admin,{p_club:clubId})).json()).filter(k=>!k.startsWith('dragon.')));"],
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
    for (const [file, changes] of Object.entries(edits())) {
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
