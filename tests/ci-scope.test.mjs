import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scopeFor } from '../scripts/ci-scope.mjs';
const none = {web:false,club:false,db:false,e2e:'none',integration:false,deploy_web:false,deploy_club:false};
const allTests = {web:true,club:true,db:true,e2e:'all',integration:true};
test('docs-only changes, including app-level AGENTS.md, spend no CI minutes and deploy nothing', () => {
  assert.deepEqual(scopeFor(['README.md','docs/TESTING.md','AGENTS.md','apps/club/AGENTS.md','apps/web/AGENTS.md']), none);
});
test('main-site changes deploy only the main site and skip Club browser/SQL tests', () => assert.deepEqual(scopeFor(['apps/web/src/app/page.tsx']), {...none,web:true,deploy_web:true}));
test('Club code changes test and deploy Club only, with every browser flow', () => {
  assert.deepEqual(scopeFor(['apps/club/worker/imports.ts']), {...none,club:true,db:true,e2e:'all',integration:true,deploy_club:true});
  // import UI regressions live in several specs (import-ui, absence, nickname), so no partial e2e selection.
  assert.equal(scopeFor(['apps/club/src/app/import/page.tsx']).e2e,'all');
});
test('test-only changes run the regressions but never deploy production', () => {
  for (const file of ['tests/browser/import.spec.mjs','tests/integration/club.spec.mjs','supabase/tests/club_import.sql','scripts/test-db.mjs','.github/workflows/ci.yml','playwright.config.mjs']) {
    const scope = scopeFor([file]);
    assert.equal(scope.deploy_web || scope.deploy_club, false, file);
    assert.equal(scope.club, true, file);
  }
  assert.deepEqual(scopeFor(['apps/club/worker/members.test.mjs']), {...none,club:true,db:true,e2e:'all',integration:true});
});
test('migrations run SQL and integration tests but do not redeploy the unchanged Worker', () => {
  assert.deepEqual(scopeFor(['supabase/migrations/20990101000000_new.sql']), {...none,club:true,db:true,e2e:'all',integration:true});
});
test('dependencies, shared config and unknown paths fail safe to full tests and both deploys', () => {
  for (const file of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','new-shared-package/index.ts']) assert.deepEqual(scopeFor([file]), {...allTests,deploy_web:true,deploy_club:true}, file);
  assert.deepEqual(scopeFor([],true), {...allTests,deploy_web:true,deploy_club:true});
});
test('simple styling does not boot Supabase; critical login/import pages do',()=>{
  for(const file of ['apps/club/src/app/globals.css','apps/club/src/app/page.tsx']) assert.equal(scopeFor([file]).integration,false);
  for(const file of ['apps/club/src/app/login/page.tsx','apps/club/src/app/import/page.tsx','supabase/migrations/new.sql']) assert.equal(scopeFor([file]).integration,true);
});
test('workflow deploys only after success, from the latest main commit, without cancelling main runs', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  // A cancelled main run must not drop a pending deployment; only PR runs may be cancelled.
  assert.match(ci, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  // The diff starts at the last successful main run, so failed/cancelled runs stay in the next diff.
  assert.match(ci, /status=success/);
  const deploys = ci.split(/\n      - /).filter(step => /^name: (Deploy|Validate production)/.test(step));
  assert.equal(deploys.length, 3);
  for (const step of deploys) {
    assert.match(step, /if: success\(\) && github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && .*deploy_(web|club)/, step.split('\n')[0]);
    assert.doesNotMatch(step, /outputs\.(web|club) ==/, 'deploy must use deploy_* outputs, not test scope');
  }
  assert.match(deploys[0], /commits\/main.*!= "\$GITHUB_SHA"/s);
  assert.match(deploys[0], /CLUB_SCHEMA_VERSION/);
});
