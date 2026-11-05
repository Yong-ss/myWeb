// Highland Race V1 import contract (docs/CLUB_HIGHLAND_RACE_DISCUSSION.md §6.1). The AI reads a whole faction (several
// clubs); this page decides which rows are this club's players. Pure; the Worker and database check the result again.
// Only an exact name or a confirmed alias of a player in the latest roster is proposed for inclusion; similar names,
// departed players, duplicates and conflicts wait for a person; rows with no relation to any player are proposed for
// exclusion (never treated as proof of being external, never a new identity).
import { exactName, nameCandidates, similarName, type NameAlias, type NamedPlayer } from "../../domain/names.ts";
import { highlandFields, highlandLabels, highlandOutputFields, highlandStrategyFields, type HighlandMetric, type HighlandMetrics } from "../../domain/highland.ts";
import { parseAmount } from "./contract.ts";

/** The pasted faction-wide JSON stays in the browser; a faction of several clubs fits well inside these bounds. */
export const MAX_HIGHLAND_BYTES = 1048576;
export const MAX_HIGHLAND_ROWS = 1000;
export type Side = "output" | "strategy";
export const sideNames: Record<Side, string> = { output: "输出", strategy: "战略" };
export const sideFields: Record<Side, readonly HighlandMetric[]> = { output: highlandOutputFields, strategy: highlandStrategyFields };
export type HighlandRow = { player_name: string | null; faction_name: string | null; values: Partial<Record<HighlandMetric, number | null>> };
export type RosterPlayer = NamedPlayer & { current: boolean };

const keys = { output: ["player_name", "faction_name", ...highlandOutputFields], strategy: ["player_name", "faction_name", ...highlandStrategyFields] };
function rows(value: unknown, side: Side): HighlandRow[] {
  if (!Array.isArray(value)) throw Error(`${sideNames[side]}（${side}）必须是数组`);
  if (value.length > MAX_HIGHLAND_ROWS) throw Error(`${sideNames[side]}最多 ${MAX_HIGHLAND_ROWS} 行`);
  return value.map((row, i) => {
    const where = `${sideNames[side]}第 ${i + 1} 行`;
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== keys[side].length || !keys[side].every(k => Object.hasOwn(row, k))) throw Error(`${where}字段不齐或包含额外字段`);
    for (const k of ["player_name", "faction_name"]) if (row[k] !== null && (typeof row[k] !== "string" || row[k].length > 200)) throw Error(`${where} ${k} 必须是文字或 null`);
    const values: HighlandRow["values"] = {};
    for (const k of sideFields[side]) {
      const v = parseAmount(row[k]);
      if (v === undefined) throw Error(`${where} ${highlandLabels[k]} 必须是非负整数、带「万／亿」的数字或 null`);
      values[k] = v;
    }
    return { player_name: row.player_name === null ? null : row.player_name.trim() || null, faction_name: row.faction_name === null ? null : row.faction_name.trim() || null, values };
  });
}
/** Identical rows in one table (scroll overlap, the pinned own row) are one row; same name with other values stays for review. */
function dedupe(list: HighlandRow[]) {
  const seen = new Set<string>();
  return list.filter(r => { const key = JSON.stringify([r.player_name, r.faction_name, r.values]); if (r.player_name && seen.has(key)) return false; seen.add(key); return true; });
}
export function parseHighlandSource(raw: string) {
  if (new TextEncoder().encode(raw).length > MAX_HIGHLAND_BYTES) throw Error("JSON 最大 1 MiB");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw Error("JSON 语法错误，请去掉代码围栏并检查引号和逗号"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== "event_type,output,schema_version,strategy"
    || (value as Record<string, unknown>).schema_version !== 1 || (value as Record<string, unknown>).event_type !== "highland_race") throw Error("需要高原竞逐 V1 JSON：schema_version 1、event_type \"highland_race\"、output、strategy");
  const v = value as { output: unknown; strategy: unknown };
  const output = rows(v.output, "output"), strategy = rows(v.strategy, "strategy");
  if (!output.length || !strategy.length) throw Error(`缺少${!output.length ? "「输出」" : "「战略」"}数据：两张表必须一起导入`);
  const out = dedupe(output), str = dedupe(strategy);
  return { output: out, strategy: str, removed: output.length - out.length + strategy.length - str.length };
}

/** include = this club's participant (needs an identity); exclude = not this club; review = a person must decide. */
export type Decision = "include" | "exclude" | "review";
export type Entry = { side: Side; index: number; row: HighlandRow; decision: Decision; identity: string; auto: boolean; reasons: string[]; candidates: string[] };
export const entryKey = (e: { side: Side; index: number }) => `${e.side}:${e.index}`;

/** The proposal for one table. Reliable = exact name or confirmed alias (shared rule, domain/names.ts). */
export function classifyRows(side: Side, list: HighlandRow[], players: RosterPlayer[], aliases: NameAlias[]): Entry[] {
  const byId = new Map(players.map(p => [p.id, p]));
  const counts = new Map<string, number>();
  for (const r of list) if (r.player_name) counts.set(exactName(r.player_name), (counts.get(exactName(r.player_name)) ?? 0) + 1);
  return list.map((row, index) => {
    const base = { side, index, row, identity: "", auto: true };
    if (!row.player_name) return { ...base, decision: "review", reasons: ["昵称没看清"], candidates: [] };
    const { reliable, similar } = nameCandidates(row.player_name, players, aliases);
    const candidates = [...reliable, ...similar];
    if ((counts.get(exactName(row.player_name)) ?? 0) > 1 && candidates.length) return { ...base, decision: "review", reasons: ["同一张表里同名出现多次（数据不同），可能是重复截图或同名不同人"], candidates };
    if (reliable.length > 1) return { ...base, decision: "review", reasons: ["名字或已记住的写法指向本俱乐部多个玩家"], candidates };
    if (reliable.length === 1) {
      return byId.get(reliable[0])?.current
        ? { ...base, decision: "include", identity: reliable[0], reasons: [], candidates }
        : { ...base, decision: "review", reasons: ["同名玩家不在最新成员名单（可能已退会，也可能是其他俱乐部的同名玩家）"], candidates };
    }
    // A faction has many short names: two-character names one character apart are too common to be worth a review,
    // so they only count when nothing but symbols differs (the shared rule still suggests them in the picker).
    const short = Array.from(similarName(row.player_name)).length < 3;
    const names = (id: string) => [byId.get(id)?.display_name, ...aliases.filter(a => a.player_id === id).map(a => a.alias_name)];
    if (similar.some(id => !short || names(id).some(n => similarName(n) === similarName(row.player_name))))
      return { ...base, decision: "review", reasons: ["与本俱乐部玩家名字相似，相似不代表是同一人"], candidates };
    return { ...base, decision: "exclude", reasons: ["没有对应的本俱乐部玩家或已记住的写法"], candidates: similar };
  });
}

export type Choice = { decision: "include"; identity: string } | { decision: "exclude" };
/** The administrator's choices win over the proposal. */
export const applyChoices = (entries: Entry[], choices: Record<string, Choice>): Entry[] =>
  entries.map(e => { const c = choices[entryKey(e)]; return c ? { ...e, auto: false, decision: c.decision, identity: c.decision === "include" ? c.identity : "" } : e; });

export type Participant = { identity: string; output: Entry; strategy: Entry; values: Partial<Record<HighlandMetric, number | null>> };
/** Joins the included rows of both tables by identity (never by rank or row). Excluded rows do not count; every
 * included player needs exactly one row in each table; anything still under review blocks saving. */
export function pairHighland(output: Entry[], strategy: Entry[], name: (identity: string) => string) {
  const problems: string[] = [];
  const label = (e: Entry) => `${sideNames[e.side]}第 ${e.index + 1} 行「${e.row.player_name ?? "昵称没看清"}」`;
  const byIdentity = (list: Entry[]) => {
    const map = new Map<string, Entry>();
    for (const e of list) if (e.decision === "include") {
      if (!e.identity) problems.push(`${label(e)}已纳入但没有选择玩家`);
      else if (map.has(e.identity)) problems.push(`${label(e)}与${label(map.get(e.identity)!)}都纳入为「${name(e.identity)}」，同一张表每人只能一行`);
      else map.set(e.identity, e);
    }
    return map;
  };
  const out = byIdentity(output), str = byIdentity(strategy);
  for (const [id, e] of out) if (!str.has(id)) problems.push(`「${name(id)}」只在输出表纳入（${label(e)}），请在战略表找到并纳入此人`);
  for (const [id, e] of str) if (!out.has(id)) problems.push(`「${name(id)}」只在战略表纳入（${label(e)}），请在输出表找到并纳入此人`);
  const participants: Participant[] = [...out].filter(([id]) => str.has(id))
    .map(([identity, o]) => ({ identity, output: o, strategy: str.get(identity)!, values: { ...o.row.values, ...str.get(identity)!.row.values } }));
  return { participants, problems, review: [...output, ...strategy].filter(e => e.decision === "review").length };
}

/** The participant as club_highland_create expects it; null while a value is missing (missing is never 0). */
export function highlandParticipantRow(p: Participant, remember: boolean) {
  if (highlandFields.some(k => typeof p.values[k] !== "number")) return null;
  return { player_id: p.identity, output_name: p.output.row.player_name, strategy_name: p.strategy.row.player_name, remember_alias: remember,
    ...Object.fromEntries(highlandFields.map(k => [k, p.values[k]])) as HighlandMetrics };
}
/** Counts only, for the log: never a name or number of a row that was not included. */
export const sourceSummary = (output: Entry[], strategy: Entry[]) =>
  ({ output_rows: output.length, strategy_rows: strategy.length, excluded_rows: [...output, ...strategy].filter(e => e.decision === "exclude").length });

// V1 extraction prompt, identical to docs/CLUB_HIGHLAND_RACE_DISCUSSION.md §11 (highland.test.mjs checks it).
export const highlandPrompt = "请从我上传的《诡秘之主》游戏「高原竞逐」数据统计截图中，提取当前已筛选势力的所有可见玩家数据（截图里会混有多个俱乐部的玩家，全部提取），并且只输出严格合法的 JSON，不要解释、Markdown、代码围栏或其他文字。\n\n规则：\n1. 我可能上传多张滚动截图，图片分别属于「输出」或「战略」标签。全部读取；只提取每张截图实际显示的玩家，不猜测缺失行、不创建不存在的玩家。不要判断玩家属于哪个俱乐部，也不要只挑选部分玩家。\n2. 「输出」标签对应字段：玩家名字、所属势力、击败、助攻、消散、唤醒、战功。映射为 output 数组中每个对象的 player_name、faction_name、kills、assists、dispersals、awakens、merit。\n3. 「战略」标签对应字段：玩家名字、所属势力、对玩家伤害、承受伤害、治疗、净化。映射为 strategy 数组中每个对象的 player_name、faction_name、player_damage、damage_taken、healing、purification。高原竞逐没有「对守卫伤害」，不要输出这个字段。\n4. 优先准确识别昵称中的汉字、繁简、英文、数字及有意义的特殊字符；可忽略明确只是装饰的标点（如「、」「丶」「·」）和名字前的头像图标，但不要擅自替换形近字或繁简转换，不要根据另一张表推测昵称。完整昵称认不清时，player_name 填 null。faction_name 保留该行「所属势力」的原文，认不清填 null。\n5. 多张截图可能因滚动而重叠，底部也可能有高亮固定的个人行。只有确定同一标签内是同一玩家、且所有可读字段一致，才删除重复行；不能确认是否重复或数据存在冲突时保留不同原始行，交给网站人工核对，不擅自挑一个覆盖另一个。\n6. 所有数值都必须输出非负整数或 null。去掉千位分隔符；将显示单位「万」换算为整数，例如 1708万 → 17080000、462.7万 → 4627000；如显示「亿」则乘 100000000。换算只表示截图显示的精度，不凭空补出更多真实末位数字。截图明确为 0 时填 0；看不清、被遮挡或无法确认时填 null，绝不猜测或用 0 代替缺失。\n7. 只输出一个 JSON 对象，顶层必须且只能有四个字段：schema_version、event_type、output、strategy。schema_version 固定为数字 1，event_type 固定为字符串 \"highland_race\"。output、strategy 必须是数组。每个 output 元素必须且只能有第 2 条所列的七个字段；每个 strategy 元素必须且只能有第 3 条所列的六个字段。字段一个也不能少，也不得新增。\n8. player_name、faction_name 类型只能是字符串或 null；其他统计字段类型只能是整数或 null。两个标签的行顺序、人数可能不同，必须各自独立提取，不通过排名/行号合并，不为了让两数组人数相同而补玩家、改名或补零。缺少某一标签的截图时，对应数组输出 []，不要虚构。\n9. 不要输出比赛日期、俱乐部、玩家 UUID、总积分、势力名次、参赛总人数等字段；这些由网站决定或由管理员填写。只输出图片中能确认的原始玩家数据，最终由网站核对哪些玩家属于本俱乐部。\n10. 输出前自检 JSON 语法、字段名、类型和去重规则；最终回复只包含 JSON 本身。";
