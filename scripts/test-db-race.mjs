import '../tests/runtime-env.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

// Deterministic lock races on disposable PostgreSQL (same server as pnpm test:db, its own database squirrelapi_race,
// dropped at the end). Session A opens a transaction and makes a change; session B starts the competing change; a third
// session confirms in pg_stat_activity that B is really blocked on a lock; only then A commits. Each case asserts both
// the wait and the final data, so a missing lock fails even when the timing happened to be harmless.
// Accepts no URL or host. PSQL_DOCKER=<container> runs psql inside a local disposable container instead.
const port = process.env.TEST_DB_PORT ?? '55432', docker = process.env.PSQL_DOCKER;
if (!/^\d{1,5}$/.test(port)) throw Error('Invalid local test port');
if (docker !== undefined && !/^[\w.-]+$/.test(docker)) throw Error('Invalid container name');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('PG'))),
  PGPASSWORD: 'test-only-local', PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable' };
const bin = docker ? 'docker' : (process.env.PSQL_BIN ?? 'psql');
const args = db => [...(docker ? ['exec', '-i', docker, 'psql'] : ['psql'].slice(1)), '--no-psqlrc', ...(docker ? [] : ['--host=127.0.0.1', `--port=${port}`]),
  '--username=postgres', `--dbname=${db}`, '-Atq'];
const once = (db, sql) => {
  const r = spawnSync(bin, [...args(db), '--set=ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', env, timeout: 120000 });
  if (r.error || r.status !== 0) throw Error(`psql failed: ${r.error?.message ?? ''}${r.stderr}`);
  return r.stdout.trim();
};
const db = 'squirrelapi_race', q = sql => once(db, sql);

// One long-lived psql process = one real database session.
class Session {
  constructor(name) {
    this.name = name; this.out = ''; this.n = 0;
    this.p = spawn(bin, args(db), { env });
    this.p.stdout.on('data', d => { this.out += d; });
    this.p.stderr.on('data', d => { this.out += d; });
  }
  // Results go to stdout and errors to stderr: the marker is written to both (\warn = stderr), and an answer is complete
  // only when it has arrived on both, so an error is never read as part of the next answer.
  send(sql) { this.p.stdin.write(`${sql}\n\\echo __mark_${++this.n}\n\\warn __mark_${this.n}\n`); const m = `__mark_${this.n}`;
    const both = () => this.out.split(m).length >= 3;
    return (async () => { for (let i = 0; i < 400; i++) { if (both()) { const end = this.out.lastIndexOf(m); const r = this.out.slice(0, end).replaceAll(m, '').trim(); this.out = this.out.slice(end + m.length); return r; } await sleep(50); }
      throw Error(`${this.name}: no answer to ${sql.slice(0, 80)}`); })(); }
  close() { this.p.stdin.end(); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (ok, message) => { if (!ok) throw Error(message); };

// Committed fixtures need their own database; the API roles are cluster-wide, so create them only if missing and drop
// them at the end only if this run created them (pnpm test:db creates them inside its own rolled-back transaction).
const created = once('postgres', "select string_agg(r, ',') from unnest(array['anon','authenticated','service_role']) r where not exists(select 1 from pg_roles where rolname = r)") || '';
once('postgres', `drop database if exists ${db} with (force);`); once('postgres', `create database ${db};`);
const bootstrap = readFileSync('tests/db/bootstrap.sql', 'utf8').replace("current_database() <> 'squirrelapi_test'", `current_database() <> '${db}'`)
  .replace(/^create role (\w+) nologin;$/gm, (_, r) => `do $r$ begin if not exists(select 1 from pg_roles where rolname = '${r}') then create role ${r} nologin; end if; end $r$;`);
const migrations = readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f)).sort().map(f => readFileSync(`supabase/migrations/${f}`, 'utf8'));
const O = 'd0ddb226-a10a-471c-be4b-d5e5153bd313'; // the bootstrap owner, also the Super Admin with a trusted aal2 session
const u = n => `00000000-0000-4000-8000-0000000000${n}`, X = u('c1'), Y = u('c2');
const fixture = `
insert into auth.users(id,email,email_confirmed_at) select ('${u('')}'||n)::uuid,'race-'||n||'@fixture.invalid',now() from unnest(array['a1','a2','a3','a4','b1']) n;
insert into public.club_clubs(id,name,admin_limit) values ('${X}','Race X',2),('${Y}','Race Y',5);
-- X: owner o1 (a1), admin a2. Y: owner O, admin a2. a3 and a4 hold no role.
insert into public.club_memberships(club_id,user_id,role) values ('${X}','${u('a1')}','owner'),('${X}','${u('a2')}','admin'),('${Y}','${O}','owner'),('${Y}','${u('a2')}','admin');
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status) values ('${u('f1')}','${O}','race','totp','verified');
insert into auth.sessions(id,user_id,aal,factor_id) values ('${u('e1')}','${O}','aal2','${u('f1')}');
select club_private.trust_super_admin_factor('${u('f1')}');`;
const as = user => `select set_config('request.jwt.claim.sub','${user}',true),set_config('request.jwt.claims','{}',true);`;
const asSuper = `select set_config('request.jwt.claim.sub','${O}',true),set_config('request.jwt.claims','{"aal":"aal2","session_id":"${u('e1')}"}',true);`;
const version = club => Number(q(`select role_version from public.club_clubs where id='${club}'`));
const rid = () => crypto.randomUUID();

// A runs `first` and stays open; B runs `second` in its own transaction and must be seen waiting on a lock (never a
// plain sleep); then A commits. Returns B's output (with the SQLSTATE of any error).
async function race(first, second) {
  const a = new Session('A'), b = new Session('B');
  try {
    const pid = (await b.send('\\set VERBOSITY verbose\nselect pg_backend_pid();')).split('\n').pop();
    check(/^\d+$/.test(pid), `B did not start: ${pid}`);
    const opened = await a.send(`begin;\n${first}`); check(!/ERROR/.test(opened), `A failed: ${opened}`);
    const pending = b.send(`begin;\n${second}\ncommit;`);
    let waited = false;
    for (let i = 0; i < 100 && !waited; i++) { waited = q(`select wait_event_type from pg_stat_activity where pid=${pid}`) === 'Lock'; if (!waited) await sleep(50); }
    check(waited, 'B never waited on a lock: the operations are not serialized');
    check(!/ERROR/.test(await a.send('commit;')), 'A could not commit');
    return await pending;
  } finally { a.close(); b.close(); }
}
const failedWith = (out, state) => check(out.includes(`ERROR:  ${state}:`), `expected ${state}, got: ${out.slice(0, 300)}`);

const cases = {
  // Revocation during a role change: the owner's appointment waits while the Super Admin transfers the club away from
  // them; once it runs, it must see that they are no longer the owner (42501), not appoint anyone.
  'owner loses the club while their appointment waits': async () => {
    const v = version(X);
    const out = await race(`${asSuper} select public.platform_transfer_owner('${X}','${u('a3')}','leave',${v},'${rid()}');`,
      `${as(u('a1'))} select public.club_change_admin('${X}','${u('a4')}','grant',${v},'${rid()}');`);
    failedWith(out, '42501');
    check(q(`select count(*) from public.club_memberships where user_id='${u('a4')}' and status='active'`) === '0', 'a4 was appointed');
    check(q(`select user_id from public.club_memberships where club_id='${X}' and role='owner' and status='active'`) === u('a3'), 'transfer lost');
  },
  // Admin places: the Super Admin lowers the limit to the current count while the owner's grant (same, still valid
  // role version) waits; the grant must read the new limit after the lock and stop.
  'lowered admin limit beats a waiting appointment': async () => {
    const v = version(X), admins = q(`select count(*) from public.club_memberships where club_id='${X}' and role='admin' and status='active'`);
    const out = await race(`${asSuper} select public.platform_set_admin_limit('${X}',${admins});`,
      `${asSuper} select public.platform_assign_role('${X}','${u('a4')}','admin','grant',${v},'${rid()}');`);
    failedWith(out, 'PT409'); check(/上限/.test(out), `expected the limit message, got: ${out.slice(0, 200)}`);
    check(q(`select count(*) from public.club_memberships where club_id='${X}' and role='admin' and status='active'`) === admins, 'limit exceeded');
  },
  // Bulk removal vs owner transfer: while a2 is made owner of Y, removing a2 from every club waits on Y's lock, then
  // must refuse as a whole (a2 now owns Y): X keeps a2 as admin, Y keeps a2 as owner.
  'owner transfer beats a waiting removal from all clubs': async () => {
    const vx = version(X), vy = version(Y);
    const out = await race(`${asSuper} select public.platform_transfer_owner('${Y}','${u('a2')}','admin',${vy},'${rid()}');`,
      `${asSuper} select public.platform_remove_from_all_clubs('${u('a2')}','{"${X}":${vx},"${Y}":${vy}}','${rid()}');`);
    failedWith(out, 'PT409');
    check(q(`select string_agg(club_id||':'||role, ',' order by club_id) from public.club_memberships where user_id='${u('a2')}' and status='active'`) === `${X}:admin,${Y}:owner`, 'partial removal');
  },
  // Plan A under a race: the owner's grant to an admin waits while the Super Admin forces a deny on the owner's own
  // audit.read; the grant must then be refused and leave no setting and no audit row.
  'forced deny on the owner beats a waiting grant to an admin': async () => {
    const owner = q(`select user_id from public.club_memberships where club_id='${Y}' and role='owner' and status='active'`);
    const admin = q(`select user_id from public.club_memberships where club_id='${Y}' and role='admin' and status='active' limit 1`);
    check(owner && admin, 'fixture: Y needs an owner and an admin');
    check(q(`select count(*) from public.club_permission_overrides where club_id='${Y}' and user_id='${admin}'`) === '0', 'fixture: no setting on the admin yet');
    const audits = q(`select count(*) from public.club_audit_events where club_id='${Y}'`);
    const out = await race(`${asSuper} select public.platform_set_personal_permission('${Y}','${owner}','audit.read',false);`,
      `${as(owner)} select public.club_set_admin_permission('${Y}','${admin}','audit.read',true);`);
    failedWith(out, '42501'); check(/本俱乐部公会长没有/.test(out), `expected the plan A message, got: ${out.slice(0, 200)}`);
    check(q(`select count(*) from public.club_permission_overrides where club_id='${Y}' and user_id='${admin}' and set_by='owner'`) === '0', 'owner setting written');
    check(q(`select count(*) from public.club_audit_events where club_id='${Y}'`) === audits, 'audit row written');
  },
};

let failed = 0;
try {
  once(db, [bootstrap, ...migrations, fixture, ...(process.env.RACE_EXTRA_SQL ? [process.env.RACE_EXTRA_SQL] : [])].join('\n'));
  for (const [name, run] of Object.entries(cases)) {
    try { await run(); console.log(`ok   ${name}`); } catch (error) { failed++; console.log(`FAIL ${name}: ${error.message}`); }
  }
} finally {
  once('postgres', `drop database if exists ${db} with (force);`);
  if (created) once('postgres', `drop role if exists ${created};`);
}
console.log(`Race: ${Object.keys(cases).length - failed} passed, ${failed} failed (two real sessions, lock wait confirmed in pg_stat_activity).`);
if (failed) process.exit(1);
