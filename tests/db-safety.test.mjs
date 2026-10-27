import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('SQL runner rejects a remote address supplied as the test port before connecting', () => {
  const result=spawnSync(process.execPath,['scripts/test-db.mjs'],{encoding:'utf8',env:{...process.env,TEST_DB_PORT:'https://production.example.invalid:5432'}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Invalid local test port/);
});
