// Four-Way League V1 contract (docs/CLUB_EVENTS_DISCUSSION.md §6.2): parsing the AI JSON, matching names to players
// and pairing the two tables by player UUID (never by row order). Pure; the Worker and database check everything again.
import { exactName, nameCandidates, type NameAlias, type NamedPlayer } from "../../domain/names.ts";

import { metricFields, metricLabels, outputFields, strategyFields, type Metric, type Metrics } from "../../domain/events.ts";
export { metricFields, metricLabels, outputFields, strategyFields, type Metric, type Metrics };
export const MAX_EVENT_BYTES = 262144;
export type Table = "output" | "strategy";
export const tableNames: Record<Table, string> = { output: "输出", strategy: "战略" };
export type SourceRow = { player_name: string | null; club_name: string | null; values: Partial<Record<Metric, number | null>> };

/** A displayed amount as a non-negative integer: 0, 1,234, 50.1万, 1.2亿. null = unreadable; undefined = invalid text. */
export function parseAmount(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const m = value.trim().replace(/[,，]/g, "").match(/^(\d+(?:\.\d+)?)(万|亿)?$/);
  if (!m) return undefined;
  const n = Math.round(Number(m[1]) * (m[2] === "亿" ? 1e8 : m[2] === "万" ? 1e4 : 1));
  return Number.isSafeInteger(n) ? n : undefined;
}

const keys = { output: ["player_name", "club_name", ...outputFields], strategy: ["player_name", "club_name", ...strategyFields] };
function rows(value: unknown, table: Table): SourceRow[] {
  if (!Array.isArray(value)) throw Error(`${tableNames[table]}（${table}）必须是数组`);
  if (value.length > 300) throw Error(`${tableNames[table]}最多 300 行`);
  return value.map((row, i) => {
    const where = `${tableNames[table]}第 ${i + 1} 行`;
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== keys[table].length || !keys[table].every(k => Object.hasOwn(row, k))) throw Error(`${where}字段不齐或包含额外字段`);
    for (const k of ["player_name", "club_name"]) if (row[k] !== null && (typeof row[k] !== "string" || row[k].length > 200)) throw Error(`${where} ${k} 必须是文字或 null`);
    const values: SourceRow["values"] = {};
    for (const k of table === "output" ? outputFields : strategyFields) {
      const v = parseAmount(row[k]);
      if (v === undefined) throw Error(`${where} ${metricLabels[k]} 必须是非负整数、带「万／亿」的数字或 null`);
      values[k] = v;
    }
    return { player_name: row.player_name === null ? null : row.player_name.trim() || null, club_name: row.club_name, values };
  });
}
/** Identical rows in one table (e.g. the pinned own row repeated at the bottom) are one row; same name with other values is kept for review. */
function dedupe(list: SourceRow[]) {
  const seen = new Set<string>();
  return list.filter(r => { const key = JSON.stringify([r.player_name, r.values]); if (r.player_name && seen.has(key)) return false; seen.add(key); return true; });
}
export function parseEventSource(raw: string) {
  if (new TextEncoder().encode(raw).length > MAX_EVENT_BYTES) throw Error("JSON 最大 256 KiB");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw Error("JSON 语法错误，请去掉代码围栏并检查引号和逗号"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== "event_type,output,schema_version,strategy"
    || (value as Record<string, unknown>).schema_version !== 1 || (value as Record<string, unknown>).event_type !== "four_way_league") throw Error("需要四方联赛 V1 JSON：schema_version 1、event_type \"four_way_league\"、output、strategy");
  const v = value as { output: unknown; strategy: unknown };
  const output = rows(v.output, "output"), strategy = rows(v.strategy, "strategy");
  if (!output.length || !strategy.length) throw Error(`缺少${!output.length ? "「输出」" : "「战略」"}数据：两张表必须一起导入`);
  const out = dedupe(output), str = dedupe(strategy);
  return { output: out, strategy: str, removed: output.length - out.length + strategy.length - str.length };
}

/** A row's identity: a player UUID, `new:<name>` for a player to create, or "" (not decided). */
export type Entry = { table: Table; index: number; row: SourceRow; identity: string; auto: boolean; reasons: string[]; candidates: string[] };
export const newIdentity = (name: string) => `new:${name.trim()}`;
export const isNew = (identity: string) => identity.startsWith("new:");
/** Automatic only for one exact name or confirmed alias, and only once per table. */
export function matchEntries(table: Table, list: SourceRow[], players: NamedPlayer[], aliases: NameAlias[]): Entry[] {
  return list.map((row, index) => {
    const { reliable, similar } = nameCandidates(row.player_name, players, aliases);
    const repeated = !!row.player_name && list.some((r, j) => j !== index && exactName(r.player_name) === exactName(row.player_name));
    const reasons = !row.player_name ? ["昵称没看清"] : reliable.length > 1 ? ["名字或已记住的写法指向多个玩家"] : repeated ? ["同一张表里重复出现，可能是不同玩家或重复截图"] : !reliable.length ? ["没有完全相同的玩家"] : [];
    const identity = reliable.length === 1 && !repeated ? reliable[0] : "";
    return { table, index, row, identity, auto: identity !== "", reasons, candidates: [...reliable, ...similar] };
  });
}

export type Participant = { identity: string; output: Entry; strategy: Entry; values: Partial<Record<Metric, number | null>> };
/** Joins the tables by identity. Every row needs an identity, at most once per table, and in both tables (strict mode). */
export function pairEntries(output: Entry[], strategy: Entry[], name: (identity: string) => string) {
  const problems: string[] = [];
  const label = (e: Entry) => `${tableNames[e.table]}第 ${e.index + 1} 行「${e.row.player_name ?? "昵称没看清"}」`;
  for (const e of [...output, ...strategy]) if (!e.identity) problems.push(`${label(e)}尚未确认身份`);
  const byIdentity = (list: Entry[]) => {
    const map = new Map<string, Entry>();
    for (const e of list) if (e.identity) { if (map.has(e.identity)) problems.push(`${label(e)}与${label(map.get(e.identity)!)}都是「${name(e.identity)}」，同一张表每人只能一行`); else map.set(e.identity, e); }
    return map;
  };
  const out = byIdentity(output), str = byIdentity(strategy);
  for (const [id, e] of out) if (!str.has(id)) problems.push(`「${name(id)}」只出现在输出表（${label(e)}），战略表缺少此人`);
  for (const [id, e] of str) if (!out.has(id)) problems.push(`「${name(id)}」只出现在战略表（${label(e)}），输出表缺少此人`);
  const participants: Participant[] = [...out].filter(([id]) => str.has(id)).map(([identity, o]) => ({ identity, output: o, strategy: str.get(identity)!, values: { ...o.row.values, ...str.get(identity)!.row.values } }));
  return { participants, problems };
}

/** The participant as club_event_create expects it; null when a value is still missing (missing is never 0). */
export function participantRow(p: Participant, remember: boolean) {
  if (metricFields.some(k => typeof p.values[k] !== "number")) return null;
  return { player_id: isNew(p.identity) ? null : p.identity, name: isNew(p.identity) ? p.identity.slice(4) : null,
    output_name: p.output.row.player_name, strategy_name: p.strategy.row.player_name, remember_alias: remember,
    ...Object.fromEntries(metricFields.map(k => [k, p.values[k]])) as Metrics };
}
export const totalKills = (list: { kills: number | null | undefined }[]) => list.reduce((sum, r) => sum + (r.kills ?? 0), 0);

/** The club's business date (V1: Asia/Kuala_Lumpur), the latest date an event may have. */
export function eventToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
