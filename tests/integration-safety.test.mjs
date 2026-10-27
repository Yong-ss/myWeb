import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localFetch, assertLocalDocker } from './integration/local.mjs';

test('integration HTTP helper rejects remote Supabase before network access',async()=>{
  for(const target of ['https://production.example.invalid/auth/v1/user','http://localhost:56321/','http://127.0.0.1:54321/']) await assert.rejects(localFetch(target),/Remote Supabase requests are forbidden/);
});
test('integration setup rejects a remote Docker host before invoking Docker',()=>{
  const previous=process.env.DOCKER_HOST;
  try { process.env.DOCKER_HOST='ssh://production.example.invalid'; assert.throws(assertLocalDocker,/Remote Docker hosts are forbidden/); }
  finally { if(previous===undefined) delete process.env.DOCKER_HOST; else process.env.DOCKER_HOST=previous; }
});
