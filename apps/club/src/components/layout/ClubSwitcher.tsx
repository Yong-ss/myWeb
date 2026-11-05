"use client";
import Link from "next/link";
import {useState} from "react";
import {CaretUpDownIcon,CheckIcon} from "@phosphor-icons/react";
import {clubHref} from "../../lib/club-context";
import {switchPath,workspaceHome} from "../../lib/navigation";
import {Button} from "../ui/button";
import {Popover,PopoverContent,PopoverTrigger} from "../ui/popover";
// Display only: each entry is a link to the same section in another club. Opening it is checked again by the Worker
// and database like any URL; only this tab changes club, because the club lives in this tab's URL.
const roleNames:Record<string,string>={owner:"公会长",admin:"管理员"};
type Club={id:string;name:string;roles:string[]};
const row="flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm no-underline";
export function ClubSwitcher({club,clubName,clubs,pathname}:{club:string;clubName:string;clubs:Club[];pathname:string}){
 const [open,setOpen]=useState(false);
 // A Super Admin may be in a club without a role there: it is still listed first, as the current one.
 const list=clubs.some(c=>c.id===club)?clubs:[{id:club,name:clubName,roles:[]},...clubs];
 const target=switchPath(pathname);
 return <Popover open={open} onOpenChange={setOpen}>
  <PopoverTrigger asChild><Button variant="secondary" size="compact" className="club-switcher shrink-0 text-gold" aria-label={`切换俱乐部，当前：${clubName}`}><CaretUpDownIcon aria-hidden="true"/>切换俱乐部</Button></PopoverTrigger>
  <PopoverContent align="end" className="grid w-[min(20rem,calc(100vw-2rem))] gap-1 p-2">
   <p className="eyebrow m-0 px-3 pt-2 pb-1">切换俱乐部</p>
   <nav aria-label="选择俱乐部"><ul className="m-0 grid max-h-[min(22rem,60dvh)] list-none gap-1 overflow-y-auto p-0">{list.map(c=>{
    const current=c.id===club,role=c.roles.map(r=>roleNames[r]).filter(Boolean).join("、");
    const body=<><span aria-hidden="true" className="grid w-4 shrink-0 place-items-center text-gold">{current&&<CheckIcon/>}</span>
     <span className="grid min-w-0 flex-1 gap-0.5"><span className="truncate">{c.name}</span>{(role||current)&&<small className="text-xs text-muted-foreground">{[current&&"当前",role].filter(Boolean).join(" · ")}</small>}</span></>;
    return <li key={c.id}>{current
     ?<span aria-current="true" className={`${row} border-l-2 border-gold bg-selected text-gold`}>{body}</span>
     :<Link href={clubHref(target,c.id)} onClick={()=>setOpen(false)} className={`${row} border-l-2 border-transparent text-foreground transition-[background-color,color] ease-club-feedback hover:bg-hover hover:text-gold active:bg-pressed focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none`}>{body}</Link>}</li>;})}
   </ul></nav>
   <Link href={workspaceHome.hub} onClick={()=>setOpen(false)} className={`${row} mt-1 border-t border-divider text-muted-foreground transition-colors ease-club-feedback hover:text-gold focus-visible:outline-2 focus-visible:outline-ring`}>查看全部俱乐部 →</Link>
  </PopoverContent>
 </Popover>;
}
