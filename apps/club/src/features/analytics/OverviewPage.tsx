"use client";
import Link from "next/link";
import {PageHeader} from "../../components/layout/PageHeader";
import {Overview} from "./Overview";
export function OverviewPage(){
 return <main className="club-workspace club-account"><PageHeader eyebrow="OVERVIEW" title="俱乐部总览"/><Overview/><Link className="club-return mt-6 inline-block py-3 text-sm text-muted-foreground hover:text-gold" href="/">← 返回首页</Link></main>;
}
