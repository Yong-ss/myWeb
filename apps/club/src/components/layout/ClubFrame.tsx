"use client";
import {usePathname} from "next/navigation";
import type {ReactNode} from "react";
import {AppShell} from "./AppShell";
import {isPrivateRoute} from "../../lib/navigation";
/** Root-layout lifetime: page transitions replace content, not account controls. */
export function ClubFrame({children}:{children:ReactNode}){
 const pathname=usePathname();
 return <AppShell publicPage={!isPrivateRoute(pathname)}>{children}</AppShell>;
}
