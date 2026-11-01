"use client";
import {useSyncExternalStore} from "react";
const never=()=>()=>{};
/** False in the static HTML and until React takes over. Credential forms stay disabled until then, because a click
 * before hydration would fall back to a native GET submit and put the email and password in the URL. */
export function useHydrated(){return useSyncExternalStore(never,()=>true,()=>false);}
