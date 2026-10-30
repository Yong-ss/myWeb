import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {permissions} from './permissions.ts';

// The Worker gates routes with this list and the database decides with its registry; a key missing on either side
// would silently deny (or, worse, be assumed) a permission.
test('the shared permission list equals every key registered by migrations',()=>{
 const dir=resolve(import.meta.dirname,'../../../../supabase/migrations');
 const sql=readdirSync(dir).filter(f=>f.endsWith('.sql')).map(f=>readFileSync(resolve(dir,f),'utf8')).join('\n');
 const registered=[...sql.matchAll(/\('([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)', '(?:action|field)'/g)].map(m=>m[1]).sort();
 assert.ok(registered.length>0);
 assert.deepEqual([...permissions].sort(),registered);
});
