import {uuid} from '../src/domain/member.ts';
import {reply,rpcFailure,type Rest} from './http.ts';
// Platform readers (read-only). The route table requires platform.read; every RPC checks it again in the database.
const cursorTime=/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;
export async function handleAdmin(request:Request,_club:string,rest:Rest){
 const url=new URL(request.url),p=url.searchParams;
 let path:string,body:Record<string,unknown>={};
 if(url.pathname==='/api/admin/overview')path='rpc/platform_overview';
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
