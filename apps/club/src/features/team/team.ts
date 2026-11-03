// Pure display logic for the owner's team page. Display only: the Worker and database decide every change.
import {allowedWith,type Explained} from '../../domain/permission-layers.ts';

/** A kept personal setting reported by club_admin_candidate, with the final result it would have as admin. */
export type Kept={key:string;description:string;sensitive:boolean;forced:boolean|null;owner_set:boolean|null;default_allowed:boolean;allowed:boolean};
/** A club permission as the admin role sees it in this club (club_team_permissions). */
export type RolePerm={key:string;description:string;sensitive:boolean;non_delegable:boolean;cap_blocked:boolean;platform_default:boolean;club_default:boolean|null};

const word=(v:boolean)=>v?'单独允许':'单独禁止';
/** Re-appointment warning lines: which kept settings take effect again and with what result. Settings that would
 * open a sensitive permission beyond the defaults come first, because those are the ones an owner may not expect. */
export function keptWarnings(kept:Kept[]){
 return kept.map(k=>{
  const opens=k.allowed&&!k.default_allowed;
  const source=k.forced!==null?`超级管理员${word(k.forced)}`:`公会长${word(k.owner_set!)}`;
  return {key:k.key,sensitive:k.sensitive,opens,text:`${k.description}：${source}，任命后${k.allowed?'允许':'不允许'}${k.allowed!==k.default_allowed?`（默认为${k.default_allowed?'允许':'不允许'}）`:''}`};
 }).sort((a,b)=>Number(b.opens&&b.sensitive)-Number(a.opens&&a.sensitive)||Number(b.opens)-Number(a.opens));
}

/** Does changing this club's admin default to `next` (null = follow the platform) open the permission for admins
 * who follow the defaults? Compares the final default before and after; caps and non-delegable powers never open. */
export function defaultWidens(p:RolePerm,next:boolean|null){
 if(p.cap_blocked||p.non_delegable)return false;
 return !(p.club_default??p.platform_default)&&(next??p.platform_default);
}

/** Does setting the owner-level personal value to `next` change this admin's final result from denied to allowed? */
export const personalWidens=(p:Explained,confirmed:boolean,next:boolean|null)=>!p.allowed&&allowedWith(p,'admin',confirmed,{owner_set:next});
