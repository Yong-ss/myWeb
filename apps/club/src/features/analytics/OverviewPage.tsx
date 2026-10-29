"use client";
import Link from "next/link";
import {PageHeader} from "../../components/layout/PageHeader";
import {Overview} from "./Overview";
export function OverviewPage(){
 return <><main className="club-workspace club-account"><PageHeader eyebrow="OVERVIEW" title="俱乐部总览"/><Overview/><Link className="club-return" href="/">← 返回首页</Link></main></>;
}
