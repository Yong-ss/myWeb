"use client";
import {createContext,useCallback,useContext} from "react";
import {clubHref} from "./club-context";
/** The club of the page being shown (AppShell provides it from the URL once the account may enter it). */
export const ClubContext=createContext<string|null>(null);
export function useClub(){return useContext(ClubContext);}
/** This account's permissions in the shown club (display only: hides actions the Worker and database would refuse,
 * e.g. for a read-only alliance leader). */
export const ClubPermissionsContext=createContext<readonly string[]>([]);
export function useClubCan(){const permissions=useContext(ClubPermissionsContext);return useCallback((permission:string)=>permissions.includes(permission),[permissions]);}
/** Links inside a club page stay in that club; build them with this instead of adding ?club= by hand. */
export function useClubHref(){const club=useClub();return useCallback((href:string)=>club?clubHref(href,club):href,[club]);}
