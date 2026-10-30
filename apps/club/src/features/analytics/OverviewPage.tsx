"use client";
import {Suspense} from "react";
import {ClubScoreTrend} from "./ClubScoreTrend";
import Link from "next/link";
import {PageHeader} from "../../components/layout/PageHeader";
import {Overview} from "./Overview";
export function OverviewPage(){
 return <main className="club-workspace club-account grid gap-6"><PageHeader eyebrow="OVERVIEW" title="俱乐部总览"/><Overview/><Suspense fallback={<p>正在读取评分趋势…</p>}><ClubScoreTrend/></Suspense><Link className="club-return mt-6 inline-block py-3 text-sm text-muted-foreground hover:text-gold" href="/">← 返回首页</Link></main>;
}
