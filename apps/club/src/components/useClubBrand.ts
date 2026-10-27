"use client";
import {clubFetch} from "../lib/data-access";
import {useEffect,useSyncExternalStore} from "react";
let name="俱乐部名称";
const listeners=new Set<()=>void>();
function subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);}
function update(value:string){name=value;listeners.forEach(listener=>listener());}
let pending:Promise<{name:string;can_edit:boolean}>|null=null;
export function loadClubSettings(){
 if(!pending)pending=clubFetch("/api/club-settings",{cache:"no-store"}).then(async response=>{const data=await response.json();if(!response.ok||typeof data.name!=="string")throw Error(data.error??"无法读取俱乐部名称");update(data.name);return data as {name:string;can_edit:boolean};}).finally(()=>{pending=null;});
 return pending;
}
export async function saveClubName(value:string,expected:string){const response=await clubFetch("/api/club-settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:value,expected_name:expected})});const data=await response.json();if(!response.ok)throw Error(data.error??"保存失败");update(data.name);return data.name as string;}
export function useClubBrand(){const value=useSyncExternalStore(subscribe,()=>name,()=>"俱乐部名称");useEffect(()=>{void loadClubSettings().catch(()=>{});},[]);return value;}
