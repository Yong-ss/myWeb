import '../tests/runtime-env.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Deliberately accepts no URL, host, database, production key or Supabase link.
const port = process.env.TEST_DB_PORT ?? '55432';
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw Error('Invalid local test port');
const read = path => readFileSync(path,'utf8');
const migrations = readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f)).sort();
const suites = readdirSync('supabase/tests').filter(f => f.endsWith('.sql')).sort();
const sql = ['begin;',read('tests/db/bootstrap.sql'),...migrations.map(f => read(`supabase/migrations/${f}`)),...suites.flatMap(f => ['savepoint suite;',read(`supabase/tests/${f}`),'rollback to savepoint suite;']), 'rollback;'].join('\n');
// PGHOSTADDR/PGSERVICE/PGOPTIONS must not redirect an otherwise local command.
const databaseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PG')));
const result = spawnSync(process.env.PSQL_BIN ?? 'psql', ['--no-psqlrc','--host=127.0.0.1',`--port=${port}`,'--username=postgres','--dbname=squirrelapi_test','--quiet','--set=ON_ERROR_STOP=1'], { input:sql, encoding:'utf8', timeout:120000, env:{ ...databaseEnv, PGPASSWORD:'test-only-local', PGCONNECT_TIMEOUT:'5', PGSSLMODE:'disable' } });
if (result.error || result.status !== 0) {
  console.error('Isolated SQL tests failed. Start a disposable PostgreSQL database named squirrelapi_test on 127.0.0.1:55432; production URLs are never accepted.');
  console.error(result.error?.message ?? ''); console.error(result.stdout); console.error(result.stderr); process.exit(1);
}
console.log(`SQL: ${suites.length} suites passed on isolated PostgreSQL; migrations and fixtures rolled back.`);
