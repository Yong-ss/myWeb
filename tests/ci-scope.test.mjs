import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeFor } from '../scripts/ci-scope.mjs';
test('docs-only changes spend no browser or database minutes', () => assert.deepEqual(scopeFor(['README.md','docs/TESTING.md','AGENTS.md']), {web:false,club:false,db:false,e2e:'none',integration:false}));
test('main-site changes do not run Club browser or SQL tests', () => assert.deepEqual(scopeFor(['apps/web/src/app/page.tsx']), {web:true,club:false,db:false,e2e:'none',integration:false}));
test('import dependencies and mixed auth changes select the necessary regressions', () => {
  assert.deepEqual(scopeFor(['apps/club/worker/imports.ts']), {web:false,club:true,db:true,e2e:'import',integration:true});
  assert.equal(scopeFor(['apps/club/src/app/login/page.tsx','apps/club/src/lib/import.ts']).e2e,'all');
  assert.deepEqual(scopeFor(['apps/club/worker/index.ts']),{web:false,club:true,db:true,e2e:'all',integration:true});
});
test('unknown/shared infrastructure and checkpoints fail safe to the full suite', () => {
  for (const file of ['package.json','pnpm-lock.yaml','tests/browser/import.spec.mjs','.github/workflows/ci.yml','new-shared-package/index.ts']) assert.deepEqual(scopeFor([file]), {web:true,club:true,db:true,e2e:'all',integration:true});
  assert.deepEqual(scopeFor([],true), {web:true,club:true,db:true,e2e:'all',integration:true});
});
test('simple styling does not boot Supabase; critical login/import pages do',()=>{
  for(const file of ['apps/club/src/app/globals.css','apps/club/src/app/page.tsx']) assert.equal(scopeFor([file]).integration,false);
  for(const file of ['apps/club/src/app/login/page.tsx','apps/club/src/app/import/page.tsx','supabase/migrations/new.sql']) assert.equal(scopeFor([file]).integration,true);
});
