"use client";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {clubApi} from "../../lib/data-access";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {cn} from "cn";
import {presenceLabels, type Presence} from "../../domain/presence";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button, ButtonLink } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { Badge } from "../../components/ui/badge";
import { Field, FieldLabel } from "../../components/ui/field";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { LoadingState, TableSkeleton } from "../../components/feedback";
import { Suspense, useEffect, useState } from "react";
import type { Member } from "../../domain/member";

import {compareMemberValues} from "./member-sort";
import {DeleteImport} from "./DeleteImport";
type Snapshot = { id: string; snapshot_date: string; revision: number; is_complete_roster: boolean; is_current: boolean };
type Row = Omit<Member, "group"> & { player_id: string; group_name: string | null; presence?: Presence; data_date?:string };
type Result = { snapshots: Snapshot[]; snapshot: Snapshot | null; members: Row[]; next: string | null; snapshot_count?:number };
const columns = [["name", "昵称"], ["level", "等级"], ["pathway", "途径"], ["extraordinary_score", "非凡评分"], ["prosperity", "风尚度"], ["weekly_activity", "周活跃"], ["position", "职位"], ["group_name", "分组"], ["join_days", "入会天数"]] as const;
// Header controls share one quiet look: no fill or border on hover, same 44px height so all labels line up.
const headerControl = "club-table-sort -mx-2 inline-flex h-11 items-center gap-1.5 rounded-sm border-transparent bg-transparent px-2 py-1 font-[inherit] text-xs leading-5 text-gold hover:border-transparent hover:bg-transparent hover:text-ring active:bg-transparent";
export function MembersPage() { return <Suspense fallback={<TableSkeleton columns={11} label="正在读取名单…" />}><MemberList /></Suspense>; }
function MemberList() {
  const params=useSearchParams();
  const [dates, setDates] = useState<Snapshot[]>([]), [date, setDate] = useState(params.get("date")??""), [version, setVersion] = useState("");
  const [loadedSelection,setLoadedSelection]=useState<string|null>(null);
  const [result, setResult] = useState<Result | null>(null), [next, setNext] = useState<string | null>(null);
  const [search, setSearch] = useState(""), [sort, setSort] = useState("name"), [descending, setDescending] = useState(false);
  const [pathway,setPathway]=useState(""), [group,setGroup]=useState("");
  const [busy, setBusy] = useState(true), [moreBusy, setMoreBusy] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const read = (query: string, signal?: AbortSignal) => clubApi<Result>(`/api/members${query}`, { signal }, "读取失败，请重试");
  useDataRefresh(()=>setRetry(n=>n+1));
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setBusy(true); setError("");
      try {
        const data = await read(date ? `?${new URLSearchParams({ date, ...(version ? { version } : {}) })}` : "", controller.signal);
        if (controller.signal.aborted) return;
        setResult(data);setLoadedSelection(date+"|"+version);
        if (!date) { setDates(data.snapshots); setNext(data.next); } else if(data.snapshot) { setDates(old=>old.some(s=>s.snapshot_date===data.snapshot!.snapshot_date)?old:[data.snapshot!,...old]); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "连接失败，请重试"); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load(); return () => controller.abort();
  }, [date, version, retry]);
  async function moreDates() {
    if (!next) return;
    setMoreBusy(true); setError("");
    try { const data = await read(`?before=${next}`); setDates(old => [...old, ...data.snapshots.filter(s => !old.some(o => o.id === s.id))]); setNext(data.next); }
    catch (e) { setError(e instanceof Error ? e.message : "读取失败"); }
    finally { setMoreBusy(false); }
  }
  const waiting=busy && loadedSelection!==date+"|"+version;
  const key = sort as keyof Row;
  const options = (field:"pathway"|"group_name") => [...new Set((result?.members??[]).map(r=>String(r[field]??"—")))].sort((a,b)=>a.localeCompare(b,"zh-CN",{numeric:true}));
  function order(field:string) { if(sort===field)setDescending(v=>!v);else {setSort(field);setDescending(false);} }
  const visible = (result?.members ?? []).filter(r => (r.name ?? "").toString().toLowerCase().includes(search.trim().toLowerCase()) && (!pathway||String(r.pathway??"—")===pathway) && (!group||String(r.group_name??"—")===group)).sort((a,b)=>compareMemberValues(key,a[key]??(key==="presence"?"present":key==="data_date"?result?.snapshot?.snapshot_date??null:null),b[key]??(key==="presence"?"present":key==="data_date"?result?.snapshot?.snapshot_date??null:null),descending)||a.player_id.localeCompare(b.player_id));
  // The sort icon is one persistent SVG: the neutral layer crossfades to the arrow, which rotates for descending.
  function sortHeading(field:string,title:string,className?:string) {
    const state=sort===field?(descending?"descending":"ascending"):"none";
    return <TableHead key={field} aria-sort={state} className={cn("group/sort",className)}><button type="button" className={headerControl} onClick={()=>order(field)}>{title}<svg className="size-3.5 shrink-0 text-[color-mix(in_srgb,var(--club-gold)_35%,var(--club-text-secondary))] transition-colors duration-150 group-hover/sort:text-gold group-aria-[sort=ascending]/sort:text-gold group-aria-[sort=descending]/sort:text-gold" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <g className="club-sort-neutral origin-center opacity-100 transition-opacity duration-200 [transform-box:view-box] group-aria-[sort=ascending]/sort:opacity-0 group-aria-[sort=descending]/sort:opacity-0"><path d="m3 7 4-4 4 4M7 3v18m14-4-4 4-4-4M17 21V3"/></g>
      <g className="club-sort-direction origin-center opacity-0 transition-[opacity,transform] duration-200 ease-club-feedback [transform-box:view-box] group-aria-[sort=ascending]/sort:opacity-100 group-aria-[sort=descending]/sort:[transform:rotate(180deg)] group-aria-[sort=descending]/sort:opacity-100"><path d="M12 19V5m-7 7 7-7 7 7"/></g>
    </svg></button></TableHead>;
  }
  const filterHeading=(field:"pathway"|"group_name",title:string)=><TableHead key={field}><NativeSelect className="club-table-filter -mx-2 h-11 min-h-11 w-auto max-w-50 min-w-27.5 border-transparent bg-transparent px-2 py-1 text-xs leading-5 text-gold hover:border-transparent hover:text-ring focus:border-transparent md:text-xs" aria-label={title} value={field==="pathway"?pathway:group} onChange={e=>(field==="pathway"?setPathway:setGroup)(e.target.value)}><NativeSelectOption value="">{title} · 全部</NativeSelectOption>{options(field).map(option=><NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}</NativeSelect></TableHead>;
  const sticky="sticky left-0 z-1 bg-card";
  return <main className="club-workspace club-members flex max-w-400 flex-col gap-6"><PageHeader eyebrow="THE ARCHIVES / 每日记录" title="成员名单" actions={<ButtonLink href="/import">导入数据</ButtonLink>} />
    <div className="members-toolbar -mt-6 flex flex-wrap items-end gap-4">
      <Field className="min-w-40 max-md:min-w-0 max-md:flex-[1_1_140px]"><FieldLabel htmlFor="members-date">查看日期</FieldLabel><NativeSelect id="members-date" value={date} onChange={e => { setDate(e.target.value); setVersion(""); }}><NativeSelectOption value="">最新一天</NativeSelectOption>{dates.map(s => <NativeSelectOption key={s.id} value={s.snapshot_date}>{s.snapshot_date}</NativeSelectOption>)}</NativeSelect></Field>
      <Button variant="secondary" disabled={!next} loading={moreBusy} loadingText="读取中…" onClick={moreDates}>更早日期</Button>
      <Field className="min-w-40 max-md:min-w-0 max-md:flex-[1_1_140px]"><FieldLabel htmlFor="members-version">保存版本</FieldLabel><NativeSelect id="members-version" disabled={!date||waiting} value={version} onChange={e => setVersion(e.target.value)}><NativeSelectOption value="">当天最新版本</NativeSelectOption>{(result?.snapshots??[]).filter(s => !s.is_current).map(s => <NativeSelectOption key={s.id} value={s.id}>第 {s.revision} 版（旧版）</NativeSelectOption>)}</NativeSelect></Field>
    </div>
    <div className="members-summary ornate flex min-h-16 flex-wrap items-center gap-3 rounded-sm border border-border px-6 py-4 max-md:min-h-25 max-md:p-4">
      <strong className="font-heading text-lg font-medium text-gold tabular-nums">{waiting?"—":result?.snapshot?.snapshot_date??"—"} · {waiting?"—":result?.snapshot_count??result?.members.length??"—"} 人</strong>
      <Badge variant={waiting||!result?.snapshot?"outline":result.snapshot.is_complete_roster?"success":"warning"}>{waiting?"正在读取…":!result?.snapshot?"暂无记录":result.snapshot.is_complete_roster ? "已确认完整" : "未确认完整"}</Badge>
      {result?.snapshot&&!waiting&&!result.snapshot.is_current && <Badge variant="info">旧版本 · 第 {result.snapshot.revision} 版</Badge>}
      {result?.snapshot?.is_current&&!waiting&&!error&&<span className="ml-auto"><DeleteImport date={result.snapshot.snapshot_date} snapshotId={result.snapshot.id} onDeleted={()=>{setResult(null);setDates([]);setDate("");setVersion("");setLoadedSelection(null);setRetry(n=>n+1);}}/></span>}
    </div>
    <p className="m-0 -mt-2 text-sm text-muted-foreground">点昵称查看个人历史；未在本次识别的玩家显示最近记录，不当作当天数据。</p>
    <Field className="max-w-80"><FieldLabel htmlFor="members-search">搜索玩家</FieldLabel><Input id="members-search" disabled={waiting||!result?.snapshot} type="search" placeholder="输入昵称" value={search} onChange={e => setSearch(e.target.value)} /></Field>
    {error && <LoadingState status="error" detail={error} onRetry={() => setRetry(n => n + 1)} />}
    {waiting ? <TableSkeleton columns={11} label="正在读取名单…" /> : !error && (result?.snapshot ?
      <Table containerClassName="members-table-wrap max-h-[min(72dvh,48rem)] animate-[club-fade-in_180ms_var(--club-ease-feedback)] overflow-y-auto overscroll-y-contain" className="[&_td]:px-2.5 [&_th]:px-2.5 [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-2 [&_thead_th]:shadow-[inset_0_-1px_var(--club-divider)]"><TableCaption>{search||pathway||group ? `找到 ${visible.length} 人` : "当天保存的数据 · — 表示未识别"}</TableCaption>
        <TableHeader><TableRow>{sortHeading("presence","状态")}{columns.map(([value,title])=>value==="pathway"||value==="group_name"?filterHeading(value,title):sortHeading(value,title,value==="name"?cn(sticky,"z-3! bg-secondary"):undefined))}{sortHeading("data_date","数据日期")}</TableRow></TableHeader>
        <TableBody>{visible.map(row => { const left=row.presence==="left"; return <TableRow key={row.player_id}>
          <TableCell className={left?"text-destructive":undefined}>{presenceLabels[row.presence??"present"]}</TableCell>
          {columns.map(([value]) => <TableCell key={value} className={value==="name"?cn(sticky,"font-medium"):undefined}>{value==="name"?<Link title={row.name==null?undefined:String(row.name)} className={cn("block max-w-40 truncate text-gold",left&&"text-destructive line-through")} href={`/players?id=${row.player_id}&date=${result.snapshot!.snapshot_date}`}>{row[value]??"未识别昵称"}</Link>:row[value]??"—"}</TableCell>)}
          <TableCell className="text-muted-foreground">{row.data_date??result.snapshot!.snapshot_date}</TableCell></TableRow>; })}
          {!visible.length&&<TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">没有符合条件的玩家，请调整搜索或筛选。</TableCell></TableRow>}</TableBody></Table>
    : <LoadingState status="empty" title="还没有保存记录" detail="导入第一份数据后，就能在这里查看。" action={<ButtonLink href="/import">导入数据</ButtonLink>} />)}
  </main>;
}
