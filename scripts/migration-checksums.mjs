import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Prints a read-only SQL query that compares every function body in a migration file
// with the deployed pg_proc.prosrc. Run the query after applying; every row must say ok.
export function functionChecksums(sql) {
  const re = /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns[\s\S]*?\$\$([\s\S]*?)\$\$/gi;
  return [...sql.matchAll(re)].map(([, name, args, body]) => ({ name, args: args.split(',').filter(a => a.trim()).length, md5: createHash('md5').update(body).digest('hex') }));
}
export function checkQuery(checks) {
  const rows = checks.map(c => `('${c.name}',${c.args},'${c.md5}')`).join(',\n  ');
  return `select e.name, case when md5(p.prosrc)=e.md5 then 'ok' else 'MISMATCH' end as status
from (values
  ${rows}) e(name,args,md5)
left join pg_proc p on p.oid = (select oid from pg_proc where proname=split_part(e.name,'.',2) and pronamespace=split_part(e.name,'.',1)::regnamespace and pronargs=e.args)
order by 1;`;
}
if (process.argv[2]) console.log(checkQuery(functionChecksums(readFileSync(process.argv[2], 'utf8'))));
