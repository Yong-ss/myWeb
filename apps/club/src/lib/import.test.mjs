import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, validateRows, matchName, mergePreview } from './import.ts';

const member = { name: '玩家甲', position: null, level: 70, pathway: null, extraordinary_score: 100, prosperity: null, weekly_activity: 0, group: null, join_days: null };
const source = members => JSON.stringify({ members, is_complete_roster: false, snapshot_date: null, schema_version: 1 });
test('v1 ignores key order, preserves null and zero and refuses extra/missing fields', () => {
  assert.deepEqual(parseSource(source([member])).members[0], member);
  for (const row of [{ ...member, online_status: 'online' }, { name: 'incomplete' }, { ...member, level: '70' }, { ...member, prosperity: -1 }, { ...member, level: 1.5 }]) assert.throws(() => parseSource(source([row])));
  assert.throws(() => parseSource('```json\n{}\n```'));
  assert.throws(() => parseSource(source([])));
});
test('nickname normalization suggests candidates without replacing similar characters', () => {
  assert.equal(matchName(' 冷丶月· '), '冷月');
  assert.notEqual(matchName('冷月'), matchName('泠月'));
});
test('each identity needs explicit confirmation and existing identities cannot repeat', () => {
  assert.throws(() => validateRows([{ ...member, player_id: '' }]));
  assert.throws(() => validateRows([{ ...member, name: null, player_id: null }]));
  const row = { ...member, player_id: '00000000-0000-4000-8000-000000000001' };
  assert.throws(() => validateRows([row, row]));
  assert.equal(validateRows([{ ...member, player_id: null }]).length, 1);
});
test('merge retains unsubmitted players but explicit null replaces an old value', () => {
  const prior = [{ ...member, player_id: 'a', level: 10 }, { ...member, player_id: 'b' }];
  const next = [{ ...member, player_id: 'a', level: null }];
  const merged = mergePreview(prior, next, 'merge');
  assert.equal(merged.length, 2);
  assert.equal(merged.find(r => r.player_id === 'a').level, null);
  assert.equal(mergePreview(prior, next, 'replace').length, 1);
});
