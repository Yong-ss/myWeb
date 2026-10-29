// Shared member contract: the nine game fields every feature reads or writes, plus common id/date checks.
export const fields = ["name", "position", "level", "pathway", "extraordinary_score", "prosperity", "weekly_activity", "group", "join_days"] as const;
export const numericFields = ["level", "extraordinary_score", "prosperity", "weekly_activity", "join_days"] as const;
export type Member = Record<typeof fields[number], string | number | null>;
export type Player = { id: string; display_name: string; match_name: string | null };
/** Database column list for a saved member row (`group` is stored as `group_name`). */
export const savedColumns = fields.map(f => f === "group" ? "group_name" : f).join(",");
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "2000-01-01" && value <= "2100-12-31" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
