"use client";
import {useDataRefresh} from "../../lib/useDataRefresh";
import {clubApi} from "../../lib/data-access";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {presenceLabels, type Presence} from "../../domain/presence";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Fields";
import { LoadingState, TableSkeleton } from "../../components/feedback";
import { Suspense, useEffect, useState } from "react";
import type { Member } from "../../domain/member";

import {compareMemberValues} from "./member-sort";
import {DeleteImport} from "./DeleteImport";
type Snapshot = { id: string; snapshot_date: string; revision: number; is_complete_roster: boolean; is_current: boolean };
type Row = Omit<Member, "group"> & { player_id: string; group_name: string | null; presence?: Presence; data_date?:string };
type Result = { snapshots: Snapshot[]; snapshot: Snapshot | null; members: Row[]; next: string | null; snapshot_count?:number };
const columns = [["name", "昵称"], ["level", "等级"], ["pathway", "途径"], ["extraordinary_score", "非凡评分"], ["prosperity", "风尚度"], ["weekly_activity", "周活跃"], ["position", "职位"], ["group_name", "分组"], ["join_days", "入会天数"]] as const;
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
  function sortHeading(field:string,title:string) {
    return <th key={field} scope="col" aria-sort={sort===field?(descending?"descending":"ascending"):"none"}><button type="button" className="club-table-sort" onClick={()=>order(field)}>{title}<svg className="club-table-sort-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><g className="club-sort-neutral"><path d="m3 7 4-4 4 4M7 3v18m14-4-4 4-4-4M17 21V3"/></g><g className="club-sort-direction"><path d="M12 19V5m-7 7 7-7 7 7"/></g></svg></button></th>;
  }
  return <><main className="club-workspace club-members"><PageHeader eyebrow="THE ARCHIVES / 每日记录" title="成员名单" actions={<ButtonLink href="/import">导入数据</ButtonLink>} />
    <div className="members-toolbar"><label>查看日期<Select value={date} onChange={e => { setDate(e.target.value); setVersion(""); }}><option value="">最新一天</option>{dates.map(s => <option key={s.id} value={s.snapshot_date}>{s.snapshot_date}</option>)}</Select></label><Button disabled={!next} loading={moreBusy} loadingText="读取中…" onClick={moreDates}>更早日期</Button>
      <label>保存版本<Select disabled={!date||waiting} value={version} onChange={e => setVersion(e.target.value)}><option value="">当天最新版本</option>{(result?.snapshots??[]).filter(s => !s.is_current).map(s => <option key={s.id} value={s.id}>第 {s.revision} 版（旧版）</option>)}</Select></label>
    </div>
      <div className="members-summary"><strong>{waiting?"—":result?.snapshot?.snapshot_date??"—"} · {waiting?"—":result?.snapshot_count??result?.members.length??"—"} 人</strong><span className="badge">{waiting?"正在读取…":!result?.snapshot?"暂无记录":result.snapshot.is_complete_roster ? "已确认完整" : "未确认完整"}</span>{result?.snapshot&&!waiting&&!result.snapshot.is_current && <span className="badge">旧版本 · 第 {result.snapshot.revision} 版</span>}{result?.snapshot?.is_current&&!waiting&&!error&&<DeleteImport date={result.snapshot.snapshot_date} snapshotId={result.snapshot.id} onDeleted={()=>{setResult(null);setDates([]);setDate("");setVersion("");setLoadedSelection(null);setRetry(n=>n+1);}}/>}</div>
      <p className="muted">点昵称查看个人历史；未在本次识别的玩家显示最近记录，不当作当天数据。</p>
      <div className="members-toolbar"><label>搜索玩家<Input disabled={waiting||!result?.snapshot} type="search" placeholder="输入昵称" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
    {error && <LoadingState status="error" detail={error} onRetry={() => setRetry(n => n + 1)} />}
    {waiting ? <TableSkeleton columns={11} label="正在读取名单…" /> : !error && (result?.snapshot ? <>
      {<div className="members-table-wrap club-data-enter"><table className="members-table club-roster"><caption className="muted">{search||pathway||group ? `找到 ${visible.length} 人` : "当天保存的数据 · — 表示未识别"}</caption><thead><tr>{sortHeading("presence","状态")}{columns.map(([value,title])=>value==="pathway"||value==="group_name"?<th key={value} scope="col"><Select className="club-table-filter" aria-label={title} value={value==="pathway"?pathway:group} onChange={e=>(value==="pathway"?setPathway:setGroup)(e.target.value)}><option value="">{title} · 全部</option>{options(value).map(option=><option key={option} value={option}>{option}</option>)}</Select></th>:sortHeading(value,title))}{sortHeading("data_date","数据日期")}</tr></thead><tbody>{visible.map(row => <tr key={row.player_id} className={row.presence==="left"?"club-player-left":undefined}><td>{presenceLabels[row.presence??"present"]}</td>{columns.map(([value]) => <td key={value}>{value==="name"?<Link href={`/players?id=${row.player_id}&date=${result.snapshot!.snapshot_date}`}>{row[value]??"未识别昵称"}</Link>:row[value]??"—"}</td>)}<td>{row.data_date??result.snapshot!.snapshot_date}</td></tr>)}{!visible.length&&<tr><td colSpan={11}>没有符合条件的玩家，请调整搜索或筛选。</td></tr>}</tbody></table></div>}
    </> : <LoadingState status="empty" title="还没有保存记录" detail="导入第一份数据后，就能在这里查看。" action={<ButtonLink href="/import">导入数据</ButtonLink>} />)}
  </main></>;
}
