import {uuid,validDate} from '../src/lib/import.ts';
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function handleActivity(request:Request,club:string,rest:(path:string,body?:unknown)=>Promise<Response>){
 const url=new URL(request.url);
 let response:Response;
 if(request.method==='GET'){
  const before=url.searchParams.get('before'),id=url.searchParams.get('id');
  if((before===null)!==(id===null)||(before!==null&&(!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(before)||Number.isNaN(Date.parse(before))||!uuid.test(id??''))))return reply({error:'日志分页无效'},400);
  response=await rest('rpc/club_activity',{p_club_id:club,p_before:before,p_id:id});
 }else{
  const reader=request.body?.getReader();if(!reader)return reply({error:'缺少删除确认'},400);
  let raw='',size=0;const decoder=new TextDecoder();
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();return reply({error:'请求过大'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
  let input;try{input=JSON.parse(raw);if(input.confirmed!==true||!validDate(input.date)||!uuid.test(input.expected_snapshot_id??''))throw Error();}catch{return reply({error:'请确认要删除的日期'},400);}
  response=await rest('rpc/club_delete_import_date',{p_club_id:club,p_date:input.date,p_expected:input.expected_snapshot_id});
 }
 if(!response.ok){const e=await response.json() as {code?:string;message?:string};const status=e.code==='PT409'?409:e.code==='42501'?403:e.code==='22023'?400:502;return reply({error:status===502?'暂时无法完成操作，请重试':e.message},status);}
 return reply(await response.json());
}
