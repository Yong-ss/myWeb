"use client";
import {clubApi} from "./data-access";
import {clubOf} from "./club-context";
import {useEffect,useSyncExternalStore} from "react";
// One name per club: a tab switching from A to B never shows A's name (or a late A answer) for B.
const fallback="俱乐部名称";
const names=new Map<string,string>();
const listeners=new Set<()=>void>();
function subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);}
function update(club:string,value:string){names.set(club,value);listeners.forEach(listener=>listener());}
const pageClub=()=>String(clubOf(window.location.search)||"");
const pending=new Map<string,Promise<{name:string;can_edit:boolean}>>();
/** Reads the name of the club in this page's URL. */
export function loadClubSettings(){
 const club=pageClub();let task=pending.get(club);
 if(!task){task=clubApi<{name:string;can_edit:boolean}>("/api/club-settings",undefined,"无法读取俱乐部名称").then(data=>{if(typeof data.name!=="string")throw Error("无法读取俱乐部名称");update(club,data.name);return data;}).finally(()=>{pending.delete(club);});pending.set(club,task);}
 return task;
}
export async function saveClubName(value:string,expected:string){const club=pageClub();const data=await clubApi<{name:string}>("/api/club-settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:value,expected_name:expected})},"保存失败");update(club,data.name);return data.name;}
// enabled=false: the platform workspace shows no club, and a Super Admin may have no membership to read one.
export function useClubBrand(club:string|null,enabled=true){const value=useSyncExternalStore(subscribe,()=>names.get(club??"")??fallback,()=>fallback);useEffect(()=>{if(enabled)void loadClubSettings().catch(()=>{});},[enabled,club]);return value;}
