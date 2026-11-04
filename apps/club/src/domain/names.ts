// Shared nickname rules for every import that maps AI-read names to player UUIDs (daily roster, Four-Way League).
// Only an exact display name or a confirmed alias is a reliable match; similarity only suggests candidates.
export type NamedPlayer = { id: string; display_name: string };
export type NameAlias = { player_id: string; alias_name: string };
export const exactName = (name: unknown) => typeof name === "string" ? name.trim() : "";
export const similarName = (name: unknown) => exactName(name).normalize("NFKC").replace(/[\s\p{P}\p{S}丶]/gu, "");

/** Edit distance, stopping early above 2 (only small differences matter for suggestions). */
export function distance(a: string, b: string) {
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

/** Players whose name or confirmed alias is exactly `name` (reliable), and up to five similar ones (suggestions). */
export function nameCandidates(name: unknown, players: NamedPlayer[], aliases: NameAlias[]) {
  const exact = exactName(name), normalized = similarName(name);
  const aliasIds = new Set(exact ? aliases.filter(a => exactName(a.alias_name) === exact).map(a => a.player_id) : []);
  const reliable = exact ? players.filter(p => exactName(p.display_name) === exact || aliasIds.has(p.id)).map(p => p.id) : [];
  const similar = normalized ? players.flatMap(p => {
    if (reliable.includes(p.id)) return [];
    const gap = Math.min(...[p.display_name, ...aliases.filter(a => a.player_id === p.id).map(a => a.alias_name)].map(n => distance(normalized, similarName(n))));
    return gap === 0 || (gap <= (Array.from(normalized).length > 4 ? 2 : 1) && normalized.length > 1) ? [{ id: p.id, gap }] : [];
  }).sort((a, b) => a.gap - b.gap || a.id.localeCompare(b.id)).slice(0, 5).map(p => p.id) : [];
  return { reliable, similar };
}
