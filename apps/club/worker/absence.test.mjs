import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleImport} from './imports.ts';
test('an old database blocks absence review before any identity work or writes',async()=>{
 const response=await handleImport(new Request('https://local.invalid/api/import-context?date=2026-10-28&review_absences=1'),'club',async path=>{
  if(path==='rpc/club_absence_context')return Response.json({code:'PGRST202'},{status:404});
  return Response.json(path.startsWith('rpc/')?{players:[],aliases:[]}:[]);
 });
 assert.equal(response.status,503);assert.match((await response.json()).error,/数据库尚未更新/);
});
