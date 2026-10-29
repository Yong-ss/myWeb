"use client";
import {useState} from "react";
import Link from "next/link";
import {motion} from "motion/react";
import {Card,CardTitle,CardDescription} from "../../components/ui/card";
import {PathwayIcon} from "../../components/PathwayLabel";
import {enter,useMotion} from "../../components/ui/motion";
import {getPathway} from "../../lib/pathways";
import {pathwayDistribution,pathwayMembersHref,type PathwayRow} from "./pathway-distribution";

export function PathwayDonut({members,loading=false}:{members:readonly PathwayRow[];loading?:boolean}) {
  const {total,groups}=pathwayDistribution(members);
  const [hovered,setHovered]=useState<string|null>(null),[focused,setFocused]=useState<string|null>(null);
  const key=(name:string|null)=>JSON.stringify(name);
  const candidate=hovered??focused;
  const active=groups.some(g=>key(g.name)===candidate)?candidate:null;
  const selected=groups.find(g=>key(g.name)===active);
  const transition=useMotion(enter);
  let offset=0;
  return <Card className="items-stretch" aria-label="途径分布" aria-busy={loading}>
    <CardTitle>途径分布</CardTitle>
    <CardDescription>只统计最新记录中明确在会的成员。</CardDescription>
    {!loading&&groups[0]?.name&&groups[0].count>(groups[1]?.count??0)&&<p className="m-0 text-sm">人数最多的途径是 <span style={{color:getPathway(groups[0].name)?.accent}}>{groups[0].name}</span>，共 {groups[0].count} 人，占 {groups[0].percent.toFixed(0)}%。</p>}
    <div className="grid min-h-72 grid-cols-[minmax(240px,1fr)_minmax(0,1fr)] items-center gap-6 max-md:grid-cols-1">
      <div className="relative mx-auto aspect-square w-full max-w-72" onMouseLeave={()=>setHovered(null)}>
        <svg viewBox="0 0 240 240" className="block size-full overflow-visible" role="group" aria-label={`途径分布图，共 ${total} 位在会成员`}>
          <circle cx="120" cy="120" r="88" fill="none" stroke="var(--club-divider)" strokeWidth="28" />
          {!loading&&groups.map(group=>{
            const length=group.count/total*100,start=offset;offset+=length;
            const id=key(group.name),emphasized=active===id,label=group.name??'未识别途径';
            return <a key={id} href={pathwayMembersHref(group.name)} aria-label={`${label}，${group.count} 人，${group.percent.toFixed(1)}%，查看在会成员`}
              onMouseEnter={()=>setHovered(id)} onFocus={()=>setFocused(id)} onBlur={()=>setFocused(null)} className="club-pathway-segment">
              <motion.circle cx="120" cy="120" r="88" pathLength="100" fill="none" stroke={getPathway(group.name)?.accent??'var(--club-text-secondary)'}
                strokeDasharray={`${length} ${100-length}`} strokeDashoffset={-start} transform="rotate(-90 120 120)"
                initial={false} animate={{opacity:active&&!emphasized?0.35:1,strokeWidth:emphasized?34:28}} transition={transition} />
            </a>;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-16 text-center" aria-hidden="true">
          <motion.div key={selected?key(selected.name):'total'} initial={{opacity:0}} animate={{opacity:1}} transition={transition} className="min-w-0">
            <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{loading?'正在读取…':selected?selected.name??'未识别途径':'在会成员'}</span>
            <strong className="my-2 block font-heading text-3xl font-medium text-gold tabular-nums">{loading?'—':selected?.count??total}</strong>
            <span className="block text-xs text-muted-foreground">{selected?`${selected.percent.toFixed(1)}%`:'人'}</span>
          </motion.div>
        </div>
      </div>
      {loading?<p className="text-sm text-muted-foreground">正在读取途径分布…</p>:!total?<p className="text-sm text-muted-foreground">暂无明确在会成员，暂不生成途径分布。</p>:
      <ul className="m-0 grid min-w-0 list-none gap-1 p-0" aria-label="途径分布明细">{groups.map(group=>{
        const id=key(group.name),label=group.name??'未识别途径';
        return <li key={id}><Link href={pathwayMembersHref(group.name)} onMouseEnter={()=>setHovered(id)} onMouseLeave={()=>setHovered(null)} onFocus={()=>setFocused(id)} onBlur={()=>setFocused(null)}
          className="grid min-h-11 grid-cols-[20px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-sm border border-transparent px-3 py-2 text-sm text-foreground no-underline transition-colors duration-150 ease-club-feedback hover:bg-hover focus-visible:bg-hover data-[active=true]:border-border data-[active=true]:bg-hover" data-active={active===id}>
          <PathwayIcon pathway={group.name}/><span className="[overflow-wrap:anywhere]">{label}</span><span className="tabular-nums">{group.count} 人</span><span className="min-w-14 text-right text-xs text-muted-foreground tabular-nums">{group.percent.toFixed(1)}%</span>
        </Link></li>;
      })}</ul>}
    </div>
  </Card>;
}
