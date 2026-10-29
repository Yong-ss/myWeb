"use client";
import {useEffect} from 'react';
/** Revalidate visible consumers on focus, successful background reads and other-tab changes. */
export function useDataRefresh(refresh:()=>void){
 useEffect(()=>{
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  window.addEventListener('focus',visible);window.addEventListener('club-data-updated',visible);
  window.addEventListener('club-data-invalidated',visible);
  return()=>{window.removeEventListener('focus',visible);window.removeEventListener('club-data-updated',visible);window.removeEventListener('club-data-invalidated',visible);};
 },[refresh]);
}
