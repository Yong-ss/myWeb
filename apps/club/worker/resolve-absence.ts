import {uuid} from '../src/domain/member.ts';
import {validateAbsences} from '../src/features/import/contract.ts';
import {reply,readBody,rpcFailure,type Rest} from './http.ts';
export async function resolveAbsence(request:Request,club:string,rest:Rest){
 const raw=await readBody(request,4096,{missing:'请选择处理方式'});if(raw instanceof Response)return raw;
 let input;try{input=JSON.parse(raw);if(!input||!uuid.test(input.snapshot_id??'')||input.confirmed!==true||!['left','temporary'].includes(input.decision))throw Error('请选择退会或暂离');validateAbsences([{player_id:input.player_id,decision:input.decision,...(input.reason!==undefined?{reason:input.reason}:{})}]);}catch(e){return reply({error:e instanceof Error?e.message:'处理内容无效'},400);}
 const result=await rest('rpc/club_resolve_absence',{p_club:club,p_snapshot:input.snapshot_id,p_player:input.player_id,p_decision:input.decision,p_reason:input.reason??null});
 return result.ok?reply(await result.json()):rpcFailure(result,'处理未完成，请重试');
}
