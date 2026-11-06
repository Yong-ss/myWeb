// Dragon Hunt V1 import contract: attendance only. Every name in the screenshots is a member of this club (owner
// confirmed), so there is no "exclude": a row is matched, waits for a person, or is left out as unmatched (not
// saved, only counted). Pure; the Worker and database check the result again.
import { exactName, nameCandidates, type NameAlias } from "../../domain/names.ts";
import type { RosterPlayer } from "./highland.ts";

export const MAX_DRAGON_BYTES = 131072;
export const MAX_DRAGON_ROWS = 300;

/** Parses the AI JSON; identical names (scroll overlap between screenshots) count once. */
export function parseDragonSource(raw: string) {
  if (new TextEncoder().encode(raw).length > MAX_DRAGON_BYTES) throw Error("JSON 最大 128 KiB");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw Error("JSON 语法错误，请去掉代码围栏并检查引号和逗号"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== "event_type,participants,schema_version"
    || (value as Record<string, unknown>).schema_version !== 1 || (value as Record<string, unknown>).event_type !== "dragon_hunt") throw Error("需要猎龙 V1 JSON：schema_version 1、event_type \"dragon_hunt\"、participants");
  const list = (value as { participants: unknown }).participants;
  if (!Array.isArray(list) || !list.length) throw Error("participants 必须是非空数组");
  if (list.length > MAX_DRAGON_ROWS) throw Error(`最多 ${MAX_DRAGON_ROWS} 人`);
  const names = list.map((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).join() !== "player_name") throw Error(`第 ${i + 1} 行只能有 player_name 一个字段`);
    const name = (row as { player_name: unknown }).player_name;
    if (name !== null && (typeof name !== "string" || name.length > 200)) throw Error(`第 ${i + 1} 行 player_name 必须是文字或 null`);
    return name === null ? null : name.trim() || null;
  });
  const seen = new Set<string>();
  const rows = names.filter(n => { if (n === null) return true; if (seen.has(n)) return false; seen.add(n); return true; });
  return { rows, removed: names.length - rows.length };
}

/** match = an identity is set; review = a person picks someone or leaves it out; skip = left out (not saved). */
export type Decision = "match" | "review" | "skip";
export type Entry = { index: number; name: string | null; decision: Decision; identity: string; reasons: string[]; candidates: string[] };
export type Choice = { decision: "match"; identity: string } | { decision: "skip" };

/** Only an exact name or confirmed alias of exactly one player is matched automatically (shared rule, domain/names.ts). */
export function classifyDragon(rows: (string | null)[], players: RosterPlayer[], aliases: NameAlias[]): Entry[] {
  return rows.map((name, index) => {
    const base = { index, name, identity: "" };
    if (!name) return { ...base, decision: "review", reasons: ["昵称没看清"], candidates: [] };
    const { reliable, similar } = nameCandidates(name, players, aliases);
    if (reliable.length === 1) return { ...base, decision: "match", identity: reliable[0], reasons: [], candidates: reliable };
    if (reliable.length > 1) return { ...base, decision: "review", reasons: ["名字或已记住的写法指向多个玩家"], candidates: reliable };
    if (similar.length) return { ...base, decision: "review", reasons: ["名单里没有完全一致的名字，只有相似的"], candidates: similar };
    return { ...base, decision: "skip", reasons: ["成员名单里找不到（可能还没导入名单）"], candidates: [] };
  });
}

export const applyDragonChoices = (entries: Entry[], choices: Record<number, Choice>): Entry[] =>
  entries.map(e => { const c = choices[e.index]; return c ? { ...e, decision: c.decision, identity: c.decision === "match" ? c.identity : "" } : e; });

/** What is saved: matched rows only, one per player. Problems block saving; review rows must be decided first. */
export function dragonPlayers(entries: Entry[], remember: Record<string, boolean>, name: (id: string) => string) {
  const problems: string[] = [], seen = new Map<string, Entry>();
  for (const e of entries) if (e.decision === "match") {
    const prior = seen.get(e.identity);
    if (prior) problems.push(`第 ${prior.index + 1} 行「${prior.name ?? "昵称没看清"}」和第 ${e.index + 1} 行「${e.name ?? "昵称没看清"}」都选成了「${name(e.identity)}」`);
    else seen.set(e.identity, e);
  }
  const players = [...seen.values()].map(e => ({ player_id: e.identity, read_name: e.name, remember_alias: remember[e.identity] === true && !!e.name && exactName(e.name) !== exactName(name(e.identity)) }));
  return { players, problems, review: entries.filter(e => e.decision === "review").length, skipped: entries.filter(e => e.decision === "skip") };
}

export const dragonPrompt = "请从我上传的《诡秘之主》游戏「猎龙」参战名单截图中，提取所有玩家名字，并且只输出严格合法的 JSON，不要解释、Markdown、代码围栏或其他文字。\n\n规则：\n1. 我可能上传多张截图，全部读取。每个彩色名片是一名玩家，名片上方较大的文字是玩家名字；忽略左侧的数字（如 70）、名字下方的「猎龙之城战斗力」等说明文字、右上角的旗帜／盾牌／心形／麦克风等图标，以及空的「+」格子。\n2. 灰色（暗色）名片也是参加者，照常提取。\n3. 优先准确识别昵称中的汉字、繁简、英文、数字及有意义的特殊字符（如「·」「丶」）；不要擅自替换形近字或做繁简转换。完整昵称认不清时，player_name 填 null，不要猜测。\n4. 多张截图可能有重叠，同一名字只输出一次；不要虚构不存在的玩家。\n5. 只输出一个 JSON 对象，顶层必须且只能有三个字段：schema_version（固定为数字 1）、event_type（固定为字符串 \"dragon_hunt\"）、participants（数组）。participants 每个元素必须且只能有一个字段 player_name（字符串或 null）。\n6. 不要输出日期、人数、战斗力或其他字段；日期由网站填写。\n7. 输出前自检 JSON 语法和字段；最终回复只包含 JSON 本身。";
