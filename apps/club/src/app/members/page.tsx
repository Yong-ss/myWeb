"use client";
import {useDataRefresh} from "../../components/useDataRefresh";
import {clubFetch} from "../../lib/data-access";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {presenceLabels, type Presence} from "../../lib/presence";
import { AppShell } from "../../components/layout/AppShell";
import { PageHeader } from "../../components/layout/PageHeader";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Input, Select } from "../../components/ui/Fields";
import { Panel } from "../../components/ui/Panel";
import { Suspense, useEffect, useState } from "react";
import type { Member } from "../../lib/import";

type Snapshot = { id: string; snapshot_date: string; revision: number; is_complete_roster: boolean; is_current: boolean };
type Row = Omit<Member, "group"> & { player_id: string; group_name: string | null; presence?: Presence; data_date?:string };
type Result = { snapshots: Snapshot[]; snapshot: Snapshot | null; members: Row[]; next: string | null; snapshot_count?:number };
const columns = [["name", "昵称"], ["level", "等级"], ["pathway", "途径"], ["extraordinary_score", "非凡评分"], ["prosperity", "繁荣度"], ["weekly_activity", "周活跃"], ["position", "职位"], ["group_name", "分组"], ["join_days", "入会天数"]] as const;
export default function MembersPage() { return <Suspense fallback={<p role="status">正在读取名单…</p>}><MemberList /></Suspense>; }
function MemberList() {
  const params=useSearchParams();
  const [dates, setDates] = useState<Snapshot[]>([]), [date, setDate] = useState(params.get("date")??""), [version, setVersion] = useState("");
  const [loadedSelection,setLoadedSelection]=useState<string|null>(null);
  const [result, setResult] = useState<Result | null>(null), [next, setNext] = useState<string | null>(null);
  const [search, setSearch] = useState(""), [sort, setSort] = useState("name"), [descending, setDescending] = useState(false);
  const [busy, setBusy] = useState(true), [moreBusy, setMoreBusy] = useState(false), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  async function read(query: string, signal?: AbortSignal): Promise<Result> {
    const response = await clubFetch(`/api/members${query}`, { cache: "no-store", signal });
    if ([401, 403].includes(response.status)) { window.location.replace("/login"); throw Error("请重新登录"); }
    const data = await response.json();
    if (!response.ok) throw Error(data.error ?? "读取失败，请重试");
    return data;
  }
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
  const key = sort as typeof columns[number][0];
  const visible = (result?.members ?? []).filter(r => (r.name ?? "").toString().toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => {
    const rank={present:0,unconfirmed:1,left:2};const statusOrder=rank[a.presence??"present"]-rank[b.presence??"present"];if(statusOrder)return statusOrder;
    const av = a[key], bv = b[key];
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    const comparison = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "zh-CN", { numeric: true });
    return descending ? -comparison : comparison;
  });
  return <AppShell><main className="club-workspace"><PageHeader eyebrow="THE ARCHIVES / 每日记录" title="成员名单" actions={<ButtonLink href="/import">导入数据</ButtonLink>} />
    <div className="members-toolbar"><label>查看日期<Select value={date} onChange={e => { setDate(e.target.value); setVersion(""); }}><option value="">最新一天</option>{dates.map(s => <option key={s.id} value={s.snapshot_date}>{s.snapshot_date}</option>)}</Select></label>{next && <Button disabled={moreBusy} onClick={moreDates}>{moreBusy ? "读取中…" : "更早日期"}</Button>}
      {date && result && !busy && !error && <label>保存版本<Select value={version} onChange={e => setVersion(e.target.value)}><option value="">当天最新版本</option>{result.snapshots.filter(s => !s.is_current).map(s => <option key={s.id} value={s.id}>第 {s.revision} 版（旧版）</option>)}</Select></label>}
    </div>
    {error && <div role="alert" className="feedback error">{error} <Button onClick={() => setRetry(n => n + 1)}>重试</Button></div>}
    {busy && loadedSelection!==date+"|"+version ? <p role="status" className="club-loading" aria-busy="true">正在读取名单…</p> : !error && (result?.snapshot ? <>
      <div className="members-summary"><strong>{result.snapshot.snapshot_date} · {result.snapshot_count??result.members.length} 人</strong><span className="badge">{result.snapshot.is_complete_roster ? "已确认完整" : "未确认完整"}</span>{!result.snapshot.is_current && <span className="badge">旧版本 · 第 {result.snapshot.revision} 版</span>}</div>
      <p className="muted">点昵称查看个人历史；未在本次识别的玩家显示最近记录，不当作当天数据。</p>
      <div className="members-toolbar"><label>搜索玩家<Input type="search" placeholder="输入昵称" value={search} onChange={e => setSearch(e.target.value)} /></label><label>排序<Select value={sort} onChange={e => setSort(e.target.value)}>{columns.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</Select></label><Button onClick={() => setDescending(v => !v)}>{descending ? "降序 ↓" : "升序 ↑"}</Button></div>
      {visible.length ? <div className="members-table-wrap"><table className="members-table club-roster"><caption className="muted">{search ? `找到 ${visible.length} 人` : "当天保存的数据 · — 表示未识别"}</caption><thead><tr><th scope="col">状态</th>{columns.map(([value, title]) => <th key={value} scope="col">{title}</th>)}<th scope="col">数据日期</th></tr></thead><tbody>{visible.map(row => <tr key={row.player_id} className={row.presence==="left"?"club-player-left":undefined}><td>{presenceLabels[row.presence??"present"]}</td>{columns.map(([value]) => <td key={value}>{value==="name"?<Link href={`/players?id=${row.player_id}&date=${result.snapshot!.snapshot_date}`}>{row[value]??"未识别昵称"}</Link>:row[value]??"—"}</td>)}<td>{row.data_date??result.snapshot!.snapshot_date}</td></tr>)}</tbody></table></div> : <Panel>没有找到这个名字，换个关键词试试。</Panel>}
    </> : <Panel><h2>还没有保存记录</h2><p>导入第一份数据后，就能在这里查看。</p><ButtonLink href="/import">导入数据</ButtonLink></Panel>)}
  </main></AppShell>;
}
