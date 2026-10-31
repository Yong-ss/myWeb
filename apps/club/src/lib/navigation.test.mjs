import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privateLinks,publicLinks,isPrivateRoute,activeHref} from './navigation.ts';

test('sidebar entries, labels and order stay exactly as approved',()=>{
 assert.deepEqual(privateLinks.map(l=>[l.href,l.icon,l.label]),[['/account','◇','俱乐部总览'],['/analytics','◈','数据分析'],['/members','♧','成员名单'],['/import','⊕','导入数据'],['/activity','≡','操作日志']]);
 assert.deepEqual(publicLinks.map(l=>[l.href,l.icon,l.label]),[['/','◇','首页'],['/login','✧','登录']]);
});
test('every signed-in page uses the private shell; public and unknown pages never do',()=>{
 for(const path of ['/account','/analytics','/members','/players','/import','/activity','/settings','/admin','/members/'])assert.equal(isPrivateRoute(path),true,path);
 // The login page must stay public, otherwise an expired session would redirect to itself.
 for(const path of ['/','/login','/missing-page','/_not-found','/accounts'])assert.equal(isPrivateRoute(path),false,path);
});
test('a player history page highlights 成员名单; other pages highlight themselves',()=>{
 assert.equal(activeHref('/players'),'/members');
 for(const path of ['/account','/members','/import','/activity','/','/login'])assert.equal(activeHref(path),path);
 // Settings has no sidebar entry, so nothing in the sidebar is marked current.
 for(const path of ['/settings','/admin'])assert.ok(![...privateLinks,...publicLinks].some(l=>l.href===activeHref(path)),path);
});
