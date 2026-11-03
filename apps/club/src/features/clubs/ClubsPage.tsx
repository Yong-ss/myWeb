"use client";
import {useEffect,useState} from "react";
import {clubApi} from "../../lib/data-access";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {PageHeader} from "../../components/layout/PageHeader";
import {LoadingState} from "../../components/feedback";
import {Card,CardTitle} from "../../components/ui/card";
import {Badge} from "../../components/ui/badge";
import {ButtonLink} from "../../components/ui/button";
import {clubHref} from "../../lib/club-context";
// Display only. Entering a club opens it in this tab's URL; every club request is authorized again by the Worker and
// database, so this list is never what grants access.
type Club={id:string;name:string;roles:string[]};
type Account={clubs?:Club[]};
const roleNames:Record<string,string>={owner:"公会长",admin:"管理员"};
export function ClubsPage(){
 const [account,setAccount]=useState<Account|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 useDataRefresh(()=>setRetry(n=>n+1));
 useEffect(()=>{let active=true;clubApi<Account>("/api/account",undefined,"暂时无法读取账户").then(a=>{if(active)setAccount(a);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 const clubs=account?.clubs??[];
 return <main className="club-workspace club-clubs flex flex-col gap-6"><PageHeader eyebrow="ACCOUNT / 我的俱乐部" title="我的俱乐部"/>
  {error?<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/>:!account?<LoadingState status="loading" label="正在读取你的俱乐部…"/>:!clubs.length?
   <LoadingState status="empty" title="还没有俱乐部角色" detail="请联系俱乐部负责人为你分配角色。"/>:
   <div className="grid gap-4 md:grid-cols-2">{clubs.map(c=>
    <Card key={c.id} className="items-stretch gap-3">
     <CardTitle>{c.name}</CardTitle>
     <span className="flex flex-wrap gap-2">{c.roles.map(r=><Badge key={r} variant="outline">{roleNames[r]??r}</Badge>)}</span>
     <ButtonLink className="self-start" href={clubHref("/account",c.id)} aria-label={`进入${c.name}`}>进入俱乐部</ButtonLink>
    </Card>)}</div>}
 </main>;
}
