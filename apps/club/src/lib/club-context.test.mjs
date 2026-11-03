import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clubOf,clubHref,clubApiPath,accountPathFor,preferredClub} from './club-context.ts';
const A='00000000-0000-4000-8000-0000000000a1',B='00000000-0000-4000-8000-0000000000b2';

test('a URL names a club, names none, or names something that is not a club',()=>{
 assert.equal(clubOf(`?club=${A}`),A);
 assert.equal(clubOf(`?date=2026-10-01&club=${A.toUpperCase()}`),A);
 assert.equal(clubOf('?date=2026-10-01'),null);
 for(const bad of ['?club=','?club=x',`?club=${A}x`])assert.equal(clubOf(bad),false,bad);
});
test('links keep their own parameters and switch to exactly one club',()=>{
 assert.equal(clubHref('/members',A),`/members?club=${A}`);
 assert.equal(clubHref(`/players?id=${B}&date=2026-10-01`,A),`/players?id=${B}&date=2026-10-01&club=${A}`);
 assert.equal(clubHref(`/members?club=${A}`,B),`/members?club=${B}`);
});
test('club API calls carry the page club; account-wide calls never do',()=>{
 assert.equal(clubApiPath('/api/members?date=2026-10-01',`?club=${A}`),`/api/members?date=2026-10-01&club=${A}`);
 assert.equal(clubApiPath('/api/team/role',`?club=${A}`),`/api/team/role?club=${A}`);
 assert.equal(clubApiPath('/api/account',`?club=${A}`),`/api/account?club=${A}`);
 // An invalid club is passed on so the Worker refuses it; dropping it would silently use the default club.
 assert.equal(clubApiPath('/api/members','?club=x'),'/api/members?club=x');
 for(const path of ['/api/login','/api/logout','/api/auth/verify','/api/mfa','/api/admin/overview'])assert.equal(clubApiPath(path,`?club=${A}`),path);
 assert.equal(clubApiPath('/api/members','?date=2026-10-01'),'/api/members');
 assert.equal(accountPathFor(`/api/members?date=1&club=${A}`),`/api/account?club=${A}`);
 assert.equal(accountPathFor('/api/members'),'/api/account');
});
test('the remembered club is only a preference the account must still be able to use',()=>{
 const two={club_id:A,permissions:['members.read'],clubs:[{id:A},{id:B}]};
 assert.equal(preferredClub(two,B),B);
 assert.equal(preferredClub(two,null),A);
 // Revoked from the remembered club: fall back, never trust the stored id.
 assert.equal(preferredClub({...two,clubs:[{id:A}]},B),A);
 assert.equal(preferredClub({club_id:A,permissions:[],clubs:[{id:B}]},A),B);
 // Several clubs, none here and nothing remembered: let the person choose.
 assert.equal(preferredClub({club_id:A,permissions:[],clubs:[{id:B},{id:'c'}]},null),null);
 assert.equal(preferredClub({club_id:A,permissions:[],clubs:[]},A),null);
});
