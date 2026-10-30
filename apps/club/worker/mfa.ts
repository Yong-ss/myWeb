import {uuid} from '../src/domain/member.ts';
import {reply,readBody,type Access} from './http.ts';

// Supabase Auth TOTP, proxied because session cookies are HttpOnly. Never logs or stores secrets or codes;
// authorization effects come only from the aal2 session Auth issues, which the database checks.
type Auth=(path:string,body?:unknown,method?:string)=>Promise<Response>;
type Factor={id:string;factor_type:string;status:string;friendly_name?:string;created_at?:string};
// trusted: factor IDs the owner confirmed in SQL Editor; only those activate Super Admin powers (see migration).
export async function handleMfa(request:Request,auth:Auth,access:Access,trusted:()=>Promise<string[]>):Promise<{response:Response;session?:unknown}>{
 const factors=async()=>{const r=await auth('user');if(!r.ok)throw Error('Auth user unavailable');return ((await r.json()).factors??[]).filter((f:Factor)=>f.factor_type==='totp') as Factor[];};
 if(request.method==='GET'){const ok=new Set(await trusted());return {response:reply({factors:(await factors()).filter(f=>f.status==='verified').map(f=>({id:f.id,name:f.friendly_name??'',created_at:f.created_at??null,trusted:ok.has(f.id)}))})};}
 const raw=await readBody(request,1024,{missing:'缺少操作'});if(raw instanceof Response)return {response:raw};
 let input;try{input=JSON.parse(raw);}catch{return {response:reply({error:'请求内容无效'},400)};}
 if(input?.action==='enroll'){
  const existing=await factors();
  // A stolen password alone must not add an attacker's authenticator once one is verified (Auth enforces this too).
  if(!access.sessionAal2&&existing.some(f=>f.status==='verified'))return {response:reply({error:'请先用现有验证器完成验证，再添加新的验证器'},403)};
  // Abandoned setups must not pile up; unverified factors can be removed without MFA.
  for(const f of existing)if(f.status!=='verified')await auth(`factors/${f.id}`,undefined,'DELETE');
  const name=typeof input.name==='string'&&input.name.trim()?[...input.name.trim()].slice(0,30).join(''):'验证器';
  // Auth requires unique names per account, so the time distinguishes devices with the same label.
  const r=await auth('factors',{factor_type:'totp',friendly_name:`${name} ${new Date().toISOString().slice(0,16).replace('T',' ')}`,issuer:'SquirrelAPI Club'});
  if(!r.ok)return {response:reply({error:'暂时无法开始绑定，请稍后重试'},502)};
  const f=await r.json();
  // Auth returns raw SVG markup; as an <img src> it would be requested as a relative URL (leaking the secret in the
  // path and showing a broken image). A data: URL renders locally; SVG in <img> cannot run scripts.
  const svg=typeof f.totp?.qr_code==='string'?f.totp.qr_code:'';
  const qr=svg.startsWith('data:image/')?svg:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return {response:reply({id:f.id,qr_code:qr,secret:f.totp?.secret})};
 }
 if(!['verify','remove'].includes(input?.action)||!uuid.test(input.factor_id??''))return {response:reply({error:'请选择验证器'},400)};
 if(input.action==='remove'){
  // Auth itself refuses to remove a verified factor without an aal2 session.
  const r=await auth(`factors/${input.factor_id}`,undefined,'DELETE');
  return {response:r.ok?reply({removed:true}):reply({error:r.status>=500?'暂时无法移除，请稍后重试':'请先用验证码完成两步验证，再移除验证器'},r.status>=500?502:403)};
 }
 if(typeof input.code!=='string'||!/^\d{6}$/.test(input.code))return {response:reply({error:'请输入 6 位验证码'},400)};
 const challenge=await auth(`factors/${input.factor_id}/challenge`,{});
 if(!challenge.ok)return {response:reply({error:challenge.status===429?'尝试过于频繁，请稍后再试':'验证器不存在，请重新绑定'},challenge.status===429?429:400)};
 const verified=await auth(`factors/${input.factor_id}/verify`,{challenge_id:(await challenge.json()).id,code:input.code});
 if(!verified.ok)return {response:reply({error:verified.status===429?'尝试过于频繁，请稍后再试':'验证码不正确或已过期'},verified.status===429?429:400)};
 return {response:reply({verified:true}),session:await verified.json()};
}
