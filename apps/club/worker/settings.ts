const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
export async function handleSettings(request:Request,club:string,role:string,rest:(path:string,body?:unknown)=>Promise<Response>){
  if(request.method==='GET'){
    const response=await rest(`club_clubs?${new URLSearchParams({select:'name',id:`eq.${club}`,limit:'1'})}`);
    if(!response.ok)return reply({error:'暂时无法读取俱乐部名称'},502);
    const row=(await response.json() as {name:string}[])[0];
    return row?reply({name:row.name,can_edit:role==='owner'}):reply({error:'找不到俱乐部'},404);
  }
  if(role!=='owner')return reply({error:'只有公会长可以修改俱乐部名称'},403);
  const reader=request.body?.getReader();if(!reader)return reply({error:'请填写名称'},400);
  let raw='',size=0;const decoder=new TextDecoder();
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();return reply({error:'请求过大'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
  let input;try{input=JSON.parse(raw);if(typeof input.name!=='string'||![...input.name.trim()].length||[...input.name.trim()].length>120||/[\u0000-\u001f\u007f]/.test(input.name)||typeof input.expected_name!=='string'||input.expected_name.length>240)throw Error();}catch{return reply({error:'请填写 1～120 个字符的名称'},400);}
  const response=await rest('rpc/club_rename',{p_club_id:club,p_name:input.name.trim(),p_expected:input.expected_name});
  if(!response.ok){const error=await response.json() as {code?:string;message?:string};const status=error.code==='PT409'?409:error.code==='42501'?403:error.code==='22023'?400:503;return reply({error:status===503?'名称设置暂时无法保存，请稍后重试':error.message},status);}
  return reply(await response.json());
}
