import {uuid,validDate} from '../src/domain/member.ts';
import {reply,readBody,rpcFailure,type Rest} from './http.ts';
export async function handleActivity(request:Request,club:string,rest:Rest){
 const url=new URL(request.url);
 let response:Response;
 if(request.method==='GET'){
  const before=url.searchParams.get('before'),id=url.searchParams.get('id');
  if((before===null)!==(id===null)||(before!==null&&(!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(before)||Number.isNaN(Date.parse(before))||!uuid.test(id??''))))return reply({error:'日志分页无效'},400);
  response=await rest('rpc/club_activity',{p_club_id:club,p_before:before,p_id:id});
 }else{
  const raw=await readBody(request,2048,{missing:'缺少删除确认'});if(raw instanceof Response)return raw;
  let input;try{input=JSON.parse(raw);if(input.confirmed!==true||!validDate(input.date)||!uuid.test(input.expected_snapshot_id??''))throw Error();}catch{return reply({error:'请确认要删除的日期'},400);}
  response=await rest('rpc/club_delete_import_date',{p_club_id:club,p_date:input.date,p_expected:input.expected_snapshot_id});
 }
 if(!response.ok)return rpcFailure(response,'暂时无法完成操作，请重试');
 return reply(await response.json());
}
