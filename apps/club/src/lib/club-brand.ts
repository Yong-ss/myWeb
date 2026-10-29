"use client";
import {clubApi} from "./data-access";
import {useEffect,useSyncExternalStore} from "react";
let name="俱乐部名称";
const listeners=new Set<()=>void>();
function subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);}
function update(value:string){name=value;listeners.forEach(listener=>listener());}
let pending:Promise<{name:string;can_edit:boolean}>|null=null;
export function loadClubSettings(){
 if(!pending)pending=clubApi<{name:string;can_edit:boolean}>("/api/club-settings",undefined,"无法读取俱乐部名称").then(data=>{if(typeof data.name!=="string")throw Error("无法读取俱乐部名称");update(data.name);return data;}).finally(()=>{pending=null;});
 return pending;
}
export async function saveClubName(value:string,expected:string){const data=await clubApi<{name:string}>("/api/club-settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:value,expected_name:expected})},"保存失败");update(data.name);return data.name;}
export function useClubBrand(){const value=useSyncExternalStore(subscribe,()=>name,()=>"俱乐部名称");useEffect(()=>{void loadClubSettings().catch(()=>{});},[]);return value;}
