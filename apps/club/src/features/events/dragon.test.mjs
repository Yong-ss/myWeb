import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDragonChoices, classifyDragon, dragonPlayers, parseDragonSource } from './dragon.ts';

// Attendance counts come from these rows: a wrong automatic match credits the wrong member, and an unmatched name
// must never reach the database as a guessed identity.
const players = [{ id: 'a', display_name: '黄金诗剧', current: true }, { id: 'b', display_name: '北忧', current: true }, { id: 'c', display_name: '暴走金金丶', current: true }];
const json = list => JSON.stringify({ schema_version: 1, event_type: 'dragon_hunt', participants: list.map(player_name => ({ player_name })) });

test('parse keeps unreadable names, merges screenshot overlap and rejects other contracts', () => {
  assert.deepEqual(parseDragonSource(json(['北忧', null, '北忧', ' 黄金诗剧 '])), { rows: ['北忧', null, '黄金诗剧'], removed: 1 });
  assert.throws(() => parseDragonSource(JSON.stringify({ schema_version: 1, event_type: 'highland_race', participants: [] })), /猎龙/);
  assert.throws(() => parseDragonSource(JSON.stringify({ schema_version: 1, event_type: 'dragon_hunt', participants: [{ player_name: 'x', power: 70 }] })), /只能有/);
  assert.throws(() => parseDragonSource('```json'), /语法/);
});

test('only an exact name or alias matches; similar names wait; unknown names are left out', () => {
  const entries = classifyDragon(['黄金诗剧', '暴走金金', '新人', '北憂别名', null], players, [{ player_id: 'b', alias_name: '北憂别名' }]);
  assert.deepEqual(entries.map(e => [e.decision, e.identity]), [['match', 'a'], ['review', ''], ['skip', ''], ['match', 'b'], ['review', '']]);
  assert.deepEqual(entries[1].candidates, ['c']);
});

test('saved rows: matched only, review blocks, two rows on one player is a problem', () => {
  let entries = classifyDragon(['黄金诗剧', '暴走金金', '新人'], players, []);
  assert.equal(dragonPlayers(entries, {}, id => id).review, 1);
  entries = applyDragonChoices(entries, { 1: { decision: 'match', identity: 'c' } });
  const done = dragonPlayers(entries, { c: true }, id => players.find(p => p.id === id).display_name);
  assert.deepEqual(done.players, [{ player_id: 'a', read_name: '黄金诗剧', remember_alias: false }, { player_id: 'c', read_name: '暴走金金', remember_alias: true }]);
  assert.equal(done.skipped.length, 1);
  assert.equal(done.problems.length, 0);
  const twice = applyDragonChoices(entries, { 2: { decision: 'match', identity: 'a' } });
  assert.equal(dragonPlayers(twice, {}, id => id).problems.length, 1);
});
