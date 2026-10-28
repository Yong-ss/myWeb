// Rank the confirmed game roles; group numbers never change role seniority.
function positionRank(value: string) {
  if (/^(公会长|会长)/.test(value)) return 0;
  if (value.startsWith("外交官")) return 1;
  if (value.startsWith("理事")) return 2;
  if (value.startsWith("俱乐部之星")) return 3;
  if (value.includes("组长")) return 4;
  if (value.includes("组员")) return 5;
  if (value.startsWith("正式成员")) return 6;
  if (value.startsWith("候补成员")) return 7;
  return 8;
}

export function compareMemberValues(field: string, a: string | number | null, b: string | number | null, descending: boolean) {
  // Unrecognized values stay at the bottom in both directions; zero is real data.
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const presence: Record<string, number> = {present: 0, unconfirmed: 1, left: 2};
  const comparison = field === "position" ? positionRank(String(a)) - positionRank(String(b))
    : field === "presence" ? (presence[String(a)] ?? 1) - (presence[String(b)] ?? 1)
    : typeof a === "number" && typeof b === "number" ? a - b
    : String(a).localeCompare(String(b), "zh-CN", {numeric: true});
  return descending ? -comparison : comparison;
}
