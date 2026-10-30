"use client";
import {Suspense,useEffect} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import {PageHeader} from "../../components/layout/PageHeader";
import {LoadingState} from "../../components/feedback";
import {Overview} from "./Overview";
function Workspace(){
 const params=useSearchParams(),router=useRouter();
 const legacy=params.get('view')==='growth',query=params.toString();
 useEffect(()=>{if(legacy){const next=new URLSearchParams(query);next.delete('view');router.replace('/account?'+next.toString());}},[legacy,query,router]);
 return <main className="club-workspace club-account"><PageHeader eyebrow="ANALYTICS / 数据分析" title="数据分析"/>{legacy?<p>评分趋势已移至俱乐部总览…</p>:<Overview view="pathways"/>}</main>;
}
export function AnalyticsPage(){return <Suspense fallback={<LoadingState status="loading" label="正在读取数据分析…"/>}><Workspace/></Suspense>;}
