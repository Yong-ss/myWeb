"use client";
import {useState} from 'react';
import {useDataRefresh} from '../../lib/useDataRefresh';
import {PageHeader} from '../../components/layout/PageHeader';
import {AdminList} from './AdminList';
import {AdminPermissions} from './AdminPermissions';

// Stage C: the owner manages this club's admins and their permissions. Each section reads its own route, so an owner
// whose Super Admin removed one of the two powers still sees the other (the server's refusal is shown in place).
export function TeamPage(){
 const [refresh,setRefresh]=useState(0),reload=()=>setRefresh(n=>n+1);
 useDataRefresh(reload);
 return <main className="club-workspace club-team flex flex-col gap-6">
  <PageHeader eyebrow="TEAM / 管理员" title="管理员管理"/>
  <p className="m-0 -mt-4 text-sm text-muted-foreground">任命、撤销本俱乐部的管理员，并调整他们能做什么。所有变更立即生效，并记入操作日志。</p>
  <AdminList refresh={refresh} onChanged={reload}/>
  <AdminPermissions refresh={refresh} onChanged={reload}/>
 </main>;
}
