import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clubApi,clearClubData} from './data-access.ts';

// Browser globals are installed after import, so the module's cross-tab listeners stay inactive in tests.
function browser(pathname,status,body){
 const redirects=[];
 globalThis.window={location:{pathname,replace:url=>redirects.push(url)},dispatchEvent(){}};
 globalThis.fetch=async()=>Response.json(body,{status});
 clearClubData();
 return redirects;
}
test('an expired session (401) on a private page returns to login',async()=>{
 const redirects=browser('/members',401,{error:'请先登录'});
 await assert.rejects(clubApi('/api/members'),/请重新登录/);
 assert.deepEqual(redirects,['/login']);
});
test('a permission denial (403) keeps the user on the page and shows the server message',async()=>{
 // e.g. an admin trying an owner-only action, or a revoked membership: unsaved work must not be thrown away.
 const redirects=browser('/import',403,{error:'此账户没有俱乐部访问权限'});
 await assert.rejects(clubApi('/api/imports',{method:'POST',body:'{}'}),/此账户没有俱乐部访问权限/);
 assert.deepEqual(redirects,[]);
 browser('/settings',403,{});
 await assert.rejects(clubApi('/api/club-settings'),/没有权限/);
});
test('public pages never redirect, so a wrong password on /login cannot loop',async()=>{
 for(const path of ['/login','/','/missing-page']){
  const redirects=browser(path,401,{error:'邮箱、密码不正确'});
  await assert.rejects(clubApi('/api/login',{method:'POST',body:'{}'}),/邮箱、密码不正确/);
  assert.deepEqual(redirects,[],path);
 }
});
test('success returns the JSON body; other failures use the server message or the fallback',async()=>{
 browser('/members',200,{ok:true});
 assert.deepEqual(await clubApi('/api/members'),{ok:true});
 browser('/members',502,{error:'暂时无法读取'});
 await assert.rejects(clubApi('/api/members'),/暂时无法读取/);
 globalThis.fetch=async()=>new Response('<html>proxy</html>',{status:502});clearClubData();
 await assert.rejects(clubApi('/api/members',undefined,'读取失败'),/读取失败/);
});

test('a conflict keeps HTTP status so role changes require refreshed confirmation',async()=>{
 browser('/admin',409,{error:'角色已变化，请刷新'});
 await assert.rejects(clubApi('/api/admin/assign-role',{method:'POST',body:'{}'}),e=>e.status===409&&e.message==='角色已变化，请刷新');
});
