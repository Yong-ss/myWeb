import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { functionChecksums, checkQuery } from '../scripts/migration-checksums.mjs';

// A retyped migration once changed '{}'::jsonb to ''::jsonb and still applied; the check must catch one-character drift.
test('one changed character in a function body changes its checksum', () => {
  const file = readFileSync('supabase/migrations/20261030014019_club_absence_resolution.sql', 'utf8');
  const original = functionChecksums(file), drifted = functionChecksums(file.replace("else '{}'::jsonb end", "else ''::jsonb end"));
  assert.equal(original.length, 7);
  assert.deepEqual(original.map(c => c.name), drifted.map(c => c.name));
  assert.deepEqual(original.filter((c, i) => c.md5 !== drifted[i].md5).map(c => c.name), ['club_private.commit_import']);
});

test('query matches by schema, name and argument count', () => {
  const sql = checkQuery([{ name: 'club_private.commit_import', args: 12, md5: 'abc' }]);
  assert.match(sql, /\('club_private\.commit_import',12,'abc'\)/);
  assert.match(sql, /MISMATCH/);
});
