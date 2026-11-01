"use client";
import {PageHeader} from "../../components/layout/PageHeader";
import {MfaCard} from "./MfaCard";
// Account security belongs to the person, not to a club, so it lives in the platform workspace and needs no membership.
export function SecurityPage(){
 return <main className="club-workspace club-security"><PageHeader eyebrow="PLATFORM / 账户安全" title="账户安全"/><MfaCard/></main>;
}
