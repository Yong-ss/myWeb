import {uuid} from '../src/domain/member.ts';
import {isPermission} from '../src/domain/permissions.ts';
import {reply,readBody,rpcFailure,type Rest} from './http.ts';
// Stage C: the owner manages this club's admins. The route table declares club.admins.manage / club.admins.permissions;
// the club is the request's club (checked by index.ts before this runs; never taken from the body), and every RPC rechecks in the database.
const writes:Record<string,string[]>={
 '/api/team/role':['user_id','action','expected_version','request_id'],
 '/api/team/default':['permission','value'],
 '/api/team/personal':['user_id','permission','value'],
};
export async function handleTeam(request:Request,club:string,rest:Rest){
 const url=new URL(request.url);
 let path:string,body:Record<string,unknown>;
 if(request.method==='GET'){
  if(url.pathname==='/api/team'){path='rpc/club_team_admins';body={p_club:club};}
  else if(url.pathname==='/api/team/permissions'){path='rpc/club_team_permissions';body={p_club:club};}
  else{
   const email=url.searchParams.get('email')?.trim()??'';
   if(email.length<3||email.length>320||!email.includes('@'))return reply({error:'请输入有效的邮箱'},400);
   path='rpc/club_admin_candidate';body={p_club:club,p_email:email};
  }
 }else{
  const keys=writes[url.pathname];
  const raw=await readBody(request,2048,{missing:'请求内容无效'});if(raw instanceof Response)return raw;
  let input;try{input=JSON.parse(raw);}catch{return reply({error:'请求内容无效'},400);}
  // Exact key sets: a client-supplied club id (or anything else) is refused, not ignored.
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k))||
   ('user_id' in input&&(typeof input.user_id!=='string'||!uuid.test(input.user_id))))return reply({error:'请求参数无效'},400);
  if(url.pathname==='/api/team/role'){
   if(!['grant','revoke','remove'].includes(input.action)||typeof input.request_id!=='string'||!uuid.test(input.request_id)||!Number.isSafeInteger(input.expected_version)||input.expected_version<0)
    return reply({error:'职位操作参数无效'},400);
   path='rpc/club_change_admin';body={p_club:club,p_user:input.user_id,p_action:input.action,p_expected:input.expected_version,p_request:input.request_id};
  }else{
   if(!isPermission(input.permission)||!(typeof input.value==='boolean'||input.value===null))return reply({error:'权限设置参数无效'},400);
   path=url.pathname==='/api/team/default'?'rpc/club_set_admin_default':'rpc/club_set_admin_permission';
   body=url.pathname==='/api/team/default'?{p_club:club,p_permission:input.permission,p_value:input.value}:{p_club:club,p_user:input.user_id,p_permission:input.permission,p_value:input.value};
  }
 }
 const response=await rest(path,body);
 if(!response.ok)return rpcFailure(response,request.method==='GET'?'管理员资料暂时无法读取，请重试':'暂时无法保存，请重试');
 return reply(await response.json());
}
