"use client";
import {Suspense} from "react";
import {useRouter,useSearchParams} from "next/navigation";
import {PageHeader} from "../../components/layout/PageHeader";
import {LoadingState} from "../../components/feedback";
import {Tabs,TabsList,TabsTrigger,TabsContent} from "../../components/ui/tabs";
import {Overview} from "./Overview";
function Workspace(){
 const params=useSearchParams(),router=useRouter();
 const view=params.get('view')==='pathways'?'pathways':'growth';
 return <main className="club-workspace club-account"><PageHeader eyebrow="ANALYTICS / 数据分析" title="数据分析"/>
  <Tabs value={view} onValueChange={value=>router.push(`/analytics?view=${value}`,{scroll:false})}>
   <TabsList aria-label="分析视图"><TabsTrigger value="growth">实力成长</TabsTrigger><TabsTrigger value="pathways">途径分布</TabsTrigger></TabsList>
   <TabsContent value={view} className="mt-6"><Overview view={view}/></TabsContent>
  </Tabs>
 </main>;
}
export function AnalyticsPage(){return <Suspense fallback={<LoadingState status="loading" label="正在读取数据分析…"/>}><Workspace/></Suspense>;}
