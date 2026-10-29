import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, validateRows, validateAbsences, matchName, mergePreview, MAX_SOURCE_BYTES } from './contract.ts';
import { validDate } from '../../domain/member.ts';
import { readFileSync } from 'node:fs';
import { extractionPrompt } from './prompt.ts';

const member = { name: '玩家甲', position: null, level: 70, pathway: null, extraordinary_score: 100, prosperity: null, weekly_activity: 0, group: null, join_days: null };
const source = members => JSON.stringify({ members, is_complete_roster: false, snapshot_date: null, schema_version: 1 });
test('absence review requires distinct identities and explicit bounded choices',()=>{
 const d={player_id:'00000000-0000-4000-8000-000000000001',decision:'missed'};
 assert.deepEqual(validateAbsences([d]),[d]);
 for(const data of [[d,d],[{...d,decision:'left?'}],[{...d,player_id:'name'}],null,Array(1001).fill(d)])assert.throws(()=>validateAbsences(data));
});

test('nickname corrections require explicit existing identity, a matching preview and expected name',()=>{
 const row={...member,player_id:'00000000-0000-4000-8000-000000000001',identity_confirmed:true,correct_name:member.name,expected_name:'旧错名'};
 assert.equal(validateRows([row])[0].expected_name,'旧错名');
 for(const changes of [{player_id:null},{identity_confirmed:false},{expected_name:undefined},{correct_name:''},{correct_name:'x'},{correct_name:'a\n'}])assert.throws(()=>validateRows([{...row,...changes}]));
});
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
test('source limits and calendar dates reject truncated or impossible imports', () => {
  assert.throws(() => parseSource(' '.repeat(MAX_SOURCE_BYTES+1)));
  assert.throws(() => parseSource(source(Array.from({length:201},()=>member))));
  for (const date of ['2026-02-30','2025-02-29','2026-13-01','1999-12-31',null]) assert.equal(validDate(date),false);
  assert.equal(validDate('2024-02-29'),true);
  assert.throws(() => parseSource(source([{...member,extraordinary_score:Number.MAX_SAFE_INTEGER+1}])));
});
test('the copied AI prompt stays exactly aligned with the approved requirement', () => {
  const doc=readFileSync(new URL('../../../../../docs/CLUB_REQUIREMENTS.md',import.meta.url),'utf8');
  const section=doc.split(/^## 4\..*$/m)[1].split(/^## 5\./m)[0];
  const expected=section.split(/\r?\n/).filter(line=>line.startsWith('>')).map(line=>line.replace(/^> ?/,'')).join('\n');
  assert.equal(extractionPrompt,expected);
});
