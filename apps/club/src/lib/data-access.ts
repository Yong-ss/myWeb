import {isPrivateRoute} from "./navigation.ts";
import {accountPathFor,clubApiPath} from "./club-context.ts";
/** Private, bounded in-memory cache. Never persist cookies or business data. */
export function createDataAccess(network:typeof fetch=fetch,now=()=>Date.now(),updated:(path:string)=>void=()=>{}) {
  const entries=new Map<string,{scope:string;response:Response;at:number}>();
  const pending=new Map<string,Promise<Response>>();
  let generation=0;
  function clear(){generation++;entries.clear();pending.clear();}
  async function once(path:string,init?:RequestInit):Promise<Response>{
    const key=path;let task=pending.get(key);
    if(!task){task=network(path,{...init,signal:undefined,cache:'no-store'});pending.set(key,task);void task.finally(()=>{if(pending.get(key)===task)pending.delete(key);}).catch(()=>{});}
    return (await task).clone();
  }
  async function read(path:string,init?:RequestInit):Promise<Response>{
    const method=init?.method??'GET';
    if(method!=='GET'){clear();try{return await network(path,{...init,cache:'no-store'});}finally{clear();}}
    if(!/^\/api\/(members|club-settings)(\?|$)/.test(path)) {
      const response=await once(path,init);if([401,403].includes(response.status))clear();return response;
    }
    const epoch=generation,cached=entries.get(path);
    if(cached&&now()-cached.at<30000){
      // No authorization TTL: verify current user and active membership on EVERY reuse, for the same club.
      const gate=await once(accountPathFor(path));
      if(!gate.ok){clear();return gate;}
      if(epoch===generation&&gate.headers.get('X-Club-Scope')===cached.scope){
        if(now()-cached.at>5000)void once(path).then(response=>{
          if(epoch!==generation)return;
          if([401,403].includes(response.status)){clear();updated(path);return;}
          if(response.ok&&response.headers.get('X-Club-Scope')===cached.scope){entries.set(path,{scope:cached.scope,response:response.clone(),at:now()});updated(path);}
        }).catch(()=>{});
        return cached.response.clone();
      }
      clear();
    }
    const version=generation,response=await once(path,init);
    // A denial carries no data, so it is never stale: show it even if a concurrent denial already cleared the cache.
    if([401,403].includes(response.status)){clear();return response;}
    if(version!==generation)return Response.json({error:'数据已更新，请重试'},{status:409});
    const scope=response.headers.get('X-Club-Scope');
    if(response.ok&&scope&&version===generation){
      if(entries.size>=40)entries.delete(entries.keys().next().value!);
      entries.set(path,{scope,response:response.clone(),at:now()});
    }
    return response;
  }
  return {read,clear};
}
const client=createDataAccess((input,init)=>fetch(input,init),()=>Date.now(),()=>{
  if(typeof window!=='undefined')window.dispatchEvent(new Event('club-data-updated'));
});
export async function clubFetch(path:string,init?:RequestInit){
  // The page's own club (its URL), so each tab and each cache entry belongs to exactly one club. It is read when the
  // call starts: a later call in the same action (e.g. a second write after an await) would follow a club switch made
  // meanwhile, so an action must send each write directly from the user's click, never queued behind other requests.
  if(typeof window!=='undefined')path=clubApiPath(path,window.location.search);
  if(init?.method&&init.method!=='GET'){
    invalidateClubData();try{return await client.read(path,init);}finally{invalidateClubData();}
  }
  return client.read(path,init);
}
export const clearClubData=client.clear;
/**
 * JSON call for every feature. 401 means the session is missing or expired: private pages go to login.
 * 403 means signed in but not allowed (revoked membership, owner-only action): show the server's message
 * and stay, so unsaved work is kept. Public pages never redirect, so /login cannot loop on itself.
 */
export async function clubApi<T=any>(path:string,init?:RequestInit,fallback="请求失败，请重试"):Promise<T>{ // eslint-disable-line @typescript-eslint/no-explicit-any
  const response=await clubFetch(path,init);
  if(response.status===401&&typeof window!=='undefined'&&isPrivateRoute(window.location.pathname)){window.location.replace('/login');throw Error('请重新登录');}
  if(!response.ok){const data=await response.json().catch(()=>({}));throw Object.assign(Error(data.error??(response.status===403?'此账户没有权限执行这个操作':fallback)),{status:response.status});}
  return await response.json() as T;
}
if(typeof window!=='undefined'){
  // Other tabs must not keep entries from an earlier login or import.
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('club-data'):null;
  channel?.addEventListener('message',()=>{client.clear();window.dispatchEvent(new Event('club-data-updated'));});
  window.addEventListener('club-data-invalidated',()=>{client.clear();channel?.postMessage('clear');});
}
export function invalidateClubData(){client.clear();if(typeof window!=='undefined')window.dispatchEvent(new Event('club-data-invalidated'));}

