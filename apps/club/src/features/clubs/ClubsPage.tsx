"use client";
import {useEffect,useState} from "react";
import {clubApi} from "../../lib/data-access";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {PageHeader} from "../../components/layout/PageHeader";
import {LoadingState} from "../../components/feedback";
import {Card,CardDescription,CardTitle} from "../../components/ui/card";
import {Badge} from "../../components/ui/badge";
import {ButtonLink} from "../../components/ui/button";
// Display only. This deployment serves one club (club_id); others are listed honestly until per-request club context
// exists. Entering a club never relies on this list: every club request is authorized again by the Worker and database.
type Club={id:string;name:string;roles:string[]};
type Account={club_id?:string;permissions?:string[];clubs?:Club[]};
const roleNames:Record<string,string>={owner:"公会长",admin:"管理员"};
export function ClubsPage(){
 const [account,setAccount]=useState<Account|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 useDataRefresh(()=>setRetry(n=>n+1));
 useEffect(()=>{let active=true;clubApi<Account>("/api/account",undefined,"暂时无法读取账户").then(a=>{if(active)setAccount(a);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[retry]);
 const clubs=account?.clubs??[];
 return <main className="club-workspace club-clubs flex flex-col gap-6"><PageHeader eyebrow="ACCOUNT / 我的俱乐部" title="我的俱乐部"/>
  {error?<LoadingState status="error" detail={error} onRetry={()=>{setError("");setRetry(n=>n+1);}}/>:!account?<LoadingState status="loading" label="正在读取你的俱乐部…"/>:!clubs.length?
   <LoadingState status="empty" title="还没有俱乐部角色" detail="请联系俱乐部负责人为你分配角色。"/>:
   <div className="grid gap-4 md:grid-cols-2">{clubs.map(c=>{const here=c.id===account.club_id&&(account.permissions?.length??0)>0;
    return <Card key={c.id} className="items-stretch gap-3">
     <CardTitle>{c.name}</CardTitle>
     <span className="flex flex-wrap gap-2">{c.roles.map(r=><Badge key={r} variant="outline">{roleNames[r]??r}</Badge>)}</span>
     {here?<ButtonLink className="self-start" href="/account" aria-label={`进入${c.name}`}>进入俱乐部</ButtonLink>:
      <CardDescription><Badge variant="outline">暂未开放</Badge> 多俱乐部切换将在后续版本提供，届时可从这里进入。</CardDescription>}
    </Card>;})}</div>}
 </main>;
}
