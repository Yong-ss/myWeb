"use client";
import {usePathname} from "next/navigation";
import type {ReactNode} from "react";
import {AppShell} from "./AppShell";
/** Root-layout lifetime: page transitions replace content, not account controls. */
export function ClubFrame({children}:{children:ReactNode}){
 const pathname=usePathname();
 const privatePage=['/account','/members','/players','/import','/settings'].includes(pathname);
 return <AppShell publicPage={!privatePage}>{children}</AppShell>;
}
