import {uuid} from '../src/domain/member.ts';
import {reply,readBody,rpcFailure,type Rest} from './http.ts';
// Stage F. The route table requires the alliance leader identity (workspace, decisions) or club.alliance.request
// (owner join requests); every RPC checks again in the database, which decides the alliance and club itself.
export async function handleAlliance(request:Request,club:string,rest:Rest){
 const url=new URL(request.url);
 let path:string,body:Record<string,unknown>;
 if(request.method==='GET'){
  if(url.pathname==='/api/alliance'){path='rpc/club_my_alliance';body={};}
  else{path='rpc/club_alliance_status';body={p_club:club};}
 }else{
  const raw=await readBody(request,1024,{missing:'缺少操作'});if(raw instanceof Response)return raw;
  let input;try{input=JSON.parse(raw);}catch{return reply({error:'请求内容无效'},400);}
  const keys=input&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input).sort().join():'';
  // Exact key sets; the club always comes from the request (never the body), the alliance from the database.
  if(url.pathname==='/api/alliance/decide'){
   if(keys!=='decision,request_id'||typeof input.request_id!=='string'||!uuid.test(input.request_id)||!['approve','reject'].includes(input.decision))return reply({error:'申请处理参数无效'},400);
   path='rpc/alliance_decide_request';body={p_request:input.request_id,p_decision:input.decision};
  }else if(keys==='action,alliance_id'&&input.action==='request'&&typeof input.alliance_id==='string'&&uuid.test(input.alliance_id)){
   path='rpc/club_request_alliance';body={p_club:club,p_alliance:input.alliance_id};
  }else if(keys==='action'&&input.action==='withdraw'){
   path='rpc/club_withdraw_alliance_request';body={p_club:club};
  }else return reply({error:'联盟申请参数无效'},400);
 }
 const response=await rest(path,body);
 if(!response.ok)return rpcFailure(response,'联盟资料暂时无法读取，请重试');
 return reply(await response.json());
}
