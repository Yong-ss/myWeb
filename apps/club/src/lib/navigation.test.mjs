import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privateLinks,platformLinks,hubLinks,publicLinks,isPrivateRoute,activeHref,workspaceOf,workspaceSettings,landingPath} from './navigation.ts';

test('sidebar entries, labels and order stay exactly as approved',()=>{
 assert.deepEqual(privateLinks.map(l=>[l.href,l.icon,l.label]),[['/account','◇','俱乐部总览'],['/analytics','◈','数据分析'],['/members','♧','成员名单'],['/import','⊕','导入数据'],['/activity','≡','操作日志']]);
 assert.deepEqual(publicLinks.map(l=>[l.href,l.icon,l.label]),[['/','◇','首页'],['/login','✧','登录']]);
});
test('every signed-in page uses the private shell; public and unknown pages never do',()=>{
 for(const path of ['/account','/analytics','/members','/players','/import','/activity','/settings','/admin','/admin/security','/clubs','/members/'])assert.equal(isPrivateRoute(path),true,path);
 // The login page must stay public, otherwise an expired session would redirect to itself.
 for(const path of ['/','/login','/missing-page','/_not-found','/accounts'])assert.equal(isPrivateRoute(path),false,path);
});
test('a player history page highlights 成员名单; other pages highlight themselves',()=>{
 assert.equal(activeHref('/players'),'/members');
 for(const path of ['/account','/members','/import','/activity','/','/login'])assert.equal(activeHref(path),path);
 // Settings has no sidebar entry, so nothing in the sidebar is marked current.
 for(const path of ['/settings'])assert.ok(![...privateLinks,...publicLinks].some(l=>l.href===activeHref(path)),path);
});

// Platform identity, club role and the current club are separate: the Super Admin starts in the platform centre even
// when the same account is also a club owner, and without MFA (the platform page explains it). Everyone else starts in the club.
test('the Super Admin lands in the platform workspace; club roles land in the club workspace',()=>{
 assert.equal(landingPath({super_admin:true}),'/admin');
 assert.equal(landingPath({super_admin:true,permissions:[]}),'/admin');
 // Permissions in this deployment's club open it; a role only elsewhere lands in the hub, never in this club.
 assert.equal(landingPath({super_admin:false,permissions:['members.read']}),'/account');
 for(const account of [{super_admin:false,permissions:[]},{}])assert.equal(landingPath(account),'/clubs');
 assert.equal(workspaceOf('/clubs'),'hub');assert.equal(workspaceSettings.hub,undefined);
 assert.deepEqual(platformLinks.map(l=>l.href),['/admin','/admin/security']);assert.deepEqual(hubLinks.map(l=>l.href),['/clubs']);
 for(const path of ['/admin/','/admin/security'])assert.equal(workspaceOf(path),'platform',path);
 // Each workspace's settings link stays in that workspace: platform security never opens a club's settings.
 assert.equal(workspaceOf(workspaceSettings.platform.href),'platform');assert.equal(workspaceOf(workspaceSettings.club.href),'club');
 for(const path of ['/account','/members','/settings','/players'])assert.equal(workspaceOf(path),'club',path);
});
