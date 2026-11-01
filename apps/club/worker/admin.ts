import {uuid} from '../src/domain/member.ts';
import {reply,readBody,rpcFailure,type Rest,type Access} from './http.ts';
// Platform readers (read-only). The route table requires platform.read; every RPC checks it again in the database.
const cursorTime=/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;
export async function handleAdmin(request:Request,_club:string,rest:Rest,access:Access){
 const url=new URL(request.url),p=url.searchParams;
 let path:string,body:Record<string,unknown>={};
 if(url.pathname==='/api/admin/assign-role'||url.pathname==='/api/admin/role-context'){
  if(!access.superAdminActive)return reply({error:'需要已启用的超级管理员'},403);
  if(request.method==='GET'){
   const user=p.get('user');if(!user||!uuid.test(user))return reply({error:'目标账户无效'},400);
   path='rpc/platform_role_context';body={p_user:user};
  }else{
   const raw=await readBody(request,4096,{missing:'请选择目标账户、俱乐部和角色'});if(raw instanceof Response)return raw;
   let input;try{input=JSON.parse(raw);}catch{return reply({error:'请求内容无效'},400);}
   const keys=['club_id','user_id','role','action','expected_version','request_id'];
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k))||
     ![input.club_id,input.user_id,input.request_id].every(v=>typeof v==='string'&&uuid.test(v))||!['owner','admin'].includes(input.role)||!['grant','revoke','transfer'].includes(input.action)||
     !Number.isSafeInteger(input.expected_version)||input.expected_version<0||(input.action==='transfer'&&input.role!=='owner'))return reply({error:'角色操作参数无效'},400);
   path='rpc/platform_assign_role';body={p_club:input.club_id,p_user:input.user_id,p_role:input.role,p_action:input.action,p_expected:input.expected_version,p_request:input.request_id};
  }
 }else if(url.pathname==='/api/admin/overview')path='rpc/platform_overview';
 else if(url.pathname==='/api/admin/roles')path='rpc/platform_roles';
 else if(url.pathname==='/api/admin/users'){
  const q=p.get('q')??'',after=p.get('after'),id=p.get('id');
  if(q.length>100||(after===null)!==(id===null)||(id!==null&&(!uuid.test(id)||after!.length>320)))return reply({error:'搜索条件无效'},400);
  path='rpc/platform_users';body={p_query:q.trim()||null,p_after_key:after,p_after_id:id};
 }else{
  const before=p.get('before'),id=p.get('id');
  if((before===null)!==(id===null)||(before!==null&&(!cursorTime.test(before)||Number.isNaN(Date.parse(before))||!uuid.test(id??''))))return reply({error:'日志分页无效'},400);
  path='rpc/platform_activity';body={p_before:before,p_id:id};
 }
 const response=await rest(path,body);
 if(!response.ok)return rpcFailure(response,'平台资料暂时无法读取，请重试');
 return reply(await response.json());
}
