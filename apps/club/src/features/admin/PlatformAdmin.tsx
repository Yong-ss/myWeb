"use client";
import {useState} from "react";
import {toast} from "../../components/ui/sonner";
import {clubApi} from "../../lib/data-access";
import {Button} from "../../components/ui/button";
import {FieldError} from "../../components/ui/field";
import {AlertDialog,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogTitle,AlertDialogTrigger} from "../../components/ui/alert-dialog";
// Super Admin only (stage E). Shown only with platform.platform_admins.assign; the Worker and database refuse anyone else.
// Both directions change who can manage club roles platform-wide, so each needs an explicit confirmation.
export function PlatformAdmin({user,onSaved}:{user:{id:string;email:string|null;email_confirmed:boolean;platform_admin?:boolean};onSaved:()=>void}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const granted=user.platform_admin===true,who=user.email??user.id;
 if(!granted&&!user.email_confirmed)return null;
 async function save(){
  setBusy(true);setError("");
  try{
   await clubApi("/api/admin/platform-admin",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user_id:user.id,action:granted?"revoke":"grant"})},"保存失败，请重试");
   setOpen(false);onSaved();toast.success(granted?`已撤销 ${who} 的平台管理员职位`:`已任命 ${who} 为平台管理员`);
  }catch(e){setError(e instanceof Error?e.message:"连接失败，请重试");}finally{setBusy(false);}
 }
 return <AlertDialog open={open} onOpenChange={next=>{if(busy)return;if(next)setError("");setOpen(next);}}>
  <AlertDialogTrigger asChild><Button variant="secondary" size="compact" aria-label={`${granted?"撤销":"任命"} ${who} ${granted?"的平台管理员职位":"为平台管理员"}`}>{granted?"撤销平台管理员":"任命为平台管理员"}</Button></AlertDialogTrigger>
  <AlertDialogContent>
   <AlertDialogTitle>{granted?`撤销 ${who} 的平台管理员职位？`:`任命 ${who} 为平台管理员？`}</AlertDialogTitle>
   <AlertDialogDescription>{granted?"撤销后立即生效：对方不能再查看平台资料或修改任何俱乐部的职位。对方在各俱乐部的职位不受影响。"
    :"平台管理员可以查看全部俱乐部和用户，并在所有俱乐部任命、撤销、转让公会长和管理员（遵守人数上限，不能修改自己的职位）。可以按俱乐部设置公会长和管理员的四方联赛三项权限（不能改自己的），不能修改其他权限设置、管理员人数上限或平台管理员名单。每次登录都需要先完成两步验证。"}</AlertDialogDescription>
   <FieldError>{error}</FieldError>
   <AlertDialogFooter><AlertDialogCancel asChild><Button variant="secondary" disabled={busy}>取消</Button></AlertDialogCancel><Button variant={granted?"destructive":"primary"} loading={busy} loadingText="正在保存…" onClick={save}>{granted?"确认撤销":"确认任命"}</Button></AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
