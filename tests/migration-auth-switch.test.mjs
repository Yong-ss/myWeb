import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// P2 redefines five large write functions. A retyped body once broke production, so the only allowed difference from
// each function's previous definition is its hard-coded owner/admin check becoming club_private.require(<permission>).
const dir = 'supabase/migrations', switchFile = '20261030093737_club_authz_switch.sql';
const read = f => readFileSync(`${dir}/${f}`, 'utf8').replace(/\r\n/g, '\n');
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bodies = (sql, name) => [...sql.matchAll(new RegExp(`create (?:or replace )?function ${escape(name)}\\([\\s\\S]*?\\nend \\$\\$;`, 'g'))].map(m => m[0].replace(/^create (or replace )?function/, 'create or replace function'));
const previous = name => readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f) && f < switchFile).sort().flatMap(f => bodies(read(f), name)).at(-1);
const expected = {
  'club_private.commit_import': 'imports.create', 'club_private.manage_alias': 'aliases.manage', 'club_private.delete_import_date': 'imports.delete',
  'club_private.resolve_absence': 'absences.resolve', 'public.club_rename': 'club.rename',
};
const legacy = /^ *(perform 1 from public\.club_memberships where [^\n]*role in \('owner','admin'\) for share;\n *if not found then raise exception[^\n]*\n|if not exists\(select 1 from public\.club_memberships where [^\n]*role='owner'\) then\n *raise exception[^\n]*\n *end if;\n)/m;

test('each switched write function differs from its previous definition only in the authorization line', () => {
  const sql = read(switchFile);
  for (const [name, permission] of Object.entries(expected)) {
    const before = previous(name), [after, ...extra] = bodies(sql, name);
    assert.ok(before && after, name); assert.equal(extra.length, 0, `${name} defined twice`);
    assert.match(before, legacy, `${name} legacy check not found`);
    const indent = before.match(legacy)[0].match(/^ */)[0];
    assert.equal(after, before.replace(legacy, `${indent}perform club_private.require(${name.endsWith('resolve_absence') ? 'p_club' : 'p_club_id'}, '${permission}');\n`), name);
  }
});

test('the check fails when anything else in a body changes', () => {
  const before = previous('public.club_rename');
  const tampered = before.replace(legacy, "  perform club_private.require(p_club_id, 'club.rename');\n").replace("length(next_name) not between 1 and 120", "length(next_name) not between 1 and 999");
  assert.notEqual(tampered, before.replace(legacy, "  perform club_private.require(p_club_id, 'club.rename');\n"));
});
