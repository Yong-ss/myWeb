export const fields = ["name", "position", "level", "pathway", "extraordinary_score", "prosperity", "weekly_activity", "group", "join_days"] as const;
export const numericFields = ["level", "extraordinary_score", "prosperity", "weekly_activity", "join_days"] as const;
export type Member = Record<typeof fields[number], string | number | null>;
export type ConfirmedMember = Member & { player_id: string | null; source_name?: string | null; remember_alias?: boolean; identity_confirmed?: boolean; correct_name?: string; expected_name?: string };
export type Player = { id: string; display_name: string; match_name: string | null };
export type AbsenceDecision = {player_id:string;decision:'left'|'missed'|'uncertain'};
export type AbsenceContext = {snapshot:{id:string;snapshot_date:string}|null;members:{player_id:string;name:string}[]};
export type ImportContext = import("./identity.ts").IdentityContext & { players: Player[]; snapshot: { id: string; revision: number; is_complete_roster: boolean } | null; members: ConfirmedMember[]; absence_context?:AbsenceContext };
export const MAX_SOURCE_BYTES = 131072;
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateAbsences(value:unknown):AbsenceDecision[]{
  if(!Array.isArray(value)||value.length>1000)throw Error('缺席核对资料无效');
  const seen=new Set<string>();
  for(const a of value){if(!a||Object.keys(a).length!==2||typeof a.player_id!=='string'||!uuid.test(a.player_id)||!['left','missed','uncertain'].includes(a.decision)||seen.has(a.player_id.toLowerCase()))throw Error('请逐一核对缺席成员');seen.add(a.player_id.toLowerCase());}
  return value;
}

export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "2000-01-01" && value <= "2100-12-31" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)); }
function validateMember(value: unknown, index: number, confirmed: boolean): Member {
  const metadata = ["source_name", "remember_alias", "identity_confirmed", "correct_name", "expected_name"];
  if (!object(value) || !(confirmed ? [...fields, "player_id"].every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => [...fields, "player_id", ...metadata].includes(k)) : exactKeys(value, fields))) throw Error(`第 ${index + 1} 行字段不齐或包含额外字段`);
  if (confirmed && ((Object.hasOwn(value,"source_name") && value.source_name !== null && (typeof value.source_name !== "string" || value.source_name.length > 200)) || ["remember_alias", "identity_confirmed"].some(k => Object.hasOwn(value,k) && typeof value[k] !== "boolean"))) throw Error(`第 ${index + 1} 行身份确认资料无效`);
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
    if (Object.hasOwn(row,'correct_name') || Object.hasOwn(row,'expected_name')) {
      if (!row.player_id || row.identity_confirmed !== true || typeof row.correct_name !== 'string' || !row.correct_name.trim() || row.correct_name.length>200 || /[\u0000-\u001f\u007f]/.test(row.correct_name) || typeof row.expected_name !== 'string' || !row.expected_name.trim() || row.expected_name.length>200 || row.name!==row.correct_name.trim()) throw Error(`第 ${i+1} 行请确认已有玩家和正确昵称`);
    }
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
