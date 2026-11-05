import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privateLinks,platformLinks,hubLinks,publicLinks,isPrivateRoute,activeHref,workspaceOf,workspaceSettings,landingPath,visibleLinks,switchPath} from './navigation.ts';

test('sidebar entries, labels and order stay exactly as approved',()=>{
 assert.deepEqual(privateLinks.map(l=>[l.href,l.icon,l.label]),[['/account','◇','俱乐部总览'],['/analytics','◈','数据分析'],['/members','♧','成员名单'],['/events','⚔','四方联赛'],['/highland','△','高原竞逐'],['/activity','≡','操作日志'],['/team','♔','管理员管理']]);
 assert.deepEqual(publicLinks.map(l=>[l.href,l.icon,l.label]),[['/','◇','首页'],['/login','✧','登录']]);
});
test('every signed-in page uses the private shell; public and unknown pages never do',()=>{
 for(const path of ['/account','/analytics','/members','/players','/import','/activity','/settings','/admin','/admin/security','/clubs','/team','/members/'])assert.equal(isPrivateRoute(path),true,path);
 // The login page must stay public, otherwise an expired session would redirect to itself.
 for(const path of ['/','/login','/missing-page','/_not-found','/accounts'])assert.equal(isPrivateRoute(path),false,path);
});
test('a player history page highlights 成员名单; other pages highlight themselves',()=>{
 assert.equal(activeHref('/players'),'/members');
 assert.equal(activeHref('/import'),'/members');
 assert.deepEqual(privateLinks.filter(l=>l.group==='活动').map(l=>l.href),['/events','/highland']);
 // Four-Way League import and event detail pages highlight 四方联赛 (and use the private shell).
 for(const path of ['/events/import','/event']){assert.equal(activeHref(path),'/events');assert.equal(isPrivateRoute(path),true);}
 // Highland Race pages highlight 高原竞逐, never 四方联赛.
 for(const path of ['/highland/import','/highland/event']){assert.equal(activeHref(path),'/highland');assert.equal(isPrivateRoute(path),true);}
 for(const path of ['/account','/members','/activity','/','/login'])assert.equal(activeHref(path),path);
 // Settings has no sidebar entry, so nothing in the sidebar is marked current.
 for(const path of ['/settings'])assert.ok(![...privateLinks,...publicLinks].some(l=>l.href===activeHref(path)),path);
});

// Platform identity, club role and the current club are separate: the Super Admin starts in the platform centre even
// when the same account is also a club owner, and without MFA (the platform page explains it). Everyone else starts in the club.
test('the Super Admin lands in the platform workspace; club roles land in the club workspace',()=>{
 assert.equal(landingPath({super_admin:true}),'/admin');
 assert.equal(landingPath({super_admin:true,permissions:[]}),'/admin');
 // Stage D: the landing names its club. Permissions in the default club open it; the last club this browser managed
 // wins while the account can still enter it; several clubs and no preference land in the hub to choose.
 const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b2';
 assert.equal(landingPath({super_admin:false,club_id:A,permissions:['members.read'],clubs:[{id:A}]}),`/account?club=${A}`);
 assert.equal(landingPath({super_admin:false,club_id:A,permissions:['members.read'],clubs:[{id:A},{id:B}]},B),`/account?club=${B}`);
 assert.equal(landingPath({super_admin:false,club_id:A,permissions:[],clubs:[{id:B}]},A),`/account?club=${B}`);
 assert.equal(landingPath({super_admin:true,club_id:A,permissions:['members.read'],clubs:[{id:A}]},A),'/admin');
 // Stage E: a platform admin starts in the platform workspace too, with or without club roles (MFA is explained there).
 for(const clubs of [[],[{id:A}]])assert.equal(landingPath({super_admin:false,platform_admin:true,club_id:A,permissions:clubs.length?['members.read']:[],clubs},A),'/admin');
 // Stage F: a leader with no club to resume lands in the alliance workspace; with a club role they resume that club.
 assert.equal(landingPath({club_id:A,permissions:[],clubs:[],alliance_leader:true}),'/alliance');
 // The default club is in their alliance (read-only access), but they hold no role there: still the alliance workspace.
 assert.equal(landingPath({club_id:A,permissions:['audit.read','members.read'],clubs:[],alliance_leader:true}),'/alliance');
 assert.equal(landingPath({club_id:A,permissions:[],clubs:[{id:B}],alliance_leader:true}),`/account?club=${B}`);
 for(const account of [{super_admin:false,permissions:[]},{},{club_id:A,permissions:[],clubs:[{id:B},{id:'c'}]}])assert.equal(landingPath(account),'/clubs');
 assert.equal(workspaceOf('/clubs'),'hub');assert.equal(workspaceSettings.hub,undefined);
 assert.deepEqual(platformLinks.map(l=>l.href),['/admin','/admin/security']);assert.deepEqual(hubLinks.map(l=>l.href),['/clubs']);
 for(const path of ['/admin/','/admin/security'])assert.equal(workspaceOf(path),'platform',path);
 // Each workspace's settings link stays in that workspace: platform security never opens a club's settings.
 assert.equal(workspaceOf(workspaceSettings.platform.href),'platform');assert.equal(workspaceOf(workspaceSettings.club.href),'club');
 for(const path of ['/account','/members','/settings','/players'])assert.equal(workspaceOf(path),'club',path);
});
test('the admin management entry shows only to holders of an owner management power (display only)',()=>{
 const club=['members.read','imports.create','audit.read'];
 assert.ok(!visibleLinks(privateLinks,club).some(l=>l.href==='/team'));
 assert.ok(visibleLinks(privateLinks,[...club,'club.admins.manage']).some(l=>l.href==='/team'));
 assert.ok(visibleLinks(privateLinks,['club.admins.permissions']).some(l=>l.href==='/team'));
 // Stage F: import and the club log need their permissions too, so a read-only alliance leader (members.read and
 // audit.read only) sees no import entry and no admin management (display only; the Worker and database refuse anyway).
 assert.deepEqual(visibleLinks(privateLinks,['members.read','audit.read']).map(l=>l.href),['/account','/analytics','/members','/activity']);
 assert.deepEqual(visibleLinks(privateLinks,[]).map(l=>l.href),['/account','/analytics','/members']);
 assert.ok(!visibleLinks(privateLinks,['imports.create']).some(l=>l.href==='/import'));
});
test('switching club keeps the section but drops parameters that only mean something in the old club',()=>{
 for(const path of ['/account','/members','/activity','/team','/settings','/analytics'])assert.equal(switchPath(path),path);
 assert.equal(switchPath('/import'),'/members');
 assert.equal(switchPath('/players'),'/members'); // a player belongs to one club
 for(const path of ['/admin','/clubs','/missing'])assert.equal(switchPath(path),'/account');
});
