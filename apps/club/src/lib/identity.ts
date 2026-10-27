import type { Member, Player } from "./import.ts";

export type Alias = { id: string; player_id: string; alias_name: string };
export type Observation = Member & { player_id: string; snapshot_date: string };
export type IdentityContext = { aliases?: Alias[]; observations?: Observation[]; baseline?: { snapshot_date: string; count: number } | null };
export type Match = { identity: string; tier: "A" | "B" | "C" | "D"; reasons: string[]; candidates: { id: string; label: string; reasons: string[] }[] };
export const exactName = (name: unknown) => typeof name === "string" ? name.trim() : "";
export const similarName = (name: unknown) => exactName(name).normalize("NFKC").replace(/[\s\p{P}\p{S}丶]/gu, "");

function distance(a: string, b: string) {
  const left = Array.from(a), right = Array.from(b);
  if (Math.abs(left.length - right.length) > 2) return 3;
  let prior = right.map((_, i) => i + 1); prior.unshift(0);
  for (let i = 0; i < left.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < right.length; j++) next.push(Math.min(next[j] + 1, prior[j + 1] + 1, prior[j] + Number(left[i] !== right[j])));
    if (Math.min(...next) > 2) return 3;
    prior = next;
  }
  return prior[right.length];
}

export function anomalies(row: Member, prior: Observation | undefined, date: string) {
  if (!prior) return [];
  const reasons: string[] = [];
  if (row.pathway && prior.pathway && row.pathway !== prior.pathway) reasons.push("途径与上次不同");
  if (typeof row.level === "number" && typeof prior.level === "number" && row.level < prior.level) reasons.push("等级低于上次");
  for (const key of ["extraordinary_score", "prosperity"] as const) {
    const current = row[key], old = prior[key];
    if (typeof current === "number" && typeof old === "number" && old > 0 && (current < old * 0.5 || current > old * 2)) reasons.push(`${key === "prosperity" ? "繁荣度" : "非凡评分"}变化超过一倍`);
  }
  const days = Math.round((Date.parse(date) - Date.parse(prior.snapshot_date)) / 86400000);
  if (days >= 0 && typeof row.join_days === "number" && typeof prior.join_days === "number" && Math.abs(row.join_days - prior.join_days - days) > 2) reasons.push("入会天数与截图日期变化不符（可能重新加入）");
  return reasons;
}

// Numeric/history evidence only explains candidates; it can never establish identity.
export function matchPlayers(rows: Member[], players: Player[], context: IdentityContext, date: string): Match[] {
  const aliases = context.aliases ?? [], observations = context.observations ?? [];
  const matches = rows.map((row): Match => {
    const name = exactName(row.name), normalized = similarName(name);
    const exact = players.filter(p => exactName(p.display_name) === name && name);
    const aliasIds = new Set(aliases.filter(a => exactName(a.alias_name) === name && name).map(a => a.player_id));
    const reliable = players.filter(p => exact.some(x => x.id === p.id) || aliasIds.has(p.id));
    const ranked = players.map(p => {
      const prior = observations.find(o => o.player_id === p.id);
      const names = [p.display_name, ...aliases.filter(a => a.player_id === p.id).map(a => a.alias_name), prior?.name];
      const gap = normalized ? Math.min(...names.filter(Boolean).map(n => distance(normalized, similarName(n)))) : Infinity;
      const nameRelated = normalized.length > 0 && (gap === 0 || gap <= (Array.from(normalized).length > 4 ? 2 : 1) && normalized.length > 1);
      const reasons = reliable.some(x => x.id === p.id) ? ["名字或已记住的写法相符"] : nameRelated ? [gap === 0 ? "只是符号不同" : "名字相似"] : [];
      const supports = (["level", "pathway", "extraordinary_score", "prosperity"] as const).filter(k => row[k] !== null && prior?.[k] === row[k]);
      if (supports.length >= 2) reasons.push("多项历史属性相同（仅供参考）");
      return { id: p.id, label: p.display_name, reasons: [...reasons, ...anomalies(row, prior, date)], gap, nameRelated, related: reasons.length > 0 };
    }).filter(p => p.related).sort((a,b) => Number(!reliable.some(x => x.id === a.id)) - Number(!reliable.some(x => x.id === b.id)) || a.gap - b.gap || a.id.localeCompare(b.id));
    const reasons = !name ? ["缺少昵称，请修正或人工选择既有玩家"] : reliable.length > 1 ? ["准确昵称／别名指向多个玩家，必须人工处理"] : [];
    const identity = reliable.length === 1 ? reliable[0].id : "";
    const warnings = identity ? anomalies(row, observations.find(o => o.player_id === identity), date) : [];
    return { identity: warnings.length ? "" : identity, tier: identity && !warnings.length ? (exact.length ? "A" : "B") : ranked.length ? "C" : "D", reasons: [...reasons, ...warnings], candidates: ranked.filter(p => p.nameRelated || reliable.some(x => x.id === p.id)).slice(0, 5) };
  });
  return matches.map((match, i) => {
    const duplicate = similarName(rows[i].name) && rows.some((r,j) => j !== i && similarName(r.name) === similarName(rows[i].name));
    const collision = match.identity && matches.some((m,j) => j !== i && m.identity === match.identity);
    return duplicate || collision ? { ...match, identity: "", tier: "C", reasons: [...match.reasons, duplicate ? "同批重复或相似昵称，需核对同名不同人" : "多行匹配同一玩家，必须人工处理"] } : match;
  });
}
