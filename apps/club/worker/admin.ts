import {uuid} from '../src/domain/member.ts';
import {isPermission} from '../src/domain/permissions.ts';
import {reply,readBody,rpcFailure,type Rest,type Access} from './http.ts';
// Platform readers (read-only). The route table requires platform.read; every RPC checks it again in the database.
const cursorTime=/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/;
export async function handleAdmin(request:Request,_club:string,rest:Rest,access:Access){
 const url=new URL(request.url),p=url.searchParams;
 let path:string,body:Record<string,unknown>={};
 const roleWrite=['/api/admin/assign-role','/api/admin/transfer-owner','/api/admin/remove-from-club'].includes(url.pathname);
 if(roleWrite||url.pathname==='/api/admin/role-context'||url.pathname==='/api/admin/admin-limit'){
  // Role changes: active Super Admin or platform admin (the route table checked the platform permission); the
  // database decides again. The admin limit stays Super Admin only.
  if(url.pathname==='/api/admin/admin-limit'&&!access.superAdminActive)return reply({error:'需要已启用的超级管理员'},403);
  if(request.method==='GET'){
   const user=p.get('user');if(!user||!uuid.test(user))return reply({error:'目标账户无效'},400);
   path='rpc/platform_role_context';body={p_user:user};
  }else{
   const raw=await readBody(request,4096,{missing:'请选择目标账户、俱乐部和职位'});if(raw instanceof Response)return raw;
   let input;try{input=JSON.parse(raw);}catch{return reply({error:'请求内容无效'},400);}
   // Exact key sets per write; the transfer choice for the previous owner has no default.
   const keys=url.pathname==='/api/admin/assign-role'?['club_id','user_id','role','action','expected_version','request_id']
    :url.pathname==='/api/admin/transfer-owner'?['club_id','user_id','previous_owner','expected_version','request_id']
    :url.pathname==='/api/admin/remove-from-club'?['club_id','user_id','expected_version','request_id']:['club_id','admin_limit'];
   const ids=roleWrite?[input?.club_id,input?.user_id,input?.request_id]:[input?.club_id];
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k))||
     !ids.every(v=>typeof v==='string'&&uuid.test(v))||(roleWrite&&(!Number.isSafeInteger(input.expected_version)||input.expected_version<0)))return reply({error:'职位操作参数无效'},400);
   if(url.pathname==='/api/admin/assign-role'){
    // Transfer goes only through transfer-owner, where the previous owner's outcome is chosen explicitly.
    if(!['owner','admin'].includes(input.role)||!['grant','revoke'].includes(input.action))return reply({error:'职位操作参数无效'},400);
    path='rpc/platform_assign_role';body={p_club:input.club_id,p_user:input.user_id,p_role:input.role,p_action:input.action,p_expected:input.expected_version,p_request:input.request_id};
   }else if(url.pathname==='/api/admin/transfer-owner'){
    if(!['admin','leave'].includes(input.previous_owner))return reply({error:'请选择原公会长的去留'},400);
    path='rpc/platform_transfer_owner';body={p_club:input.club_id,p_user:input.user_id,p_previous_owner:input.previous_owner,p_expected:input.expected_version,p_request:input.request_id};
   }else if(url.pathname==='/api/admin/remove-from-club'){
    path='rpc/platform_remove_from_club';body={p_club:input.club_id,p_user:input.user_id,p_expected:input.expected_version,p_request:input.request_id};
   }else{
    if(!Number.isSafeInteger(input.admin_limit)||input.admin_limit<1||input.admin_limit>1000)return reply({error:'管理员人数上限须为 1 到 1000 之间的整数'},400);
    path='rpc/platform_set_admin_limit';body={p_club:input.club_id,p_limit:input.admin_limit};
   }
  }
 }else if(url.pathname==='/api/admin/platform-admin'){
  // Stage E: the Super Admin appoints or revokes platform admins (platform.platform_admins.assign, Super Admin only).
  if(!access.superAdminActive)return reply({error:'需要已启用的超级管理员'},403);
  const raw=await readBody(request,1024,{missing:'请选择目标账户'});if(raw instanceof Response)return raw;
  let input;try{input=JSON.parse(raw);}catch{return reply({error:'请求内容无效'},400);}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join()!=='action,user_id'||typeof input.user_id!=='string'||!uuid.test(input.user_id)||!['grant','revoke'].includes(input.action))
   return reply({error:'平台管理员操作参数无效'},400);
  path='rpc/platform_set_platform_admin';body={p_user:input.user_id,p_action:input.action};
 }else if(url.pathname==='/api/admin/remove-from-all-clubs'){
  // Stage G (platform.users.remove_all_clubs, Super Admin only). `expected` is the preview: {club_id: role_version} of
  // every club the account holds a role in; the database refuses the whole removal if anything differs.
  if(!access.superAdminActive)return reply({error:'需要已启用的超级管理员'},403);
  const raw=await readBody(request,16384,{missing:'请选择目标账户'});if(raw instanceof Response)return raw;
  let input;try{input=JSON.parse(raw);}catch{return reply({error:'请求内容无效'},400);}
  const keys=input&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input).sort().join():'';
  const expected=input?.expected,entries=expected&&typeof expected==='object'&&!Array.isArray(expected)?Object.entries(expected):null;
  if(keys!=='expected,request_id,user_id'||typeof input.user_id!=='string'||!uuid.test(input.user_id)||typeof input.request_id!=='string'||!uuid.test(input.request_id)
   ||!entries||entries.length>500||!entries.every(([club,version])=>uuid.test(club)&&Number.isSafeInteger(version)&&(version as number)>=0))return reply({error:'移出参数无效'},400);
  path='rpc/platform_remove_from_all_clubs';body={p_user:input.user_id,p_expected:expected,p_request:input.request_id};
 }else if(url.pathname==='/api/admin/alliances')path='rpc/platform_alliances';
 else if(['/api/admin/alliance','/api/admin/club-alliance','/api/admin/alliance-leader'].includes(url.pathname)){
  // Stage F (platform.alliances.manage / platform.alliance_leaders.assign): Super Admin or active platform admin.
  const raw=await readBody(request,1024,{missing:'请填写联盟信息'});if(raw instanceof Response)return raw;
  let input;try{input=JSON.parse(raw);}catch{return reply({error:'请求内容无效'},400);}
  const keys=input&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input).sort().join():'';
  const id=(v:unknown)=>typeof v==='string'&&uuid.test(v),optional=(v:unknown)=>v===null||id(v);
  if(url.pathname==='/api/admin/alliance'){
   if(keys!=='alliance_id,name,status'||!optional(input.alliance_id)||typeof input.name!=='string'||input.name.length>60||!['active','disabled'].includes(input.status))return reply({error:'联盟名称须为 1 到 60 个字'},400);
   path='rpc/platform_save_alliance';body={p_alliance:input.alliance_id,p_name:input.name,p_status:input.status};
  }else if(url.pathname==='/api/admin/club-alliance'){
   if(keys!=='alliance_id,club_id'||!id(input.club_id)||!optional(input.alliance_id))return reply({error:'俱乐部或联盟无效'},400);
   path='rpc/platform_set_club_alliance';body={p_club:input.club_id,p_alliance:input.alliance_id};
  }else{
   if(keys!=='action,alliance_id,email'||!id(input.alliance_id)||!['grant','revoke'].includes(input.action)||(input.action==='grant'?typeof input.email!=='string'||input.email.length>320:input.email!==null))return reply({error:'会长操作参数无效'},400);
   path='rpc/platform_set_alliance_leader';body={p_alliance:input.alliance_id,p_email:input.email,p_action:input.action};
  }
 }else if(url.pathname==='/api/admin/role-permission'||url.pathname==='/api/admin/personal-permission'){
  // Stage B layer writes (platform.permissions.manage). value: true/false, or null = follow the defaults again
  // (club defaults and personal permissions only). The database rechecks everything, including non-delegable rules.
  if(!access.superAdminActive)return reply({error:'需要已启用的超级管理员'},403);
  const raw=await readBody(request,4096,{missing:'请选择要修改的权限'});if(raw instanceof Response)return raw;
  let input;try{input=JSON.parse(raw);}catch{return reply({error:'请求内容无效'},400);}
  const personal=url.pathname==='/api/admin/personal-permission';
  const keys=personal?['club_id','user_id','permission','value']:input?.layer==='club_default'?['layer','role','permission','value','club_id']:['layer','role','permission','value'];
  const ids=personal?[input?.club_id,input?.user_id]:input?.layer==='club_default'?[input?.club_id]:[];
  const tri=personal||input?.layer==='club_default';
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||Object.keys(input).some(k=>!keys.includes(k))||
    !ids.every(v=>typeof v==='string'&&uuid.test(v))||!isPermission(input.permission)||!(typeof input.value==='boolean'||(tri&&input.value===null))||
    (!personal&&(!['platform_default','cap','club_default'].includes(input.layer)||!['owner','admin'].includes(input.role))))return reply({error:'权限设置参数无效'},400);
  if(personal){path='rpc/platform_set_personal_permission';body={p_club:input.club_id,p_user:input.user_id,p_permission:input.permission,p_value:input.value};}
  else{path='rpc/platform_set_role_permission';body={p_layer:input.layer,p_role:input.role,p_permission:input.permission,p_value:input.value,p_club:input.club_id??null};}
 }else if(url.pathname==='/api/admin/event-permissions'||url.pathname==='/api/admin/highland-permissions'||url.pathname==='/api/admin/dragon-permissions'){
  const club=p.get('club');if(!club||!uuid.test(club))return reply({error:'目标俱乐部无效'},400);
  path=url.pathname==='/api/admin/event-permissions'?'rpc/platform_event_permissions':url.pathname==='/api/admin/highland-permissions'?'rpc/platform_highland_permissions':'rpc/platform_dragon_permissions';body={p_club:club};
 }else if(url.pathname==='/api/admin/event-permission'||url.pathname==='/api/admin/highland-permission'||url.pathname==='/api/admin/dragon-permission'){
  // The Four-Way League and the Highland Race each set only their own three permissions.
  // Exactly one of role (club role level) or user_id (personal); value null = follow the lower layers.
  const raw=await readBody(request,1024,{missing:'请选择要修改的权限'});if(raw instanceof Response)return raw;
  let input;try{input=JSON.parse(raw);}catch{return reply({error:'请求内容无效'},400);}
  const kind=url.pathname==='/api/admin/highland-permission'?'highland':url.pathname==='/api/admin/dragon-permission'?'dragon':'events';
  const keys=input&&typeof input==='object'&&!Array.isArray(input)?Object.keys(input).sort().join():'';
  if(keys!=='club_id,permission,role,user_id,value'||typeof input.club_id!=='string'||!uuid.test(input.club_id)||![`${kind}.read`,`${kind}.import`,`${kind}.edit`].includes(input.permission)
   ||!(typeof input.value==='boolean'||input.value===null)||(input.role===null)===(input.user_id===null)||(input.role!==null&&!['owner','admin'].includes(input.role))
   ||(input.user_id!==null&&(typeof input.user_id!=='string'||!uuid.test(input.user_id))))return reply({error:'权限设置参数无效'},400);
  path=kind==='events'?'rpc/platform_set_event_permission':`rpc/platform_set_${kind}_permission`;body={p_club:input.club_id,p_role:input.role,p_user:input.user_id,p_permission:input.permission,p_value:input.value};
 }else if(url.pathname==='/api/admin/permission-settings'){
  const club=p.get('club');if(club!==null&&!uuid.test(club))return reply({error:'目标俱乐部无效'},400);
  path='rpc/platform_permission_settings';body={p_club:club};
 }else if(url.pathname==='/api/admin/permission-explain'){
  const club=p.get('club'),user=p.get('user');if(!club||!uuid.test(club)||!user||!uuid.test(user))return reply({error:'目标账户或俱乐部无效'},400);
  path='rpc/platform_permission_explain';body={p_club:club,p_user:user};
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
