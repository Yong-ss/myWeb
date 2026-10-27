export const fields = ["name", "position", "level", "pathway", "extraordinary_score", "prosperity", "weekly_activity", "group", "join_days"] as const;
export const numericFields = ["level", "extraordinary_score", "prosperity", "weekly_activity", "join_days"] as const;
export type Member = Record<typeof fields[number], string | number | null>;
export type ConfirmedMember = Member & { player_id: string | null };
export type Player = { id: string; display_name: string; match_name: string | null };
export type ImportContext = { players: Player[]; snapshot: { id: string; revision: number; is_complete_roster: boolean } | null; members: ConfirmedMember[] };
export const MAX_SOURCE_BYTES = 131072;
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "2000-01-01" && value <= "2100-12-31" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)); }
function validateMember(value: unknown, index: number, confirmed: boolean): Member {
  if (!object(value) || !exactKeys(value, confirmed ? [...fields, "player_id"] : fields)) throw Error(`第 ${index + 1} 行字段不齐或包含额外字段`);
  for (const field of fields) {
    const v = value[field];
    if (v === null) continue;
    if ((numericFields as readonly string[]).includes(field)) {
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || (["level", "join_days"].includes(field) && v > 2147483647)) throw Error(`第 ${index + 1} 行 ${field} 必须是非负整数或 null`);
    } else if (typeof v !== "string" || v.trim().length === 0 || v.length > 200) throw Error(`第 ${index + 1} 行 ${field} 必须是 1～200 字符文本或 null`);
  }
  return value as Member;
}
export function parseSource(raw: string): { members: Member[] } {
  if (new TextEncoder().encode(raw).length > MAX_SOURCE_BYTES) throw Error("JSON 最大 128 KiB");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw Error("JSON 语法错误，请去掉代码围栏并检查引号和逗号"); }
  if (!object(value) || !exactKeys(value, ["schema_version", "snapshot_date", "is_complete_roster", "members"]) || value.schema_version !== 1 || (value.snapshot_date !== null && !validDate(value.snapshot_date)) || typeof value.is_complete_roster !== "boolean") throw Error("需要完整的 v1 JSON：schema_version、snapshot_date、is_complete_roster、members");
  if (!Array.isArray(value.members) || value.members.length < 1 || value.members.length > 200) throw Error("每批需要 1～200 名玩家");
  return { members: value.members.map((row, i) => validateMember(row, i, false)) };
}
export function validateRows(value: unknown): ConfirmedMember[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 200) throw Error("每批需要 1～200 名玩家");
  const seen = new Set<string>();
  return value.map((row, i) => {
    validateMember(row, i, true);
    if (row.player_id !== null && (typeof row.player_id !== "string" || !uuid.test(row.player_id))) throw Error(`第 ${i + 1} 行尚未确认玩家身份`);
    if (row.player_id === null && row.name === null) throw Error(`第 ${i + 1} 行新玩家需要先填写昵称`);
    if (row.player_id !== null) {
      const id = row.player_id.toLowerCase();
      if (seen.has(id)) throw Error(`第 ${i + 1} 行与其他行指向同一玩家，请合并冲突后重试`);
      seen.add(id);
    }
    return row as ConfirmedMember;
  });
}
export function matchName(name: string) { return name.replace(/[\s、丶·]/gu, ""); }
export function mergePreview(previous: ConfirmedMember[], incoming: ConfirmedMember[], mode: "merge" | "replace") {
  return mode === "replace" ? incoming : [...previous.filter(old => !incoming.some(row => row.player_id !== null && row.player_id === old.player_id)), ...incoming];
}
